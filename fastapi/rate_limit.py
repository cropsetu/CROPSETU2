"""
Shared rate-limiter factory (SlowAPI).

SlowAPI's default storage is per-process memory, so a multi-instance deployment
keeps one bucket PER INSTANCE and the effective limit balloons to N× the
configured value. `make_limiter` points the limiter at Redis (when
RATE_LIMIT_STORAGE_URI / REDIS_URL is set) so the window is shared across the
fleet and the limit is genuinely enforced in production.

Two safety nets keep rate limiting from ever taking the API down:
  - in_memory_fallback_enabled — if the Redis backend is unreachable, SlowAPI
    transparently falls back to per-process counters instead of erroring, so a
    Redis blip degrades to local limiting rather than an outage.
  - swallow_errors — any residual storage error fails OPEN (request allowed)
    rather than 500-ing. These AI endpoints already sit behind the Express
    backend's Redis-backed limiter + proof-of-work gate, so failing open here is
    safe defence-in-depth.

When no storage URI is configured (dev/test) the limiter stays in-memory —
identical to the previous behaviour.
"""
import logging

from slowapi import Limiter

from config import RATE_LIMIT_STORAGE_URI

logger = logging.getLogger(__name__)


def make_limiter(key_func, default_limits=None):
    """Build a SlowAPI Limiter, shared via Redis when configured."""
    kwargs = {
        "key_func": key_func,
        "swallow_errors": True,
        "in_memory_fallback_enabled": True,
    }
    if default_limits:
        kwargs["default_limits"] = default_limits
    if RATE_LIMIT_STORAGE_URI:
        kwargs["storage_uri"] = RATE_LIMIT_STORAGE_URI
        logger.info("[RateLimit] Using shared storage for cross-instance limits")
    else:
        logger.info("[RateLimit] Using in-memory storage (per-instance limits)")
    return Limiter(**kwargs)
