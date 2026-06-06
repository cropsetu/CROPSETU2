"""
Tests for the diagnose stage's NO-fallback / service-down policy.

Policy (by design): the diagnose stage runs a SINGLE model
(AI_CROP_DIAGNOSE_MODEL) with NO cross-model fallback — silently answering with
a weaker model when the primary is down degrades accuracy in a way that's hard
to detect and maintain. When the provider is unavailable we return a clear
`service_unavailable` result so the user is told to retry, NOT a lower-quality
guess.
"""
import asyncio
import os
import sys

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents import disease_diagnosis_agent as dda
from agents.llm_utils import empty_token_info

_VALID_JSON = (
    '{"primary_diagnosis":{"disease":"Late Blight",'
    '"scientific_name":"Phytophthora infestans","confidence":0.8,'
    '"severity":"Moderate","pathogen_type":"oomycete"},'
    '"confidence_score":0.8,"differentials":[]}'
)


class _Cfg:
    """Minimal stand-in for FeatureConfig so the test is independent of env keys."""
    api_key = "test-key"
    model = "gemini-2.5-pro"


def _run(monkeypatch, call_impl):
    monkeypatch.setattr(dda, "get_feature_config", lambda feature: _Cfg())
    monkeypatch.setattr(dda, "call_llm_vision", call_impl)
    iq = {"enhancement_notes": "degraded", "quality_score": 0.5, "usable": True}
    return asyncio.run(dda.run_disease_diagnosis_agent(
        images=[], image_quality=iq, weather_risk={},
        params={"crop_name": "Potato", "tier": "best"},
    ))


def test_provider_down_returns_service_unavailable_not_a_fallback(monkeypatch):
    """A 503 'high demand' must yield a clear service_unavailable result —
    NOT a different (weaker) model's guess, and NOT a misleading 'Unknown'."""
    async def _boom(cfg, **kw):
        req = httpx.Request("POST", "https://example/generateContent")
        resp = httpx.Response(503, request=req, text="high demand")
        raise httpx.HTTPStatusError("503 high demand", request=req, response=resp)

    result, tok = _run(monkeypatch, _boom)
    assert result.get("service_unavailable") is True
    assert result["primary_diagnosis"]["disease"] == "SERVICE_UNAVAILABLE"
    assert result["needs_advisor"] is True


def test_provider_ok_returns_real_diagnosis(monkeypatch):
    """When the single model responds, we get a normal diagnosis (no service flag)."""
    async def _ok(cfg, **kw):
        return _VALID_JSON, empty_token_info(cfg.model)

    result, tok = _run(monkeypatch, _ok)
    assert not result.get("service_unavailable")
    assert result["primary_diagnosis"]["disease"] == "Late Blight"
    assert tok["model"] == "gemini-2.5-pro"
