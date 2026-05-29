"""
Unit tests for the local_blocks enrichment in report_generator_agent.py.

Verifies:
  - Maharashtra farmer with no explicit language → target=mr, blocks present
  - Explicit language param wins over state-derived language
  - English target (or no state) → blocks={}, but language field set
  - Sarvam failure → blocks={} and language still recorded
  - Source blocks pull from the report's existing structured fields
"""
import asyncio
import sys
import os
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents import report_generator_agent as rga


def _minimal_report() -> dict:
    """Skeleton of the keys _build_english_local_blocks reads from."""
    return {
        "disease": {"name_common": "Downy Mildew", "severity": "moderate"},
        "confidence_score": 0.87,
        "treatment": {
            "chemical": [{"active_ingredient": "Metalaxyl + Mancozeb", "dose": "2.5 g/L"}],
            "spray_timing": "Spray before 9 AM",
        },
        "action_card": {
            "top_3_actions": ["Remove infected leaves immediately"],
            "follow_up_days": 7,
        },
        "next_steps": ["Remove infected leaves immediately"],
        "meta": {"needs_advisor": False},
        "weather_outlook": {"risk": "HIGH"},
    }


def test_build_english_blocks_pulls_from_structured_fields():
    report = _minimal_report()
    blocks = rga._build_english_local_blocks(report, {"crop_name": "grape"})

    assert set(blocks.keys()) == {"summary", "diagnosis", "treatment", "prognosis", "follow_up"}
    assert "Downy Mildew" in blocks["summary"]
    assert "grape" in blocks["summary"]
    assert "87%" in blocks["summary"]
    assert "Metalaxyl + Mancozeb" in blocks["treatment"]
    assert "2.5 g/L" in blocks["treatment"]
    assert "7 days" in blocks["follow_up"]
    # HIGH risk should trigger the disease-favourable warning
    assert "disease-favourable" in blocks["prognosis"]


def test_advisor_needed_changes_diagnosis_message():
    report = _minimal_report()
    report["meta"]["needs_advisor"] = True
    blocks = rga._build_english_local_blocks(report, {"crop_name": "tomato"})
    assert "KVK" in blocks["diagnosis"] or "agronomist" in blocks["diagnosis"]


def test_attach_local_blocks_uses_state_when_no_explicit_language():
    report = _minimal_report()
    fake_translated = {k: f"<mr:{k}>" for k in ("summary", "diagnosis", "treatment", "prognosis", "follow_up")}

    with patch.object(rga, "translate_blocks", new=AsyncMock(return_value=fake_translated)):
        asyncio.run(rga._attach_local_blocks(report, {"state": "Maharashtra", "crop_name": "grape"}))

    lb = report["local_blocks"]
    assert lb["language"] == "mr"
    assert lb["language_name"] == "मराठी"
    assert set(lb["blocks"].keys()) == {"summary", "diagnosis", "treatment", "prognosis", "follow_up"}
    assert lb["blocks"]["summary"] == "<mr:summary>"


def test_attach_local_blocks_explicit_language_wins():
    report = _minimal_report()
    fake_translated = {k: f"<hi:{k}>" for k in ("summary", "diagnosis", "treatment", "prognosis", "follow_up")}

    with patch.object(rga, "translate_blocks", new=AsyncMock(return_value=fake_translated)):
        # State says Maharashtra (→ mr) but explicit language is Hindi
        asyncio.run(rga._attach_local_blocks(
            report, {"state": "Maharashtra", "language": "hi", "crop_name": "grape"}))

    assert report["local_blocks"]["language"] == "hi"
    assert report["local_blocks"]["language_name"] == "हिन्दी"


def test_attach_local_blocks_english_target_skips_translation():
    report = _minimal_report()
    mock = AsyncMock()

    with patch.object(rga, "translate_blocks", new=mock):
        asyncio.run(rga._attach_local_blocks(report, {"crop_name": "grape"}))  # no state, no lang

    assert report["local_blocks"]["language"] == "en"
    assert report["local_blocks"]["blocks"] == {}
    mock.assert_not_awaited()


def test_attach_local_blocks_unsupported_language_skips_translation():
    report = _minimal_report()
    mock = AsyncMock()

    with patch.object(rga, "translate_blocks", new=mock):
        # Assam farmer — Assamese is not on Sarvam's list, so skip
        asyncio.run(rga._attach_local_blocks(report, {"state": "Assam", "crop_name": "rice"}))

    assert report["local_blocks"]["language"] == "as"
    assert report["local_blocks"]["blocks"] == {}
    mock.assert_not_awaited()


def test_attach_local_blocks_sarvam_failure_yields_empty_blocks():
    report = _minimal_report()
    # Translator returns originals for every key (this is what sarvam_translator
    # does on failure). The attach helper should detect this and emit blocks={}.

    async def _passthrough(blocks, target_lang, **kwargs):
        return dict(blocks)

    with patch.object(rga, "translate_blocks", new=_passthrough):
        asyncio.run(rga._attach_local_blocks(report, {"state": "Maharashtra", "crop_name": "grape"}))

    lb = report["local_blocks"]
    assert lb["language"] == "mr", "language is still recorded even when translation failed"
    assert lb["blocks"] == {}, "untranslated blocks should be dropped so frontend hides the strip"
