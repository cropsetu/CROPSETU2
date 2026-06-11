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
from agents.registry import normalize_tier
from agents.router import describe_chains
from config import (
    ALLOW_BEST_TIER,
    DIAGNOSIS_ESCALATE_BELOW,
    ENABLE_ENSEMBLE,
    ENSEMBLE_AMBIGUOUS_DELTA,
    ENSEMBLE_ESCALATE_BELOW,
    ENSEMBLE_MIN_BUDGET_USD,
    IMAGE_QUALITY_THRESHOLD,
    IMAGE_UNUSABLE_THRESHOLD,
    STRICT_IMAGE_GATE,
    PIPELINE_DEFAULT_TIER,
)
from agents import ensemble_agent, reconciler
from observability.logging import request_id_var, tier_var, user_id_var
from persistence.diagnosis_repo import record_diagnosis
from pipeline.budget import BudgetExhausted, PipelineBudget
from safety import cross_verify
from services.weather_rules import analyze_weather_risk_rules, disease_is_known
from services.district_coords import get_weather_coords


# Hard cap on the whole pipeline. Per-stage httpx timeouts can pile up
# (4 stages × 3 retries × 90 s ≈ 18 min worst-case) and the Express
# proxy aborts at 175 s, leaving the orchestrator running for nothing
# and burning Anthropic spend. asyncio.wait_for cancels the inner task
# on timeout — agents are async through-and-through so cancellation
# propagates cleanly to in-flight LLM calls.
#
# 240s gives room for: a Claude Haiku vision diagnose call (60–90s with
# our 8K system prompt + 8K max output) + treatment LLM (20–40s) + a
# router fallback hop if the primary fails (another ~60s). Express's
# default scan timeout is 175s, so callers should bump that to 250s in
# parallel for this to be visible end-to-end.
_PIPELINE_TIMEOUT_SECONDS = 240

# Static per-model reconciler vote weights (until the field-feedback loop yields
# empirical per-model top-1). Frontier vision models vote heavier than the
# cheap/fast tier; the primary (no `_model`) and any unlisted model default to 1.0.
_MODEL_ACCURACY_WEIGHTS = {
    "gemini-2.5-pro":            1.25,
    "gemini-2.5-flash":          0.90,
}


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
      farm_history        str  (recent irrigation/seed/pest-event log summary, optional)
      farm_size_acres     float
      language            str  (default "en")
      farmer_name         str  (report only, optional)
      farmer_contact      str  (report only, optional)
      farm_address        str  (report only, optional)

    images: list of {"path": <temp file path>, "type": <view type>}
    Raises RuntimeError on unrecoverable pipeline failure.
    Raises TimeoutError if the pipeline exceeds _PIPELINE_TIMEOUT_SECONDS.
    """
    try:
        return await asyncio.wait_for(
            _run_diagnosis_inner(params, images),
            timeout=_PIPELINE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.error(
            "[Orchestrator] Pipeline TIMEOUT after %ds — crop=%s",
            _PIPELINE_TIMEOUT_SECONDS, params.get("crop_name"),
        )
        raise TimeoutError(
            f"Diagnosis pipeline exceeded {_PIPELINE_TIMEOUT_SECONDS}s — please try again."
        )
    except Exception as exc:
        logger.exception("[Orchestrator] Unhandled pipeline error — crop=%s", params.get("crop_name"))
        # Surface the actual exception message (not just the class name) so the
        # cause is visible client-side and in triage logs. Without `: {exc}` a
        # bare "ValueError" with no detail is unactionable.
        raise RuntimeError(f"Diagnosis pipeline failed: {type(exc).__name__}: {exc}") from exc


async def _run_diagnosis_inner(
    params: dict,
    images: list[dict],
) -> dict:
    t_start = time.monotonic()

    # ── Pipeline-wide time budget ─────────────────────────────────────────────
    # The outer asyncio.wait_for in run_diagnosis still caps the whole thing at
    # _PIPELINE_TIMEOUT_SECONDS. This PipelineBudget exposes a finer view: each
    # stage gets a soft cap AND we can detect "no time left for treatment" and
    # degrade to a cultural-only response rather than hard-timeout in the LLM
    # call.
    budget = PipelineBudget(total_seconds=_PIPELINE_TIMEOUT_SECONDS)

    # ── Resolve farmer-chosen tier ("Fast" vs "Best") ─────────────────────────
    # Request value wins; falls back to PIPELINE_DEFAULT_TIER. ALLOW_BEST_TIER
    # is the ops kill-switch — if false, every request is forced to "fast"
    # regardless of what the client sent (used during cost incidents).
    requested_tier = params.get("tier") or PIPELINE_DEFAULT_TIER
    tier = normalize_tier(requested_tier)
    if tier == "best" and not ALLOW_BEST_TIER:
        logger.warning("[Orchestrator] Best tier disabled by ALLOW_BEST_TIER=false — coerced to fast")
        tier = "fast"
    # Stash resolved tier back into params so every downstream agent (and
    # the treatment cache key) sees the same value.
    params["tier"] = tier
    # Stamp tier onto the per-request contextvar so JSON logs from
    # downstream agents include it without threading it through every call.
    tier_var.set(tier)

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
    logger.info(f"[Orchestrator]   Tier        : {tier}  chains={describe_chains(tier)}")
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
    if STRICT_IMAGE_GATE:
        # Strict: hard-reject below the unusable floor; treat the
        # unusable..quality band (0.4–0.6) as MARGINAL (proceed but flag so
        # cross_verify penalizes). No circular enh_notes escape — those notes
        # are set FOR marginal images, so bypassing the gate on them defeats it.
        if quality_score < IMAGE_UNUSABLE_THRESHOLD:
            logger.error(f"[Orchestrator] ✗ Quality gate FAILED (strict, score={quality_score:.2f})")
            return _needs_rescan_response(image_quality, weather_risk, params)
        if quality_score < IMAGE_QUALITY_THRESHOLD:
            image_quality["marginal"] = True
            logger.info(f"[Orchestrator]   Quality gate    : MARGINAL ({quality_score:.2f}) — proceeding with penalty")
        else:
            logger.info(f"[Orchestrator]   Quality gate    : PASSED (strict, score={quality_score:.2f})")
    else:
        if not image_usable and quality_score < IMAGE_UNUSABLE_THRESHOLD and not enh_notes:
            logger.error(f"[Orchestrator] ✗ Quality gate FAILED — short-circuiting (score={quality_score:.2f})")
            return _needs_rescan_response(image_quality, weather_risk, params)
        logger.info(f"[Orchestrator]   Quality gate    : PASSED (score={quality_score:.2f})")

    # ── STAGE 3: Disease Diagnosis (vision + all context) ────────────────────
    logger.info(f"[Orchestrator] STAGE 3 — DiseaseDiagnosis (vision)...")
    # Inject raw weather into params so the diagnosis prompt can show exact metrics
    diag_params = dict(params)
    if weather_data:
        diag_params["_raw_weather"] = weather_data
    # Vision is the slowest, most expensive stage — give it the largest soft cap
    # but still leave enough room for treatment + report.
    # Diagnose can take 60–90s on Claude Haiku with our 8K-char system
    # prompt and 8K max output. Sized to leave ~60s for treatment+report
    # within the 240s pipeline cap.
    try:
        diagnosis, tok_diagnosis = await budget.with_budget(
            run_disease_diagnosis_agent(
                images=images,
                image_quality=image_quality,
                weather_risk=weather_risk,
                params=diag_params,
            ),
            max_seconds=180.0,
            stage="diagnose",
            min_required=10.0,
        )
    except (BudgetExhausted, asyncio.TimeoutError) as exc:
        # Catch stage-level timeouts so they don't bubble up and trigger
        # the outer "exceeded 240s" wrapper. A failed diagnose stage =
        # rescan path; we surface that cleanly to the client.
        kind = type(exc).__name__
        logger.error(
            "[Orchestrator] STAGE 3 timed out (%s) — returning rescan response",
            kind,
        )
        from agents.disease_diagnosis_agent import _uncertain_fallback
        from agents.llm_utils import empty_token_info as _empty
        diagnosis = _uncertain_fallback(f"Diagnose stage exceeded soft cap ({kind})")
        tok_diagnosis = _empty("diagnose-timeout")
    pd = diagnosis.get("primary_diagnosis", {})
    confidence = diagnosis.get("confidence_score", 0.0)
    logger.info(f"[Orchestrator]   Disease         : {pd.get('disease')} ({pd.get('scientific_name', '')})")
    logger.info(f"[Orchestrator]   Confidence      : {confidence:.0%}")
    logger.info(f"[Orchestrator]   Severity        : {pd.get('severity')}")
    logger.info(f"[Orchestrator]   Spread risk     : {diagnosis.get('spread_risk')}")
    logger.info(f"[Orchestrator]   Causal factors  : {diagnosis.get('causal_factors', [])}")
    logger.info(f"[Orchestrator]   Needs advisor   : {diagnosis.get('needs_advisor')}")
    logger.info(f"[Orchestrator]   Differentials   : {[d.get('disease') for d in diagnosis.get('differentials', [])]}")

    # Hard stop: if the diagnosis PROVIDER was unavailable (no cross-model
    # fallback by design — silently using a weaker model degrades quality
    # undetectably), tell the user the service is temporarily down instead of
    # running treatment/report on a non-diagnosis.
    if diagnosis.get("service_unavailable"):
        logger.error("[Orchestrator] ✗ Diagnosis provider unavailable — returning service-down response")
        return _service_unavailable_response(weather_risk, params)

    # ── STAGE 3.25: Cascade gate — escalate to ensemble if uncertain ─────────
    # The cheap pass (Gemini Flash / Haiku) handles the easy majority of
    # scans on its own. For the hard ones — low confidence OR a tight
    # primary-vs-differential split — fan out to the frontier ensemble
    # (Gemini Pro + Claude Sonnet, see registry.STAGE_TIER_CHAINS["ensemble"])
    # in parallel and let reconciler.fuse() vote. This is what replaces
    # user-facing "Fast vs Best" tiers with adaptive routing.
    tok_ensemble = empty_token_info("none-not-escalated")
    ambiguous = _is_ambiguous(diagnosis, ENSEMBLE_AMBIGUOUS_DELTA)
    should_escalate = (
        ENABLE_ENSEMBLE
        and (confidence < ENSEMBLE_ESCALATE_BELOW or ambiguous)
        and not diagnosis.get("crop_mismatch")
        and not diagnosis.get("is_out_of_distribution")
    )
    # AISVC-5: budget pre-check. The ensemble fans out 2-4 model calls; if the
    # user is already near their daily cap, skip it and keep the cheap-pass
    # result rather than risk a single-request overrun. The authoritative
    # per-user budget is the Express credit ledger; this is a FastAPI-side guard.
    if should_escalate:
        try:
            from security.spend import remaining_budget
            _uid = (user_id_var.get() or "").strip()
            _headroom = remaining_budget(_uid)
            if _headroom < ENSEMBLE_MIN_BUDGET_USD:
                logger.info(
                    "[Orchestrator] STAGE 3.25 — ensemble SKIPPED: budget headroom $%.4f < $%.4f reserve",
                    _headroom, ENSEMBLE_MIN_BUDGET_USD,
                )
                should_escalate = False
        except Exception:  # noqa: BLE001
            pass  # never block diagnosis on a budget-read error
    if should_escalate:
        models = ensemble_agent.select(params.get("crop_name"))
        logger.info(
            "[Orchestrator] STAGE 3.25 — Cascade gate ESCALATING (conf=%.2f ambig=%s) → ensemble of %d",
            confidence, ambiguous, len(models),
        )
        try:
            ensemble_results, tok_ensemble = await budget.with_budget(
                ensemble_agent.run_parallel(
                    images=images,
                    image_quality=image_quality,
                    weather_risk=weather_risk,
                    params=diag_params,
                    models=models,
                ),
                max_seconds=120.0,
                stage="ensemble",
                min_required=20.0,
            )
        except (BudgetExhausted, asyncio.TimeoutError) as exc:
            logger.warning(
                "[Orchestrator] Ensemble stage degraded (%s) — keeping primary cheap result",
                type(exc).__name__,
            )
            ensemble_results = []
        if ensemble_results:
            fused = reconciler.fuse([diagnosis, *ensemble_results],
                                    crop=params.get("crop_name"),
                                    accuracy_weights=_MODEL_ACCURACY_WEIGHTS)
            diagnosis = fused
            pd = diagnosis.get("primary_diagnosis", {}) or {}
            confidence = diagnosis.get("confidence_score", 0.0)
            logger.info(
                "[Orchestrator]   Reconciled       : %s (agree=%s conf=%.2f)",
                pd.get("disease"), diagnosis.get("ensemble_agreement"), confidence,
            )
    else:
        logger.info(
            "[Orchestrator] STAGE 3.25 — Cascade gate SKIPPED (conf=%.2f, ambig=%s, enabled=%s)",
            confidence, ambiguous, ENABLE_ENSEMBLE,
        )

    # ── Visual claim verification (Pillow HSV histogram, $0) ─────────────────
    # Cross-checks the LLM's color/symptom claims ("yellow halos",
    # "white sporulation") against the actual pixels. Falsified claims
    # produce a small confidence penalty that feeds into cross_verify.
    from safety.visual_verify import verify_visual_claims
    visual_audit = verify_visual_claims(diagnosis, images)
    diagnosis["_visual_audit"] = visual_audit
    if visual_audit.get("falsified"):
        logger.info(
            "[Orchestrator]   Visual audit    : falsified=%s penalty=-%.3f",
            visual_audit["falsified"], visual_audit["score_penalty"],
        )

    # ── Escalation check ──────────────────────────────────────────────────────
    if confidence < DIAGNOSIS_ESCALATE_BELOW:
        diagnosis["needs_advisor"] = True
        logger.info(f"[Orchestrator] ⚠ Escalating to advisor — confidence {confidence:.2f} below threshold {DIAGNOSIS_ESCALATE_BELOW}")

    # ── STAGE 3.5: Cross-Verification (rule-based, $0) ──────────────────────
    logger.info(f"[Orchestrator] STAGE 3.5 — CrossVerification (rule-based, $0)...")
    # KB-membership is the §6.5 fix: don't penalize "weather contradicts"
    # for a disease the rule engine has no opinion on. Compute it once and
    # pass through so cross_verify doesn't have to re-import weather_rules.
    primary_disease_name = (diagnosis.get("primary_diagnosis") or {}).get("disease", "")
    weather_kb_has_disease = disease_is_known(primary_disease_name)
    diagnosis, confidence = cross_verify.apply(
        diagnosis, weather_risk, image_quality,
        weather_kb_has_disease=weather_kb_has_disease,
    )
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
    # Budget-aware: if Stage 3 ate most of the budget, skip the LLM call and
    # return a cultural-only fallback rather than asyncio.cancel-ing in the
    # middle of an Anthropic/Groq request.
    logger.info(f"[Orchestrator] STAGE 4 — TreatmentAgent (router, tier=%s)...", tier)
    try:
        # 90s soft cap — Gemini Flash typically returns the full structured
        # treatment in 5-10s, but Claude Haiku (the fallback) needs 30-60s
        # for the same prompt. Catch BOTH BudgetExhausted (no budget left
        # before call) AND asyncio.TimeoutError (stage call exceeded the
        # 90s cap mid-flight) so the pipeline degrades gracefully instead
        # of bubbling up as an opaque "exceeded 240s" outer-timeout error.
        treatment, tok_treatment = await budget.with_budget(
            run_treatment_agent(
                diagnosis=diagnosis,
                weather_risk=weather_risk,
                params=params,
            ),
            max_seconds=90.0,
            stage="treatment",
            min_required=8.0,
        )
    except (BudgetExhausted, asyncio.TimeoutError) as exc:
        kind = type(exc).__name__
        logger.warning("[Orchestrator] STAGE 4 degraded — %s: %s", kind, exc or "treatment exceeded stage budget")
        from agents.treatment_agent import _fallback_treatment  # local import: degradation path only
        from agents.llm_utils import empty_token_info as _empty
        treatment = _fallback_treatment(diagnosis.get("primary_diagnosis", {}).get("disease", "Unknown"))
        treatment["confidence_adjusted_note"] = (
            "Treatment LLM skipped due to time budget — cultural & biological "
            "measures only. Re-run scan for full chemical recommendation."
        )
        tok_treatment = _empty("budget-skipped")
        diagnosis["needs_advisor"] = True
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
    all_toks = [tok_weather, tok_diagnosis, tok_ensemble, tok_treatment, tok_report]
    total_inp  = sum(t["input_tokens"]  for t in all_toks)
    total_out  = sum(t["output_tokens"] for t in all_toks)
    total_tok  = sum(t["total_tokens"]  for t in all_toks)
    total_cost = round(sum(t["cost_usd"] for t in all_toks), 6)

    pipeline_token_usage = {
        "agents": {
            "weather_analysis":  tok_weather,
            "disease_diagnosis": tok_diagnosis,
            "ensemble":          tok_ensemble,
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
    report["meta"]["tier"] = tier
    report["meta"]["model_diagnose"]  = tok_diagnosis.get("model", "")
    report["meta"]["model_treatment"] = tok_treatment.get("model", "")
    report["meta"]["ensemble_used"]      = bool(diagnosis.get("ensemble_used"))
    report["meta"]["ensemble_agreement"] = diagnosis.get("ensemble_agreement")
    report["meta"]["ensemble_models"]    = diagnosis.get("ensemble_models") or []
    report["meta"]["budget"] = budget.snapshot()
    # Reproducibility + weather-provenance: stamp the coordinate source (so a
    # state-capital fallback is visible, not hidden) and the data/registry
    # versions that shaped this diagnosis/treatment, so any report is replayable.
    report["meta"]["coord_source"] = coord_source
    try:
        from safety.chemicals import REGISTRY_VERSION as _REGV
    except Exception:
        _REGV = "unknown"
    try:
        from data.state_bans import REGISTRY_VERSION as _SBV
    except Exception:
        _SBV = "unknown"
    try:
        from data.crop_disease_whitelist import WHITELIST_VERSION as _WLV
    except Exception:
        _WLV = "unknown"
    report["meta"]["versions"] = {
        "chemical_registry": _REGV,
        "state_bans":        _SBV,
        "whitelist":         _WLV,
        "calibration":       "none",   # set once the calibration map is live (Tier 3)
    }
    # Stamp the request_id from the FastAPI middleware so the report and
    # the persisted row both share a key the mobile app can correlate.
    report["meta"]["request_id"] = request_id_var.get() or None
    # Stamp prompt versions so any historical scan can be replayed against
    # the exact prompt text that ran. Prefer the per-request meta (set by
    # the agent when A/B routing picked a variant) over the module-level
    # baseline constants. The persistence layer reads these hashes to
    # group/eval by prompt version.
    from agents.disease_diagnosis_agent import DIAGNOSE_PROMPT_META
    from agents.treatment_agent import TREATMENT_PROMPT_META
    diagnose_prompt_meta  = diagnosis.get("_prompt_meta")  or DIAGNOSE_PROMPT_META
    treatment_prompt_meta = treatment.get("_prompt_meta") or TREATMENT_PROMPT_META
    report["meta"]["prompts"] = {
        "diagnose":  diagnose_prompt_meta,
        "treatment": treatment_prompt_meta,
    }
    # If a local ONNX classifier ran, surface its top-k into meta for audit.
    if diagnosis.get("_local_prior"):
        report["meta"]["local_classifier_prior"] = diagnosis["_local_prior"]
    # Visual audit summary (HSV pixel check vs LLM color claims).
    va = diagnosis.get("_visual_audit") or {}
    if va.get("available"):
        report["meta"]["visual_audit"] = {
            "claimed":       va.get("claimed", []),
            "verified":      va.get("verified", []),
            "unverified":    va.get("unverified", []),
            "falsified":     va.get("falsified", []),
            "score_penalty": va.get("score_penalty", 0.0),
        }

    # Attach raw weather for detailed PDF report
    if weather_data:
        report.setdefault("weather_outlook", {})
        report["weather_outlook"]["raw_current"]  = weather_data.get("current", {})
        report["weather_outlook"]["raw_soil"]     = weather_data.get("soil", {})
        report["weather_outlook"]["raw_forecast"] = weather_data.get("daily_forecast", [])[:7]
        report["weather_outlook"]["location"]     = weather_data.get("location", {})

    logger.info(f"[Orchestrator] ✓ Pipeline DONE in {elapsed}s")
    logger.info(f"{'='*60}\n")

    # Persistence is AWAITED, not fire-and-forget: this pipeline runs inside a
    # Celery task via asyncio.run(), which tears down the event loop the moment
    # the coroutine returns — a create_task() here would be cancelled before it
    # ran, so audit rows were never written. record_diagnosis() never raises (a
    # DB outage logs a warning and is dropped), so awaiting it is safe and the
    # insert latency is negligible next to the multi-second pipeline.
    await record_diagnosis(params=params, images=images, report=report)

    return report


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_ambiguous(diagnosis: dict, delta: float) -> bool:
    """True if the primary call is "uncertain because of a close differential" —
    not the same as "low confidence". A model that says 0.62 vs a top
    differential of 0.55 is admitting it can't tell two diseases apart;
    pre-emptively escalating beats letting cross_verify catch it later."""
    diffs = diagnosis.get("differentials") or []
    if not diffs:
        return False
    primary_conf = float(diagnosis.get("confidence_score") or 0)
    top = diffs[0]
    p = top.get("probability") if isinstance(top, dict) else None
    if not isinstance(p, (int, float)):
        return False
    return abs(primary_conf - float(p)) < delta and float(p) > 0.25


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


def _service_unavailable_response(weather_risk: dict, params: dict) -> dict:
    """Returned when the diagnosis model PROVIDER is down (e.g. Gemini 503).

    We deliberately do NOT fall back to a weaker model — that silently degrades
    accuracy and is hard to maintain. Instead we tell the farmer the service is
    temporarily unavailable so they can retry and get a full-quality diagnosis.
    """
    return {
        "report_id": "service_unavailable",
        "generated_at": "",
        "language": params.get("language", "en"),
        "farm": {"crop": params.get("crop_name", "Unknown")},
        "disease": {"name_common": "SERVICE UNAVAILABLE", "confidence_pct": 0, "severity": "Unknown"},
        "causes": [],
        "treatment": {"immediate": ["Please run the scan again in a few minutes."]},
        "next_steps": ["The AI diagnosis service is temporarily busy — please retry shortly."],
        "advisor_needed": True,
        "service_unavailable": True,
        "weather_outlook": {
            "risk": weather_risk.get("overall_disease_risk", "UNKNOWN"),
            "advisory": weather_risk.get("advisory", ""),
        },
        "farmer_summary": (
            "The AI diagnosis service is temporarily unavailable due to high demand. "
            "Your photos were NOT analysed — please try again in a few minutes."
        ),
        "confidence_score": 0.0,
        "risk_level": weather_risk.get("overall_disease_risk", "UNKNOWN"),
        "meta": {"pipeline_seconds": 0, "escalated": True,
                 "reason": "service_unavailable", "service_unavailable": True},
    }
