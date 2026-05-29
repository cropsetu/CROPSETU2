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
"""
from __future__ import annotations

import json
import logging
import os
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

try:
    import redis as _redis_lib
    _redis = _redis_lib.Redis.from_url(_RESULT_BACK, socket_connect_timeout=2)
    _redis.ping()
    _REDIS_OK = True
    logger.info("[Jobs] Redis bound for idempotency-key -> job_id mapping")
except Exception:  # noqa: BLE001
    _redis = None
    _REDIS_OK = False
    logger.warning("[Jobs] Redis unavailable — idempotency-key → job_id dedup disabled")


def _idem_key(idempotency_key: str) -> str:
    return f"{_IDEM_NAMESPACE}:{idempotency_key.strip()[:128]}"


def bind_idempotency(idempotency_key: str, job_id: str) -> None:
    if not _REDIS_OK or not idempotency_key:
        return
    try:
        _redis.setex(_idem_key(idempotency_key), _IDEM_TTL, job_id)
    except Exception:  # noqa: BLE001
        logger.warning("[Jobs] failed to bind idempotency-key -> %s", job_id)


def lookup_job_for_key(idempotency_key: str | None) -> Optional[str]:
    if not _REDIS_OK or not idempotency_key:
        return None
    try:
        raw = _redis.get(_idem_key(idempotency_key))
        if raw:
            return raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
    except Exception:  # noqa: BLE001
        return None
    return None


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
        # task id". We can't distinguish reliably without per-task heartbeat;
        # the route treats this as "queued" — clients should treat extended
        # PENDING as "not yet picked up".
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
