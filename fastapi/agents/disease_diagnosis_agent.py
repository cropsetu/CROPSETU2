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


def _normalise(result: dict, crop_name: Optional[str] = None) -> dict:
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
    result.setdefault("is_healthy", False)
    pd = result.get("primary_diagnosis", {})

    # ── Per-crop canonical-snap (soft enforcement) ────────────────────────────
    # If the model's disease name canonically matches one of the crop's candidate
    # diseases, snap `disease` to that candidate's COMMON name. This deterministically
    # fixes the pathogen-binomial-vs-common-name mismatch (e.g. "Alternaria solani"
    # → "Early Blight") even when the prompt is ignored. On a covered crop where
    # nothing matches we do NOT hard-force out-of-distribution (guards against an
    # incomplete list) — keep the model's name and record a soft penalty note.
    raw_disease = pd.get("disease", "")
    did_snap = False   # True iff the model's pick matched an on-ballot candidate
    # Non-disease causes (nutrient / abiotic / pest) and Healthy go OFF-BALLOT
    # by design (the prompt's NON-DISEASE PATH). Do NOT snap them to a disease
    # candidate or penalize them as "off-list" — that would force-fit a pathogen
    # label and defeat the treatment-stage safety strip that keys on pathogen_type.
    _ptype = (pd.get("pathogen_type") or result.get("pathogen_type") or "").lower()
    _non_disease = _ptype in ("nutrient", "abiotic", "pest", "none")
    if crop_name and raw_disease and raw_disease not in ("Unknown", "UNCERTAIN", "") and not _non_disease:
        try:
            from data.crop_disease_whitelist import candidates_for, snap_to_candidate
            cands = candidates_for(crop_name)
        except Exception:
            cands = None
        if cands is not None:
            snapped = snap_to_candidate(crop_name, raw_disease)
            if snapped:
                if snapped != raw_disease:
                    logger.info("[Snap] '%s' → '%s' (crop=%s)", raw_disease, snapped, crop_name)
                pd["disease"] = snapped
                did_snap = True
                if not pd.get("scientific_name"):
                    from data.disease_synonyms import canonicalize as _canon
                    canon = _canon(snapped, crop_name)
                    if canon and canon.lower() != snapped.lower():
                        pd["scientific_name"] = canon
            else:
                note = f"predicted '{raw_disease}' not in candidate list for {crop_name}"
                if note not in result["confidence_penalties"]:
                    result["confidence_penalties"].append(note)

    # ── Healthy path ──────────────────────────────────────────────────────────
    from data.disease_synonyms import same_disease as _same_disease
    if _same_disease(pd.get("disease", ""), "Healthy"):
        pd["disease"] = "Healthy"
        pd["pathogen_type"] = "none"
        result["is_healthy"] = True
        result["pathogen_type"] = "none"
        result["differentials"] = []

    # ── Binomial leak guard ─────────────────────────────────────────────────────
    # If the model put a raw binomial in `disease` (e.g. "Puccinia triticina") and
    # it did NOT snap onto the ballot, the farmer would see a Latin name. Reverse-map
    # to a common name for this crop if possible; else mark "(name unconfirmed)" and
    # keep the binomial in scientific_name.
    import re as _re
    _fn = (pd.get("disease", "") or "").strip()
    _is_binom = bool(_re.match(r"^[A-Z][a-z]+ [a-z]+$", _fn)) or " spp." in _fn or "f. sp." in _fn or _fn.startswith("Candidatus")
    if _fn and not did_snap and _is_binom and _fn not in ("Unknown", "UNCERTAIN", "Healthy"):
        common = None
        if crop_name:
            try:
                from data.crop_disease_whitelist import candidates_for
                from data.disease_synonyms import same_disease as _sd
                for cand in (candidates_for(crop_name) or []):
                    if _sd(_fn, cand, crop=crop_name):
                        common = cand
                        break
            except Exception:
                common = None
        if not pd.get("scientific_name"):
            pd["scientific_name"] = _fn
        if common:
            pd["disease"] = common
            logger.info("[LeakGuard] binomial '%s' → common '%s' (crop=%s)", _fn, common, crop_name)
        else:
            pd["disease"] = f"{_fn} (name unconfirmed)"
            logger.info("[LeakGuard] off-ballot binomial '%s' → unconfirmed (crop=%s)", _fn, crop_name)

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


def _service_unavailable(model: str, reason: str) -> dict:
    """Distinct from _uncertain_fallback: the model PROVIDER is down (503 /
    timeout / no key), not 'we looked and couldn't tell'. We deliberately do
    NOT fall back to a weaker model (that degrades quality undetectably) — the
    orchestrator surfaces this as a clear 'service temporarily unavailable,
    please try again' message instead of a lower-quality guess."""
    return {
        "_reasoning": f"Diagnosis provider unavailable ({model}): {reason}",
        "service_unavailable": True,
        "primary_diagnosis": {
            "disease": "SERVICE_UNAVAILABLE", "scientific_name": "", "confidence": 0.0,
            "severity": "Unknown",
            "description": "The AI diagnosis service is temporarily unavailable. "
                           "Please try again in a little while.",
            "evidence": [],
        },
        "differentials": [], "severity": "Unknown", "spread_risk": "UNKNOWN",
        "is_certain": False, "needs_advisor": True, "confidence_score": 0.0, "causal_factors": [],
    }


def _candidate_block(crop_name: Optional[str]) -> str:
    """Render the per-crop candidate-disease ballot for the diagnose prompt.

    Covered crop  → a closed list of common names (+ "Healthy") the model must
    choose from. Uncovered crop → an "open vocabulary" note so the naming
    discipline still applies without false narrowing. Never raises.
    """
    try:
        from data.crop_disease_whitelist import candidates_for
        cands = candidates_for(crop_name)
    except Exception:
        cands = None
    if cands:
        listed = "\n".join(f"  - {c}" for c in cands)
        return (
            "CANDIDATE DISEASES FOR THIS CROP "
            "(pick `disease` as a COMMON name from THIS list; binomial goes in scientific_name):\n"
            f"{listed}\n\n"
        )
    return (
        "CANDIDATE DISEASES: open vocabulary (crop not in curated list) — use a canonical "
        "common plant-pathology name; put the binomial in scientific_name.\n\n"
    )


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
    candidate_block = _candidate_block(params.get("crop_name"))
    return f"""CROP DISEASE ANALYSIS

{candidate_block}CROP & FIELD:
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
Follow the 7-step diagnostic process exactly. Apply the confidence scoring formula.
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

    SINGLE-model diagnosis (AI_CROP_DIAGNOSE_MODEL, e.g. gemini-2.5-pro). There
    is intentionally NO cross-model fallback: silently answering with a weaker
    model when the primary is down degrades accuracy in a way that's hard to
    detect and maintain. If the provider is unavailable (503 "high demand",
    timeout, missing key) we return a clear `service_unavailable` result and the
    orchestrator tells the user the service is temporarily down — far better than
    a lower-quality guess. Transient blips are absorbed by ONE same-model retry
    inside the provider call (llm_utils), not by switching models.
    """
    # Admin App Settings choice (ai.model.diagnose), forwarded per request inside
    # params by the Express scan client; falls back to AI_CROP_DIAGNOSE_MODEL/env.
    cfg = get_feature_config("CROP_DIAGNOSE", model_override=params.get("model_diagnose"))
    if not cfg.api_key:
        return _service_unavailable(
            cfg.model, "no API key configured (set AI_CROP_DIAGNOSE_API_KEY)"
        ), empty_token_info("none")

    # Load images as base64
    images_b64 = []
    for img in images[:1]:   # single-image pipeline (multi-image feature removed)
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

    # Retry strategy — single model (cfg.model), two attempts, PARSE-failure
    # retry only. NO cross-model fallback (a weaker fallback model degrades
    # quality undetectably). A provider/transport error (503, timeout, ...) is
    # NOT retried across models — it returns a clear service_unavailable result.
    # The two retries cover:
    #   1. JSON parse failure (bump temperature, resample)
    #   2. Critical-field missing (same fix)
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
            # max_tokens=8192 — diagnose prompt asks for full JSON with primary
            # + 3 differentials + reasoning blocks; 4096 truncates mid-response.
            raw, tok = await call_llm_vision(
                cfg,
                system_prompt=system_prompt_text,
                user_prompt=context,
                images_b64=images_b64,
                temperature=temp,
                max_tokens=8192,
            )
            # Accumulate tokens across retries.
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

            result = _normalise(result, crop_name=params.get("crop_name"))
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
            # Provider/transport failure (503 "high demand", timeout, connection
            # reset, ...). We do NOT fall back to another model — that silently
            # degrades quality. Surface a clear service_unavailable result so the
            # user is told to retry. (Parse-level retries are handled above; the
            # provider already did one same-model quick retry internally.)
            logger.exception("Diagnose call failed (model=%s) — reporting service unavailable", cfg.model)
            return _service_unavailable(cfg.model, f"{type(exc).__name__}: {exc}"), accumulated_tokens

    return (last_result or _uncertain_fallback("Max retries reached")), accumulated_tokens
