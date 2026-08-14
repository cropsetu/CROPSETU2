"""
jobs/queue.py — Celery application + enqueue / status helpers.

Broker + result backend are the same Redis instance used by
services/idempotency.py and security/spend.py. Configurable via
CELERY_BROKER_URL / CELERY_RESULT_BACKEND env vars; defaults to
redis://localhost:6379/1 (db 1 to keep job traffic off the dedup keyspace
in db 0).

Tasks
  - run_diagnosis_task(payload) -> dict      (jobs/tasks.py)

Public surface this module exposes to routes/scan.py:
  - enqueue_diagnosis(payload, idempotency_key=None) -> job_id
  - get_job_status(job_id) -> {"status": ..., "data": ...}
  - bind_idempotency(idempotency_key, job_id)
  - lookup_job_for_key(idempotency_key) -> job_id | None
  - get_job_idem_key(job_id) -> idempotency_key | None   (reverse of the above)
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Optional

from celery import Celery
from celery.result import AsyncResult

logger = logging.getLogger(__name__)


# ── Celery app ───────────────────────────────────────────────────────────────
_BROKER_URL  = os.environ.get("CELERY_BROKER_URL",  "redis://localhost:6379/1")
_RESULT_BACK = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

celery_app = Celery(
    "cropsetu",
    broker=_BROKER_URL,
    backend=_RESULT_BACK,
    include=["jobs.tasks"],
)

# Why these defaults:
#   - task_acks_late=True: a worker process crash mid-pipeline (OOM, OOM-killer,
#     a 502 from a provider that bubbles up uncaught) should requeue the task
#     so another worker can retry instead of silently losing the job.
#   - worker_prefetch_multiplier=1: long tasks (60-120s) should not be
#     prefetched; the default of 4 would let a single worker hog 4 jobs and
#     starve the others while running serially.
#   - result_expires=86400 (24h): plenty of time for the mobile client to
#     poll and pick up the result. Idempotency layer holds responses for an
#     hour, this is the slower retention.
#   - task_time_limit / task_soft_time_limit: hard cap the worker side too —
#     defence in depth on top of the orchestrator's own 240s wrapper.
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=24 * 3600,
    task_time_limit=300,
    task_soft_time_limit=270,
    broker_connection_retry_on_startup=True,
)


# ── Idempotency-key → job_id binding (Redis) ────────────────────────────────
# When two requests share an idempotency-key, the second one should NOT spawn
# a new worker job — it should return the first job's id (or the cached
# result, depending on completion status). We piggyback on the same Redis
# instance used by services/idempotency.py.

_IDEM_NAMESPACE = "idem:scan:job"
_IDEM_TTL = 60 * 60  # 1 hour, matches services/idempotency

# Health is NOT latched at import. The previous version ping()'d once and
# pinned _REDIS_OK for the process lifetime, so a blip during a worker fork
# permanently disabled key→job dedup, the IDOR owner check and the job-existence
# marker in that process — every one of them failing open, silently. Same
# bounded re-probe shape as services/idempotency.py (deliberately duplicated
# rather than shared: the two modules must not import each other).
_REDIS_RETRY_SEC = 30
_redis_ok = False
_redis_ever_ok = False
_redis_next_probe = 0.0

# See job_was_enqueued(): jobs enqueued while Redis was down carry no existence
# marker, so for a short window after a recovery a missing marker must NOT be
# read as "unknown job". 300s ≥ celery task_time_limit, so any job enqueued
# during the outage has either finished (SUCCESS, marker not consulted) or been
# killed by the time the grace period lapses.
_EXISTS_GRACE_SEC = 300
_exists_grace_until = 0.0

try:
    import redis as _redis_lib
    _redis = _redis_lib.Redis.from_url(_RESULT_BACK, socket_connect_timeout=2)
except Exception:  # noqa: BLE001
    _redis = None
    logger.warning("[Jobs] redis client unavailable — idempotency-key → job_id dedup disabled")


def _redis_available() -> bool:
    """Re-probe at most every 30s. The old import-time latch meant a Redis blip
    during a worker fork dropped that process onto no-op dedup forever."""
    global _redis_ok, _redis_ever_ok, _redis_next_probe, _exists_grace_until
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
    except Exception:  # noqa: BLE001
        return False
    _redis_ok = True
    if _redis_ever_ok:
        _exists_grace_until = now + _EXISTS_GRACE_SEC
        logger.error(
            "[ALERT][Redis] Job registry RECOVERED — key→job dedup, owner checks and "
            "existence markers are live again"
        )
    else:
        _redis_ever_ok = True
        logger.info("[Jobs] Redis bound for idempotency-key -> job_id mapping")
    return True


def _mark_redis_down(op: str, exc: Exception) -> None:
    """One loud line on the healthy→down edge, then silence until it recovers."""
    global _redis_ok, _redis_next_probe
    _redis_next_probe = time.monotonic() + _REDIS_RETRY_SEC
    if _redis_ok:
        _redis_ok = False
        logger.error(
            "[ALERT][Redis] Job registry UNAVAILABLE (%s: %s) — scan dedup, the job-owner "
            "IDOR check and unknown-job detection are all disabled; re-probing every %ds",
            op, exc, _REDIS_RETRY_SEC,
        )


# Probe once at import so a healthy boot logs where it always did; a failure
# here is no longer terminal.
if _redis is not None and not _redis_available():
    logger.warning(
        "[Jobs] Redis unreachable at import — dedup disabled; re-probing every %ds",
        _REDIS_RETRY_SEC,
    )


def _idem_key(idempotency_key: str) -> str:
    return f"{_IDEM_NAMESPACE}:{idempotency_key.strip()[:128]}"


def bind_idempotency(idempotency_key: str, job_id: str) -> None:
    if not _redis_available() or not idempotency_key:
        return
    try:
        _redis.setex(_idem_key(idempotency_key), _IDEM_TTL, job_id)
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down("bind_idempotency", exc)
        logger.warning("[Jobs] failed to bind idempotency-key -> %s", job_id)


def lookup_job_for_key(idempotency_key: str | None) -> Optional[str]:
    if not _redis_available() or not idempotency_key:
        return None
    try:
        raw = _redis.get(_idem_key(idempotency_key))
        if raw:
            return raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down("lookup_job_for_key", exc)
        return None
    return None


# ── job_id → idempotency-key reverse binding ────────────────────────────────
# GET /ai/scan/{job_id} has to promote a finished report into the idempotency
# cache under the key the SUBMIT built, but it only holds a job id — it never
# sees the original body or the Idempotency-Key header. Without this reverse map
# the status route invented `idem:scan:hdr:{request_id}`, a shape cache_key()
# never produces, so the write could not be read back and the POST handler's
# inline-replay branch was unreachable dead code.

_IDEM_REV_NAMESPACE = "idem:scan:key"


def _idem_rev_key(job_id: str) -> str:
    return f"{_IDEM_REV_NAMESPACE}:{(job_id or '').strip()[:128]}"


def bind_job_idem_key(job_id: str, idempotency_key: str | None) -> None:
    """Record the submit-time cache key for this job. No-op without Redis."""
    if not _redis_available() or not job_id or not idempotency_key:
        return
    try:
        _redis.setex(_idem_rev_key(job_id), _IDEM_TTL, idempotency_key[:256])
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down("bind_job_idem_key", exc)
        logger.warning("[Jobs] failed to bind job_id=%s -> idempotency-key", job_id)


def get_job_idem_key(job_id: str) -> Optional[str]:
    """Return the submit-time cache key for a job, or None if unknown."""
    if not _redis_available() or not job_id:
        return None
    try:
        raw = _redis.get(_idem_rev_key(job_id))
        if raw:
            return raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down("get_job_idem_key", exc)
        return None
    return None


# ── Job ownership (AISVC-2) ──────────────────────────────────────────────────
# Bind each job to the user who submitted it so GET /ai/scan/{job_id} can refuse
# to return another user's scan results (IDOR). Stored in the same Redis,
# outliving the Celery result so a late poll still resolves the owner.

_OWNER_NAMESPACE = "owner:scan:job"
_OWNER_TTL = 24 * 3600 + 3600  # outlive result_expires (24h) by an hour


def _owner_key(job_id: str) -> str:
    return f"{_OWNER_NAMESPACE}:{(job_id or '').strip()[:128]}"


def bind_job_owner(job_id: str, owner_id: str | None) -> None:
    """Record which user owns this job. No-op when owner/redis is absent."""
    if not _redis_available() or not job_id or not owner_id:
        return
    try:
        _redis.setex(_owner_key(job_id), _OWNER_TTL, str(owner_id)[:128])
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down("bind_job_owner", exc)
        logger.warning("[Jobs] failed to bind owner for job_id=%s", job_id)


def get_job_owner(job_id: str) -> Optional[str]:
    """Return the owner user_id for a job, or None if unknown/redis down."""
    if not _redis_available() or not job_id:
        return None
    try:
        raw = _redis.get(_owner_key(job_id))
        if raw:
            return raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down("get_job_owner", exc)
        return None
    return None


# ── Job-existence marker ─────────────────────────────────────────────────────
# Celery returns state=PENDING for BOTH "queued, not yet started" AND "unknown
# task id", so an unknown/expired/typo'd job_id would otherwise be reported as
# "queued" forever and the mobile client polls indefinitely. We stamp a marker
# at enqueue (outliving result_expires); a PENDING job with no marker is treated
# as a terminal "unknown job" instead.
_EXISTS_NAMESPACE = "exists:scan:job"
_EXISTS_TTL = 24 * 3600 + 3600  # outlive result_expires (24h) by an hour


def _exists_key(job_id: str) -> str:
    return f"{_EXISTS_NAMESPACE}:{(job_id or '').strip()[:128]}"


def mark_job_exists(job_id: str) -> None:
    if not _redis_available() or not job_id:
        return
    try:
        _redis.setex(_exists_key(job_id), _EXISTS_TTL, "1")
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down("mark_job_exists", exc)
        logger.warning("[Jobs] failed to mark existence for job_id=%s", job_id)


def job_was_enqueued(job_id: str) -> bool:
    """True if we recorded this job at enqueue. False = unknown/expired id.
    Returns True when Redis is down (can't disprove existence → don't false-fail)."""
    if not _redis_available():
        return True
    if not job_id:
        return False
    # Grace window after a reconnect: jobs enqueued while Redis was down never
    # got a marker, and now that Redis answers again a missing marker would be
    # read as "unknown job" and abort a scan the worker is still running. Only
    # the reconnect path arms this (see _EXISTS_GRACE_SEC); a process that has
    # been healthy throughout never enters it.
    if _exists_grace_until and time.monotonic() < _exists_grace_until:
        return True
    try:
        return _redis.exists(_exists_key(job_id)) == 1
    except Exception as exc:  # noqa: BLE001
        _mark_redis_down("job_was_enqueued", exc)
        return True


# ── Enqueue + status ─────────────────────────────────────────────────────────

def enqueue_diagnosis(payload: dict, *, idempotency_key: str | None = None) -> str:
    """
    Submit a diagnosis job and return its id immediately.

    `payload` must be JSON-serialisable. Images go in payload["images"] as
    [{data: <base64>, mime_type, type}] — the worker materialises them to
    tempfiles before calling the orchestrator.

    If `idempotency_key` is set and a prior NON-FAILED job for the same
    key exists, returns the existing job_id (no new job is spawned).
    Failed prior jobs are NOT reused — the principle is "failures should
    be retryable"; we just rebind the key to the new job below.
    """
    if idempotency_key:
        existing = lookup_job_for_key(idempotency_key)
        if existing:
            snap = get_job_status(existing)
            if snap["status"] == "failed":
                logger.info(
                    "[Jobs] prior job_id=%s was FAILED — enqueueing fresh", existing,
                )
            else:
                logger.info("[Jobs] idempotent enqueue: returning existing job_id=%s", existing)
                return existing
    # Late import — keeps the Celery app importable from contexts (eval/,
    # tests/) where tasks/ isn't desired.
    from jobs import tasks  # noqa: F401 — registers the task
    async_result = celery_app.send_task(
        "jobs.tasks.run_diagnosis_task",
        kwargs={"payload": payload},
    )
    if idempotency_key:
        bind_idempotency(idempotency_key, async_result.id)
        # Reverse direction too, so GET /ai/scan/{job_id} can cache the finished
        # report under the key the submit actually used.
        bind_job_idem_key(async_result.id, idempotency_key)
    # Bind ownership so the result can only be polled back by its submitter.
    bind_job_owner(async_result.id, (payload or {}).get("user_id"))
    # Record existence so an unknown/expired job_id isn't reported as "queued"
    # forever (Celery PENDING is ambiguous — see get_job_status).
    mark_job_exists(async_result.id)
    logger.info("[Jobs] enqueued job_id=%s", async_result.id)
    return async_result.id


def get_job_status(job_id: str) -> dict:
    """
    Return a JSON-serialisable status snapshot.
      {"status": "queued"|"running"|"done"|"failed", "data": <result> | None,
       "error": <str> | None}
    """
    result = AsyncResult(job_id, app=celery_app)
    state = result.state  # PENDING, STARTED, SUCCESS, FAILURE, RETRY, REVOKED
    if state == "PENDING":
        # Celery returns PENDING for both "queued, not started" AND "unknown
        # task id". Disambiguate via the enqueue-time existence marker: a marker
        # present → genuinely queued; absent → unknown/expired id (the client
        # would otherwise poll "queued" forever). Redis-down → assume queued.
        if not job_was_enqueued(job_id):
            return {"status": "failed", "data": None,
                    "error": "Unknown or expired scan job — please resubmit the scan."}
        return {"status": "queued", "data": None, "error": None}
    if state in ("STARTED", "RETRY"):
        return {"status": "running", "data": None, "error": None}
    if state == "SUCCESS":
        try:
            data = result.result
        except Exception as exc:  # noqa: BLE001
            return {"status": "failed", "data": None, "error": f"result fetch failed: {exc}"}
        return {"status": "done", "data": data, "error": None}
    if state == "FAILURE":
        err = str(result.result) if result.result else "unknown failure"
        return {"status": "failed", "data": None, "error": err}
    if state == "REVOKED":
        return {"status": "failed", "data": None, "error": "job cancelled"}
    # Unknown Celery state — pass through verbatim
    return {"status": state.lower(), "data": None, "error": None}
