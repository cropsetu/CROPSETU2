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

Both forms are namespaced by the submitting user: the key is a REPLAY
token, so an un-namespaced one lets one farmer be served another's report
and lets one farmer's submission suppress another's real scan.

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

# ── Redis (best-effort, re-probed) ───────────────────────────────────────────
# Health is NOT latched at import. The previous version ping()'d once on import
# and pinned _REDIS_OK for the life of the process, so a Redis blip during a
# uvicorn/Celery worker fork dropped THAT process onto the 500-entry in-process
# LRU permanently — scan dedup silently stopped being shared across replicas
# with nothing in the logs to say so. We now re-probe on a bounded interval and
# never give up, mirroring the Express side's backoff and its greppable
# [ALERT][Redis] transition marker (backend/src/config/redis.js:19-22, 78-102).
_REDIS_RETRY_SEC = 30
_redis_ok = False
_redis_ever_ok = False
_redis_next_probe = 0.0

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
except Exception:
    _redis = None
    logger.info("[Idempotency] redis client unavailable — using in-memory LRU")


def _redis_available() -> bool:
    """Re-probe at most every 30s. The old import-time latch meant a Redis blip
    during a worker fork dropped that process onto the in-process LRU forever."""
    global _redis_ok, _redis_ever_ok, _redis_next_probe
    if _redis is None:
        return False
    if _redis_ok:
        return True
    now = time.monotonic()
    if now < _redis_next_probe:
        return False
    _redis_next_probe = now + _REDIS_RETRY_SEC
    try:
        _redis.ping()
    except Exception:
        return False
    _redis_ok = True
    if _redis_ever_ok:
        logger.error(
            "[ALERT][Redis] Idempotency cache RECOVERED — scan dedup is shared across replicas again"
        )
    else:
        _redis_ever_ok = True
        logger.info("[Idempotency] Redis connected — 60-min TTL")
    return True


def _mark_redis_down(op: str, exc: Exception) -> None:
    """One loud line on the healthy→down edge, then silence until it recovers."""
    global _redis_ok, _redis_next_probe
    _redis_next_probe = time.monotonic() + _REDIS_RETRY_SEC
    if _redis_ok:
        _redis_ok = False
        logger.error(
            "[ALERT][Redis] Idempotency cache UNAVAILABLE (%s: %s) — scan dedup degraded to a "
            "per-process LRU; re-probing every %ds",
            op, exc, _REDIS_RETRY_SEC,
        )


# Probe once at import so a healthy boot still logs "Redis connected" where it
# always did. Unlike before, a failure here is not terminal — the next call
# after _REDIS_RETRY_SEC probes again.
if _redis is not None and not _redis_available():
    logger.info(
        "[Idempotency] Redis unreachable at import — in-memory LRU; re-probing every %ds",
        _REDIS_RETRY_SEC,
    )


# ── In-memory fallback ──────────────────────────────────────────────────────
_MEM: dict[str, tuple[Any, float]] = {}
_MEM_MAX = 500


# ── Canonicalisation ─────────────────────────────────────────────────────────

def _canonical_body(body: dict) -> bytes:
    """Stable serialisation so logically identical bodies hash identically.

    The image is hashed by CONTENT. The previous version keyed on the last
    path segment (`img["path"].rsplit("/")[-1]`), but the mobile/Express path
    sends inline base64 in `data` and no `path` at all — so `name` was "" for
    every real request and the photograph contributed NOTHING to the key. Two
    photos of two DIFFERENT plants submitted under the same form values inside
    the TTL replayed the first plant's diagnosis, and its pesticide, for the
    second. Whitespace and key ordering are still normalised via sort_keys.
    """
    norm = {
        "params": body.get("params") or {},
        "images": [
            {
                "type": (img or {}).get("type", ""),
                # Content digest: the inline base64 when present, else the
                # on-disk path (legacy/smoke-test payloads carry `path` only).
                "digest": hashlib.sha256(
                    (((img or {}).get("data") or (img or {}).get("path") or "")).encode("utf-8")
                ).hexdigest()[:32],
            }
            for img in (body.get("images") or [])
        ],
    }
    return json.dumps(norm, sort_keys=True, separators=(",", ":")).encode("utf-8")


def cache_key(body: dict, header_key: str | None, *, user_id: str | None = None) -> str:
    """Build the cache key. Prefer the header — only fall back to hashing
    when the client did not supply one.

    Namespaced per user because the key is a replay token: without it, farmer
    B's identical retry (or a replayed Idempotency-Key) is served farmer A's
    report, and one farmer's in-flight job suppresses another's real scan.
    """
    who = ((str(user_id).strip() if user_id else "") or "anon")[:64]
    if header_key and header_key.strip():
        return f"{_NAMESPACE}:u:{who}:hdr:{header_key.strip()[:128]}"
    digest = hashlib.sha256(_canonical_body(body)).hexdigest()
    return f"{_NAMESPACE}:u:{who}:body:{digest}"


# ── Get / Set ────────────────────────────────────────────────────────────────

def get(key: str) -> Optional[dict]:
    if _redis_available():
        raw = None
        try:
            raw = _redis.get(key)
        except Exception as exc:
            # Connection-level failure only — a corrupt VALUE (below) is not a
            # reason to declare Redis down for the next 30s.
            _mark_redis_down("get", exc)
        if raw:
            try:
                return json.loads(raw)
            except Exception:
                logger.warning("[Idempotency] corrupt cache entry for %s — ignoring", key[-24:])
    entry = _MEM.get(key)
    if entry:
        value, ts = entry
        if time.time() - ts < IDEMPOTENCY_TTL_SECONDS:
            return value
        _MEM.pop(key, None)
    return None


def set(key: str, value: dict) -> None:
    if _redis_available():
        try:
            _redis.setex(key, IDEMPOTENCY_TTL_SECONDS, json.dumps(value))
            return
        except Exception as exc:
            _mark_redis_down("set", exc)
    # In-mem fallback — LRU eviction
    if len(_MEM) >= _MEM_MAX:
        oldest = min(_MEM, key=lambda k: _MEM[k][1])
        _MEM.pop(oldest, None)
    _MEM[key] = (value, time.time())
