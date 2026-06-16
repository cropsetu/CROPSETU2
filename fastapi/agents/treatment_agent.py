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

from config import DIAGNOSIS_ESCALATE_BELOW
from agents.llm_utils import empty_token_info
from agents.llm_dispatch import call_llm_text, get_feature_config
from data.agro_zones import zone_for
from rag import retrieve as rag_retrieve
from safety.validator import validate_treatment
from safety.chemicals import REGISTRY_VERSION
try:
    from data.state_bans import REGISTRY_VERSION as STATE_BANS_VERSION
except Exception:  # pragma: no cover - defensive
    STATE_BANS_VERSION = "0"

# ── Redis cache (optional — falls back to in-memory if Redis unavailable) ─────
# Use the SHARED Redis URL (RATE_LIMIT_STORAGE_URI / REDIS_URL) so the treatment
# cache is shared across replicas instead of a hardcoded localhost that silently
# degrades to per-process caching in production.
import os as _os
_TREATMENT_REDIS_URL = (_os.environ.get("RATE_LIMIT_STORAGE_URI")
                        or _os.environ.get("REDIS_URL", "")).strip()
try:
    if not _TREATMENT_REDIS_URL:
        raise RuntimeError("no Redis URL configured")
    import redis as _redis_lib
    _redis = _redis_lib.Redis.from_url(_TREATMENT_REDIS_URL, socket_connect_timeout=2)
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


_SEVERITY_BUCKETS = {
    "mild":   {"mild", "low", "slight", "early", "minor"},
    "moderate": {"moderate", "medium", "mid"},
    "severe": {"severe", "high", "critical", "advanced", "extensive"},
}


def _bucket_severity(raw: str) -> str:
    """Map LLM-emitted severity strings to a stable 3-bucket value so the
    cache doesn't miss on cosmetic differences ("Moderate" vs "medium")."""
    v = (raw or "").lower().strip()
    for bucket, aliases in _SEVERITY_BUCKETS.items():
        if v in aliases:
            return bucket
    return "moderate"  # safe default


def _get_cache_key(diagnosis: dict, params: dict, tier: str, grounding: dict | None = None,
                   model: str | None = None) -> str:
    """Deterministic cache key from disease identity + farm context + tier
    + RAG grounding + the treatment model.

    Tier is in the key because the Best chain may recommend different
    chemicals/brands than Fast — caching across tiers would leak a downgraded
    answer to a paying request and vice-versa.

    Model is in the key because an admin can pin a different treatment model per
    request (ai.model.treatment); two models can word/structure advice
    differently, so they must not share a cache slot or an override would
    serve/poison another model's cached answer.

    Grounding is in the key because two scans of the same disease in
    different agro-zones get different RAG payloads (different actives,
    different cultural practices, different ETL) and must not share a
    cache slot — that's the whole point of grounding.
    """
    pd = diagnosis.get("primary_diagnosis", {})
    payload = {
        "disease":       (pd.get("disease") or "").lower().strip(),
        "crop":          (params.get("crop_name") or "").lower().strip(),
        "soil":          (params.get("soil_type") or "").lower().strip(),
        "irrigation":    (params.get("irrigation_system") or "").lower().strip(),
        "severity":      _bucket_severity(pd.get("severity")),
        "growth_stage":  (params.get("crop_growth_stage") or "").lower().strip(),
        "tier":          tier,
        "model":         (model or "").lower().strip(),
        # Safety: a chemical ban / label-claim change bumps these versions,
        # which auto-invalidates stale cached advice — otherwise a just-banned
        # pesticide keeps being served from cache for the 7-day TTL.
        "registry_version":   REGISTRY_VERSION,
        "state_bans_version": STATE_BANS_VERSION,
    }
    if grounding:
        # Stable signature: actives' names + zone (the two grounding
        # dimensions that change the recommendation set).
        payload["grounding_zone"]    = (grounding.get("zone") or "").lower().strip()
        payload["grounding_actives"] = sorted(
            a.get("name", "") for a in (grounding.get("actives") or [])
        )
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

# Prompt is loaded from agents/prompts/treatment.<version>.md at import
# time. This is the BASELINE — when A/B is configured (dict in
# ACTIVE_VERSIONS), _treatment_prompt() picks the per-user variant at
# request time and returns its meta so the report can record which one
# actually ran. The constants below stay valid for non-A/B use.
from agents.prompt_registry import load_prompt
from observability.logging import user_id_var
TREATMENT_PROMPT = load_prompt("treatment")
SYSTEM_PROMPT = TREATMENT_PROMPT.text
TREATMENT_PROMPT_META = TREATMENT_PROMPT.meta()


def _treatment_prompt() -> tuple[str, dict]:
    p = load_prompt("treatment", bucket_id=user_id_var.get() or None)
    return p.text, p.meta()


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

    # Hard gate: never run treatment LLM when diagnosis is unknown, low
    # confidence, OOD, or crop mismatch — those are the cases where a
    # confident-sounding pesticide recommendation could harm the farmer.
    # DIAGNOSIS_ESCALATE_BELOW is the same threshold used in the
    # orchestrator's needs_advisor logic; keep them in sync.
    if (
        disease_name in ("Unknown", "UNCERTAIN")
        or diagnosis.get("confidence_score", 0) < DIAGNOSIS_ESCALATE_BELOW
        or diagnosis.get("is_out_of_distribution")
        or diagnosis.get("crop_mismatch")
    ):
        logger.info(
            "Treatment gate: skipping LLM (disease=%s conf=%.2f ood=%s mismatch=%s) — cultural-only fallback",
            disease_name, diagnosis.get("confidence_score", 0),
            diagnosis.get("is_out_of_distribution"), diagnosis.get("crop_mismatch"),
        )
        return _fallback_treatment(disease_name), empty_token_info()

    # Load the configured treatment model (single AI_CROP_TREATMENT_MODEL,
    # no fallback). `tier` is retained as a cache-key salt for backward
    # compat with persisted cache entries; it does NOT pick the model.
    # Admin App Settings choice (ai.model.treatment), forwarded per request inside
    # params by the Express scan client; falls back to AI_CROP_TREATMENT_MODEL/env.
    cfg = get_feature_config("CROP_TREATMENT", model_override=params.get("model_treatment"))
    tier = (params.get("tier") or "fast").strip().lower()

    # ── RAG grounding (Phase 7) ──────────────────────────────────────────────
    # Pull the structured ICAR / CIB&RC payload for this (disease, crop, zone).
    # The treatment prompt below will REQUIRE the LLM to recommend only from
    # the actives this grounding lists, with the cultural practices + ETL +
    # MRL + regulatory notes spelled out so the LLM can't fabricate.
    zone = zone_for(params.get("state"), params.get("district"))
    grounding = rag_retrieve(disease_name, params.get("crop_name"), zone)

    # ── Cache lookup ──────────────────────────────────────────────────────────
    # The grounding hash is part of the key — two scans of the same disease
    # in different agro-zones get different RAG payloads and must not share
    # a cache slot.
    cache_key = _get_cache_key(diagnosis, params, tier, grounding, model=cfg.model)
    cached = _cache_get(cache_key)
    if cached:
        logger.info(
            "Cache HIT — key=...%s disease=%s tier=%s cost=$0.0000",
            cache_key[-8:], disease_name, tier,
        )
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

    # ── Grounding block — drives the prompt to recommend only from the KB ──
    g_actives = grounding.get("actives") or []
    if g_actives:
        actives_lines = "\n".join(
            f"    - {a['name']:<20}  {a['frac_irac_group']:<10}  PHI={a['phi_days']}d  "
            f"REI={a['rei_hours']}h  pollinator={a['pollinator_safety']}"
            for a in g_actives
        )
    else:
        actives_lines = "    (no chemical active registered for this crop-disease pair — recommend ONLY cultural / biological measures, name no chemicals)"
    cultural_lines = "\n".join(f"    - {c}" for c in (grounding.get("cultural_practices") or []))
    notes_lines    = "\n".join(f"    - {n}" for n in (grounding.get("regulatory_notes") or []))
    etl_line       = f"    ETL (Economic Threshold Level): {grounding['etl']}" if grounding.get("etl") is not None else "    ETL: not defined for this pair — apply IPM judgement"
    mrl_lines      = "\n".join(f"    - {k}: {v} mg/kg" for k, v in (grounding.get("mrl") or {}).items()) or "    (no MRL data for the listed actives)"

    grounding_block = f"""
─── EVIDENCE-BASED GROUNDING (ICAR / CIB&RC label-claim matrix) ───
Agro-climatic zone: {grounding.get('zone') or 'Unknown'}

REGISTERED ACTIVES FOR THIS CROP-DISEASE PAIR (recommend ONLY from this list):
{actives_lines}

CULTURAL / NON-CHEMICAL PRACTICES (always include relevant ones):
{cultural_lines}

ECONOMIC THRESHOLD (below this, prefer monitoring over spraying):
{etl_line}

FSSAI MRL (mg/kg) for the registered actives (surface in dispensing sheet annex):
{mrl_lines}

MANDATORY REGULATORY NOTES (append a summary to the report):
{notes_lines}

HARD CONSTRAINTS DERIVED FROM THIS GROUNDING:
  • Do NOT recommend a chemical active that is not in the registered list above.
    Any off-label active will be rejected by the safety validator after this call.
  • If the registered list is empty, recommend ONLY cultural / biological options
    and explain in farmer_summary that no chemical is registered for this case.
  • Always include the regulatory notes verbatim in the report's compliance section.
───
"""

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
  Farm History    : {params.get('farm_history') or 'None'}

WEATHER CONTEXT:
  Current Risk    : {weather_risk.get('overall_disease_risk', 'UNKNOWN')}
  Risk Factors    : {', '.join(weather_risk.get('risk_factors', [])[:3])}
{forecast_advisory}
{grounding_block}
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

        # ── Defensive schema unwrap ────────────────────────────────────
        # Some models (Claude in particular) wrap the response in their
        # own top-level objects like {"diagnosis_summary": {...},
        # "treatment_plan": {...}, "recommendations": {...}} even though
        # the prompt asks for a flat structure. Detect this and flatten.
        #
        # Strategy: if NONE of the canonical top-level keys are present
        # but a known wrapper key is, search the entire result tree for
        # the canonical keys and lift them to the top level.
        CANONICAL_KEYS = (
            "immediate_actions", "chemical_controls", "biological_options",
            "organic_alternatives", "cultural_practices", "preventive_measures",
            "fertilizer_recommendations", "medicine_combinations",
            "rotation_plan", "do_not_use", "applicator_safety",
            "spray_timing_advisory", "monitoring_plan",
        )
        if isinstance(result, dict) and not any(k in result for k in CANONICAL_KEYS):
            # Walk one level into every dict value and pull canonical keys.
            lifted: dict = {}
            stack = [result]
            depth = 0
            while stack and depth < 4:
                current = stack.pop()
                for v in current.values() if isinstance(current, dict) else []:
                    if isinstance(v, dict):
                        for ck in CANONICAL_KEYS:
                            if ck in v and ck not in lifted:
                                lifted[ck] = v[ck]
                        stack.append(v)
                    elif isinstance(v, list):
                        for item in v:
                            if isinstance(item, dict):
                                stack.append(item)
                depth += 1
            if lifted:
                logger.info(
                    "[Treatment] Detected wrapped schema — lifted %d canonical keys",
                    len(lifted),
                )
                # Merge lifted keys into top-level result without erasing
                # any wrapper-level metadata.
                for k, v in lifted.items():
                    result[k] = v

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

    # ── Single-model dispatch (no fallback) ──────────────────────────────────
    # AI_CROP_TREATMENT_MODEL configured in .env. If empty or the key isn't
    # set, drop straight to the cultural-only fallback so the pipeline still
    # produces something.
    if not cfg.api_key:
        logger.error("No API key for %s — set AI_CROP_TREATMENT_API_KEY", cfg.model)
        return _fallback_treatment(disease_name), empty_token_info()

    try:
        # Resolve per-user variant when A/B is configured. Stamps the
        # variant meta onto the result so persistence can group by it.
        treatment_prompt_text, treatment_prompt_meta = _treatment_prompt()
        # max_tokens=8192 — treatment plans routinely run 3K-4K tokens
        # output (chemical_controls + biological + organic + cultural +
        # rotation_plan + brand list). The default 4096 truncates Claude
        # mid-JSON and the parse step drops the whole thing.
        raw, tok = await call_llm_text(
            cfg,
            system_prompt=treatment_prompt_text,
            user_prompt=user_prompt,
            max_tokens=8192,
        )
        result = _finalise(_parse_json(raw))
        result["_model_used"] = cfg.model
        result["_prompt_meta"] = treatment_prompt_meta

        # Post-LLM safety validation. This is the deterministic guardrail
        # that the chemical registry exists for — it strips banned actives,
        # flags unverified ones, enforces PHI/REI, and refuses chemical
        # recs entirely when the policy gate (low confidence, OOD, etc.)
        # is tripped. We MUST cache the sanitized result, not the raw LLM
        # output, or every cache hit poisons the next request.
        validation = validate_treatment(result, diagnosis=diagnosis, params=params)
        sanitized = validation.sanitized_treatment

        # Severity↔ETL gate: when an Economic Threshold Level is defined for this
        # crop/pest AND the infestation is None/Mild, IPM says prefer monitoring
        # over spraying. Defer chemicals to a monitor-first plan — over-spraying
        # is itself a cost, resistance, and residue harm, not just a missed call.
        etl = grounding.get("etl")
        raw_sev = ((diagnosis.get("primary_diagnosis") or {}).get("severity") or "").lower().strip()
        low_sev = raw_sev in {"none", "mild", "low", "slight", "minor", "early"}
        chems = sanitized.get("chemical_controls") or []
        if etl is not None and low_sev and chems:
            sanitized["monitor_only"] = True
            sanitized["deferred_chemical_controls"] = chems
            sanitized["chemical_controls"] = []
            note = (f"Severity is {raw_sev or 'low'} and below the economic threshold "
                    f"(ETL={etl}) — monitor first; spray only if it crosses the ETL.")
            mp = sanitized.setdefault("monitoring_plan", {})
            watch = mp.setdefault("what_to_watch_for", [])
            if note not in watch:
                watch.append(note)
            logger.info("[Treatment] ETL monitor gate: deferred %d chemical(s) (sev=%s, etl=%s)",
                        len(chems), raw_sev, etl)

        _cache_set(cache_key, sanitized)
        logger.info(
            "Treatment LLM (%s, tier=%s) — kept=%d blockers=%d warnings=%d cached=...%s",
            cfg.model, tier,
            len(sanitized.get("chemical_controls", [])),
            len(validation.blockers),
            len(validation.warnings),
            cache_key[-8:],
        )
        return sanitized, tok
    except Exception:
        logger.exception("Treatment LLM call failed (model=%s)", cfg.model)
        return _fallback_treatment(disease_name), empty_token_info()
