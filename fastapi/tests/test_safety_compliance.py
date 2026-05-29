"""
Unit tests for safety/compliance.py — the report's compliance audit block.

The audit replaces the old stub that always wrote "PASSED" regardless of
state. Each check must emit PASSED / WARNING / FAILED / N/A appropriately.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from safety.compliance import build_compliance_audit


def _diag(**extra):
    d = {
        "primary_diagnosis": {"disease": "Early Blight", "severity": "Moderate",
                              "confidence": 0.85, "pathogen_type": "fungal"},
        "confidence_score": 0.85, "pathogen_type": "fungal",
    }
    d.update(extra)
    return d


def _statuses(audit):
    return {c["check"]: c["status"] for c in audit["checks"]}


def test_compliance_passed_for_clean_treatment():
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "frac_irac_group": "FRAC M03",
             "dosage": "2.5 g/L", "phi_days": 3},
            {"product": "Propiconazole 25 EC", "frac_irac_group": "FRAC 3",
             "dosage": "1 ml/L", "phi_days": 14},
        ],
        "_safety": {"registry_version": "test", "blockers": [], "warnings": []},
    }
    audit = build_compliance_audit(diagnosis=_diag(), treatment=treatment, params={})
    s = _statuses(audit)
    assert s["Banned / restricted chemicals"] == "PASSED"
    assert s["CIB&RC registration"] == "PASSED"
    assert s["PHI on every product"] == "PASSED"
    assert s["FRAC / IRAC rotation stewardship"] == "PASSED"
    assert s["Dose within label range"] == "PASSED"
    assert audit["summary"]["failed"] == 0


def test_compliance_failed_when_banned_blocked():
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "frac_irac_group": "FRAC M03",
             "dosage": "2.5 g/L", "phi_days": 3},
        ],
        "_safety": {
            "registry_version": "test",
            "blockers": [{"code": "banned_chemical",
                          "scope": "Monocrotophos 36 SL",
                          "detail": "central ban since 2020"}],
            "warnings": [],
        },
    }
    audit = build_compliance_audit(diagnosis=_diag(), treatment=treatment, params={})
    s = _statuses(audit)
    assert s["Banned / restricted chemicals"] == "FAILED"
    assert audit["summary"]["failed"] >= 1


def test_compliance_warning_for_unverified_active():
    treatment = {
        "chemical_controls": [
            {"product": "MysteryShield 50 EC", "frac_irac_group": "",
             "dosage": "1 g/L"},
        ],
        "_safety": {
            "registry_version": "test", "blockers": [],
            "warnings": [{"code": "unverified_active",
                          "scope": "MysteryShield 50 EC",
                          "detail": "not in registry slice"}],
        },
    }
    audit = build_compliance_audit(diagnosis=_diag(), treatment=treatment, params={})
    s = _statuses(audit)
    assert s["CIB&RC registration"] == "WARNING"


def test_compliance_na_when_no_chemicals():
    treatment = {
        "chemical_controls": [],
        "_safety": {"registry_version": "test", "blockers": [], "warnings": []},
    }
    audit = build_compliance_audit(diagnosis=_diag(), treatment=treatment, params={})
    s = _statuses(audit)
    assert s["Banned / restricted chemicals"] == "PASSED"  # vacuously true
    assert s["CIB&RC registration"] == "N/A"
    assert s["Pollinator safety"] == "N/A"


def test_compliance_pollinator_during_flowering_passes_when_no_bee_toxic():
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "frac_irac_group": "FRAC M03",
             "dosage": "2.5 g/L", "phi_days": 3},
        ],
        "_safety": {"registry_version": "test", "blockers": [], "warnings": []},
    }
    audit = build_compliance_audit(
        diagnosis=_diag(), treatment=treatment,
        params={"crop_growth_stage": "flowering"},
    )
    s = _statuses(audit)
    assert s["Pollinator safety"] == "PASSED"


def test_compliance_pollinator_failed_with_bee_toxic_block():
    treatment = {
        "chemical_controls": [],
        "_safety": {
            "registry_version": "test",
            "blockers": [{"code": "bee_toxic_during_bloom",
                          "scope": "Imidacloprid",
                          "detail": "bee-toxic active cannot be sprayed during flowering"}],
            "warnings": [],
        },
    }
    audit = build_compliance_audit(
        diagnosis=_diag(), treatment=treatment,
        params={"crop_growth_stage": "flowering"},
    )
    s = _statuses(audit)
    assert s["Pollinator safety"] == "FAILED"


def test_compliance_frac_rotation_warning_when_single_group():
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb A", "frac_irac_group": "FRAC M03",
             "dosage": "2.5 g/L", "phi_days": 3},
            {"product": "Mancozeb B", "frac_irac_group": "FRAC M03",
             "dosage": "2.5 g/L", "phi_days": 3},
        ],
        "_safety": {"registry_version": "test", "blockers": [], "warnings": []},
    }
    audit = build_compliance_audit(diagnosis=_diag(), treatment=treatment, params={})
    s = _statuses(audit)
    assert s["FRAC / IRAC rotation stewardship"] == "WARNING"


def test_compliance_summary_counts_match():
    treatment = {
        "chemical_controls": [
            {"product": "Mancozeb 75% WP", "frac_irac_group": "FRAC M03",
             "dosage": "2.5 g/L", "phi_days": 3},
        ],
        "_safety": {"registry_version": "test", "blockers": [], "warnings": []},
    }
    audit = build_compliance_audit(diagnosis=_diag(), treatment=treatment, params={})
    counts = audit["summary"]
    statuses = [c["status"] for c in audit["checks"]]
    assert counts["passed"]  == statuses.count("PASSED")
    assert counts["warning"] == statuses.count("WARNING")
    assert counts["failed"]  == statuses.count("FAILED")
    assert counts["na"]      == statuses.count("N/A")
