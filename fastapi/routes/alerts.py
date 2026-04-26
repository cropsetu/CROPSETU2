"""
Smart Alerts route — POST /ai/alerts
Returns actionable farming alerts based on farm context.
"""
from __future__ import annotations
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from services.alert_service import generate_smart_alerts

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Alerts"])


@router.post("/ai/alerts")
async def ai_alerts(request: Request):
    body = await request.json()
    farm_profile = body.get("farm_profile", {})

    try:
        alerts = await generate_smart_alerts(farm_profile)
        return JSONResponse({"success": True, "data": {"alerts": alerts}})
    except Exception as exc:
        logger.error("[Alerts] Error: %s", exc, exc_info=True)
        return JSONResponse(
            {"success": False, "error": str(exc)},
            status_code=500,
        )
