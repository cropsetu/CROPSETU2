# CropSetu — AI Crop-Disease Diagnosis Service: Architecture

**Service:** `fastapi/` · Python 3.14 · FastAPI + Celery
**Purpose:** Diagnose crop diseases from a farmer's leaf photo(s) + farm context, and return a safe, localized treatment/advisory report.
**Audience:** Backend / AI engineers working on (or onboarding to) the diagnosis pipeline.
**Status:** Living document — reflects the pipeline after the *v2-prompt + per-crop-whitelist + reliability-hardening* work.

> **How to read this.** §1–§4 are orientation: the overview, a component diagram, the journey of a single scan, and the key design decisions. Everything after is a per-subsystem deep dive, each grounded in the actual code (file + function references). Skim §1–§4, then jump to the subsystem you're touching.

## Table of Contents

- [1. System Overview](#1-system-overview)
- [2. Architecture at a Glance](#2-architecture-at-a-glance)
- [3. End-to-End Data Flow — One Scan](#3-end-to-end-data-flow-one-scan)
- [4. Recent Design Decisions (Changelog)](#4-recent-design-decisions-changelog)
- [Request Lifecycle & Async Job Model](#request-lifecycle-async-job-model)
- [Orchestrator Pipeline (Stages 1–5)](#orchestrator-pipeline-stages-15)
- [Disease Diagnosis Stage — Prompt, Per-Crop Whitelist & Naming](#disease-diagnosis-stage-prompt-per-crop-whitelist-naming)
- [Cascade Gate, Ensemble & Reconciliation](#cascade-gate-ensemble-reconciliation)
- [Treatment, RAG Grounding & Safety/Compliance](#treatment-rag-grounding-safetycompliance)
- [Report Generation, Persistence & Localisation](#report-generation-persistence-localisation)
- [LLM Dispatch, Config, Providers & Observability](#llm-dispatch-config-providers-observability)
- [Evaluation, Testing & Quality Gates](#evaluation-testing-quality-gates)
- [Glossary](#glossary)
- [File Map](#file-map)

## 1. System Overview

CropSetu's AI service is a **FastAPI** app fronted by an **Express (Node) proxy** and backed by **Celery + Redis** for async job execution. A farmer photographs a diseased leaf in the mobile app; the app sends it (base64) plus farm context to Express, which **HMAC-signs** the request and forwards it to FastAPI's `POST /ai/scan`.

Diagnosis is a **multi-agent pipeline** coordinated by `orchestrator.py`. Cheap, deterministic, `$0` stages (image-quality CV, weather rules, cross-verification, report templating) bracket the expensive LLM stages (vision diagnosis, and — only on hard cases — a multi-model ensemble vote).

**Design goals, in priority order:**
1. **Safety** — never recommend a wrong/banned pesticide; degrade to "consult an advisor" when uncertain.
2. **Quality** — accurate disease ID via one strong vision model, *constrained to the crop's real diseases*.
3. **Availability** — survive load + provider blips; when a model is genuinely down, **say "service unavailable"** rather than answer with a weaker model.
4. **Cost control** — spend caps, idempotency, deterministic stages, ensemble only when needed.

### Tech stack
| Concern | Choice |
|---|---|
| API | FastAPI + Uvicorn, SlowAPI rate limiting |
| Async jobs | Celery; Redis broker + result backend |
| Vision / LLM | Gemini 2.5 Pro/Flash, Claude Sonnet/Haiku (native SDKs) |
| Weather | Open-Meteo (keyless) |
| Persistence | PostgreSQL via asyncpg (fire-and-forget) |
| CV (quality + visual verify) | Pillow only (no OpenCV/numpy) |
| Localization | Sarvam (Indic translation) |

## 2. Architecture at a Glance

```
 ┌─────────────┐   HTTPS    ┌───────────────┐  signed POST /ai/scan   ┌──────────────────────────────┐
 │  Mobile app │ ─────────▶ │ Express proxy │ ──────────────────────▶ │      FastAPI  (main.py)       │
 │  (Expo/RN)  │ ◀───────── │  (HMAC sign)  │ ◀────────────────────── │      routes/scan.py           │
 └─────────────┘   poll     └───────────────┘   {job_id} / {report}   └───────────────┬──────────────┘
        ▲   GET /ai/scan/{job_id}                          enqueue (Celery, Redis db1) │
        └───────────────────────────────────────────────────────────────────┐         ▼
                                                            ┌──────────────────────────────────────┐
                                                            │  Celery worker (jobs/tasks.py)         │
                                                            │   _materialise(base64→/tmp) →          │
                                                            │   orchestrator.run_diagnosis() →       │
                                                            │   _cleanup(temp files)                 │
                                                            └────────────────────┬───────────────────┘
                                                                                 ▼
 ┌──────────────────────────────────── Orchestrator pipeline (≤240s) ──────────────────────────────────┐
 │  S1  ImageQuality (Pillow CV)  ‖  Weather fetch (Open-Meteo)   ──▶  S2  Weather rules ($0)            │
 │            │ quality gate (unusable → needs-rescan)                                                   │
 │            ▼                                                                                          │
 │  S3  DIAGNOSIS — Gemini 2.5 Pro, v2 prompt, per-crop candidate list, canonical name-snap              │
 │        ├─ provider down ───────────────▶  SERVICE UNAVAILABLE  (single model, NO fallback)           │
 │        └─ low-conf / ambiguous ─▶ S3.25 ENSEMBLE (Gemini Pro + Claude Sonnet) ─▶ Reconciler vote     │
 │  visual-verify (HSV) ─▶ S3.5 Cross-verify (rules, caps/penalties) ─▶ S4 Treatment (RAG + safety)     │
 │                                                                       ─▶ S5 Report (template, 4 pp.) │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘
   external deps:  Gemini / Anthropic APIs   ·   PostgreSQL (persist)   ·   Redis (jobs, spend cap, idempotency)
```

**Legend:** `‖` = runs in parallel · `$0` = deterministic/no-LLM stage · S* = pipeline stage.

## 3. End-to-End Data Flow — One Scan

1. **Capture.** Farmer takes 1–5 leaf photos; app attaches farm context (`crop_name`, `crop_growth_stage`, `soil_type`, `irrigation_system`, `planting_date`, `state`/`district`, `tier`).
2. **Proxy + sign.** Express stamps `x-user-id` / `x-request-id`, HMAC-signs, and `POST`s to `/ai/scan` with images as base64.
3. **Intake (sync, fast).** `routes/scan.py` → verify signature → rate-limit → validate image sizes/shapes → spend-cap check → idempotency lookup. New work → `enqueue_diagnosis()` returns `{job_id, status:"queued"}` immediately.
4. **Worker.** Celery `run_diagnosis_task` decodes base64 → temp files, calls `orchestrator.run_diagnosis(params, images)`, always cleans up temp files.
5. **Stage 1 (parallel).** Resolve field coordinates (GPS→district→state); run **image-quality CV**; **fetch weather** (Open-Meteo). 
6. **Stage 2.** Rule-based **weather risk** (favorable diseases, advisory) — `$0`.
7. **Quality gate.** Unusable images → short-circuit to a *needs-rescan* report.
8. **Stage 3 — diagnosis.** Build the prompt with the crop's **candidate-disease list**, call **Gemini 2.5 Pro** (v2 prompt), parse, then **canonical-snap** the disease name. If the provider is down → **`service_unavailable`** result (no weaker-model fallback).
9. **Service-down short-circuit.** If diagnosis came back `service_unavailable`, the orchestrator returns a clear "try again later" report and stops.
10. **Stage 3.25 — ensemble (conditional).** If confidence `< 0.80` or the call is ambiguous, fan out to **Gemini Pro + Claude Sonnet** in parallel; `reconciler.fuse()` votes (dead "Unknown" votes dropped; confidence-aware tie-break).
11. **Visual verify + Stage 3.5 cross-verify.** Pixel-level HSV check of color claims, then rule-based confidence caps/penalties (weather contradiction, image quality, ambiguity, lab-confirmation).
12. **Stage 4 — treatment.** RAG-grounded against the chemical registry; **cultural/biological-only** when no registered chemical exists for that (crop, disease).
13. **Stage 5 — report.** Template assembles the 4-section farmer report + meta (tokens, cost, latency, models). Native-language strips via Sarvam.
14. **Persist + return.** Fire-and-forget DB insert; report lands in the Redis result backend; the app's poll (`GET /ai/scan/{job_id}`) returns `{status:"done", data:<report>}`.

## 4. Recent Design Decisions (Changelog)

These are the deliberate choices behind the current pipeline — read them before changing the diagnosis path.

- **One canonical prompt (v2 only).** `ACTIVE_VERSIONS["diagnose"] = "v2"`. v2 = strict naming + per-crop candidate narrowing + a "Healthy" path + an out-of-distribution rule. `diagnose.v1.md` stays on disk *only* for historical eval replay; it is never served.
- **Per-crop candidate whitelist (~70 crops).** `data/crop_disease_catalog.py` (data) + `data/crop_disease_whitelist.py` (logic). The diagnosis prompt is constrained to the selected crop's real diseases (+ "Healthy"); uncovered crops fall back to open vocabulary. This kills out-of-crop hallucinations (e.g. wheat→"Wheat Streak Mosaic").
- **Deterministic name canonicalization.** `_normalise` snaps the model's disease to the crop's canonical common name (e.g. `"Alternaria solani"` → `"Early Blight"`) via `data/disease_synonyms.py`, fixing the pathogen-vs-common-name mismatch even when the model slips. Off-list predictions get a soft penalty, never a hard reject.
- **Single-model diagnosis, NO cross-model fallback.** A weaker fallback model (e.g. Flash at ~30% vs Pro at ~67% top-1) degrades quality undetectably. So on a provider outage (HTTP 503 "high demand", timeout, missing key) the stage returns a clear **`service_unavailable`** and the user is told to retry — it does not silently answer with another model. (One *same-model* 2s retry absorbs transient blips; that is not a model fallback.)
- **Reconciler hardening.** `reconciler.fuse()` drops failed "Unknown" votes when a real vote exists, and breaks ties by **confidence** (not insertion order) — a flaky ensemble member can no longer sink a real diagnosis.
- **Synonym-aware eval scoring.** `golden_runner._top1_match` compares via `same_disease()` canonicalization, so a correct binomial answer isn't scored wrong for naming.
- **Crop-name normalization front-door.** `services/input_normalizer.py` `_CROP_ALIASES` resolves regional names ("corn"→Maize, "bhindi"→Okra) before fuzzy matching, so the whitelist key always matches.


## Request Lifecycle & Async Job Model

A crop scan is intentionally **asynchronous**. The diagnosis pipeline can take 60-120s when it escalates into the multi-model ensemble, but the mobile client uses `expo-file-system` / OkHttp with a ~60s read timeout that cannot be reliably raised (`routes/scan.py:4-9`). So `POST /ai/scan` does almost no work synchronously: it authenticates, validates, gates on spend, dedups, enqueues a Celery job, and returns a `job_id` immediately. The client then polls `GET /ai/scan/{job_id}` (or, per the docstring, receives an FCM push — push is mentioned but not implemented in these files).

### End-to-end sequence

```
mobile app
   │  (HTTPS, image as base64 + params)
   ▼
Express proxy  ── sets x-user-id, x-request-id; HMAC-signs (X-Sig-Timestamp / X-Sig-Signature)
   │
   ▼  POST /ai/scan
┌──────────────────────── FastAPI (main.py) ────────────────────────┐
│ middleware: stamp request_id/user_id into contextvars,             │
│             SlowAPIMiddleware (default 60/min)                      │
│                                                                    │
│ route ai_scan (routes/scan.py):                                    │
│   1. Depends(verify_signed_request)  → 401 on bad/stale/missing sig│
│   2. @_scan_limiter "10/minute;60/hour" (keyed by x-user-id|IP)    │
│   3. body = await request.json(); normalize_tier(params.tier)      │
│   4. _validate_images()  → 400 if any oversized/malformed / none ok│
│   5. check_under_cap(user_id)  → 402 if over daily UTC cap         │
│   6. cache_key = idempotency.cache_key(body, Idempotency-Key)      │
│        6a. idempotency.get(cache_key)  HIT → 200 {status:"done",   │
│            data, _idempotent_replay:true}   (no worker run)        │
│        6b. lookup_job_for_key(cache_key) → non-failed job →        │
│            200 {job_id, status, _idempotent_replay:true}           │
│   7. enqueue_diagnosis(payload, idempotency_key=cache_key)         │
│        → 200 {job_id, status:"queued"}                             │
└────────────────────────────┬───────────────────────────────────────┘
                             │ celery_app.send_task (Redis broker, db 1)
                             ▼
        ┌──────────── Celery worker (jobs/tasks.py) ────────────┐
        │ run_diagnosis_task(payload):                          │
        │   _materialise(images) → base64 → /tmp/cropsetu_*.jpg │
        │   set request_id_var / user_id_var (log correlation)  │
        │   asyncio.run(orchestrator.run_diagnosis(params,imgs))│
        │   finally: _cleanup(temp_paths)  (always unlinks)     │
        │   return report dict → Redis result backend           │
        └───────────────────────────────────────────────────────┘
                             ▲
mobile app ── GET /ai/scan/{job_id} (poll) ──────────────────────────┘
   returns {status: queued|running|done|failed, data?, error?}
```

### 1. Auth — signed requests (`security/auth.py`)

On Railway the FastAPI service has a public URL, so without a shared secret anyone could hit `/ai/scan` directly and burn LLM spend (`security/auth.py:1-14`). Express signs every proxied request; `verify_signed_request` is attached as a `Depends(...)` on **both** `/ai/scan` and `/ai/scan/{job_id}` (`routes/scan.py:88, 190`).

- Header contract (`security/auth.py:21-23`): `X-Sig-Timestamp: <unix epoch>` and `X-Sig-Signature: hex(HMAC-SHA256(secret, f"{ts}.{METHOD}.{path}.{sha256(body)}"))`.
- Checks, in order (`verify_signed_request`, lines 50-91): missing headers → 401 `missing_signature`; non-integer ts → 401 `bad_timestamp`; `abs(now - ts) > _SKEW` → 401 `stale_signature` (replay window default 60s via `AI_AUTH_SKEW_SEC`); signature mismatch via `hmac.compare_digest` → 401 `bad_signature`.
- Config: `AI_SHARED_SECRET` (HMAC key), `AI_AUTH_REQUIRED` (default true; `"false"` bypasses for dev — line 38/57). **Gotcha:** if `AI_AUTH_REQUIRED=true` but `AI_SHARED_SECRET` is empty, it hard-fails 503 `auth_misconfigured` rather than letting traffic through (lines 59-64).
- The verifier reads the raw body for the hash and stashes it on `request.state.signed_body` (line 91). Starlette caches the body internally, so the route re-reading via `await request.json()` is safe.

### 2. Rate limiting (`main.py` + `routes/scan.py`)

Two layers, both SlowAPI:
- App-wide default `60/minute` (`main.py:66`), enforced because `SlowAPIMiddleware` is installed (`main.py:129` — note the comment: without the middleware the decorators never fire).
- Route-specific `@_scan_limiter.limit("10/minute;60/hour")` on `ai_scan` (`routes/scan.py:90`).
- The limiter key is `u:<x-user-id>` when present, else `ip:<remote-addr>` (`_scan_key`, `routes/scan.py:78-80`; same logic as `main.py:_rate_key`). The rationale: carrier NAT means many users share one IP, so per-user is fairer for authenticated traffic, and the gate sits at the enqueue endpoint because downstream workers can't be throttled per-user.

### 3. Image validation (`routes/scan.py:_validate_images`, lines 38-73)

The route does **not** decode base64 to bytes — that's the worker's job. It only sanity-checks shape and size so a bad payload fails fast as a 400 instead of silently dropping images mid-run:
- non-dict entry → error.
- legacy on-disk `{path, type}` entries (used by smoke tests) pass through untouched (lines 52-53).
- missing/empty `data` string → error.
- size is estimated as `(len(data) * 3) // 4` and rejected if it exceeds `_MAX_INLINE_BYTES_PER_IMAGE = 8 MB` (lines 35, 61-67). Cleaned entries default `mime_type` to `image/jpeg` (lowercased) and `type` to `leaf`.
- If there are any errors → 400 `{success:false, error:"image validation failed", details:[...]}`; if nothing usable survives → 400 `no usable images in request`.

Note the size check is a **base64-length approximation**, not a real decode, so the worker re-validates with `base64.b64decode(..., validate=True)` and re-applies the 8 MB cap (`jobs/tasks.py:53, 71-78`).

### 4. Spend cap (`security/spend.py`)

`check_under_cap(user_id)` runs at enqueue (`routes/scan.py:125`), **before** any work is queued, so the system never schedules a job the user has no budget for. It tracks USD per user per UTC day:
- Cap is `DAILY_SPEND_CAP_USD` (default $1.00) for identified users, `ANONYMOUS_DAILY_CAP_USD` (default $0.10) for the shared anonymous bucket (`security/spend.py:36-37, 64-65`). Anonymous users (no `x-user-id`) all share one bucket so there's no free-for-all hole.
- Over cap → `HTTPException(402)` with detail `{code:"daily_cap_reached", used_usd, cap_usd, resets_at_utc}` (lines 97-105).
- Storage is Redis `db 0` if reachable on `localhost:6379`, else an in-memory dict (per-replica, single-process). `SPEND_CAP_ENABLED=false` disables it entirely.
- `record_spend()` (the post-pipeline increment, `incrbyfloat` + 26h TTL) is fail-soft and is **not** called anywhere in these seven files — it lives downstream of the orchestrator. So enqueue-time `check_under_cap` only sees spend that some other code path recorded; treat the wiring of `record_spend` into the worker/orchestrator as out-of-scope here / unverified in this section.

### 5. Idempotency (`services/idempotency.py` + `jobs/queue.py`)

Two cooperating layers prevent duplicate LLM spend on retries (double-tap "Scan", network blips):

**Cache key resolution** (`idempotency.cache_key`, lines 78-84): prefer the `Idempotency-Key` header → `idem:scan:hdr:<key[:128]>`. Fallback is SHA-256 of the canonicalised body → `idem:scan:body:<digest>`. Canonicalisation (`_canonical_body`, lines 54-75) strips noise the client can't avoid varying: it hashes only `{params}` plus, per image, `{type, name}` where `name` is the **last path segment only** (so `/tmp/abc.jpg` vs `/tmp/def.jpg` retries collapse) — and uses `sort_keys=True` to neutralise key ordering/whitespace.

**Layer A — completed-result cache** (`routes/scan.py:134-142`): `idempotency.get(cache_key)` hit returns the cached report inline with `status:"done"` and `_idempotent_replay:true`, so the client skips polling entirely. Backed by Redis `db 0` with 60-min TTL (`IDEMPOTENCY_TTL_SECONDS`), in-memory LRU (cap 500) otherwise. Non-2xx responses are never cached (a 500 stays retryable).

**Layer B — in-flight job reuse** (`routes/scan.py:144-162` + `jobs/queue.py`): `lookup_job_for_key(cache_key)` reads the `idem:scan:job:<key>` binding (Redis, 1h TTL — `jobs/queue.py:76-77, 91-113`). If a binding exists and the job is **not failed**, the route returns that existing `job_id` instead of spawning a new one. **Design rule:** failed prior jobs are deliberately not reused — failures should be retryable — so the route falls through to enqueue (lines 148-151), and `enqueue_diagnosis` re-checks the same rule as the single canonical policy location (`jobs/queue.py:131-141`), rebinding the key to the fresh job.

**Caveat in the current code:** the GET handler tries to promote a done result back into the idempotency cache, but it can't recover the original `Idempotency-Key` (that binding is job-side), so it keys a best-effort entry by the report's `meta.request_id` under `idem:scan:hdr:<req_id>` (`routes/scan.py:217-228`). The comment itself flags this as incomplete / a future refinement — header-keyed callers rely on the worker-completion cache path which is noted as not yet wired. So a same-body POST shortcuts via Layer A only when something has populated that cache; otherwise it falls back to Layer B job reuse.

### 6. Enqueue + the polling contract (`jobs/queue.py`)

`enqueue_diagnosis(payload, idempotency_key=...)` (lines 118-152) does the idempotency re-check, then `celery_app.send_task("jobs.tasks.run_diagnosis_task", kwargs={"payload": payload})` and binds the key → `job_id`. The payload propagates `request_id` and `user_id` so worker logs carry the same correlation tags (`routes/scan.py:166-171`).

`get_job_status(job_id)` (lines 155-183) maps Celery `AsyncResult.state` onto the client contract: `PENDING → queued`, `STARTED|RETRY → running`, `SUCCESS → done` (with `data = result.result`), `FAILURE → failed` (error = stringified result), `REVOKED → failed "job cancelled"`. **Gotcha:** Celery returns `PENDING` for both "queued, not yet started" **and** "unknown/garbage job id" — they're indistinguishable here, so a bogus `job_id` polls forever as `queued`. Clients should treat extended `PENDING` as "not yet picked up" (lines 163-168). The GET path param is constrained to `min_length=4, max_length=128` (`routes/scan.py:192`).

### 7. The worker (`jobs/tasks.py`)

`run_diagnosis_task` (lines 103-152) is the Celery entry point:
1. `_materialise(images)` (lines 56-92) decodes each base64 `data` with `validate=True`, re-checks the 8 MB cap, picks an extension from `_MIME_TO_EXT` (`.jpg/.png/.webp`, default `.jpg`), and writes to `tempfile.mkstemp(prefix="cropsetu_worker_")`. Bad/oversized images are logged and skipped (not fatal). Output is `[{path, type}]` plus the list of temp paths to clean up.
2. Stamps `request_id_var` / `user_id_var` from the payload for log correlation (lines 128-135).
3. Late-imports `orchestrator.run_diagnosis` and runs it via `asyncio.run(...)` — Celery tasks are synchronous and the prefork pool is process-per-task, so a private event loop per task is safe (lines 138-142). Returns the orchestrator's report dict unchanged; Redis serialises it as JSON.
4. `finally: _cleanup(temp_paths)` always unlinks the temp files (`missing_ok=True`), even on failure or soft-timeout (lines 95-100, 151-152). `SoftTimeLimitExceeded` and any other exception are logged and re-raised so the job lands in `FAILURE`.

**Retry / timeout policy:** the task sets `max_retries=0` because the orchestrator already handles transient LLM errors internally and a retried diagnose stage costs real money (lines 116-117); a hard task failure surfaces as `status=failed` and the client resubmits. Celery app config (`jobs/queue.py:55-67`): `task_acks_late=True` (requeue on worker crash), `worker_prefetch_multiplier=1` (don't let one worker hog several 60-120s jobs), `result_expires=86400` (24h result retention vs. the 1h idempotency cache), and `task_time_limit=300 / task_soft_time_limit=270` as defence-in-depth on top of the orchestrator's own 240s wrapper. The two `acks_late` settings (app config + task decorator at `jobs/tasks.py:107`) are belt-and-suspenders.

> Note the slight asymmetry the docstrings call out: `task_acks_late=True` would requeue a crashed task, but `max_retries=0` means an *exception* inside the task is not retried — those govern different failure modes (process death vs. caught exception).

### Redis topology

Three modules share Redis but split keyspaces: idempotency (`db 0`, `idem:scan:*`), spend cap (`db 0`, `spend:*`), and Celery broker/result backend (`CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND`, default `db 1`) plus the `idem:scan:job:*` binding. `db 1` keeps job traffic off the dedup keyspace (`jobs/queue.py:1-8`). Every Redis client is best-effort: idempotency and the job binding degrade to in-process/no-dedup if Redis is down (`jobs/queue.py:79-88`, `services/idempotency.py:36-45`), and spend falls back to an in-memory per-replica dict. **Operational gotcha:** in multi-replica deploys without Redis, idempotency, job lookup, and spend accounting all become per-process — duplicate work and over-cap spend can leak across replicas.

### Request/response shapes

**`POST /ai/scan` request body**
```json
{
  "params": { "tier": "fast|best", "crop_name": "...", "growth_stage": "..." },
  "images": [
    { "data": "<base64>", "mime_type": "image/jpeg", "type": "leaf" }
  ]
}
```
Headers: `X-Sig-Timestamp`, `X-Sig-Signature` (required unless auth disabled), and optional `x-user-id`, `x-request-id`, `Idempotency-Key`.

**`POST /ai/scan` responses** (all 200 on the success path)
```json
{ "success": true, "job_id": "<uuid>", "status": "queued" }
{ "success": true, "status": "done", "data": { /* report */ }, "_idempotent_replay": true }
{ "success": true, "job_id": "<uuid>", "status": "queued|running", "data": null, "_idempotent_replay": true }
```
Errors: 400 (image validation / no usable images), 401 (signature), 402 (`daily_cap_reached`), 429 (rate limit), 500 (`{success:false, error}`), 503 (`auth_misconfigured`).

**`GET /ai/scan/{job_id}` response**
```json
{ "success": true, "job_id": "<id>", "status": "queued|running|done|failed",
  "data": null | { /* report */ }, "error": null | "<str>" }
```

`POST /api/v1/crop-disease/agentic-predict` is a deprecation stub returning 400 `"Use /ai/scan via the Express proxy."` (`routes/scan.py:235-241`); the `main.py` docstring's description of it as a live multipart endpoint is stale.

---

## Orchestrator Pipeline (Stages 1–5)

The orchestrator is the single entry point that turns a scan request (`params` + uploaded `images`) into a finished report card. It lives in `fastapi/orchestrator.py` and coordinates five stages — three of which are zero-cost rule/heuristic stages and two of which (diagnose, treatment) are LLM calls routed through agents. It is async through-and-through so cancellation propagates cleanly into in-flight HTTP/LLM calls.

### Entry point and the two timeout layers

`run_diagnosis(params, images)` (`orchestrator.py:69`) is a thin wrapper. It does almost nothing itself except enforce the **hard wall-clock cap** and translate exceptions:

```python
return await asyncio.wait_for(_run_diagnosis_inner(params, images),
                              timeout=_PIPELINE_TIMEOUT_SECONDS)   # 240s
```

- `_PIPELINE_TIMEOUT_SECONDS = 240` (`orchestrator.py:66`). The comment explains the sizing: a Claude Haiku vision diagnose (60–90s with the ~8K system prompt + 8K max output) + treatment LLM (20–40s) + one router fallback hop (~60s). The Express proxy in front aborts at 175s by default, so callers are expected to bump that to ~250s for the result to be visible end-to-end.
- On `asyncio.TimeoutError` it logs and re-raises as a `TimeoutError` with a farmer-readable message (`orchestrator.py:106`).
- Any other exception is logged with a full traceback and re-raised as `RuntimeError(f"Diagnosis pipeline failed: {type(exc).__name__}: {exc}")` (`orchestrator.py:114`) — note it deliberately includes the original message, not just the class name, so triage logs and the client see the actual cause.

Inside, `_run_diagnosis_inner` (`orchestrator.py:122`) runs the real pipeline and is governed by a **second, finer-grained budget**: `PipelineBudget(total_seconds=240)` (`orchestrator.py:134`).

**Why two layers?** The outer `wait_for` only handles the "hang forever" case — if one stage eats most of the budget, the next stage gets an abrupt mid-LLM cancel and the user sees a generic timeout. `PipelineBudget` (`fastapi/pipeline/budget.py`) lets each stage be wrapped with `with_budget(coro, max_seconds=..., stage=..., min_required=...)`, which runs the coroutine under `asyncio.wait_for(coro, timeout=min(max_seconds, remaining_budget))`. If `remaining() < min_required` it raises `BudgetExhausted` (a `TimeoutError` subclass) **before** calling the coroutine — and it `.close()`s the un-awaited coroutine so no "never-awaited" warning leaks (`budget.py:82-94`). This means a doomed stage burns zero tokens. `budget.snapshot()` (`budget.py:107`) is later stamped into `report["meta"]["budget"]` with per-stage elapsed times.

### Tier resolution (fast / best, ALLOW_BEST_TIER)

Before any stage runs, the orchestrator resolves the farmer-chosen tier (`orchestrator.py:140-150`):

- `requested_tier = params.get("tier") or PIPELINE_DEFAULT_TIER` (default `"fast"`), normalized via `normalize_tier`.
- `ALLOW_BEST_TIER` (env, default `true`) is the **ops kill-switch**: if `tier == "best"` and `ALLOW_BEST_TIER` is false, the request is coerced to `"fast"` regardless of what the client sent (used during cost incidents).
- The resolved tier is written back into `params["tier"]` so every downstream agent and the treatment cache key see the same value, and stamped onto `tier_var` (a contextvar) so JSON logs from downstream agents include it without threading it through every call.

Note: the user-facing fast/best tier mostly affects treatment routing now; the *diagnosis* difficulty escalation is handled adaptively by the Stage 3.25 cascade gate (below), not by the tier.

### Stage 1 — Parallel coordinate resolution + image quality + weather fetch

```
                params (lat/lon, state, district, city)        images[]
                              │                                   │
                  get_weather_coords(...)  (awaited first)        │
                              │ → (eff_lat, eff_lon, source)      │
        ┌─────────────────────┴───────────────┐                  │
        ▼                                      ▼                  ▼
 _safe_fetch_weather(eff_lat,eff_lon)   run_image_quality_agent(images)
        │   (Open-Meteo, cached)               │  (Pillow heuristics, $0)
        └──────────────── asyncio.gather ──────┘
```

`get_weather_coords` (`fastapi/services/district_coords.py:122`) is **awaited first** (not in the gather) because its output feeds the weather fetch. It is a deterministic priority chain returning `(lat, lon, source)`:
1. **GPS** — device lat/lon, validated to `-90..90 / -180..180`.
2. **District center** — substring match against `_DISTRICT_CENTERS[state][district]` (a hand-maintained table covering ~9 states' major districts).
3. **State capital** — `_STATE_CAPITALS` (all 28 listed Indian states).
4. **Default** — central India / Nagpur `(21.1458, 79.0882)`.

This guarantees weather is *always* attemptable even without GPS permission. **Gotcha:** because the table is partial, a request from a district not in `_DISTRICT_CENTERS` silently falls back to the state capital (or Nagpur) — the weather is then for the wrong micro-location, but `coord_source` records this for audit.

Then weather fetch and image quality run concurrently via `asyncio.gather` (`orchestrator.py:177-180`):

- `_safe_fetch_weather(lat, lon)` (`orchestrator.py:537`) returns `None` if coords are missing and **swallows all exceptions** (logs, returns `None`) — weather is never allowed to fail the pipeline. It calls `fetch_weather` (`fastapi/weather_service.py:77`), which hits **Open-Meteo** (free, no API key) and is cached by coordinates **bucketed to 1 decimal place** (~11 km grid) for **30 minutes** (`_WEATHER_TTL_SECONDS`). Cache prefers Redis on `localhost:6379` and falls back to an in-process dict capped at 200 entries (`weather_service.py:30-74`). The HTTP call has its own 15s timeout. Output shape: `current` (temp, humidity, dew_point, vpd, wind, precip, cloud, weather_desc, apparent_temperature), `daily_forecast` (7 days), `soil`, `location`.
- `run_image_quality_agent(images)` (`fastapi/agents/image_quality_agent.py:150`) — **no LLM**; heuristic + Pillow CV. Per image it: rejects unsupported extensions, rejects > 15 MB (`_MAX_FILE_BYTES`, anti-DoS), **magic-byte sniffs** the first 16 bytes and refuses anything whose bytes don't match a known image format or whose extension/magic disagree (security: don't hand arbitrary binary to the vision model). It then computes a size baseline (0.3 / 0.6 / 0.85) and blends in `_cv_inspect` (blur via FIND_EDGES stddev, exposure via mean luminance, green-ratio via HSV sampling) as `0.6*cv_score + 0.4*base`. A multi-view bonus (+0.1 for ≥2, +0.05 for ≥3) applies only when at least one image scores ≥ 0.5. Output: `quality_score` (avg, rounded), `usable` (`avg ≥ 0.4`), `suggestions`, `enhancement_notes` (set when `0.4 ≤ score < 0.6`). Per-image CV details are stashed on each image dict as `_cv`.

### Stage 2 — Rule-based weather analysis (no LLM, $0)

`analyze_weather_risk_rules(weather_data, crop_name, soil_type, growth_stage)` (`fastapi/services/weather_rules.py:118`) is a pure deterministic function that returns the *same dict shape* the old LLM weather agent produced, so it's a drop-in zero-cost replacement (`tok_weather = empty_token_info("rule-based")`, `orchestrator.py:198`).

It derives a `risk_score` 0–3 → `LOW/MODERATE/HIGH/CRITICAL` from humidity, temperature, VPD (a leaf-wetness proxy), wind (spore dispersal), precipitation, and dew point; computes `soil_risk` from soil moisture/temperature; lists `favorable_diseases` against a 12-entry disease-condition matrix (`_DISEASE_CONDITIONS`); summarizes the 7-day `forecast_risk`; and emits a human `advisory`. If `weather_data` is `None`, it returns a conservative `MODERATE` default with `weather_used: False`.

It also exposes `disease_is_known(name)` (`weather_rules.py:45`) — a case-insensitive substring check against the matrix's known-disease set. This is used later in Stage 3.5 so cross-verify only applies a "weather contradicts diagnosis" penalty for diseases the KB actually has an opinion on (avoids punishing valid diagnoses the narrow KB has never heard of).

### The image quality gate (needs-rescan short-circuit)

After Stage 2, the orchestrator gates on image quality (`orchestrator.py:208-216`):

```python
if not image_usable and quality_score < 0.4 and not enh_notes:
    return _needs_rescan_response(image_quality, weather_risk, params)
```

If images are *completely* unusable it short-circuits with `_needs_rescan_response` (`orchestrator.py:547`) — a `report_id="needs_rescan"` payload with `UNDETERMINED` disease, `advisor_needed: True`, retake-photo suggestions, and the (still-computed) weather outlook. No LLM is ever called.

> **Discrepancy worth knowing:** the config defines `IMAGE_QUALITY_THRESHOLD = 0.6` and it is imported at the top of `orchestrator.py`, but the actual gate uses the `usable`/`< 0.4`/`enh_notes` triad above, **not** that constant. The imported `IMAGE_QUALITY_THRESHOLD` is effectively dead in this file. So in practice anything that's `usable` (avg ≥ 0.4) proceeds to diagnosis; marginal images (0.4–0.6) pass with an `enhancement_notes` flag rather than being blocked.

### Stage 3 — Disease diagnosis (vision) and the service_unavailable short-circuit

The slowest, most expensive stage. A copy of `params` with `_raw_weather` injected (`diag_params`) is passed to `run_disease_diagnosis_agent` under a budget wrapper (`orchestrator.py:229-240`):

- `max_seconds=180.0`, `stage="diagnose"`, `min_required=10.0` — the largest soft cap, sized to leave ~60s for treatment+report inside 240s.
- A `BudgetExhausted` / `asyncio.TimeoutError` is **caught here** so a slow diagnose degrades to `_uncertain_fallback(...)` rather than bubbling up as the opaque outer-240s error (`orchestrator.py:241-253`).

This stage is **single-model with NO cross-model fallback by design** (diagnose prompt v2 is the sole prompt; per-crop ~70-crop candidate whitelist + canonical name-snap happen inside the agent). If the diagnosis *provider* itself is down (e.g. Gemini 503), the agent returns `service_unavailable: True`, and the orchestrator hard-stops with `_service_unavailable_response` (`orchestrator.py:268-270`, `:588`). The rationale (documented in the helper's docstring) is explicit: silently swapping to a weaker model degrades accuracy undetectably and is hard to maintain, so the farmer is told to retry instead of being given a low-quality answer dressed up as a real one.

### Stage 3.25 — Cascade gate (escalate to ensemble)

This is the adaptive-routing replacement for user-facing tiers. The cheap pass handles the easy majority; only hard scans fan out (`orchestrator.py:272-325`). `tok_ensemble` defaults to `"none-not-escalated"`.

```python
should_escalate = (
    ENABLE_ENSEMBLE
    and (confidence < ENSEMBLE_ESCALATE_BELOW or ambiguous)   # 0.80, env-tunable
    and not diagnosis.get("crop_mismatch")
    and not diagnosis.get("is_out_of_distribution")
)
```

- `ambiguous` is computed by `_is_ambiguous(diagnosis, ENSEMBLE_AMBIGUOUS_DELTA)` (`orchestrator.py:521`, delta default `0.10`): true when the primary confidence and the top differential's probability are within `delta` **and** that probability > 0.25 — i.e. the model is admitting it can't tell two diseases apart, distinct from plain low confidence.
- Escalation is **suppressed** for crop-mismatch and out-of-distribution results (no point voting more models on a wrong-crop photo).
- When escalating, `ensemble_agent.select(crop_name)` picks the frontier models and `ensemble_agent.run_parallel(...)` runs them under `with_budget(max_seconds=120, stage="ensemble", min_required=20)`. A budget/timeout failure here **degrades gracefully** — it keeps the cheap primary result (`ensemble_results = []`, `orchestrator.py:306-311`).
- If the ensemble returned anything, `reconciler.fuse([diagnosis, *ensemble_results])` votes and replaces `diagnosis`. The reconciler **drops dead 'Unknown' votes** and does a **confidence-aware tie-break** (recent design). `confidence`, `pd`, and `ensemble_agreement` are refreshed from the fused result.

### Visual claim verification ($0)

Independent of escalation, `verify_visual_claims(diagnosis, images)` (`fastapi/safety/visual_verify.py`) cross-checks the LLM's color/symptom claims ("yellow halos", "white sporulation") against actual pixels via a Pillow HSV histogram (`orchestrator.py:331-338`). Falsified claims produce a small `score_penalty` stored under `diagnosis["_visual_audit"]`, which feeds into cross-verify and is later surfaced into `meta.visual_audit`.

### Escalation check + Stage 3.5 — Cross-verification (rule-based, $0)

A first escalation check sets `needs_advisor` if `confidence < DIAGNOSIS_ESCALATE_BELOW` (0.5) (`orchestrator.py:341`). Then `cross_verify.apply(...)` (`fastapi/safety/cross_verify.py`) runs (`orchestrator.py:345-355`), receiving `weather_kb_has_disease = disease_is_known(primary_disease_name)` so it only penalizes "weather contradicts" for diseases the KB knows. It returns an adjusted `(diagnosis, confidence)`, attaches `confidence_penalties`, and may set `needs_advisor` / `needs_lab_confirmation`. If the new confidence dips below 0.5 (and `_force_treatment` is not set), advisor escalation is set again (`orchestrator.py:363-365`). The pipeline still proceeds to treatment — escalation flags the report rather than aborting it.

### Stage 4 — Treatment & fertilizer (budget-aware)

`run_treatment_agent(diagnosis, weather_risk, params)` runs under `with_budget(max_seconds=90, stage="treatment", min_required=8)` (`orchestrator.py:372-388`). 90s covers Gemini Flash (5–10s) plus the Claude Haiku fallback (30–60s). On `BudgetExhausted`/`TimeoutError` it degrades to `_fallback_treatment(disease)` — cultural & biological measures only, a `confidence_adjusted_note` telling the farmer to re-run for chemical recs, `tok_treatment = empty("budget-skipped")`, and `needs_advisor = True` (`orchestrator.py:389-400`). This is the key payoff of `PipelineBudget`: rather than getting asyncio-cancelled mid-Anthropic-request, the pipeline degrades to a useful partial answer.

### Stage 5 — Report generator (template, awaited directly)

`run_report_generator_agent(diagnosis, treatment, weather_risk, image_quality, params)` (`orchestrator.py:413`) assembles the final report card. It is **not** budget-wrapped — it's template/formatting work expected to be fast and is the last stage, so it just runs under the outer 240s cap. `report_params` again carries injected `_raw_weather` for the weather cards.

### Token aggregation + meta stamping

All five token-info dicts (`tok_weather`, `tok_diagnosis`, `tok_ensemble`, `tok_treatment`, `tok_report`) are summed into `pipeline_token_usage` with per-agent breakdown and totals (input/output/total tokens, cost USD) (`orchestrator.py:425-451`). Then `report["meta"]` is stamped (`orchestrator.py:453-503`) with: `pipeline_seconds` (monotonic elapsed), `image_quality_score`, `confidence_score`, `escalated`, the token usage block, `tier`, `model_diagnose`/`model_treatment`, ensemble fields (`ensemble_used`/`agreement`/`models`), `budget.snapshot()`, the `request_id` from the FastAPI middleware contextvar, prompt-version metadata (`prompts.diagnose`/`prompts.treatment`, preferring per-request `_prompt_meta` so a scan can be replayed against the exact prompt text), an optional `local_classifier_prior` (ONNX top-k), and a `visual_audit` summary. Raw weather (`raw_current`/`raw_soil`/`raw_forecast[:7]`/`location`) is attached under `weather_outlook` for the PDF report.

### Fire-and-forget persistence

Finally (`orchestrator.py:509-516`):

```python
asyncio.create_task(record_diagnosis(params=params, images=images, report=report))
return report
```

The DB write is detached via `create_task` (not awaited) so the farmer gets the report immediately. `record_diagnosis` is documented to **never raise** — a DB outage or schema failure logs a warning and is dropped. **Gotcha:** because it's a bare `create_task` with no reference held, a failure inside it that *does* raise would surface only as an "exception never retrieved" warning; the design relies on `record_diagnosis` swallowing its own errors.

### Stage diagram

```
run_diagnosis ── asyncio.wait_for(240s) ──► _run_diagnosis_inner
  │                                              │
  │  PipelineBudget(240s) created                │
  │  tier resolved (fast/best, ALLOW_BEST_TIER)  │
  ▼                                              ▼
[STAGE 1] get_weather_coords (awaited)  ──►  gather(
              │                                  _safe_fetch_weather (Open-Meteo, cached, $0-ish),
              │                                  run_image_quality_agent (Pillow heuristics, $0))
              ▼
[STAGE 2] analyze_weather_risk_rules (rules, $0)  → weather_risk
              ▼
[GATE]   not usable & score<0.4 & no enh_notes ──► _needs_rescan_response ▣ (exit)
              ▼ pass
[STAGE 3] run_disease_diagnosis_agent  (vision, single-model, no fallback)
              │   with_budget(180s, min 10s) → on timeout: _uncertain_fallback
              ▼
          service_unavailable? ──► _service_unavailable_response ▣ (exit)
              ▼
[3.25]   cascade gate: ENABLE_ENSEMBLE & (conf<0.80 | ambiguous)
              │  ↳ ensemble.run_parallel  with_budget(120s, min 20s)
              │  ↳ reconciler.fuse([primary, *ensemble])  (drop Unknown, conf-aware tie-break)
              ▼
         verify_visual_claims (HSV pixel audit, $0) → confidence penalty
              ▼
[3.5]    cross_verify.apply (rules, $0, KB-gated) → adjusted confidence + needs_advisor
              ▼
[STAGE 4] run_treatment_agent  with_budget(90s, min 8s)
              │   on timeout/exhausted: _fallback_treatment (cultural-only) + needs_advisor
              ▼
[STAGE 5] run_report_generator_agent (template, no budget wrap)
              ▼
        aggregate tokens → stamp report.meta (timing, tier, models, ensemble,
                            budget.snapshot, request_id, prompt versions, visual_audit)
              ▼
        create_task(record_diagnosis(...))  ── fire-and-forget, never raises
              ▼
        return report ►
```

### What can go wrong (summary)

- **Wrong micro-location weather** when a district isn't in `_DISTRICT_CENTERS` (falls back to state capital / Nagpur). `coord_source` records this.
- **Weather null** is tolerated everywhere — Stage 2 returns conservative `MODERATE`, Stage 3.5 won't apply contradiction penalties for unknown diseases.
- **The `IMAGE_QUALITY_THRESHOLD = 0.6` constant is imported but unused** in the gate — the effective bar is `usable` (avg ≥ 0.4). Don't tune that env/constant expecting it to change the gate.
- **Diagnose timeout** → `_uncertain_fallback` (caught at stage level, not surfaced as a 240s error). **Provider down** → `service_unavailable` exit (intentional, no weaker-model fallback).
- **Treatment timeout** → cultural-only fallback + advisor flag (graceful), not a hard failure.
- **Persistence is best-effort and detached** — a successful response does not guarantee a persisted row.

---

## Disease Diagnosis Stage — Prompt, Per-Crop Whitelist & Naming

This is the heart of the service: the single LLM call that turns leaf images + farm/weather context into a structured disease diagnosis. It lives in `fastapi/agents/disease_diagnosis_agent.py` and is backed by a versioned prompt (`fastapi/agents/prompts/diagnose.v2.md`, served via `fastapi/agents/prompt_registry.py`) and a small data layer (`fastapi/data/crop_disease_catalog.py`, `crop_disease_whitelist.py`, `disease_synonyms.py`, plus `fastapi/services/input_normalizer.py` and the optional `fastapi/models/local_classifier.py`).

### The naming-mismatch problem this whole stage exists to solve

A vision LLM given only a crop name works in an **open label space**. Three failure modes follow (documented in `crop_disease_whitelist.py` lines 5-19):

1. **Out-of-crop labels** — e.g. asked about Wheat, it answers "Wheat Streak Mosaic" (a real disease, but not in this app's curated set).
2. **Disease invented on healthy tissue**.
3. **Pathogen binomial where a common name is expected** — `"Alternaria solani"` instead of `"Early Blight"`.

Empirically top-3 was good (the right disease was usually in the shortlist) but **top-1 was poor** (mis-ranked / mis-named). The fix is two-pronged and applied at two points: (a) inject a **closed ballot of candidate diseases per crop** into the prompt so the model picks from it; (b) on the way out, **snap the model's label back to the canonical common name** deterministically, even if the model ignored the instruction.

### `run_disease_diagnosis_agent` — end-to-end flow

Signature: `run_disease_diagnosis_agent(images, image_quality, weather_risk, params) -> (diagnosis_dict, token_info)` (line 301).

```
                              run_disease_diagnosis_agent
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ 1. get_feature_config("CROP_DIAGNOSE")  → cfg (model, api_key)             │
  │       └─ no api_key?  → _service_unavailable(...) , empty_token_info        │
  │ 2. read images[:5] → base64 (skip unreadable; none usable → _uncertain)    │
  │ 3. local_classifier.classify(images)  → optional top-3 prior (or None)     │
  │ 4. _build_context(...)  → user prompt text                                 │
  │       └─ _candidate_block(crop) ← candidates_for(crop)   [closed ballot]    │
  │ 5. _diagnose_prompt()  → (system text, meta)  via prompt_registry (v2)      │
  │ 6. loop attempt 1..2  (temp 0.0 then 0.5):                                  │
  │       call_llm_vision(cfg, system, user, images, temp, max_tokens=8192)    │
  │         ├─ raises (503/timeout/...) → _service_unavailable (NO fallback)    │
  │         ├─ _parse_json fails → retry @0.5 (last attempt → _uncertain)       │
  │         ├─ _normalise(result, crop)  → snap + healthy + prob cleanup        │
  │         └─ disease still Unknown/empty → retry (last attempt → return)      │
  │ 7. stamp result["_prompt_meta"] (+ "_local_prior") → return (result, toks)  │
  └──────────────────────────────────────────────────────────────────────────┘
```

#### 1. Single-model resolution (`get_feature_config`)

`cfg = get_feature_config("CROP_DIAGNOSE")` (line 319) reads `AI_CROP_DIAGNOSE_MODEL` / `AI_CROP_DIAGNOSE_API_KEY` from the environment, falling back to the baked-in default `("gemini-2.5-flash", GEMINI_API_KEY)` (`llm_dispatch.py` `_DEFAULTS["CROP_DIAGNOSE"]`, line 73). Note the module docstring header says "Gemini 2.5 Flash" while the `run_*` docstring references `gemini-2.5-pro` as an example — the actual model is whatever the env/default resolves to; treat the docstring crop names as illustrative, not authoritative.

If `cfg.api_key` is empty, the function returns `_service_unavailable(cfg.model, "no API key configured ...")` immediately (lines 320-323) — it does **not** attempt a call.

#### 2-3. Images and the optional local prior

Up to 5 images are base64-encoded via `_read_image_b64` (line 44), which maps the file suffix to a MIME type (`jpg/jpeg/png/webp`, default `image/jpeg`). Unreadable images are logged and skipped; if none are usable **and** there are no `enhancement_notes`, it returns `_uncertain_fallback("No usable images provided")` (line 334).

The local ONNX classifier (see "Optional local prior" below) is consulted defensively: any exception is swallowed (`logger.debug("[LocalCls] not used")`). When it returns predictions they become `local_prior_dicts` and are later threaded into the prompt and stamped on the result as `_local_prior`.

#### 4. `_build_context` and `_candidate_block` — injecting the closed ballot

`_build_context` (line 225) assembles a single plain-text user prompt containing: the candidate block, crop/field facts (`crop_name`, variety, growth stage, soil, irrigation, affected-area %, symptoms, etc.), an optional **farm-history block** (from `params["farm_history"]`), a weather-metrics block (from `params["_raw_weather"]["current"]`), a weather-risk assessment block (from `weather_risk`), image-quality, and the optional local-prior block.

`_candidate_block(crop_name)` (line 200) calls `candidates_for(crop_name)`:
- **Covered crop** → renders a bulleted closed list with the instruction `pick `disease` as a COMMON name from THIS list; binomial goes in scientific_name`.
- **Uncovered crop** (`candidates_for` returns `None`) → emits an **open-vocabulary** note instructing a canonical common plant-pathology name. This is deliberate: an incomplete whitelist must never *narrow falsely*, so unknown crops degrade to the old open behaviour rather than rejecting a valid disease.

It never raises (the import + call are wrapped in `try/except`).

#### 5. Prompt resolution — v2 is the sole production prompt

`_diagnose_prompt()` (line 32) calls `load_prompt("diagnose", bucket_id=user_id_var.get() or None)` and returns `(text, meta)`. `prompt_registry.ACTIVE_VERSIONS["diagnose"] = "v2"` (line 50), so **v2 is served to 100% of live traffic**. `v1.md` remains on disk only for eval replay (loadable by explicit `(name, version)` via the eval harness) and is never served.

The registry supports A/B as a future capability: if the active value were a dict like `{"v1": 0.9, "v2": 0.1}`, `_resolve_version` (line 72) would hash the `bucket_id` (the authenticated `user_id`, or `anon:<name>` for anonymous traffic) into `[0,1)` and route to a weighted slot. Bucketing is **sticky per user** so a farmer never sees a different prompt across retries (avoids "Late Blight on attempt 1, Septoria on attempt 2"). Each prompt carries `{name, version, hash}` (`hash` = first 12 hex of SHA-256 of the file text); this `_prompt_meta` is stamped onto every result (line 428) for replay/audit. Prompts are cached under a lock keyed by `(name, version)`.

The prompt itself (`diagnose.v2.md`) is the "Dr. KrishiGuard" persona with a strict 7-step process (visual → 3-pathologist multi-perspective → pathogen type → weather correlation → contextual validation → top-3 differentials → confidence formula), and three sections that mirror the data layer: **CANDIDATE NARROWING** ("read FIRST … MUST be chosen from that list"), **DISEASE NAMING (STRICT)** (`disease` is a verbatim COMMON name; binomial goes ONLY in `scientific_name`), and **HEALTHY PATH** / **OUT OF DISTRIBUTION**. It ends with a full JSON exemplar (no markdown fences) that defines the expected output shape.

#### 6. The LLM call and retry strategy — single model, NO cross-model fallback

`max_attempts = min(2, MAX_DIAGNOSIS_RETRIES)` → **2** (`MAX_DIAGNOSIS_RETRIES = 3` in config, capped at 2 here). Temperatures are `(0.0, 0.5)`: the primary pass is fully deterministic so repeat scans of the same image are reproducible (this is classification, not creative writing); the 0.5 retry only fires to escape a bad token stream. `call_llm_vision` is invoked with `max_tokens=8192` (4096 truncates the full JSON with 3 differentials).

The two retry-worthy conditions are both **parse/content** failures, not provider failures:
1. `_parse_json(raw)` returns falsy (delegates to `utils.json_extractor.extract_json`) → retry; on the last attempt return `_uncertain_fallback("JSON parse failed after N attempts")`.
2. `primary_diagnosis.disease` is missing / `Unknown` / `UNCERTAIN` / `""` → retry; on the last attempt return the result as-is.

The critical design decision: **a provider/transport exception (503 "high demand", timeout, connection reset, missing key) is caught and immediately returned as `_service_unavailable(cfg.model, ...)`** (lines 433-440) — there is **no switch to a weaker model**. The rationale (lines 309-318, 179-184): silently answering with a fallback model degrades accuracy in a way that's hard to detect; instead the orchestrator surfaces "service temporarily unavailable, please try again." Transient blips are absorbed by **one same-model retry inside the provider layer** (`llm_utils`), not by model-switching here. `_service_unavailable` is distinct from `_uncertain_fallback`: the former carries `service_unavailable: True` and `disease="SERVICE_UNAVAILABLE"` (provider down); the latter carries `disease="UNCERTAIN"` ("we looked and couldn't tell"). Both set `needs_advisor=True` and `confidence_score=0.0`.

Tokens are accumulated across retries into `accumulated_tokens` and returned alongside the result.

#### `_normalise` — the canonical-snap, the soft penalty, and the Healthy path

`_normalise(result, crop_name)` (line 56) is where naming is enforced and the output shape is guaranteed. Key steps:

- **Confidence scaling**: a `confidence_score > 1.0` is treated as a percent (÷100) and clamped to `[0,1]`. `needs_advisor` defaults to `confidence_score < DIAGNOSIS_ESCALATE_BELOW` (0.5); `is_certain` defaults to `>= DIAGNOSIS_CONF_THRESHOLD` (0.7). Many fields are `setdefault`-ed so downstream code can rely on their presence (`differentials`, `causal_factors`, `spread_risk`, `crop_mismatch`, `is_out_of_distribution`, `confidence_penalties`, `is_healthy`, etc.).
- **Per-crop canonical-snap (lines 78-106)**: if `crop_name` is set and the model produced a real `disease`, it calls `snap_to_candidate(crop_name, raw_disease)`. On a canonical match it overwrites `pd["disease"]` with the candidate's COMMON name (this is what turns `"Alternaria solani"` → `"Early Blight"` deterministically — logged as `[Snap] '...' → '...'`) and, if `scientific_name` is empty, backfills it from `canonicalize(snapped)`. **Soft enforcement**: if `candidates_for` returned a list but nothing matched, it does **NOT** hard-force out-of-distribution (the list may be incomplete) — it keeps the model's label and appends a note to `confidence_penalties` (`"predicted '...' not in candidate list for <crop>"`).
- **Healthy path (lines 108-115)**: if `same_disease(pd["disease"], "Healthy")` is true, it forces `disease="Healthy"`, `pathogen_type="none"`, `is_healthy=True`, and empties `differentials`.
- **Primary-diagnosis rebuild** (lines 117-125) into a fixed shape; `needs_advisor` is forced `True` when `crop_mismatch`, `is_out_of_distribution`, or `needs_lab_confirmation` is set.
- **Differential probability cleanup (lines 138-161)**: probabilities `> 1.0` are read as percent; everything is clamped; if `primary + Σ differentials > 1.0`, differentials are scaled down proportionally so the sum reaches 1.0 **without shrinking the primary** (the primary confidence is the canonical "how sure are we" signal the rest of the pipeline keys off, and the `cross_verify` step would otherwise double-count). This matters because `cross_verify` keys off the primary-vs-top-differential gap.

### The data layer

#### `crop_disease_catalog.py` — the CATALOG (~70 crops)

The pure-data half. `CATALOG: dict[str, list[str]]` maps each canonical crop (every entry in `input_normalizer.VALID_CROPS`) to its major leaf/field-diagnosable diseases + key pests as **Title-Case common names**. `"Healthy"` is intentionally **not** listed — the whitelist builder appends it per crop. Lists are bounded to what a vision model can plausibly see in a photo (seed-borne / strictly-root conditions are omitted). Sourced from ICAR/AICRP, CABI, EPPO, and the PlantVillage class set. Adding a disease here is safe and does **not** auto-grant chemical recommendations — that requires a verified entry in `rag.knowledge_base._LABEL_CLAIMS` (otherwise treatment degrades to generic IPM advice).

#### `crop_disease_whitelist.py` — accessors + merge/dedup

This is the logic half; it imports `CATALOG` as its seed and builds `CROP_DISEASES` at import time via `_build_whitelist()` (line 132):
- Seeds from the curated `CATALOG` (verbatim, never deduped against itself).
- **Enriches** from two optional sources, imported defensively: PlantVillage labels (`local_classifier._DEFAULT_LABELS`, e.g. `"Corn - Common rust"` → crop `Maize`, disease `Common Rust`; parenthetical qualifiers are stripped, compound `"a / b"` labels take the last segment) and the registered `(crop, disease)` label-claims registry (`rag.knowledge_base._LABEL_CLAIMS`, only for crops already curated).
- `_add` dedups enrichment entries on exact normalized match **or** same canonical disease, **except** when the shared canonical is a generic "bucket" (`*"unspecified"*` or `*spp.`) — otherwise distinct diseases sharing a generic token (grape "Leaf Blight" vs "Bacterial Leaf Spot") would wrongly collapse.
- Appends `"Healthy"` to every covered crop's ballot.

Public API:
- `candidates_for(crop)` → the common-name list (incl. `"Healthy"`) or `None` if uncovered (caller falls back to open vocabulary).
- `snap_to_candidate(crop, predicted)` → returns a candidate's canonical name **iff** `predicted` matches a candidate by `_norm` equality or `same_disease` (**match-only, never nearest-neighbour**); `None` otherwise. This match-only guarantee is what makes the soft-enforcement design safe.
- `is_covered(crop)` → bool.
- `_canon_crop` resolves any input through a small `_CROP_ALIASES` map (`"corn"→"Maize"`, `"eggplant"→"Brinjal"`, etc.) then `normalize_crop_name`.

#### `input_normalizer.py` — VALID_CROPS + aliases

The authoritative crop list (`VALID_CROPS`, ~70 entries) and `normalize_crop_name` (line 111), which resolves in order: (1) exact `_CROP_ALIASES` lookup (regional/synonym names like `"paddy"→"Rice"`, `"karela"→"Bitter Gourd"`), (2) exact set match, (3) fuzzy match via `difflib.get_close_matches(..., cutoff=0.6)`. Note there are **two separate `_CROP_ALIASES` dicts** — one here (broad, regional Indian names) and a smaller one in `crop_disease_whitelist.py` (mostly to bridge source-vocabulary names like PlantVillage `"corn"`). `clean_farm_context` is the entry-point that merges duplicate Express fields, normalizes crop/soil/irrigation, and estimates growth stage from age.

#### `disease_synonyms.py` — `canonicalize` / `same_disease`

The synonym map that powers the snap. `_SYNONYMS` maps any lowercased label → a canonical name (binomial where available, else a stable common name or a `(unspecified)` / `spp.` bucket). `canonicalize(name)` resolves by (1) exact normalized match, (2) **longest** substring match, (3) fall back to the title-cased input (so unmapped names still flow through and surface in eval reports). `same_disease(a, b)` is true iff both canonicalize to the same value. This is the shared primitive that lets the snap recognise `"Alternaria solani"`, `"Early Blight"`, and `"Tomato Early Blight"` as the same disease, and the same map is what the ensemble **reconciler** and the synonym-aware eval scorer rely on for vote-counting.

#### `local_classifier.py` — optional ONNX prior (tier-zero)

An optional on-prem MobileNetV2/ONNX PlantVillage classifier, **disabled by default**. Enabled by setting `LOCAL_CLASSIFIER_MODEL_PATH` (optionally `LOCAL_CLASSIFIER_LABELS_PATH`, `LOCAL_CLASSIFIER_INPUT_SIZE` default 224). It lazy-loads on first `classify()` call (single attempt — failures are recorded in `_init_error` and not retried), runs inference on the first usable image, and returns a top-3 `[Prediction(label, score)]` or `None` (when deps/model are missing — callers must treat `None` as "feature disabled", not error). When present, `_build_context` injects it as a **soft prior** explicitly labelled "use as one input — do NOT just copy … Override the prior if visual evidence + weather correlation disagree." Its `_DEFAULT_LABELS` (38 classes) also double as an enrichment source for the whitelist builder.

### What can go wrong / gotchas for a new engineer

- **No fallback model by design.** A provider outage yields `service_unavailable` (not a guess). If you "fix" this by adding a fallback model, you reintroduce the silent-quality-degradation problem the design avoids.
- **Snap is match-only and soft.** An incomplete `CATALOG` entry will *not* reject a valid disease — it keeps the model's label and adds a `confidence_penalties` note. If top-1 naming is wrong for a covered crop, the first place to look is whether the disease/synonym exists in `crop_disease_catalog.py` + `disease_synonyms.py`.
- **Two `_CROP_ALIASES` maps** can drift; a crop that resolves in `input_normalizer` may still miss in the whitelist's narrower alias map (it then falls through to `normalize_crop_name`, so usually fine — but worth knowing).
- **Generic-bucket dedup**: when extending the catalog, beware that two real diseases must not collapse via a shared `(unspecified)`/`spp.` canonical — the `_add` guard handles the known cases but new combinations can surprise you.
- **v1 is dead for traffic** but live for eval replay; changing `ACTIVE_VERSIONS["diagnose"]` is the rollback lever (no redeploy needed for prompt text changes — drop a new `.md` and bump the map).
- **Doc/code mismatch**: the agent docstrings name specific Gemini variants; the real model is env-resolved (`AI_CROP_DIAGNOSE_MODEL`, default `gemini-2.5-flash`). Trust `get_feature_config`, not the prose.

---

## Cascade Gate, Ensemble & Reconciliation

This is the **adaptive second opinion** path. The cheap first-pass diagnose call (single model, no fallback — see the diagnose section) handles the easy majority of scans. When that result looks shaky, the orchestrator escalates: it re-asks the *same* question to a small set of frontier models **in parallel**, then a pure function votes the answers into one diagnosis. Two rule-based skeptic stages (`cross_verify`, `visual_verify`) then sanity-check the result against weather and pixels.

Key recent design decisions reflected below:
- The **ensemble uses the registry chain as a concurrent voter set** (every entry runs and votes). **Diagnose does NOT** — it is single-model with no cross-model fallback.
- The reconciler **drops dead `"Unknown"` votes** and uses a **confidence-aware tie-break** (not insertion order).
- `cross_verify` only penalizes a weather contradiction when the disease is actually in the weather KB.

### 1. When/why the orchestrator escalates (the cascade gate)

The gate lives in `fastapi/orchestrator.py` ("STAGE 3.25", around lines 272–325), *after* the cheap diagnose and *before* visual/cross verification. Escalation fires only when **all** of these hold (`orchestrator.py:281–286`):

```python
should_escalate = (
    ENABLE_ENSEMBLE                                   # soft kill-switch
    and (confidence < ENSEMBLE_ESCALATE_BELOW or ambiguous)
    and not diagnosis.get("crop_mismatch")            # wrong-crop image — ensemble won't help
    and not diagnosis.get("is_out_of_distribution")   # not a leaf at all
)
```

- `ENSEMBLE_ESCALATE_BELOW` defaults to **0.80** (`config.py:64`, env-overridable). Because the bar is high, *most* scans escalate by default; lower it to reserve the ensemble for truly hard cases. Tune against `eval/golden_runner.py` top-1.
- `ENABLE_ENSEMBLE` (`config.py:67`) is a kill-switch — set `ENABLE_ENSEMBLE=false` to force every scan single-model (quota incidents, cheap-only baselines).
- `ambiguous` comes from `_is_ambiguous(diagnosis, ENSEMBLE_AMBIGUOUS_DELTA)`: a *tight* primary-vs-top-differential split (small confidence gap **and** the differential's own probability is non-trivial). So a "70% Rust / 68% Blight" result escalates even though 0.70 alone might not.
- `crop_mismatch` / `is_out_of_distribution` short-circuit escalation: if the photo isn't the right crop or isn't a leaf, more models won't fix it (and `cross_verify` already hard-caps those).

A separate **hard stop** runs just before the gate (`orchestrator.py:268–270`): if the cheap diagnose set `service_unavailable` (provider outage, no fallback by design), the orchestrator returns a `_service_unavailable_response` and never reaches the ensemble.

If escalation fires, the orchestrator calls `ensemble_agent.select(crop)` then `run_parallel(...)`, wrapped in `budget.with_budget(..., max_seconds=120.0, stage="ensemble", min_required=20.0)`. On `BudgetExhausted`/`TimeoutError` it logs a degrade and **keeps the primary cheap result** (`orchestrator.py:306–311`). On success it splices the primary in as the first voter: `reconciler.fuse([diagnosis, *ensemble_results])` (`orchestrator.py:313`).

### 2. `ensemble_agent.select` — who votes

`select(crop)` (`agents/ensemble_agent.py:51`) resolves the ordered voter set:
1. `resolve_chain("ensemble", "best")` — tier is **intentionally ignored** (the ensemble always uses its "best" set regardless of any farmer-facing toggle). Today that resolves to **`gemini-2.5-pro` + `claude-sonnet-4-6`** (`registry.py:120–123`).
2. If that chain is empty, it falls back to `resolve_chain("diagnose", "best")` so callers still get *some* fan-out.
3. A crop-specific specialist from `agents/specialists/` is appended if registered and present in `MODEL_CATALOG` (deduped). The reconciler treats it as one more equal voter.

Note the math: the chain has **2** voters, but the orchestrator splices the cheap primary in as voter #1, giving the reconciler **3 votes** (the spec minimum). GPT-4o is a documented TODO — it needs an OpenAI provider wired into `llm_utils`/`router` first (`registry.py:111–119`).

### 3. `run_parallel` — the fan-out and per-member tolerance

`run_parallel(...)` (`agents/ensemble_agent.py:122`) is the concurrency core:

- **Load images once** (`images[:5]`, base64) and share the *same bytes + same prompt* across all members — only the model id differs (`ensemble_agent.py:145–157`). The system prompt comes from `_diagnose_prompt()` (the same diagnose prompt v2 the cheap pass uses) and the user context from `_build_context(...)`. If no image is readable, it returns early with an empty result.
- **Fan out** with `asyncio.gather(*coros)` over `_run_one_model(...)` (`ensemble_agent.py:163–174`). Total latency ≈ the *slowest* model, not the sum.
- **Per-member timeout**: each member is wrapped in `asyncio.wait_for(..., timeout=_PER_MEMBER_TIMEOUT_SECONDS)` = **90s** (`ensemble_agent.py:48, 90–98`). This is nested *inside* the orchestrator's 120s `PipelineBudget`, so one slow model degrades gracefully instead of dragging the whole stage past the gather cap.
- **Per-member fault tolerance**: a member that times out, raises, returns unparseable JSON, or returns an UNCERTAIN/`"Unknown"` primary is logged and simply contributes **no vote** (`ensemble_agent.py:100–118`). `gather` uses `return_exceptions=False`, but every `_run_one_model` catches its own exceptions, so one failure never aborts the others — "if Sonnet 429s, the other two still vote."
- **Stamping**: each usable result gets `result["_model"] = model_id` and `result["_prompt_meta"] = prompt_meta` so the reconciler can attribute votes and (later) apply per-model accuracy weights.
- **Token accounting**: `token_info` is the **sum** across all members (so the orchestrator bills the full ensemble cost), tagged `model = "ensemble(<usable>/<total>)"` (`ensemble_agent.py:182–197`).
- **All-fail path**: if *every* member fails, it returns `[_uncertain_fallback(...)]` plus the token info, so the caller can fall back to the primary cheap result rather than crash (`ensemble_agent.py:198–205`).

### 4. `router.dispatch_one_vision` vs `_run_chain` — why the ensemble bypasses fallback

The router (`agents/router.py`) exposes two relevant entry points:

- **`dispatch_one_vision(...)`** (`router.py:174`) — a **single** vision call, **no chain, no fallback**. This is what the ensemble uses. The rationale (docstring, `router.py:182–189`): a failed ensemble member is *expected* and just means N-1 votes, so router-style fallback would be wrong — it would let a weaker model masquerade as the intended voter. Per-member failures are handled at the `gather` layer instead.
- **`dispatch_vision` / `dispatch_text`** → **`_run_chain(...)`** (`router.py:213`) — the fallback loop used by treatment/chat/alert (and by the seed diagnose chain). It walks `resolve_chain(stage, tier)` left-to-right, accumulating tokens, and only advances to the next model when `_is_transient(exc)` is true.

`_is_transient` (`router.py:58–102`) classifies what's worth a retry: `asyncio`/`httpx` timeouts, HTTP **408/429/500/502/503/504**, provider credential/quota signals (`gemini_reason` in `API_KEY_INVALID`/`QUOTA_EXCEEDED`/…, Anthropic 401/auth errors), our own "rate-limited after 3 retries" `RuntimeError`, and the `"returned empty response"` `ValueError` raised inside `_run_chain` (a safety-filter trip or refusal — the next member may still answer). **Permanent** errors (bad schema, config bugs) are *not* transient and are re-raised immediately so the pipeline fails fast.

One provider nuance shared by both paths, in `_call_one_vision` (`router.py:107–133`): Anthropic models get `max_tokens=8192` (Haiku/Sonnet over-run 4096 mid-JSON on the ~8K-char diagnose prompt and produce truncated, unparseable output), while Gemini uses 4096.

### 5. `registry.STAGE_TIER_CHAINS` — the data behind the dispatch

`agents/registry.py` is the single source of truth: `MODEL_CATALOG` (id → provider, capabilities, api_key, display, tier_hint) and `STAGE_TIER_CHAINS` (stage → tier → ordered model list). `resolve_chain(stage, tier)` (`registry.py:179`) filters a chain to entries that (a) exist in the catalog, (b) have an API key set, and (c) satisfy `STAGE_REQUIRED_CAPABILITIES` (diagnose + ensemble both require `"vision"`), honoring `*_CHAIN` env overrides.

The crucial semantic difference is documented inline:
- `STAGE_TIER_CHAINS["diagnose"]` (`registry.py:81–90`) — production diagnose uses **flat single-model dispatch** with **no cross-model fallback** by design; a provider outage returns a clear "service unavailable" rather than a weaker model's guess. This chain is retained **only as a seed** for `ensemble_agent.select` when the ensemble chain is empty.
- `STAGE_TIER_CHAINS["ensemble"]` (`registry.py:106–123`) — **not a fallback chain**; every entry **runs concurrently and votes**. Tier is ignored (always treated as "best").

### 6. `reconciler.fuse` — the vote → fuse flow

`reconciler.fuse(results, *, accuracy_weights=None)` (`agents/reconciler.py:134`) is a **pure function** — no I/O, no LLM. It takes the ordered list `[primary_cheap, gemini_pro, claude_sonnet, …]` and produces one diagnosis dict in the same shape `disease_diagnosis_agent` emits, plus ensemble metadata. Guard cases first: results without a `primary_diagnosis` are dropped; zero results → `_empty_fallback()`; a single result is returned as-is but stamped `ensemble_used=False` so `cross_verify` doesn't apply the agreement floor to it (`reconciler.py:156–171`).

**Step 1 — Canonicalize** (`reconciler.py:175–176`). Every primary disease name is run through `data.disease_synonyms.canonicalize`. Without this, "Brown Rust" vs "Puccinia triticina" would read as disagreement. Differentials are canonicalized similarly.

**Step 2 — Vote (confidence-aware; dead Unknown votes dropped)** (`reconciler.py:178–204`):
- A failed/uncertain member canonicalizes to `"Unknown"`. Those are **dropped from the tally** whenever ≥1 real diagnosis exists (`live = [...] if name and name != "Unknown"`). This is the recent fix: a 503'd / failed primary can no longer win the vote and sink a recoverable scan to "Unknown" via the old insertion-order tie-break. If *every* member is Unknown → `_empty_fallback()`.
- `votes = Counter(...)`, `top_count = max(votes.values())`, and the agreement string is `f"{top_count}/{n}"` where `n = len(live)`.
- **Tie-break**: among names sharing `top_count`, pick the one with the **highest mean voter confidence** (`-_name_conf(nm)`), with ascending name as the final deterministic key — explicitly *not* insertion order (`reconciler.py:189–198`).

**Step 3 — Fuse confidence** (`reconciler.py:206–225`):
- Base = weighted mean of the *winners'* `confidence_score`, weighted by `accuracy_weights.get(model_id, 1.0)` (the Phase-8 per-model accuracy hook; missing → 1.0 / equal weight).
- Then an **agreement bonus / disagreement penalty**:
  - Unanimous (`top_count == n`): `+0.05` (cap 1.0).
  - Majority (`top_count >= max(2, (n+1)//2)`): `+0.02`.
  - Plurality-only / all-disagree: confidence **capped at 0.55**.

**Step 4 — Safety-biased flag merge** (`reconciler.py:227–253`):
- `needs_lab_confirmation` = OR of all members' flags **OR** (no majority winner).
- `is_out_of_distribution`, `crop_mismatch` = OR-merged across all results.
- `severity` = **most conservative** (`max` over `_sev_rank`), so treatment never under-reacts when one model said "Mild" and another "Severe".
- `pathogen_type` = winner's, falling back to a majority vote if the winner's is `"unknown"`.
- `visual_evidence` = de-duped phrases concatenated from the winners.

It also merges `differentials` (losers' primaries become contenders, plus everyone's own differentials, de-duped by canonical name, top 5 by probability), `causal_factors` (`_merged_causal_factors`, first-seen order), `spread_risk` (`_worst_spread` — highest level, with synonym/compound handling so freeform labels like "MODERATE-HIGH" never crash `index()`), and `weather_correlation` (majority vote, ties favor `PARTIAL`). Output adds `ensemble_agreement`, `ensemble_voters`, `ensemble_models`, `ensemble_used=True`, and forwards `_visual_audit` / `_prompt_meta` from whichever winner had them.

```
            cheap diagnose (single model, no fallback)
                       │  confidence, primary_diagnosis
                       ▼
        ┌─ Cascade gate (orchestrator STAGE 3.25) ──────────────┐
        │ escalate IF ENABLE_ENSEMBLE AND                        │
        │   (conf < ENSEMBLE_ESCALATE_BELOW=0.80 OR ambiguous)   │
        │   AND not crop_mismatch AND not OOD                    │
        └───────────────┬───────────────────────────────────────┘
            no │                       │ yes
               │           ensemble_agent.select(crop)
               │              → [gemini-2.5-pro, claude-sonnet-4-6 (+specialist)]
               │                       │
               │      run_parallel: asyncio.gather, 90s/member, faults tolerated
               │           dispatch_one_vision (NO fallback)  ┄┄ vs _run_chain (treatment etc.)
               │                       │  usable results only
               ▼                       ▼
         primary spliced in:  reconciler.fuse([primary, *ensemble_results])
               │   1 canonicalize → 2 vote (drop Unknown, conf-aware tie-break)
               │   3 fuse conf (+0.05/+0.02 or cap 0.55) → 4 safety flag merge
               └───────────────┬───────────────────────────────┘
                               ▼
                visual_verify.verify_visual_claims (HSV pixel check) → _visual_audit
                               ▼
                cross_verify.apply (weather + image-quality penalties, capped)
                               ▼
                       final diagnosis → treatment / report
```

### 7. `cross_verify.apply` — rule-based skeptic (confidence caps + penalties)

`safety/cross_verify.apply(diagnosis, weather_risk, image_quality, *, weather_kb_has_disease=None)` (`safety/cross_verify.py:38`) returns `(diagnosis, confidence)`. It layers two kinds of adjustment:

**Hard caps** (upper-bound resets, applied unconditionally):
- `is_out_of_distribution` → cap **0.45**.
- `perspective_agreement == "0/3"` and conf > 0.55 → reset to **0.55**.
- `crop_mismatch` → cap **0.30**.

**Soft penalty stack** (each appends a human-readable reason to `confidence_penalties`):
- **Weather CONTRADICTS**: `-0.06` — **only if** the disease is actually in the weather KB (`weather_kb_has_disease`, the §6.5 fix). If not in the KB, the penalty is *skipped* and a note explains why (the KB only knows ~12 generic diseases, so penalizing absences punished correct crop-specific calls).
- Not in the weather-favorable list (and CONTRADICTS + in KB + `weather_used`): `-0.02`.
- **Ambiguous pair**: `-0.04` when `|primary_conf - top_diff_prob| < 0.10` and `top_diff_prob > 0.25`.
- **Poor image quality** (`quality_score < 0.5`): linear ramp `(0.5 - score) * 0.24` (0.5→0, 0.0→0.12).
- `needs_lab_confirmation`: `-0.04`.
- **Visual audit** (`_visual_audit.score_penalty`): the HSV penalty, **halved** before applying (color buckets are coarse).

The summed soft penalty is then **capped**: `MAX_CROSS_VERIFY_PENALTY = 0.20`, dropping to `MAX_PENALTY_WITH_AGREEMENT = 0.10` when `ensemble_agreement` ≥ 2/3 (independent corroboration outweighs any single soft signal). Finally it clamps to `[0,1]`, writes back `confidence_score` + `primary_diagnosis.confidence`, sets `needs_advisor` if below `DIAGNOSIS_ESCALATE_BELOW` (0.5), and stamps a `confidence_tier` (HIGH ≥0.85 / MEDIUM ≥0.70 / LOW ≥0.50 / VERY_LOW).

### 8. `visual_verify.verify_visual_claims` — HSV pixel check

`safety/visual_verify.verify_visual_claims(diagnosis, images)` (`safety/visual_verify.py:133`) is a **$0 anti-hallucination check** (Pillow only; returns `{"available": False}` if PIL is missing or no images). The LLM's color/symptom phrases are the most fabricable part of its output, so this verifies them against the actual pixels.

Flow: `_extract_claims` scans the primary description, `visual_symptoms_detected`, and `visual_evidence` text for keywords mapped to **7 HSV color buckets** (yellow, orange, red, brown, white, black, purple — `_CLAIM_KEYWORDS`/`_COLORS`). It builds an HSV histogram of the **first usable image only** (`_histogram`: EXIF-transpose, thumbnail to ≤384px, sample ~4000 pixels — multi-image aggregation would dilute small lesions). Each claimed color is then classified by its pixel fraction:
- ≥ **0.5%** (`_VERIFIED_FRACTION`) → **verified**.
- < **0.1%** (`_FALSIFIED_FRACTION`) → **falsified** (likely hallucinated).
- in between → **unverified** (ambiguous — treated as a soft signal, never a veto; conservative by design).

`score_penalty = min(0.10, 0.04 * len(falsified))`. The orchestrator stamps the whole result onto `diagnosis["_visual_audit"]` (`orchestrator.py:332–333`), and `cross_verify` consumes `score_penalty` (halving it). It never changes the diagnosis directly.

### What can go wrong / gotchas

- **`perspective_agreement` vs `ensemble_agreement` key mismatch.** `cross_verify` reads the `"0/3"` hard cap from `diagnosis["perspective_agreement"]` (`cross_verify.py:72–75`), but the reconciler writes `ensemble_agreement` (and reads `ensemble_agreement` for the penalty-cap tightening, `cross_verify.py:156`). The `"0/3"` hard cap therefore only fires if something *else* populates `perspective_agreement` — the reconciler does not. Worth verifying whether this cap is reachable on the ensemble path.
- **High default escalation rate.** With `ENSEMBLE_ESCALATE_BELOW=0.80`, most scans escalate → higher cost/latency. The 120s pipeline budget + 90s/member timeout bound it, but degraded budget silently falls back to the cheap result.
- **All-members-fail.** `run_parallel` returns an uncertain shell; `fuse` then drops it as an Unknown vote (or hits `_empty_fallback`). The scan surfaces as low-confidence/needs-advisor rather than erroring — correct, but easy to misread as a model bug.
- **Color buckets are coarse.** `visual_verify` deliberately favors false-negatives (miss a color) over false-positives, and `cross_verify` halves its penalty — so "falsified" claims are a nudge, not a veto. Don't expect it to catch subtle hallucinations.
- **Accuracy weights are a stub today.** `fuse(..., accuracy_weights=...)` exists but the orchestrator calls `reconciler.fuse([diagnosis, *ensemble_results])` with no weights, so all voters (including a crop specialist) are weighted 1.0 until the Phase-8 feedback loop wires in per-model accuracy.

---

## Treatment, RAG Grounding & Safety/Compliance

This stage turns a confirmed diagnosis into an actionable IPM (Integrated Pest Management) plan — chemical sprays, biologicals, cultural practices, fertilizer, rotation — and then hard-gates that plan through a deterministic safety layer before it can reach a farmer. The core design principle, stated verbatim in `fastapi/safety/policy.py`, is: *"Wrong pesticide on the wrong disease is the worst farmer-harm outcome we ship."* Everything here is built to make that outcome impossible by default and only allow chemical advice when several independent checks all pass.

### End-to-end data flow

```
diagnosis dict ──► run_treatment_agent (agents/treatment_agent.py)
   │                     │
   │   (1) HARD GATE: Unknown/UNCERTAIN, conf < DIAGNOSIS_ESCALATE_BELOW (0.50),
   │       is_out_of_distribution, or crop_mismatch  ──► _fallback_treatment() ──► RETURN (no LLM)
   │
   ├─(2) zone = zone_for(state, district)            [data/agro_zones.py]
   ├─(3) grounding = rag_retrieve(disease, crop, zone)[rag/knowledge_base.py]
   │         └─ actives (label-claim filtered) + cultural + ETL + MRL + regulatory notes
   ├─(4) cache_key = md5(disease+crop+soil+irrigation+severity+stage+tier+grounding)
   │         └─ Redis 7-day  OR  in-memory LRU(500, 24h)   ──► HIT? return cached (already sanitized)
   ├─(5) build prompt w/ grounding_block (HARD CONSTRAINTS) ──► call_llm_text (SINGLE model, max_tokens=8192)
   ├─(6) _finalise(): unwrap nested schema + setdefault all canonical keys
   └─(7) validate_treatment(...)  [safety/validator.py]
            ├─ policy gate (strip ALL chemicals if disallowed)  [safety/policy.py]
            ├─ organic-state strip (Sikkim)
            ├─ per-chemical: banned → state-ban → off-label → registry-resolve → PHI/REI clamp → bee-toxic
            └─ stamp treatment["_safety"] = {blockers, warnings, registry_version}
                  │
                  ▼  cache + return SANITIZED dict (never the raw LLM output)
            build_compliance_audit(...)  [safety/compliance.py]  ── consumed by report annex
```

### `treatment_agent.py` — orchestration and graceful degradation

`run_treatment_agent(diagnosis, weather_risk, params)` (`fastapi/agents/treatment_agent.py:177`) is the single entry point and returns `(treatment_dict, token_info)`.

**The hard gate (lines 191-202).** Before any LLM runs, four conditions short-circuit to `_fallback_treatment()`: disease name is `"Unknown"`/`"UNCERTAIN"`, `confidence_score < DIAGNOSIS_ESCALATE_BELOW` (0.50, imported from `config`), `is_out_of_distribution`, or `crop_mismatch`. This is deliberately the same threshold as the orchestrator's `needs_advisor` logic — the code comment warns the two must stay in sync. `_fallback_treatment(disease_name)` (line 152) returns a cultural-only plan: isolate plants, remove infected parts, consult the local KVK (Krishi Vigyan Kendra), with `chemical_controls: []` and a `relevance_score` of 0.3. So an uncertain diagnosis never produces a confident-sounding pesticide pick.

**Single-model dispatch, no fallback.** The model comes from `get_feature_config("CROP_TREATMENT")` (`AI_CROP_TREATMENT_MODEL` in `.env`). There is exactly one model — `tier` (default `"fast"`) is retained only as a cache-key salt for backward compat, not to pick a model. If `cfg.api_key` is unset (line 422) or the LLM call raises (line 463), the agent logs and returns `_fallback_treatment()`. This mirrors the diagnose stage's single-model design: no cross-model fallback, degrade cleanly rather than silently switch providers.

**Caching.** `_get_cache_key()` (line 62) builds a deterministic MD5 over disease, crop, soil, irrigation, bucketed severity (`_bucket_severity` collapses "Moderate"/"medium" etc. into mild/moderate/severe so cosmetic LLM wording doesn't cause cache misses), growth stage, `tier`, **and** a grounding signature (zone + sorted active names). Grounding is in the key by design: the same disease in two agro-zones gets different RAG payloads and must not share a cache slot. Redis (`localhost:6379`, 7-day TTL) is primary; if unavailable at import time it silently falls back to an in-memory LRU (500 entries, 24h TTL). Critically, the code caches the **sanitized** validator output, not the raw LLM output (line 453) — otherwise "every cache hit poisons the next request."

**Schema unwrap (`_finalise`, line 345).** Some models (Claude especially) wrap the response in `{"treatment_plan": {...}, "recommendations": {...}}` despite the prompt asking for a flat object. If none of the 13 `CANONICAL_KEYS` are at top level, the code walks up to 4 levels deep and lifts canonical keys to the top, then `setdefault`s every expected field so downstream consumers never KeyError. `max_tokens=8192` (not the 4096 default) because plans routinely run 3-4K output tokens and truncation would drop the whole JSON at the parse step.

### `rag/knowledge_base.py` — structured grounding (not vector RAG)

`retrieve(disease, crop, zone)` (line 242) returns the source-of-truth dict the treatment prompt forces the LLM to recommend from. The module's docstring explains the design choice: the failure mode here is *hallucinated dosage/registration claims*, not "couldn't recall a document," so a structured KB keyed on `(disease, crop, zone)` is a hard constraint the LLM can't drift past. Embedding-based RAG is noted as a future enhancement.

The payload composes five resolvers:

- **`actives`** via `_resolve_actives(crop, disease)` (line 196). Keyed on the `_LABEL_CLAIMS` matrix (line 68) — a lowercased `(crop, disease) -> {allowed active names}` map covering ~20 top crop-disease pairs across wheat, rice, tomato, potato, cotton, grapes (each disease usually listed under both common and scientific names, e.g. `("rice", "blast")` and `("rice", "magnaporthe oryzae")`). Each allowed name is joined to its metadata in `safety.chemicals.REGISTERED_ACTIVES`. **If there is no `_LABEL_CLAIMS` entry, `actives` comes back empty.**
- **`cultural_practices`** via `_resolve_cultural` (line 224) — disease/crop-specific ICAR-style guidance from `_CULTURAL_PRACTICES`, falling back to the generic `_GENERIC_IPM` checklist (line 135: scout twice weekly, field sanitation, certified seed, rotate, avoid overhead irrigation) when there's no specific entry.
- **`etl`** (Economic Threshold Level) via `_resolve_etl` — below this, the prompt tells the LLM "monitor first, don't spray." Sparse; `None` when undefined.
- **`mrl`** via `_resolve_mrl` — FSSAI residue limits (mg/kg) for the recommended actives, for the dispensing-sheet annex.
- **`regulatory_notes`** — the four `_BASE_REGULATORY_NOTES` (licensed dealer + CIB&RC number, bee/bloom avoidance, observe PHI, PPE). When `actives` is empty, a "no chemical registered — cultural/biological only" note is **prepended** (line 261), and the zone note is appended.

In the prompt, the agent renders this into a `grounding_block` (treatment_agent.py:272) with explicit **HARD CONSTRAINTS**: recommend only from the registered list, and "if the registered list is empty, recommend ONLY cultural / biological options." This is the on-ramp for new whitelist diseases.

### Why new whitelist diseases get cultural-only by design

There are two whitelists in this system and they are intentionally decoupled. The diagnose stage can confidently identify any of its ~70 candidate crops/diseases, but the treatment stage will only produce **chemical** advice for a `(crop, disease)` pair that exists in `_LABEL_CLAIMS`. When a newly-whitelisted disease has no `_LABEL_CLAIMS` entry:

1. `_resolve_actives` returns `[]`.
2. The grounding block renders "(no chemical active registered… recommend ONLY cultural/biological)".
3. The LLM produces a cultural/biological plan.
4. Even if the LLM ignores the instruction and emits a chemical anyway, the validator catches it — but note the subtlety below: with no `_LABEL_CLAIMS` entry, `allowed_for_label` is `None`, so the off-label *block* is **skipped** and a leaked chemical instead surfaces as a softer `unverified_active` warning (unless the active is independently banned or unregistered).

This is safe-by-default: a brand-new disease can never accidentally ship an off-label chemical recommendation, because adding it to the diagnose whitelist does nothing to the treatment chemical path until someone explicitly populates `_LABEL_CLAIMS`.

### What to add to give a new disease CHEMICAL recommendations

To promote a `(crop, disease)` pair from cultural-only to chemical-capable, edit `fastapi/rag/knowledge_base.py` (and possibly `fastapi/safety/chemicals.py`):

1. **`_LABEL_CLAIMS[(crop, disease)] = {active, ...}`** — the CIB&RC-registered actives for that crop-pest combination (the load-bearing step; without it, no chemicals). Add both common and scientific disease-name keys, mirroring existing pairs.
2. Ensure every named active exists in **`REGISTERED_ACTIVES`** (`chemicals.py:70`) so it resolves to real FRAC/IRAC group, PHI, REI, and pollinator metadata. If absent, the active still survives as `unverified_active` but the audit downgrades to WARNING.
3. *(Recommended)* add **`_CULTURAL_PRACTICES`**, an **`_ETL`** entry, and **`_FSSAI_MRL`** rows so the grounding is complete rather than relying on generic IPM / null ETL.

### `safety/validator.py` — the deterministic guardrail (block vs warn)

`validate_treatment(treatment, *, diagnosis, params)` (line 77) runs after the LLM and before caching/return. It treats every LLM-emitted chemical as untrusted input and returns a `ValidationResult(sanitized_treatment, blockers, warnings, registry_version)`.

**Step 1 — policy gate (blocks all chemicals).** Calls `allow_chemical_recommendations(diagnosis)` (`safety/policy.py:21`). If `confidence < 0.50`, or `is_out_of_distribution`, or `crop_mismatch`, or `pathogen_type` is `viral` (no curative chemical), `abiotic`, or `nutrient`, it strips `chemical_controls`, `medicine_combinations`, and blanks `rotation_plan`, emitting a `policy_gate` blocker. (In practice the agent's own hard gate already caught most of these pre-LLM, but the validator re-checks because pathogen_type viral/abiotic/nutrient can slip through.) Separately, `is_state_organic(state)` strips all chemicals for Sikkim with an `organic_state` blocker.

**Step 2 — per-chemical (`_validate_chemical`, line 217).** Each surviving chemical runs an ordered chain. **These BLOCK (chemical removed):**
- `banned_chemical` — `is_banned()` against the central `BANNED_ACTIVES` list (substring match on product or active_ingredient).
- `banned_in_state` — `is_banned_in_state()` from `data/state_bans.py`, honoring crop scope (e.g. monocrotophos on cotton in Maharashtra).
- `off_label` — only when `allowed_for_label` is non-`None` (i.e. the pair IS in `_LABEL_CLAIMS`) and the active isn't in the allowed set. Bidirectional substring match so "Mancozeb 75% WP" matches "mancozeb".
- `bee_toxic_during_bloom` — if the crop is flowering and the active is in `_BEE_TOXIC_ACTIVES` (neonicotinoids + certain pyrethroids), it is removed entirely.

**These WARN (chemical kept, flagged):**
- `unverified_active` — `find_active()` couldn't resolve it. Kept, not dropped, because the registry is intentionally incomplete and dropping every unknown would over-block; flagged for human review.
- `missing_dosage` — no `dosage` field.

**Silent corrections (no block, no warn):** PHI and REI are clamped up to registry baselines when the LLM omits or low-balls them (never lowered); missing `frac_irac_group` and `pollinator_safety` are filled from the registry.

`medicine_combinations` components run the same chemical check (Step 3); a combo is dropped only if *all* components are blocked. Step 5 guarantees a cultural/biological fallback remains so the UI never renders an empty plan. Step 6 stamps `treatment["_safety"]` with blockers, warnings, and both registry versions.

### `safety/chemicals.py` and `data/state_bans.py` — the registries

`chemicals.py` is the versioned in-code source of truth (`REGISTRY_VERSION = "2026.05.28-r1"`), deliberately a Python dict for v1 (import-fast, type-checked, clean PR diffs; the docstring notes moving to Postgres past ~200 entries). It holds: `BANNED_ACTIVES` (central bans like monocrotophos, endosulfan, phorate, with scope/since/reason); `REGISTERED_ACTIVES` (the `RegisteredActive` dataclass with canonical name, brand aliases like "tilt"→propiconazole / "confidor"→imidacloprid, FRAC/IRAC group, default PHI/REI, pollinator_safety); and `STATE_LEVEL_BANS` / `FULLY_ORGANIC_STATES`. `find_active()` (line 158) resolves an LLM product string via exact → alias → token-subset → alias-substring matching, returning `None` (→ `unverified_active`) on miss.

`data/state_bans.py` is split out (`REGISTRY_VERSION = "2026.05.28-sb-r1"`) because state bans are larger, more volatile, and often time-bounded/crop-scoped. `is_banned_in_state(active, state, crop)` (line 96) iterates `_STATE_BANS` (a list, since `(state, active)` is many-to-many), respects `crops=()` (all crops) vs a specific tuple, and has a Sikkim catch-all that returns banned for any synthetic active.

### `data/agro_zones.py` — zone resolution

`zone_for(state, district)` (line 120) maps a farmer's location to one of India's 15 ICAR agro-climatic zones, used as the third dimension of the RAG key. Order: district-level override (`_DISTRICT_OVERRIDES`, e.g. Vidarbha districts → Central Plateau, Konkan → West Coast) → state-level default (`_STATE_TO_ZONE`) → fallback `"Central Plateau and Hills"` (a generic interior zone, better than an empty RAG key). Note: at present the `_LABEL_CLAIMS` / cultural / ETL / MRL resolvers in `knowledge_base.py` key only on `(crop, disease)` — the zone is threaded through to the cache key and surfaced to the LLM as context, but does not yet change which actives are returned. The infrastructure is in place for zone-specific guidance; the data isn't differentiated by zone in v1.

### `safety/compliance.py` — the audit (PASSED/WARNING/FAILED/N/A)

`build_compliance_audit(*, diagnosis, treatment, params, validation_meta)` (line 25) reads the `treatment["_safety"]` blockers/warnings the validator stamped and produces up to seven checks for the dispensing-sheet annex, each one of four statuses: **PASSED** (verified), **WARNING** (soft flag), **FAILED** (hard violation), **N/A** (not applicable). The checks: (1) Banned/restricted chemicals, (2) CIB&RC registration, (3) Pollinator safety — note it checks the `bee_toxic_during_bloom` blocker FIRST so a FAILED is reported even when `chemicals == []` because everything was stripped, (4) PHI on every product, (5) FRAC/IRAC rotation stewardship — which correctly compares the code portion ("M03" vs "3" vs "11") rather than the "FRAC" prefix so a diverse rotation isn't mis-read as single-group, (6) Dose present, (7) Confidence/context policy (FAILED on a `policy_gate` block). The returned `summary` counts each status, and `registry_version`/`registry_sources` are stamped for replay against historical decisions.

### What can go wrong / things to watch

- **Threshold drift.** The 0.50 gate lives in three places conceptually: `DIAGNOSIS_ESCALATE_BELOW` (config), the agent's pre-LLM gate, and `CHEMICAL_RECOMMENDATION_MIN_CONFIDENCE` (policy.py aliases the config value). The agent's own comment flags the orchestrator-sync requirement; a divergence would let chemicals through one gate but not another.
- **Cache poisoning is guarded but fragile.** The agent caches the sanitized result; if a future refactor cached the raw LLM output instead, banned actives would be served on every hit. The 7-day Redis TTL also means a registry version bump does **not** invalidate already-cached entries — the cache key has no `registry_version` component.
- **`_LABEL_CLAIMS` is the silent kill-switch for chemicals.** Because off-label checking is skipped when `allowed_for_label is None`, a typo'd or missing pair key doesn't error — it just quietly downgrades to cultural-only (and a leaked chemical becomes a mere warning, not a block). That is safe but can be confusing when debugging "why are there no chemical recommendations."
- **Substring matching can over-match.** `is_banned` and `find_active` use substring/token logic; an unusual product string could in principle match the wrong canonical or ban entry. The bias is conservative (toward blocking), which is the intended direction.
- **Zone is decorative in v1.** Despite being part of the cache key and prompt, zone does not yet differentiate the returned actives/ETL/cultural data. Two zones of the same `(crop, disease)` get identical grounding content but separate cache slots — a future per-zone data expansion is anticipated by the structure but not yet realized.

---

## Report Generation, Persistence & Localisation

This is the final stage of the diagnosis pipeline: take the structured outputs of the upstream agents (`diagnosis`, `treatment`, `weather_risk`, `image_quality`) plus the request `params`, and assemble the single JSON document the mobile app renders. There is **no LLM in this stage** — report generation is a deterministic template (`fastapi/agents/report_generator_agent.py` docstring, lines 1-10: "Template-based (no LLM) — deterministic, instant, $0 cost"). The only network call is an optional, best-effort translation pass via Sarvam.

### Components at a glance

| File | Role | Failure posture |
|---|---|---|
| `fastapi/agents/report_generator_agent.py` | Builds the 4-section report + flat fields + meta; orchestrates localisation | Never the bottleneck; `_to_inr` defends arithmetic from string prices |
| `fastapi/services/state_language.py` | Maps Indian state → ISO 639-1 lang code; native display names | Pure data, returns `"en"` fallback |
| `fastapi/services/sarvam_translator.py` | Translates the 5 native-language blocks via Sarvam API | Never raises — returns English originals on any failure |
| `fastapi/persistence/diagnosis_repo.py` | Write-only audit record of every scan into Postgres | Fire-and-forget — never raises, never blocks a scan |

### Entry point and data flow

`run_report_generator_agent(diagnosis, treatment, weather_risk, image_quality, params)` (lines 1024-1054) is the public async entry. It:

1. Mints `report_id = str(uuid.uuid4())` and `generated_at = datetime.now(timezone.utc).isoformat()` (lines 29-34).
2. Calls `_generate_template_report(...)` (line 896) to build the synchronous body.
3. `await _attach_local_blocks(report, params)` to enrich with native-language strips (line 1047).
4. Returns `(report, empty_token_info("template"))` — the token-info tuple is a `$0` placeholder so the caller's accounting stays uniform with LLM stages.

```
diagnosis ─┐
treatment ─┤
weather   ─┼─► _generate_template_report() ──► section1..4 + flat fields + meta
img_qual  ─┤        (sync, deterministic, $0)
params    ─┘                  │
                              ▼
                  _attach_local_blocks()  ──► report["local_blocks"]
                   (state→lang→Sarvam, best-effort, never raises)
                              │
                              ▼
                    (report, token_info)  ──► caller persists via record_diagnosis()
                                                (fire-and-forget)
```

Note the model name is hard-coded inside `_generate_template_report`: `pipeline_model = "gemini-2.5-flash"` (line 915), surfaced into Section 4 metadata and `meta.model_diagnosis`. This is a static label baked into the report layer, not read from the diagnose stage — worth knowing if/when the diagnose model changes (it must be updated here too).

### The 4-section template report

Each section is built by a dedicated `_build_sectionN_*` helper. All of them read the *upstream agent* shapes — note diagnosis disease fields live under `diagnosis["primary_diagnosis"]["disease"]`, `…["scientific_name"]`, `…["severity"]`, while treatment chemicals live under `treatment["chemical_controls"]` (a list of dicts with `product`, `active_ingredient`, `dosage`, `frac_irac_group`, `brands`, `phi_days`, etc.).

**Section 1 — Farmer Summary** (`_build_section1_farmer_summary`, lines 206-372). What the farmer sees first. Computes:
- a **confidence tier** from `conf_pct` (line 231): `HIGH` ≥85, `MEDIUM` ≥70, `LOW` ≥50, else `VERY_LOW`;
- an **urgency badge** via `_urgency_label(severity, spread_risk, confidence)` (lines 37-49): severe/CRITICAL → "ACT IMMEDIATELY" (24h, `critical`); moderate/HIGH → 48h (`high`); mild/MODERATE → 120h (`moderate`); else "MONITOR CLOSELY" (168h, `low`);
- a **confidence-appropriate `farmer_summary` text** (lines 244-263), with pathogen-specific addenda — viral → "NO curative spray, remove infected plants"; abiotic/nutrient → "not a disease, no pesticide" (lines 266-269);
- a **`weekly_actions` checklist** capped at 5 items (`weekly_actions[:5]`, line 367), each `{day, action, priority}`; the last action is always a "send new leaf photo on <date>" follow-up.

It returns `farmer_details` (crop, variety, farm size, GPS, district, state, **farmer_name / farmer_contact / farm_address** — the contact-threading fields added recently), `disease_detected` (with a `pathogen_label` lookup mapping e.g. `fungal`→"Fungus", `oomycete`→"Oomycete (water mold)", lines 351-356), `urgency`, `farmer_summary`, `weekly_actions`, and `image_quality`.

**Section 2 — Detailed Guidance** (`_build_section2_detailed_guidance`, lines 379-553). The "what/why/how" page:
- `what_is_happening`: plain description + `causes[:4]`;
- `why_now`: **weather metric cards** built from `params["_raw_weather"]["current"]` (temp/humidity/leaf-wetness-from-VPD, lines 405-437), each card flagged `favorable` against thresholds (e.g. temp 15-28°C "ideal for disease", humidity >75%);
- `spray_schedule`: up to 4 chemicals on a Day 0/7/14/21 cadence (line 443) plus an optional biological soil-drench on Day 3, with `quantity_for_farm` estimated by `_estimate_quantity(dose, acres)` (lines 58-76, assumes ~200 L water/acre);
- `safety_checklist` (do/don't lists, including a PHI "wait N days before harvest" line);
- `follow_up` with hard-coded `kisan_call_centre: "1800-180-1551"`.

**Section 3 — Dispensing Sheet** (`_build_section3_dispensing_sheet`, lines 580-737). Dealer-facing. Builds a `products` table (active ingredient, brands, FRAC group, `frac_type` Contact/Systemic/Biological, est. price, pollinator safety), a `total_estimated_cost_inr`, FRAC-group-based `substitutes`, known `incompatibilities` (e.g. Mancozeb+Copper, Trichoderma+fungicide in tank), a `ppe_checklist`, and a `rationale` string. **Pricing is the riskiest arithmetic here** — see `_to_inr` below.

**Section 4 — Annex** (`_build_section4_annex`, lines 744-889). Technical evidence:
- `input_parameters` (echoes params incl. `farmer_name/contact/farm_address/farm_history`);
- `environmental_data` from `_raw_weather`;
- an `evidence_matrix` for primary + up to 3 differentials (vision confidence, env favorability, symptom match, regional signal, fused score — several are *approximations*, e.g. `symptom_match = confidence * 0.95`, line 820, explicitly commented "approximate");
- `compliance_audit` — **real**, via `build_compliance_audit(...)` from `safety/compliance` (lines 846-851), driven by the `treatment["_safety"]` stamp from the validator (PASSED/WARNING/FAILED/N-A, no cosmetic strings);
- `system_metadata` with `version: "2.4.1"`, `diagnosis_model: pipeline_model`, `weather_api: "Open-Meteo (free tier)"`;
- a fixed `disclaimer` (CIB&RC label compliance, KVK escalation).

### Flat-access fields and the meta block

After the 4 sections, `_generate_template_report` (lines 933-1019) assembles the final dict. Besides the four `*_page` keys, it duplicates key data into **flat fields for backward compatibility / quick access** (line 952 comment): `farm` (= section1's farmer_details), `disease` (= section1's disease_detected, so `report["disease"]["name_common"]` is the canonical disease accessor used by logging and persistence), `causes`, a flattened `treatment` dict, an `action_card` (one-liner + top-3 actions + follow_up_days + emergency contact), `next_steps`, `advisor_needed`, `weather_outlook`, `farmer_summary`, `confidence_score`, `risk_level`, `image_quality`.

The `meta` block (lines 996-1018) carries pipeline provenance: `report_id`, `model_diagnosis`, `needs_advisor`, `needs_lab_confirmation`, `pathogen_type`, `perspective_agreement`, `confidence_tier`, `confidence_penalties`, `differentials`, `look_alikes_ruled_out`, `crop_mismatch`, `is_out_of_distribution`, and a nested `safety` block (registry_version + blockers + warnings) mirrored to the top level so the app can render one "Safety" badge without parsing the annex (line 1011 comment). `_template: True` flags this as the deterministic path.

> Caveat for the persistence layer: `_summary_row` (in `diagnosis_repo.py`) reads several `meta` keys that the report generator does **not** set on the `_template` path — `meta.request_id`, `meta.tier`, `meta.image_quality_score`, `meta.model_diagnose` / `model_treatment`, `meta.prompts`, `meta.escalated`, `meta.pipeline_seconds`, `meta.pipeline_token_usage`. These must be stamped onto `report["meta"]` by the *caller/orchestrator* between report generation and persistence; the template itself uses different key names (e.g. `model_diagnosis`, not `model_diagnose`). If the orchestrator doesn't add them, those columns persist as `NULL`/`0`. This is worth verifying against the orchestrator code — it's not visible in these four files.

### Native-language blocks (localisation)

`_attach_local_blocks(report, params)` (lines 164-199) attaches `report["local_blocks"]`. Target language resolution priority (line 177-178): explicit `params["language"]` → `lang_for_state(params["state"])` → `"en"`.

- `lang_for_state` (`state_language.py`, lines 80-88) is a case-insensitive, whitespace-tolerant lookup over `STATE_TO_LANG` (the Hindi belt, west/south/east mappings; NE states and islands default to `"en"`). It is a hand-maintained port of `frontend/src/i18n/stateMappings.js` — the two **must stay in sync** (module docstring, lines 1-7).
- If the target is `"en"` or Sarvam can't serve it, `local_blocks` is attached with `blocks={}` (lines 180-186) — the frontend still learns the targeted `language` / `language_name` (`lang_display_name`, e.g. `"mr"`→`"मराठी"`) so it can render an English-only strip.

Otherwise it composes 5 short English summaries via `_build_english_local_blocks` (lines 81-161) — keys `summary`, `diagnosis`, `treatment`, `prognosis`, `follow_up` — built entirely from already-structured fields (no LLM). **Pesticide trade names, FRAC codes, and chemical actives are deliberately left in English** (lines 86-89: "a translated brand name is dangerous" — regulatory/safety). These go to `translate_blocks(source_blocks, target)`.

`sarvam_translator.py`:
- `supported(lang)` (line 54) = lang is in `_SARVAM_LANG_TAG` and ≠ `"en"`. The tag map (lines 31-43) covers hi/mr/ta/te/kn/ml/bn/gu/pa/or, each → a `*-IN` BCP-47 tag (note `or`→`"od-IN"`). **Assamese `"as"` is intentionally absent** — a state mapped to `as` falls through untranslated (comment lines 28-30).
- `translate_blocks` (lines 96-137) translates each value concurrently via `asyncio.gather`, hitting a process-local FIFO `OrderedDict` cache keyed by `(text, target_lang)`, capped at `_CACHE_MAX_ENTRIES = 2000` (lines 46-69). Expected >80% hit rate in steady state (docstring lines 10-16) because disease names and labels repeat.
- `_translate_one` (lines 71-93) POSTs to `https://api.sarvam.ai/translate` with header `api-subscription-key: SARVAM_API_KEY`, body `{input, source_language_code, target_language_code, mode:"formal"}`, 15s timeout, and raises on empty `translated_text`.
- **Every failure mode returns originals**: missing `SARVAM_API_KEY` (line 111), unsupported lang (line 114), or a per-block exception (lines 130-132). It never raises.

Back in `_attach_local_blocks` (lines 194-199), if *all* translated values equal their originals (Sarvam down / key missing / nothing translated), it treats the set as `untranslated` and stores `blocks={}` so the frontend hides the native strip rather than showing duplicated English. So `local_blocks` is one of:
```jsonc
{ "language": "mr", "language_name": "मराठी", "blocks": {} }            // EN target, unsupported lang, or all-untranslated
{ "language": "mr", "language_name": "मराठी",
  "blocks": { "summary": "...", "diagnosis": "...", "treatment": "...",
              "prognosis": "...", "follow_up": "..." } }               // success
```

**What can go wrong here:** a state mapped to `"as"`, or a typo'd state name, silently yields an empty native strip; Sarvam latency adds up to 15s per uncached block (mitigated by concurrency + cache, but a cold cache with all 5 blocks new means one round-trip, not 5× serial); and because brand/FRAC strings stay English by design, a fully-translated paragraph will still contain English chemical tokens — that is intentional, not a bug.

### Persistence (`diagnosis_repo.py`)

A **write-only audit trail** of every pipeline run. Public API: `record_diagnosis(*, params, images, report)` (lines 232-293) — **fire-and-forget, never raises** (docstring line 238: "DB outage must not break a scan"). The whole body is wrapped in `try/except Exception` that logs and continues (lines 291-293).

- Gated by env `DIAGNOSIS_PERSISTENCE_ENABLED` (default true; set to `"false"` to disable, line 29-31).
- `_ensure_schema()` (lines 104-124) is idempotent and lock-guarded (`_init_lock` + `_initialised` flag): `CREATE TABLE IF NOT EXISTS ai_scan_diagnoses` plus a sibling `ai_scan_feedback` table, plus indexes. If `get_shared_pool()` returns `None`, it returns `False` and the write is skipped.
- **Schema** (`_CREATE_SQL`, lines 34-68): wide scalar columns for high-value query keys (`crop_name`, `state`, `district`, `growth_stage`, `farm_size_acres NUMERIC`, `tier`, `image_hashes TEXT[]`, `image_quality`, `weather_used/risk`, `primary_disease`, `pathogen_type`, `confidence NUMERIC`, `confidence_tier`, `escalated`, `needs_lab`, `model_diagnose/treatment`, `prompt_*_hash`, `registry_version`, `safety_blockers/warnings INT`, `pipeline_seconds`, `total_tokens`, `cost_usd`) plus a `payload JSONB` holding the full report. Rationale (docstring lines 5-14): columns let you run analytics ("avg confidence on Tomato in Maharashtra last week") without parsing JSON, while JSONB keeps the shape flexible.
- Indexes (lines 70-75): `(created_at DESC)`, `(crop_name, created_at DESC)`, partial `(escalated) WHERE escalated=TRUE`, `(user_id, created_at DESC)` — "never add indexes without a query that needs them" (line 14).
- `_summary_row` (lines 184-222) pulls scalars from `report["meta"]`, `report["disease"]`, `report["weather_outlook"]` and `params`. `_maybe_num` (lines 225-229) defensively coerces to float-or-`None`. `image_hashes` (lines 169-181) is SHA-256 of file bytes truncated to 16 hex per image, to detect duplicate submissions without storing bytes (`"err"` on read failure).
- The INSERT (lines 253-286) writes 29 positional params; `payload = json.dumps(report, default=str)` serialises the whole report (line 249) cast `$29::jsonb`.

There is also `record_feedback(...)` (lines 127-164) for `POST /ai/scan/{report_id}/feedback`, writing into `ai_scan_feedback (report_id, user_id, was_correct, actual_disease, notes)`. Unlike `record_diagnosis`, it **returns a bool** (True on write, False if disabled/pool-down) so the route can surface a 503 for client retry — but it still never raises. Per the schema comment (lines 78-82), feedback joins back on `ai_scan_diagnoses.request_id`, so the orchestrator must stamp the report's canonical id as `meta.request_id` for the join to work.

### Report JSON shape (what the mobile app consumes)

Top-level keys produced by `_generate_template_report` (+ `local_blocks` from `_attach_local_blocks`):

```jsonc
{
  "report_id": "uuid",
  "generated_at": "2026-06-05T...Z",
  "language": "en",                     // = params.language; NOT necessarily the localised target

  "farmer_summary_page":   { "farmer_details": {...}, "disease_detected": {...},
                             "urgency": {"label","hours","level"},
                             "farmer_summary": "...", "weekly_actions": [{day,action,priority}],
                             "image_quality": {"score","usable"} },
  "detailed_guidance_page": { "what_is_happening", "why_now", "spray_schedule",
                              "safety_checklist", "follow_up",
                              "cultural_practices", "preventive_measures",
                              "long_term_recommendations" },
  "dispensing_sheet_page":  { "header", "rationale", "products": [...],
                              "total_estimated_cost_inr", "substitutes",
                              "incompatibilities", "ppe_checklist", "do_not_use" },
  "annex_page":             { "input_parameters", "environmental_data",
                              "evidence_matrix", "look_alikes_ruled_out",
                              "compliance_audit", "compliance_summary",
                              "compliance_registry_version", "safety_blockers",
                              "safety_warnings", "system_metadata", "disclaimer" },

  // FLAT ACCESS (back-compat / quick read)
  "farm": {...}, "disease": { "name_common", "name_scientific", "pathogen_type",
                              "pathogen_label", "confidence_pct", "confidence_tier",
                              "severity", "spread_risk", ... },
  "causes": [...],
  "treatment": { "immediate","chemical","rotation_plan","biological","organic",
                 "cultural","fertilizer","preventive","spray_timing","combinations",
                 "do_not_use","applicator_safety","monitoring_plan" },
  "action_card": { "diagnosis_one_liner","top_3_actions","follow_up_days","emergency_contact" },
  "next_steps": [...],
  "advisor_needed": false,
  "weather_outlook": { "risk","forecast_risk","advisory","risk_factors",
                       "favorable_diseases","soil_risk","weather_used" },
  "farmer_summary": "...",
  "confidence_score": 0.0,
  "risk_level": "UNKNOWN",
  "image_quality": {"score","usable"},

  "meta": { "report_id","model_diagnosis","needs_advisor","needs_lab_confirmation",
            "pathogen_type","perspective_agreement","confidence_tier",
            "confidence_penalties","differentials","look_alikes_ruled_out",
            "crop_mismatch","is_out_of_distribution","confidence_adjusted_note",
            "safety": {"registry_version","blockers","warnings"}, "_template": true },

  "local_blocks": { "language","language_name","blocks": {summary,diagnosis,treatment,prognosis,follow_up} | {} }
}
```

One subtle gotcha for app developers: top-level `"language"` is just `params.language` (defaults `"en"`, line 937) and reflects the *requested* report language, whereas `local_blocks.language` is the *resolved native-strip* language (which may be derived from state even when top-level `language` is `"en"`). Render the native strip off `local_blocks`, not off the top-level field.

### Design rationale (why it's built this way)

- **Template, not LLM**: the report is pure assembly of already-validated structured data, so it is deterministic, instant, and free — and adds no new hallucination surface on top of the (single-model, no-fallback) diagnose stage.
- **Localisation as enrichment**: Sarvam is wrapped so that no translation failure can ever block a report; the worst case is an English-only strip. Brand/FRAC/active names are kept in English on purpose for safety/regulatory reasons.
- **Persistence as fire-and-forget**: an analytics/audit concern is strictly decoupled from the user-facing scan — a DB outage degrades observability, never the farmer's result.

---

## LLM Dispatch, Config, Providers & Observability

This section covers the plumbing that turns "I want feature X to talk to model Y" into an actual HTTP call: the two model-resolution paths, how providers are auto-detected, the per-provider call helpers, the pooled HTTP clients, the env-var/threshold config surface, and the request-scoped logging context.

### Two model-resolution paths

There are **two distinct ways** a request reaches an LLM, and they have deliberately different failure semantics. A new engineer must not confuse them.

**1. Flat per-feature dispatch — `agents/llm_dispatch.py` (NO fallback)**

This is the path used by the **diagnose** and **treatment** steps (and chat/alert/pest). Each AI feature reads exactly **one** model + **one** API key from `.env`, keyed by the feature name:

- `get_feature_config(feature)` (`llm_dispatch.py:154-169`) reads `AI_<FEATURE>_MODEL`, `AI_<FEATURE>_API_KEY`, `AI_<FEATURE>_BASE_URL` from `os.environ`, falling back to the baked-in `_DEFAULTS` (`llm_dispatch.py:70-78`) so a fresh checkout still boots. Recognised features are in `AI_FEATURES` (`llm_dispatch.py:52-59`): `TEXT_CHAT`, `CROP_DIAGNOSE`, `CROP_TREATMENT`, `ALERT`, `PEST`, `VOICE_STT`. An unknown name raises `ValueError`.
- Defaults: `CROP_DIAGNOSE` and `CROP_TREATMENT` default to **`gemini-2.5-flash`** (with `GEMINI_API_KEY`); text features default to **`llama-3.3-70b-versatile`** (Groq).
- `call_llm_text(...)` / `call_llm_vision(...)` (`llm_dispatch.py:174-246`) detect the provider, log `[LLMDispatch] feature=... provider=... model=...`, and forward to the matching helper. **There is no fallback chain** — whatever the provider raised propagates to the caller (`llm_dispatch.py:14-16`). This is the explicit design decision noted in the current architecture: **diagnose is single-model with no cross-model fallback**, so when the chosen provider is down the caller surfaces a clean `service_unavailable` rather than silently degrading to a weaker model (which would make quality impossible to reason about).

**2. The router chain — `agents/router.py` (used by the ensemble)**

The ensemble path resolves models through a **fallback chain** instead. `_run_chain(...)` (`router.py:213-279`) takes a `(stage, tier)`, asks the registry `resolve_chain(...)` for an ordered model list, and walks it **left-to-right**. On a *transient* exception (`_is_transient`, gated on `_TRANSIENT_HTTP_STATUSES = {408, 429, 500, 502, 503, 504}`, `router.py:55`) or an empty response it advances to the next model; on a *permanent* error it re-raises immediately (`router.py:266-269`) rather than burning latency on the rest of the chain. Note `dispatch_vision_single` / `_call_one_vision` (`router.py:175-190`) is the **single-call, no-chain** adapter the ensemble agent fans out in parallel — a failed ensemble member just means N-1 votes for the reconciler, so it deliberately skips chain fallback there.

```
                         ┌─────────────────────────────────────────────┐
 diagnose / treatment ──▶│ llm_dispatch.get_feature_config(FEATURE)      │
   chat / alert / pest   │   AI_<FEATURE>_MODEL  (NO fallback)           │
                         │ call_llm_text / call_llm_vision               │
                         └───────────────────┬──────────────────────────┘
                                             │ _detect_provider(model, base_url)
                                             ▼
 ensemble (parallel) ──▶ router._run_chain(stage,tier) ──▶ resolve_chain ─┐
   per-member single call (dispatch_vision_single)                        │
                                             ┌────────────────────────────┘
                                             ▼
                 ┌────────────┬──────────────────────────┬──────────────────┐
            "claude-*"     "gemini-*"           gpt/o1/o3/llama/mixtral/    base_url
            anthropic       gemini              deepseek/grok → openai_compat  set?
                 ▼              ▼                          ▼                   ▼
       call_claude_*   call_gemini_*    call_openai_compatible_*   openai_compat
       (SDK, get_      (httpx get_      (per-base_url pooled        @ admin URL
        anthropic)      gemini)          httpx client)
```

### Provider auto-detection

Both paths share `_detect_provider(model, base_url)` (`llm_dispatch.py:115-134`). Rules, in priority order:

1. **`base_url` set ⇒ `openai_compatible`** — admin escape hatch; always wins. Works for OpenRouter, private hosting, Ollama, vLLM, etc.
2. model starts with `claude-` ⇒ `anthropic` (native SDK)
3. model starts with `gemini-` ⇒ `gemini` (native REST)
4. any prefix in `_PREFIX_TO_BASE_URL` (`llm_dispatch.py:83-92`) — `gpt-`/`o1-`/`o3-` → OpenAI, `llama-`/`mixtral-`/`whisper-` → Groq, `deepseek-` → DeepSeek, `grok-` → xAI ⇒ `openai_compatible`
5. otherwise ⇒ raises `ConfigError` telling the admin to set `AI_<FEATURE>_BASE_URL`.

`_resolve_base_url(...)` (`llm_dispatch.py:137-149`) then picks the actual endpoint: explicit `base_url` wins, else the prefix table is consulted, else `ConfigError`. **Admins never specify the provider** — they only change the model id (and key); detection is automatic. *Caveat:* detection is purely prefix-based, so a future/renamed model that doesn't match a known prefix will hard-fail unless `base_url` is set.

### Per-provider call helpers — `agents/llm_utils.py`

Every helper returns the uniform shape **`(raw_text, token_info)`**, where `token_info` is built by `_make_token_info` (`llm_utils.py:56-64`): `{model, input_tokens, output_tokens, total_tokens, cost_usd}`. Cost comes from `_calc_cost` against the `_PRICING` table (`llm_utils.py:25-32`, USD per 1K tokens). **Watch-out:** any model missing from `_PRICING` silently costs `$0.00` (the docstring at `llm_utils.py:21-24` calls this out for Claude) — update the table when you change models.

- **`call_gemini_vision` / `call_gemini_text`** (`llm_utils.py:80-265`): native REST to `generativelanguage.googleapis.com/v1beta`. Key is sent as the **`x-goog-api-key` header** (not the query string, to keep it out of proxy logs). For **Flash** models it sets `thinkingConfig.thinkingBudget = 0` via `_gemini_disable_thinking` (`llm_utils.py:67-75`) to cut latency and avoid mid-JSON truncation; **Pro requires thinking** and returns HTTP 400 if you force it off, so the opt-out is Flash-only. Errors go through `_raise_gemini_error` (`llm_utils.py:176-206`), which digs the structured `reason` (e.g. `API_KEY_INVALID`, `QUOTA_EXCEEDED`) out of the body and attaches it as `err.gemini_reason` so router heuristics can classify it.
- **`call_claude_vision` / `call_claude_text`** (`llm_utils.py:453-529`): use the official `AsyncAnthropic` SDK via `get_anthropic()`. The `anthropic_api_key` parameter is **vestigial** (kept for signature symmetry) — the SDK reads the key from the singleton client, not this arg. The SDK handles its own retries + pooling.
- **`call_openai_compatible_text` / `_vision`** (`llm_utils.py:340-438`): one `/chat/completions` call to any OpenAI-shaped endpoint. **No internal retries** — non-2xx raises straight to the admin. Vision encodes images as `data:<mime>;base64,...` data-URLs. These use their own per-`base_url` pooled clients via `_get_openai_compat_client` (`llm_utils.py:324-337`), closed on shutdown by `close_openai_compat_clients` (wired into the lifespan).
- **`call_groq_text`** (`llm_utils.py:270-316`): direct Groq REST, retries up to 3× on 429 with a 10·(n+1)s linear backoff.

### Same-model transient retry — NOT a model fallback

The Gemini helpers retry **the same model once** on a transient status before giving up. In `call_gemini_vision` (`llm_utils.py:139-157`): `_retryable = {429, 500, 502, 503, 504}`; on the first such response it logs a warning, `await asyncio.sleep(2.0)`, and retries once; a second failure calls `_raise_gemini_error`. `call_gemini_text` (`llm_utils.py:242-254`) does the same but only on `429`. **This is a transient burst absorber, not a fallback** — it never switches models. In the flat-dispatch (diagnose/treatment) path, a persistent failure after that single retry simply raises, which the caller turns into `service_unavailable`. In the ensemble/router path, the raise is what lets `_run_chain` advance to the next model. The intent (documented at `llm_utils.py:130-138`) is to keep the internal retry cheap (~2s) so the pipeline budget isn't burned before the router can fail over.

### Pooled HTTP / SDK clients — `services/http_clients.py`

Opening a fresh `httpx.AsyncClient` per LLM call would waste a TLS handshake (~50-200ms) and exhaust ephemeral ports under burst. This module keeps **one long-lived client per upstream**, created lazily:

- `get_gemini()` — read timeout **120s** (vision needs the budget; text callers pass a shorter `timeout=` per request, e.g. 90s).
- `get_groq()` — read timeout **90s**.
- `get_sarvam()` — read timeout **15s** (Indic translation, short calls).
- `get_anthropic()` — singleton `AsyncAnthropic(api_key=ANTHROPIC_API_KEY, timeout=60.0, max_retries=2)`; the SDK manages its own connection pool, so it's not an `httpx` client. **Note:** Anthropic's key comes from `config.ANTHROPIC_API_KEY` baked into the singleton, *not* from the per-feature `AI_<FEATURE>_API_KEY` — the `api_key` passed to `call_claude_*` is ignored.

All httpx clients use `_make_client` (`http_clients.py:28-41`): `connect=5s, write=30s, pool=5s`, `max_connections=100`, `max_keepalive_connections=20`, `keepalive_expiry=30s`. `close_all()` (`http_clients.py:83-97`) must run from the FastAPI lifespan shutdown to flush connections on redeploy.

### Config & thresholds — `config.py`

`config.py` loads `.env` from the `fastapi/` dir first, then the project root (`override=False`, so dir wins). Provider keys: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `SARVAM_API_KEY` (`config.py:15-24`). Key knobs a new engineer will actually touch:

- **Tier control:** `PIPELINE_DEFAULT_TIER` (default `"fast"`, valid `fast|best`) and `ALLOW_BEST_TIER` (set `false` to coerce every request to `fast` server-side and block premium spend) — `config.py:42-45`.
- **Ensemble gating:** `ENSEMBLE_ESCALATE_BELOW` (default **0.80** — cheap diagnose below this confidence escalates to the ensemble), `ENABLE_ENSEMBLE` (soft kill-switch, default on), `ENSEMBLE_AMBIGUOUS_DELTA` (default **0.10** — escalate when primary vs top-differential is too tight) — `config.py:64-71`.
- **Confidence thresholds:** `IMAGE_QUALITY_THRESHOLD=0.6`, `IMAGE_UNUSABLE_THRESHOLD=0.4`, `DIAGNOSIS_CONF_THRESHOLD=0.7`, `DIAGNOSIS_ESCALATE_BELOW=0.5`, `TREATMENT_REL_THRESHOLD=0.8` (`config.py:52-56`).
- **Service:** `CROPGUARD_HOST` (default `0.0.0.0`), `CROPGUARD_PORT` (default `8001`).

**Important staleness note:** the `MODEL_*` constants (`config.py:32-36`) are explicitly documented (`config.py:27-31`) as **legacy / non-pipeline only**. The live disease-detection routing lives in `agents/registry.py` (`STAGE_TIER_CHAINS`) for the ensemble path and in `AI_<FEATURE>_MODEL` env vars for the flat-dispatch path. Do not reference the `MODEL_*` constants from the scan/diagnose/treatment flow.

### Observability — `observability/logging.py` (+ `logging_config.py` shim)

Per-request context is carried via **contextvars** so any `logger.info()` inside a deep async stage is auto-tagged without threading params through every signature. The four vars (`observability/logging.py:28-31`): `request_id_var`, `user_id_var`, `tier_var`, `stage_var`.

Where they're set (confirmed in code):
- **`main.py:146-161`** — the `_request_context_middleware` reads `x-request-id` (or generates one via `new_request_id()`, 16 hex chars) and `x-user-id` from headers, truncates to 64 chars, sets `request_id_var` / `user_id_var`, and echoes `x-request-id` back on the response so the mobile app + Express proxy can correlate end-to-end. The tokens are reset in a `finally`.
- **`agents/orchestrator.py:150`** sets `tier_var`; `request_id_var` is read back into the report meta at `orchestrator.py:470`.
- **`jobs/tasks.py:129-133`** re-establishes `request_id`/`user_id` inside background job workers (which don't go through the HTTP middleware).
- `RequestContext` (`observability/logging.py:38-63`) is a context-manager so scripts/jobs can stamp logs manually.

Output format is chosen by **`LOG_FORMAT`** (`setup_logging`, `observability/logging.py:140-157`): `text` (default, pipe-separated, appends `[rid=...]`) or `json` (one JSON object per line — recommended in prod for Railway/CloudWatch/Loki). `JsonFormatter` (`observability/logging.py:68-119`) always emits `ts, level, logger, msg`, conditionally adds `request_id/user_id/tier/stage` (only when set, to keep logs slim), and merges any `extra={...}` fields the caller passed (serialisability-checked, falling back to `repr`). `LOG_LEVEL` (default `INFO`) sets the root level; `httpx`, `httpcore`, `watchfiles`, and `uvicorn.access` are pinned to `WARNING`. `setup_logging()` is idempotent (clears existing handlers so the chosen format wins on `--reload`) and is called from the lifespan. `logging_config.py` is just a backward-compat shim re-exporting `setup_logging` for root-level/test imports.

---

## Evaluation, Testing & Quality Gates

This service measures two different things with two different toolchains: **accuracy/calibration** (does the pipeline predict the right disease, and is its confidence honest?) via the `eval/` harness, and **correctness invariants** (does the reconciler/diagnose logic do exactly what the design says, regardless of which model is up?) via the `tests/` unit suite. They are complementary — the eval harness costs real money and provider quota and runs against live LLMs; the unit tests are fast, deterministic, and provider-mocked.

```
                         ┌─────────────────────────────────────────────┐
 PlantVillage tree  ───► │ build_golden_set.py                         │
 (~14 crops, color)      │  Crop___Disease folders → manifest.jsonl    │
                         │  (canonical crop + disease, abs img paths)  │
                         └───────────────┬─────────────────────────────┘
                                         ▼ manifest.jsonl
              ┌──────────────────────────┴───────────────────────────┐
              ▼                                                        ▼
   ┌────────────────────┐                              ┌──────────────────────────┐
   │ golden_runner.py   │  full orchestrator           │ load_eval.py             │
   │  vision-regression │  run_diagnosis() per row     │  N concurrent farmers    │
   │  top1/top3/Brier   │  → eval/reports/{sha}_{ts}   │  per-stage tokens+time   │
   └────────────────────┘                              └──────────────────────────┘

   ┌────────────────────┐   replay.py: re-run ONLY the diagnose stage on
   │ persisted scans    │──►  persisted DB rows (text-only; image bytes were
   │ ai_scan_diagnoses  │     never stored) → prompt A/B agreement + cost delta
   └────────────────────┘

   tests/  (pytest, no network):
     test_reconciler.py        vote patterns + dead-Unknown drop + tie-break
     test_diagnose_fallback.py forced 503 → service_unavailable (no silent fallback)
```

### Golden-set construction — `eval/build_golden_set.py`

The golden set is the ground-truth corpus the accuracy runners consume. `_build` (`fastapi/eval/build_golden_set.py:89`) walks a local PlantVillage "color" tree (one folder per `Crop___Disease` class), and for each class:

- `_parse_class` (`:67`) splits `Corn_(maize)___Common_rust_` → `('Maize', 'Common Rust')`: it strips PlantVillage's crop suffixes (`_(maize)`, `_(including_sour)`, `,_bell`), routes the crop through `data.crop_disease_whitelist._canon_crop`, drops parentheticals from the disease, and special-cases `gray leaf spot`. `healthy` folders become disease `"Healthy"`.
- It samples up to `--n-per-class` images per class with a fixed seed (`--seed`, default 7) for reproducibility, and **references images by absolute path** rather than copying them, so the manifest dir stays tiny and gitignore-safe.
- Each row's `params` get a per-crop default agronomic context from `_CONTEXT` (`:55`, e.g. Tomato → Nashik/Drip/Flowering) or `_DEFAULT_CONTEXT` (`:62`), plus `tier: "best"`, `language: "en"`. The `ground_truth.scientific_name` comes from `data.disease_synonyms.canonicalize` (blanked if it just echoes the common name).
- A diagnostic flag per class: `in_list = disease.lower()=="healthy" or snap_to_candidate(crop, disease) is not None` (`:111`). Classes NOT in the per-crop candidate whitelist are printed with `[!] not in candidate list (open-vocab / gap)` — a cheap way to see coverage holes before paying for a run.

Output is `data/golden_set/<out>/manifest.jsonl`, one JSON object per line with keys `id / image_paths / params / ground_truth` — the exact shape both accuracy runners expect.

**Honest scope (stated in the module docstring, `:28`):** PlantVillage only covers ~14 crops (Apple, Corn, Grape, Potato, Tomato, Pepper, …). The many minor Indian crops the whitelist now covers (~70 crops total) have **no public labeled image set**, so their candidate-scoping/treatment behavior is validated by **unit checks, not a measured top-1** here. Do not read the golden-set top-1 as coverage of the whole whitelist.

### Manifest format & scoring helpers — `eval/golden_runner.py`

`golden_runner.py` is the canonical home of the manifest loader and scoring functions that `load_eval.py` also imports.

- `_load_manifest` (`:66`) parses JSONL, skips blank/`#` lines, and hard-fails on malformed JSON or any row missing `id / image_paths / params / ground_truth` (fail-fast so a typo'd manifest never silently shrinks the test set).
- `_resolve_images` (`:86`) resolves relative paths against the manifest dir and shapes them as `[{"path": ..., "type": "leaf"}]` for `orchestrator.run_diagnosis`; a missing file raises `FileNotFoundError` rather than scoring a phantom case.
- **Synonym-aware scoring** is the important design choice. `_top1_match` (`:106`) normalizes both strings, then tries `data.disease_synonyms.same_disease(...)` FIRST — so `"Alternaria solani" == "Early Blight"` and `"Northern Corn Leaf Blight" == "Northern Leaf Blight"` are credited as correct even though the surface strings differ. A raw substring check (`p==t or p in t or t in p`) stays only as a secondary fallback for partial / not-yet-mapped names. Without this, a perfectly correct scientific-name answer would score as a miss and the whole metric would be noise.
- `_top3_match` (`:120`) credits the truth if it matches the primary OR the first two differentials (it tolerates either flat `report["differentials"]` or nested `report["meta"]["differentials"]`, and either `disease`/`name`/`name_common` keys — defensive against report-shape drift).
- `_brier_term` (`:140`) = `(confidence - target)²` with `target = 1` if correct else `0` — the per-row contribution to the calibration (Brier) score, where lower is better.

`golden_runner._run_one` (`:148`) runs the **full** orchestrator per row (cascade → ensemble → RAG → safety), and `_aggregate` (`:186`) emits `top1`, `top3`, `brier`, `mean_confidence`, `escalation_rate`, `ensemble_rate`, `mean_cost_usd`, `mean_latency_s`, plus the sliced `top1_escalated` vs `top1_not_escalated` (a sanity check that escalation is firing on the hard cases, not the easy ones). Reports are written to `eval/reports/{git_sha}_{utc_timestamp}.json`, and with `--baseline <prior_report.json>` it renders a markdown metric-diff table (`_markdown_diff`, `:231`) — this is the **vision-regression gate**: run it on a baseline commit, run it on your branch, diff the metrics. Default concurrency is 2 with an explicit "keep low — each run costs real $" warning (`:343`).

### Concurrent load + detailed eval — `eval/load_eval.py`

`load_eval.py` reuses `golden_runner`'s manifest loader and scoring helpers but exists to surface the per-stage breakdown the orchestrator produces but `golden_runner` discards, and to simulate **N farmers scanning at once**.

- **Concurrency model:** an `asyncio.Semaphore(--concurrency, default 5)` bounds in-flight `run_diagnosis` calls; `_run_one` (`:156`) tracks `_max_active` so the report can show *requested* vs *max observed* concurrency. It also demonstrates a neat logging trick: a `contextvars.ContextVar` `_case_var` is set per case before the call, and because asyncio tasks copy the current context at creation, every sub-task the orchestrator spawns inherits the right case tag, which a `_CaseFilter` (`:52`) stamps onto each log record — so you can watch all N pipelines interleave in the terminal. Noisy SDK/HTTP loggers (`httpx`, `anthropic`, `openai`, `google_genai`, …) are pinned to WARNING (`:71`).
- **Prompt-version pin (eval-only):** if `AI_DIAGNOSE_VERSION` is set (e.g. `v2`), `_main` (`:331`) overrides `prompt_registry.ACTIVE_VERSIONS["diagnose"]` in-process so you can A/B prompt versions deterministically **without touching production weights**. Note: diagnose prompt **v2 is currently the sole prompt**, so this knob is mainly for evaluating a future candidate against it.
- **Metrics extracted per case** (`_extract`, `:78`): per-stage tokens+cost from `report.meta.pipeline_token_usage.agents` for `disease_diagnosis / ensemble / treatment / weather_analysis / report_generator`; per-stage wall time from `report.meta.budget.per_stage_seconds`; confidence, confidence_tier, `top1`/`top3`, differentials, escalation/advisor flags, `ensemble_used`/`ensemble_agreement`/`ensemble_models`, image-quality score, the diagnose/treatment model IDs, the Brier term, latency (`wall_latency`, plus `rel_start`/`rel_end` for the interleave timeline), and report-completeness signals (`report_next_steps`, `report_chemicals`, `report_has_summary`).
- **Aggregate report** (`_aggregate_and_print`, `:193`) prints six blocks: per-case accuracy table; per-stage token/cost breakdown (summed); per-stage mean/max wall-time; efficiency/throughput (parallel speedup = `sum_seq/wall_clock`, scans/min, latency mean/median/min/p95/max, cost-per-scan); accuracy/calibration (top1, top3, Brier, mean confidence, escalation rate, ensemble-fired rate, and synonym/normalized **severity accuracy** via `_norm`); and report-quality averages. Everything is also persisted to `eval/reports/loadtest-{ts}.json` + `.log`.

The split is deliberate: `golden_runner` is the lean pass/fail accuracy gate with baseline-diffing; `load_eval` is the deep diagnostic + throughput profiler.

### Prompt A/B on persisted scans — `eval/replay.py`

`replay.py` re-runs **only the diagnose stage** against historical rows in the `ai_scan_diagnoses` Postgres table (via `db_pool.get_shared_pool`), to compare prompts/models cheaply (treatment + report stages are skipped — `_replay_one`, `:98`, only calls `run_disease_diagnosis_agent`). The `_QUERY` (`:63`) pulls recent rows filtered by `--since` / `--crop`, capped by `--limit` (default 25).

**Critical limitation, stated in the code (`:108`, `:134`):** the original image **bytes were never persisted** (privacy — only `image_hashes`). So replay passes `images = []`; the diagnose agent therefore runs effectively blind and falls back to its uncertain path for the actual prediction. Replay is **only meaningful for text-only / prompt-level changes** — new context wording, new differential prompts, shaking out JSON parse errors — NOT for vision-regression (that's what `golden_runner` is for). The docstring is explicit about this so nobody mistakes a replay "agreement rate" for an accuracy number.

It loads+verifies the `--candidate-prompt-version` from disk *before* paying for calls (`load_prompt`, `:189`), runs replays under a semaphore (`--concurrency`, default 4), and emits an aggregate (disease agreement rate, mean confidence shift, escalation Δ, cost/latency) plus a per-row CSV at `eval/out/replay-<ts>.csv`. `--dry-run` lists the rows it would replay without spending anything.

### Unit tests — the correctness invariants

**`tests/test_reconciler.py`** — locks down the ensemble fusion contract in `agents/reconciler.fuse` (and the `disease_synonyms` canonicalization it depends on). The canonicalization tests assert rust variants collapse (`"Brown Rust"`, `"Wheat Brown Rust"` → `"Puccinia triticina"`), unmapped names pass through unchanged (so data is never silently dropped), and `same_disease("", ...)` is `False`. The vote-pattern tests cover the three spec cases: unanimous (3/3 → canonical winner + `+0.05` boost + `ensemble_used=True`), majority (2/3 → winner kept, dissenter demoted to a differential), and all-disagree (1/3 → `needs_lab_confirmation` forced, confidence capped at 0.55). Severity fuses to the most conservative voter; the lab flag OR-merges; a single result passes through with `ensemble_used=False`; and empty input returns an honest `Unknown` shell (`needs_advisor=True`) rather than raising.

The most important block is the **tie-break / dead-vote handling** (`:142`), which guards the 503-fallback robustness directly tied to the single-model design below:
- `test_failed_primary_does_not_sink_a_real_ensemble_vote` (`:144`): a 503'd primary (`Unknown@0.0`) must NOT win against a real ensemble vote. The reconciler now **drops dead `Unknown` votes** before tallying (`agents/reconciler.py:178-184`), so the real `Late Blight` (canonicalized to `Phytophthora infestans`) wins. The comment notes the *old* insertion-order tie-break did exactly the wrong thing — turning a recoverable scan into a terminal `Unknown`.
- `test_two_real_tie_resolves_to_higher_confidence` (`:155`): a 1–1 tie resolves to the **more-confident** voter deterministically (`reconciler.py:190-198`, sort key `(-confidence, name)`), not insertion order — so `Early Blight@0.90` beats `Late Blight@0.60`.
- `test_all_members_unknown_returns_shell` (`:164`): if *every* live vote is Unknown/Uncertain, the honest `Unknown` shell with `needs_advisor` is preserved (don't fabricate a winner from nothing).

**`tests/test_diagnose_fallback.py`** — encodes the single-model, no-cross-model-fallback policy. The diagnose stage runs ONE model (`AI_CROP_DIAGNOSE_MODEL`); the test docstring states the rationale: silently answering with a weaker model when the primary is down degrades accuracy in a way that's hard to detect/maintain. Both tests monkeypatch `get_feature_config` and `call_llm_vision` (no network, no keys needed):
- `test_provider_down_returns_service_unavailable_not_a_fallback` (`:46`): `call_llm_vision` raises an `httpx.HTTPStatusError` 503 "high demand"; the result must be `service_unavailable=True`, `primary_diagnosis.disease == "SERVICE_UNAVAILABLE"`, `needs_advisor=True` — a clear "retry" signal, **not** a misleading `Unknown` and **not** a weaker model's guess.
- `test_provider_ok_returns_real_diagnosis` (`:60`): valid JSON → normal `Late Blight` diagnosis, no service flag, and `tok["model"] == "gemini-2.5-pro"`.

### What can go wrong / gotchas

- **Cost & quota:** `golden_runner`, `load_eval`, and `replay` all hit live LLMs. Concurrency defaults are conservative for a reason; a large manifest × `--tier best` burns real money and provider quota. There is no built-in spend cap in these scripts.
- **`replay` is not accuracy:** because image bytes aren't stored, replay agreement rates only reflect text-only prompt effects. Treating them as a vision accuracy number is the most likely misuse.
- **Coverage blind spot:** golden-set top-1 only spans ~14 PlantVillage crops; the ~70-crop whitelist's minor crops are covered by unit checks only. A green golden-set run does NOT prove minor-crop accuracy.
- **Eval depends on synonym tables:** if a model returns a correct-but-unmapped disease label, `_top1_match` falls back to substring matching and may under-credit it. Keeping `data/disease_synonyms` current is what keeps the metric honest.
- **`replay` needs `DATABASE_URL`:** `_fetch_rows` (`:75`) raises if the shared pool is unavailable. The golden/load runners need a valid PlantVillage path and resolvable image files or they fail-fast.
- **Severity accuracy is normalized-string-only** in `load_eval` (`_norm` equality, `:276`) — it is NOT synonym-aware the way disease matching is, so a label like "High" vs "Severe" would score as a mismatch unless the models/labels already agree.

---

## Glossary

| Term | Meaning |
|---|---|
| **tier** | Farmer-facing `"fast"`/`"best"` toggle. Resolved by `normalize_tier`; `ALLOW_BEST_TIER` is the ops kill-switch. Diagnosis quality is the same across tiers by design. |
| **candidate list / whitelist** | The set of diseases (+ "Healthy") plausible for a given crop, injected into the diagnosis prompt and used to constrain/snap the answer. Source: `data/crop_disease_catalog.py`. |
| **snap (`snap_to_candidate`)** | Map a model-returned disease name to the crop's canonical **common** name iff it canonically matches a candidate (match-only, never nearest-neighbour). |
| **canonicalize / `same_disease`** | `data/disease_synonyms.py` — collapses synonyms/binomials to one canonical name so "Alternaria solani" == "Early Blight". Used by snapping, the reconciler, and eval scoring. |
| **OOD (out-of-distribution)** | The model flags `is_out_of_distribution` when the image isn't a plant or matches none of the crop's candidates → confidence is capped and `needs_advisor` set. |
| **ensemble** | The conditional multi-model fan-out (Gemini Pro + Claude Sonnet) for low-confidence/ambiguous cases. Members run in parallel and vote. |
| **reconciler (`fuse`)** | Combines the primary + ensemble votes: canonicalizes, drops dead "Unknown" votes, confidence-aware tie-break, fuses confidence, merges safety flags. |
| **cross-verify** | Rule-based ($0) confidence adjustment: caps for OOD/crop-mismatch, penalties for weather contradiction, poor image quality, ambiguity, lab-confirmation. |
| **`_LABEL_CLAIMS`** | `rag/knowledge_base.py` — the (crop, disease) → registered active-ingredients matrix. The hard gate for *chemical* recommendations. |
| **`_GENERIC_IPM`** | Fallback cultural practices returned when a (crop, disease) pair has no registry entry → graceful cultural/biological-only treatment. |
| **`service_unavailable`** | Diagnosis-stage flag set when the model provider is down. Orchestrator returns a clear "temporarily unavailable, retry" report — never a weaker-model guess. |
| **idempotency key** | `idem:scan:hdr:<key>` or `idem:scan:body:<sha256>` — dedupes retries so a double-tap doesn't double-spend. |
| **golden set** | Labeled images (`data/golden_set/batch*/manifest.jsonl`) used to measure accuracy. Built from PlantVillage via `eval/build_golden_set.py`. |
| **top-1 / top-3 / Brier** | Eval metrics: primary-correct rate / truth-in-shortlist rate / confidence-calibration error. |

## File Map

| Area | Key files |
|---|---|
| **Routes / intake** | `fastapi/routes/scan.py`, `fastapi/main.py`, `fastapi/routes/{chat,alerts,agripredict,feedback}.py` |
| **Async jobs** | `fastapi/jobs/queue.py`, `fastapi/jobs/tasks.py` |
| **Security** | `fastapi/security/auth.py` (HMAC), `fastapi/security/spend.py` (cap), `fastapi/services/idempotency.py` |
| **Orchestration** | `fastapi/orchestrator.py`, `fastapi/pipeline/budget.py` |
| **Diagnosis** | `fastapi/agents/disease_diagnosis_agent.py`, `fastapi/agents/prompt_registry.py`, `fastapi/agents/prompts/diagnose.v2.md` |
| **Crop/disease data** | `fastapi/data/crop_disease_catalog.py`, `fastapi/data/crop_disease_whitelist.py`, `fastapi/data/disease_synonyms.py`, `fastapi/services/input_normalizer.py` |
| **Ensemble / reconcile** | `fastapi/agents/ensemble_agent.py`, `fastapi/agents/router.py`, `fastapi/agents/registry.py`, `fastapi/agents/reconciler.py` |
| **Verification** | `fastapi/safety/cross_verify.py`, `fastapi/safety/visual_verify.py` |
| **Treatment / safety** | `fastapi/agents/treatment_agent.py`, `fastapi/rag/knowledge_base.py`, `fastapi/safety/{chemicals,validator,compliance}.py`, `fastapi/data/{state_bans,agro_zones}.py` |
| **Report / i18n / persist** | `fastapi/agents/report_generator_agent.py`, `fastapi/services/{sarvam_translator,state_language}.py`, `fastapi/persistence/diagnosis_repo.py` |
| **LLM / config / obs** | `fastapi/agents/{llm_dispatch,llm_utils}.py`, `fastapi/services/http_clients.py`, `fastapi/config.py`, `fastapi/observability/logging.py` |
| **Weather** | `fastapi/weather_service.py`, `fastapi/services/weather_rules.py`, `fastapi/services/district_coords.py` |
| **Eval / tests** | `fastapi/eval/{load_eval,golden_runner,build_golden_set,replay}.py`, `fastapi/tests/` |

---

*Generated for the CropSetu team. Keep this doc in sync when you change the diagnosis path, the whitelist, or the safety gates.*
