"""
Per-user Daily Spend Cap — CropGuard

Tracks LLM cost (USD) per user per UTC day. When a user exceeds the cap,
expensive endpoints (/ai/scan in particular) return 402 Payment Required
until the next UTC midnight, instead of silently burning more budget.

Storage
  • Redis if available (same instance everything else uses).
  • In-memory dict otherwise — single-process safe; per-replica accounting.

Behaviour
  • check_under_cap(user_id) — called BEFORE the pipeline. If already
    over cap, raises HTTPException(402). FAIL-CLOSED (AISVC-9): when a Redis
    URL is configured but Redis is unreachable, the check denies expensive
    calls rather than silently degrading to per-instance in-memory accounting
    (which lets N replicas each spend the full cap). In a dev setup with no
    Redis configured at all, it falls back to the in-memory mirror.
  • record_spend(user_id, cost_usd) — called AFTER the pipeline. Always
    succeeds (fail-soft on cache misses).

Note: the AUTHORITATIVE per-user budget is the Express credit ledger (token
based, atomic, shared via the SQL DB). This USD cap is a secondary global
guardrail for the FastAPI service.

Anonymous users (no user_id header) share a single bucket so we don't
leave a free-for-all hole. Pick a smaller cap for that bucket via
ANONYMOUS_DAILY_CAP_USD.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone

from fastapi import HTTPException

logger = logging.getLogger(__name__)

DEFAULT_DAILY_CAP_USD = float(os.environ.get("DAILY_SPEND_CAP_USD", "1.00"))
ANONYMOUS_DAILY_CAP_USD = float(os.environ.get("ANONYMOUS_DAILY_CAP_USD", "0.10"))
SPEND_ENABLED = os.environ.get("SPEND_CAP_ENABLED", "true").strip().lower() != "false"

# Use the SHARED Redis (same instance the rate limiter / idempotency use) so the
# cap is enforced across the whole fleet — NOT a hardcoded localhost that silently
# falls back to per-process accounting in production (the original AISVC-9 bug).
_REDIS_URL = (os.environ.get("RATE_LIMIT_STORAGE_URI")
              or os.environ.get("REDIS_URL", "")).strip()
# When a URL is configured we treat Redis as REQUIRED and fail closed if it's
# unreachable. Operators can opt out (prefer availability over a strict cap) with
# SPEND_CAP_REQUIRE_REDIS=false.
_REQUIRE_REDIS = (
    bool(_REDIS_URL)
    and os.environ.get("SPEND_CAP_REQUIRE_REDIS", "true").strip().lower() != "false"
)

_REDIS_OK = False
_redis = None
try:
    if _REDIS_URL:
        import redis as _redis_lib
        _redis = _redis_lib.Redis.from_url(_REDIS_URL, socket_connect_timeout=2)
        _redis.ping()
        _REDIS_OK = True
        logger.info("[Spend] cap bound to shared Redis")
    else:
        logger.info("[Spend] no Redis URL configured — using per-process in-memory cap (dev)")
except Exception:
    _redis = None
    logger.warning("[Spend] Redis configured but unreachable at startup")

# In-memory fallback. Each entry: {(user_id, ymd): (cost_so_far, first_seen_ts)}
_MEM: dict[tuple[str, str], tuple[float, float]] = {}


def _today_key(user_id: str) -> tuple[str, str]:
    # Bucket on UTC date so rollover is predictable across regions.
    ymd = datetime.now(timezone.utc).strftime("%Y%m%d")
    return (user_id or "anon", ymd)


def _redis_key(user_id: str, ymd: str) -> str:
    return f"spend:{ymd}:{user_id or 'anon'}"


def _cap_for(user_id: str) -> float:
    return ANONYMOUS_DAILY_CAP_USD if not user_id else DEFAULT_DAILY_CAP_USD


class _RedisUnavailable(Exception):
    """Raised internally when a required Redis read fails (fail-closed signal)."""


def _used_from_redis(bucket: tuple[str, str]) -> float:
    """Read usage from Redis. Raises _RedisUnavailable on any Redis problem so
    the caller can decide whether to fail closed."""
    if _redis is None:
        raise _RedisUnavailable("no redis client")
    try:
        raw = _redis.get(_redis_key(*bucket))
        return float(raw) if raw is not None else 0.0
    except Exception as exc:  # noqa: BLE001
        raise _RedisUnavailable(str(exc))


def get_used(user_id: str) -> float:
    """Return the USD spent by this user on the current UTC day (best-effort)."""
    if not SPEND_ENABLED:
        return 0.0
    bucket = _today_key(user_id or "")
    try:
        return _used_from_redis(bucket)
    except _RedisUnavailable:
        entry = _MEM.get(bucket)
        return float(entry[0]) if entry else 0.0


def remaining_budget(user_id: str) -> float:
    """Best-effort USD headroom left under the daily cap for this user.
    Returns +inf when the cap is disabled. Used by the orchestrator to decide
    whether it can afford the (2-4x cost) ensemble fan-out (AISVC-5)."""
    if not SPEND_ENABLED:
        return float("inf")
    try:
        return max(0.0, _cap_for(user_id) - get_used(user_id))
    except Exception:  # noqa: BLE001
        return float("inf")  # never block diagnosis on a budget-read error


def check_under_cap(user_id: str) -> None:
    """Raise 402 if the user is already over their daily cap.
    Called BEFORE the pipeline runs — never during.

    Fail-closed (AISVC-9): when Redis is REQUIRED but the read fails, deny the
    request rather than letting per-replica in-memory accounting under-count and
    allow unbounded spend across the fleet.
    """
    if not SPEND_ENABLED:
        return
    cap = _cap_for(user_id)
    bucket = _today_key(user_id or "")
    try:
        used = _used_from_redis(bucket)
    except _RedisUnavailable as exc:
        if _REQUIRE_REDIS:
            logger.error("[Spend] Redis required but unavailable — failing closed: %s", exc)
            raise HTTPException(
                status_code=402,
                detail={"code": "spend_cap_unavailable",
                        "message": "Spend accounting is temporarily unavailable. Please retry shortly."},
            )
        # Dev / opt-out: degrade to the per-process mirror.
        entry = _MEM.get(bucket)
        used = float(entry[0]) if entry else 0.0
    if used >= cap:
        logger.warning(
            "[Spend] user=%s OVER cap — used $%.4f of $%.2f",
            user_id or "anon", used, cap,
        )
        raise HTTPException(
            status_code=402,
            detail={
                "code": "daily_cap_reached",
                "used_usd": round(used, 4),
                "cap_usd": cap,
                "resets_at_utc": _next_midnight_iso(),
            },
        )


def record_spend(user_id: str, cost_usd: float) -> None:
    """Fire-and-forget accounting. Never raises."""
    if not SPEND_ENABLED or not cost_usd or cost_usd <= 0:
        return
    user_id = user_id or ""
    bucket = _today_key(user_id)
    # Always bump the in-mem mirror so even a Redis failure doesn't silently
    # zero the per-process accounting.
    cur, ts = _MEM.get(bucket, (0.0, time.time()))
    _MEM[bucket] = (cur + float(cost_usd), ts)

    if _REDIS_OK:
        try:
            key = _redis_key(*bucket)
            new = _redis.incrbyfloat(key, float(cost_usd))
            # 26-hour TTL — outlives the day so reads near midnight stay
            # consistent; expires before the next-next day.
            _redis.expire(key, 60 * 60 * 26)
            logger.debug("[Spend] user=%s +$%.4f → $%.4f", user_id or "anon", cost_usd, float(new))
        except Exception:
            logger.warning("[Spend] redis incr failed — using in-mem only")


def _next_midnight_iso() -> str:
    now = datetime.now(timezone.utc)
    tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = tomorrow.replace(day=tomorrow.day + 1) if tomorrow == now else tomorrow
    return tomorrow.isoformat()
