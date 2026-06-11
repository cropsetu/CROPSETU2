"""
Tests for agents/registry.py and agents/router.py — the LLM tier toggle
+ chain resolution + fallback dispatch logic. CropSetu is Gemini-only.
"""
import asyncio
import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Ensure the Gemini key is "set" so the catalog doesn't filter everything out at
# import time. We never actually call out — the tests stub the runner.
os.environ.setdefault("GEMINI_API_KEY", "test")

# Force the modules to re-read env (they may have loaded earlier under
# pytest with missing keys).
import config
import importlib
importlib.reload(config)
from agents import registry as registry_mod
importlib.reload(registry_mod)
from agents import router as router_mod
importlib.reload(router_mod)

from agents.registry import normalize_tier, resolve_chain
from agents.router  import _is_transient, _run_chain


# ── normalize_tier ──────────────────────────────────────────────────────────

def test_normalize_tier_default_fast():
    assert normalize_tier(None) == "fast"
    assert normalize_tier("") == "fast"
    assert normalize_tier("fast") == "fast"
    assert normalize_tier("FAST") == "fast"
    assert normalize_tier("garbage") == "fast"


def test_normalize_tier_best_aliases():
    assert normalize_tier("best") == "best"
    assert normalize_tier("BEST") == "best"
    assert normalize_tier("quality") == "best"
    assert normalize_tier("premium") == "best"
    assert normalize_tier("high") == "best"


# ── resolve_chain ───────────────────────────────────────────────────────────

def test_resolve_chain_diagnose_fast_includes_vision_model():
    chain = resolve_chain("diagnose", "fast")
    assert len(chain) > 0
    # All chain members for diagnose must support vision
    from agents.registry import MODEL_CATALOG
    for m in chain:
        assert "vision" in MODEL_CATALOG[m]["capabilities"]


def test_resolve_chain_diagnose_best_is_vision_capable():
    from agents.registry import MODEL_CATALOG
    chain = resolve_chain("diagnose", "best")
    assert len(chain) > 0
    for m in chain:
        assert "vision" in MODEL_CATALOG[m]["capabilities"], f"{m} missing vision"


def test_primary_chains_are_gemini_only():
    # Every PRIMARY chain stays Gemini-only post-consolidation. The ENSEMBLE is
    # the one stage allowed a cross-vendor voter (OpenAI) — covered separately.
    for stage in ("diagnose", "treatment", "chat", "alert"):
        for tier in ("fast", "best"):
            for m in resolve_chain(stage, tier):
                assert m.startswith("gemini-"), f"{stage}/{tier} has non-gemini model {m}"


# ── OpenAI ensemble voter (cross-vendor) ────────────────────────────────────

def _openai_model_id():
    """The single OpenAI catalog id (override-robust — honours OPENAI_DIAGNOSE_MODEL)."""
    from agents.registry import MODEL_CATALOG, provider_of
    ids = [m for m in MODEL_CATALOG if provider_of(m) == "openai"]
    assert len(ids) == 1, f"expected exactly one OpenAI catalog entry, got {ids}"
    return ids[0]


def test_openai_provider_registered():
    from agents.registry import provider_of
    assert provider_of(_openai_model_id()) == "openai"


def test_ensemble_includes_openai_voter_when_keyed(monkeypatch):
    from agents.registry import MODEL_CATALOG
    oid = _openai_model_id()
    monkeypatch.setitem(MODEL_CATALOG[oid], "api_key", "sk-test")
    chain = resolve_chain("ensemble", "best")
    assert oid in chain, "OpenAI voter should join the ensemble when its key is set"
    assert any(m.startswith("gemini-") for m in chain), "Gemini voters stay alongside it"


def test_ensemble_drops_openai_voter_without_key(monkeypatch):
    # No key → the cross-vendor voter is silently dropped; pipeline stays Gemini.
    from agents.registry import MODEL_CATALOG
    oid = _openai_model_id()
    monkeypatch.setitem(MODEL_CATALOG[oid], "api_key", "")
    chain = resolve_chain("ensemble", "best")
    assert oid not in chain
    assert chain and all(m.startswith("gemini-") for m in chain)


def test_resolve_chain_treatment_does_not_require_vision():
    chain = resolve_chain("treatment", "fast")
    assert len(chain) > 0
    from agents.registry import MODEL_CATALOG
    for m in chain:
        caps = MODEL_CATALOG[m]["capabilities"]
        assert "json" in caps, f"{m} cannot emit structured JSON"


def test_resolve_chain_report_is_empty():
    # Report is template-only — chain is intentionally empty
    assert resolve_chain("report", "fast") == []
    assert resolve_chain("report", "best") == []


def test_resolve_chain_env_override(monkeypatch):
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-pro,gemini-2.5-flash")
    chain = resolve_chain("diagnose", "fast")
    assert chain[0] == "gemini-2.5-pro"
    assert chain[1] == "gemini-2.5-flash"


def test_resolve_chain_filters_unknown_models(monkeypatch):
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "imaginary-model,gemini-2.5-flash")
    chain = resolve_chain("diagnose", "fast")
    assert "imaginary-model" not in chain
    assert "gemini-2.5-flash" in chain


def test_resolve_chain_filters_missing_keys(monkeypatch):
    # If a model's API key is empty, it must be silently dropped. We mutate the
    # catalog entry directly (monkeypatch restores it) rather than reloading the
    # module, so we don't clobber the shared Gemini key for other tests.
    from agents.registry import MODEL_CATALOG
    monkeypatch.setenv("DIAGNOSE_BEST_CHAIN", "gemini-2.5-pro,gemini-2.5-flash")
    monkeypatch.setitem(MODEL_CATALOG["gemini-2.5-pro"], "api_key", "")
    chain = resolve_chain("diagnose", "best")
    assert "gemini-2.5-pro" not in chain      # dropped — no key
    assert "gemini-2.5-flash" in chain         # survives


# ── _is_transient ───────────────────────────────────────────────────────────

def test_transient_timeout_classified():
    assert _is_transient(asyncio.TimeoutError()) is True


def test_transient_429_classified():
    class FakeStatusError(Exception):
        def __init__(self, code):
            self.status_code = code
    assert _is_transient(FakeStatusError(429)) is True
    assert _is_transient(FakeStatusError(503)) is True
    assert _is_transient(FakeStatusError(504)) is True


def test_transient_400_is_not_transient():
    class FakeStatusError(Exception):
        def __init__(self, code):
            self.status_code = code
    assert _is_transient(FakeStatusError(400)) is False
    assert _is_transient(FakeStatusError(403)) is False
    assert _is_transient(ValueError("bad payload")) is False


def test_transient_rate_limit_message_detected():
    assert _is_transient(RuntimeError("Gemini rate-limited after 3 retries")) is True


# ── _run_chain — fallback behaviour (Gemini Pro → Flash) ────────────────────

class _BoomTransient(Exception):
    """Mimics a 429 — has status_code attribute."""
    def __init__(self):
        self.status_code = 429


def test_run_chain_falls_back_on_transient(monkeypatch):
    # Force a deterministic 2-model Gemini chain
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-pro,gemini-2.5-flash")

    calls = []

    async def fake_runner(model_id):
        calls.append(model_id)
        if len(calls) == 1:
            raise _BoomTransient()
        return ("ok-text", {"input_tokens": 5, "output_tokens": 10,
                            "total_tokens": 15, "cost_usd": 0.001, "model": model_id})

    text, tok, model = asyncio.run(router_mod._run_chain(
        stage="diagnose", tier="fast", runner=fake_runner,
    ))
    assert text == "ok-text"
    assert model == "gemini-2.5-flash"
    assert len(calls) == 2
    assert tok["total_tokens"] == 15


def test_run_chain_reraises_after_full_exhaustion(monkeypatch):
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-pro,gemini-2.5-flash")

    async def all_fail(model_id):
        raise _BoomTransient()

    with pytest.raises(Exception) as exc_info:
        asyncio.run(router_mod._run_chain(
            stage="diagnose", tier="fast", runner=all_fail,
        ))
    assert hasattr(exc_info.value, "status_code")
    assert exc_info.value.status_code == 429


def test_run_chain_does_not_fallback_on_permanent_error(monkeypatch):
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-pro,gemini-2.5-flash")

    calls = []
    async def fail(model_id):
        calls.append(model_id)
        raise ValueError("permanent — bad request shape")

    with pytest.raises(ValueError):
        asyncio.run(router_mod._run_chain(
            stage="diagnose", tier="fast", runner=fail,
        ))
    # Permanent error → only the FIRST model was attempted, no fallback walk
    assert len(calls) == 1


def test_run_chain_empty_response_triggers_fallback(monkeypatch):
    """A model returning '' should be treated as failure, not silently accepted."""
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-pro,gemini-2.5-flash")

    calls = []
    async def runner(model_id):
        calls.append(model_id)
        if model_id == "gemini-2.5-pro":
            return ("", {"input_tokens": 0, "output_tokens": 0,
                         "total_tokens": 0, "cost_usd": 0, "model": model_id})
        return ("ok", {"input_tokens": 5, "output_tokens": 10,
                       "total_tokens": 15, "cost_usd": 0.001, "model": model_id})

    text, tok, model = asyncio.run(router_mod._run_chain(
        stage="diagnose", tier="fast", runner=runner,
    ))
    assert text == "ok"
    assert model == "gemini-2.5-flash"
    assert len(calls) == 2
