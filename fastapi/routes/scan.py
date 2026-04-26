"""
Crop Disease Scan routes.
POST /ai/scan  — used by Express proxy
POST /api/v1/crop-disease/agentic-predict — direct multipart (testing)

Note: The full 5-agent orchestrator requires Claude API.
If agents are not available, returns a graceful error.
"""
from __future__ import annotations
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Scan"])


@router.post("/ai/scan")
async def ai_scan(request: Request):
    """Crop disease scan — proxied from Express."""
    try:
        body = await request.json()
        # The full orchestrator pipeline requires image_quality_agent,
        # weather_analysis_agent, disease_diagnosis_agent, treatment_agent,
        # and report_generator_agent. If not available, return error.
        try:
            from orchestrator import run_diagnosis
        except ImportError as e:
            logger.warning("[Scan] Orchestrator not available: %s", e)
            return JSONResponse(
                {"success": False, "error": "Crop scan agents are being set up. Please try again later."},
                status_code=503,
            )

        images = body.get("images", [])
        params = body.get("params", {})
        result = await run_diagnosis(params, images)
        return JSONResponse({"success": True, "data": result})

    except Exception as exc:
        logger.error("[Scan] Error: %s", exc, exc_info=True)
        return JSONResponse(
            {"success": False, "error": str(exc)},
            status_code=500,
        )


@router.post("/api/v1/crop-disease/agentic-predict")
async def agentic_predict(request: Request):
    """Direct multipart endpoint for testing. Same as /ai/scan but accepts form-data."""
    return JSONResponse(
        {"success": False, "error": "Use /ai/scan via the Express proxy."},
        status_code=400,
    )
