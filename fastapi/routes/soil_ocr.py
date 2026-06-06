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


@router.post("/ai/soil-card-ocr", dependencies=[Depends(verify_signed_request)])
async def soil_card_ocr(request: Request):
    body = await request.json()
    image = body.get("image")  # {"data": <base64>, "mime_type": <str>}

    if not (image and isinstance(image, dict) and image.get("data")):
        return JSONResponse({"success": False, "error": "image is required"}, status_code=400)

    try:
        result = await extract_soil_card(image)
        return JSONResponse({"success": True, "data": result})
    except Exception as exc:  # noqa: BLE001
        logger.error("[SoilOCR] Error: %s", exc, exc_info=True)
        return JSONResponse({"success": False, "error": str(exc)}, status_code=500)
