"""
CropGuard Agentic AI — FastAPI service
Exposes all AI endpoints that Express proxies to.

Endpoints:
  POST /ai/chat                              — FarmMind chat (Groq → Gemini)
  POST /ai/scan                              — Crop disease (5-agent Claude pipeline)
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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from logging_config import setup_logging
setup_logging()

from config import API_HOST, API_PORT, DATABASE_URL
from db_pool import get_shared_pool, close_shared_pool
from routes.chat            import router as chat_router
from routes.scan            import router as scan_router
from routes.alerts          import router as alerts_router
from routes.agripredict     import router as agripredict_router
from routes.pest_prediction import router as pest_prediction_router

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


limiter = Limiter(key_func=_rate_key, default_limits=["60/minute"])

# ── Lifespan (replaces deprecated @app.on_event) ─────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    keys = {
        "GEMINI_API_KEY":    os.getenv("GEMINI_API_KEY"),
        "GROQ_API_KEY":      os.getenv("GROQ_API_KEY"),
        "DATA_GOV_API_KEY":  os.getenv("DATA_GOV_API_KEY"),
        "DATABASE_URL":      os.getenv("DATABASE_URL"),
    }
    for name, val in keys.items():
        if not val:
            logger.warning("[Config] %s not set — feature will be disabled", name)
        else:
            logger.info("[Config] %s configured", name)

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

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    await close_shared_pool()

# ── App ───────────────────────────────────────────────────────────────────────

IS_PROD = os.getenv("NODE_ENV", os.getenv("ENV", "development")) == "production"

ALLOWED_ORIGINS = os.getenv(
    "AI_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://localhost:5173"
).split(",")

app = FastAPI(
    title="CropGuard Agentic AI",
    description=(
        "FarmEasy AI backend — 5-agent crop disease pipeline (Claude), "
        "FarmMind chat (Groq → Gemini), smart alerts, and weather-aware diagnosis."
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
    allow_headers=["Content-Type", "Authorization", "x-user-id", "x-request-id"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(chat_router)             # POST /ai/chat
app.include_router(scan_router)             # POST /ai/scan  +  POST /api/v1/crop-disease/agentic-predict
app.include_router(alerts_router)           # POST /ai/alerts
app.include_router(agripredict_router)      # /agripredict/*
app.include_router(pest_prediction_router)  # /pest/predict  +  /pest/detect-image

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
async def health():
    """Reuses the shared connection pool — no new connection per health check."""
    db_ok = False
    try:
        pool = await get_shared_pool()
        if pool:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            db_ok = True
    except Exception:
        pass
    return {
        "status": "ok" if db_ok else "degraded",
        "service": "CropGuard AI",
        "database": "connected" if db_ok else "unreachable",
    }


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=API_HOST, port=API_PORT, reload=True)
