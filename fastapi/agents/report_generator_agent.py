"""
Report Generator Agent — CropGuard Agentic AI
Strategy: Template-based (no LLM) — deterministic, instant, $0 cost.

Report Structure (mirrors KrishiRakshak PDF layout):
  Section 1 — Farmer Summary   : disease detection, confidence badges, weekly action checklist
  Section 2 — Detailed Guidance : what/why, weather cards, spray schedule, safety checklist, contacts
  Section 3 — Dispensing Sheet  : dealer product table, FRAC groups, substitutes, incompatibilities
  Section 4 — Annex            : input params, evidence matrix, compliance audit, system metadata
"""
from __future__ import annotations
import logging
import math
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

from agents.llm_utils import empty_token_info
from safety.compliance import build_compliance_audit
from services.sarvam_translator import translate_blocks, supported as sarvam_supports
from services.state_language import lang_for_state, lang_display_name


# ── Utilities ────────────────────────────────────────────────────────────────

def _report_id() -> str:
    return str(uuid.uuid4())


def _generated_at() -> str:
    return datetime.now(timezone.utc).isoformat()


def _urgency_label(severity: str, spread_risk: str, confidence: float) -> dict:
    """Determine urgency badge based on severity + spread risk."""
    sev = (severity or "").lower()
    spread = (spread_risk or "").upper()

    if sev == "severe" or spread == "CRITICAL":
        return {"label": "ACT IMMEDIATELY", "hours": 24, "level": "critical"}
    elif sev == "moderate" or spread == "HIGH":
        return {"label": "ACT WITHIN 48 HOURS", "hours": 48, "level": "high"}
    elif sev == "mild" or spread == "MODERATE":
        return {"label": "ACT WITHIN 5 DAYS", "hours": 120, "level": "moderate"}
    else:
        return {"label": "MONITOR CLOSELY", "hours": 168, "level": "low"}


def _affected_area_text(pct: float) -> str:
    if pct and pct > 0:
        return f"~{pct:.0f}% foliage"
    return "Not measured"


def _estimate_quantity(dose_str: str, farm_acres: float) -> str:
    """Rough quantity estimate from dose string + farm size."""
    if not dose_str or not farm_acres:
        return ""
    # Try to extract numeric dose (g/L or ml/L) and scale for ~200L water/acre
    try:
        import re
        nums = re.findall(r'[\d.]+', dose_str)
        if nums:
            dose_per_liter = float(nums[0])
            water_per_acre = 200  # liters
            total = dose_per_liter * water_per_acre * farm_acres
            unit = "ml" if "ml" in dose_str.lower() else "g"
            if total >= 1000:
                return f"{total/1000:.1f} kg total" if unit == "g" else f"{total/1000:.1f} L total"
            return f"{total:.0f} {unit} total"
    except Exception:
        pass
    return ""


# ── Local-language section blocks ────────────────────────────────────────────

def _build_english_local_blocks(report: dict, params: dict) -> dict[str, str]:
    """
    Compose the five short English summaries that will be translated into
    the farmer's native language and rendered as per-section strips.

    Each block is a single sentence or short paragraph composed from
    already-generated structured fields — no LLM call. Pesticide trade
    names, FRAC codes, and chemical actives are intentionally left in
    English (regulatory + safety: a translated brand name is dangerous).
    """
    disease = report.get("disease", {}) or {}
    treatment = report.get("treatment", {}) or {}
    action_card = report.get("action_card", {}) or {}
    meta = report.get("meta", {}) or {}
    weather = report.get("weather_outlook", {}) or {}

    disease_name = disease.get("name_common") or "an unidentified condition"
    severity = (disease.get("severity") or "moderate").lower()
    confidence_pct = int(round((report.get("confidence_score") or 0.0) * 100))
    crop = params.get("crop_name") or "your crop"

    top_actions = action_card.get("top_3_actions") or report.get("next_steps", [])[:3]
    immediate = top_actions[0] if top_actions else "follow the prescribed treatment"

    chemicals = treatment.get("chemical") or []
    primary_chemical = ""
    primary_dose = ""
    primary_timing = treatment.get("spray_timing") or ""
    if chemicals:
        first = chemicals[0] if isinstance(chemicals[0], dict) else {}
        primary_chemical = first.get("active_ingredient") or first.get("name") or ""
        primary_dose = first.get("dose") or first.get("dosage") or ""

    follow_up_days = action_card.get("follow_up_days") or 7
    advisor_needed = meta.get("needs_advisor") or report.get("advisor_needed")

    summary = (
        f"{crop} appears to have {disease_name} ({severity} severity) with "
        f"{confidence_pct}% confidence. Most urgent step: {immediate}."
    )

    diagnosis = (
        f"Detected disease: {disease_name}. "
        f"Confidence {confidence_pct}%. "
        + ("Consult a KVK or local agronomist to confirm." if advisor_needed else
           "Begin the recommended treatment without delay.")
    )

    if primary_chemical:
        treatment_block = (
            f"Spray {primary_chemical}"
            + (f" at {primary_dose}" if primary_dose else "")
            + (f". {primary_timing}" if primary_timing else "")
            + ". Use full PPE and follow label instructions."
        )
    else:
        treatment_block = (
            "Follow the prescribed treatment plan; use full PPE and observe the "
            "pre-harvest interval on every product label."
        )

    risk = (weather.get("risk") or "").lower()
    prognosis = (
        f"With prompt treatment, recovery is expected within {follow_up_days * 2} days. "
        + ("Weather conditions remain disease-favourable — watch for spread."
           if risk in ("high", "critical") else
           "Weather is currently neutral; standard monitoring is sufficient.")
    )

    follow_up = (
        f"Re-inspect the field in {follow_up_days} days. Check new lesion count, "
        "underside of leaves, and weather forecast. Escalate to KVK if symptoms worsen."
    )

    return {
        "summary":   summary,
        "diagnosis": diagnosis,
        "treatment": treatment_block,
        "prognosis": prognosis,
        "follow_up": follow_up,
    }


async def _attach_local_blocks(report: dict, params: dict) -> None:
    """
    Compute and attach `report['local_blocks']` in-place.

    Resolution priority for target language:
      1. params['language'] — set explicitly by the client
      2. lang_for_state(params['state']) — derived from the farmer's state
      3. 'en' fallback

    When the target is English or Sarvam can't translate to it, the block
    is still attached (helpful for the frontend's rendering switch) but
    with `blocks={}` so the UI skips the native strip.
    """
    explicit = (params.get("language") or "").strip().lower() or None
    target = explicit or lang_for_state(params.get("state"))

    if target == "en" or not sarvam_supports(target):
        report["local_blocks"] = {
            "language": target,
            "language_name": lang_display_name(target),
            "blocks": {},
        }
        return

    source_blocks = _build_english_local_blocks(report, params)
    translated = await translate_blocks(source_blocks, target)

    # If the translator returned originals for everything (Sarvam down,
    # key missing, etc.), we still want the frontend to know what language
    # was *targeted* so it can render an English-only fallback strip.
    untranslated = all(translated[k] == source_blocks[k] for k in source_blocks)
    report["local_blocks"] = {
        "language": target,
        "language_name": lang_display_name(target),
        "blocks": {} if untranslated else translated,
    }


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — FARMER SUMMARY
# ══════════════════════════════════════════════════════════════════════════════

def _build_section1_farmer_summary(
    diagnosis: dict, treatment: dict, params: dict,
    image_quality: dict, report_id: str, generated_at: str,
) -> dict:
    """
    Page 1: Farmer-facing summary — disease detection + what to do this week.
    This is what the farmer sees first.
    """
    disease_info = diagnosis.get("primary_diagnosis", {})
    disease_name = disease_info.get("disease", "Unknown")
    scientific   = disease_info.get("scientific_name", "")
    pathogen     = disease_info.get("pathogen_type", diagnosis.get("pathogen_type", "unknown"))
    confidence   = diagnosis.get("confidence_score", 0.0)
    conf_pct     = round(confidence * 100)
    severity     = disease_info.get("severity", "Unknown")
    spread_risk  = diagnosis.get("spread_risk", "UNKNOWN")
    crop         = params.get("crop_name", "Unknown")
    variety      = params.get("crop_variety", "")
    # `params.get(key, default)` returns None when the key EXISTS with value
    # None (mobile sends None for unfilled numeric fields), so we need
    # `or` to coerce a falsy value to the default.
    farm_acres   = params.get("farm_size_acres") or 0
    affected_pct = params.get("affected_area_percent", 0)

    # Confidence tier
    if conf_pct >= 85:
        conf_tier = "HIGH"
    elif conf_pct >= 70:
        conf_tier = "MEDIUM"
    elif conf_pct >= 50:
        conf_tier = "LOW"
    else:
        conf_tier = "VERY_LOW"

    # Urgency
    urgency = _urgency_label(severity, spread_risk, confidence)

    # Farmer-friendly summary text (confidence-appropriate)
    if conf_pct >= 85:
        summary_text = (
            f"Your {crop.lower()} crop has been diagnosed with {disease_name} "
            f"at {conf_pct}% confidence (severity: {severity}). "
        )
    elif conf_pct >= 70:
        summary_text = (
            f"Your {crop.lower()} crop most likely has {disease_name} "
            f"({conf_pct}% confidence). Start with protective spray and observe for 3 days. "
        )
    elif conf_pct >= 50:
        summary_text = (
            f"Your {crop.lower()} crop shows signs that may indicate {disease_name} "
            f"({conf_pct}% confidence). Please send another close-up photo for better accuracy. "
        )
    else:
        summary_text = (
            f"We could not clearly identify the problem on your {crop.lower()} crop "
            f"(confidence only {conf_pct}%). Contact your nearest KVK for in-person check. "
        )

    # Pathogen-specific addendum
    if pathogen == "viral":
        summary_text += "This is a viral disease — there is NO curative spray. Remove infected plants immediately."
    elif pathogen in ("abiotic", "nutrient"):
        summary_text += "This is not a disease — it is a nutrient/environmental issue. No pesticide needed."
    else:
        first_chem = ""
        if treatment.get("chemical_controls"):
            c = treatment["chemical_controls"][0]
            first_chem = c.get("product", "")
        if first_chem and conf_pct >= 70:
            summary_text += f" Spray {first_chem} as soon as possible to control the spread."

    # Weekly action checklist (5 items max, bilingual-ready)
    weekly_actions = []
    immediate = treatment.get("immediate_actions", [])
    chemicals = treatment.get("chemical_controls", [])
    irrigation = (params.get("irrigation_system") or "").lower()

    # Action 1: Remove infected material
    if immediate:
        weekly_actions.append({
            "day": "TODAY",
            "action": immediate[0],
            "priority": "critical",
        })

    # Action 2: First spray
    if chemicals:
        c = chemicals[0]
        dose = c.get("dosage", "as per label")
        prod = c.get("product", "recommended pesticide")
        weekly_actions.append({
            "day": "TODAY",
            "action": f"Spray {prod} ({dose}) in evening after 5 PM",
            "priority": "critical",
        })

    # Action 3: Irrigation switch
    if any(kw in irrigation for kw in ("overhead", "sprinkler", "flood")):
        weekly_actions.append({
            "day": "TODAY",
            "action": "Stop overhead irrigation. Switch to drip or furrow for 10 days",
            "priority": "high",
        })

    # Action 4: Follow-up spray
    monitoring = treatment.get("monitoring_plan", {})
    follow_days = monitoring.get("follow_up_in_days", 7)
    if len(chemicals) > 1:
        c2 = chemicals[1]
        weekly_actions.append({
            "day": f"DAY {follow_days}",
            "action": f"Follow-up spray: {c2.get('product', 'second chemical')}",
            "priority": "high",
        })

    # Action 5: Send follow-up photo
    try:
        follow_date = (datetime.now(timezone.utc) + timedelta(days=follow_days)).strftime("%d %B")
    except Exception:
        follow_date = f"{follow_days} days from now"
    weekly_actions.append({
        "day": f"DAY {follow_days}",
        "action": f"Send new leaf photo on {follow_date} for progress check",
        "priority": "medium",
    })

    return {
        "farmer_details": {
            "crop": crop,
            "variety": variety,
            "farm_size_acres": farm_acres,
            "affected_area": _affected_area_text(affected_pct),
            "growth_stage": params.get("crop_growth_stage", "Unknown"),
            "gps": f"{params.get('field_latitude', '?')}°N, {params.get('field_longitude', '?')}°E",
            "district": params.get("district", ""),
            "state": params.get("state", ""),
        },
        "disease_detected": {
            "name_common": disease_name,
            "name_scientific": scientific,
            "pathogen_type": pathogen,
            "pathogen_label": {
                "fungal": "Fungus", "bacterial": "Bacterium", "viral": "Virus",
                "oomycete": "Oomycete (water mold)", "nematode": "Nematode",
                "pest": "Pest/Insect", "abiotic": "Abiotic stress",
                "nutrient": "Nutrient deficiency",
            }.get(pathogen, pathogen.title()),
            "confidence_pct": conf_pct,
            "confidence_tier": conf_tier,
            "severity": severity,
            "severity_pct": affected_pct or 0,
            "spread_risk": spread_risk,
            "description": disease_info.get("description", ""),
            "visual_evidence": diagnosis.get("visual_evidence", {}),
        },
        "urgency": urgency,
        "farmer_summary": summary_text,
        "weekly_actions": weekly_actions[:5],
        "image_quality": {
            "score": image_quality.get("quality_score", 0),
            "usable": image_quality.get("usable", False),
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — DETAILED GUIDANCE
# ══════════════════════════════════════════════════════════════════════════════

def _build_section2_detailed_guidance(
    diagnosis: dict, treatment: dict, weather_risk: dict, params: dict,
) -> dict:
    """
    Page 2: What is happening, why (weather), spray schedule, safety, contacts.
    """
    disease_info = diagnosis.get("primary_diagnosis", {})
    disease_name = disease_info.get("disease", "Unknown")
    pathogen     = disease_info.get("pathogen_type", diagnosis.get("pathogen_type", "unknown"))
    severity     = disease_info.get("severity", "Unknown")
    crop         = params.get("crop_name", "Unknown")
    # Coerce to a number — farm_size_acres can arrive as a string ("2") from the
    # farm profile, and it is multiplied below (dosage/pricing), so a str would
    # corrupt output (int * str → repetition) or crash arithmetic downstream.
    farm_acres   = _to_inr(params.get("farm_size_acres")) or 1

    # ── What is happening (plain explanation) ──
    description = disease_info.get("description", "")
    if not description:
        description = f"Your {crop.lower()} crop is showing symptoms consistent with {disease_name}."
    causes = diagnosis.get("causal_factors", [])

    # ── Why now — weather metric cards ──
    raw_weather = params.get("_raw_weather", {})
    current = raw_weather.get("current", {}) if raw_weather else {}

    weather_cards = []
    if current:
        temp = current.get("temperature")
        humidity = current.get("humidity")
        # Estimate leaf wetness from VPD
        vpd = current.get("vpd", 1.0)
        leaf_wet = 0
        if vpd and float(vpd) < 0.4:
            leaf_wet = 8
        elif vpd and float(vpd) < 0.8:
            leaf_wet = 4

        if temp is not None:
            weather_cards.append({
                "metric": "AVG TEMP",
                "value": f"{temp}°C",
                "favorable": 15 <= float(temp) <= 28,
                "note": "Ideal for disease" if 15 <= float(temp) <= 28 else "Outside ideal range",
            })
        if humidity is not None:
            weather_cards.append({
                "metric": "HUMIDITY",
                "value": f"{humidity}%",
                "favorable": float(humidity) > 75,
                "note": "Very favorable" if float(humidity) > 80 else "Moderate" if float(humidity) > 60 else "Low risk",
            })
        if leaf_wet > 0:
            weather_cards.append({
                "metric": "LEAF WETNESS/DAY",
                "value": f"~{leaf_wet} hrs",
                "favorable": leaf_wet >= 6,
                "note": "Above threshold" if leaf_wet >= 6 else "Moderate",
            })

    # ── Spray schedule table ──
    spray_schedule = []
    chemicals = treatment.get("chemical_controls", [])
    for idx, chem in enumerate(chemicals[:4]):
        day_num = idx * 7  # Day 0, 7, 14, 21
        brands = chem.get("brands", [])
        brand_names = ", ".join(b.get("name", "") for b in brands[:2]) if brands else ""

        spray_schedule.append({
            "spray_number": idx + 1,
            "day": f"Day {day_num}" if day_num > 0 else "Day 0 — TODAY",
            "timing": "Evening after 5 PM" if idx == 0 else "Morning or evening",
            "product": chem.get("product", ""),
            "brand_names": brand_names,
            "frac_irac_group": chem.get("frac_irac_group", ""),
            "dose": chem.get("dosage", ""),
            "quantity_for_farm": _estimate_quantity(chem.get("dosage", ""), farm_acres),
            "conditional": "If symptoms persist" if idx >= 2 else "",
        })

    # Add biological option to schedule
    bio_options = treatment.get("biological_options", [])
    if bio_options:
        bio = bio_options[0]
        spray_schedule.append({
            "spray_number": len(spray_schedule) + 1,
            "day": "Day 3",
            "timing": "Any time (soil drench)",
            "product": bio.get("agent", bio.get("product", "Trichoderma viride")),
            "brand_names": ", ".join(b.get("name", "") for b in bio.get("brands", [])[:2]),
            "frac_irac_group": "BIO",
            "dose": bio.get("dosage", bio.get("dose", "")),
            "quantity_for_farm": _estimate_quantity(bio.get("dosage", bio.get("dose", "")), farm_acres),
            "conditional": "BIOLOGICAL — apply separately from fungicide",
        })

    rotation_note = treatment.get("rotation_plan", "")
    if not rotation_note and len(chemicals) >= 2:
        groups = [c.get("frac_irac_group", "?") for c in chemicals[:3]]
        rotation_note = f"Never spray the same chemical twice in a row. Follow sequence: {' → '.join(groups)}"

    # ── Safety checklist (do's and don'ts) ──
    safety_do = [
        "Wear mask, gloves, goggles, rubber boots",
        "Spray in evening or early morning only",
        "Wash hands and face with soap after spraying",
    ]
    safety_dont = [
        "Do NOT spray if rain expected within 4 hours",
        "Do NOT eat, drink, or smoke while spraying",
    ]

    # Add PHI warning
    if chemicals:
        max_phi = max((c.get("phi_days", 0) for c in chemicals), default=7)
        safety_do.append(f"Wait {max_phi} days after last spray before harvest")

    # Add specific incompatibilities from do_not_use
    do_not_use = treatment.get("do_not_use", [])
    for item in do_not_use[:2]:
        if isinstance(item, str):
            safety_dont.append(item)

    app_safety = treatment.get("applicator_safety", {})
    if app_safety.get("mixing_instructions"):
        safety_do.append(app_safety["mixing_instructions"])
    if app_safety.get("disposal"):
        safety_do.append(app_safety["disposal"])

    # ── Follow-up & contacts ──
    monitoring = treatment.get("monitoring_plan", {})
    follow_up_days = monitoring.get("follow_up_in_days", 7)
    try:
        follow_date = (datetime.now(timezone.utc) + timedelta(days=follow_up_days)).strftime("%d %B %Y")
        next_spray_date = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%d %B")
    except Exception:
        follow_date = f"in {follow_up_days} days"
        next_spray_date = "Day 7"

    return {
        "what_is_happening": {
            "explanation": description,
            "causes": causes[:4],
        },
        "why_now": {
            "weather_cards": weather_cards,
            "weather_risk_level": weather_risk.get("overall_disease_risk", "UNKNOWN"),
            "favorable_diseases": weather_risk.get("favorable_diseases", []),
            "advisory": weather_risk.get("advisory", ""),
        },
        "spray_schedule": {
            "items": spray_schedule,
            "rotation_note": rotation_note,
            "spray_timing_advisory": treatment.get("spray_timing_advisory", ""),
        },
        "safety_checklist": {
            "do": safety_do,
            "dont": safety_dont,
        },
        "follow_up": {
            "send_photo_on": follow_date,
            "next_spray": f"{next_spray_date} (Day {follow_up_days})",
            "what_to_watch_for": monitoring.get("what_to_watch_for", []),
            "contacts": {
                "kisan_call_centre": "1800-180-1551 (toll-free)",
                "advisor_trigger": (
                    "Consult KVK if disease spreads beyond 30% of field after 7 days "
                    "of treatment, or if symptoms worsen rapidly."
                ),
            },
        },
        "cultural_practices": treatment.get("cultural_practices", []),
        "preventive_measures": treatment.get("preventive_measures", []),
        "long_term_recommendations": treatment.get("long_term_recommendations", []),
    }


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — DISPENSING SHEET (For Input Dealer)
# ══════════════════════════════════════════════════════════════════════════════

def _to_inr(x) -> float:
    """Coerce an LLM-supplied price to a number.

    `mrp_approx` / cost fields come straight from the model and are often
    strings ("120", "₹120", "120-150", "N/A") rather than numbers. Summing
    those with an int start raises TypeError and aborts the whole pipeline,
    so we extract the first numeric token and default to 0 — report pricing
    is best-effort and must never crash report generation.
    """
    if isinstance(x, bool):
        return 0.0
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        m = re.search(r"\d+(?:\.\d+)?", x)
        if m:
            return float(m.group())
    return 0.0


def _build_section3_dispensing_sheet(
    diagnosis: dict, treatment: dict, params: dict,
) -> dict:
    """
    Page 3: Dealer-facing product dispensing table + substitutes + compliance.
    """
    disease_info = diagnosis.get("primary_diagnosis", {})
    disease_name = disease_info.get("disease", "Unknown")
    scientific   = disease_info.get("scientific_name", "")
    pathogen     = disease_info.get("pathogen_type", diagnosis.get("pathogen_type", "unknown"))
    confidence   = diagnosis.get("confidence_score", 0.0)
    crop         = params.get("crop_name", "Unknown")
    # Coerce to a number — farm_size_acres can arrive as a string ("2") from the
    # farm profile, and it is multiplied below (dosage/pricing), so a str would
    # corrupt output (int * str → repetition) or crash arithmetic downstream.
    farm_acres   = _to_inr(params.get("farm_size_acres")) or 1

    # ── Products table ──
    products = []
    total_cost = 0
    chemicals = treatment.get("chemical_controls", [])

    for idx, chem in enumerate(chemicals[:4]):
        brands = chem.get("brands", [])
        brand_names = ", ".join(b.get("name", "") for b in brands[:2]) if brands else ""
        frac = chem.get("frac_irac_group", "")

        # Estimate price
        price_est = 0
        cost_str = chem.get("cost_estimate_inr_per_acre", "")
        if cost_str:
            import re
            nums = re.findall(r'[\d]+', str(cost_str))
            if nums:
                price_est = int(int(nums[0]) * farm_acres)

        # If no cost from agent, try from brands
        if not price_est and brands:
            price_est = int(sum(_to_inr(b.get("mrp_approx", 0)) for b in brands[:1]))

        total_cost += price_est

        products.append({
            "number": idx + 1,
            "product": chem.get("product", ""),
            "active_ingredient": chem.get("active_ingredient", ""),
            "brand_names": brand_names,
            "frac_irac_group": frac,
            "frac_type": "Contact" if "M0" in frac or "contact" in frac.lower() else "Systemic" if frac else "",
            "quantity_for_farm": _estimate_quantity(chem.get("dosage", ""), farm_acres),
            "when": f"Day {idx * 7}" if idx > 0 else "Day 0 (Today)",
            "est_price_inr": f"₹ {price_est}" if price_est else "",
            "pollinator_safety": chem.get("pollinator_safety", ""),
        })

    # Add biological products
    bio_options = treatment.get("biological_options", [])
    for bio in bio_options[:1]:
        brands = bio.get("brands", [])
        brand_names = ", ".join(b.get("name", "") for b in brands[:2]) if brands else ""
        bio_price = int(sum(_to_inr(b.get("mrp_approx", 0)) for b in brands[:1]))
        total_cost += bio_price

        products.append({
            "number": len(products) + 1,
            "product": f"{bio.get('agent', bio.get('product', 'Trichoderma viride'))} (BIOLOGICAL)",
            "active_ingredient": bio.get("agent", ""),
            "brand_names": brand_names,
            "frac_irac_group": "BIO",
            "frac_type": "Biological",
            "quantity_for_farm": _estimate_quantity(bio.get("dosage", bio.get("dose", "")), farm_acres),
            "when": "Day 3 (soil drench)",
            "est_price_inr": f"₹ {bio_price}" if bio_price else "",
            "pollinator_safety": "safe",
        })

    # ── Substitute products if primary unavailable ──
    substitutes = []
    for idx, chem in enumerate(chemicals[:3]):
        prod = chem.get("product", "")
        frac = chem.get("frac_irac_group", "")
        # Generate sensible substitutes based on FRAC group
        if "M03" in frac or "mancozeb" in prod.lower():
            substitutes.append({
                "original": prod,
                "substitute": "Chlorothalonil 75% WP",
                "note": "Same contact action, FRAC M05",
            })
        elif "FRAC 3" in frac or "FRAC 4" in frac or "propiconazole" in prod.lower():
            substitutes.append({
                "original": prod,
                "substitute": "Tebuconazole 25.9% EC",
                "note": "Same DMI group (FRAC 3)",
            })
        elif "27" in frac or "cymoxanil" in prod.lower():
            substitutes.append({
                "original": prod,
                "substitute": "Metalaxyl-M 4% + Mancozeb 64%",
                "note": "FRAC 4+M03 — match group to preserve rotation",
            })
        elif "40" in frac or "dimethomorph" in prod.lower():
            substitutes.append({
                "original": prod,
                "substitute": "Fluopicolide + Propamocarb (Infinito)",
                "note": "Alternative systemic oomycete control",
            })

    # ── Incompatibility warnings ──
    incompatibilities = []
    # Common known incompatibilities
    has_mancozeb = any("mancozeb" in c.get("product", "").lower() for c in chemicals)
    has_copper = any("copper" in c.get("product", "").lower() for c in chemicals)

    if has_mancozeb:
        incompatibilities.append({
            "do_not_mix": "Mancozeb + Copper Oxychloride",
            "reason": "Chemical reaction reduces efficacy",
        })
        incompatibilities.append({
            "do_not_mix": "Mancozeb + Alkaline fertilizers",
            "reason": "Hydrolysis degrades product",
        })
    if bio_options:
        incompatibilities.append({
            "do_not_mix": "Trichoderma + any fungicide in same tank",
            "reason": "Fungicide kills bio-agent. Apply separately, 3 days AFTER fungicide spray",
        })

    # ── PPE checklist ──
    app_safety = treatment.get("applicator_safety", {})
    ppe = app_safety.get("ppe_required", [
        "Gloves", "N95 mask", "Goggles", "Apron", "Rubber boots", "Measuring cup"
    ])

    # ── Why these products (rationale) ──
    frac_groups_used = [c.get("frac_irac_group", "?") for c in chemicals[:3]]
    rationale = (
        f"{disease_name} is a {pathogen} — it responds to "
        f"{', '.join(frac_groups_used[:2])} group chemicals. "
        f"Rotating these MoA groups prevents resistance buildup."
    )

    return {
        "header": {
            "crop": f"{crop} · {farm_acres} acres",
            "disease": disease_name,
            "confidence_pct": round(confidence * 100),
            "perspective_agreement": diagnosis.get("perspective_agreement", ""),
        },
        "rationale": rationale,
        "products": products,
        "total_estimated_cost_inr": f"₹ {total_cost:,}" if total_cost else "",
        "substitutes": substitutes,
        "substitution_note": "When substituting, match the FRAC group to preserve resistance rotation.",
        "incompatibilities": incompatibilities,
        "ppe_checklist": ppe,
        "do_not_use": treatment.get("do_not_use", []),
    }


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — ANNEX (Data & Evidence)
# ══════════════════════════════════════════════════════════════════════════════

def _build_section4_annex(
    diagnosis: dict, treatment: dict, weather_risk: dict,
    image_quality: dict, params: dict,
    report_id: str, generated_at: str, pipeline_model: str,
) -> dict:
    """
    Page 4: Technical annex — input params, evidence matrix, compliance audit, metadata.
    """
    disease_info = diagnosis.get("primary_diagnosis", {})
    disease_name = disease_info.get("disease", "Unknown")
    confidence   = diagnosis.get("confidence_score", 0.0)
    crop         = params.get("crop_name", "Unknown")

    # ── A. Input Parameters ──
    input_params = {
        "crop_stage": params.get("crop_growth_stage", "Unknown"),
        "gps": f"{params.get('field_latitude', '?')}°N, {params.get('field_longitude', '?')}°E",
        "farm_size_acres": params.get("farm_size_acres", "?"),
        "affected_area": _affected_area_text(params.get("affected_area_percent", 0)),
        "variety": params.get("crop_variety", "Not specified"),
        "irrigation": params.get("irrigation_system", "Unknown"),
        "soil_type": params.get("soil_type", "Unknown"),
        "farmer_description": params.get("symptom_description", "Not provided"),
        "prior_treatments": params.get("recent_pesticide_used", "None reported"),
        "image_quality_score": f"{image_quality.get('quality_score', 0):.2f}",
        "image_usable": image_quality.get("usable", False),
    }

    # ── B. Environmental Data ──
    raw_weather = params.get("_raw_weather", {})
    current = raw_weather.get("current", {}) if raw_weather else {}
    soil = raw_weather.get("soil", {}) if raw_weather else {}

    environmental_data = []
    if current:
        environmental_data = [
            {
                "parameter": "Avg Temperature",
                "measured": f"{current.get('temperature', '?')} °C",
                "favorable": weather_risk.get("weather_used", False),
            },
            {
                "parameter": "Relative Humidity",
                "measured": f"{current.get('humidity', '?')} %",
                "favorable": float(current.get("humidity", 0)) > 75 if current.get("humidity") else False,
            },
            {
                "parameter": "VPD",
                "measured": f"{current.get('vpd', '?')} kPa",
                "favorable": float(current.get("vpd", 1)) < 0.6 if current.get("vpd") else False,
            },
            {
                "parameter": "Precipitation",
                "measured": f"{current.get('precipitation', 0)} mm",
                "favorable": float(current.get("precipitation", 0)) > 2,
            },
        ]
        if soil:
            environmental_data.append({
                "parameter": "Soil Moisture (0-1cm)",
                "measured": f"{soil.get('moisture_0_1cm', '?')} m³/m³",
                "favorable": float(soil.get("moisture_0_1cm", 0)) > 0.25 if soil.get("moisture_0_1cm") else False,
            })

    # ── C. Diagnostic Evidence Matrix ──
    evidence_matrix = []
    # Primary disease
    evidence_matrix.append({
        "disease": disease_name,
        "is_primary": True,
        "vision_confidence": round(confidence, 2),
        "env_favorability": weather_risk.get("overall_disease_risk", "UNKNOWN"),
        "symptom_match": round(confidence * 0.95, 2),  # approximate
        "regional_signal": "STRONG" if disease_name.lower() in [d.lower() for d in weather_risk.get("favorable_diseases", [])] else "NONE",
        "fused_score": round(confidence, 2),
    })
    # Differentials
    for diff in diagnosis.get("differentials", [])[:3]:
        prob = diff.get("probability", 0)
        evidence_matrix.append({
            "disease": diff.get("disease", "Unknown"),
            "is_primary": False,
            "vision_confidence": round(prob, 2) if isinstance(prob, (int, float)) else 0,
            "env_favorability": "LOW",
            "symptom_match": round(prob * 0.8, 2) if isinstance(prob, (int, float)) else 0,
            "regional_signal": "NONE",
            "fused_score": round(prob, 2) if isinstance(prob, (int, float)) else 0,
        })

    model_agreement = diagnosis.get("perspective_agreement", "unknown")
    penalties = diagnosis.get("confidence_penalties", [])

    # ── D. Compliance Audit Log (REAL — driven by safety/validator output) ──
    # The treatment_agent ran the chemical registry validator before this
    # point and stamped `_safety` onto the treatment dict. build_compliance_audit
    # reads that, plus the surviving chemicals, plus the diagnosis +
    # crop/state context, and emits PASSED/WARNING/FAILED/N/A per check.
    # No more cosmetic "PASSED" strings.
    audit = build_compliance_audit(
        diagnosis=diagnosis,
        treatment=treatment,
        params=params,
        validation_meta=treatment.get("_safety"),
    )
    compliance_checks = audit["checks"]

    # ── E. System Metadata ──
    system_meta = {
        "version": "2.4.1",
        "diagnosis_model": pipeline_model,
        "weather_api": "Open-Meteo (free tier)",
        "weather_used": weather_risk.get("weather_used", False),
        "report_generated_at": generated_at,
        "report_id": report_id,
    }

    # ── Look-alikes ruled out ──
    look_alikes = diagnosis.get("look_alikes_ruled_out", [])

    return {
        "input_parameters": input_params,
        "environmental_data": environmental_data,
        "evidence_matrix": {
            "diseases": evidence_matrix,
            "model_agreement": model_agreement,
            "confidence_penalties": penalties,
        },
        "look_alikes_ruled_out": look_alikes,
        "compliance_audit": compliance_checks,
        "compliance_summary": audit["summary"],
        "compliance_registry_version": audit["registry_version"],
        "compliance_registry_sources": audit["registry_sources"],
        "safety_blockers":  (treatment.get("_safety") or {}).get("blockers", []),
        "safety_warnings":  (treatment.get("_safety") or {}).get("warnings", []),
        "system_metadata": system_meta,
        "disclaimer": (
            "This report is generated by an AI-assisted advisory system and serves as a "
            "decision-support document, not a formal prescription. For severe, unusual, or "
            "persistent cases, consult a certified agronomist or your nearest Krishi Vigyan "
            "Kendra (KVK). Recommended pesticides must be used strictly per CIB&RC-approved labels."
        ),
    }


# ══════════════════════════════════════════════════════════════════════════════
# MAIN REPORT ASSEMBLY
# ══════════════════════════════════════════════════════════════════════════════

def _generate_template_report(
    diagnosis: dict,
    treatment: dict,
    weather_risk: dict,
    image_quality: dict,
    params: dict,
    report_id: str,
    generated_at: str,
) -> dict:
    """
    Deterministic template report — no LLM, ~0ms, $0.
    Structured into 4 sections matching KrishiRakshak PDF layout.
    """
    disease_info  = diagnosis.get("primary_diagnosis", {})
    disease_name  = disease_info.get("disease", "Unknown")
    confidence    = diagnosis.get("confidence_score", 0.0)
    severity      = disease_info.get("severity", "Unknown")
    needs_advisor = diagnosis.get("needs_advisor", False)

    pipeline_model = "gemini-2.5-flash"

    # ── Build 4 report sections ──
    section1 = _build_section1_farmer_summary(
        diagnosis, treatment, params, image_quality, report_id, generated_at,
    )
    section2 = _build_section2_detailed_guidance(
        diagnosis, treatment, weather_risk, params,
    )
    section3 = _build_section3_dispensing_sheet(
        diagnosis, treatment, params,
    )
    section4 = _build_section4_annex(
        diagnosis, treatment, weather_risk, image_quality, params,
        report_id, generated_at, pipeline_model,
    )

    # ── Assemble final report ──
    return {
        # Top-level identifiers
        "report_id": report_id,
        "generated_at": generated_at,
        "language": params.get("language", "en"),

        # ── 4 STRUCTURED SECTIONS ──
        # Section 1: Farmer Summary (disease detection + what to do)
        "farmer_summary_page": section1,

        # Section 2: Detailed Guidance (explanation + spray schedule + safety)
        "detailed_guidance_page": section2,

        # Section 3: Dispensing Sheet (dealer product list + compliance)
        "dispensing_sheet_page": section3,

        # Section 4: Annex (evidence + audit + metadata)
        "annex_page": section4,

        # ── FLAT ACCESS FIELDS (for backward compatibility + quick access) ──
        "farm": section1["farmer_details"],
        "disease": section1["disease_detected"],
        "causes": section2["what_is_happening"]["causes"],
        "treatment": {
            "immediate":         treatment.get("immediate_actions", []),
            "chemical":          treatment.get("chemical_controls", []),
            "rotation_plan":     treatment.get("rotation_plan", ""),
            "biological":        treatment.get("biological_options", []),
            "organic":           treatment.get("organic_alternatives", []),
            "cultural":          treatment.get("cultural_practices", []),
            "fertilizer":        treatment.get("fertilizer_recommendations", []),
            "preventive":        treatment.get("preventive_measures", []),
            "spray_timing":      treatment.get("spray_timing_advisory", ""),
            "combinations":      treatment.get("medicine_combinations", []),
            "do_not_use":        treatment.get("do_not_use", []),
            "applicator_safety": treatment.get("applicator_safety", {}),
            "monitoring_plan":   treatment.get("monitoring_plan", {}),
        },
        "action_card": {
            "diagnosis_one_liner": (
                f"{disease_name} ({severity})"
                if confidence >= 0.50
                else "Diagnosis uncertain — consult KVK"
            ),
            "top_3_actions": [a["action"] for a in section1["weekly_actions"][:3]],
            "follow_up_days": treatment.get("monitoring_plan", {}).get("follow_up_in_days", 7),
            "emergency_contact": "Kisan Call Centre: 1800-180-1551 (toll-free)",
        },
        "next_steps": [a["action"] for a in section1["weekly_actions"]],
        "advisor_needed": needs_advisor,
        "weather_outlook": {
            "risk":               weather_risk.get("overall_disease_risk", "UNKNOWN"),
            "forecast_risk":      weather_risk.get("forecast_risk", ""),
            "advisory":           weather_risk.get("advisory", ""),
            "risk_factors":       weather_risk.get("risk_factors", []),
            "favorable_diseases": weather_risk.get("favorable_diseases", []),
            "soil_risk":          weather_risk.get("soil_risk", "UNKNOWN"),
            "weather_used":       weather_risk.get("weather_used", False),
        },
        "farmer_summary": section1["farmer_summary"],
        "confidence_score": confidence,
        "risk_level": weather_risk.get("overall_disease_risk", "UNKNOWN"),
        "image_quality": section1["image_quality"],
        "meta": {
            "report_id":              report_id,
            "model_diagnosis":        pipeline_model,
            "needs_advisor":          needs_advisor,
            "needs_lab_confirmation": diagnosis.get("needs_lab_confirmation", False),
            "pathogen_type":          disease_info.get("pathogen_type", diagnosis.get("pathogen_type", "unknown")),
            "perspective_agreement":  diagnosis.get("perspective_agreement", "unknown"),
            "confidence_tier":        diagnosis.get("confidence_tier", "MEDIUM"),
            "confidence_penalties":   diagnosis.get("confidence_penalties", []),
            "differentials":          diagnosis.get("differentials", []),
            "look_alikes_ruled_out":  diagnosis.get("look_alikes_ruled_out", []),
            "crop_mismatch":          diagnosis.get("crop_mismatch", False),
            "is_out_of_distribution": diagnosis.get("is_out_of_distribution", False),
            "confidence_adjusted_note": treatment.get("confidence_adjusted_note"),
            "safety": {
                # Mirror the audit summary at the top level so the mobile app
                # can render a single "Safety" badge without parsing annex.
                "registry_version": (treatment.get("_safety") or {}).get("registry_version"),
                "blockers":         (treatment.get("_safety") or {}).get("blockers", []),
                "warnings":         (treatment.get("_safety") or {}).get("warnings", []),
            },
            "_template":              True,
        },
    }


# ── Public entry point ────────────────────────────────────────────────────────

async def run_report_generator_agent(
    diagnosis: dict,
    treatment: dict,
    weather_risk: dict,
    image_quality: dict,
    params: dict,
) -> tuple[dict, dict]:
    """
    Generates the final report card.
    Uses template-based generation (no LLM) — instant, $0.
    Returns (report_dict, token_info).
    """
    report_id    = _report_id()
    generated_at = _generated_at()

    report = _generate_template_report(
        diagnosis, treatment, weather_risk, image_quality, params,
        report_id, generated_at,
    )

    # Native-language summary strips — best-effort enrichment via Sarvam.
    # Never raises; failures degrade to blocks={} and the frontend hides
    # the native strip.
    await _attach_local_blocks(report, params)

    logger.info(
        "Template report built — id=%s disease=%s sections=4 lang=%s cost=$0.0000",
        report_id[:8], report["disease"]["name_common"],
        report.get("local_blocks", {}).get("language", "en"),
    )
    return report, empty_token_info("template")
