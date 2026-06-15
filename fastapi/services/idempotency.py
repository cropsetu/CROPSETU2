"""
Idempotency Cache — CropGuard

Prevents duplicate work (and duplicate LLM spend) when a client retries
the same request — typically when the mobile app double-taps "Scan" or
recovers from a network blip.

Resolution order for the cache key:
  1. `Idempotency-Key` HTTP header (preferred — client supplies a UUID
     it can re-send on retry).
  2. SHA-256 of the canonicalised request body (fallback — covers the
     "double-tap" case where the client did NOT send a header).

Storage:
  • Redis if reachable on localhost:6379 (same instance the treatment
    cache uses). TTL = IDEMPOTENCY_TTL_SECONDS (60 min default).
  • In-memory LRU otherwise (single-process safe; per-replica cache).

Stored value: the JSON-serialisable response body. We do NOT cache
non-2xx responses — a 500 should be retryable.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

IDEMPOTENCY_TTL_SECONDS = 60 * 60   # 60 min
_NAMESPACE = "idem:scan"

# ── Redis (best-effort) ──────────────────────────────────────────────────────
try:
    import redis as _redis_lib
    # Use the same Redis the rest of the service uses (on Railway that's
    # redis.railway.internal, not localhost). Hardcoding localhost made ping() always
    # fail in prod, so the cache silently degraded to a per-process in-memory LRU —
    # i.e. NOT shared across the uvicorn workers. Read the env URL like jobs/queue.py.
    _redis_url = (
        os.environ.get("CELERY_RESULT_BACKEND")
        or os.environ.get("CELERY_BROKER_URL")
        or os.environ.get("REDIS_URL")
        or "redis://localhost:6379/0"
    )
    _redis = _redis_lib.from_url(_redis_url, socket_connect_timeout=2)
    _redis.ping()
    _REDIS_OK = True
    logger.info("[Idempotency] Redis connected — 60-min TTL")
except Exception:
    _redis = None
    _REDIS_OK = False
    logger.info("[Idempotency] Redis unavailable — using in-memory LRU")

# ── In-memory fallback ──────────────────────────────────────────────────────
_MEM: dict[str, tuple[Any, float]] = {}
_MEM_MAX = 500


# ── Canonicalisation ─────────────────────────────────────────────────────────

def _canonical_body(body: dict) -> bytes:
    """Stable serialisation so logically identical bodies hash identically.

    Strips two kinds of noise the client cannot avoid varying:
      • temporary file paths in `images[].path` (the same logical image
        will land at /tmp/abc and /tmp/def on two retries). We hash on
        the file stem + type instead — close enough for double-tap dedup
        without colliding across unrelated requests.
      • whitespace and key ordering.
    """
    norm = {
        "params": body.get("params") or {},
        "images": [
            {
                "type": (img or {}).get("type", ""),
                # Last path segment only; works for both /tmp/abc.jpg and S3 keys.
                "name": (img or {}).get("path", "").rsplit("/", 1)[-1],
            }
            for img in (body.get("images") or [])
        ],
    }
    return json.dumps(norm, sort_keys=True, separators=(",", ":")).encode("utf-8")


def cache_key(body: dict, header_key: str | None) -> str:
    """Build the cache key. Prefer the header — only fall back to hashing
    when the client did not supply one."""
    if header_key and header_key.strip():
        return f"{_NAMESPACE}:hdr:{header_key.strip()[:128]}"
    digest = hashlib.sha256(_canonical_body(body)).hexdigest()
    return f"{_NAMESPACE}:body:{digest}"


# ── Get / Set ────────────────────────────────────────────────────────────────

def get(key: str) -> Optional[dict]:
    if _REDIS_OK:
        try:
            raw = _redis.get(key)
            if raw:
                return json.loads(raw)
        except Exception:
            logger.warning("[Idempotency] Redis get failed for %s", key[-24:])
    entry = _MEM.get(key)
    if entry:
        value, ts = entry
        if time.time() - ts < IDEMPOTENCY_TTL_SECONDS:
            return value
        _MEM.pop(key, None)
    return None


def set(key: str, value: dict) -> None:
    if _REDIS_OK:
        try:
            _redis.setex(key, IDEMPOTENCY_TTL_SECONDS, json.dumps(value))
            return
        except Exception:
            logger.warning("[Idempotency] Redis set failed for %s", key[-24:])
    # In-mem fallback — LRU eviction
    if len(_MEM) >= _MEM_MAX:
        oldest = min(_MEM, key=lambda k: _MEM[k][1])
        _MEM.pop(oldest, None)
    _MEM[key] = (value, time.time())
