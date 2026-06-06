"""
Unit tests for agents/reconciler.py and data/disease_synonyms.py.

Covers the three vote patterns the spec calls out (agreement / majority /
all-disagree) plus the canonicalization step that makes voting work
across models that use different labels for the same pathogen.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.reconciler import fuse
from data.disease_synonyms import canonicalize, same_disease


# ── Helpers ──────────────────────────────────────────────────────────────────

def _result(disease, *, confidence=0.7, model="m", severity="Moderate",
            differentials=None, lab=False, ood=False, mismatch=False,
            scientific=""):
    return {
        "primary_diagnosis": {
            "disease":         disease,
            "scientific_name": scientific,
            "confidence":      confidence,
            "severity":        severity,
            "visual_evidence": [],
            "pathogen_type":   "fungal",
        },
        "differentials":          differentials or [],
        "confidence_score":       confidence,
        "severity":               severity,
        "pathogen_type":          "fungal",
        "needs_lab_confirmation": lab,
        "is_out_of_distribution": ood,
        "crop_mismatch":          mismatch,
        "causal_factors":         [],
        "spread_risk":            "MODERATE",
        "weather_correlation":    "PARTIAL",
        "_model":                 model,
    }


# ── Canonicalization ─────────────────────────────────────────────────────────

def test_canonicalize_rust_variants_collapse_to_one_name():
    assert canonicalize("Brown Rust") == "Puccinia triticina"
    assert canonicalize("brown rust") == "Puccinia triticina"
    assert canonicalize("Wheat Brown Rust") == "Puccinia triticina"
    assert canonicalize("Puccinia triticina") == "Puccinia triticina"
    assert same_disease("Brown Rust", "Puccinia triticina") is True


def test_canonicalize_unknown_name_passes_through():
    """Unmapped name flows through unchanged so we don't silently drop data."""
    assert canonicalize("Some Made Up Disease") == "Some Made Up Disease"


def test_same_disease_returns_false_for_empty_inputs():
    assert same_disease("", "") is False
    assert same_disease(None, "Late Blight") is False


# ── Reconciler vote patterns ────────────────────────────────────────────────

def test_unanimous_agreement_boosts_confidence_and_flags_certain():
    """Three models all say 'Late Blight' (under different names). Result:
    canonical winner + agreement bonus + ensemble_used flag."""
    a = _result("Late Blight",            confidence=0.80, model="gemini")
    b = _result("Tomato Late Blight",     confidence=0.85, model="claude")
    c = _result("Phytophthora infestans", confidence=0.75, model="gpt")
    out = fuse([a, b, c])
    assert out["primary_diagnosis"]["disease"] == "Phytophthora infestans"
    assert out["ensemble_agreement"] == "3/3"
    assert out["ensemble_used"] is True
    # Unanimous gets +0.05 boost on top of weighted mean (~0.80).
    assert out["confidence_score"] > 0.80


def test_majority_keeps_dissenter_as_differential():
    a = _result("Late Blight", confidence=0.80, model="gemini")
    b = _result("Late Blight", confidence=0.75, model="claude")
    c = _result("Early Blight", confidence=0.55, model="gpt")
    out = fuse([a, b, c])
    assert "Phytophthora infestans" in out["primary_diagnosis"]["disease"] \
        or out["primary_diagnosis"]["disease"] == "Phytophthora infestans"
    assert out["ensemble_agreement"] == "2/3"
    # The dissenter's pick should appear as a differential.
    diff_names = [d["disease"] for d in out["differentials"]]
    assert any("Alternaria" in n for n in diff_names), diff_names


def test_all_disagree_triggers_lab_flag_and_caps_confidence():
    """Three different diseases → ensemble_agreement=1/3, needs_lab forced,
    confidence capped at 0.55."""
    a = _result("Late Blight",       confidence=0.70, model="gemini")
    b = _result("Powdery Mildew",    confidence=0.65, model="claude")
    c = _result("Rust",              confidence=0.60, model="gpt")
    out = fuse([a, b, c])
    assert out["ensemble_agreement"] == "1/3"
    assert out["needs_lab_confirmation"] is True
    assert out["confidence_score"] <= 0.55 + 1e-6


def test_severity_is_most_conservative_across_voters():
    """When one model says Severe and others say Mild, output Severity = Severe."""
    a = _result("Late Blight", confidence=0.7, severity="Mild")
    b = _result("Late Blight", confidence=0.7, severity="Moderate")
    c = _result("Late Blight", confidence=0.7, severity="Severe")
    out = fuse([a, b, c])
    assert out["severity"].lower() == "severe"


def test_lab_flag_or_merged_across_voters():
    """If any model flags needs_lab_confirmation, the fused result inherits it."""
    a = _result("Late Blight", confidence=0.8)
    b = _result("Late Blight", confidence=0.7, lab=True)
    out = fuse([a, b])
    assert out["needs_lab_confirmation"] is True


def test_single_result_passes_through_with_metadata():
    """One-element input should not crash; reconciler flags ensemble_used=False
    so downstream cross_verify doesn't apply the agreement floor inappropriately."""
    a = _result("Late Blight", confidence=0.85)
    out = fuse([a])
    assert out["ensemble_used"] is False
    assert out["ensemble_agreement"] == "1/1"
    assert out["primary_diagnosis"]["disease"] == "Late Blight"


def test_empty_input_returns_uncertain_shell():
    """Edge case: every ensemble member failed. We return a shell instead of
    raising so the orchestrator can degrade to a rescan response."""
    out = fuse([])
    assert out["primary_diagnosis"]["disease"] == "Unknown"
    assert out["needs_advisor"] is True
    assert out["needs_lab_confirmation"] is True


# ── Tie-break / dead-vote handling (503-fallback robustness) ─────────────────

def test_failed_primary_does_not_sink_a_real_ensemble_vote():
    """A 503'd primary (Unknown@0.0) must NOT win the vote against a real
    ensemble diagnosis — the old insertion-order tie-break did exactly that,
    turning a recoverable scan into a terminal 'Unknown'."""
    primary  = _result("Unknown",      confidence=0.0, model="gemini-2.5-pro")
    ensemble = _result("Late Blight",  confidence=0.80, model="gemini-2.5-flash")
    out = fuse([primary, ensemble])     # primary spliced first, as the orchestrator does
    assert out["primary_diagnosis"]["disease"] == "Phytophthora infestans"
    assert out["primary_diagnosis"]["disease"] != "Unknown"


def test_two_real_tie_resolves_to_higher_confidence():
    """A 1-1 tie between two real diseases resolves to the more-confident
    voter (deterministic), not whoever was inserted first."""
    a = _result("Late Blight",  confidence=0.60, model="a")   # → Phytophthora infestans
    b = _result("Early Blight", confidence=0.90, model="b")   # → Alternaria solani
    out = fuse([a, b])
    assert out["primary_diagnosis"]["disease"] == "Alternaria solani"


def test_all_members_unknown_returns_shell():
    """If every live vote is Unknown/Uncertain, keep the honest Unknown shell."""
    out = fuse([_result("Unknown", confidence=0.0),
                _result("UNCERTAIN", confidence=0.0)])
    assert out["primary_diagnosis"]["disease"] == "Unknown"
    assert out["needs_advisor"] is True
