"""
Crop Disease Scan routes (async-job mode).

Why async
  The cascade-into-ensemble flow can take 60-120s when escalated. The
  mobile client uses expo-file-system / OkHttp with a 60s readTimeout
  that cannot be raised reliably, so holding the connection open is
  unsafe. Submitting returns a job_id immediately; the mobile client
  polls GET /ai/scan/{job_id} (or receives an FCM push).

Endpoints
  POST /ai/scan                  -> { job_id, status, _idempotent? }
  GET  /ai/scan/{job_id}         -> { status: queued|running|done|failed,
                                      data?: <report>, error?: <str> }
  POST /api/v1/crop-disease/agentic-predict   -> deprecation stub
"""
from __future__ import annotations
import base64
import logging
from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import JSONResponse
from slowapi.util import get_remote_address

from agents.registry import normalize_tier
from jobs.queue import (
    enqueue_diagnosis,
    get_job_status,
    get_job_owner,
    lookup_job_for_key,
    bind_idempotency,
)
from security.auth import verify_signed_request
from security.input_sanitize import clean_user_text
from security.spend import check_under_cap
from services import idempotency
from rate_limit import make_limiter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Scan"])


_MAX_INLINE_BYTES_PER_IMAGE = 8 * 1024 * 1024  # 8 MB per image (matches worker)

# Free-text params that get interpolated into the LLM diagnosis/treatment
# prompts — strip control chars + cap length before they leave the route
# (AISVC-3). Structured fields (crop_name, soil_type, …) are handled by the
# input normalizer's whitelist instead.
_FREE_TEXT_PARAM_KEYS = (
    "symptom_description", "recent_pesticide_used", "fertilizer_history",
    "farm_history", "additional_symptoms", "notes",
)
_MAX_PARAM_TEXT_LEN = 1500


def _sanitize_params(params: dict) -> dict:
    for k in _FREE_TEXT_PARAM_KEYS:
        if params.get(k) is not None:
            params[k] = clean_user_text(params[k], max_len=_MAX_PARAM_TEXT_LEN)
    return params


def _validate_images(images: list[dict]) -> tuple[list[dict], list[str]]:
    """Return (cleaned, errors). Drops oversized / malformed base64 entries.

    The route does NOT decode to bytes — the worker does. We only sanity-
    check size + presence here so a bad payload fails fast (400) instead
    of materialising on the worker and silently dropping images mid-run.
    """
    cleaned: list[dict] = []
    errors:  list[str] = []
    for i, img in enumerate((images or [])[:1]):   # single-image: validate first only, ignore extras
        if not isinstance(img, dict):
            errors.append(f"images[{i}] not an object")
            continue
        # legacy on-disk path (used by smoke tests) — pass through
        if img.get("path") and not img.get("data"):
            cleaned.append({"path": img["path"], "type": img.get("type") or "leaf"})
            continue
        data = img.get("data")
        if not isinstance(data, str) or not data:
            errors.append(f"images[{i}] missing 'data'")
            continue
        # Validate base64 by length only — full b64decode is the worker's job.
        try:
            approx_bytes = (len(data) * 3) // 4
        except Exception:
            errors.append(f"images[{i}] invalid base64")
            continue
        if approx_bytes > _MAX_INLINE_BYTES_PER_IMAGE:
            errors.append(f"images[{i}] exceeds 8 MB cap")
            continue
        cleaned.append({
            "data":      data,
            "mime_type": (img.get("mime_type") or "image/jpeg").lower(),
            "type":      img.get("type") or "leaf",
        })
    return cleaned, errors


# Rate limit at the enqueue endpoint — workers downstream can't be throttled
# per-user, so the gate sits here.
def _scan_key(request: Request) -> str:
    uid = request.headers.get("x-user-id")
    return f"u:{uid}" if uid else f"ip:{get_remote_address(request)}"


_scan_limiter = make_limiter(_scan_key)


@router.post(
    "/ai/scan",
    dependencies=[Depends(verify_signed_request)],
)
@_scan_limiter.limit("10/minute;60/hour")
async def ai_scan(request: Request):
    """Submit a scan; receive a job_id immediately.

    Response (always 200 on success):
      { "success": true, "job_id": "...", "status": "queued"|"done",
        "data": <report>?, "_idempotent_replay": bool? }

    If the (Idempotency-Key|body hash) maps to a completed result, the
    response includes status="done" + the cached `data` so the client can
    skip the polling round-trip. If it maps to an in-flight job, the
    response includes status="queued"|"running" with the existing job_id.
    """
    try:
        body = await request.json()
        images_in = body.get("images", [])
        params = body.get("params", {})

        params["tier"] = normalize_tier(params.get("tier"))
        params = _sanitize_params(params)

        cleaned_images, errs = _validate_images(images_in)
        if errs:
            return JSONResponse(
                {"success": False, "error": "image validation failed", "details": errs},
                status_code=400,
            )
        if not cleaned_images:
            return JSONResponse(
                {"success": False, "error": "no usable images in request"},
                status_code=400,
            )

        # Spend cap — enforced at enqueue so we never queue work the user
        # has no budget for. The cap clock is daily UTC.
        user_id = (request.headers.get("x-user-id") or "").strip()
        check_under_cap(user_id)

        # Idempotency — two layers:
        #   1. If a completed result is already cached for this key, return
        #      it inline (mobile sees done immediately, no polling).
        #   2. Otherwise, if a job is already in flight for this key, return
        #      that job_id rather than spawning a new one.
        idem_header = request.headers.get("idempotency-key")
        cache_key = idempotency.cache_key({"params": params, "images": cleaned_images}, idem_header)
        cached_result = idempotency.get(cache_key)
        if cached_result is not None:
            logger.info("[Scan] idempotent inline replay key=...%s", cache_key[-24:])
            return JSONResponse({
                "success": True,
                "status":  "done",
                "data":    cached_result,
                "_idempotent_replay": True,
            })

        existing_job_id = lookup_job_for_key(cache_key)
        if existing_job_id:
            snap = get_job_status(existing_job_id)
            # Don't re-serve a FAILED prior job on retry — fall through to
            # enqueue. `enqueue_diagnosis` enforces the same rule itself
            # (one canonical place for the policy), so a fresh job spawns
            # there even though we found a binding here.
            if snap["status"] != "failed":
                logger.info(
                    "[Scan] idempotent reuse job_id=%s status=%s key=...%s",
                    existing_job_id, snap["status"], cache_key[-24:],
                )
                return JSONResponse({
                    "success": True,
                    "job_id":  existing_job_id,
                    "status":  snap["status"],
                    "data":    snap.get("data"),
                    "_idempotent_replay": True,
                })

        # Enqueue. We propagate request_id + user_id so worker logs carry
        # the same correlation tags the API request had.
        payload = {
            "params":     params,
            "images":     cleaned_images,
            "request_id": request.headers.get("x-request-id") or None,
            "user_id":    user_id or None,
        }
        job_id = enqueue_diagnosis(payload, idempotency_key=cache_key)

        return JSONResponse({
            "success": True,
            "job_id":  job_id,
            "status":  "queued",
        })

    except Exception as exc:
        logger.error("[Scan] enqueue error: %s", exc, exc_info=True)
        return JSONResponse(
            {"success": False, "error": str(exc)},
            status_code=500,
        )


@router.get(
    "/ai/scan/{job_id}",
    dependencies=[Depends(verify_signed_request)],
)
# Per-caller cap (AISVC-6): the mobile client polls every couple of seconds, so
# ~1.5 req/s/user is generous for legitimate polling while making rapid job-id
# enumeration infeasible. Keyed by user (or IP) like the enqueue limiter.
@_scan_limiter.limit("90/minute")
async def ai_scan_status(request: Request, job_id: str = Path(..., min_length=4, max_length=128)):
    """Poll for job status / result.

    Response:
      { "success": true,
        "job_id":  "...",
        "status":  "queued" | "running" | "done" | "failed",
        "data":    <report> | null,
        "error":   <str>    | null }

    When status flips to `done`, the response also caches the result
    under the original idempotency key so a same-key replay returns
    inline without a second worker run.
    """
    try:
        # Object-level authorization (AISVC-2): a user may only poll a job they
        # submitted. The owner is bound at enqueue time. When both the job owner
        # and the caller are known and differ, refuse with 403 (IDOR guard). If
        # the owner is unrecorded (Redis miss / legacy job) we don't hard-fail,
        # since the route already requires the signed Express secret.
        caller = (request.headers.get("x-user-id") or "").strip()
        owner = get_job_owner(job_id)
        if owner and caller and owner != caller:
            logger.warning(
                "[Scan] IDOR blocked: caller=%s tried to read job owned by=%s", caller, owner,
            )
            return JSONResponse(
                {"success": False, "error": "You do not have access to this scan job."},
                status_code=403,
            )

        snap = get_job_status(job_id)
        response: dict = {
            "success": True,
            "job_id":  job_id,
            "status":  snap["status"],
            "data":    snap.get("data"),
            "error":   snap.get("error"),
        }
        # Promote the result into the idempotency cache as well, so a
        # subsequent same-body POST shortcuts inline.
        if snap["status"] == "done" and isinstance(snap.get("data"), dict):
            try:
                # The bound idempotency-key is stored job-side; we don't
                # know it here, so just key by the result's request_id if
                # present. Callers using idempotency-key headers will
                # already have it cached via the worker completion path
                # in a future refinement; this is a best-effort cache.
                req_id = ((snap["data"].get("meta") or {}).get("request_id"))
                if req_id:
                    idempotency.set(f"idem:scan:hdr:{req_id}", snap["data"])
            except Exception:
                pass
        return JSONResponse(response)
    except Exception as exc:
        logger.error("[Scan] status error job_id=%s: %s", job_id, exc, exc_info=True)
        return JSONResponse({"success": False, "error": str(exc)}, status_code=500)


@router.post("/api/v1/crop-disease/agentic-predict")
async def agentic_predict(request: Request):
    """Deprecated stub — use POST /ai/scan via the Express proxy."""
    return JSONResponse(
        {"success": False, "error": "Use /ai/scan via the Express proxy."},
        status_code=400,
    )
