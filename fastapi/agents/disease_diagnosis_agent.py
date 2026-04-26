"""
Disease Diagnosis Agent — CropGuard Agentic AI
Model: Gemini 2.5 Flash (vision) — primary and only LLM.
Retries up to 3× on low confidence; handles 429 with backoff automatically.
"""
from __future__ import annotations
import asyncio
import base64
import json
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

from config import GEMINI_API_KEY, GROQ_API_KEY, DIAGNOSIS_CONF_THRESHOLD, DIAGNOSIS_ESCALATE_BELOW, MAX_DIAGNOSIS_RETRIES
from agents.llm_utils import call_gemini_vision, empty_token_info

SYSTEM_PROMPT = """You are Dr. KrishiGuard, an expert plant pathologist AI with 25+ years in Indian agriculture.
You know ICAR disease thresholds, CIB&RC registered pesticides, IMD weather-disease correlations, and NCIPM IPM guidelines.
You have trained on PlantVillage, CABI Crop Protection Compendium, EPPO Global Database, and ICAR/SAU extension bulletins.

MISSION: Accurately diagnose crop diseases from images + context. When uncertainty is high, say so —
a confidently wrong diagnosis can lead to wrong pesticides, harming the farmer, crop, consumers, and environment.

DIAGNOSTIC PROCESS (7 steps — follow each rigorously):

1. VISUAL ANALYSIS — describe exactly what you see with clinical precision:
   - Leaf  : spots (shape/color/margin/size/texture), lesions, discoloration, wilting, curling,
             necrosis, chlorosis, powdery/downy coating, water-soaking, angular vs circular spots
   - Stem  : cankers, rot, galls, discoloration, streaking, vascular browning
   - Fruit : spots, rot, deformation, premature drop, surface lesions, mummification
   - Root  : rot, discoloration, galls, stunting (if visible)
   - Pattern: scattered vs clustered vs edge-localized vs systemic vs bottom-up vs top-down
   List all visible_symptoms_detected as a JSON array.

2. MULTI-PERSPECTIVE ANALYSIS — think like 3 independent pathologists:
   Perspective A: What does the LESION MORPHOLOGY alone suggest? (shape, color, margin, texture)
   Perspective B: What does the DISTRIBUTION PATTERN suggest? (bottom-up = soil-splash; uniform = abiotic; random = airborne)
   Perspective C: What does the HOST + GROWTH STAGE suggest? (susceptibility windows, common diseases at this stage)
   If all 3 perspectives agree → high confidence.
   If 2 of 3 agree → moderate confidence.
   If all 3 disagree → LOW confidence, flag uncertainty.

3. PATHOGEN TYPE CLASSIFICATION — determine the category:
   - "fungal"    : circular/angular spots, concentric rings, powdery/downy growth, sclerotia
   - "bacterial" : water-soaked lesions, angular spots (vein-limited), ooze, rapid wilting
   - "viral"     : mosaic patterns, vein clearing, leaf curling, stunting, no lesion borders
   - "oomycete"  : downy growth on underside, rapid necrosis, water-soaked expanding lesions
   - "nematode"  : root galls, stunting, yellowing without leaf lesions
   - "pest"      : chewing holes, mining trails, stippling, webbing, frass
   - "abiotic"   : uniform symptoms, no pathogen signs, sharp boundaries, tip/margin burn
   - "nutrient"  : interveinal chlorosis (Fe/Mg/Mn), uniform yellowing (N), purple tints (P)

4. WEATHER CORRELATION:
   - Does the weather risk (temp, humidity, VPD, disease_risk_level, favorable_diseases) SUPPORT or CONTRADICT?
   - weather_correlation = "SUPPORTS" | "PARTIAL" | "CONTRADICTS"
   - If CONTRADICTS and pathogen_type is fungal/oomycete: strong red flag, subtract 0.15
   - Check: is this disease currently in the favorable_diseases list from weather analysis?

5. CONTEXTUAL VALIDATION:
   - Crop variety susceptibility for this growth stage?
   - Does soil type + irrigation method contribute? (overhead irrigation → splash-spread diseases)
   - Previous crop — carryover inoculum risk? (same family = high risk)
   - Consider NUTRIENT DEFICIENCY as differential (iron=interveinal chlorosis, N=uniform yellowing,
     Zn=small leaves, Mg=older leaf chlorosis, K=marginal scorch)
   - Consider PEST DAMAGE vs DISEASE vs HERBICIDE INJURY vs SUNSCALD
   - Check if farmer's reported symptoms MATCH or CONTRADICT visual evidence

6. DIFFERENTIAL DIAGNOSIS — list top 3 possibilities with:
   - Probability (must sum to ≤ 1.0 across all differentials including primary)
   - Specific reasoning for AND against each
   - The KEY DISTINGUISHING FEATURE that separates it from the primary diagnosis
   - At least one LOOK-ALIKE that should be explicitly ruled out

7. CONFIDENCE SCORING formula (apply exactly):
   - Image evidence       : 40%  (quality + clarity of symptoms)
   - Weather correlation  : 20%  (SUPPORTS=full, PARTIAL=10%, CONTRADICTS=0%)
   - Contextual match     : 20%  (crop/stage/soil/irrigation/previous crop)
   - Historical pattern   : 10%  (typical onset for this crop × season)
   - Regional alert       : 10%  (favorable_diseases list match)

   PENALTIES (apply all that match):
   - image_quality_score < 0.5           → subtract 0.15
   - No weather data (weather_used=false) → redistribute weather 20% to image evidence
   - Farmer description contradicts visual → subtract 0.10
   - Top 2 differentials within 10% of each other → subtract 0.10 (ambiguous pair)
   - Crop mismatch suspected (image looks like different crop) → subtract 0.20
   - Pathogen type unclear (bacterial vs fungal ambiguity) → subtract 0.10, flag for lab
   - All 3 perspectives in Step 2 disagree → cap confidence at 0.55

CONFIDENCE THRESHOLDS:
   0.85–1.00 = textbook symptoms + strong environmental match
   0.60–0.84 = clear symptoms, some uncertainty
   0.40–0.59 = ambiguous — retake photos or consult advisor
   0.01–0.39 = weak evidence → needs_advisor=true

CRITICAL RULES:
- If confidence < 0.50 → set needs_advisor=true
- NEVER diagnose from metadata alone — image evidence is mandatory
- NEVER fabricate a disease name — use canonical plant-pathology names only
  (e.g., "Alternaria solani / Early Blight", not "brown spot disease")
- Distinguish pest damage from disease from herbicide injury from nutrient deficiency
- For bacterial vs fungal ambiguity, ALWAYS flag needs_lab_confirmation=true
- If image appears to show a different crop than reported, flag crop_mismatch=true
- Report BOTH supporting AND contradicting evidence — be balanced, not confirmatory
- When in doubt, DOWNGRADE confidence. A "needs_advisor" result is far better than
  a confidently wrong pesticide recommendation

Return valid JSON only. No markdown fences.

{
  "_reasoning": "Step 1—Visual: [exact symptoms]. Step 2—Perspectives: A=[morphology conclusion], B=[pattern conclusion], C=[host conclusion], agreement=[3/3|2/3|0/3]. Step 3—Pathogen type: [classification + evidence]. Step 4—Weather: [correlation + note]. Step 5—Context: [validation]. Step 6—Differentials: [top 3]. Step 7—Confidence: [breakdown + penalties].",
  "primary_diagnosis": {
    "disease": "Early Blight",
    "scientific_name": "Alternaria solani",
    "confidence": 0.82,
    "severity": "Moderate",
    "description": "Circular brown lesions with concentric rings (target-board pattern) on older lower leaves, progressing upward.",
    "evidence": ["Concentric ring lesions on 3 older leaves", "Bottom-up progression typical of Alternaria", "Lesion size 0.5–1.5 cm with yellow halos"],
    "pathogen_type": "fungal"
  },
  "differentials": [
    {"disease": "Late Blight", "scientific_name": "Phytophthora infestans", "probability": 0.12, "reason": "Water-soaked margins absent; lesion shape inconsistent with Phytophthora", "distinguishing_feature": "Late Blight shows irregular water-soaked lesions with white sporulation on leaf underside"},
    {"disease": "Septoria Leaf Spot", "scientific_name": "Septoria lycopersici", "probability": 0.06, "reason": "Spots smaller and more circular without concentric rings", "distinguishing_feature": "Septoria shows tiny dark pycnidia (dots) visible inside the spots under magnification"}
  ],
  "look_alikes_ruled_out": [
    {"disease": "Bacterial Spot", "why_ruled_out": "Bacterial spots are angular and water-soaked, not circular with concentric rings; no ooze observed"}
  ],
  "visual_symptoms_detected": ["brown circular lesions with concentric rings", "yellowing around lesions", "bottom-up leaf progression"],
  "visual_evidence": {
    "lesion_description": "Brown circular lesions 0.5–1.5cm with concentric rings and yellow halos",
    "distribution": "bottom-up progression on older leaves, scattered pattern"
  },
  "pathogen_type": "fungal",
  "perspective_agreement": "3/3",
  "weather_correlation": "SUPPORTS",
  "weather_correlation_note": "Current humidity 82% and temp 26°C strongly support Alternaria development. Rain splash consistent with bottom-up spread.",
  "severity": "Moderate",
  "spread_risk": "HIGH",
  "is_certain": true,
  "needs_advisor": false,
  "needs_lab_confirmation": false,
  "crop_mismatch": false,
  "is_out_of_distribution": false,
  "confidence_score": 0.82,
  "confidence_penalties": [],
  "causal_factors": ["High humidity (>80%) for 3+ days", "Overhead irrigation keeping leaves wet", "Warm temperatures (24-29°C) favorable for Alternaria"]
}"""


def _read_image_b64(path: str) -> tuple[str, str]:
    ext = Path(path).suffix.lower().lstrip(".")
    media_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
    data = base64.standard_b64encode(Path(path).read_bytes()).decode("utf-8")
    return data, media_map.get(ext, "image/jpeg")


def _parse_json(raw: str) -> Optional[dict]:
    from utils.json_extractor import extract_json
    return extract_json(raw)


def _normalise(result: dict) -> dict:
    score = result.get("confidence_score", 0)
    if isinstance(score, (int, float)) and score > 1.0:
        score = score / 100
    result["confidence_score"] = max(0.0, min(1.0, float(score)))
    result.setdefault("needs_advisor", result["confidence_score"] < DIAGNOSIS_ESCALATE_BELOW)
    result.setdefault("is_certain", result["confidence_score"] >= DIAGNOSIS_CONF_THRESHOLD)
    result.setdefault("differentials", [])
    result.setdefault("causal_factors", [])
    result.setdefault("spread_risk", "MODERATE")
    result.setdefault("severity", "Moderate")
    result.setdefault("pathogen_type", "unknown")
    result.setdefault("perspective_agreement", "unknown")
    result.setdefault("needs_lab_confirmation", False)
    result.setdefault("crop_mismatch", False)
    result.setdefault("is_out_of_distribution", False)
    result.setdefault("confidence_penalties", [])
    result.setdefault("look_alikes_ruled_out", [])
    result.setdefault("visual_evidence", {})
    pd = result.get("primary_diagnosis", {})
    result["primary_diagnosis"] = {
        "disease":         pd.get("disease", "Unknown"),
        "scientific_name": pd.get("scientific_name", ""),
        "confidence":      result["confidence_score"],
        "severity":        pd.get("severity", "Unknown"),
        "description":     pd.get("description", ""),
        "evidence":        pd.get("evidence", []),
        "pathogen_type":   pd.get("pathogen_type", result.get("pathogen_type", "unknown")),
    }
    # Force needs_advisor if critical flags are set
    if result.get("crop_mismatch") or result.get("is_out_of_distribution"):
        result["needs_advisor"] = True
    # Force lab confirmation flag into needs_advisor for bacterial/fungal ambiguity
    if result.get("needs_lab_confirmation"):
        result.setdefault("needs_advisor", True)
    return result


def _uncertain_fallback(reason: str) -> dict:
    return {
        "_reasoning": reason,
        "primary_diagnosis": {
            "disease": "UNCERTAIN", "scientific_name": "", "confidence": 0.0,
            "severity": "Unknown",
            "description": "Could not determine disease. Please retake photos and try again.",
            "evidence": [],
        },
        "differentials": [], "severity": "Unknown", "spread_risk": "UNKNOWN",
        "is_certain": False, "needs_advisor": True, "confidence_score": 0.0, "causal_factors": [],
    }


def _build_context(image_quality: dict, weather_risk: dict, params: dict) -> str:
    w = weather_risk
    iq = image_quality
    raw = params.get("_raw_weather", {})
    cur = raw.get("current", {}) if raw else {}

    # Format weather metrics if available
    if cur:
        weather_block = f"""WEATHER DATA (use for correlation scoring):
  Temperature  : {cur.get('temperature', '?')}°C (feels like {cur.get('apparent_temperature', '?')}°C)
  Humidity     : {cur.get('humidity', '?')}%
  Dew Point    : {cur.get('dew_point', '?')}°C
  VPD          : {cur.get('vpd', '?')} kPa
  Wind         : {cur.get('wind_speed', '?')} km/h
  Precipitation: {cur.get('precipitation', 0)} mm
  Cloud Cover  : {cur.get('cloud_cover', '?')}%
  Condition    : {cur.get('weather_desc', '?')}"""
    else:
        weather_block = "WEATHER DATA: Not available (weather_used=false)"

    return f"""CROP DISEASE ANALYSIS

CROP & FIELD:
  Crop         : {params.get('crop_name', 'Unknown')}
  Variety      : {params.get('crop_variety', 'Not specified')}
  Growth Stage : {params.get('crop_growth_stage', 'Unknown')}
  Planting Date: {params.get('planting_date', 'Not provided')}
  Field Area   : {params.get('farm_size_acres', '?')} acres
  Previous Crop: {params.get('previous_crop', 'Not specified')}
  Soil Type    : {params.get('soil_type', 'Unknown')}
  Irrigation   : {params.get('irrigation_system', 'Unknown')}
  Affected Area: {params.get('affected_area_percent', '?')}%
  Symptoms     : {params.get('symptom_description', 'None reported')}
  Pesticides   : {params.get('recent_pesticide_used', 'None')}
  Fertilizer   : {params.get('fertilizer_history', 'Not provided')}

{weather_block}

WEATHER RISK ASSESSMENT:
  Overall Risk        : {w.get('overall_disease_risk', 'UNKNOWN')}
  Risk Factors        : {', '.join(w.get('risk_factors', []))}
  Favourable Diseases : {', '.join(w.get('favorable_diseases', []))}
  Soil Risk           : {w.get('soil_risk', 'UNKNOWN')}
  Forecast Risk       : {w.get('forecast_risk', 'Not available')}
  Advisory            : {w.get('advisory', '')}
  Weather Data Used   : {w.get('weather_used', False)}

IMAGE QUALITY:
  Score   : {iq.get('quality_score', 0):.2f} | Usable: {iq.get('usable', False)}
  {('Notes: ' + iq.get('enhancement_notes', '')) if iq.get('enhancement_notes') else ''}

Follow the 5-step diagnostic process exactly. Apply the confidence scoring formula.
Set weather_correlation to SUPPORTS / PARTIAL / CONTRADICTS.
Return JSON only. No markdown."""


async def run_disease_diagnosis_agent(
    images: list[dict],
    image_quality: dict,
    weather_risk: dict,
    params: dict,
) -> tuple[dict, dict]:
    """Returns (diagnosis_dict, token_info)"""
    if not GEMINI_API_KEY:
        return _uncertain_fallback("GEMINI_API_KEY not configured"), empty_token_info("gemini-2.5-flash")

    # Load images as base64
    images_b64 = []
    for img in images[:5]:
        try:
            b64, mime = _read_image_b64(img["path"])
            images_b64.append({"data": b64, "mime_type": mime})
        except Exception as e:
            logger.warning("Cannot read image: %s", e)

    if not images_b64 and not image_quality.get("enhancement_notes"):
        return _uncertain_fallback("No usable images provided"), empty_token_info("gemini-2.5-flash")

    context = _build_context(image_quality, weather_risk, params)
    last_result: Optional[dict] = None
    accumulated_tokens: dict = empty_token_info("gemini-2.5-flash")

    for attempt in range(1, MAX_DIAGNOSIS_RETRIES + 1):
        try:
            raw, tok = await call_gemini_vision(SYSTEM_PROMPT, context, images_b64, GEMINI_API_KEY, groq_api_key=GROQ_API_KEY)
            # Accumulate tokens across retries
            accumulated_tokens["input_tokens"]  += tok["input_tokens"]
            accumulated_tokens["output_tokens"] += tok["output_tokens"]
            accumulated_tokens["total_tokens"]  += tok["total_tokens"]
            accumulated_tokens["cost_usd"]      += tok["cost_usd"]

            result = _parse_json(raw)

            if not result:
                raise ValueError("JSON parse failure — Gemini response not valid JSON")

            result = _normalise(result)
            last_result = result
            conf = result["confidence_score"]

            logger.info("Attempt %d: disease=%s confidence=%.0f%%", attempt, result['primary_diagnosis']['disease'], conf * 100)

            if conf >= DIAGNOSIS_CONF_THRESHOLD or attempt == MAX_DIAGNOSIS_RETRIES:
                return result, accumulated_tokens

            # Retry with enriched prompt
            context = (
                context +
                f"\n\nPREVIOUS ATTEMPT (confidence {conf:.0%} — too low):\n"
                f"Re-examine carefully. Look for subtle colour changes, lesion edges, texture differences. "
                "Cross-reference weather risk factors more strongly. Update diagnosis."
            )

        except Exception as exc:
            logger.exception("Attempt %d failed", attempt)
            if attempt == MAX_DIAGNOSIS_RETRIES:
                return (last_result or _uncertain_fallback(f"All attempts failed: {exc}")), accumulated_tokens
            await asyncio.sleep(5 * attempt)

    return (last_result or _uncertain_fallback("Max retries reached")), accumulated_tokens
