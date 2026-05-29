"""
jobs/tasks.py — Celery task: run the diagnosis pipeline for one scan.

Why a separate module from queue.py
  Celery's `include=["jobs.tasks"]` autodiscovery imports this module on
  worker startup; keeping it separate from queue.py avoids a circular
  import (queue.py registers the app, tasks.py imports it).

How the payload is structured
  {
    "params":  { crop_name, growth_stage, ... },
    "images":  [{"data": <base64>, "mime_type": "image/jpeg", "type": "leaf"}, ...],
    "request_id":  "<uuid>",       # optional — propagated to log context
    "user_id":     "<id>",         # optional — propagated to log context
  }

What this task returns
  The full report dict from orchestrator.run_diagnosis(), unchanged. The
  Celery result backend (Redis) serializes it as JSON automatically.
"""
from __future__ import annotations

# Belt-and-suspenders: ensure fastapi/ is on sys.path BEFORE the late
# `from orchestrator import run_diagnosis` inside the task body. jobs/
# __init__.py already does this, but in Celery's prefork pool we've seen
# the worker context fail to inherit it cleanly — duplicating here costs
# nothing and removes a class of "works on my machine" bugs.
import os as _os, sys as _sys
_FASTAPI_ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
if _FASTAPI_ROOT not in _sys.path:
    _sys.path.insert(0, _FASTAPI_ROOT)
del _os, _sys, _FASTAPI_ROOT

import asyncio
import base64
import logging
import os
import tempfile
from pathlib import Path

from celery.exceptions import SoftTimeLimitExceeded

from jobs.queue import celery_app

logger = logging.getLogger(__name__)


_MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png":  ".png",
    "image/webp": ".webp",
}
_MAX_INLINE_BYTES_PER_IMAGE = 8 * 1024 * 1024


def _materialise(images: list[dict]) -> tuple[list[dict], list[Path]]:
    """Same shape as routes/scan._materialise_inline_images. Duplicated here
    rather than imported to keep this worker module independent of FastAPI
    route imports (which pull in slowapi + httpx clients we don't need)."""
    materialised: list[dict] = []
    temp_paths: list[Path] = []
    for img in images or []:
        if not isinstance(img, dict):
            continue
        if img.get("path") and not img.get("data"):
            materialised.append(img)
            continue
        data_b64 = img.get("data")
        if not isinstance(data_b64, str) or not data_b64:
            continue
        try:
            raw = base64.b64decode(data_b64, validate=True)
        except Exception:
            logger.warning("[Worker] skipping image with invalid base64")
            continue
        if len(raw) > _MAX_INLINE_BYTES_PER_IMAGE:
            logger.warning("[Worker] skipping oversized inline image (%d bytes)", len(raw))
            continue
        mime = (img.get("mime_type") or "image/jpeg").lower()
        suffix = _MIME_TO_EXT.get(mime, ".jpg")
        fd, path = tempfile.mkstemp(prefix="cropsetu_worker_", suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(raw)
        except Exception:
            try: os.close(fd)
            except Exception: pass
            raise
        p = Path(path)
        temp_paths.append(p)
        materialised.append({"path": str(p), "type": img.get("type") or "leaf"})
    return materialised, temp_paths


def _cleanup(paths: list[Path]) -> None:
    for p in paths:
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass


@celery_app.task(
    name="jobs.tasks.run_diagnosis_task",
    bind=True,
    max_retries=0,
    acks_late=True,
)
def run_diagnosis_task(self, *, payload: dict) -> dict:
    """
    Worker entry point.

    Bind=True is for diagnostic logging (self.request.id is the job id).
    We deliberately set max_retries=0 — the orchestrator already handles
    transient LLM errors via the router fallback chain, and a retried
    diagnose stage costs real $. If the whole task fails, the client
    sees status=failed and can choose to resubmit.
    """
    job_id = self.request.id
    logger.info("[Worker] start job_id=%s crop=%s", job_id, (payload.get("params") or {}).get("crop_name"))

    images_in = payload.get("images") or []
    params    = payload.get("params") or {}
    images, temp_paths = _materialise(images_in)

    # Stamp context vars so structured logs from the orchestrator carry
    # the same request_id the API client received.
    try:
        from observability.logging import request_id_var, user_id_var
        if payload.get("request_id"):
            request_id_var.set(str(payload["request_id"]))
        if payload.get("user_id"):
            user_id_var.set(str(payload["user_id"]))
    except Exception:  # noqa: BLE001
        pass

    try:
        from orchestrator import run_diagnosis  # late import — heavy
        # Celery tasks are sync. asyncio.run gives the orchestrator a
        # private event loop per task; safe since workers are
        # process-per-task (prefork pool).
        result = asyncio.run(run_diagnosis(params, images))
        logger.info("[Worker] done job_id=%s confidence=%.2f", job_id, ((result.get("meta") or {}).get("confidence_score") or 0))
        return result
    except SoftTimeLimitExceeded:
        logger.error("[Worker] SOFT TIMEOUT job_id=%s — task exceeded soft limit", job_id)
        raise
    except Exception:
        logger.exception("[Worker] FAILED job_id=%s", job_id)
        raise
    finally:
        _cleanup(temp_paths)
