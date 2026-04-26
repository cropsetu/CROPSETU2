"""
CropGuard Orchestrator — Agentic AI Pipeline
Coordinates 5 specialized Claude agents with parallel execution + recursive retry logic.

Pipeline:
  ┌─ PARALLEL ──────────────────────────┐
  │  Agent 1: Image Quality             │
  │  Agent 2: Weather Analysis          │
  └─────────────────────────────────────┘
           ↓  Quality gate (score >= 0.6)
  Agent 3: Disease Diagnosis  ← retry up to 3x if confidence < 0.7
           ↓  Escalate to advisor if confidence < 0.5 after retries
  Agent 4: Treatment & Fertilizer
           ↓
  Agent 5: Report Generator
           ↓
  Final report card → client
"""
from __future__ import annotations
import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

from weather_service import fetch_weather
from agents.image_quality_agent import run_image_quality_agent
from agents.weather_analysis_agent import run_weather_analysis_agent
from agents.disease_diagnosis_agent import run_disease_diagnosis_agent
from agents.treatment_agent import run_treatment_agent
from agents.report_generator_agent import run_report_generator_agent
from agents.llm_utils import empty_token_info
from config import IMAGE_QUALITY_THRESHOLD, DIAGNOSIS_ESCALATE_BELOW
from services.weather_rules import analyze_weather_risk_rules
from services.district_coords import get_weather_coords


async def run_diagnosis(
    params: dict,
    images: list[dict],          # [{"path": str, "type": str}]
) -> dict:
    """
    Main orchestrator entry point.

    params keys (all optional unless marked *required*):
      crop_name*          str
      crop_growth_stage*  str
      soil_type*          str
      irrigation_system*  str
      planting_date*      str (ISO date)
      field_latitude      float
      field_longitude     float
      crop_variety        str
      previous_crop       str
      affected_area_percent float
      symptom_description str
      recent_pesticide_used str
      fertilizer_history  str
      farm_size_acres     float
      language            str  (default "en")

    images: list of {"path": <temp file path>, "type": <view type>}
    Raises RuntimeError on unrecoverable pipeline failure.
    """
    try:
        return await _run_diagnosis_inner(params, images)
    except Exception as exc:
        logger.exception("[Orchestrator] Unhandled pipeline error — crop=%s", params.get("crop_name"))
        raise RuntimeError(f"Diagnosis pipeline failed: {type(exc).__name__}") from exc


async def _run_diagnosis_inner(
    params: dict,
    images: list[dict],
) -> dict:
    t_start = time.monotonic()

    lat = params.get("field_latitude")
    lng = params.get("field_longitude")
    state    = params.get("state", "")
    district = params.get("district", "")
    city     = params.get("city", "")

    logger.info(f"\n{'='*60}")
    logger.info(f"[Orchestrator] ▶ Pipeline START")
    logger.info(f"[Orchestrator]   Crop        : {params.get('crop_name', 'Unknown')}")
    logger.info(f"[Orchestrator]   Growth Stage: {params.get('crop_growth_stage', 'Unknown')}")
    logger.info(f"[Orchestrator]   Soil Type   : {params.get('soil_type', 'Unknown')}")
    logger.info(f"[Orchestrator]   Irrigation  : {params.get('irrigation_system', 'Unknown')}")
    logger.info(f"[Orchestrator]   Farm Size   : {params.get('farm_size_acres', '?')} acres")
    logger.info(f"[Orchestrator]   GPS         : lat={lat}, lon={lng}")
    logger.info(f"[Orchestrator]   Images      : {len(images)} file(s) → {[i['type'] for i in images]}")
    logger.info(f"{'='*60}")

    # ── STAGE 1: Coordinate fallback + ImageQuality + WeatherFetch in PARALLEL ─
    logger.info(f"[Orchestrator] STAGE 1 — CoordFallback + ImageQuality + WeatherFetch (parallel)...")

    # Resolve coordinates via priority chain (GPS → geocode → district center → state capital)
    eff_lat, eff_lon, coord_source = await get_weather_coords(lat, lng, state, district, city)
    logger.info(f"[Orchestrator]   Coords : lat={eff_lat}  lon={eff_lon}  source={coord_source}")

    weather_task   = asyncio.create_task(_safe_fetch_weather(eff_lat, eff_lon))
    img_qual_task  = asyncio.create_task(run_image_quality_agent(images))

    weather_data, image_quality = await asyncio.gather(weather_task, img_qual_task)

    logger.info(f"[Orchestrator]   ImageQuality score={image_quality.get('quality_score',0):.2f}  usable={image_quality.get('usable')}")
    if weather_data:
        cur = weather_data.get("current", {})
        logger.info(f"[Orchestrator]   Weather fetched  → temp={cur.get('temperature')}°C  humidity={cur.get('humidity')}%  condition={cur.get('weather_desc')}")
    else:
        logger.warning(f"[Orchestrator]   Weather fetch    → SKIPPED (no usable coords, source={coord_source})")

    # ── STAGE 2: Weather Analysis — rule-based (no LLM, instant, $0) ─────────
    logger.info(f"[Orchestrator] STAGE 2 — WeatherAnalysis (rule-based, $0)...")
    weather_risk = analyze_weather_risk_rules(
        weather_data=weather_data,
        crop_name=params.get("crop_name", "Unknown"),
        soil_type=params.get("soil_type", "Unknown"),
        growth_stage=params.get("crop_growth_stage", "Unknown"),
    )
    # Rule-based analysis has no token cost
    tok_weather = empty_token_info("rule-based")
    logger.info(f"[Orchestrator]   Disease risk    : {weather_risk.get('overall_disease_risk')}  (rule-based, $0)")
    logger.info(f"[Orchestrator]   Soil risk       : {weather_risk.get('soil_risk')}")
    logger.info(f"[Orchestrator]   Risk factors    : {weather_risk.get('risk_factors', [])}")
    logger.info(f"[Orchestrator]   Favorable for   : {weather_risk.get('favorable_diseases', [])}")
    logger.info(f"[Orchestrator]   Forecast risk   : {weather_risk.get('forecast_risk')}")
    logger.info(f"[Orchestrator]   Advisory        : {weather_risk.get('advisory')}")
    logger.info(f"[Orchestrator]   Weather used    : {weather_risk.get('weather_used', False)}  coord_source={coord_source}")

    # ── Quality Gate ──────────────────────────────────────────────────────────
    quality_score = image_quality.get("quality_score", 0.0)
    image_usable  = image_quality.get("usable", False)

    enh_notes = image_quality.get("enhancement_notes", "")
    if not image_usable and quality_score < 0.4 and not enh_notes:
        logger.error(f"[Orchestrator] ✗ Quality gate FAILED — short-circuiting (score={quality_score:.2f})")
        return _needs_rescan_response(image_quality, weather_risk, params)

    logger.info(f"[Orchestrator]   Quality gate    : PASSED (score={quality_score:.2f})")

    # ── STAGE 3: Disease Diagnosis (vision + all context) ────────────────────
    logger.info(f"[Orchestrator] STAGE 3 — DiseaseDiagnosis (Gemini vision)...")
    # Inject raw weather into params so the diagnosis prompt can show exact metrics
    diag_params = dict(params)
    if weather_data:
        diag_params["_raw_weather"] = weather_data
    diagnosis, tok_diagnosis = await run_disease_diagnosis_agent(
        images=images,
        image_quality=image_quality,
        weather_risk=weather_risk,
        params=diag_params,
    )
    pd = diagnosis.get("primary_diagnosis", {})
    confidence = diagnosis.get("confidence_score", 0.0)
    logger.info(f"[Orchestrator]   Disease         : {pd.get('disease')} ({pd.get('scientific_name', '')})")
    logger.info(f"[Orchestrator]   Confidence      : {confidence:.0%}")
    logger.info(f"[Orchestrator]   Severity        : {pd.get('severity')}")
    logger.info(f"[Orchestrator]   Spread risk     : {diagnosis.get('spread_risk')}")
    logger.info(f"[Orchestrator]   Causal factors  : {diagnosis.get('causal_factors', [])}")
    logger.info(f"[Orchestrator]   Needs advisor   : {diagnosis.get('needs_advisor')}")
    logger.info(f"[Orchestrator]   Differentials   : {[d.get('disease') for d in diagnosis.get('differentials', [])]}")

    # ── Escalation check ──────────────────────────────────────────────────────
    if confidence < DIAGNOSIS_ESCALATE_BELOW:
        diagnosis["needs_advisor"] = True
        logger.info(f"[Orchestrator] ⚠ Escalating to advisor — confidence {confidence:.2f} below threshold {DIAGNOSIS_ESCALATE_BELOW}")

    # ── STAGE 3.5: Cross-Verification (rule-based, $0) ──────────────────────
    logger.info(f"[Orchestrator] STAGE 3.5 — CrossVerification (rule-based, $0)...")
    diagnosis, confidence = _cross_verify(diagnosis, weather_risk, image_quality)
    logger.info(f"[Orchestrator]   Post-verification confidence: {confidence:.0%}")
    logger.info(f"[Orchestrator]   Confidence tier: {'HIGH' if confidence >= 0.85 else 'MEDIUM' if confidence >= 0.70 else 'LOW' if confidence >= 0.50 else 'VERY_LOW'}")
    logger.info(f"[Orchestrator]   Penalties applied: {diagnosis.get('confidence_penalties', [])}")
    logger.info(f"[Orchestrator]   Needs advisor: {diagnosis.get('needs_advisor')}")
    logger.info(f"[Orchestrator]   Needs lab: {diagnosis.get('needs_lab_confirmation', False)}")

    # If cross-verification dropped confidence below escalation threshold, skip treatment
    if confidence < DIAGNOSIS_ESCALATE_BELOW and not diagnosis.get("_force_treatment"):
        diagnosis["needs_advisor"] = True
        logger.info(f"[Orchestrator] ⚠ Cross-verification dropped confidence below {DIAGNOSIS_ESCALATE_BELOW} — escalating")

    # ── STAGE 4: Treatment & Fertilizer ──────────────────────────────────────
    logger.info(f"[Orchestrator] STAGE 4 — TreatmentAgent (Groq)...")
    treatment, tok_treatment = await run_treatment_agent(
        diagnosis=diagnosis,
        weather_risk=weather_risk,
        params=params,
    )
    logger.info(f"[Orchestrator]   Immediate actions   : {len(treatment.get('immediate_actions', []))}")
    logger.info(f"[Orchestrator]   Chemical controls   : {len(treatment.get('chemical_controls', []))}")
    logger.info(f"[Orchestrator]   Organic alternatives: {len(treatment.get('organic_alternatives', []))}")
    logger.info(f"[Orchestrator]   Fertilizer recs     : {len(treatment.get('fertilizer_recommendations', []))}")
    logger.info(f"[Orchestrator]   Spray timing        : {treatment.get('spray_timing_advisory', '')[:80]}")

    # ── STAGE 5: Report Generator ─────────────────────────────────────────────
    logger.info(f"[Orchestrator] STAGE 5 — ReportGenerator (template)...")
    # Inject raw weather into params for report weather cards
    report_params = dict(params)
    if weather_data:
        report_params["_raw_weather"] = weather_data
    report, tok_report = await run_report_generator_agent(
        diagnosis=diagnosis,
        treatment=treatment,
        weather_risk=weather_risk,
        image_quality=image_quality,
        params=report_params,
    )
    logger.info(f"[Orchestrator]   Report ID       : {report.get('report_id', '')[:8]}")
    logger.info(f"[Orchestrator]   farmer_summary  : {(report.get('farmer_summary') or '')[:100]}...")
    logger.info(f"[Orchestrator]   next_steps count: {len(report.get('next_steps', []))}")
    logger.info(f"[Orchestrator]   weather_outlook : {report.get('weather_outlook', {})}")

    # ── Token usage aggregation ───────────────────────────────────────────────
    all_toks = [tok_weather, tok_diagnosis, tok_treatment, tok_report]
    total_inp  = sum(t["input_tokens"]  for t in all_toks)
    total_out  = sum(t["output_tokens"] for t in all_toks)
    total_tok  = sum(t["total_tokens"]  for t in all_toks)
    total_cost = round(sum(t["cost_usd"] for t in all_toks), 6)

    pipeline_token_usage = {
        "agents": {
            "weather_analysis":  tok_weather,
            "disease_diagnosis": tok_diagnosis,
            "treatment":         tok_treatment,
            "report_generator":  tok_report,
        },
        "total_input_tokens":  total_inp,
        "total_output_tokens": total_out,
        "total_tokens":        total_tok,
        "total_cost_usd":      total_cost,
    }
    logger.debug(f"[Orchestrator] ── TOKEN USAGE SUMMARY ──────────────────────────────")
    logger.debug(f"[Orchestrator]   Weather   : model={tok_weather['model']}  in={tok_weather['input_tokens']}  out={tok_weather['output_tokens']}  cost=${tok_weather['cost_usd']:.4f}")
    logger.debug(f"[Orchestrator]   Diagnosis : model={tok_diagnosis['model']}  in={tok_diagnosis['input_tokens']}  out={tok_diagnosis['output_tokens']}  cost=${tok_diagnosis['cost_usd']:.4f}")
    logger.debug(f"[Orchestrator]   Treatment : model={tok_treatment['model']}  in={tok_treatment['input_tokens']}  out={tok_treatment['output_tokens']}  cost=${tok_treatment['cost_usd']:.4f}")
    logger.debug(f"[Orchestrator]   Report    : model={tok_report['model']}  in={tok_report['input_tokens']}  out={tok_report['output_tokens']}  cost=${tok_report['cost_usd']:.4f}")
    logger.info(f"[Orchestrator]   ─────────────────────────────────────────────────────")
    logger.debug(f"[Orchestrator]   TOTAL     : input={total_inp}  output={total_out}  total={total_tok}  cost=${total_cost:.4f}")

    # Attach pipeline timing
    elapsed = round(time.monotonic() - t_start, 2)
    report.setdefault("meta", {})
    report["meta"]["pipeline_seconds"] = elapsed
    report["meta"]["image_quality_score"] = quality_score
    report["meta"]["confidence_score"] = confidence
    report["meta"]["escalated"] = diagnosis.get("needs_advisor", False)
    report["meta"]["pipeline_token_usage"] = pipeline_token_usage

    # Attach raw weather for detailed PDF report
    if weather_data:
        report.setdefault("weather_outlook", {})
        report["weather_outlook"]["raw_current"]  = weather_data.get("current", {})
        report["weather_outlook"]["raw_soil"]     = weather_data.get("soil", {})
        report["weather_outlook"]["raw_forecast"] = weather_data.get("daily_forecast", [])[:7]
        report["weather_outlook"]["location"]     = weather_data.get("location", {})

    logger.info(f"[Orchestrator] ✓ Pipeline DONE in {elapsed}s")
    logger.info(f"{'='*60}\n")

    return report


# ── Cross-Verification (rule-based, $0) ──────────────────────────────────────

def _cross_verify(
    diagnosis: dict,
    weather_risk: dict,
    image_quality: dict,
) -> tuple[dict, float]:
    """
    Cross-verify diagnosis against weather favorability and image quality.
    Applies confidence penalties when evidence conflicts.
    Returns (updated_diagnosis, updated_confidence).

    This is the "skeptic" step — it catches cases where:
    - Vision says disease X but weather contradicts it
    - Differentials are too close (ambiguous pair)
    - Image quality is poor
    - Pathogen type is ambiguous (bacterial vs fungal)
    - Crop mismatch detected
    """
    confidence = diagnosis.get("confidence_score", 0.0)
    penalties: list[str] = list(diagnosis.get("confidence_penalties", []))

    # 1. Weather contradiction penalty
    weather_corr = diagnosis.get("weather_correlation", "PARTIAL")
    disease_name = diagnosis.get("primary_diagnosis", {}).get("disease", "").lower()
    favorable = [d.lower() for d in weather_risk.get("favorable_diseases", [])]

    if weather_corr == "CONTRADICTS" and "contradicts_weather" not in str(penalties):
        confidence -= 0.12
        penalties.append(f"Weather CONTRADICTS diagnosis (-0.12)")

    # Check if diagnosed disease is NOT in the favorable diseases list
    if favorable and disease_name and disease_name != "unknown":
        disease_in_favorable = any(disease_name in f or f in disease_name for f in favorable)
        if not disease_in_favorable and weather_risk.get("weather_used"):
            confidence -= 0.05
            penalties.append(f"Disease '{disease_name}' not in weather-favorable list (-0.05)")

    # 2. Ambiguous differential penalty — top 2 diseases within 10% confidence
    differentials = diagnosis.get("differentials", [])
    if differentials:
        primary_conf = diagnosis.get("confidence_score", 0)
        top_diff_prob = differentials[0].get("probability", 0)
        if isinstance(top_diff_prob, (int, float)) and isinstance(primary_conf, (int, float)):
            if abs(primary_conf - top_diff_prob) < 0.10 and top_diff_prob > 0.25:
                if "ambiguous_pair" not in str(penalties):
                    confidence -= 0.08
                    penalties.append(
                        f"Ambiguous: primary ({primary_conf:.0%}) vs differential "
                        f"'{differentials[0].get('disease', '?')}' ({top_diff_prob:.0%}) (-0.08)"
                    )

    # 3. Image quality penalty
    img_score = image_quality.get("quality_score", 1.0)
    if img_score < 0.5 and "image_quality" not in str(penalties):
        confidence -= 0.10
        penalties.append(f"Poor image quality ({img_score:.2f}) (-0.10)")

    # 4. Crop mismatch penalty
    if diagnosis.get("crop_mismatch") and "crop_mismatch" not in str(penalties):
        confidence -= 0.20
        penalties.append("Crop mismatch suspected (-0.20)")

    # 5. Out-of-distribution detection
    if diagnosis.get("is_out_of_distribution") and "out_of_distribution" not in str(penalties):
        confidence = min(confidence, 0.45)
        penalties.append("Out-of-distribution image — confidence capped at 0.45")

    # 6. Bacterial vs fungal ambiguity
    if diagnosis.get("needs_lab_confirmation") and "lab_confirmation" not in str(penalties):
        confidence -= 0.08
        penalties.append("Pathogen type ambiguous (bacterial/fungal) — lab confirmation needed (-0.08)")

    # 7. Perspective disagreement cap
    agreement = diagnosis.get("perspective_agreement", "")
    if agreement == "0/3" and confidence > 0.55:
        confidence = 0.55
        penalties.append("All 3 diagnostic perspectives disagree — confidence capped at 0.55")

    # Clamp confidence
    confidence = max(0.0, min(1.0, confidence))

    # Update diagnosis with verified confidence
    diagnosis["confidence_score"] = confidence
    diagnosis["confidence_penalties"] = penalties
    if diagnosis.get("primary_diagnosis"):
        diagnosis["primary_diagnosis"]["confidence"] = confidence
    diagnosis["needs_advisor"] = diagnosis.get("needs_advisor", False) or confidence < DIAGNOSIS_ESCALATE_BELOW

    # Determine confidence tier for downstream agents
    if confidence >= 0.85:
        diagnosis["confidence_tier"] = "HIGH"
    elif confidence >= 0.70:
        diagnosis["confidence_tier"] = "MEDIUM"
    elif confidence >= 0.50:
        diagnosis["confidence_tier"] = "LOW"
    else:
        diagnosis["confidence_tier"] = "VERY_LOW"

    return diagnosis, confidence


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _safe_fetch_weather(lat: Optional[float], lng: Optional[float]) -> Optional[dict]:
    if lat is None or lng is None:
        return None
    try:
        return await fetch_weather(lat, lng)
    except Exception as exc:
        logger.error(f"[Orchestrator] Weather fetch failed: {exc}")
        return None


def _needs_rescan_response(
    image_quality: dict,
    weather_risk: dict,
    params: dict,
) -> dict:
    """Short-circuit response when images are completely unusable."""
    return {
        "report_id": "needs_rescan",
        "generated_at": "",
        "language": params.get("language", "en"),
        "farm": {"crop": params.get("crop_name", "Unknown")},
        "disease": {"name_common": "UNDETERMINED", "confidence_pct": 0, "severity": "Unknown"},
        "causes": [],
        "treatment": {
            "immediate": image_quality.get("suggestions", [
                "Retake photos in natural daylight",
                "Take one close-up of the affected area from ~20 cm",
                "Take one whole-plant photo from ~1 m distance",
            ]),
        },
        "next_steps": image_quality.get("suggestions", []),
        "advisor_needed": True,
        "weather_outlook": {
            "risk": weather_risk.get("overall_disease_risk", "UNKNOWN"),
            "advisory": weather_risk.get("advisory", ""),
        },
        "farmer_summary": (
            "The uploaded images could not be analysed — they may be blurry, too dark, "
            "or not showing the affected area clearly. Please retake the photos and try again."
        ),
        "confidence_score": 0.0,
        "risk_level": weather_risk.get("overall_disease_risk", "UNKNOWN"),
        "image_quality": {
            "score": image_quality.get("quality_score", 0),
            "usable": False,
            "suggestions": image_quality.get("suggestions", []),
        },
        "meta": {"pipeline_seconds": 0, "escalated": True, "reason": "unusable_images"},
    }
