"""
KisanRakshak — Pest Prediction Routes (FastAPI)

Endpoints:
  POST /pest/predict          — Agentic AI pest prediction for a farm location
  POST /pest/detect-image     — Pest identification from photo (Claude Vision)
  GET  /pest/prediction-status — Health check for pest prediction service
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import ANTHROPIC_API_KEY, MODEL_DIAGNOSIS
from services.http_clients import get_anthropic
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

_PEST_DETECT_SYSTEM_PROMPT = (
    "You are an expert agricultural entomologist with deep knowledge of pests and "
    "diseases affecting Indian crops. Identify the pest or disease shown in the image "
    "by careful visual inspection of leaf colour, lesion shape, insect morphology, "
    "and any visible damage patterns. Cross-check against the crop and region the "
    "user provides — the same symptoms can indicate different pathogens depending on "
    "host and climate.\n\n"
    "Return a single valid JSON object with these fields and no surrounding prose:\n"
    "  pest_name              — canonical English name\n"
    "  pest_name_hi           — Hindi name (Devanagari)\n"
    "  severity               — one of: low, moderate, high, critical\n"
    "  affected_plant_part    — e.g. leaf, stem, fruit, root, whole plant\n"
    "  confidence             — float in [0, 1] reflecting visual certainty\n"
    "  description            — one-sentence summary of what you see\n"
    "  symptoms               — array of short symptom strings\n"
    "  immediate_action       — first step the farmer should take today\n"
    "  organic_control        — neem / biological / cultural option with dosage\n"
    "  chemical_control       — Indian-market product name with dosage (e.g. "
    "'Imidacloprid 17.8 SL @ 0.3 ml/L')\n"
    "  preventive_measures    — array of practical preventive steps\n\n"
    "If the image is too blurry, poorly lit, or shows something other than a crop, "
    "set confidence below 0.3 and explain in `description`. Never invent product "
    "names. Use only well-established IPM advice."
)


@router.post("/detect-image")
async def detect_pest_from_image(req: PestDetectRequest):
    """
    Upload a pest/crop photo → Agent identifies pest using Claude Vision.
    Returns pest name, severity, affected part, and IPM treatment.

    Uses the official Anthropic SDK (pooled client, automatic retries) and
    marks the system prompt as cache-eligible via `cache_control`. When the
    system prompt grows past Anthropic's caching threshold, repeated calls
    will read it from cache at ~10% the input-token cost.
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="Vision API not configured")

    client = get_anthropic()

    try:
        msg = await client.messages.create(
            model=MODEL_DIAGNOSIS,
            max_tokens=2048,
            system=[
                {
                    "type": "text",
                    "text": _PEST_DETECT_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
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
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Pest image detection failed: %s", exc)
        raise HTTPException(status_code=500, detail="Pest detection failed")

    text = "".join(b.text for b in msg.content if b.type == "text")
    try:
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        result = json.loads(text.strip())
    except json.JSONDecodeError:
        result = {"raw_response": text, "parse_error": True}

    cache_meta = {
        "cache_creation_input_tokens": getattr(msg.usage, "cache_creation_input_tokens", 0) or 0,
        "cache_read_input_tokens":     getattr(msg.usage, "cache_read_input_tokens", 0) or 0,
    }
    return {
        "status": "success",
        "data": result,
        "_meta": {
            "model": MODEL_DIAGNOSIS,
            "input_tokens":  msg.usage.input_tokens,
            "output_tokens": msg.usage.output_tokens,
            **cache_meta,
        },
    }


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
