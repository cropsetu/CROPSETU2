"""
Alert Service — generates smart farm alerts using Groq/Gemini.
Returns a list of alert objects for the FarmEasy dashboard.
"""
from __future__ import annotations
import logging
import json
import re
from datetime import datetime
from typing import Any

import httpx

from config import GROQ_API_KEY, GEMINI_API_KEY, MODEL_GROQ_CHAT, MODEL_GEMINI_CHAT
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


async def _call_groq_json(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": MODEL_GROQ_CHAT,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.5,
                "max_tokens": 1500,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


async def _call_gemini_json(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_GEMINI_CHAT}:generateContent",
            params={"key": GEMINI_API_KEY},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"maxOutputTokens": 1500, "temperature": 0.5,
                                     "responseMimeType": "application/json"},
            },
        )
        resp.raise_for_status()
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()


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

    raw = None

    if GROQ_API_KEY:
        try:
            raw = await _call_groq_json(prompt)
        except Exception as exc:
            logger.warning(f"[AlertService] Groq failed: {exc}")

    if not raw and GEMINI_API_KEY:
        try:
            raw = await _call_gemini_json(prompt)
        except Exception as exc:
            logger.warning(f"[AlertService] Gemini failed: {exc}")

    if not raw:
        return []

    return _parse_alerts(raw)
