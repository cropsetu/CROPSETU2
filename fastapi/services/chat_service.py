"""
FarmMind Chat Service — CropGuard AI Backend
Groq (llama-3.3-70b-versatile) primary → Gemini (gemini-2.5-flash) fallback.

Input : message, history (role/content pairs), farm_profile dict
Output: { reply, type, structured_data }
  type: "text" | "diagnosis" | "market"
"""
from __future__ import annotations
import logging
import json
import re
from datetime import datetime
from typing import Any, Optional

import httpx

from config import GROQ_API_KEY, GEMINI_API_KEY, MODEL_GROQ_CHAT, MODEL_GEMINI_CHAT

logger = logging.getLogger(__name__)


# ── Season helper ─────────────────────────────────────────────────────────────

def current_season() -> str:
    """Returns the current Indian agricultural season. Shared across services."""
    m = datetime.now().month
    if 6 <= m <= 9:   return "Kharif (Monsoon)"
    if 10 <= m <= 11: return "Rabi sowing"
    if m >= 12 or m <= 2: return "Rabi (Winter)"
    return "Zaid (Summer)"


# ── System prompt ─────────────────────────────────────────────────────────────

def _build_system_prompt(farm_profile: dict) -> str:
    lang    = farm_profile.get("language", "en")
    crops   = farm_profile.get("crops", [])
    state   = farm_profile.get("state", "India")
    district = farm_profile.get("district", "")
    season  = current_season()
    month   = datetime.now().strftime("%B")

    # ── Farmer identity ──────────────────────────────────────────────────────
    farmer_name = farm_profile.get("farmerName", "")
    experience  = farm_profile.get("experience", "")
    farm_name   = farm_profile.get("farmName", "")
    village     = farm_profile.get("village", "")
    taluka      = farm_profile.get("taluka", "")

    # ── Active crops ─────────────────────────────────────────────────────────
    crop_list = ""
    if crops:
        parts = []
        for c in crops[:5]:
            name  = c.get("name", "")
            stage = c.get("growthStage", "")
            area  = c.get("areaAcres", "")
            variety = c.get("variety", "")
            detail = name
            if variety:
                detail += f" ({variety})"
            if stage:
                detail += f" — {stage}"
            if area:
                detail += f", {area} acres"
            age = c.get("ageInDays")
            if age:
                detail += f", {age} days old"
            parts.append(detail)
        crop_list = "Current crops:\n    " + "\n    ".join(f"• {p}" for p in parts)

    # ── Location ─────────────────────────────────────────────────────────────
    location_parts = [p for p in [village, taluka, district, state] if p]
    location_hint = f"Located in {', '.join(location_parts)}." if location_parts else "Location: India."

    # ── Language ─────────────────────────────────────────────────────────────
    lang_instruction = ""
    if lang in ("hi", "hi-IN", "hi-in"):
        lang_instruction = "Always respond in Hindi (Devanagari script). Keep English technical terms as-is."
    elif lang in ("mr", "mr-IN", "mr-in"):
        lang_instruction = "Always respond in Marathi (Devanagari script). Keep English technical terms as-is."
    elif lang in ("ta", "ta-IN"):
        lang_instruction = "Always respond in Tamil. Keep English technical terms as-is."
    elif lang in ("te", "te-IN"):
        lang_instruction = "Always respond in Telugu. Keep English technical terms as-is."
    elif lang in ("kn", "kn-IN"):
        lang_instruction = "Always respond in Kannada. Keep English technical terms as-is."
    elif lang in ("ml", "ml-IN"):
        lang_instruction = "Always respond in Malayalam. Keep English technical terms as-is."
    elif lang in ("bn", "bn-IN"):
        lang_instruction = "Always respond in Bengali. Keep English technical terms as-is."
    elif lang in ("gu", "gu-IN"):
        lang_instruction = "Always respond in Gujarati. Keep English technical terms as-is."
    elif lang in ("pa", "pa-IN"):
        lang_instruction = "Always respond in Punjabi. Keep English technical terms as-is."
    elif lang not in ("en", "en-IN", "en-in"):
        lang_instruction = f"Respond in the farmer's preferred language ({lang}) where possible."

    soil_hint      = farm_profile.get("soilType", "")
    irr_hint       = farm_profile.get("irrigationType", "")
    land_hint      = farm_profile.get("landSize", "")
    water_sources  = farm_profile.get("waterSources", [])

    # ── Soil health ──────────────────────────────────────────────────────────
    soil_data = farm_profile.get("soil") or {}
    soil_health = ""
    if soil_data:
        soil_parts = []
        if soil_data.get("ph"):
            soil_parts.append(f"pH: {soil_data['ph']} ({soil_data.get('phRating', '')})")
        if soil_data.get("nitrogenRating"):
            soil_parts.append(f"Nitrogen: {soil_data['nitrogenRating']}")
        if soil_data.get("phosphorusRating"):
            soil_parts.append(f"Phosphorus: {soil_data['phosphorusRating']}")
        if soil_data.get("potassiumRating"):
            soil_parts.append(f"Potassium: {soil_data['potassiumRating']}")
        if soil_data.get("organicCarbonRating"):
            soil_parts.append(f"Organic Carbon: {soil_data['organicCarbonRating']}")
        if soil_parts:
            soil_health = "Soil health report: " + ", ".join(soil_parts)

    # ── Crop history ─────────────────────────────────────────────────────────
    recent_cycles = farm_profile.get("recentCycles", [])
    history_hint = ""
    if recent_cycles:
        parts = []
        for rc in recent_cycles[:3]:
            label = rc.get("label", "")
            crop  = rc.get("cropName", "")
            yld   = rc.get("yieldQuintal", "")
            profit = rc.get("netProfitInr", "")
            line = f"{crop}"
            if label:
                line += f" ({label})"
            if yld:
                line += f" — yield: {yld} quintals"
            if profit is not None and profit != "":
                line += f", profit: ₹{profit}"
            parts.append(line)
        history_hint = "Recent crop history:\n    " + "\n    ".join(f"• {p}" for p in parts)

    return f"""You are FarmMind, a senior agronomist and agricultural advisor built by FarmEasy for Indian farmers. You have deep expertise equivalent to an ICAR scientist combined with hands-on field experience across Maharashtra and all major farming states.

EXPERTISE: Crop diseases & pest management (ICAR guidelines), mandi prices & MSP, government schemes (PM-KISAN, PMFBY, Kisan Credit Card), soil health & fertilizers, irrigation & water management, weather-based advisory, seed selection, post-harvest storage, district-level ICAR contingency plans.

FARMER PROFILE:
  {f"Farmer: {farmer_name}" if farmer_name else ""}
  {f"Farm: {farm_name}" if farm_name else ""}
  {f"Experience: {experience} years of farming" if experience else ""}
  {location_hint}
  Season: {season} ({month})
  {crop_list if crop_list else "No active crops registered."}
  {f"Soil type: {soil_hint}" if soil_hint else "Soil type: unknown (ask if relevant)"}
  {soil_health if soil_health else ""}
  {f"Irrigation: {irr_hint}" if irr_hint else "Irrigation: unknown (ask if relevant)"}
  {f"Water sources: {', '.join(water_sources)}" if water_sources else ""}
  {f"Land size: {land_hint} acres" if land_hint else ""}
  {history_hint if history_hint else ""}

IMPORTANT — PERSONALIZED CONTEXT:
  You know this farmer personally. When they ask about "my farm", "my crops", "my soil", etc., use the FARMER PROFILE above to give specific, personalized answers. Never say you don't have information about their farm if the profile data is available above. Reference their specific crops, soil type, location, and history in your advice.

RESPONSE QUALITY RULES:
1. Match depth to question complexity:
   - Complex decisions (crop planning, disease management, soil correction, financial planning):
     Write 350–600 words. Use **bold headers** for sections. Give specific, differentiated advice.
   - Moderate questions (variety selection, fertilizer schedule, pest control):
     Write 200–350 words. Be specific with doses, timing, variety names.
   - Simple factual queries (what is MSP, scheme eligibility, single yes/no):
     Write 80–150 words. Direct answer first, brief context after.
2. Always use real Indian product/brand names (Mancozeb 75WP, DAP, Urea, Chlorpyrifos 20EC, etc.) with exact dosage and timing.
3. Never give one-size-fits-all advice. Always differentiate by:
   - Rainfed vs irrigated land
   - Soil type (black cotton / red laterite / alluvial / sandy loam)
   - Current season and optimal sowing windows
   - District or taluka-level agro-climatic variation when relevant
4. For crop recommendations, ALWAYS cover:
   - Best 2–3 crops for rainfed conditions
   - Best 2–3 crops if irrigation is available
   - ICAR-recommended varieties for that district/region
   - Sowing window and key management tips
   - Market/cash crop potential
   - If taluka or soil type is unknown, mention it affects the answer and ask at the end.
5. For disease queries with symptoms, return the DIAGNOSIS JSON block below.
6. For market/price queries, return the MARKET JSON block below.
7. End complex answers with ONE targeted follow-up question to get missing info (taluka, soil type, water source) that would sharpen the advice further.
8. {lang_instruction or "Respond in English unless the farmer writes in another language."}

DIAGNOSIS JSON FORMAT (use ONLY when farmer describes symptoms or shares disease name):
{{
  "type": "diagnosis",
  "disease": "<Disease name>",
  "confidence": <0-100 integer>,
  "severity": "low|moderate|high|critical",
  "immediateAction": "<single most urgent step>",
  "treatment": {{
    "chemical": "<product + dosage>",
    "organic": "<organic option>",
    "preventive": "<prevention measure>"
  }},
  "expectedRecovery": "<timeframe>",
  "additionalNotes": "<extra context>"
}}

MARKET JSON FORMAT (use ONLY when asked about prices):
{{
  "type": "market",
  "crop": "<crop>",
  "msp": "<MSP in Rs/quintal>",
  "marketRange": "<min-max Rs/quintal>",
  "trend": "rising|stable|falling",
  "bestMarket": "<nearest recommended mandi>",
  "sellingAdvice": "<when/where to sell>"
}}

IMPORTANT: For JSON responses, output ONLY the JSON block — no extra text before or after. For all other responses, output plain text with **bold** for section headers."""


# ── JSON extraction ───────────────────────────────────────────────────────────

def _try_extract_json(text: str) -> Optional[dict]:
    """Pull first JSON object from response, if any."""
    from utils.json_extractor import extract_json
    return extract_json(text)


def _classify_response(text: str, structured: Optional[dict]) -> tuple[str, Optional[dict]]:
    """Return (type, structuredData)."""
    if structured:
        t = structured.get("type", "")
        if t == "diagnosis" or "disease" in structured:
            return "diagnosis", structured
        if t == "market" or "msp" in structured or "marketRange" in structured:
            return "market", structured
    return "text", None


# ── Groq call ─────────────────────────────────────────────────────────────────

async def _call_groq(system: str, messages: list[dict]) -> tuple[str, dict]:
    """Returns (reply_text, token_info)."""
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY not set")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL_GROQ_CHAT,
                "messages": [{"role": "system", "content": system}] + messages,
                "temperature": 0.7,
                "max_tokens": 2048,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usage", {})
        token_info = {
            "model": MODEL_GROQ_CHAT,
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
        return data["choices"][0]["message"]["content"].strip(), token_info


# ── Gemini fallback ───────────────────────────────────────────────────────────

async def _call_gemini(system: str, messages: list[dict]) -> tuple[str, dict]:
    """Returns (reply_text, token_info)."""
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not set")

    # Convert OpenAI-style history to Gemini contents
    contents = []
    for m in messages:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})

    # Prepend system as first user turn
    contents = [{"role": "user", "parts": [{"text": system}]},
                {"role": "model", "parts": [{"text": "Understood. I am FarmMind, ready to help Indian farmers."}]}] + contents

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_GEMINI_CHAT}:generateContent",
            headers={"x-goog-api-key": GEMINI_API_KEY},
            json={"contents": contents, "generationConfig": {"maxOutputTokens": 2048, "temperature": 0.7}},
        )
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usageMetadata", {})
        token_info = {
            "model": MODEL_GEMINI_CHAT,
            "input_tokens": usage.get("promptTokenCount", 0),
            "output_tokens": usage.get("candidatesTokenCount", 0),
            "total_tokens": usage.get("totalTokenCount", 0),
        }
        return data["candidates"][0]["content"]["parts"][0]["text"].strip(), token_info


# ── Public function ───────────────────────────────────────────────────────────

async def chat_with_farmmind(
    message: str,
    history: list[dict],            # [{"role": "user"|"assistant", "content": str}]
    farm_profile: dict,
) -> dict[str, Any]:
    """
    Returns: { reply: str, type: str, structured_data: dict|None }
    """
    logger.info("[ChatService] farm_profile keys: %s", list(farm_profile.keys()))
    logger.info("[ChatService] soilType=%s, irrigationType=%s, crops=%d, district=%s, farmName=%s",
                farm_profile.get("soilType", "MISSING"),
                farm_profile.get("irrigationType", "MISSING"),
                len(farm_profile.get("crops", [])),
                farm_profile.get("district", "MISSING"),
                farm_profile.get("farmName", "MISSING"))

    system   = _build_system_prompt(farm_profile)
    logger.info("[ChatService] System prompt length: %d chars", len(system))
    messages = [{"role": m["role"], "content": m["content"]} for m in history[-20:]]
    messages.append({"role": "user", "content": message})

    reply = None
    token_info = {"model": "none", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    # Try Groq first (FREE)
    if GROQ_API_KEY:
        try:
            reply, token_info = await _call_groq(system, messages)
        except Exception as exc:
            logger.warning(f"[ChatService] Groq failed: {exc} — trying Gemini")

    # Fallback to Gemini (FREE)
    if not reply and GEMINI_API_KEY:
        try:
            reply, token_info = await _call_gemini(system, messages)
        except Exception as exc:
            logger.warning(f"[ChatService] Gemini failed: {exc}")

    if not reply:
        raise RuntimeError("AI service unavailable — all providers failed (Groq, Gemini)")

    structured = _try_extract_json(reply)
    resp_type, structured_data = _classify_response(reply, structured)

    # For structured responses, build a natural-language intro instead of showing raw JSON
    if structured_data:
        if resp_type == "diagnosis":
            disease = structured_data.get("disease", "a crop condition")
            action  = structured_data.get("immediateAction", "")
            notes   = structured_data.get("additionalNotes", "")
            reply   = f"I've diagnosed your crop with **{disease}**. {action}" if action else \
                      f"I've detected **{disease}** in your crop. {notes}".strip()
        elif resp_type == "market":
            crop   = structured_data.get("crop", "your crop")
            advice = structured_data.get("sellingAdvice", "")
            reply  = advice if advice else f"Here are the current market details for {crop}."

    return {"reply": reply, "type": resp_type, "structured_data": structured_data, "token_info": token_info}
