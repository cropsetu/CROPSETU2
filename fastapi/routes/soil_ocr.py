"""
Soil Health Card OCR route — POST /ai/soil-card-ocr

Proxied from Express (HMAC-signed). Reads a photographed Soil Health Card and
returns the 12 standard soil parameters as structured JSON for farmer review.
"""
from __future__ import annotations
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from security.auth import verify_signed_request
from services.soil_ocr_service import extract_soil_card

logger = logging.getLogger(__name__)
router = APIRouter(tags=["SoilOCR"])


def _record_soil_ocr_spend(request: Request, result: dict) -> None:
    """Book this OCR call against the caller's daily USD cap.

    Soil-card OCR is a vision call against a full-page photograph, so it is one
    of the more expensive single requests in the system — and it had no metering
    at all. Along with /ai/chat, /ai/alerts and the voice stream that left the
    daily cap measuring scans only, which is precisely what those meters exist
    to prevent.

    Records, does not gate: making OCR 402 on the counter that gates scanning is
    a product decision, not an accounting fix. Never raises — accounting must not
    be able to fail a reply the farmer already received.
    """
    try:
        from security.spend import cost_of, record_spend
        cost = cost_of((result or {}).get("token_info"))
        uid = (request.headers.get("x-user-id") or "").strip()
        if cost > 0 and uid:
            record_spend(uid, cost)
    except Exception:  # noqa: BLE001
        logger.warning("[SoilOCR] record_spend failed (non-fatal)", exc_info=False)


@router.post("/ai/soil-card-ocr", dependencies=[Depends(verify_signed_request)])
async def soil_card_ocr(request: Request):
    body = await request.json()
    image = body.get("image")  # {"data": <base64>, "mime_type": <str>}
    model_override = body.get("model")  # admin App Settings choice (ai.model.soilOcr) | None

    if not (image and isinstance(image, dict) and image.get("data")):
        return JSONResponse({"success": False, "error": "image is required"}, status_code=400)

    try:
        result = await extract_soil_card(image, model_override=model_override)
        _record_soil_ocr_spend(request, result)
        return JSONResponse({"success": True, "data": result})
    except Exception as exc:  # noqa: BLE001
        logger.error("[SoilOCR] Error: %s", exc, exc_info=True)
        return JSONResponse({"success": False, "error": str(exc)}, status_code=500)
