"""
KisanRakshak — Pest Prediction Routes (FastAPI)

Endpoints:
  POST /pest/predict          — Agentic AI pest prediction for a farm location
  POST /pest/detect-image     — Pest identification from photo (Claude Vision)
  GET  /pest/prediction-status — Health check for pest prediction service
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.pest_agent_service import run_pest_prediction_agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pest", tags=["Pest Prediction"])


# ── Request / Response schemas ───────────────────────────────────────────────

class PestPredictionRequest(BaseModel):
    lat: float = Field(..., description="Farm latitude")
    lon: float = Field(..., description="Farm longitude")
    crops: list[str] = Field(default=[], description="Crop names")
    state: str = Field(default="Maharashtra")
    district: str = Field(default="Pune")
    day_of_season: int = Field(default=45, description="Days after sowing")
    language: str = Field(default="en", description="Farmer's language code")
    weather_data: Optional[dict] = Field(default=None, description="Pre-fetched weather from frontend cache — skips redundant API call")


class PestDetectRequest(BaseModel):
    image_base64: str = Field(..., description="Base64 encoded pest/crop image")
    media_type: str = Field(default="image/jpeg")
    crop_name: Optional[str] = None
    state: Optional[str] = None
    language: str = Field(default="en")


# ── POST /pest/predict — Agentic AI prediction ──────────────────────────────

@router.post("/predict")
async def predict_pest_risk(req: PestPredictionRequest):
    """
    Trigger the agentic pest prediction pipeline.

    The Claude agent will autonomously:
    1. Fetch weather data for the location
    2. Check historical pest patterns
    3. Check nearby community reports
    4. Analyze all data using ICAR pest-weather knowledge
    5. Generate risk scores for each relevant pest
    6. Save predictions to database
    7. Return structured prediction with advisory
    """
    try:
        result = await run_pest_prediction_agent(
            lat=req.lat,
            lon=req.lon,
            crops=req.crops,
            state=req.state,
            district=req.district,
            day_of_season=req.day_of_season,
            language=req.language,
            weather_data=req.weather_data,
        )

        return {
            "status": "success",
            "data": result,
            "message": "Pest risk prediction completed",
        }

    except RuntimeError as exc:
        # Honest "unavailable" — no fake data
        logger.warning("Pest prediction unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.exception("Pest prediction failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(exc)}")


# ── POST /pest/detect-image — Pest identification from photo ────────────────

@router.post("/detect-image")
async def detect_pest_from_image(req: PestDetectRequest):
    """
    Upload a pest/crop photo → Agent identifies pest using Claude Vision.
    Returns pest name, severity, affected part, and IPM treatment.
    """
    try:
        import httpx
        from config import ANTHROPIC_API_KEY

        if not ANTHROPIC_API_KEY:
            raise HTTPException(status_code=503, detail="Vision API not configured")

        system_prompt = (
            "You are an expert agricultural entomologist. Identify the pest or disease in this image.\n"
            "Return JSON with: pest_name, pest_name_hi, severity (low/moderate/high/critical),\n"
            "affected_plant_part, confidence (0-1), description, symptoms (array),\n"
            "immediate_action, organic_control, chemical_control, preventive_measures."
        )

        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-6-20250514",
                    "max_tokens": 2048,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": req.media_type,
                                        "data": req.image_base64,
                                    },
                                },
                                {
                                    "type": "text",
                                    "text": (
                                        f"Identify the pest/disease in this crop image.\n"
                                        f"Crop: {req.crop_name or 'Unknown'}\n"
                                        f"Region: {req.state or 'India'}\n"
                                        f"Return your analysis as valid JSON."
                                    ),
                                },
                            ],
                        }
                    ],
                    "system": system_prompt,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        text = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")

        import json
        try:
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            result = json.loads(text.strip())
        except json.JSONDecodeError:
            result = {"raw_response": text, "parse_error": True}

        return {"status": "success", "data": result}

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Pest image detection failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ── GET /pest/prediction-status — Service health ────────────────────────────

@router.get("/prediction-status")
async def prediction_status():
    """Check if the pest prediction service is operational."""
    from config import ANTHROPIC_API_KEY, DATABASE_URL

    return {
        "status": "ok",
        "service": "KisanRakshak Pest Prediction",
        "capabilities": {
            "agentic_ai": bool(ANTHROPIC_API_KEY),
            "rule_based_fallback": True,
            "database": bool(DATABASE_URL),
            "weather_api": True,  # Open-Meteo is always available
        },
    }
