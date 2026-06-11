"""
Auth — CropGuard

The FastAPI service sits behind an Express proxy in normal operation,
but on Railway it has a public URL anyone can curl. Without a shared
secret between Express and FastAPI, an attacker can hit /ai/scan
directly and burn LLM spend.

Solution
  Express signs every request to FastAPI with an HMAC over the request
  method + path + body + a short timestamp. FastAPI verifies the signature
  on every protected endpoint (currently /ai/scan). Replay window is
  60 seconds — long enough for a real proxy hop, short enough that a
  leaked signature can't be replayed all day.

Configuration
  AI_SHARED_SECRET   — the HMAC key (both services must share)
  AI_AUTH_REQUIRED   — "true" (default) | "false" (dev/local bypass)
  AI_AUTH_SKEW_SEC   — replay window in seconds (default 15)

Header contract
  X-Sig-Timestamp: <unix epoch seconds>
  X-Sig-Signature: hex(HMAC-SHA256(secret, f"{ts}.{method}.{path}.{body_sha256}"))

Replay protection (AISVC-11)
  The skew window is tight (15s). On top of that, each verified signature is
  recorded in Redis for the length of the window; a second request reusing the
  same signature within the window is rejected as a replay. Fails open only when
  Redis is unavailable (the short window still bounds the exposure).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time

from fastapi import Header, HTTPException, Request

logger = logging.getLogger(__name__)

# Read auth config LAZILY (at request time), NOT at module import. main.py
# imports security.auth (line ~40) BEFORE config.py (line ~41) runs load_dotenv,
# so capturing the secret at import time read an EMPTY string on local .env-based
# runs → every signed request 503'd with auth_misconfigured. Production injects
# env at process start so it was masked there. Lazy reads fix both.
def _secret() -> str:
    return os.environ.get("AI_SHARED_SECRET", "")


def _required() -> bool:
    return os.environ.get("AI_AUTH_REQUIRED", "true").strip().lower() != "false"


def _skew() -> int:
    # 30s default (was 15): Express and FastAPI run as separate Railway services
    # whose clocks can drift a few seconds; a 15s window risked 401-ing EVERY
    # signed request (total AI outage) on minor NTP skew. 30s stays tight and the
    # single-use replay nonce still bounds reuse. Override via AI_AUTH_SKEW_SEC.
    try:
        return int(os.environ.get("AI_AUTH_SKEW_SEC", "30"))
    except ValueError:
        return 30

# ── Replay-nonce cache (Redis) ───────────────────────────────────────────────
# Keyed by the signature itself (unique per request). SET NX with TTL = skew
# window means a replayed signature within the window collides and is rejected.
_REDIS_URL = (os.environ.get("RATE_LIMIT_STORAGE_URI")
              or os.environ.get("REDIS_URL", "")).strip()
_nonce_redis = None
try:
    if _REDIS_URL:
        import redis as _redis_lib
        _nonce_redis = _redis_lib.Redis.from_url(_REDIS_URL, socket_connect_timeout=2)
        _nonce_redis.ping()
        logger.info("[Auth] replay-nonce cache bound to Redis")
except Exception:  # noqa: BLE001
    _nonce_redis = None
    logger.warning("[Auth] Redis unavailable — replay-nonce cache disabled (skew window still applies)")


def _is_replay(signature: str) -> bool:
    """True if this signature was already seen within the skew window."""
    if _nonce_redis is None:
        return False
    try:
        # set returns True if the key was created, None/False if it already
        # existed → a replay. TTL bounds memory to the active window.
        created = _nonce_redis.set(f"sig:{signature}", "1", nx=True, ex=max(_skew(), 1))
        return not created
    except Exception:  # noqa: BLE001
        return False  # fail open — the tight skew window still limits replay


def _compute(body_sha256_hex: str, ts: str, method: str, path: str) -> str:
    msg = f"{ts}.{method.upper()}.{path}.{body_sha256_hex}".encode("utf-8")
    return hmac.new(_secret().encode("utf-8"), msg, hashlib.sha256).hexdigest()


async def verify_signed_request(
    request: Request,
    x_sig_timestamp: str | None = Header(default=None),
    x_sig_signature: str | None = Header(default=None),
) -> None:
    """FastAPI dependency. Raises 401 if the signature is missing/invalid.
    Use it on the expensive endpoints — not on /health."""
    if not _required():
        return  # explicit opt-out (dev / local testing only)
    if not _secret():
        # Hard fail rather than allowing everything through. A "production"
        # config with auth required but no secret is almost certainly a
        # misconfiguration we want to scream about, not silently accept.
        logger.error("[Auth] AI_AUTH_REQUIRED=true but AI_SHARED_SECRET is empty")
        raise HTTPException(status_code=503, detail="auth_misconfigured")

    if not x_sig_timestamp or not x_sig_signature:
        raise HTTPException(status_code=401, detail="missing_signature")

    # 1. Reject replays / clock skew
    try:
        ts = int(x_sig_timestamp)
    except ValueError:
        raise HTTPException(status_code=401, detail="bad_timestamp")
    if abs(time.time() - ts) > _skew():
        raise HTTPException(status_code=401, detail="stale_signature")

    # 2. Compute the expected signature. We need the raw body for the
    #    hash; cache it on request.state so downstream handlers don't
    #    re-read (FastAPI is happy to read body twice but it's wasteful).
    body = await request.body()
    body_sha = hashlib.sha256(body).hexdigest()
    expected = _compute(body_sha, x_sig_timestamp, request.method, request.url.path)

    if not hmac.compare_digest(expected, x_sig_signature):
        raise HTTPException(status_code=401, detail="bad_signature")

    # 3. Replay protection — a signature is single-use within the skew window.
    #    Only enforced for state-changing methods: GET/HEAD are idempotent (the
    #    mobile client polls GET /ai/scan/{id} many times a second with the same
    #    ts→same signature, which is benign), so a nonce there would false-block.
    if request.method.upper() not in ("GET", "HEAD", "OPTIONS") and _is_replay(x_sig_signature):
        logger.warning("[Auth] replayed signature rejected")
        raise HTTPException(status_code=401, detail="replayed_signature")

    # 4. Cache the parsed body for the route handler so it does not need
    #    to re-read the stream. Routes can do `body = await request.body()`
    #    safely either way — Starlette caches internally — but exposing it
    #    here makes the path explicit.
    request.state.signed_body = body
