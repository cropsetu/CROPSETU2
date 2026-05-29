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
  AI_AUTH_SKEW_SEC   — replay window in seconds (default 60)

Header contract
  X-Sig-Timestamp: <unix epoch seconds>
  X-Sig-Signature: hex(HMAC-SHA256(secret, f"{ts}.{method}.{path}.{body_sha256}"))
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time

from fastapi import Header, HTTPException, Request

logger = logging.getLogger(__name__)

_SECRET = os.environ.get("AI_SHARED_SECRET", "")
_REQUIRED = os.environ.get("AI_AUTH_REQUIRED", "true").strip().lower() != "false"
try:
    _SKEW = int(os.environ.get("AI_AUTH_SKEW_SEC", "60"))
except ValueError:
    _SKEW = 60


def _compute(body_sha256_hex: str, ts: str, method: str, path: str) -> str:
    msg = f"{ts}.{method.upper()}.{path}.{body_sha256_hex}".encode("utf-8")
    return hmac.new(_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()


async def verify_signed_request(
    request: Request,
    x_sig_timestamp: str | None = Header(default=None),
    x_sig_signature: str | None = Header(default=None),
) -> None:
    """FastAPI dependency. Raises 401 if the signature is missing/invalid.
    Use it on the expensive endpoints — not on /health."""
    if not _REQUIRED:
        return  # explicit opt-out (dev / local testing only)
    if not _SECRET:
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
    if abs(time.time() - ts) > _SKEW:
        raise HTTPException(status_code=401, detail="stale_signature")

    # 2. Compute the expected signature. We need the raw body for the
    #    hash; cache it on request.state so downstream handlers don't
    #    re-read (FastAPI is happy to read body twice but it's wasteful).
    body = await request.body()
    body_sha = hashlib.sha256(body).hexdigest()
    expected = _compute(body_sha, x_sig_timestamp, request.method, request.url.path)

    if not hmac.compare_digest(expected, x_sig_signature):
        raise HTTPException(status_code=401, detail="bad_signature")

    # 3. Cache the parsed body for the route handler so it does not need
    #    to re-read the stream. Routes can do `body = await request.body()`
    #    safely either way — Starlette caches internally — but exposing it
    #    here makes the path explicit.
    request.state.signed_body = body
