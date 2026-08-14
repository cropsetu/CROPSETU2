"""
Treatment & Fertilizer Agent — CropGuard Agentic AI
Model : Groq llama-3.3-70b (primary) / Gemini 2.5 Flash (fallback)
Role  : Recommend treatment + pesticides + fertilizers with Indian brand names.
Cache : Redis (7-day TTL) keyed on disease+crop+state+acreage+soil+irrigation+
        severity+stage+tier+model+grounding. Every hit is re-validated through
        safety.validator before it is returned, so a stale or mis-keyed entry
        still cannot emit a jurisdictionally illegal plan.
        Falls back to in-memory LRU cache if Redis unavailable.
"""
from __future__ import annotations
import copy
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

# Health is NOT latched at import. The previous version ping()'d once and
# pinned _REDIS_OK for the process lifetime, so a Redis blip during a worker
# fork dropped that process onto the 500-entry in-process LRU forever — it
# never rejoined the shared cache, so every replica re-paid for a treatment
# plan the cluster had already generated. Same bounded re-probe shape as
# jobs/queue.py and services/idempotency.py (deliberately duplicated rather
# than shared: these modules must not import each other).
_REDIS_RETRY_SEC = 30
_redis_ok = False
_redis_ever_ok = False
_redis_next_probe = 0.0

try:
    if not _TREATMENT_REDIS_URL:
        raise RuntimeError("no Redis URL configured")
    import redis as _redis_lib
    _redis = _redis_lib.Redis.from_url(_TREATMENT_REDIS_URL, socket_connect_timeout=2)
except Exception as _exc:  # noqa: BLE001
    _redis = None
    logger.warning("Redis client unavailable (%s) — using in-memory LRU cache (500 entries)", _exc)


def _redis_available() -> bool:
    """Re-probe at most every 30s. Healthy is a straight return — no extra
    round trip on the request path; the down edge is detected by the cache
    operations themselves via _mark_redis_down()."""
    global _redis_ok, _redis_ever_ok, _redis_next_probe
    if _redis is None:
        return False
    if _redis_ok:
        return True
    now = time.monotonic()
    if now < _redis_next_probe:
        return False
    _redis_next_probe = now + _REDIS_RETRY_SEC
    try:
        _redis.ping()
    except Exception:  # noqa: BLE001
        return False
    _redis_ok = True
    if _redis_ever_ok:
        logger.error(
            "[ALERT][Redis] Treatment cache RECOVERED — plans are shared across replicas again"
        )
    else:
        _redis_ever_ok = True
        logger.info("Redis connected — treatment results cached for 7 days")
    return True


def _mark_redis_down(op: str, exc: Exception) -> None:
    """One loud line on the healthy→down edge, then silence until it recovers."""
    global _redis_ok, _redis_next_probe
    _redis_next_probe = time.monotonic() + _REDIS_RETRY_SEC
    if _redis_ok:
        _redis_ok = False
        logger.error(
            "[ALERT][Redis] Treatment cache UNAVAILABLE (%s: %s) — falling back to the "
            "500-entry in-process LRU; re-probing every %ds",
            op, exc, _REDIS_RETRY_SEC,
        )


# Probe once at import so a healthy boot logs exactly where it always did.
if not _redis_available():
    logger.warning("Redis unavailable — using in-memory LRU cache (500 entries)")

TREATMENT_CACHE_TTL = 86_400 * 7   # 7 days

# In-memory fallback LRU (max 500 entries, 24-hour TTL)
_mem_cache: dict[str, tuple[dict, float]] = {}
_MEM_MAX   = 500
_MEM_TTL   = 86_400


_SEVERITY_BUCKETS = {
    # "none" belongs in the mild bucket, not the "moderate" default: the ETL
    # monitor gate below treats none/mild/low/slight/minor/early alike, so
    # letting "none" fall through to "moderate" put a monitor-only scan and a
    # spray-now scan in the SAME cache slot.
    "mild":   {"none", "mild", "low", "slight", "early", "minor"},
    "moderate": {"moderate", "medium", "mid"},
    "severe": {"severe", "high", "critical", "advanced", "extensive"},
}

# <1 / 1-2 / 2-5 / 5-10 / 10+ — coarse enough that the cache still hits.
_ACRE_BUCKETS = ((1.0, "<1"), (2.0, "1-2"), (5.0, "2-5"), (10.0, "5-10"))


def _bucket_severity(raw: str) -> str:
    """Map LLM-emitted severity strings to a stable 3-bucket value so the
    cache doesn't miss on cosmetic differences ("Moderate" vs "medium")."""
    v = (raw or "").lower().strip()
    for bucket, aliases in _SEVERITY_BUCKETS.items():
        if v in aliases:
            return bucket
    return "moderate"  # safe default


def _bucket_acres(raw) -> str:
    """Bucket farm size for the cache key. MANDATORY REQUIREMENT 11 tells the
    LLM to scale every dosage to the acreage, so acreage genuinely changes the
    answer — but keying on the raw float would hand every farmer a private
    cache slot and drive the hit rate to zero."""
    try:
        acres = float(raw)
    except (TypeError, ValueError):
        return "unknown"
    if acres <= 0:
        return "unknown"
    for ceiling, label in _ACRE_BUCKETS:
        if acres < ceiling:
            return label
    return "10+"


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

    State is in the key because bans are JURISDICTIONAL. The grounding zone
    below is agronomy, not law: agro_zones puts Kerala with Goa and Sikkim
    with Nagaland, so a zone-keyed cache happily serves a Kerala farmer a plan
    naming a chemical Kerala bans. This is belt to the suspenders of
    re-running validate_treatment on every hit (see run_treatment_agent) —
    the validator is what makes the cache structurally incapable of emitting
    an illegal plan; the key is what stops it being served in the first place.
    """
    pd = diagnosis.get("primary_diagnosis", {})
    payload = {
        "disease":       (pd.get("disease") or "").lower().strip(),
        "crop":          (params.get("crop_name") or "").lower().strip(),
        "soil":          (params.get("soil_type") or "").lower().strip(),
        "irrigation":    (params.get("irrigation_system") or "").lower().strip(),
        "severity":      _bucket_severity(pd.get("severity")),
        "growth_stage":  (params.get("crop_growth_stage") or "").lower().strip(),
        "state":         (params.get("state") or "").lower().strip(),
        "acres":         _bucket_acres(params.get("farm_size_acres")),
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
    if _redis_available():
        raw = None
        try:
            raw = _redis.get(key)
        except Exception as exc:  # noqa: BLE001
            _mark_redis_down("get", exc)
        if raw:
            try:
                return json.loads(raw)
            except Exception:  # noqa: BLE001
                # A corrupt entry is not a Redis outage — drop it and miss.
                logger.warning("[Treatment] unreadable cache entry ...%s — treating as a miss", key[-8:])
    # In-memory fallback
    entry = _mem_cache.get(key)
    if entry:
        result, ts = entry
        if time.time() - ts < _MEM_TTL:
            return result
        del _mem_cache[key]
    return None


def _cache_set(key: str, value: dict) -> None:
    if _redis_available():
        try:
            _redis.setex(key, TREATMENT_CACHE_TTL, json.dumps(value))
            return
        except Exception as exc:  # noqa: BLE001
            _mark_redis_down("setex", exc)
    # In-memory fallback — evict oldest if full
    if len(_mem_cache) >= _MEM_MAX:
        oldest_key = min(_mem_cache, key=lambda k: _mem_cache[k][1])
        del _mem_cache[oldest_key]
    _mem_cache[key] = (value, time.time())


def purge_treatment_cache(cache_key: str) -> bool:
    """Drop ONE cached plan. Returns True if anything was actually removed.

    Until this existed the only retraction levers were bumping
    REGISTRY_VERSION / STATE_BANS_VERSION (a namespace nuke) or waiting out the
    7-day TTL. For a product that recommends pesticides, "we cannot retract one
    wrong answer" is a compliance problem, not an ergonomics one.

    Accepts either the full key or the bare md5 that `_get_cache_key` returns
    after the prefix, so an operator can paste whichever half the report
    carries (`treatment["_cache_key"]`, stamped on every returned plan).
    """
    key = (cache_key or "").strip()
    if not key:
        return False
    if not key.startswith("treatment:"):
        key = f"treatment:{key}"
    removed = False
    if _redis_available():
        try:
            removed = bool(_redis.delete(key))
        except Exception as exc:  # noqa: BLE001
            _mark_redis_down("delete", exc)
    # Always clear the in-process copy too: this replica may have served the
    # entry from the LRU while Redis was down, and a purge that leaves that
    # copy behind is not a purge.
    if _mem_cache.pop(key, None) is not None:
        removed = True
    logger.warning("[Treatment] cache purge key=...%s removed=%s", key[-8:], removed)
    return removed


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


def _grounded_cultural_only(disease_name: str, crop_name: str, grounding: dict) -> dict:
    """Plan for a (crop, disease) pair the label-claim matrix registers NO
    chemical for — built from the grounding instead of from the LLM.

    _fallback_treatment is the shape, but two of its strings are written for
    the low-confidence gate and are simply false here: the diagnosis may be
    95% confident, and it offers spray timing for a spray nobody recommended.
    Both are replaced with the real reason, which the farmer otherwise never
    gets — today an empty chemical section arrives with no explanation at all.

    The reason is NOT the same sentence for every crop. "No pesticide is
    registered" is a claim about the CIB&RC matrix, and it is only true for a
    crop we actually carry label-claim data for. For an open-vocabulary crop
    (anything outside data.crop_disease_whitelist — dragonfruit, a regional
    minor crop) the honest statement is that we cannot verify the registry, not
    that the registry is empty. Telling a farmer no chemical exists when the
    truth is we do not know is a different, worse error: he stops looking.
    """
    plan = _fallback_treatment(disease_name)
    cultural = list(grounding.get("cultural_practices") or [])
    if cultural:
        plan["cultural_practices"] = cultural
    plan["spray_timing_advisory"] = ""
    covered = False
    try:
        from data.crop_disease_whitelist import is_covered
        covered = is_covered((crop_name or "").lower())
    except Exception:  # pragma: no cover - defensive
        pass
    if covered:
        plan["confidence_adjusted_note"] = (
            f"No pesticide is registered for {disease_name} on {crop_name or 'this crop'} "
            "in the CIB&RC label-claim matrix, so only cultural and biological measures "
            "are recommended. Ask your KVK or a licensed dealer before buying any "
            "chemical for this problem."
        )
    else:
        plan["confidence_adjusted_note"] = (
            f"We could not verify which pesticide is registered for {disease_name} on "
            f"{crop_name or 'this crop'} — this crop is outside our CIB&RC label-claim "
            "data, so no chemical is named here rather than guessed. Cultural and "
            "biological measures are given below. Ask your KVK or a licensed dealer "
            "for the registered chemical before buying anything."
        )
    plan["relevance_score"] = 0.6
    plan["_no_registered_actives"] = True
    plan["_label_data_available"] = covered
    return plan


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
    g_actives = grounding.get("actives") or []

    # ── No registered active → no LLM call ───────────────────────────────────
    # RAG resolves actives for only 13 of the 441 ballot pairs, so on most scans
    # the grounding block below says "recommend ONLY cultural measures, name no
    # chemicals" while the MANDATORY REQUIREMENTS list thirty lines later
    # demands FRAC groups, a rotation plan, brand names and MRPs. The model
    # resolves that contradiction toward the concrete numbered list: it invents
    # brands, and the validator then blocks every one as off_label. So for the
    # 428 whitelisted pairs ~2K output tokens buy a chemical section the
    # validator empties anyway; the plan is composed from the grounding's own
    # cultural practices instead.
    #
    # The short-circuit is deliberately NOT gated on is_covered(crop). For a crop
    # OUTSIDE the whitelist the validator's off-label check is silent
    # (allowed_for_label stays None, validator.py), so before this branch existed
    # the LLM's invented chemicals reached the farmer carrying nothing but an
    # `unverified_active` warning he never sees — an ungrounded brand, dose and
    # PHI for a crop we hold no label-claim data on. Withdrawing that is a
    # deliberate product decision, not a side effect of a cost fix, and it is why
    # _grounded_cultural_only words the note differently for those crops: "we
    # could not verify", not "nothing is registered".
    if not g_actives:
        plan = _grounded_cultural_only(disease_name, params.get("crop_name") or "", grounding)
        # Still run the validator: it is what stamps `_safety`, which
        # report_generator_agent's compliance audit reads.
        plan = validate_treatment(plan, diagnosis=diagnosis, params=params).sanitized_treatment
        logger.info(
            "Treatment: no registered active for (%s, %s) — cultural-only plan, LLM skipped",
            params.get("crop_name"), disease_name,
        )
        return plan, empty_token_info("no-registered-actives")

    # ── Cache lookup ──────────────────────────────────────────────────────────
    # The grounding hash is part of the key — two scans of the same disease
    # in different agro-zones get different RAG payloads and must not share
    # a cache slot.
    cache_key = _get_cache_key(diagnosis, params, tier, grounding, model=cfg.model)
    cached = _cache_get(cache_key)
    if cached:
        # Re-run the deterministic validator on EVERY hit, before the plan is
        # returned. The key can only encode what we remembered to put in it;
        # validate_treatment is rule-based, costs nothing, and reads the
        # CURRENT registry — so re-running it is what makes the cache
        # structurally incapable of emitting a plan that is banned in this
        # farmer's state, off-label for this pair, or bee-toxic during this
        # crop's bloom. It also re-stamps `_safety`, which the compliance
        # audit publishes: a hit used to ship the FIRST farmer's blocker list
        # as this farmer's audit trail.
        #
        # deepcopy first — validate_treatment mutates in place, and on the
        # in-process LRU path `cached` IS the stored object.
        plan = copy.deepcopy(cached)
        validation = validate_treatment(plan, diagnosis=diagnosis, params=params)
        plan = validation.sanitized_treatment
        plan["_cached"] = True
        plan["_cache_key"] = cache_key
        logger.info(
            "Cache HIT — key=...%s disease=%s tier=%s state=%s kept=%d blockers=%d cost=$0.0000",
            cache_key[-8:], disease_name, tier, params.get("state") or "?",
            len(plan.get("chemical_controls") or []), len(validation.blockers),
        )
        # Billing is deliberately unchanged: empty_token_info keeps tokens at
        # 0 and Express's creditsForUsage bills the 3-credit scan floor for a
        # 0-token stage. A hit is the highest-margin outcome in the product,
        # and free hits would remove the only hard per-user spend cap.
        return plan, empty_token_info("cache-hit")

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
    # g_actives is non-empty here: the empty case returned above without an
    # LLM call. The else branch stays as a guard for any future caller that
    # reaches this prompt with a different grounding source.
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

    # MANDATORY REQUIREMENTS are assembled rather than hardcoded, because
    # several of them are only satisfiable when the grounding supplies enough
    # chemistry. With ONE registered active — rice blast and cotton bacterial
    # blight among them — "MoA group alternation" and "2 medicine
    # combinations" can only be met by naming a SECOND, unregistered active,
    # which validate_treatment then blocks as off_label: the farmer gets an
    # empty chemical section and we paid for the tokens that built it.
    acres = params.get("farm_size_acres") or 1
    reqs = [
        'Include FRAC/IRAC group for EVERY chemical (e.g., "FRAC 3 (DMI)", "FRAC M03 (multi-site)")',
    ]
    if len(g_actives) >= 2:
        reqs += [
            "Include a rotation_plan showing MoA group alternation across sprays, "
            "using ONLY the registered actives listed above",
            "Include 2 medicine_combinations (curative+preventive and organic+biological)",
        ]
    else:
        reqs += [
            "Only ONE active is registered for this pair: set rotation_plan to a one-line "
            "note that MoA alternation is not possible with a single registered active, and "
            "do NOT introduce a second chemical to create one",
            "Include exactly 1 medicine_combination, pairing the registered active with a "
            "biological / organic option",
        ]
    reqs += [
        "Include biological_options (Trichoderma, Pseudomonas, Bacillus, etc.)",
        "Include cultural_practices (spacing, pruning, irrigation, rotation)",
        "Include applicator_safety (PPE, mixing, disposal)",
        "Include monitoring_plan (follow_up_in_days, what_to_watch_for)",
        "Include do_not_use list (banned/inappropriate chemicals with reason)",
        'If pathogen_type is "viral": do NOT recommend curative chemicals — focus on vector control + rogueing',
        'If pathogen_type is "abiotic" or "nutrient": do NOT recommend pesticides — address root cause',
        f"Scale all dosages for {acres} acres",
        # Nothing downstream validates a brand or an MRP — the registry only
        # knows actives — so the prompt has to say "omit rather than guess".
        "Include real Indian brand names with approximate MRP in INR. The brand MUST be a "
        "formulation of one of the registered actives above; if you do not know a real brand "
        "for it, give the active and formulation only and omit the brand rather than inventing one",
        'Mark pollinator_safety for each chemical: "safe" | "caution" | "avoid_during_bloom"',
    ]
    requirements_block = "\n".join(f"{i}. {r}" for i, r in enumerate(reqs, 1))

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
  Farm Size       : {acres} acres
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
{requirements_block}

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
        # temperature is passed explicitly, not left to llm_dispatch's 0.3
        # default: this is template filling from a closed list of registered
        # actives that validate_treatment re-checks afterwards, and the sample
        # is cached for 7 days, so a low, DECLARED temperature is the point.
        raw, tok = await call_llm_text(
            cfg,
            system_prompt=treatment_prompt_text,
            user_prompt=user_prompt,
            max_tokens=8192,
            temperature=0.3,
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
        # Stamp the key onto the plan so it reaches the report: retracting one
        # wrong recommendation means calling purge_treatment_cache(key), and
        # an operator can only do that if the key travelled with the answer.
        sanitized["_cache_key"] = cache_key
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
