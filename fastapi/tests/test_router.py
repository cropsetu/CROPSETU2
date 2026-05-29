"""
Tests for agents/registry.py and agents/router.py — the LLM tier toggle
+ chain resolution + fallback dispatch logic.
"""
import asyncio
import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Ensure at least one API key is "set" so the catalog doesn't filter
# everything out at import time. We never actually call out — the tests
# stub the runner.
os.environ.setdefault("GEMINI_API_KEY", "test")
os.environ.setdefault("GROQ_API_KEY",   "test")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

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
    # The Best chain's exact composition depends on operator key + quota
    # availability (Pro requires paid Gemini billing; Sonnet 4.6 is too slow
    # for the mobile timeout). What MUST hold: every model in the diagnose
    # chain supports vision.
    from agents.registry import MODEL_CATALOG
    chain = resolve_chain("diagnose", "best")
    assert len(chain) > 0
    for m in chain:
        assert "vision" in MODEL_CATALOG[m]["capabilities"], f"{m} missing vision"


def test_resolve_chain_treatment_does_not_require_vision():
    chain = resolve_chain("treatment", "fast")
    assert len(chain) > 0
    # Treatment doesn't require vision — any text-or-vision model is fine.
    # Operator key state can swap Groq llama in/out of the chain (see registry
    # comment); what matters is the chain has at least one usable model.
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
    # If a model's API key is empty, it must be silently dropped.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    importlib.reload(config)
    importlib.reload(registry_mod)
    chain = registry_mod.resolve_chain("diagnose", "best")
    # Claude entries should be absent now
    assert "claude-sonnet-4-6" not in chain
    # But gemini ones survive
    assert any(m.startswith("gemini") for m in chain)


# ── _is_transient ───────────────────────────────────────────────────────────

def test_transient_timeout_classified():
    assert _is_transient(asyncio.TimeoutError()) is True


def test_transient_429_classified():
    # httpx.HTTPStatusError requires Request/Response args — easier to
    # construct a fake with the expected status_code attribute.
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


# ── _run_chain — fallback behaviour ─────────────────────────────────────────

class _BoomTransient(Exception):
    """Mimics a 429 — has status_code attribute."""
    def __init__(self):
        self.status_code = 429


def test_run_chain_falls_back_on_transient(monkeypatch):
    # Force a deterministic 2-model chain
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-flash,claude-sonnet-4-6")
    importlib.reload(config)
    importlib.reload(registry_mod)
    importlib.reload(router_mod)

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
    assert model == "claude-sonnet-4-6"
    assert len(calls) == 2
    assert tok["total_tokens"] == 15


def test_run_chain_reraises_after_full_exhaustion(monkeypatch):
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-flash,claude-sonnet-4-6")
    importlib.reload(config)
    importlib.reload(registry_mod)
    importlib.reload(router_mod)

    async def all_fail(model_id):
        raise _BoomTransient()

    with pytest.raises(Exception) as exc_info:
        asyncio.run(router_mod._run_chain(
            stage="diagnose", tier="fast", runner=all_fail,
        ))
    assert hasattr(exc_info.value, "status_code")
    assert exc_info.value.status_code == 429


def test_run_chain_does_not_fallback_on_permanent_error(monkeypatch):
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-flash,claude-sonnet-4-6")
    importlib.reload(config)
    importlib.reload(registry_mod)
    importlib.reload(router_mod)

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
    monkeypatch.setenv("DIAGNOSE_FAST_CHAIN", "gemini-2.5-flash,claude-sonnet-4-6")
    importlib.reload(config)
    importlib.reload(registry_mod)
    importlib.reload(router_mod)

    calls = []
    async def runner(model_id):
        calls.append(model_id)
        if model_id == "gemini-2.5-flash":
            return ("", {"input_tokens": 0, "output_tokens": 0,
                         "total_tokens": 0, "cost_usd": 0, "model": model_id})
        return ("ok", {"input_tokens": 5, "output_tokens": 10,
                       "total_tokens": 15, "cost_usd": 0.001, "model": model_id})

    text, tok, model = asyncio.run(router_mod._run_chain(
        stage="diagnose", tier="fast", runner=runner,
    ))
    assert text == "ok"
    assert model == "claude-sonnet-4-6"
    assert len(calls) == 2
