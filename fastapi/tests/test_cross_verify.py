"""
Unit tests for safety/cross_verify.py.

Covers the §6.5 bug fix: a disease that is NOT in the weather rule KB
must not lose confidence for "weather contradiction". Also exercises
the soft-penalty cap and the ensemble-agreement floor.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from safety import cross_verify


def _diag(
    *,
    disease="Brown Rust",
    conf=0.70,
    weather_correlation="CONTRADICTS",
    differentials=None,
    visual_audit=None,
    needs_lab=False,
    crop_mismatch=False,
    is_ood=False,
    ensemble_agreement=None,
):
    d = {
        "primary_diagnosis": {
            "disease":       disease,
            "scientific_name": "Puccinia triticina",
            "confidence":    conf,
            "severity":      "Moderate",
            "pathogen_type": "fungal",
        },
        "confidence_score":       conf,
        "weather_correlation":    weather_correlation,
        "differentials":          differentials or [],
        "needs_lab_confirmation": needs_lab,
        "crop_mismatch":          crop_mismatch,
        "is_out_of_distribution": is_ood,
        "confidence_penalties":   [],
    }
    if visual_audit:
        d["_visual_audit"] = visual_audit
    if ensemble_agreement is not None:
        d["ensemble_agreement"] = ensemble_agreement
    return d


def _weather(*, used=True, favorable=()):
    return {
        "overall_disease_risk": "MODERATE",
        "risk_factors": [],
        "favorable_diseases": list(favorable),
        "weather_used": used,
    }


def _img(score=1.0):
    return {"quality_score": score}


def test_weather_contradicts_known_disease_applies_penalty():
    """When the disease IS in the weather KB and the LLM said CONTRADICTS,
    we should see the 0.06 penalty (capped within MAX_CROSS_VERIFY_PENALTY)."""
    d = _diag(disease="Late Blight", conf=0.80, weather_correlation="CONTRADICTS")
    out, conf = cross_verify.apply(d, _weather(), _img(), weather_kb_has_disease=True)
    assert conf < 0.80
    assert any("CONTRADICTS" in p for p in out["confidence_penalties"])


def test_weather_contradicts_unknown_disease_skips_penalty():
    """The §6.5 fix: disease absent from the weather KB must NOT lose
    confidence for 'contradiction' — the KB has no opinion to contradict."""
    d = _diag(disease="Sugarcane Red Rot", conf=0.80, weather_correlation="CONTRADICTS")
    out, conf = cross_verify.apply(d, _weather(), _img(), weather_kb_has_disease=False)
    assert conf == 0.80, f"expected 0.80 (no weather penalty), got {conf}"
    # The reason for skipping should be surfaced in the penalty trail.
    assert any("not in weather KB" in p for p in out["confidence_penalties"])


def test_total_penalty_capped_at_20pct():
    """When everything fires (low image quality + needs_lab + visual claims),
    the total deduction must not exceed MAX_CROSS_VERIFY_PENALTY (0.20)."""
    d = _diag(
        disease="Late Blight",
        conf=0.90,
        weather_correlation="CONTRADICTS",
        needs_lab=True,
        visual_audit={"available": True, "score_penalty": 0.30, "falsified": ["yellow halo"]},
    )
    out, conf = cross_verify.apply(d, _weather(favorable=["other thing"]), _img(score=0.2),
                                    weather_kb_has_disease=True)
    # confidence should drop by AT MOST 0.20.
    assert conf >= 0.70 - 1e-6, f"expected conf >= 0.70 after cap, got {conf}"
    # And the cap message should appear.
    assert any("capped" in p for p in out["confidence_penalties"])


def test_ensemble_agreement_tightens_cap_further():
    """When the ensemble reports 2/3+ agreement, the soft-penalty cap drops
    to MAX_PENALTY_WITH_AGREEMENT (0.10)."""
    # Same scenario as above, but with ensemble_agreement=2/3
    d = _diag(
        disease="Late Blight",
        conf=0.90,
        weather_correlation="CONTRADICTS",
        needs_lab=True,
        visual_audit={"available": True, "score_penalty": 0.30, "falsified": ["yellow halo"]},
        ensemble_agreement="2/3",
    )
    out, conf = cross_verify.apply(d, _weather(favorable=["other thing"]), _img(score=0.2),
                                    weather_kb_has_disease=True)
    assert conf >= 0.80 - 1e-6, (
        f"with ensemble agreement, soft penalties should cap at 0.10 -> conf >= 0.80, got {conf}"
    )


def test_out_of_distribution_hard_caps_confidence():
    """is_out_of_distribution forces confidence to at most 0.45 BEFORE soft penalties."""
    d = _diag(disease="Late Blight", conf=0.95, is_ood=True)
    out, conf = cross_verify.apply(d, _weather(), _img(), weather_kb_has_disease=True)
    assert conf <= 0.45 + 1e-6


def test_crop_mismatch_hard_caps_confidence():
    d = _diag(disease="Late Blight", conf=0.95, crop_mismatch=True)
    out, conf = cross_verify.apply(d, _weather(), _img(), weather_kb_has_disease=True)
    assert conf <= 0.30 + 1e-6


def test_image_quality_penalty_scales_with_score():
    """The image-quality penalty should scale with how bad the image is —
    a 0.45 score costs less than a 0.10 score."""
    bad = _diag(disease="Late Blight", conf=0.90, weather_correlation="PARTIAL")
    out_bad, conf_bad = cross_verify.apply(bad, _weather(used=False), _img(score=0.10),
                                            weather_kb_has_disease=True)
    borderline = _diag(disease="Late Blight", conf=0.90, weather_correlation="PARTIAL")
    out_b, conf_b = cross_verify.apply(borderline, _weather(used=False), _img(score=0.45),
                                        weather_kb_has_disease=True)
    assert conf_bad < conf_b, (
        f"worse image quality should cost more confidence: bad={conf_bad} borderline={conf_b}"
    )
