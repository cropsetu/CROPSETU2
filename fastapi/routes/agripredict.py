"""
AgriPredict routes — crop yield/price prediction endpoints.
"""
from __future__ import annotations
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agripredict", tags=["AgriPredict"])


@router.post("/predict")
async def predict(request: Request):
    body = await request.json()
    try:
        from services.pest_agent_service import predict_pest_risk
        result = await predict_pest_risk(body)
        return JSONResponse({"success": True, "data": result})
    except ImportError:
        return JSONResponse(
            {"success": False, "error": "AgriPredict service not available"},
            status_code=503,
        )
    except Exception as exc:
        logger.error("[AgriPredict] Error: %s", exc, exc_info=True)
        return JSONResponse({"success": False, "error": str(exc)}, status_code=500)
