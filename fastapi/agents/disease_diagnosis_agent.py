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

from config import DIAGNOSIS_CONF_THRESHOLD, DIAGNOSIS_ESCALATE_BELOW, MAX_DIAGNOSIS_RETRIES
from agents.llm_dispatch import call_llm_vision, get_feature_config
from agents.llm_utils import empty_token_info
from agents.prompt_registry import load_prompt
from observability.logging import user_id_var

# Prompt is loaded from agents/prompts/diagnose.<version>.md at import time.
# This is the BASELINE used when no A/B is configured. If ACTIVE_VERSIONS
# is later set to a dict, _resolve_prompt() at run time picks the per-user
# variant — see _diagnose_prompt() below.
DIAGNOSE_PROMPT = load_prompt("diagnose")
SYSTEM_PROMPT = DIAGNOSE_PROMPT.text
DIAGNOSE_PROMPT_META = DIAGNOSE_PROMPT.meta()


def _diagnose_prompt() -> tuple[str, dict]:
    """
    Per-request prompt resolution. Returns (text, meta_dict).
    bucket_id is the authenticated user_id from the contextvar — gives
    sticky A/B routing so the same farmer always sees the same variant.
    Anonymous requests fall back to a hash on the prompt name.
    """
    p = load_prompt("diagnose", bucket_id=user_id_var.get() or None)
    return p.text, p.meta()



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

    # Normalize differential probabilities. The prompt asks for "sum ≤ 1.0"
    # but LLMs frequently violate that — the cross_verify step keys off
    # primary-vs-top-differential probability, so a 0.85 + 0.80 pair would
    # silently inflate the "ambiguous_pair" penalty. Scale down if the total
    # exceeds 1.0 (preserving the relative ordering).
    diffs = result.get("differentials") or []
    if diffs:
        cleaned: list[dict] = []
        for d in diffs:
            p = d.get("probability")
            if isinstance(p, (int, float)) and p > 1.0:
                # LLM emitted 12 (meaning 12%) — interpret as percent.
                p = p / 100.0
            if isinstance(p, (int, float)):
                d["probability"] = max(0.0, min(1.0, float(p)))
            cleaned.append(d)
        primary_p = result["confidence_score"]
        total = primary_p + sum(d.get("probability", 0) or 0 for d in cleaned)
        if total > 1.0 and total > 0:
            # Scale every differential down proportionally so the SUM is 1.0.
            # We do NOT shrink the primary's confidence — that's been the
            # canonical "how sure are we" signal across the rest of the
            # pipeline, and changing it here would double-count with the
            # cross_verify penalties.
            scale = (1.0 - primary_p) / max(total - primary_p, 1e-9)
            for d in cleaned:
                if isinstance(d.get("probability"), (int, float)):
                    d["probability"] = round(d["probability"] * scale, 4)
        result["differentials"] = cleaned
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


def _build_context(image_quality: dict, weather_risk: dict, params: dict, local_prior: list[dict] | None = None) -> str:
    w = weather_risk
    iq = image_quality
    raw = params.get("_raw_weather", {})
    cur = raw.get("current", {}) if raw else {}

    # Local-classifier prior. When configured, the on-prem ONNX model
    # produces a top-3 with scores. We feed that to the LLM as a SOFT
    # prior — explicit "use as one input among many" so the LLM can
    # override when the visual evidence demands it. Without the prior
    # block, the prompt is unchanged.
    if local_prior:
        local_block = "\nLOCAL CLASSIFIER PRIOR (use as one input — do NOT just copy):\n"
        for p in local_prior[:3]:
            local_block += f"  - {p['label']:<55}  {p['score']*100:.1f}%\n"
        local_block += "  (Override the prior if visual evidence + weather correlation disagree.)\n"
    else:
        local_block = ""

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

    _fh = params.get("farm_history")
    farm_history_block = (
        f"FARM HISTORY (recent practices from the farmer's own crop-cycle logs — "
        f"weigh these when judging the disease and ruling out look-alikes):\n{_fh}\n"
        if _fh else ""
    )
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

{farm_history_block}{weather_block}

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
{local_block}
Follow the 5-step diagnostic process exactly. Apply the confidence scoring formula.
Set weather_correlation to SUPPORTS / PARTIAL / CONTRADICTS.
Return JSON only. No markdown."""


async def run_disease_diagnosis_agent(
    images: list[dict],
    image_quality: dict,
    weather_risk: dict,
    params: dict,
) -> tuple[dict, dict]:
    """
    Returns (diagnosis_dict, token_info).

    Uses the single AI_CROP_DIAGNOSE_MODEL configured in .env (default:
    claude-haiku-4-5-20251001 via Anthropic). No fallback chain — if the
    model fails, the call surfaces the error.
    """
    cfg = get_feature_config("CROP_DIAGNOSE")
    if not cfg.api_key:
        return _uncertain_fallback(
            f"No API key for {cfg.model} (set AI_CROP_DIAGNOSE_API_KEY)"
        ), empty_token_info("none")

    # Load images as base64
    images_b64 = []
    for img in images[:5]:
        try:
            b64, mime = _read_image_b64(img["path"])
            images_b64.append({"data": b64, "mime_type": mime})
        except Exception as e:
            logger.warning("Cannot read image: %s", e)

    if not images_b64 and not image_quality.get("enhancement_notes"):
        return _uncertain_fallback("No usable images provided"), empty_token_info(cfg.model)

    # Optional local ONNX classifier — disabled by default. When configured
    # via LOCAL_CLASSIFIER_MODEL_PATH, this produces a top-3 prior that the
    # LLM treats as one input among many (NOT a hard label). classify()
    # returns None if the model isn't loaded — we silently skip the prior.
    local_prior_dicts: list[dict] | None = None
    try:
        from models.local_classifier import classify as _local_classify
        preds = _local_classify(images)
        if preds:
            local_prior_dicts = [p.as_dict() for p in preds]
            logger.info(
                "[LocalCls] prior=%s",
                [(p["label"], round(p["score"], 3)) for p in local_prior_dicts],
            )
    except Exception:
        logger.debug("[LocalCls] not used", exc_info=False)

    context = _build_context(image_quality, weather_risk, params, local_prior=local_prior_dicts)
    # Resolve the prompt (and variant when A/B is configured) per-request.
    # The system prompt text + its meta are returned so we can stamp the
    # actual version that ran into the response — critical when ACTIVE_VERSIONS
    # is a weighted dict and different users see different variants.
    system_prompt_text, prompt_meta_for_request = _diagnose_prompt()
    last_result: Optional[dict] = None
    accumulated_tokens: dict = empty_token_info(cfg.model)

    # Retry strategy — single model (cfg.model), two attempts, parse-failure
    # retry only. No cross-model fallback (the previous chain walker is gone;
    # admin controls reliability via .env model swap). The two retries cover:
    #   1. JSON parse failure (bump temperature, resample)
    #   2. Critical-field missing (same fix)
    # Low confidence does NOT trigger a retry — cross_verify adjudicates.
    max_attempts = min(2, MAX_DIAGNOSIS_RETRIES)
    # Primary pass is fully deterministic (temp=0) so repeat scans of the same
    # image return the same disease + confidence — classification, not creative
    # writing. The retry samples at 0.5 only when JSON parsing fails, to give
    # the model a chance to escape a bad token stream. Diversity for borderline
    # cases lives in the ensemble agent, not here.
    temperatures = (0.0, 0.5)

    for attempt in range(1, max_attempts + 1):
        temp = temperatures[min(attempt - 1, len(temperatures) - 1)]
        try:
            # max_tokens=8192 — diagnose prompt asks for full JSON with
            # primary + 3 differentials + reasoning blocks. The default
            # 4096 truncates Claude mid-response on richer crops.
            raw, tok = await call_llm_vision(
                cfg,
                system_prompt=system_prompt_text,
                user_prompt=context,
                images_b64=images_b64,
                temperature=temp,
                max_tokens=8192,
            )
            # Accumulate tokens across retries
            accumulated_tokens["input_tokens"]  += tok["input_tokens"]
            accumulated_tokens["output_tokens"] += tok["output_tokens"]
            accumulated_tokens["total_tokens"]  += tok["total_tokens"]
            accumulated_tokens["cost_usd"]      += tok["cost_usd"]
            accumulated_tokens["model"]          = cfg.model

            result = _parse_json(raw)
            if not result:
                if attempt == max_attempts:
                    return _uncertain_fallback(
                        f"JSON parse failed after {attempt} attempts ({cfg.model})"
                    ), accumulated_tokens
                logger.warning("Attempt %d parse failure (model=%s) — retrying with temp=%.1f",
                               attempt, cfg.model, temperatures[min(attempt, len(temperatures)-1)])
                continue

            result = _normalise(result)
            last_result = result

            # Missing-critical-field check — retry-worthy.
            pd = result.get("primary_diagnosis", {}) or {}
            if not pd.get("disease") or pd.get("disease") in ("Unknown", "UNCERTAIN", ""):
                if attempt == max_attempts:
                    return result, accumulated_tokens
                logger.warning("Attempt %d missing primary disease (model=%s) — retrying with higher temp",
                               attempt, cfg.model)
                continue

            conf = result["confidence_score"]
            logger.info(
                "Diagnose OK (model=%s temp=%.1f attempt=%d): disease=%s confidence=%.0f%%",
                cfg.model, temp, attempt,
                pd.get("disease"), conf * 100,
            )
            if local_prior_dicts:
                result["_local_prior"] = local_prior_dicts
            result["_prompt_meta"] = prompt_meta_for_request
            # Even at LOW confidence we return — orchestrator's cross_verify is
            # the canonical adjudicator. needs_advisor is set inside _normalise.
            return result, accumulated_tokens

        except Exception as exc:
            logger.exception("Diagnose attempt %d failed (model=%s)", attempt, cfg.model)
            if attempt == max_attempts:
                return (last_result or _uncertain_fallback(f"{cfg.model} failed: {exc}")), accumulated_tokens
            await asyncio.sleep(min(3 * attempt, 6))

    return (last_result or _uncertain_fallback("Max retries reached")), accumulated_tokens
