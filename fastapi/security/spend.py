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
if _REDIS_URL:
    try:
        import redis as _redis_lib
        _redis = _redis_lib.Redis.from_url(_REDIS_URL, socket_connect_timeout=2)
    except Exception:  # noqa: BLE001
        _redis = None
        logger.warning("[Spend] Redis client could not be constructed")
    if _redis is not None:
        # The PING is a health CHECK, not construction. Keeping the client when
        # only the ping fails is what makes the re-probe below possible at all:
        # the previous version nulled `_redis` in one shared `except`, so
        # `_redis_ready()` short-circuited on `_redis is None` and could never
        # reach its ping. A worker that imported during a two-second blip then
        # stayed latched for life — and because the cap fails CLOSED by default,
        # every scan on that replica returned 402 until someone restarted it.
        try:
            _redis.ping()
            _REDIS_OK = True
            logger.info("[Spend] cap bound to shared Redis")
        except Exception:  # noqa: BLE001
            logger.warning("[Spend] Redis unreachable at startup — will re-probe")
else:
    logger.info("[Spend] no Redis URL configured — using per-process in-memory cap (dev)")

# ── Re-probe (AI-06) ─────────────────────────────────────────────────────────
# `_REDIS_OK` above is decided ONCE, at import. uvicorn and Celery both fork
# workers, and any worker that happened to import during a Redis blip had the cap
# permanently disabled for the life of that process: `record_spend` is gated on
# this flag, so the counter nothing writes to is also the counter the cap reads.
# The result is a cap that silently stops existing on some replicas and not
# others. Re-probe on a bounded interval instead of latching forever.
_REPROBE_EVERY_SEC = 30.0
_last_probe_ts = 0.0

# What one scan is assumed to cost while it is in flight. It is an ESTIMATE that
# is settled to the real figure the moment the worker finishes, so its accuracy
# only matters for the few minutes a job is running. What it really controls is
# per-user concurrency: cap / reserve is how many scans one farmer can have in
# flight at once (at the $1.00 default cap and $0.03 here, ~33).
SCAN_RESERVE_USD = float(os.environ.get("SCAN_RESERVE_USD", "0.03"))


def _redis_ready() -> bool:
    """True when the shared Redis is usable right now, re-probing at most every
    _REPROBE_EVERY_SEC so a dead Redis costs one PING per interval, not per call."""
    global _REDIS_OK, _last_probe_ts
    if _redis is None:
        return False
    if _REDIS_OK:
        return True
    now = time.time()
    if now - _last_probe_ts < _REPROBE_EVERY_SEC:
        return False
    _last_probe_ts = now
    try:
        _redis.ping()
        _REDIS_OK = True
        logger.info("[Spend] Redis recovered — cap is fleet-wide again")
        return True
    except Exception:  # noqa: BLE001
        return False


def _mark_redis_down(exc: object = "") -> None:
    """Flip the flag so the next call re-probes rather than assuming health."""
    global _REDIS_OK
    if _REDIS_OK:
        logger.error("[ALERT][Spend] Redis lost — cap degrades to per-process until it returns: %s", exc)
    _REDIS_OK = False


# ── Atomic check-and-reserve (AI-05) ─────────────────────────────────────────
# The cap used to be read in the web process at enqueue and incremented in the
# Celery worker at completion, so N concurrent scans all read the same pre-spend
# value and all passed. Reading and reserving have to be ONE operation against
# one authority; this script is that operation.
#
# Returns {allowed, value}: on refusal `value` is the current usage (so the 402
# can report it), on success it is the post-reserve total.
_RESERVE_LUA = """
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local cap = tonumber(ARGV[1])
if used >= cap then
  return {0, tostring(used)}
end
local new = redis.call('INCRBYFLOAT', KEYS[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return {1, tostring(new)}
"""

# Settle/release adjust the counter by a delta that is usually NEGATIVE, and the
# counter must never go below zero. A negative total silently disables the cap
# outright: the gate is `used >= cap`, which is false for every negative value,
# so one extra release (a Celery redelivery, a release after a settle, a settle
# against a bucket Redis never actually charged) buys unbounded spend. Floor it
# in the same round trip that applies the delta — checking afterwards would race.
_ADJUST_LUA = """
local new = tonumber(redis.call('INCRBYFLOAT', KEYS[1], ARGV[1]))
if new < 0 then
  redis.call('SET', KEYS[1], '0')
  new = 0
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return tostring(new)
"""

# 26 hours: outlives the UTC day so reads near midnight stay consistent, and
# expires before the day after next so keys cannot accumulate.
_KEY_TTL_SEC = 60 * 60 * 26

# In-memory fallback. Each entry: {(user_id, ymd): (cost_so_far, first_seen_ts)}
_MEM: dict[tuple[str, str], tuple[float, float]] = {}
# Bounded (MEM-04): one entry per (user, UTC day), never pruned, meant this grew
# forever in every web AND worker process. Days other than today are unreachable
# by every read path here, so they are pure leak.
_MEM_MAX = 5_000


def _mem_prune(keep_ymd: str) -> None:
    """Drop other days, then trim to _MEM_MAX oldest-first if still oversized."""
    if len(_MEM) <= _MEM_MAX:
        return
    for key in [k for k in _MEM if k[1] != keep_ymd]:
        _MEM.pop(key, None)
    if len(_MEM) > _MEM_MAX:
        for key in sorted(_MEM, key=lambda k: _MEM[k][1])[: len(_MEM) - _MEM_MAX]:
            _MEM.pop(key, None)


def utc_ymd() -> str:
    """The current spend bucket's day. Exported so a caller that reserves now and
    settles later can pin the SAME bucket — a job that finishes after midnight
    must give its reserve back to the day it took it from, not to the new one."""
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def _today_key(user_id: str) -> tuple[str, str]:
    # Bucket on UTC date so rollover is predictable across regions.
    return (user_id or "anon", utc_ymd())


def _redis_key(user_id: str, ymd: str) -> str:
    return f"spend:{ymd}:{user_id or 'anon'}"


def _cap_for(user_id: str) -> float:
    return ANONYMOUS_DAILY_CAP_USD if not user_id else DEFAULT_DAILY_CAP_USD


class _RedisUnavailable(Exception):
    """Raised internally when a required Redis read fails (fail-closed signal)."""


def _used_from_redis(bucket: tuple[str, str]) -> float:
    """Read usage from Redis. Raises _RedisUnavailable on any Redis problem so
    the caller can decide whether to fail closed."""
    if _redis is None or not _redis_ready():
        raise _RedisUnavailable("no redis client")
    try:
        raw = _redis.get(_redis_key(*bucket))
        return float(raw) if raw is not None else 0.0
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down(exc)
        raise _RedisUnavailable(str(exc))


def _reserve_in_redis(bucket: tuple[str, str], cap: float, amount: float) -> tuple[bool, float]:
    """Atomically refuse-or-reserve `amount` against `cap`.

    One round trip, one authority — see _RESERVE_LUA. Raises _RedisUnavailable so
    the caller keeps the existing fail-closed choice rather than silently
    degrading to per-process accounting.
    """
    if _redis is None or not _redis_ready():
        raise _RedisUnavailable("no redis client")
    try:
        allowed, value = _redis.eval(_RESERVE_LUA, 1, _redis_key(*bucket),
                                     str(cap), str(amount), str(_KEY_TTL_SEC))
        return bool(int(allowed)), float(value)
    except _RedisUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down(exc)
        raise _RedisUnavailable(str(exc))


def _adjust(user_id: str, delta: float, ymd: str | None = None) -> None:
    """Move the counter by `delta` (may be negative). Used to settle a reserve to
    its real cost and to release one whose work never happened."""
    if not delta:
        return
    bucket = (user_id or "anon", ymd) if ymd else _today_key(user_id or "")
    cur, ts = _MEM.get(bucket, (0.0, time.time()))
    _MEM[bucket] = (max(0.0, cur + delta), ts)
    _mem_prune(bucket[1])
    if _redis_ready():
        try:
            # Floored in Lua, matching the clamp on the mirror above. These two
            # paths disagreeing is what let the production counter go negative
            # while the in-memory test of the same behaviour passed.
            _redis.eval(_ADJUST_LUA, 1, _redis_key(*bucket), str(delta), str(_KEY_TTL_SEC))
        except Exception as exc:  # noqa: BLE001
            _mark_redis_down(exc)
            # The delta is now lost: a settle that never lands leaves the reserve
            # counted against the farmer until UTC midnight, and a release that
            # never lands does the same. There is no retry queue here, so make it
            # loud rather than silent — the Express credit ledger remains the
            # authoritative record of what was actually charged.
            logger.error(
                "[ALERT][Spend] adjust of %+.4f for %s LOST — Redis unavailable; "
                "cap may over-count until the bucket expires", delta, bucket[0],
            )


def settle_spend(user_id: str, reserved: float, actual: float, ymd: str | None = None) -> None:
    """Replace a reserve with what the work actually cost."""
    _adjust(user_id, float(actual) - float(reserved), ymd)


def release_spend(user_id: str, reserved: float, ymd: str | None = None) -> None:
    """Give a reserve back — the work never happened (timeout, crash, refusal).

    Without this a killed job keeps its estimate counted until UTC midnight, so
    repeated failures lock a farmer out of scanning for work that never ran.
    """
    _adjust(user_id, -float(reserved), ymd)


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


def check_under_cap(user_id: str, reserve: float = 0.0) -> None:
    """Raise 402 if the user is already over their daily cap.
    Called BEFORE the pipeline runs — never during.

    Fail-closed (AISVC-9): when Redis is REQUIRED but the read fails, deny the
    request rather than letting per-replica in-memory accounting under-count and
    allow unbounded spend across the fleet.

    With `reserve` > 0 the check and the increment happen as ONE atomic Redis
    operation (AI-05). Without it, N concurrent scans each read the same
    pre-spend total and every one of them passes — the cap only ever caught the
    N+1th request, an hour later, once the worker had settled the others.
    Callers that reserve MUST later call settle_spend() or release_spend() with
    the same amount, or the reserve stays counted until UTC midnight.
    """
    if not SPEND_ENABLED:
        return
    cap = _cap_for(user_id)
    bucket = _today_key(user_id or "")
    try:
        if reserve > 0:
            allowed, value = _reserve_in_redis(bucket, cap, reserve)
            if allowed:
                # Mirror so a later Redis outage does not zero this process's view.
                cur, ts = _MEM.get(bucket, (0.0, time.time()))
                _MEM[bucket] = (cur + reserve, ts)
                _mem_prune(bucket[1])
                return
            used = value
        else:
            used = _used_from_redis(bucket)
    except _RedisUnavailable as exc:
        if _REQUIRE_REDIS:
            logger.error("[Spend] Redis required but unavailable — failing closed: %s", exc)
            raise HTTPException(
                status_code=402,
                detail={"code": "spend_cap_unavailable",
                        "message": "Spend accounting is temporarily unavailable. Please retry shortly."},
            )
        # Dev / opt-out: degrade to the per-process mirror. A reserve still has
        # to be counted somewhere, so mirror it here too.
        entry = _MEM.get(bucket)
        used = float(entry[0]) if entry else 0.0
        if reserve > 0 and used < cap:
            _MEM[bucket] = (used + reserve, entry[1] if entry else time.time())
            _mem_prune(bucket[1])
            return
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
    _mem_prune(bucket[1])

    # `_redis_ready()`, not the import-time `_REDIS_OK` latch: a worker that
    # forked during a Redis blip used to stop writing here forever, which turns
    # the fleet-wide cap into a per-process one without any signal (AI-06).
    if _redis_ready():
        try:
            key = _redis_key(*bucket)
            new = _redis.incrbyfloat(key, float(cost_usd))
            _redis.expire(key, _KEY_TTL_SEC)
            logger.debug("[Spend] user=%s +$%.4f → $%.4f", user_id or "anon", cost_usd, float(new))
        except Exception as exc:  # noqa: BLE001
            _mark_redis_down(exc)
            logger.warning("[Spend] redis incr failed — using in-mem only")


def _next_midnight_iso() -> str:
    now = datetime.now(timezone.utc)
    tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = tomorrow.replace(day=tomorrow.day + 1) if tomorrow == now else tomorrow
    return tomorrow.isoformat()
