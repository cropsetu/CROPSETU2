"""Async job queue for the diagnosis pipeline.
"""
# Ensure the fastapi/ root is on sys.path so worker subprocesses can import
# orchestrator / agents / safety / rag / persistence the same way uvicorn
# does. Celery's prefork pool inherits the parent's sys.path, but if the
# worker is launched with `celery -A jobs.queue:celery_app worker` (i.e.
# CWD=fastapi/), Python only auto-adds the *script* directory to sys.path
# — which for celery is its own bin directory, not fastapi/. This makes
# the worker robust to that.
import os as _os
import sys as _sys
_FASTAPI_ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
if _FASTAPI_ROOT not in _sys.path:
    _sys.path.insert(0, _FASTAPI_ROOT)
del _os, _sys, _FASTAPI_ROOT

_doc = """Async job queue for the diagnosis pipeline.

The cascade-into-ensemble flow can run 60–120 s when escalated, which is
longer than the Android OkHttp readTimeout (60 s) used internally by
expo-file-system's uploadAsync. Holding the mobile connection open through
that latency is therefore unsafe at the protocol layer regardless of
server timeouts.

The /scan route now enqueues a job and returns a `job_id` immediately;
the mobile app polls `GET /scan/{job_id}` until the result is ready (or
receives an FCM push when the worker completes). All state — task results,
idempotency, spend — lives in Redis, so multiple workers stay consistent.
"""
