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
    over cap, raises HTTPException(402). If usage is unknown (Redis miss
    + no in-mem entry), assume 0 (graceful).
  • record_spend(user_id, cost_usd) — called AFTER the pipeline. Always
    succeeds (fail-soft on cache misses). The increment is best-effort —
    a 5s outage means a few requests slip through; never under-charges
    when the system is healthy.

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

_REDIS_OK = False
_redis = None
try:
    import redis as _redis_lib
    _redis = _redis_lib.Redis(host="localhost", port=6379, db=0, socket_connect_timeout=2)
    _redis.ping()
    _REDIS_OK = True
except Exception:
    _redis = None

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


def get_used(user_id: str) -> float:
    """Return the USD spent by this user on the current UTC day."""
    if not SPEND_ENABLED:
        return 0.0
    user_id = user_id or ""
    bucket = _today_key(user_id)
    if _REDIS_OK:
        try:
            raw = _redis.get(_redis_key(*bucket))
            if raw is not None:
                return float(raw)
        except Exception:
            pass
    entry = _MEM.get(bucket)
    return float(entry[0]) if entry else 0.0


def check_under_cap(user_id: str) -> None:
    """Raise 402 if the user is already over their daily cap.
    Called BEFORE the pipeline runs — never during."""
    if not SPEND_ENABLED:
        return
    cap = _cap_for(user_id)
    used = get_used(user_id)
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
