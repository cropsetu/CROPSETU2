"""
Krushi Voice-Agent route — POST /ai/voice-agent

Generic, domain-agnostic structured field extraction for the "Hey Krushi" voice
assistant. Express proxies one turn here (transcript + running draft + domain);
we return the merged/validated draft and the next spoken line. Signed Express→
FastAPI request required (AISVC-1) so the public URL can't be hit to burn spend.

Domains live in services/voice_agent_domains.py (farm today; animal-post / rent /
crop-cycle / activity later) — this route never changes when a domain is added.
"""
from __future__ import annotations
import asyncio
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from security.auth import verify_signed_request
from services.voice_agent_service import run_voice_agent_turn

logger = logging.getLogger(__name__)
router = APIRouter(tags=["VoiceAgent"])

# One extraction turn is a single fast JSON call; keep well under the Express
# callFastAPI timeout so Express gets a structured error rather than its own abort.
_TURN_BUDGET_SEC = 45


@router.post("/ai/voice-agent", dependencies=[Depends(verify_signed_request)])
async def ai_voice_agent(request: Request):
    body = await request.json()
    domain_key     = body.get("domain", "")
    transcript     = body.get("transcript", "")
    draft          = body.get("draft", {})
    turn_history   = body.get("turn_history", [])
    farm_profile   = body.get("farm_profile", {})
    model_override = body.get("model")

    if not str(domain_key).strip():
        return JSONResponse({"success": False, "error": "domain is required"}, 400)
    if not str(transcript).strip():
        return JSONResponse({"success": False, "error": "transcript is required"}, 400)

    try:
        result = await asyncio.wait_for(
            run_voice_agent_turn(
                domain_key=domain_key, transcript=transcript, draft=draft,
                turn_history=turn_history, farm_profile=farm_profile,
                model_override=model_override,
            ),
            timeout=_TURN_BUDGET_SEC,
        )
        return JSONResponse({"success": True, "data": result})
    except ValueError as ve:
        # Unknown domain — a client/config error, not an upstream failure.
        return JSONResponse({"success": False, "error": str(ve)}, 400)
    except asyncio.TimeoutError:
        logger.error("[VoiceAgent] turn exceeded %ss budget", _TURN_BUDGET_SEC)
        return JSONResponse(
            {"success": False, "error": "Voice assistant timed out — please try again.",
             "detail": {"code": "voice_agent_timeout"}},
            status_code=504,
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        low = msg.lower()
        if "503" in msg or "high demand" in low or "overloaded" in low or "unavailable" in low:
            status, code = 503, "voice_agent_upstream_busy"
        elif "429" in msg or "quota" in low or "rate limit" in low:
            status, code = 429, "voice_agent_rate_limited"
        else:
            status, code = 500, "voice_agent_failed"
        logger.error("[VoiceAgent] error (%s): %s", status, exc, exc_info=True)
        return JSONResponse(
            {"success": False, "error": msg, "detail": {"code": code, "message": msg}},
            status_code=status,
        )
