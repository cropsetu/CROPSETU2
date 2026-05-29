"""
routes/feedback.py — capture farmer "was this correct?" verdicts.

The mobile app surfaces a thumbs-up / thumbs-down on every report; the
verdict POSTs here. Persisted into ai_scan_feedback (created by
persistence/diagnosis_repo.py). The feedback row joins to
ai_scan_diagnoses.request_id (which the orchestrator stamps as
report.meta.request_id and the mobile app receives as `report_id`).

Why a separate route and not piggybacking on /ai/scan
  Feedback often arrives DAYS after the original scan (the farmer waits
  to see if the recommended action worked). Coupling it to the scan
  request would mean re-uploading state the server has long forgotten.

Future work — Phase 8 reconciler weighting
  Aggregate per-model accuracy across feedback rows offline (eval/) and
  feed it into agents.reconciler.fuse(accuracy_weights=...) so models
  with proven crop-specific accuracy outvote weaker peers. Out of scope
  this round; the table is the foundation.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import JSONResponse

from persistence.diagnosis_repo import record_feedback
from security.auth import verify_signed_request

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Feedback"])


@router.post(
    "/ai/scan/{report_id}/feedback",
    dependencies=[Depends(verify_signed_request)],
)
async def submit_feedback(
    request: Request,
    report_id: str = Path(..., min_length=4, max_length=128),
):
    """
    Body:
      { "was_correct": bool,
        "actual_disease": str?,        # only required when was_correct == false
        "notes":          str? }

    Response:
      { "success": true } on persistence success
      { "success": false, "error": "..." } on validation / persistence failure
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "invalid JSON body"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"success": False, "error": "body must be a JSON object"}, status_code=400)

    if "was_correct" not in body or not isinstance(body["was_correct"], bool):
        return JSONResponse(
            {"success": False, "error": "missing or non-boolean 'was_correct'"},
            status_code=400,
        )

    actual_disease = body.get("actual_disease")
    if actual_disease is not None and not isinstance(actual_disease, str):
        return JSONResponse(
            {"success": False, "error": "'actual_disease' must be a string"},
            status_code=400,
        )
    if body["was_correct"] is False and not actual_disease:
        # Soft requirement: corrections without an actual disease name are
        # less useful for the feedback loop but we still accept them so the
        # signal isn't lost. Just log.
        logger.info("[Feedback] received was_correct=false WITHOUT actual_disease for %s", report_id[:8])

    notes = body.get("notes")
    if notes is not None and not isinstance(notes, str):
        return JSONResponse({"success": False, "error": "'notes' must be a string"}, status_code=400)

    user_id = (request.headers.get("x-user-id") or "").strip() or None

    ok = await record_feedback(
        report_id=report_id,
        was_correct=body["was_correct"],
        actual_disease=actual_disease,
        notes=notes,
        user_id=user_id,
    )
    if not ok:
        return JSONResponse(
            {"success": False, "error": "feedback could not be persisted"},
            status_code=503,
        )
    return JSONResponse({"success": True})
