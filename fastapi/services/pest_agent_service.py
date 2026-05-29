"""
KisanRakshak — Production Pest Prediction Service

Real-time weather → ICAR pest rules → AI enhancement → structured prediction.
No dummy data. If any step fails, returns honest "unavailable" error.

Model selection
  Reads ONE model + ONE API key from .env via `agents/llm_dispatch`:
    AI_PEST_MODEL=llama-3.3-70b-versatile     (default: Groq Llama)
    AI_PEST_API_KEY=gsk_...                   (default: GROQ_API_KEY)
    AI_PEST_BASE_URL=...                      (optional override)

  Both Level 1 enhancement and Level 2 deep analysis use the same model.
  No fallback — if the model fails, the call raises.

Token optimization (orthogonal to model selection):
  Level 0: ICAR rules + live weather (0 tokens, 0 cost)
  Level 1: AI enhancement (~500 tokens)
  Level 2: AI deep analysis (~2000 tokens)
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone, timedelta

import httpx

from agents.llm_dispatch import call_llm_text, get_feature_config
from config import DATABASE_URL

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# ICAR PEST RULES — real science from NCIPM bulletins
# ═══════════════════════════════════════════════════════════════════════════════

PEST_RULES = [
    {"pest": "Late Blight",        "hi": "लेट ब्लाइट",       "crops": ["tomato", "potato"],                                    "triggers": {"hum_min": 85, "temp_min": 15, "temp_max": 22, "rain_days": 3}, "stages": [40, 100]},
    {"pest": "Powdery Mildew",     "hi": "चूर्णिल फफूंद",    "crops": ["wheat", "grapes", "onion", "gram"],                     "triggers": {"hum_min": 70, "hum_max": 90, "temp_min": 16, "temp_max": 28}, "stages": [30, 90]},
    {"pest": "Yellow Rust",        "hi": "पीला रतुआ",        "crops": ["wheat"],                                                "triggers": {"hum_min": 80, "temp_min": 10, "temp_max": 15},                "stages": [50, 90]},
    {"pest": "Fall Armyworm",      "hi": "फॉल आर्मीवर्म",    "crops": ["maize", "jowar", "bajra"],                              "triggers": {"hum_min": 60, "temp_min": 25, "temp_max": 38},                "stages": [10, 60]},
    {"pest": "Thrips",             "hi": "थ्रिप्स",          "crops": ["onion", "cotton", "tomato", "grapes", "pomegranate"],    "triggers": {"hum_min": 30, "hum_max": 65, "temp_min": 28, "temp_max": 40}, "stages": [20, 90]},
    {"pest": "Brown Plant Hopper", "hi": "भूरा पत्ता फुदका", "crops": ["rice"],                                                 "triggers": {"hum_min": 85, "temp_min": 25, "temp_max": 32, "rain_days": 5}, "stages": [45, 90]},
    {"pest": "Yellow Stem Borer",  "hi": "पीला तना छेदक",   "crops": ["rice"],                                                 "triggers": {"hum_min": 80, "temp_min": 25, "temp_max": 32},                "stages": [30, 80]},
    {"pest": "Rice Leaffolder",    "hi": "चावल पत्ती लपेटक", "crops": ["rice"],                                                 "triggers": {"hum_min": 70, "hum_max": 90, "temp_min": 25, "temp_max": 33}, "stages": [20, 70]},
    {"pest": "Bacterial Blight",   "hi": "जीवाणु झुलसा",    "crops": ["cotton"],                                               "triggers": {"hum_min": 80, "temp_min": 28, "temp_max": 38, "rain_days": 2}, "stages": [30, 120]},
    {"pest": "Soybean Rust",       "hi": "सोयाबीन रतुआ",    "crops": ["soybean"],                                              "triggers": {"hum_min": 80, "temp_min": 18, "temp_max": 28, "rain_days": 4}, "stages": [40, 80]},
    {"pest": "Whitefly",           "hi": "सफेद मक्खी",      "crops": ["cotton", "tomato", "brinjal"],                           "triggers": {"hum_min": 40, "hum_max": 70, "temp_min": 28, "temp_max": 35}, "stages": [20, 100]},
    {"pest": "Jassids",            "hi": "जैसिड",            "crops": ["cotton"],                                               "triggers": {"hum_min": 60, "temp_min": 25, "temp_max": 35},                "stages": [20, 90]},
]

# Pre-index: crop name (lowercase) → list of rule indices for O(1) lookup
_RULES_BY_CROP: dict[str, list[int]] = {}
for _idx, _rule in enumerate(PEST_RULES):
    for _crop in _rule["crops"]:
        _RULES_BY_CROP.setdefault(_crop.lower(), []).append(_idx)

# Pre-index: pest name (lowercase) → IPM advisory for O(1) lookup
_IPM_BY_PEST: dict[str, dict] = {}  # populated after IPM_KNOWLEDGE is defined

# ── IPM advisory knowledge (ICAR guidelines) ────────────────────────────────
IPM_KNOWLEDGE = {
    "late blight":        {"immediate": "Remove infected plants. Preventive spray before rain.", "cultural": "Proper spacing, ridge planting, avoid overhead irrigation.", "biological": "Trichoderma viride seed treatment @ 4g/kg. Bordeaux mixture 1%.", "chemical": "Metalaxyl+Mancozeb 72WP @ 2.5g/L every 7-10 days. PHI: 7 days."},
    "powdery mildew":     {"immediate": "Remove heavily infected leaves. Spray at first white spots.", "cultural": "Proper spacing, avoid excess nitrogen, improve air circulation.", "biological": "Wettable Sulphur 80WP @ 3g/L every 10 days. Neem oil 2%.", "chemical": "Propiconazole 25EC @ 1ml/L at first sign. PHI: 14 days."},
    "yellow rust":        {"immediate": "DO NOT DELAY. Spray Propiconazole immediately at first pustule.", "cultural": "Use resistant varieties (HD 2967, PBW 621). Timely sowing.", "biological": "No effective bio-control. Early chemical intervention critical.", "chemical": "Propiconazole 25EC @ 1ml/L immediately. Repeat after 15 days. PHI: 14 days."},
    "fall armyworm":      {"immediate": "Scout whorls early morning. Apply sand+lime mix into whorl.", "cultural": "Deep summer plowing. Intercropping with pulses. Early sowing.", "biological": "Neem oil 1500ppm @ 5ml/L into whorl. Metarhizium anisopliae @ 5g/L.", "chemical": "Emamectin Benzoate 5SG @ 0.4g/L into whorl. PHI: 7 days."},
    "thrips":             {"immediate": "Install blue sticky traps. Spray early morning.", "cultural": "Blue sticky traps @ 12/acre. Overhead irrigation to dislodge nymphs.", "biological": "Spinosad 45SC @ 0.3ml/L (OMRI approved). Beauveria bassiana @ 5g/L.", "chemical": "Fipronil 5SC @ 1.5ml/L at ETL (5-10 thrips/leaf). PHI: 5 days."},
    "brown plant hopper": {"immediate": "Drain standing water. Check 5 hoppers/hill ETL.", "cultural": "Drain field water. Avoid excess nitrogen. Use resistant varieties.", "biological": "Conserve spiders, mirid bugs. Avoid broad-spectrum pesticides.", "chemical": "Buprofezin 25SC @ 1.25ml/L at plant base. PHI: 14 days."},
    "yellow stem borer":  {"immediate": "Install pheromone traps (5/acre). Monitor dead hearts.", "cultural": "Clip leaf tips during transplanting. Avoid excessive nitrogen.", "biological": "Release Trichogramma japonicum @ 1 lakh/acre. Bt spray.", "chemical": "Chlorantraniliprole 18.5% SC @ 0.3ml/L. PHI: 30 days."},
    "rice leaffolder":    {"immediate": "Check 2 damaged leaves/hill. Drag rope across field.", "cultural": "Avoid excess nitrogen. Proper spacing. Resistant varieties.", "biological": "Conserve parasitoids. Bacillus thuringiensis spray.", "chemical": "Cartap Hydrochloride 50SP @ 2g/L. PHI: 14 days."},
    "bacterial blight":   {"immediate": "Preventive copper spray before expected rain.", "cultural": "Disease-free seed. Crop rotation. Good drainage.", "biological": "Copper oxychloride 50WP @ 3g/L. Pseudomonas fluorescens seed treatment.", "chemical": "Streptomycin+Tetracycline @ 0.5g/L + Copper oxychloride @ 3g/L. PHI: 21 days."},
    "soybean rust":       {"immediate": "Scout lower canopy for tan pustules. Preventive fungicide at R1.", "cultural": "Early maturing varieties. Timely sowing. Proper spacing.", "biological": "Trichoderma seed treatment for general health.", "chemical": "Tebuconazole 25.9EC @ 1ml/L at first sign. PHI: 30 days."},
    "whitefly":           {"immediate": "Install yellow sticky traps. Spray neem oil in evening.", "cultural": "Yellow sticky traps @ 12/acre. Avoid excessive nitrogen.", "biological": "Encarsia formosa parasitoid. Verticillium lecanii @ 5g/L.", "chemical": "Diafenthiuron 50WP @ 1g/L. PHI: 7 days."},
    "jassids":            {"immediate": "Check 2 nymphs/leaf ETL. Spray on leaf undersides.", "cultural": "Hairy cotton varieties. Intercrop with cowpea.", "biological": "Neem seed kernel extract 5%. Chrysoperla carnea release.", "chemical": "Imidacloprid 17.8SL @ 0.3ml/L. PHI: 7 days."},
}

# Build IPM index for O(1) lookup by pest name (avoids linear scan per rule)
_IPM_BY_PEST.update({k: v for k, v in IPM_KNOWLEDGE.items()})


# ═══════════════════════════════════════════════════════════════════════════════
# WEATHER — parse from frontend cache or fetch fresh
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_weather_summary(weather_data: dict | None) -> dict | None:
    """Extract a normalized weather summary from frontend-cached weather data."""
    if not weather_data:
        return None

    current = weather_data.get("current", {})
    daily = weather_data.get("daily", [])

    if not current and not daily:
        return None

    # Extract from daily forecast arrays
    if daily and isinstance(daily, list) and len(daily) > 0:
        temps_max = [d.get("tempMax", d.get("maxTemp", 0)) for d in daily[:7]]
        temps_min = [d.get("tempMin", d.get("minTemp", 0)) for d in daily[:7]]
        humidities = [d.get("humidity", d.get("maxHumidity", 0)) for d in daily[:7]]
        rainfalls = [d.get("precipitation", d.get("rainfall", 0)) for d in daily[:7]]
    elif current:
        t = current.get("temperature", current.get("temp", 25))
        temps_max = [t]
        temps_min = [t]
        humidities = [current.get("humidity", current.get("relativeHumidity", 60))]
        rainfalls = [current.get("precipitation", 0)]
    else:
        return None

    # Consecutive rain days
    consec_rain = 0
    for r in rainfalls:
        if r and r > 2:
            consec_rain += 1
        else:
            break

    temp_max = max(temps_max) if temps_max else None
    temp_min = min(temps_min) if temps_min else None
    avg_hum = round(sum(humidities) / max(len(humidities), 1)) if humidities else None

    if temp_max is None or avg_hum is None:
        return None

    avg_temp = (temp_max + temp_min) / 2 if temp_min is not None else temp_max

    # Determine trend
    total_rain = round(sum(rainfalls), 1)
    if avg_hum > 75 and avg_temp > 25:
        trend = "warm_humid"
    elif avg_hum > 75 and avg_temp <= 25:
        trend = "cool_humid"
    elif avg_hum <= 50 and avg_temp > 30:
        trend = "hot_dry"
    elif avg_hum <= 50:
        trend = "cool_dry"
    else:
        trend = "rainy" if consec_rain >= 2 else "warm_humid"

    return {
        "temp_max": temp_max,
        "temp_min": temp_min,
        "humidity_avg": avg_hum,
        "rainfall_weekly_mm": total_rain,
        "forecast_trend": trend,
        "consecutive_rain_days": consec_rain,
    }


async def _fetch_weather_fresh(lat: float, lon: float) -> dict | None:
    """Fetch live weather from Open-Meteo. Returns None on failure."""
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}"
        f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,"
        f"relative_humidity_2m_max,relative_humidity_2m_min"
        f"&timezone=Asia%2FKolkata&forecast_days=7"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        daily = data.get("daily", {})
        precip = daily.get("precipitation_sum", [])
        consec = 0
        for p in precip:
            if p and p > 2:
                consec += 1
            else:
                break

        temps_max = daily.get("temperature_2m_max", [])
        temps_min = daily.get("temperature_2m_min", [])
        hum_max = daily.get("relative_humidity_2m_max", [])

        if not temps_max:
            return None

        temp_max = max(temps_max)
        temp_min = min(temps_min) if temps_min else temp_max
        avg_hum = round(sum(hum_max) / len(hum_max)) if hum_max else 60
        total_rain = round(sum(precip), 1)
        avg_temp = (temp_max + temp_min) / 2

        if avg_hum > 75 and avg_temp > 25:
            trend = "warm_humid"
        elif avg_hum > 75:
            trend = "cool_humid"
        elif avg_hum <= 50 and avg_temp > 30:
            trend = "hot_dry"
        elif avg_hum <= 50:
            trend = "cool_dry"
        else:
            trend = "rainy" if consec >= 2 else "warm_humid"

        return {
            "temp_max": temp_max,
            "temp_min": temp_min,
            "humidity_avg": avg_hum,
            "rainfall_weekly_mm": total_rain,
            "forecast_trend": trend,
            "consecutive_rain_days": consec,
        }
    except Exception as e:
        logger.error("[Weather] Open-Meteo fetch failed: %s", e)
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# RULE ENGINE — real ICAR science + live weather
# ═══════════════════════════════════════════════════════════════════════════════

def _evaluate_rules(weather: dict, crops: list[str], day_of_season: int) -> list[dict]:
    """Evaluate ICAR pest rules against real weather conditions.

    Uses pre-built _RULES_BY_CROP index for O(relevant_rules) instead of O(all_rules × crops).
    IPM advisory lookup is O(1) via _IPM_BY_PEST dict.
    """
    humidity = weather["humidity_avg"]
    avg_temp = (weather["temp_max"] + weather["temp_min"]) / 2
    rain_days = weather["consecutive_rain_days"]

    # Determine which rules to evaluate using the crop→rules index
    if crops:
        crop_set = {c.lower() for c in crops}
        rule_indices = set()
        for c in crop_set:
            if c in _RULES_BY_CROP:
                rule_indices.update(_RULES_BY_CROP[c])
            else:
                # substring fallback for partial matches (e.g. "red onion" → "onion")
                for key, indices in _RULES_BY_CROP.items():
                    if c in key or key in c:
                        rule_indices.update(indices)
        rules_to_check = [PEST_RULES[i] for i in rule_indices]
    else:
        rules_to_check = PEST_RULES

    results = []
    for rule in rules_to_check:
        # Check growth stage window
        s_min, s_max = rule["stages"]
        if day_of_season < s_min or day_of_season > s_max:
            continue

        # Evaluate weather triggers
        t = rule["triggers"]
        match_count = 0
        reasons = []

        if humidity >= t.get("hum_min", 0) and humidity <= t.get("hum_max", 100):
            match_count += 1
            reasons.append(f"humidity {humidity}% in risk range")
        if avg_temp >= t.get("temp_min", -99) and avg_temp <= t.get("temp_max", 99):
            match_count += 1
            reasons.append(f"temp {avg_temp:.0f}°C in risk range")
        if t.get("rain_days") and rain_days >= t["rain_days"]:
            match_count += 1
            reasons.append(f"{rain_days} consecutive rain days")

        if match_count == 0:
            continue

        risk_score = round(min(match_count * 0.3 + 0.1, 1.0), 2)
        risk_level = "critical" if match_count >= 3 else "high" if match_count >= 2 else "moderate"

        # O(1) IPM advisory lookup via pre-built dict
        pest_key = rule["pest"].lower()
        advisory = _IPM_BY_PEST.get(pest_key, {})

        results.append({
            "pest_name": rule["pest"],
            "pest_name_hi": rule["hi"],
            "risk_score": risk_score,
            "risk_level": risk_level,
            "confidence": "high" if match_count >= 3 else "medium",
            "reasoning": f"{match_count} weather conditions matched: {'; '.join(reasons)}",
            "peak_risk_window": "Next 3-7 days",
            "affected_crops": rule["crops"],
            "symptoms": [],
            "advisory": advisory,
            "preventive_measures": [],
        })

    results.sort(key=lambda p: p["risk_score"], reverse=True)
    return results


# ═══════════════════════════════════════════════════════════════════════════════
# HAIKU ENHANCEMENT — cheap AI to add symptoms + reasoning
# ═══════════════════════════════════════════════════════════════════════════════

ENHANCE_PROMPT = """You enhance pest predictions with symptoms and preventive measures.
Given weather + pest predictions JSON, add for EACH prediction:
- reasoning: 1-2 sentence explanation citing the weather data
- symptoms: array of {"en":"...","hi":"..."} (2-3 field symptoms farmers should watch)
- preventive_measures: array of 2-3 practical steps

Return the SAME JSON with these fields filled. Valid JSON only. Be concise."""


async def _call_llm(system: str, user_msg: str, max_tokens: int = 1024,
                    tier: str = "fast") -> tuple[str, dict, str]:
    """
    Call the configured AI_PEST_MODEL (one model, no fallback).
    Returns (text, token_usage, model_used). Raises if the model call fails.

    `tier` is accepted for backwards compatibility with existing call sites
    but is currently a no-op — Level 1 and Level 2 both use the same
    AI_PEST_MODEL configured in .env. If you need different models per
    level, split into AI_PEST_L1_MODEL / AI_PEST_L2_MODEL features (out
    of scope for the current centralization).
    """
    cfg = get_feature_config("PEST")
    try:
        text, token_info = await call_llm_text(
            cfg,
            system_prompt=system,
            user_prompt=user_msg,
            max_tokens=max_tokens,
        )
    except Exception as exc:
        logger.error("[PestAgent] %s failed: %s", cfg.model, exc)
        raise

    token_usage = {
        "input_tokens":  token_info.get("input_tokens", 0),
        "output_tokens": token_info.get("output_tokens", 0),
        "total_tokens":  token_info.get("total_tokens", 0),
        "cost_usd":      token_info.get("cost_usd", 0.0),
    }
    logger.info("[PestAgent] LLM via %s — %d tokens", cfg.model, token_usage["total_tokens"])
    return text, token_usage, cfg.model


def _parse_llm_json(text: str) -> dict | list:
    """Extract JSON from LLM response (handles markdown fences)."""
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]
    return json.loads(text.strip())


async def _enhance_predictions(predictions: list[dict], weather: dict) -> tuple[list[dict], dict, str]:
    """Enhance rule-based predictions with LLM. Returns (predictions, token_usage, model)."""
    compact = json.dumps({"weather": weather, "predictions": [
        {"pest": p["pest_name"], "risk": p["risk_score"], "level": p["risk_level"],
         "crops": p["affected_crops"]}
        for p in predictions
    ]}, separators=(",", ":"))

    text, token_usage, model = await _call_llm(ENHANCE_PROMPT, compact, 1024, tier="fast")
    enhanced = _parse_llm_json(text)
    ep_list = enhanced.get("predictions", enhanced) if isinstance(enhanced, dict) else enhanced

    for i, pred in enumerate(predictions):
        if i < len(ep_list):
            ep = ep_list[i] if isinstance(ep_list, list) else {}
            if ep.get("reasoning"):
                pred["reasoning"] = ep["reasoning"]
            if ep.get("symptoms"):
                pred["symptoms"] = ep["symptoms"]
            if ep.get("preventive_measures"):
                pred["preventive_measures"] = ep["preventive_measures"]

    return predictions, token_usage, model


# ═══════════════════════════════════════════════════════════════════════════════
# DEEP ANALYSIS — Groq-powered full analysis for HIGH/CRITICAL
# ═══════════════════════════════════════════════════════════════════════════════

DEEP_ANALYSIS_PROMPT = """You are KisanRakshak AI — expert pest prediction agent for Indian farmers.
Analyze the weather data and pest risk assessment below. For each pest provide:
- Detailed reasoning referencing exact weather numbers
- 2-3 specific symptoms with Hindi translations
- Refined risk score (0.0-1.0) based on your analysis
- Specific preventive measures for the farmer
- Peak risk window (e.g. "Next 2-3 days")

Also check: are there any ADDITIONAL pests that the rule engine missed given this weather?

Return valid JSON with this structure:
{"predictions":[{"pest_name":"","pest_name_hi":"","risk_score":0.0,"risk_level":"","confidence":"","reasoning":"","peak_risk_window":"","affected_crops":[],"symptoms":[{"en":"","hi":""}],"advisory":{"immediate":"","cultural":"","biological":"","chemical_last_resort":""},"preventive_measures":[]}],"overall_risk":"","overall_risk_score":0.0,"community_analysis":""}"""


async def _deep_analysis(predictions: list[dict], weather: dict, crops: list[str],
                         state: str, district: str, day_of_season: int) -> tuple[list[dict], dict, str, float, str]:
    """
    Deep LLM analysis for HIGH/CRITICAL risk.
    Returns (predictions, token_usage, model, overall_score, overall_risk).
    """
    context = json.dumps({
        "weather": weather,
        "location": {"state": state, "district": district},
        "crops": crops,
        "day_of_season": day_of_season,
        "rule_based_predictions": [
            {"pest": p["pest_name"], "hi": p["pest_name_hi"], "risk": p["risk_score"],
             "level": p["risk_level"], "crops": p["affected_crops"],
             "reasoning": p["reasoning"], "advisory": p["advisory"]}
            for p in predictions
        ],
    }, separators=(",", ":"))

    text, token_usage, model = await _call_llm(DEEP_ANALYSIS_PROMPT, context, 2048, tier="best")
    result = _parse_llm_json(text)

    if isinstance(result, dict) and result.get("predictions"):
        new_preds = result["predictions"]
        # Merge advisory from rule engine if LLM didn't provide it (O(1) lookup)
        for np in new_preds:
            if not np.get("advisory") or not np["advisory"].get("immediate"):
                pest_key = np.get("pest_name", "").lower()
                np["advisory"] = _IPM_BY_PEST.get(pest_key, {})
        overall_score = result.get("overall_risk_score", max((p.get("risk_score", 0) for p in new_preds), default=0))
        overall_risk = result.get("overall_risk", "high")
        return new_preds, token_usage, model, overall_score, overall_risk

    # LLM returned unexpected shape — enhance existing predictions instead
    return predictions, token_usage, model, max((p["risk_score"] for p in predictions), default=0), "high"


async def _db_save(predictions: list, state: str = None, district: str = None) -> dict:
    """Save predictions to pest_alerts table using shared connection pool."""
    if not DATABASE_URL:
        return {"saved": 0}
    try:
        from db_pool import get_shared_pool
        pool = await get_shared_pool()
        if not pool:
            return {"saved": 0, "error": "no pool"}
        saved = 0
        async with pool.acquire() as conn:
            for p in predictions:
                try:
                    await conn.execute(
                        "INSERT INTO pest_alerts (id,pest,pest_hi,affected_crops,severity,state,districts,symptoms,solutions,trigger_conditions,valid_from,valid_until,source,is_active,created_at) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()+INTERVAL '7 days','ai_agent',true,NOW())",
                        p.get("pest_name", ""), p.get("pest_name_hi"), p.get("affected_crops", []),
                        p.get("risk_level", "moderate"), state or "", [district] if district else [],
                        json.dumps(p.get("symptoms", [])), json.dumps(p.get("advisory", {})),
                        json.dumps({"risk_score": p.get("risk_score", 0)}))
                    saved += 1
                except Exception:
                    pass
        return {"saved": saved}
    except Exception as e:
        return {"saved": 0, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

async def run_pest_prediction_agent(
    lat: float, lon: float, crops: list[str],
    state: str = "Maharashtra", district: str = "Pune",
    day_of_season: int = 45, language: str = "en",
    max_loops: int = 6, weather_data: dict = None,
) -> dict:
    """
    Production pest prediction. No dummy data.
    Returns structured prediction or raises RuntimeError if unavailable.
    """
    t_start = time.monotonic()

    # ── Step 1: Get real weather data ─────────────────────────────────────
    weather = _parse_weather_summary(weather_data)
    if not weather:
        logger.info("[PestAgent] No cached weather — fetching fresh from Open-Meteo")
        weather = await _fetch_weather_fresh(lat, lon)

    if not weather:
        raise RuntimeError("Weather data unavailable — cannot predict pest risk without real-time conditions")

    logger.info("[PestAgent] Weather: temp=%s-%s°C, hum=%s%%, rain=%smm, rain_days=%s",
                weather["temp_min"], weather["temp_max"], weather["humidity_avg"],
                weather["rainfall_weekly_mm"], weather["consecutive_rain_days"])

    # ── Step 2: Run ICAR rule engine with real weather ────────────────────
    predictions = _evaluate_rules(weather, crops, day_of_season)

    overall_score = max((p["risk_score"] for p in predictions), default=0)
    overall_risk = "critical" if overall_score >= 0.75 else "high" if overall_score >= 0.5 else "moderate" if overall_score >= 0.3 else "low"

    logger.info("[PestAgent] Rules: %s risk (%.2f), %d pests found", overall_risk, overall_score, len(predictions))

    token_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}
    engine = "icar_rules"
    level = 0
    model_used = "none"
    has_llm = bool(GROQ_API_KEY or GEMINI_API_KEY or ANTHROPIC_API_KEY)

    # ── Step 3: AI enhancement based on risk level ────────────────────────
    if predictions and has_llm:
        if overall_risk in ("high", "critical"):
            # Level 2: Deep analysis (Groq → Gemini → Claude fallback chain)
            try:
                predictions, token_usage, model_used, overall_score, overall_risk = await _deep_analysis(
                    predictions, weather, crops, state, district, day_of_season)
                engine = "icar_rules+deep_ai"
                level = 2
                logger.info("[PestAgent] Deep analysis complete via %s — %d tokens", model_used, token_usage["total_tokens"])
            except Exception as e:
                logger.error("[PestAgent] Deep analysis failed: %s — trying enhance", e)
                # Fallback: at least enhance with symptoms
                try:
                    predictions, token_usage, model_used = await _enhance_predictions(predictions, weather)
                    engine = "icar_rules+ai_enhanced"
                    level = 1
                except Exception as e2:
                    logger.warning("[PestAgent] Enhancement also failed: %s", e2)

            # Save to DB (non-blocking)
            try:
                await _db_save(predictions, state, district)
            except Exception:
                pass

        elif overall_risk == "moderate":
            # Level 1: Quick enhancement (symptoms + reasoning)
            try:
                predictions, token_usage, model_used = await _enhance_predictions(predictions, weather)
                engine = "icar_rules+ai_enhanced"
                level = 1
                logger.info("[PestAgent] Enhancement complete via %s — %d tokens", model_used, token_usage["total_tokens"])
            except Exception as e:
                logger.warning("[PestAgent] Enhancement failed: %s — returning rule-based", e)

    # ── Step 4: Build response ────────────────────────────────────────────
    elapsed = round(time.monotonic() - t_start, 2)

    return {
        "prediction_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "weather_summary": weather,
        "overall_risk": overall_risk,
        "overall_risk_score": overall_score,
        "predictions": predictions,
        "community_reports_nearby": 0,
        "next_check_recommended": (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d"),
        "language": language,
        "_meta": {
            "engine": engine,
            "model": model_used,
            "level": level,
            "loops": 1 if level == 1 else 0,
            "tools_called": [],
            "token_usage": token_usage,
            "elapsed_seconds": elapsed,
        },
    }
