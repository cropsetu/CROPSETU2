"""
CropGuard Agentic AI — FastAPI service
Exposes all AI endpoints that Express proxies to.

Endpoints:
  POST /ai/chat                              — FarmMind chat (Gemini)
  POST /ai/scan                              — Crop disease (agentic Gemini pipeline)
  POST /ai/alerts                            — Smart farm alerts
  POST /api/v1/crop-disease/agentic-predict  — Direct multipart endpoint (Postman / testing)
  GET  /health                               — Health check

Run:
  cd AI_CROP_DISESE_DETECTION
  .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""
from __future__ import annotations
import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from logging_config import setup_logging
setup_logging()

from observability.logging import (
    new_request_id,
    request_id_var,
    tier_var,
    user_id_var,
)
from security.pii import install as _install_pii_filter
_install_pii_filter()  # idempotent — must run AFTER setup_logging
from security.auth import verify_signed_request
from config import API_HOST, API_PORT, DATABASE_URL
from rate_limit import make_limiter
from db_pool import get_shared_pool, close_shared_pool
from services.http_clients import close_all as close_http_clients
from routes.chat            import router as chat_router
from routes.scan            import router as scan_router
from routes.soil_ocr        import router as soil_ocr_router
from routes.feedback        import router as feedback_router
from routes.alerts          import router as alerts_router
from routes.agripredict     import router as agripredict_router

logger = logging.getLogger(__name__)

# ── Rate limiter ──────────────────────────────────────────────────────────────

def _rate_key(request: Request) -> str:
    """
    Rate-limit by user-id when Express forwards it (ai.routes.js sets
    `x-user-id`); fall back to remote IP otherwise. Carrier NAT means
    many users share one IP, so per-user is fairer for authenticated
    traffic.
    """
    uid = request.headers.get("x-user-id")
    if uid:
        return f"u:{uid}"
    return f"ip:{get_remote_address(request)}"


limiter = make_limiter(_rate_key, default_limits=["60/minute"])

# ── Lifespan (replaces deprecated @app.on_event) ─────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    keys = {
        "GEMINI_API_KEY":    os.getenv("GEMINI_API_KEY"),
        "SARVAM_API_KEY":    os.getenv("SARVAM_API_KEY"),
        "DATA_GOV_API_KEY":  os.getenv("DATA_GOV_API_KEY"),
        "DATABASE_URL":      os.getenv("DATABASE_URL"),
    }
    for name, val in keys.items():
        if not val:
            logger.warning("[Config] %s not set — feature will be disabled", name)
        else:
            logger.info("[Config] %s configured", name)

    # CFG-4: fail FAST in production on missing critical config instead of
    # limping along with empty-string defaults that fail silently at runtime.
    if IS_PROD:
        required = {
            "GEMINI_API_KEY":   os.getenv("GEMINI_API_KEY"),
            "AI_SHARED_SECRET": os.getenv("AI_SHARED_SECRET"),
            "DATABASE_URL":     os.getenv("DATABASE_URL"),
        }
        missing = [k for k, v in required.items() if not (v or "").strip()]
        if missing:
            raise RuntimeError(
                f"[Config] FATAL: missing required production config: {', '.join(missing)}"
            )

    # Test DB connectivity at startup using the shared pool
    if DATABASE_URL:
        try:
            pool = await get_shared_pool()
            async with pool.acquire() as conn:
                ver = await conn.fetchval("SELECT version()")
            logger.info("[Config] PostgreSQL OK — %s", ver[:60])
        except Exception as exc:
            logger.error("[Config] PostgreSQL UNREACHABLE — %s", exc)
            logger.error("[Config] AgriPredict features will return errors until DB is fixed")

    # Boot-time integrity invariants — surface config/data problems LOUDLY at
    # startup instead of silently at runtime (silent kill-switch, $0 pricing,
    # dead 0/3 cap, alias drift). Fail-closed in prod; WARN-only in dev.
    try:
        from safety.invariants import assert_boot_invariants
        assert_boot_invariants(fail_closed=IS_PROD)
    except RuntimeError:
        raise  # prod: refuse to start with critical integrity violations
    except Exception as exc:  # noqa: BLE001
        logger.error("[Invariant] boot check errored (non-fatal): %s", exc)

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    await close_http_clients()
    await close_shared_pool()

# ── App ───────────────────────────────────────────────────────────────────────

IS_PROD = os.getenv("NODE_ENV", os.getenv("ENV", "development")) == "production"


def _validate_origins(raw: str) -> list[str]:
    """Validate AI_ALLOWED_ORIGINS at startup (AISVC-10).

    Reject '*' (incompatible with allow_credentials=True anyway) and any entry
    that isn't a well-formed http(s):// origin. In production a bad value fails
    boot loudly; in dev we drop the bad entries and warn.
    """
    import re as _re
    origins = [o.strip() for o in (raw or "").split(",") if o.strip()]
    bad = [o for o in origins if o == "*" or not _re.match(r"^https?://[^\s/]+", o)]
    if bad:
        msg = (f"[CORS] invalid AI_ALLOWED_ORIGINS entries {bad!r} — "
               f"must be http(s):// origins, '*' is not allowed with credentials")
        if IS_PROD:
            raise RuntimeError(msg)
        logger.warning("%s — dropping them (dev only)", msg)
        origins = [o for o in origins if o not in bad]
    return origins or ["http://localhost:3000"]


ALLOWED_ORIGINS = _validate_origins(os.getenv(
    "AI_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://localhost:5173"
))

# Max request body (AISVC-12). Generous enough for a base64 leaf photo (8 MB raw
# ≈ 11 MB base64) plus JSON envelope; oversized bodies are rejected with 413.
try:
    _MAX_BODY_BYTES = int(os.getenv("AI_MAX_BODY_BYTES", str(12 * 1024 * 1024)))
except ValueError:
    _MAX_BODY_BYTES = 12 * 1024 * 1024

app = FastAPI(
    title="CropGuard Agentic AI",
    description=(
        "FarmEasy AI backend — agentic crop disease pipeline, FarmMind chat, "
        "smart alerts, and weather-aware diagnosis. Powered by Google Gemini."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url=None if IS_PROD else "/docs",
    redoc_url=None if IS_PROD else "/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# Without this middleware the per-route @limiter.limit decorators (and the
# default 60/min cap) never actually fire — SlowAPI configuration alone
# does not throttle anything.
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "x-user-id", "x-request-id", "idempotency-key"],
    expose_headers=["x-request-id"],
)


# ── Request body-size guard (AISVC-12) ───────────────────────────────────────
# Reject oversized POST bodies early (before they're buffered into memory or
# reach the LLM token meter) with 413. Uses Content-Length when present; for
# chunked uploads with no length header we let it through to the per-image size
# checks downstream.
@app.middleware("http")
async def _body_size_guard(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH"):
        cl = request.headers.get("content-length")
        if cl:
            try:
                if int(cl) > _MAX_BODY_BYTES:
                    return JSONResponse(
                        {"success": False, "error": "request body too large"},
                        status_code=413,
                    )
            except ValueError:
                pass
    return await call_next(request)


# ── Request context middleware ───────────────────────────────────────────────
# Stamps a request_id (from x-request-id if Express set one, else generated)
# and user_id (from x-user-id) into contextvars so every log line during the
# request carries them. Also echoes x-request-id on the response so the
# mobile app + Express proxy can correlate end-to-end.
@app.middleware("http")
async def _request_context_middleware(request: Request, call_next):
    incoming = request.headers.get("x-request-id")
    rid = (incoming or new_request_id())[:64]
    uid = (request.headers.get("x-user-id") or "")[:64]

    rid_tok = request_id_var.set(rid)
    uid_tok = user_id_var.set(uid) if uid else None
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(rid_tok)
        if uid_tok is not None:
            user_id_var.reset(uid_tok)
    response.headers["x-request-id"] = rid
    return response

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(chat_router)             # POST /ai/chat
app.include_router(scan_router)             # POST /ai/scan  +  GET /ai/scan/{job_id}
app.include_router(soil_ocr_router)         # POST /ai/soil-card-ocr
app.include_router(feedback_router)         # POST /ai/scan/{report_id}/feedback
app.include_router(alerts_router)           # POST /ai/alerts
app.include_router(agripredict_router)      # /agripredict/*

# ── Health ────────────────────────────────────────────────────────────────────
# Public /health is a minimal liveness probe — status only, no internal version
# or build details (AISVC-8). The fingerprint-rich diagnostic payload moves to
# /health/details behind the signed-request dependency so only the Express
# gateway (not an anonymous scanner) can read versions/chains/invariants.

async def _db_ok() -> bool:
    try:
        pool = await get_shared_pool()
        if pool:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            return True
    except Exception:
        pass
    return False


@app.get("/health", tags=["System"])
async def health():
    """Minimal public liveness — no internal version/build info leaked."""
    from safety.invariants import check_invariants, CRITICAL
    db_ok = await _db_ok()
    crit = [i for i in check_invariants() if i["severity"] == CRITICAL]
    return {
        "status":  "ok" if (db_ok and not crit) else "degraded",
        "service": "CropGuard AI",
    }


@app.get("/health/details", tags=["System"], dependencies=[Depends(verify_signed_request)])
async def health_details():
    """Detailed diagnostics for ops — gated behind the signed Express secret.
    Surfaces local-classifier, prompt registry, model chains, and registry
    versions so ops can confirm what's actually running."""
    db_ok = await _db_ok()
    # Lazy imports — keep the hot public path light.
    from agents.prompt_registry import all_active as _prompts
    from agents.router import describe_chains as _chains
    from models.local_classifier import status as _local_status
    from safety.chemicals import REGISTRY_VERSION as _chem_version
    from safety.invariants import check_invariants, CRITICAL
    _issues = check_invariants()
    _crit = [i for i in _issues if i["severity"] == CRITICAL]
    try:
        from data.state_bans import REGISTRY_VERSION as _sb_version
    except Exception:
        _sb_version = "unknown"
    try:
        from data.crop_disease_whitelist import WHITELIST_VERSION as _wl_version
    except Exception:
        _wl_version = "unknown"
    return {
        "status":   "ok" if (db_ok and not _crit) else "degraded",
        "service":  "CropGuard AI",
        "database": "connected" if db_ok else "unreachable",
        "prompts":           _prompts(),
        "chains_fast":       _chains("fast"),
        "chains_best":       _chains("best"),
        "local_classifier":  _local_status(),
        "chemical_registry": _chem_version,
        "versions": {
            "chemical_registry": _chem_version,
            "state_bans":        _sb_version,
            "whitelist":         _wl_version,
        },
        "invariants": {
            "ok":       not _crit,
            "critical": len(_crit),
            "warnings": len(_issues) - len(_crit),
            "issues":   _issues,
        },
    }


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=API_HOST, port=API_PORT, reload=True)
