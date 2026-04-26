# Production-Readiness Review — Cropsetu FastAPI Service

Scope: `Cropsetu/fastapi/` only — FastAPI 0.135 + Pydantic v2 +
asyncpg + httpx, fronted by Express. Cross-cutting findings live in
[shared.md](shared.md); the Express layer's review is in
[backend-express.md](backend-express.md). This report assumes the
[shared.md S-01] decision has been made about where this service
actually lives in version control.

## Verdict

**DO NOT SHIP.** The single most important reason: SlowAPI is
configured at `main.py:43,99` and a 429 exception handler is
registered at `main.py:100`, but **no route is decorated with
`@limiter.limit(...)` and `SlowAPIMiddleware` is not added** —
which means the entire rate-limit story for this service is
dormant. The 5-agent Claude pipeline (`/ai/scan`) costs real
money per call. With 100 concurrent users and no throttle, a
single misbehaving client or a frontend bug that re-fires the
scan endpoint can drain your Anthropic budget in minutes.

## Top 5 risks at 100 concurrent users

1. **Rate limiter is dormant.** `main.py:43` defines
   `default_limits=["60/minute"]` but no route uses it; the
   429 handler at `main.py:100` will never fire.
2. **Untyped JSON request bodies leak `str(exc)` to clients.**
   `routes/chat.py:23-33`, `routes/scan.py:21-45`,
   `routes/agripredict.py:14-27`, `routes/alerts.py:16-28` all
   parse `await request.json()` and return raw exception messages
   on failure.
3. **No global exception handler.** Only the SlowAPI 429 handler
   is registered (`main.py:100`). Uncaught exceptions surface
   FastAPI's default error envelope, which echoes the exception
   detail.
4. **httpx clients instantiated per call.** Each LLM call opens a
   new TLS connection — `agents/llm_utils.py:94, 148, 199`,
   `services/chat_service.py:246, 289`,
   `routes/pest_prediction.py:110`. At 100 RPS, the TLS handshake
   cost dominates latency and exhausts ephemeral source ports.
5. **Anthropic billing has no app-level cap.** Every `/ai/scan`
   triggers the orchestrator, which calls Claude up to 4 times
   per pipeline. No per-user, per-day, or per-deployment ceiling.
   The Express layer has credit deduction; this service has none.

---

## Findings

### 🔴 BLOCKERS — must fix before any production traffic

**[F-01] SlowAPI is configured but never applied** —
`Cropsetu/fastapi/main.py:43, 99-100`

- Problem:

```py
# main.py:43
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

# main.py:99-100
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

For SlowAPI to actually limit requests, you must EITHER decorate
each route with `@limiter.limit("...")` OR register
`SlowAPIMiddleware`. Neither is done — `grep -rn '@limiter.limit'`
returns zero, and `app.add_middleware(SlowAPIMiddleware)` is
absent.
- Impact at 100 users: the only throttle on AI spend is the
  Express layer's `aiChatLimit` / `aiScanLimit`
  (`backend/src/middleware/redisRateLimit.js:67-89`). If anyone
  ever calls FastAPI directly (admin tooling, mis-configured
  mobile app pointing at the AI URL, an attacker who finds the
  Railway hostname), no limit applies. Combined with
  [shared.md S-06] (no internal token), this is the cost-
  runaway scenario.
- Fix: enable global default limits AND add per-route stricter
  caps for the expensive endpoints.

```py
# main.py — replace the existing limiter section
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

def rate_key(request: Request) -> str:
    # Express forwards the user via x-user-id (ai.routes.js:59).
    # Rate-limit per-user when known; fall back to IP for direct callers.
    uid = request.headers.get("x-user-id")
    return f"u:{uid}" if uid else f"ip:{get_remote_address(request)}"

limiter = Limiter(key_func=rate_key, default_limits=["60/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)   # ← was missing
```

Then per-route stricter caps on the expensive endpoints:

```py
# routes/scan.py
@router.post("/ai/scan")
@limiter.limit("10/minute")
async def ai_scan(request: Request):
    ...

# routes/pest_prediction.py
@router.post("/predict")
@limiter.limit("20/minute")
async def predict_pest_risk(req: PestPredictionRequest, request: Request):
    ...

@router.post("/detect-image")
@limiter.limit("10/minute")
async def detect_pest_from_image(req: PestDetectRequest, request: Request):
    ...
```

`@limiter.limit` requires the `request: Request` parameter to be
present in the handler signature (the decorator extracts the
key from it). The Pydantic-bodied routes need the `Request` arg
added.

---

**[F-02] Untyped request bodies + bare exception leak to client** —
`Cropsetu/fastapi/routes/chat.py:17-33`,
`Cropsetu/fastapi/routes/scan.py:21-45`,
`Cropsetu/fastapi/routes/agripredict.py:14-27`,
`Cropsetu/fastapi/routes/alerts.py:16-28`

- Problem (representative):

```py
# routes/chat.py:17-33
@router.post("/ai/chat")
async def ai_chat(request: Request):
    body = await request.json()
    message      = body.get("message", "")
    history      = body.get("history", [])
    farm_profile = body.get("farm_profile", {})

    if not message.strip():
        return JSONResponse({"success": False, "error": "message is required"}, 400)

    try:
        result = await chat_with_farmmind(message, history, farm_profile)
        return JSONResponse({"success": True, "data": result})
    except Exception as exc:
        logger.error("[Chat] Error: %s", exc, exc_info=True)
        return JSONResponse(
            {"success": False, "error": str(exc)},   # ← raw exception in response
            status_code=500,
        )
```

`pest_prediction.py:26` uses Pydantic models (`PestPredictionRequest`,
`PestDetectRequest`); the others do not. Inconsistency aside, the
`str(exc)` in the response body leaks DB schema names, file paths,
internal hostnames, prompt fragments, and SQL errors to whoever
called this — and the Express layer just passes it through.
- Impact at 100 users: A09 information disclosure. A03 if any of
  these inputs ever feed a SQL string. Plus, malformed JSON
  results in a `JSONDecodeError` whose message is also returned,
  enabling fingerprinting.
- Fix: introduce Pydantic models on every route and return a
  fixed, generic error envelope.

```py
# routes/chat.py
from pydantic import BaseModel, Field

class ChatHistoryItem(BaseModel):
    role:    str = Field(pattern=r"^(user|assistant|system)$")
    content: str = Field(max_length=8000)

class ChatRequest(BaseModel):
    message:      str    = Field(min_length=1, max_length=2000)
    history:      list[ChatHistoryItem] = Field(default_factory=list, max_length=20)
    farm_profile: dict   = Field(default_factory=dict)

@router.post("/ai/chat")
@limiter.limit("30/minute")
async def ai_chat(req: ChatRequest, request: Request):
    try:
        result = await chat_with_farmmind(req.message, req.history, req.farm_profile)
        return {"success": True, "data": result}
    except Exception:
        logger.exception("[Chat] Error")
        raise HTTPException(status_code=500, detail="AI chat failed")
```

`raise HTTPException(detail="...")` flows through the global
exception handler (see [F-03]) and lets you return a uniform
envelope. The verbose error stays in the log; the client gets a
generic message + request_id.

---

**[F-03] No global exception handler — uncaught errors leak
stack traces** — `Cropsetu/fastapi/main.py` (no
`@app.exception_handler` registration)

- Problem: `grep -rn '@app.exception_handler'` returns nothing.
  The only exception handler is for `RateLimitExceeded`
  (main.py:100). Any other uncaught exception falls through to
  FastAPI's default 500 handler, which in non-prod surfaces the
  exception detail; in prod still leaks the request URL and
  generic 500 envelope.
- Impact at 100 users: bugs that escape the per-route try/except
  surface internal details. Every error-case has different shape
  ({"success": false, "error": ...} vs FastAPI's
  {"detail": ...}) — the client cannot rely on a stable contract.
- Fix:

```py
# main.py
from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
import uuid

@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    response = await call_next(request)
    response.headers["x-request-id"] = request.state.request_id
    return response

@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        {"success": False, "error": {
            "message": exc.detail,
            "request_id": getattr(request.state, "request_id", None),
        }},
        status_code=exc.status_code,
    )

@app.exception_handler(RequestValidationError)
async def validation_exc_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        {"success": False, "error": {
            "message": "Invalid input",
            "details": exc.errors(),
            "request_id": getattr(request.state, "request_id", None),
        }},
        status_code=422,
    )

@app.exception_handler(Exception)
async def unhandled_exc_handler(request: Request, exc: Exception):
    logger.exception("[Unhandled] %s — request_id=%s",
                     type(exc).__name__,
                     getattr(request.state, "request_id", None))
    return JSONResponse(
        {"success": False, "error": {
            "message": "Internal server error",
            "request_id": getattr(request.state, "request_id", None),
        }},
        status_code=500,
    )
```

This unifies the response envelope across success, validation
failure, application-level HTTP errors, and unhandled exceptions.

---

**[F-04] `/pest/detect-image` accepts unbounded base64 image** —
`Cropsetu/fastapi/routes/pest_prediction.py:37-42, 90-170`

- Problem:

```py
class PestDetectRequest(BaseModel):
    image_base64: str = Field(..., description="Base64 encoded pest/crop image")
    media_type: str = Field(default="image/jpeg")
    crop_name: Optional[str] = None
    state: Optional[str] = None
    language: str = Field(default="en")
```

`image_base64` has no `max_length`. An attacker posts a 100 MB
base64 string. Pydantic builds a Python string of 100 MB. The
handler then forwards it to Claude — which charges by image
size. One request = potentially $5 in Anthropic spend.
- Impact at 100 users: DoS via memory + Anthropic billing
  exhaustion.
- Fix:

```py
# Cap at ~7 MB raw (10 MB base64 = ~7.5 MB after decode).
class PestDetectRequest(BaseModel):
    image_base64: str = Field(..., max_length=10 * 1024 * 1024)
    media_type:   str = Field(pattern=r"^image/(jpeg|png|webp|heic)$")
    crop_name:    str | None = Field(default=None, max_length=80)
    state:        str | None = Field(default=None, max_length=80)
    language:     str        = Field(default="en", pattern=r"^[a-z]{2}(-[A-Z]{2})?$")
```

Then sniff the magic bytes after base64-decode (the same
`file-type` library suggested in [backend-express.md E-29]
exists for Python as `python-magic`).

---

**[F-05] Gemini retry uses synchronized non-jittered backoff** —
`Cropsetu/fastapi/agents/llm_utils.py:95-105, 148-159, 199-210`

- Problem:

```py
for attempt in range(3):
    resp = await client.post(url, json=payload)
    if resp.status_code == 429:
        wait = 10 * (attempt + 1)         # ← deterministic: 10s, 20s, 30s
        logger.warning("Gemini 429 — backing off %ds", wait)
        await _async_sleep(wait)
        continue
    resp.raise_for_status()
    break
else:
    raise RuntimeError("Gemini rate-limited after 3 retries")
```

Two issues:
1. **No jitter** — every instance hitting Gemini's 429 wakes up
   at the same 10/20/30 s mark, retrying together. This is the
   classic thundering-herd amplifier.
2. **Only 429 is retried.** A transient 500/502/503/504 from
   Gemini, or a `httpx.ReadTimeout`, falls through to
   `resp.raise_for_status()` (line 102) and propagates
   immediately. Ironically, transient *server* errors are
   exactly what retries are for.
- Impact at 100 users: under Gemini outage, all FastAPI workers
  retry in lockstep at 10/20/30 seconds and hammer Gemini
  harder than necessary; under network blips, no retry at all.
- Fix:

```py
import random
async def _retry_post(client, url, *, json, headers=None, params=None):
    last_exc = None
    for attempt in range(3):
        try:
            resp = await client.post(url, json=json, headers=headers, params=params)
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                wait = (2 ** attempt) + random.random()    # 1, 2, 4 s + jitter
                logger.warning("[LLM] %d — backoff %.1fs (attempt %d)", resp.status_code, wait, attempt + 1)
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            return resp
        except (httpx.ReadTimeout, httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            last_exc = exc
            wait = (2 ** attempt) + random.random()
            await asyncio.sleep(wait)
    raise last_exc or RuntimeError("LLM call failed after 3 retries")
```

Use it from `call_gemini_vision`, `call_gemini_text`,
`call_groq_text`, and migrate the duplicated retry blocks
inside `chat_service.py:246, 289` to call this helper too.

---

**[F-06] Pipeline has no whole-pipeline timeout** —
`Cropsetu/fastapi/orchestrator.py:73-263`

- Problem: each stage has its own httpx timeout (90-120 s). The
  pipeline is roughly:

```
parallel(weather + image_quality_agent)  ← 30s + retries
   → disease_diagnosis_agent              ← 90s + retries
   → cross_verify (cpu only)              ← 0s
   → treatment_agent                      ← 90s + retries
   → report_generator_agent               ← 90s + retries
```

Pathological worst-case: 4 stages × 3 retries × 90s = 1080s. The
Express side aborts at 175 s (ai.routes.js:931); after that the
orchestrator continues running, holding an asyncpg connection
and racking up Anthropic spend.
- Impact at 100 users: with a single Gemini 429 storm, every
  in-flight scan blocks for tens of minutes consuming workers,
  DB pool, and money. There is no upper bound.
- Fix: wrap the orchestrator entry point in `asyncio.wait_for`
  and cap the whole pipeline.

```py
# orchestrator.py:39
async def run_diagnosis(params, images):
    try:
        return await asyncio.wait_for(
            _run_diagnosis_inner(params, images),
            timeout=120,                      # hard cap: 2 minutes
        )
    except asyncio.TimeoutError:
        logger.error("[Orchestrator] Pipeline TIMEOUT after 120s — params=%s", params.get("crop_name"))
        raise HTTPException(503, "Diagnosis service is busy. Please try again.")
    except Exception as exc:
        logger.exception("[Orchestrator] Unhandled pipeline error — crop=%s", params.get("crop_name"))
        raise RuntimeError(f"Diagnosis pipeline failed: {type(exc).__name__}") from exc
```

`asyncio.wait_for` cancels the inner task on timeout. As long as
the agents respect cancellation (they will; httpx is async
through-and-through), in-flight LLM calls stop immediately. Pair
with a per-call `httpx.Timeout(connect=5, read=30, write=30,
pool=5)` so individual calls also fail fast.

---

### 🟠 HIGH — fix within first week

**[F-07] httpx clients instantiated per request** —
`Cropsetu/fastapi/agents/llm_utils.py:94, 148, 199`,
`Cropsetu/fastapi/services/chat_service.py:246, 289`,
`Cropsetu/fastapi/routes/pest_prediction.py:110`,
`Cropsetu/fastapi/services/pest_agent_service.py:406`

- Problem: `async with httpx.AsyncClient(timeout=...) as client:`
  on every call opens a new TCP/TLS connection. At 100 RPS
  against Anthropic + Gemini + Groq, the TLS handshake cost
  alone (50-200 ms) is more than half the latency budget for
  cheap chat responses, and on Linux you exhaust ephemeral
  source ports under sustained burst.
- Fix: one shared client per upstream, kept alive for the app
  lifetime, with explicit pool limits.

```py
# new file: services/http_clients.py
import httpx
_anthropic: httpx.AsyncClient | None = None
_gemini:    httpx.AsyncClient | None = None
_groq:      httpx.AsyncClient | None = None

def _make_client(base_url: str = "") -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url,
        timeout=httpx.Timeout(connect=5, read=30, write=30, pool=5),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        http2=True,
    )

async def get_anthropic() -> httpx.AsyncClient:
    global _anthropic
    if _anthropic is None: _anthropic = _make_client("https://api.anthropic.com")
    return _anthropic
# ... same for gemini and groq

async def close_all():
    for c in (_anthropic, _gemini, _groq):
        if c: await c.aclose()
```

Wire startup/shutdown into the lifespan:

```py
# main.py lifespan
from services.http_clients import close_all
@asynccontextmanager
async def lifespan(app: FastAPI):
    ...
    yield
    await close_all()
    await close_shared_pool()
```

Then update every call site to `client = await get_gemini();
resp = await client.post(...)` instead of the per-call context
manager.

---

**[F-08] Gemini API key passed in URL querystring** —
`Cropsetu/fastapi/agents/llm_utils.py:73, 136`,
`Cropsetu/fastapi/services/chat_service.py:292`

- Problem:

```py
url = f"{_GEMINI_BASE}/{model}:generateContent?key={gemini_api_key}"
```

The full URL ends up in:
- Railway access logs (Cloudflare in front of Railway logs URLs).
- Any HTTP-level debug logs (`logger.debug({req})` from httpx
  internals if you ever flip `httpx`'s log level to DEBUG).
- Browser network tabs if you ever proxy /docs through.
- httpx's own retry logging on failure (which prints the URL).

Gemini's API supports header-based auth via `x-goog-api-key`.
Use it.
- Fix:

```py
url = f"{_GEMINI_BASE}/{model}:generateContent"
async with httpx.AsyncClient(timeout=120) as client:    # or pooled
    resp = await client.post(
        url,
        json=payload,
        headers={"x-goog-api-key": gemini_api_key},
    )
```

Same edit at every Gemini call site (3 of them).

---

**[F-09] Hardcoded Claude model ID with date suffix** —
`Cropsetu/fastapi/routes/pest_prediction.py:119`

- Problem:

```py
"model": "claude-sonnet-4-6-20250514",
```

A pinned date suffix is fine if intentional, but `config.py:24-28`
already defines `MODEL_IMAGE_QUALITY = "claude-sonnet-4-6"`
(no date) and `ANTHROPIC_MODEL` is read from env in
`config.py:15`. The route uses neither — it hardcodes a third
value.
- Fix:

```py
from config import ANTHROPIC_API_KEY, MODEL_DIAGNOSIS
...
"model": MODEL_DIAGNOSIS,   # or its own MODEL_PEST_DETECT in config.py
```

Decide once which model is canonical for vision pest detection,
put it in `config.py`, reference it from every call site.

---

**[F-10] Direct httpx calls instead of the official Anthropic SDK** —
`Cropsetu/fastapi/routes/pest_prediction.py:110-149`,
`Cropsetu/fastapi/services/pest_agent_service.py:406`

- Problem: `requirements.txt:3` includes `anthropic==0.94.0` —
  the official SDK with built-in retries, streaming, error
  classification, and authentication. Both call sites duplicate
  the request shape by hand and parse the response by hand
  (lines 151-162 in pest_prediction.py).
- Fix:

```py
from anthropic import AsyncAnthropic
_client: AsyncAnthropic | None = None

def get_anthropic_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY, max_retries=2)
    return _client

# routes/pest_prediction.py:110
client = get_anthropic_client()
msg = await client.messages.create(
    model=MODEL_PEST_DETECT,
    max_tokens=2048,
    system=system_prompt,
    messages=[{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": req.media_type, "data": req.image_base64}},
            {"type": "text",  "text": f"Identify ... Crop: {req.crop_name or 'Unknown'} ..."},
        ],
    }],
)
text = "".join(b.text for b in msg.content if b.type == "text")
```

This removes ~40 lines of boilerplate, gives you the SDK's
retry/backoff for free, and means future Anthropic features
(prompt caching, message-batches, tool use) are one method call
away.

---

**[F-11] Lifespan tolerates DB unreachable on startup** —
`Cropsetu/fastapi/main.py:64-71`

- Problem:

```py
if DATABASE_URL:
    try:
        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            ver = await conn.fetchval("SELECT version()")
        logger.info("[Config] PostgreSQL OK — %s", ver[:60])
    except Exception as exc:
        logger.error("[Config] PostgreSQL UNREACHABLE — %s", exc)
        logger.error("[Config] AgriPredict features will return errors until DB is fixed")

yield
```

The service starts, accepts traffic, and silently fails on every
AgriPredict request. `/health` (line 120) does report
"degraded", but the prompt's Section 6 is explicit:
"Configuration error at startup → fail fast, exit 1, do not start
serving traffic."
- Fix:

```py
if DATABASE_URL:
    try:
        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception as exc:
        logger.fatal("[Config] PostgreSQL UNREACHABLE on startup — refusing to start: %s", exc)
        if os.getenv("NODE_ENV") == "production":
            sys.exit(1)            # Railway will mark deploy failed and roll back
        # Dev: continue with warning so you can iterate on DB-less code
```

---

**[F-12] `scan.py` delayed import gives misleading 503 message** —
`Cropsetu/fastapi/routes/scan.py:26-33`

- Problem:

```py
try:
    from orchestrator import run_diagnosis
except ImportError as e:
    logger.warning("[Scan] Orchestrator not available: %s", e)
    return JSONResponse(
        {"success": False, "error": "Crop scan agents are being set up. Please try again later."},
        status_code=503,
    )
```

Python caches imports — the first request that triggers an
ImportError stores the error, but subsequent requests use the
cached module object whether it imported or not. After a single
`/ai/scan` call on a freshly-restarted process where the import
fails, every later call inside the same process will succeed (or
fail the same way) — and the user-facing error
"agents are being set up" is misleading either way.

The same anti-pattern is in `routes/agripredict.py:17`.
- Fix: import at module load time.

```py
# routes/scan.py
from orchestrator import run_diagnosis
...
@router.post("/ai/scan")
@limiter.limit("10/minute")
async def ai_scan(req: ScanRequest, request: Request):
    result = await run_diagnosis(req.params, req.images)
    return {"success": True, "data": result}
```

If `orchestrator` legitimately fails to import (missing deps),
the whole service should fail to start (per [F-11]).

---

**[F-13] Anthropic models are not in the pricing table** —
`Cropsetu/fastapi/agents/llm_utils.py:18-21`

- Problem:

```py
_PRICING = {
    "gemini-2.5-flash":  {"input": 0.00015, "output": 0.0006},
    "llama-3.3-70b-versatile": {"input": 0.00059, "output": 0.00079},
}
```

`config.py:24-28` schedules four agents on Claude models, but
`_calc_cost` returns `0.0` for any unknown model. The orchestrator
sums these into `total_cost_usd` (orchestrator.py:221) and the
field is exposed via the API. **You are reporting `$0.00` cost
for the most expensive part of the pipeline.**
- Fix: maintain Anthropic pricing in the same table.

```py
_PRICING = {
    "gemini-2.5-flash":             {"input": 0.00015, "output": 0.0006},
    "llama-3.3-70b-versatile":      {"input": 0.00059, "output": 0.00079},
    # Anthropic pricing (per 1K tokens, USD) — verify against the
    # current public price list and update when models change.
    "claude-sonnet-4-6":              {"input": 0.003,  "output": 0.015},
    "claude-haiku-4-5-20251001":      {"input": 0.001,  "output": 0.005},
}
```

Add a unit test that fails if any model from `config.py` is
absent from `_PRICING`.

---

**[F-14] `get_shared_pool` race window** —
`Cropsetu/fastapi/db_pool.py:18-26`

- Problem:

```py
_db_pool = None

async def get_shared_pool():
    global _db_pool
    if _db_pool is None and DATABASE_URL:
        import asyncpg
        _db_pool = await asyncpg.create_pool(
            DATABASE_URL, min_size=2, max_size=10, command_timeout=15
        )
    return _db_pool
```

Two coroutines that both see `_db_pool is None` enter the branch
in parallel and both create a pool. The second leaks (10 idle
connections held forever, plus the live pool's 10).
- Mitigation: the lifespan at `main.py:65` pre-creates the pool
  on startup, so the race only triggers if startup fails and
  later requests recreate it. Still worth fixing.
- Fix:

```py
import asyncio
_db_pool = None
_lock = asyncio.Lock()

async def get_shared_pool():
    global _db_pool
    if _db_pool is None:
        async with _lock:
            if _db_pool is None and DATABASE_URL:
                import asyncpg
                _db_pool = await asyncpg.create_pool(
                    DATABASE_URL, min_size=2, max_size=8, command_timeout=15,
                )
    return _db_pool
```

Note: `max_size=8` per [shared.md] connection-budget math. Also
add a `statement_timeout` once asyncpg supports it on connection
creation, or set it server-side via `SET LOCAL statement_timeout`
inside long queries.

---

**[F-15] PII in chat-service logs** —
`Cropsetu/fastapi/services/chat_service.py:317-323`

- Problem:

```py
logger.info("[ChatService] farm_profile keys: %s", list(farm_profile.keys()))
logger.info("[ChatService] soilType=%s, irrigationType=%s, crops=%d, district=%s, farmName=%s",
            farm_profile.get("soilType", "MISSING"),
            farm_profile.get("irrigationType", "MISSING"),
            len(farm_profile.get("crops", [])),
            farm_profile.get("district", "MISSING"),
            farm_profile.get("farmName", "MISSING"))
```

`farmName` is user-provided text. `district` + `soilType` are
PII-adjacent (combined with phone from the JWT layer they
pinpoint a household). Logs travel to Sentry / Datadog / Logtail.
- Fix: log only sentinels or hashes.

```py
import hashlib
def _hash_id(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:8] if s else ""

logger.info({
    "event":      "chat.request",
    "soilType":   farm_profile.get("soilType", "MISSING"),
    "irrigType":  farm_profile.get("irrigationType", "MISSING"),
    "cropsCount": len(farm_profile.get("crops", [])),
    "districtH":  _hash_id(farm_profile.get("district", "")),
    "farmH":      _hash_id(farm_profile.get("farmName", "")),
})
```

Same applies to `orchestrator.py:85-94` (full farm parameters in
INFO logs).

---

**[F-16] No service-to-service auth (cross-ref)** — see
[shared.md S-06]. The fix lives in this codebase: a
`Depends(require_internal_token)` injected into every router.

---

### 🟡 MEDIUM — fix within first month

**[F-17] Per-route Pydantic models are inconsistent** —
`routes/pest_prediction.py:26-42` (typed) vs.
`routes/chat.py:17`, `routes/scan.py:21`,
`routes/agripredict.py:14`, `routes/alerts.py:16` (all
untyped).

- Problem: clients cannot rely on consistent validation
  behaviour. OpenAPI docs (when not disabled in prod) show typed
  routes with full schemas and untyped routes as opaque.
- Fix: introduce `ChatRequest`, `ScanRequest`, `AlertRequest`,
  `AgripredictRequest` Pydantic models. See [F-02] for the
  ChatRequest example.

---

**[F-18] No streaming for long AI generations** —
`routes/chat.py`, `routes/scan.py`, `services/chat_service.py`

- Problem: chat replies (line 366 returns a single dict) and
  scan reports (orchestrator returns the final dict) wait for
  the full LLM response before sending anything to the client.
  At 30-90 s pipelines, the user sees a spinner for the entire
  duration.
- Fix: SSE / chunked-encoding from FastAPI. Anthropic and Gemini
  both support streaming. Beyond the prompt's scope but worth
  flagging because it materially changes the UX at 100 users.

---

**[F-19] No per-request cost cap or per-user daily AI quota** —
this service has none

- Problem: Express has credits (`aiCredit.service.js`) but
  FastAPI is willing to call Claude/Gemini/Groq for any caller.
  Combined with [F-01] and [shared.md S-06], a runaway client
  spends real money.
- Fix: track daily Anthropic spend per `x-user-id` in Redis (the
  Express service already has Redis configured). Stop accepting
  scan requests when a per-user daily ceiling is hit.

```py
# pseudo:
spent_today = await redis.incrbyfloat(f"ant:{uid}:{date}", 0)
if spent_today > MAX_USD_PER_USER_PER_DAY:
    raise HTTPException(429, "Daily AI budget reached")
# After the call:
await redis.incrbyfloat(f"ant:{uid}:{date}", call_cost_usd)
await redis.expire(f"ant:{uid}:{date}", 60*60*48)
```

---

**[F-20] `_async_sleep` is a needless abstraction** —
`agents/llm_utils.py:226-228`

- Problem:

```py
async def _async_sleep(seconds: float):
    import asyncio
    await asyncio.sleep(seconds)
```

`asyncio` is already used elsewhere in the same file
(`orchestrator.py:20`, `agents/llm_utils.py` only imports it
inside this function). Indirect, makes grep harder.
- Fix: delete `_async_sleep`, replace its callers with
  `await asyncio.sleep(...)`. Add `import asyncio` at the top.

---

**[F-21] Brittle JSON extraction from LLM output** —
`routes/pest_prediction.py:158-162`

- Problem:

```py
try:
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    result = json.loads(text.strip())
except json.JSONDecodeError:
    result = {"raw_response": text, "parse_error": True}
```

If parsing fails, the entire LLM output (potentially a prompt-
injection echo) lands in the response body as `raw_response`.
- Fix: reuse `utils/json_extractor.py:extract_json` (already
  imported in `services/chat_service.py:224`) which has battle-
  tested cleanup. On failure, return a fixed error dict —
  `{"error": "could_not_parse_response"}` — never the raw text.

---

**[F-22] `routes/scan.py:48-54` returns 400 for an advertised
endpoint** —
`Cropsetu/fastapi/routes/scan.py:48`

- Problem:

```py
@router.post("/api/v1/crop-disease/agentic-predict")
async def agentic_predict(request: Request):
    """Direct multipart endpoint for testing. Same as /ai/scan but accepts form-data."""
    return JSONResponse(
        {"success": False, "error": "Use /ai/scan via the Express proxy."},
        status_code=400,
    )
```

The route is registered but always returns 400. Dead code with
a misleading docstring — either delete or implement.
- Fix: delete the route. If you need a multipart variant for
  Postman testing, make it dev-only (`if not IS_PROD`).

---

**[F-23] No instrumentation: no OpenTelemetry, no Prometheus
metrics, no request-id middleware** — this whole service

- Problem: the prompt's section 7 lists structured logs +
  metrics + tracing as required. Logs are configured via
  `logging_config.py:setup_logging` (not read in this pass);
  metrics and tracing are absent.
- Fix: add `prometheus-fastapi-instrumentator` for HTTP metrics
  and `opentelemetry-instrumentation-fastapi` +
  `-instrumentation-asyncpg` + `-instrumentation-httpx` for
  traces. Both are one-import additions to `main.py`. Wire to
  Grafana Cloud / Honeycomb / whatever the platform uses.

---

**[F-24] `routes/pest_prediction.py:175` `/prediction-status`
exposes capability flags** —
`Cropsetu/fastapi/routes/pest_prediction.py:175-189`

- Problem: returns `{"agentic_ai": bool(ANTHROPIC_API_KEY),
  "database": bool(DATABASE_URL), ...}`. An unauthenticated
  caller learns whether Anthropic and DB are configured, which
  is reconnaissance for an attacker. With [shared.md S-06] (no
  internal auth) this endpoint is public.
- Fix: gate with the internal-token dependency. Or remove; the
  capabilities are static at deploy time.

---

### 🟢 LOW — technical debt

**[L-01] `orchestrator.py:85-94` logs full farm params at INFO** —
already noted in [F-15]; LOW because the per-request log volume
is bounded.

**[L-02] `agents/` directory not read in this pass** —
6 agent files totalling ~2050 lines (`disease_diagnosis_agent`
336, `report_generator_agent` 906, `treatment_agent` 427,
`image_quality_agent` 115, `weather_analysis_agent` 38,
`llm_utils` 228). The orchestrator wires them together; the
findings here cover the orchestrator's contract with them but
not internal correctness of each agent. Recommend a follow-up
focused review on `disease_diagnosis_agent.py` and
`treatment_agent.py` since those drive the most LLM calls.

**[L-03] No tests beyond `tests/test_report_template.py`** —
the orchestrator has no test that runs the pipeline end-to-end
with fixtures. A breakage in one agent's contract surfaces only
in production.

**[L-04] `routes/__init__.py` is empty** — fine, but combined
with the lack of an explicit `__all__` in agent modules, IDE
discovery is uneven.

---

## Dead code & redundancy to delete

- `routes/scan.py:48-54` — `/api/v1/crop-disease/agentic-predict`
  is a 400-by-design stub.
- `agents/llm_utils.py:226-228` — `_async_sleep` indirection.
- The retry block in `agents/llm_utils.py` is duplicated three
  times (vision, gemini text, groq text). Replace with the
  shared `_retry_post` from [F-05].

## Currently missing entirely (must add)

- [ ] `app.add_middleware(SlowAPIMiddleware)` plus per-route
      `@limiter.limit` (per [F-01]).
- [ ] Pydantic models on every route (per [F-02], [F-17]).
- [ ] Global exception handlers for `HTTPException`,
      `RequestValidationError`, `Exception`
      (per [F-03]).
- [ ] `INTERNAL_API_TOKEN` dependency on every router
      (per [shared.md S-06]).
- [ ] Pooled, long-lived httpx clients
      (per [F-07]).
- [ ] Whole-pipeline `asyncio.wait_for` on the orchestrator
      (per [F-06]).
- [ ] Anthropic models in the `_PRICING` table
      (per [F-13]).
- [ ] Anthropic SDK adoption (per [F-10]).
- [ ] Per-user / per-day Anthropic cost cap (per [F-19]).
- [ ] OpenTelemetry + Prometheus instrumentation (per [F-23]).
- [ ] Sentry on the FastAPI side too (mentioned in shared).
- [ ] Per-test-file pytest tests covering each route's happy
      path and one validation-failure path (also in
      [shared.md S-09]).

## Deadlock & race-condition map (FastAPI side)

The only DB-writing endpoints in this service are within
`services/pest_agent_service.py` (`run_pest_prediction_agent`
saves predictions) and `services/agripredict` (sync triggers
write to `mandi_prices` and `prediction_cache`). Neither was
read in this pass — flag for the deeper agent review:

| Endpoint / Job | Tables (claimed) | Lock order | Risk |
|----------------|------------------|------------|------|
| `POST /pest/predict` | pest predictions | unknown | review needed |
| `POST /agripredict/sync/trigger` | mandi_prices, prediction_cache | mandi → cache | overlap with Express monthly purge — see [shared.md] |
| Orchestrator (no direct DB writes) | n/a | n/a | OK |

The Express-side concern about Express writing to tables that
FastAPI also writes (covered in [shared.md]) is the dominant
deadlock surface; this service is not yet a dual-writer for any
table.

## 100-user load math

Pool budget (refined from [shared.md]):
- `min_size=2, max_size=10`, `command_timeout=15` (db_pool.py:24).
- Recommended drop to `max_size=8` so total budget across
  Express + FastAPI fits under 80 connections at 1+1 workers.
- With [F-06] (`asyncio.wait_for(120)`), no individual request
  holds a connection longer than 120 s.

Workers: FastAPI is **fully async** — one Uvicorn worker
handles 100 concurrent users for I/O-bound routes comfortably.
The bottleneck is the LLM call latency, not Python's GIL. Pin
to `--workers 1` until profiling justifies otherwise; multiple
workers multiply the asyncpg connection budget without helping
LLM-bound throughput.

p95 target:
- `/ai/chat` (Groq primary, Gemini fallback): realistic 1-3 s.
  Carve out from the 300 ms global SLO.
- `/ai/scan` (5-stage Claude pipeline): realistic 30-60 s. Carve
  out separately.
- `/health`, `/pest/prediction-status`: must hit < 100 ms.
- `/agripredict/sync/trigger`: depends on data.gov.in latency,
  often 5-10 s. Move to a background task — fire-and-forget
  return immediately, write status to a DB row the cron checks.

Anthropic spend math at 100 users:
- One scan ≈ 4 Claude calls × 3000 in-tokens × $0.003/1K + 4 ×
  1500 out-tokens × $0.015/1K = $0.036 + $0.090 = ~$0.13/scan.
- 100 users × 50 scans/day each (current free tier) = 5000
  scans/day = $650/day = $19,500/month.
- A single client bug that re-fires scans at 1 RPS for an hour
  burns ~$470 alone with [F-01] dormant.

Set `MAX_USD_PER_USER_PER_DAY` (per [F-19]) to no more than
~$1.50 (≈ 10 scans) until product economics justify higher.

## Pre-launch checklist (FastAPI)

- [ ] All 6 BLOCKERS [F-01]…[F-06] resolved.
- [ ] All HIGH findings [F-07]…[F-16] resolved.
- [ ] `pip-audit --strict` returns clean (CI gap covered in
      [shared.md S-10]).
- [ ] `bandit -r . -ll` returns clean.
- [ ] `ruff check .` returns clean.
- [ ] Pytest covers every route's happy path + one input-
      validation failure + one upstream-failure path
      (use `respx` to mock Anthropic / Gemini / Groq).
- [ ] Load test at 1.5× target (150 concurrent) for 10 min
      against `/ai/chat` only: p95 < 4 s, errors < 0.1 %, no
      asyncpg pool saturation, no Anthropic 5xx.
- [ ] Synthetic outage test: kill Postgres mid-load; `/health`
      flips to "degraded"; Express's `/readyz` (post-fix) flips
      to 503; LB removes the instance.
- [ ] Anthropic spend dashboard wired (Anthropic console + a
      per-deployment Prometheus counter from `_PRICING`-backed
      math).
