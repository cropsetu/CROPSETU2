"""
Alert Service — generates smart farm alerts for the FarmEasy dashboard.

Model selection
  Reads ONE model + ONE API key from .env via `agents/llm_dispatch`:
    AI_ALERT_MODEL=llama-3.3-70b-versatile    (default: Groq Llama)
    AI_ALERT_API_KEY=gsk_...                  (default: GROQ_API_KEY)
    AI_ALERT_BASE_URL=...                     (optional override)

  No fallback — if the configured model fails, returns an empty alert
  list and logs the error. Admin swaps the model in .env if needed.

Returns a list of alert objects shaped for the mobile dashboard.
"""
from __future__ import annotations
import logging
import json
import re
from datetime import datetime
from typing import Any

from agents.llm_dispatch import call_llm_text, get_feature_config
from services.chat_service import current_season

logger = logging.getLogger(__name__)


_ALERT_PROMPT_TEMPLATE = """You are an Indian agricultural expert AI. Generate 4–6 smart, actionable farm alerts.

FARM CONTEXT:
  Crop       : {crop}
  State      : {state}
  District   : {district}
  Day of Season: {day_of_season}
  Season     : {season}
  Month      : {month}
  Irrigation : {irrigation_type}
  Soil Type  : {soil_type}
  Previous Crop: {previous_crop}
  Land Size  : {land_size}

Generate alerts as a JSON array. Each alert must have:
{{
  "id": "alert_<number>",
  "type": "weather|disease|market|irrigation|fertilizer|harvest",
  "severity": "low|medium|high|critical",
  "title": "<short alert title in 5-8 words>",
  "message": "<2-3 sentence actionable advice specific to this farmer>",
  "action": "<single most important step farmer should take now>",
  "icon": "<Ionicons icon name e.g. cloudy-outline, bug-outline, cash-outline>"
}}

Return ONLY the JSON array. No extra text. Make alerts relevant to current season, crop age, and Indian farming conditions."""


def _parse_alerts(raw: str) -> list[dict[str, Any]]:
    raw = re.sub(r"```(?:json)?\s*", "", raw).strip()
    match = re.search(r"\[[\s\S]*\]", raw)
    if not match:
        return []
    try:
        alerts = json.loads(match.group())
        return [a for a in alerts if isinstance(a, dict) and "title" in a]
    except json.JSONDecodeError:
        return []


async def generate_smart_alerts(farm_context: dict) -> list[dict[str, Any]]:
    """
    farm_context keys (all optional with sensible defaults):
      crop, state, district, day_of_season, irrigation_type,
      soil_type, previous_crop, land_size, current_crops

    Uses the single AI_ALERT_MODEL configured in .env. Returns [] if the
    model call fails (dashboard tolerates missing alerts gracefully).
    """
    prompt = _ALERT_PROMPT_TEMPLATE.format(
        crop=farm_context.get("crop", "Tomato"),
        state=farm_context.get("state", "Maharashtra"),
        district=farm_context.get("district", "Nashik"),
        day_of_season=farm_context.get("day_of_season", 45),
        season=farm_context.get("season", current_season()),
        month=farm_context.get("month", datetime.now().strftime("%B")),
        irrigation_type=farm_context.get("irrigationType") or farm_context.get("irrigation_type", "Drip"),
        soil_type=farm_context.get("soilType") or farm_context.get("soil_type", "Black"),
        previous_crop=farm_context.get("previousCrop") or farm_context.get("previous_crop", "Not specified"),
        land_size=farm_context.get("landSize") or farm_context.get("land_size", "2 acres"),
    )

    cfg = get_feature_config("ALERT")
    try:
        raw, token_info = await call_llm_text(
            cfg,
            system_prompt="You are a JSON-emitting Indian agronomy assistant. Return ONLY valid JSON.",
            user_prompt=prompt,
        )
    except Exception as exc:
        logger.warning("[AlertService] %s failed: %s", cfg.model, exc)
        return []

    if not raw:
        return []
    logger.info("[AlertService] alerts via %s (%d tokens)",
                cfg.model, token_info.get("total_tokens", 0))
    return _parse_alerts(raw)
