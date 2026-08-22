"""
FarmMind Chat route — POST /ai/chat
Proxied from Express (Gemini). Requires a signed Express→FastAPI request so the
public FastAPI URL can't be hit directly to burn LLM spend (AISVC-1).
"""
from __future__ import annotations
import asyncio
import json
import logging
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from security.auth import verify_signed_request
from services.chat_service import chat_with_farmmind, stream_voice_reply

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Chat"])

# Hard ceiling on the whole chat pipeline. MUST stay below the Express
# callFastAPI timeout (120s) so Express receives a structured error it can map
# (rather than its own AbortError), and so FastAPI stops burning Gemini tokens
# for a reply the client already abandoned. Writer(+enhancer) each have their
# own per-call read timeout + retries; this caps the sum.
def _record_chat_spend(request, result) -> None:
    """Book a chat turn's cost against the caller's daily cap (AI-07).

    /ai/chat, /ai/chat/stream, /ai/alerts and /ai/soil-card-ocr all burned Gemini
    tokens that never reached the counter, so the "daily spend cap" only ever
    measured scans — and a heavy chat user was invisible to it. Never raises:
    accounting must not be able to fail a reply the farmer already paid for.

    NOTE: this RECORDS but does not GATE. Adding check_under_cap here would make
    chat 402 on the same counter that gates scanning, which is a product decision
    rather than an accounting fix.
    """
    try:
        from security.spend import cost_of, record_spend
        # cost_of, not a direct .get(): this used to read `total_cost_usd`, which
        # only ever exists on the orchestrator's pipeline aggregate. A per-call
        # token_info carries `cost_usd`, so the value was always 0.0 and the
        # guard below never opened — see security/spend.cost_of.
        cost = cost_of((result or {}).get("token_info"))
        uid = (request.headers.get("x-user-id") or "").strip()
        if cost > 0 and uid:
            record_spend(uid, cost)
    except Exception:  # noqa: BLE001
        logger.warning("[Chat] record_spend failed (non-fatal)", exc_info=False)


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
    model_override  = body.get("model")  # admin App Settings choice (ai.model.chat) | None

    has_image = bool(image and isinstance(image, dict) and image.get("data"))
    # An image alone is a valid request (the farmer can attach a photo with no text).
    if not message.strip() and not has_image:
        return JSONResponse({"success": False, "error": "message is required"}, 400)

    try:
        result = await asyncio.wait_for(
            chat_with_farmmind(
                message, history, farm_profile,
                response_length=response_length, mode=mode, image=image,
                model_override=model_override,
            ),
            timeout=_CHAT_BUDGET_SEC,
        )
        _record_chat_spend(request, result)
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


@router.post("/ai/chat/stream", dependencies=[Depends(verify_signed_request)])
async def ai_chat_stream(request: Request):
    """Server-Sent-Events streaming variant for the low-latency VOICE path only.

    Streams the spoken reply as it is generated so Express can synthesise and play
    each sentence while later ones are still being written. Emits SSE frames whose
    `data:` payload is one JSON event from stream_voice_reply:
        {"type":"delta","text":...}   then   {"type":"final","reply":...,"followUps":[...],"token_info":{...}}
    On error a single {"type":"error","error":...} frame is emitted and the stream
    closes — Express maps that to a voice:error for the client.
    """
    body = await request.json()
    message         = body.get("message", "")
    history         = body.get("history", [])
    farm_profile    = body.get("farm_profile", {})
    response_length = body.get("response_length", "short")
    model_override  = body.get("model")

    if not message.strip():
        return JSONResponse({"success": False, "error": "message is required"}, 400)

    async def event_gen():
        try:
            async for evt in stream_voice_reply(
                message, history, farm_profile,
                response_length=response_length, model_override=model_override,
            ):
                # The `final` frame carries this turn's token_info and nothing
                # was reading it, so the entire VOICE path — the one farmers who
                # cannot read use most — burned Gemini tokens the daily cap never
                # saw. Metered here rather than after the loop because a client
                # that disconnects mid-stream still consumed everything spent up
                # to the final frame.
                if isinstance(evt, dict) and evt.get("type") == "final":
                    _record_chat_spend(request, evt)
                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001
            logger.error("[ChatStream] %s", exc, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
