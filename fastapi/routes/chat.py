"""
FarmMind Chat route — POST /ai/chat
Proxied from Express (Gemini). Requires a signed Express→FastAPI request so the
public FastAPI URL can't be hit directly to burn LLM spend (AISVC-1).
"""
from __future__ import annotations
import asyncio
import logging
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from security.auth import verify_signed_request
from services.chat_service import chat_with_farmmind

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Chat"])

# Hard ceiling on the whole chat pipeline. MUST stay below the Express
# callFastAPI timeout (120s) so Express receives a structured error it can map
# (rather than its own AbortError), and so FastAPI stops burning Gemini tokens
# for a reply the client already abandoned. Writer(+enhancer) each have their
# own per-call read timeout + retries; this caps the sum.
_CHAT_BUDGET_SEC = 100


@router.post("/ai/chat", dependencies=[Depends(verify_signed_request)])
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
        result = await asyncio.wait_for(
            chat_with_farmmind(
                message, history, farm_profile,
                response_length=response_length, mode=mode, image=image,
            ),
            timeout=_CHAT_BUDGET_SEC,
        )
        return JSONResponse({"success": True, "data": result})
    except asyncio.TimeoutError:
        logger.error("[Chat] pipeline exceeded %ss budget", _CHAT_BUDGET_SEC)
        return JSONResponse(
            {"success": False, "error": "Chat timed out — please try again.",
             "detail": {"code": "chat_timeout", "message": "AI took too long to respond."}},
            status_code=504,
        )
    except Exception as exc:
        # Map upstream Gemini overload/limit to a RETRYABLE status so the client
        # shows "busy — retry" instead of a generic failure. chat_service wraps
        # the httpx error in a RuntimeError (dropping the status code), so we
        # sniff the reason from the message text.
        msg = str(exc)
        low = msg.lower()
        if "503" in msg or "high demand" in low or "overloaded" in low or "unavailable" in low:
            status, code = 503, "chat_upstream_busy"
        elif "429" in msg or "quota" in low or "rate limit" in low:
            status, code = 429, "chat_rate_limited"
        else:
            status, code = 500, "chat_upstream_failed"
        logger.error("[Chat] Error (%s): %s", status, exc, exc_info=True)
        return JSONResponse(
            {"success": False, "error": msg, "detail": {"code": code, "message": msg}},
            status_code=status,
        )
