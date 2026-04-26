"""
Treatment & Fertilizer Agent — CropGuard Agentic AI
Model : Groq llama-3.3-70b (primary) / Gemini 2.5 Flash (fallback)
Role  : Recommend treatment + pesticides + fertilizers with Indian brand names.
Cache : Redis (7-day TTL) keyed on disease+crop+soil+irrigation+severity+stage.
        Falls back to in-memory LRU cache if Redis unavailable.
"""
from __future__ import annotations
import hashlib
import json
import logging
import re
import time
from typing import Optional

logger = logging.getLogger(__name__)

from config import GROQ_API_KEY, GEMINI_API_KEY
from agents.llm_utils import call_groq_text, call_gemini_text, empty_token_info

# ── Redis cache (optional — falls back to in-memory if Redis unavailable) ─────
try:
    import redis as _redis_lib
    _redis = _redis_lib.Redis(host="localhost", port=6379, db=0, socket_connect_timeout=2)
    _redis.ping()
    _REDIS_OK = True
    logger.info("Redis connected — treatment results cached for 7 days")
except Exception:
    _redis = None
    _REDIS_OK = False
    logger.warning("Redis unavailable — using in-memory LRU cache (500 entries)")

TREATMENT_CACHE_TTL = 86_400 * 7   # 7 days

# In-memory fallback LRU (max 500 entries, 24-hour TTL)
_mem_cache: dict[str, tuple[dict, float]] = {}
_MEM_MAX   = 500
_MEM_TTL   = 86_400


def _get_cache_key(diagnosis: dict, params: dict) -> str:
    """Deterministic cache key from disease identity + farm context."""
    pd = diagnosis.get("primary_diagnosis", {})
    payload = {
        "disease":       (pd.get("disease") or "").lower().strip(),
        "crop":          (params.get("crop_name") or "").lower().strip(),
        "soil":          (params.get("soil_type") or "").lower().strip(),
        "irrigation":    (params.get("irrigation_system") or "").lower().strip(),
        "severity":      (pd.get("severity") or "").lower().strip(),
        "growth_stage":  (params.get("crop_growth_stage") or "").lower().strip(),
    }
    key_str = json.dumps(payload, sort_keys=True)
    return f"treatment:{hashlib.md5(key_str.encode()).hexdigest()}"


def _cache_get(key: str) -> Optional[dict]:
    if _REDIS_OK:
        try:
            raw = _redis.get(key)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    # In-memory fallback
    entry = _mem_cache.get(key)
    if entry:
        result, ts = entry
        if time.time() - ts < _MEM_TTL:
            return result
        del _mem_cache[key]
    return None


def _cache_set(key: str, value: dict) -> None:
    if _REDIS_OK:
        try:
            _redis.setex(key, TREATMENT_CACHE_TTL, json.dumps(value))
            return
        except Exception:
            pass
    # In-memory fallback — evict oldest if full
    if len(_mem_cache) >= _MEM_MAX:
        oldest_key = min(_mem_cache, key=lambda k: _mem_cache[k][1])
        del _mem_cache[oldest_key]
    _mem_cache[key] = (value, time.time())


# ── Prompts ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert Indian agricultural treatment advisor and IPM (Integrated Pest Management) specialist.
You have deep knowledge of CIB&RC-registered pesticides, FRAC/IRAC/HRAC resistance groups, organic inputs,
biocontrol agents, and fertilizers available in the Indian market.

Given a confirmed disease diagnosis, design a COMPLETE IPM treatment plan: chemical + biological + cultural.
Your recommendations must be practical, region-appropriate, cost-conscious, and SAFE.

PATHOGEN-BASED ROUTING (follow strictly):
- Fungal/Oomycete → appropriate fungicide classes (contact + systemic rotation)
- Bacterial       → copper compounds, Streptocycline (where registered), SAR inducers
- Viral           → NO curative chemical exists. Focus on VECTOR CONTROL + rogueing infected plants
- Nematode        → nematicide OR bio-nematicide (Paecilomyces, Purpureocillium) + soil amendments
- Pest            → insecticide matched to pest, consider biocontrol first
- Abiotic/Nutrient→ NO pesticide needed. Address the underlying cause (nutrient, water, sunscald)

SEVERITY-BASED STAGING:
- Mild   (<20% affected) → protectant/contact fungicide first + cultural measures
- Moderate (20–50%)      → systemic curative + contact protectant combo
- Severe   (>50%)        → systemic curative + aggressive rotation; WARN about salvage limits

RESISTANCE MANAGEMENT (MANDATORY):
- Include FRAC group (for fungicides), IRAC group (for insecticides), or HRAC group (for herbicides)
  for EVERY chemical recommended
- NEVER recommend the same MoA (Mode of Action) group for consecutive applications
- Provide a rotation plan: spray 1 = Group X, spray 2 = Group Y, spray 3 = Group X
- If farmer reports a chemical that already FAILED → likely resistance; avoid that MoA group entirely

POLLINATOR SAFETY:
- For FLOWERING stage crops: EXCLUDE bee-toxic chemicals (most neonicotinoids — Imidacloprid,
  Thiamethoxam, Clothianidin; some pyrethroids)
- Mark each chemical's pollinator_safety: "safe" | "caution" | "avoid_during_bloom"
- If flowering + must spray → recommend evening application only (after bee activity)

PHI ENFORCEMENT:
- If crop is in PRE-HARVEST stage and PHI > days to expected harvest → REJECT that chemical
- Always state PHI prominently

SAFETY COMPLIANCE CHECKS (apply to every chemical):
- Must be CIB&RC registered for that specific crop in India
- Cross-check against BANNED list: Monocrotophos, Endosulfan, Methyl Parathion, Phorate,
  Triazophos, Dichlorvos (on many crops), Lindane, Aldrin, Chlordane, Heptachlor, etc.
- Check STATE-LEVEL bans (Kerala bans many OPs; Punjab restricts certain herbicides)
- Class I (extremely hazardous) chemicals → only if no safer alternative exists, with
  STRONG PPE requirements and trained applicator warning
- For EXPORT crops: flag if residue limits may exceed destination country MRLs

RULES:
- NEVER recommend banned pesticides
- NEVER skip biological/cultural alternatives — IPM requires ALL three pillars
- Include PHI (Pre-Harvest Interval) + REI (Re-Entry Interval) for every chemical
- Do NOT recommend spraying if rain expected within 4 hours
- Adjust dosage for the farmer's actual farm_size_acres
- Include REAL Indian brand names with approximate MRP in INR
- Include applicator safety: PPE required, mixing instructions, container disposal
- Provide cost estimate per acre for the recommended treatment
- For MEDIUM confidence diagnoses: prefer CONTACT/PROTECTANT (broad-spectrum, lower risk
  of wrong call) over narrow systemic chemicals

OUTPUT: Valid JSON only. No markdown fences.

{
  "immediate_actions": ["Remove and destroy infected leaves — bag them, do not leave in field"],
  "chemical_controls": [
    {
      "priority": 1,
      "product": "Mancozeb 75% WP",
      "active_ingredient": "Mancozeb",
      "frac_irac_group": "FRAC M03 (multi-site contact)",
      "brands": [
        {"name": "Dithane M-45", "company": "UPL", "pack": "500g", "mrp_approx": 280},
        {"name": "Indofil M-45", "company": "Indofil", "pack": "500g", "mrp_approx": 260}
      ],
      "dosage": "2.5 g per litre water",
      "dosage_per_acre": "600–800 g in 200–300 L water",
      "application_method": "Foliar spray — early morning or evening",
      "frequency": "Every 7–10 days",
      "max_applications_per_season": 6,
      "phi_days": 3,
      "rei_hours": 24,
      "pollinator_safety": "safe",
      "cost_estimate_inr_per_acre": "250–350",
      "safety_precautions": ["Wear gloves, mask, and goggles", "Re-entry after 24 hours", "Triple-rinse empty containers"]
    }
  ],
  "rotation_plan": "Spray 1: Mancozeb (FRAC M03) → Spray 2: Propiconazole (FRAC 3) → Spray 3: Azoxystrobin (FRAC 11) → Repeat. Never use same FRAC group consecutively.",
  "medicine_combinations": [
    {
      "name": "Curative + Preventive",
      "recommended": true,
      "for_severity": "moderate to severe",
      "description": "Systemic for active infection + contact for prevention",
      "components": [
        {"product": "Propiconazole 25% EC", "role": "Curative (systemic)", "frac_group": "FRAC 3 (DMI)", "dosage": "1 ml/L"},
        {"product": "Mancozeb 75% WP", "role": "Preventive (contact)", "frac_group": "FRAC M03", "dosage": "2.5 g/L"}
      ],
      "brands": [
        {"combo_brand": "Nativo 75 WG", "company": "Bayer", "note": "Pre-mixed Tebuconazole+Trifloxystrobin", "mrp_approx": 900}
      ],
      "application": "Tank mix in single spray, early morning before 9 AM"
    },
    {
      "name": "Organic + Biological",
      "recommended": false,
      "for_severity": "mild",
      "description": "For organic farmers or pesticide-sensitive/export markets",
      "components": [
        {"product": "Bordeaux Mixture 1%", "role": "Curative", "dosage": "10g CuSO4 + 10g lime / L"},
        {"product": "Trichoderma harzianum", "role": "Biological control", "dosage": "5 g/L"}
      ],
      "brands": [],
      "application": "Alternate spray every 7 days"
    }
  ],
  "biological_options": [
    {
      "agent": "Trichoderma viride",
      "type": "biocontrol fungus",
      "brands": [{"name": "Ecosense Tricho", "company": "Multiplex", "pack": "1kg", "mrp_approx": 280}],
      "dosage": "5 g per litre water",
      "dosage_per_acre": "1 kg in 200 L water",
      "application_method": "Soil drench around root zone",
      "phi_days": 0,
      "safety_precautions": []
    }
  ],
  "organic_alternatives": [
    {
      "product": "Pseudomonas fluorescens",
      "brands": [{"name": "Sudo", "company": "Multiplex", "pack": "1kg", "mrp_approx": 350}],
      "dosage": "10 g per litre water",
      "dosage_per_acre": "2 kg in 200 L water",
      "application_method": "Foliar spray or seed treatment",
      "phi_days": 0,
      "safety_precautions": []
    }
  ],
  "cultural_practices": [
    "Remove and destroy infected plant debris — do not compost",
    "Improve canopy airflow by proper spacing and pruning",
    "Switch from overhead/sprinkler to drip irrigation to reduce leaf wetness",
    "Practice 2–3 year crop rotation with non-host crops"
  ],
  "fertilizer_recommendations": [
    {
      "product": "Potassium Nitrate (13-0-45)",
      "npk": "13-0-45",
      "dosage_per_acre": "5 kg per 200 L water (foliar)",
      "timing": "Apply 3 days after fungicide spray",
      "reason": "Potassium strengthens cell walls and improves disease resistance"
    }
  ],
  "do_not_use": ["Monocrotophos — banned by CIB&RC", "Endosulfan — banned since 2011"],
  "preventive_measures": ["Spray protectant every 7 days during humid weather", "Use resistant/tolerant varieties"],
  "long_term_recommendations": ["Rotate with non-solanaceous crop next season", "Soil solarization before next planting"],
  "applicator_safety": {
    "ppe_required": ["Chemical-resistant gloves", "Face mask/respirator", "Goggles", "Long-sleeved shirt and trousers", "Rubber boots"],
    "mixing_instructions": "Add chemical to half-filled spray tank, agitate, then top up. Never mix with bare hands.",
    "disposal": "Triple-rinse empty containers and puncture before disposal. Never reuse pesticide containers for food/water."
  },
  "spray_timing_advisory": "Best window: early morning before 9 AM or evening after 5 PM. Avoid spraying if rain expected within 4 hours. Do not spray in wind >15 km/h.",
  "monitoring_plan": {
    "follow_up_in_days": 7,
    "what_to_watch_for": ["New lesions on previously healthy leaves", "Change in lesion color or size", "Spread to adjacent plants"]
  },
  "confidence_adjusted_note": null,
  "relevance_score": 0.88
}"""


def _parse_json(raw: str) -> Optional[dict]:
    from utils.json_extractor import extract_json
    return extract_json(raw)


def _fallback_treatment(disease_name: str) -> dict:
    return {
        "immediate_actions": [
            f"Isolate affected plants to prevent spread of {disease_name}",
            "Remove and destroy visibly infected plant parts — bag them, do not leave in field",
            "Consult your local KVK (Krishi Vigyan Kendra) for specific product recommendations",
        ],
        "chemical_controls": [],
        "rotation_plan": "",
        "medicine_combinations": [],
        "biological_options": [],
        "organic_alternatives": [],
        "cultural_practices": ["Improve airflow around plants", "Avoid overhead irrigation"],
        "fertilizer_recommendations": [],
        "do_not_use": [],
        "preventive_measures": ["Monitor field daily", "Maintain optimal irrigation schedule"],
        "long_term_recommendations": ["Practice crop rotation", "Use resistant varieties next season"],
        "applicator_safety": {},
        "spray_timing_advisory": "Spray in early morning or evening. Avoid spraying before expected rain.",
        "monitoring_plan": {"follow_up_in_days": 3, "what_to_watch_for": ["New lesion development", "Spread to healthy plants"]},
        "confidence_adjusted_note": "Diagnosis was uncertain — only general measures recommended. Please consult a KVK expert.",
        "relevance_score": 0.3,
    }


async def run_treatment_agent(
    diagnosis: dict,
    weather_risk: dict,
    params: dict,
) -> tuple[dict, dict]:
    """Returns (treatment_dict, token_info)"""
    disease = diagnosis.get("primary_diagnosis", {})
    disease_name = disease.get("disease", "Unknown")

    if disease_name in ("Unknown", "UNCERTAIN") or diagnosis.get("confidence_score", 0) < 0.3:
        return _fallback_treatment(disease_name), empty_token_info()

    # ── Cache lookup ──────────────────────────────────────────────────────────
    cache_key = _get_cache_key(diagnosis, params)
    cached = _cache_get(cache_key)
    if cached:
        logger.info("Cache HIT — key=...%s disease=%s cost=$0.0000", cache_key[-8:], disease_name)
        cached["_cached"] = True
        return cached, empty_token_info("cache-hit")

    # ── Build user prompt ─────────────────────────────────────────────────────
    forecast_advisory = ""
    if weather_risk.get("weather_used"):
        forecast_advisory = f"\nWeather advisory: {weather_risk.get('advisory', '')}"
        if weather_risk.get("forecast_risk"):
            forecast_advisory += f"\nForecast: {weather_risk.get('forecast_risk')}"

    # Determine confidence tier for treatment calibration
    conf = diagnosis.get("confidence_score", 0)
    confidence_tier = "HIGH" if conf >= 0.85 else "MEDIUM" if conf >= 0.70 else "LOW"
    pathogen_type = diagnosis.get("pathogen_type", disease.get("pathogen_type", "unknown"))
    growth_stage = params.get("crop_growth_stage", "Unknown").lower()

    # Build confidence-adjusted note
    conf_note = ""
    if confidence_tier == "MEDIUM":
        conf_note = "\n⚠ MEDIUM CONFIDENCE: Prefer CONTACT/PROTECTANT (broad-spectrum) over narrow systemic chemicals."
    elif confidence_tier == "LOW":
        conf_note = "\n⚠ LOW CONFIDENCE: Recommend only broad-spectrum protectants. Do NOT recommend expensive systemic chemicals."

    # Flowering stage warning
    flowering_note = ""
    if any(kw in growth_stage for kw in ("flower", "bloom", "anthesis")):
        flowering_note = "\n🐝 CROP IS FLOWERING: EXCLUDE all bee-toxic chemicals (neonicotinoids, certain pyrethroids). Mark pollinator_safety for each chemical."

    user_prompt = f"""Provide complete IPM treatment plan for:

DIAGNOSIS:
  Disease         : {disease_name} ({disease.get('scientific_name', '')})
  Pathogen Type   : {pathogen_type}
  Confidence      : {conf:.0%} ({confidence_tier})
  Severity        : {disease.get('severity', 'Unknown')}
  Spread Risk     : {diagnosis.get('spread_risk', 'Unknown')}
  Causal Factors  : {', '.join(diagnosis.get('causal_factors', []))}
{conf_note}{flowering_note}

CROP & FIELD:
  Crop            : {params.get('crop_name', 'Unknown')}
  Variety         : {params.get('crop_variety', 'Not specified')}
  Growth Stage    : {params.get('crop_growth_stage', 'Unknown')}
  Soil Type       : {params.get('soil_type', 'Unknown')}
  Irrigation      : {params.get('irrigation_system', 'Unknown')}
  Farm Size       : {params.get('farm_size_acres', 1)} acres
  Previous Crop   : {params.get('previous_crop', 'Unknown')}
  Recent Pesticide: {params.get('recent_pesticide_used', 'None')}
  Fertilizer Used : {params.get('fertilizer_history', 'Not provided')}

WEATHER CONTEXT:
  Current Risk    : {weather_risk.get('overall_disease_risk', 'UNKNOWN')}
  Risk Factors    : {', '.join(weather_risk.get('risk_factors', [])[:3])}
{forecast_advisory}

MANDATORY REQUIREMENTS:
1. Include FRAC/IRAC group for EVERY chemical (e.g., "FRAC 3 (DMI)", "FRAC M03 (multi-site)")
2. Include a rotation_plan showing MoA group alternation across sprays
3. Include 2 medicine_combinations (curative+preventive and organic+biological)
4. Include biological_options (Trichoderma, Pseudomonas, Bacillus, etc.)
5. Include cultural_practices (spacing, pruning, irrigation, rotation)
6. Include applicator_safety (PPE, mixing, disposal)
7. Include monitoring_plan (follow_up_in_days, what_to_watch_for)
8. Include do_not_use list (banned/inappropriate chemicals with reason)
9. If pathogen_type is "viral": do NOT recommend curative chemicals — focus on vector control + rogueing
10. If pathogen_type is "abiotic" or "nutrient": do NOT recommend pesticides — address root cause
11. Scale all dosages for {params.get('farm_size_acres', 1)} acres
12. Include real Indian brand names with approximate MRP in INR
13. Mark pollinator_safety for each chemical: "safe" | "caution" | "avoid_during_bloom"

Return JSON only."""

    def _finalise(result):
        if not result:
            return _fallback_treatment(disease_name)
        result.setdefault("immediate_actions", [])
        result.setdefault("chemical_controls", [])
        result.setdefault("rotation_plan", "")
        result.setdefault("medicine_combinations", [])
        result.setdefault("biological_options", [])
        result.setdefault("organic_alternatives", [])
        result.setdefault("cultural_practices", [])
        result.setdefault("fertilizer_recommendations", [])
        result.setdefault("do_not_use", [])
        result.setdefault("preventive_measures", [])
        result.setdefault("long_term_recommendations", [])
        result.setdefault("applicator_safety", {})
        result.setdefault("spray_timing_advisory", "")
        result.setdefault("monitoring_plan", {"follow_up_in_days": 7, "what_to_watch_for": []})
        result.setdefault("confidence_adjusted_note", None)
        result.setdefault("relevance_score", 0.8)
        # Add confidence-adjusted note if not already set
        if confidence_tier == "MEDIUM" and not result.get("confidence_adjusted_note"):
            result["confidence_adjusted_note"] = (
                "Diagnosis confidence is moderate. Broad-spectrum protectants recommended first. "
                "Monitor closely for 3 days — if symptoms don't match, consult KVK."
            )
        result["_cached"] = False
        return result

    # ── Groq (primary) ────────────────────────────────────────────────────────
    if GROQ_API_KEY:
        try:
            raw, tok = await call_groq_text(SYSTEM_PROMPT, user_prompt, GROQ_API_KEY)
            result = _finalise(_parse_json(raw))
            _cache_set(cache_key, result)
            logger.info("LLM response cached — key=...%s", cache_key[-8:])
            return result, tok
        except Exception as exc:
            logger.exception("Groq call failed")

    # ── Gemini fallback ───────────────────────────────────────────────────────
    if GEMINI_API_KEY:
        try:
            raw, tok = await call_gemini_text(SYSTEM_PROMPT, user_prompt, GEMINI_API_KEY)
            result = _finalise(_parse_json(raw))
            _cache_set(cache_key, result)
            return result, tok
        except Exception as exc:
            logger.exception("Gemini fallback also failed")

    return _fallback_treatment(disease_name), empty_token_info()
