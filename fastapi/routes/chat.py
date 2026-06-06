"""
FarmMind Chat route — POST /ai/chat
Proxied from Express. Uses Groq (primary) with Gemini fallback.
"""
from __future__ import annotations
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from services.chat_service import chat_with_farmmind

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Chat"])


@router.post("/ai/chat")
async def ai_chat(request: Request):
    body = await request.json()
    message         = body.get("message", "")
    history         = body.get("history", [])
    farm_profile    = body.get("farm_profile", {})
    response_length = body.get("response_length", "short")
    mode            = body.get("mode", "text")
    image           = body.get("image")  # {"data": <base64>, "mime_type": <str>} | None

    has_image = bool(image and isinstance(image, dict) and image.get("data"))
    # An image alone is a valid request (the farmer can attach a photo with no text).
    if not message.strip() and not has_image:
        return JSONResponse({"success": False, "error": "message is required"}, 400)

    try:
        result = await chat_with_farmmind(
            message, history, farm_profile,
            response_length=response_length, mode=mode, image=image,
        )
        return JSONResponse({"success": True, "data": result})
    except Exception as exc:
        logger.error("[Chat] Error: %s", exc, exc_info=True)
        return JSONResponse(
            {"success": False, "error": str(exc)},
            status_code=500,
        )
