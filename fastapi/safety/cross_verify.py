"""
safety/cross_verify.py — rule-based skeptic stage.

Extracted verbatim from orchestrator._cross_verify (commit pre-ensemble) and
extended with the KB-membership guard mandated by §6.5 of the master spec:

  "Penalize a weather contradiction only when the disease exists in the
   weather knowledge base. Absence from the table is 'unknown', not
   'contradiction' → zero penalty."

The previous behaviour deducted confidence whenever the LLM said
`weather_correlation == "CONTRADICTS"` AND the disease wasn't in the rule
engine's small list of known favorable diseases. Because the rule engine
only knows ~12 generic diseases, this fired on most crop-specific diagnoses
(e.g. cotton boll rot, sugarcane red rot) — punishing the right answer for
the KB's narrowness. After this change, "disease not in KB" → no weather
penalty at all (the KB has no opinion on it).
"""
from __future__ import annotations

import logging
from typing import Optional

from config import DIAGNOSIS_ESCALATE_BELOW
from services.weather_rules import disease_is_known

logger = logging.getLogger(__name__)


# ── Tunables (kept identical to the in-orchestrator constants) ───────────────
MAX_CROSS_VERIFY_PENALTY = 0.20

# When the ensemble reports independent agreement, soft-penalty ceiling drops
# further — disagreement-resistant agreement is the strongest signal we have.
MAX_PENALTY_WITH_AGREEMENT = 0.10


def _parse_agreement(s) -> Optional[tuple[int, int]]:
    """Parse an "N/D" agreement string (e.g. "2/3") → (N, D), else None.
    Used for BOTH the ensemble path (`ensemble_agreement`) and the single-model
    path (`perspective_agreement`)."""
    if isinstance(s, str) and "/" in s:
        try:
            n, d = s.split("/", 1)
            n, d = int(n), int(d)
            if d > 0:
                return n, d
        except ValueError:
            pass
    return None


def apply(
    diagnosis: dict,
    weather_risk: dict,
    image_quality: dict,
    *,
    weather_kb_has_disease: Optional[bool] = None,
) -> tuple[dict, float]:
    """
    Cross-verify a diagnosis against weather favorability and image quality;
    apply confidence penalties when evidence conflicts.

    weather_kb_has_disease:
        If the caller already knows whether the diagnosed disease is in the
        weather rule KB, pass it in (saves one lookup). If None, this
        function infers it from `diagnosis.primary_diagnosis.disease` via
        services.weather_rules.disease_is_known().

    Returns (updated_diagnosis, updated_confidence).
    """
    confidence = diagnosis.get("confidence_score", 0.0)
    penalties: list[str] = list(diagnosis.get("confidence_penalties", []))
    raw_penalty = 0.0

    # Resolve KB membership once.
    primary = diagnosis.get("primary_diagnosis", {}) or {}
    disease_name = (primary.get("disease") or "").strip()
    if weather_kb_has_disease is None:
        weather_kb_has_disease = disease_is_known(disease_name)

    # ── Hard caps (upper-bound resets when output is unreliable) ─────────────
    if diagnosis.get("is_out_of_distribution") and "out_of_distribution" not in str(penalties):
        confidence = min(confidence, 0.45)
        penalties.append("Out-of-distribution image — confidence capped at 0.45")

    # All-disagree cap. Read the ENSEMBLE's agreement first (reconciler writes
    # `ensemble_agreement`), then fall back to the single-model
    # `perspective_agreement`. Previously this read ONLY perspective_agreement,
    # which the ensemble path never sets → the cap was dead code on ensembles.
    agr = (_parse_agreement(diagnosis.get("ensemble_agreement"))
           or _parse_agreement(diagnosis.get("perspective_agreement")))
    if agr and agr[1] >= 2 and (agr[0] / agr[1]) < 0.5 and confidence > 0.55:
        confidence = 0.55
        penalties.append(f"Models disagree ({agr[0]}/{agr[1]}) — confidence capped at 0.55")

    if diagnosis.get("crop_mismatch") and "crop_mismatch" not in str(penalties):
        confidence = min(confidence, 0.30)
        penalties.append("Crop mismatch suspected — confidence capped at 0.30")

    # ── Soft penalty stack ──────────────────────────────────────────────────
    weather_corr = diagnosis.get("weather_correlation", "PARTIAL")
    disease_lc   = disease_name.lower()
    favorable    = [d.lower() for d in weather_risk.get("favorable_diseases", [])]

    # WEATHER CONTRADICTION — only meaningful when the KB has an opinion on
    # this disease. Otherwise "CONTRADICTS" is unrelated noise.
    if (weather_corr == "CONTRADICTS"
            and weather_kb_has_disease
            and "contradicts_weather" not in str(penalties)):
        raw_penalty += 0.06
        penalties.append("Weather CONTRADICTS diagnosis (-0.06)")
    elif weather_corr == "CONTRADICTS" and not weather_kb_has_disease:
        # Surface the fact that we deliberately skipped the penalty so
        # downstream debugging can see why a "CONTRADICTS" verdict didn't
        # move confidence.
        penalties.append(
            f"Weather CONTRADICTS but '{disease_name}' not in weather KB — penalty skipped"
        )

    # "Not in favorable list" is only signal when the LLM ALSO said weather
    # didn't support its call — and only if the disease is in the KB at all.
    if (favorable and disease_lc and disease_lc != "unknown"
            and weather_corr == "CONTRADICTS"
            and weather_kb_has_disease):
        in_favorable = any(disease_lc in f or f in disease_lc for f in favorable)
        if not in_favorable and weather_risk.get("weather_used"):
            raw_penalty += 0.02
            penalties.append(f"Disease '{disease_name}' not in weather-favorable list (-0.02)")

    differentials = diagnosis.get("differentials", [])
    if differentials:
        primary_conf = diagnosis.get("confidence_score", 0)
        top_diff_prob = differentials[0].get("probability", 0)
        if isinstance(top_diff_prob, (int, float)) and isinstance(primary_conf, (int, float)):
            if abs(primary_conf - top_diff_prob) < 0.10 and top_diff_prob > 0.25:
                if "ambiguous_pair" not in str(penalties):
                    raw_penalty += 0.04
                    penalties.append(
                        f"Ambiguous: primary ({primary_conf:.0%}) vs differential "
                        f"'{differentials[0].get('disease', '?')}' ({top_diff_prob:.0%}) (-0.04)"
                    )

    # Image quality — scale with the actual score so a borderline image
    # (0.45) costs less than a near-unusable one (0.20).
    img_score = float(image_quality.get("quality_score", 1.0))
    if img_score < 0.5 and "image_quality" not in str(penalties):
        # Linear ramp: 0.5 -> 0.00 penalty, 0.0 -> 0.12 penalty.
        scaled = round((0.5 - max(img_score, 0.0)) * 0.24, 3)
        if scaled > 0:
            raw_penalty += scaled
            penalties.append(f"Poor image quality ({img_score:.2f}) (-{scaled:.2f})")

    if diagnosis.get("needs_lab_confirmation") and "lab_confirmation" not in str(penalties):
        raw_penalty += 0.04
        penalties.append(
            "Pathogen type ambiguous (bacterial/fungal) — lab confirmation needed (-0.04)"
        )

    va = diagnosis.get("_visual_audit") or {}
    if va.get("available") and "visual_claims" not in str(penalties):
        pen = float(va.get("score_penalty") or 0)
        if pen > 0:
            # HSV verifier's penalty halved — color buckets are coarse.
            pen = round(pen * 0.5, 3)
            raw_penalty += pen
            falsified = va.get("falsified", [])
            penalties.append(
                f"Visual claims not supported by pixels ({', '.join(falsified)}) (-{pen:.2f})"
            )

    # ── Choose the cap based on whether the ensemble reported agreement ──
    # When the ensemble's reconciler set `ensemble_agreement` to >=2/3, the
    # primary call has independent corroboration that already outweighs any
    # single soft signal in this stack. Tighten the cap further.
    _agr = _parse_agreement(diagnosis.get("ensemble_agreement"))  # e.g. "3/3","2/3"
    has_ensemble_majority = bool(_agr and (_agr[0] / _agr[1]) >= (2 / 3))
    cap = MAX_PENALTY_WITH_AGREEMENT if has_ensemble_majority else MAX_CROSS_VERIFY_PENALTY

    applied_penalty = min(raw_penalty, cap)
    if raw_penalty > cap:
        penalties.append(
            f"Total penalty capped at -{cap:.2f} (raw was -{raw_penalty:.2f}"
            + (", ensemble-agreement floor applied" if has_ensemble_majority else "")
            + ")"
        )
    confidence -= applied_penalty
    confidence = max(0.0, min(1.0, confidence))

    diagnosis["confidence_score"] = confidence
    diagnosis["confidence_penalties"] = penalties
    if diagnosis.get("primary_diagnosis"):
        diagnosis["primary_diagnosis"]["confidence"] = confidence
    diagnosis["needs_advisor"] = (
        diagnosis.get("needs_advisor", False) or confidence < DIAGNOSIS_ESCALATE_BELOW
    )

    if confidence >= 0.85:
        diagnosis["confidence_tier"] = "HIGH"
    elif confidence >= 0.70:
        diagnosis["confidence_tier"] = "MEDIUM"
    elif confidence >= 0.50:
        diagnosis["confidence_tier"] = "LOW"
    else:
        diagnosis["confidence_tier"] = "VERY_LOW"

    return diagnosis, confidence
