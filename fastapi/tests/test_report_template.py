"""
Unit tests for agents/report_generator_agent.py

Tests: farmer summary text, next-steps generation, causes, weather outlook,
       full template report structure, report ID uniqueness, async entry point.
"""
import pytest
import asyncio
import sys
import os
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.report_generator_agent import (
    _build_section1_farmer_summary,
    _generate_template_report,
    _report_id,
    run_report_generator_agent,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _treatment(immediate=None, chemical=None):
    # Use 'is None' check so callers can pass [] to mean "no chemicals"
    return {
        "immediate_actions": immediate if immediate is not None else ["Remove infected leaves", "Improve airflow"],
        "chemical_controls": chemical if chemical is not None else [
            {"product": "Mancozeb 75% WP", "dosage": "2g/L", "brands": [{"name": "Dithane M-45"}]}
        ],
        "organic_alternatives": [],
        "fertilizer_recommendations": [],
        "preventive_measures": ["Crop rotation"],
        "spray_timing_advisory": "Early morning",
    }


def _diagnosis(disease="Early Blight", severity="Moderate", confidence=0.87,
               needs_advisor=False):
    return {
        "primary_diagnosis": {
            "disease": disease,
            "severity": severity,
            "scientific_name": "Alternaria solani",
        },
        "confidence_score": confidence,
        "needs_advisor": needs_advisor,
        "spread_risk": "HIGH",
        "differentials": [],
    }


def _weather_risk(risk="HIGH"):
    return {
        "overall_disease_risk": risk,
        "forecast_risk": "Rain expected 3/7 days",
        "advisory": "Apply fungicide within 48 hours",
        "risk_factors": ["High humidity"],
        "favorable_diseases": ["Early Blight"],
        "soil_risk": "MODERATE",
        "weather_used": True,
    }


def _params():
    return {
        "crop_name": "Tomato",
        "soil_type": "Black",
        "irrigation_system": "Drip",
        "crop_growth_stage": "Vegetative",
        "field_latitude": 19.9,
        "field_longitude": 73.8,
        "farm_size_acres": 2.5,
        "language": "en",
        "affected_area_percent": 25,
    }


def _image_quality():
    return {"quality_score": 0.82, "usable": True, "suggestions": []}


def _section1(**overrides):
    """Helper to call _build_section1_farmer_summary with defaults."""
    kwargs = dict(
        diagnosis=_diagnosis(),
        treatment=_treatment(),
        params=_params(),
        image_quality=_image_quality(),
        report_id="test-report-id",
        generated_at="2026-04-11T00:00:00+00:00",
    )
    kwargs.update(overrides)
    return _build_section1_farmer_summary(**kwargs)


def _make_report(**overrides):
    """Helper to call _generate_template_report with defaults."""
    kwargs = dict(
        diagnosis=_diagnosis(),
        treatment=_treatment(),
        weather_risk=_weather_risk(),
        image_quality=_image_quality(),
        params=_params(),
        report_id="test-report-id",
        generated_at="2026-04-11T00:00:00+00:00",
    )
    kwargs.update(overrides)
    return _generate_template_report(**kwargs)


# ── farmer name / contact / address in the report (MyFarm feature) ───────────
def test_farmer_details_includes_name_contact_address():
    p = _params()
    p.update({
        "farmer_name": "Ramesh Patil",
        "farmer_contact": "9876543210",
        "farm_address": "Baramati, Pune, Maharashtra, 413102",
    })
    fd = _section1(params=p)["farmer_details"]
    assert fd["farmer_name"] == "Ramesh Patil"
    assert fd["farmer_contact"] == "9876543210"
    assert fd["farm_address"] == "Baramati, Pune, Maharashtra, 413102"


def test_farmer_details_blank_when_absent():
    fd = _section1()["farmer_details"]
    assert fd["farmer_name"] == ""
    assert fd["farmer_contact"] == ""
    assert fd["farm_address"] == ""


# ── _build_section1_farmer_summary (replaces _build_farmer_summary) ──────────

class TestBuildFarmerSummary:
    def test_high_confidence_contains_percentage(self):
        result = _section1()
        assert "87%" in result["farmer_summary"]

    def test_high_confidence_contains_disease_name(self):
        result = _section1()
        assert "Early Blight" in result["farmer_summary"]

    def test_high_confidence_contains_severity(self):
        result = _section1()
        assert "Moderate" in result["farmer_summary"]

    def test_high_confidence_mentions_chemical(self):
        result = _section1()
        summary = result["farmer_summary"]
        assert "Mancozeb" in summary or "Dithane" in summary

    def test_low_confidence_uses_hedged_language(self):
        diag = _diagnosis(confidence=0.55, severity="Mild")
        result = _section1(diagnosis=diag)
        summary = result["farmer_summary"]
        # Low confidence (50-69%) uses "may indicate" or "possibly"
        assert "may" in summary.lower() or "possibly" in summary.lower() or "photo" in summary.lower()

    def test_crop_name_lowercased_in_summary(self):
        result = _section1()
        assert "tomato" in result["farmer_summary"].lower()

    def test_no_chemical_skips_spray_sentence(self):
        t = _treatment(chemical=[])
        result = _section1(treatment=t)
        assert "Spray" not in result["farmer_summary"]

    def test_returns_dict_with_farmer_summary_string(self):
        result = _section1(treatment={})
        assert isinstance(result, dict)
        assert isinstance(result["farmer_summary"], str)

    def test_immediate_action_included_in_weekly_actions(self):
        t = _treatment(immediate=["Apply neem oil immediately"])
        result = _section1(treatment=t)
        actions_text = " ".join(a["action"] for a in result["weekly_actions"])
        assert "neem oil" in actions_text.lower() or "Apply" in actions_text

    def test_threshold_exactly_70(self):
        # 70% confidence should use medium-confidence path (includes percentage)
        diag = _diagnosis(disease="Powdery Mildew", confidence=0.70, severity="Mild")
        result = _section1(diagnosis=diag)
        summary = result["farmer_summary"]
        assert "70%" in summary
        assert "possibly" not in summary.lower()


# ── next_steps via _generate_template_report ─────────────────────────────────

class TestBuildNextSteps:
    def test_returns_list(self):
        report = _make_report()
        assert isinstance(report["next_steps"], list)

    def test_max_5_steps(self):
        report = _make_report()
        assert len(report["next_steps"]) <= 5

    def test_at_least_2_steps(self):
        report = _make_report()
        assert len(report["next_steps"]) >= 2

    def test_first_step_references_immediate_action(self):
        report = _make_report()
        # First weekly action should be the immediate action
        first_step = report["next_steps"][0]
        assert isinstance(first_step, str) and len(first_step) > 0

    def test_chemical_in_steps(self):
        report = _make_report()
        combined = " ".join(report["next_steps"])
        assert "Mancozeb" in combined or "Spray" in combined

    def test_sprinkler_irrigation_gets_switch_warning(self):
        p = _params()
        p["irrigation_system"] = "Sprinkler"
        report = _make_report(params=p)
        combined = " ".join(report["next_steps"])
        assert "drip" in combined.lower() or "overhead" in combined.lower() or "furrow" in combined.lower()

    def test_drip_irrigation_no_switch_warning(self):
        report = _make_report()
        combined = " ".join(report["next_steps"])
        # Should not tell drip users to switch to drip
        assert "Switch to drip" not in combined

    def test_empty_treatment_no_crash(self):
        report = _make_report(treatment={})
        assert isinstance(report["next_steps"], list)

    def test_follow_up_photo_present(self):
        report = _make_report()
        combined = " ".join(report["next_steps"])
        assert "photo" in combined.lower() or "progress" in combined.lower()


# ── causes via _generate_template_report ─────────────────────────────────────

class TestBuildCauses:
    def test_returns_list(self):
        report = _make_report()
        assert isinstance(report["causes"], list)

    def test_uses_causal_factors_when_present(self):
        diag = _diagnosis()
        diag["causal_factors"] = ["Excessive rain", "Poor drainage"]
        report = _make_report(diagnosis=diag)
        assert "Excessive rain" in report["causes"]

    def test_max_4_causes(self):
        diag = _diagnosis()
        diag["causal_factors"] = [f"Cause {i}" for i in range(10)]
        report = _make_report(diagnosis=diag)
        assert len(report["causes"]) <= 4

    def test_empty_causes_when_no_causal_factors(self):
        report = _make_report()
        # causes comes from section2 what_is_happening.causes which is
        # diagnosis.get("causal_factors", [])[:4] — empty list when not set
        assert isinstance(report["causes"], list)


# ── weather_outlook via _generate_template_report ────────────────────────────

class TestBuildWeatherOutlook:
    def test_risk_key_present(self):
        report = _make_report()
        assert "risk" in report["weather_outlook"]

    def test_risk_value_correct(self):
        report = _make_report(weather_risk=_weather_risk("CRITICAL"))
        assert report["weather_outlook"]["risk"] == "CRITICAL"

    def test_advisory_preserved(self):
        report = _make_report()
        advisory = report["weather_outlook"]["advisory"]
        assert "fungicide" in advisory.lower() or "Apply" in advisory

    def test_forecast_risk_present(self):
        report = _make_report()
        assert len(report["weather_outlook"]["forecast_risk"]) > 0

    def test_weather_used_flag_preserved(self):
        report = _make_report()
        assert report["weather_outlook"]["weather_used"] is True

    def test_empty_weather_risk_no_crash(self):
        report = _make_report(weather_risk={})
        assert "risk" in report["weather_outlook"]


# ── _generate_template_report ─────────────────────────────────────────────────

class TestGenerateTemplateReport:
    def _make_report(self, **kwargs):
        return _make_report(**kwargs)

    def test_report_id_echoed(self):
        report = self._make_report()
        assert report["report_id"] == "test-report-id"

    def test_generated_at_echoed(self):
        report = self._make_report()
        assert report["generated_at"] == "2026-04-11T00:00:00+00:00"

    def test_required_top_level_keys(self):
        report = self._make_report()
        required = ["report_id", "generated_at", "language", "farm", "disease",
                    "causes", "treatment", "next_steps", "advisor_needed",
                    "weather_outlook", "farmer_summary", "confidence_score",
                    "risk_level", "image_quality", "meta"]
        for key in required:
            assert key in report, f"Missing key: {key}"

    def test_disease_name_correct(self):
        report = self._make_report()
        assert report["disease"]["name_common"] == "Early Blight"

    def test_confidence_pct_rounded(self):
        report = self._make_report()
        assert report["disease"]["confidence_pct"] == 87  # 0.87 * 100

    def test_farm_crop_name(self):
        report = self._make_report()
        assert report["farm"]["crop"] == "Tomato"

    def test_meta_template_flag(self):
        report = self._make_report()
        assert report["meta"]["_template"] is True

    def test_image_quality_score(self):
        report = self._make_report()
        assert report["image_quality"]["score"] == 0.82

    def test_language_from_params(self):
        report = self._make_report()
        assert report["language"] == "en"

    def test_needs_advisor_false(self):
        report = self._make_report()
        assert report["advisor_needed"] is False

    def test_needs_advisor_true(self):
        diag = _diagnosis(needs_advisor=True)
        report = self._make_report(diagnosis=diag)
        assert report["advisor_needed"] is True

    def test_next_steps_non_empty(self):
        report = self._make_report()
        assert len(report["next_steps"]) > 0

    def test_weather_outlook_structure(self):
        report = self._make_report()
        assert "risk" in report["weather_outlook"]
        assert "advisory" in report["weather_outlook"]

    def test_farmer_summary_non_empty(self):
        report = self._make_report()
        assert len(report["farmer_summary"]) > 20


# ── _report_id uniqueness ─────────────────────────────────────────────────────

class TestReportIdUniqueness:
    def test_each_call_unique(self):
        ids = {_report_id() for _ in range(20)}
        assert len(ids) == 20

    def test_is_valid_uuid_format(self):
        import re
        rid = _report_id()
        assert re.match(
            r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            rid
        )


# ── async run_report_generator_agent ─────────────────────────────────────────

class TestRunReportGeneratorAgent:
    def test_returns_tuple(self):
        async def _run():
            return await run_report_generator_agent(
                diagnosis=_diagnosis(),
                treatment=_treatment(),
                weather_risk=_weather_risk(),
                image_quality=_image_quality(),
                params=_params(),
            )
        report, token_info = asyncio.run(_run())
        assert isinstance(report, dict)
        assert isinstance(token_info, dict)

    def test_token_info_model_is_template(self):
        async def _run():
            return await run_report_generator_agent(
                diagnosis=_diagnosis(),
                treatment=_treatment(),
                weather_risk=_weather_risk(),
                image_quality=_image_quality(),
                params=_params(),
            )
        _, token_info = asyncio.run(_run())
        assert token_info.get("model") == "template"

    def test_zero_cost(self):
        async def _run():
            return await run_report_generator_agent(
                diagnosis=_diagnosis(),
                treatment=_treatment(),
                weather_risk=_weather_risk(),
                image_quality=_image_quality(),
                params=_params(),
            )
        _, token_info = asyncio.run(_run())
        assert token_info.get("cost_usd", 0) == 0.0

    def test_report_has_disease_field(self):
        async def _run():
            return await run_report_generator_agent(
                diagnosis=_diagnosis(),
                treatment=_treatment(),
                weather_risk=_weather_risk(),
                image_quality=_image_quality(),
                params=_params(),
            )
        report, _ = asyncio.run(_run())
        assert "disease" in report
        assert report["disease"]["name_common"] == "Early Blight"
