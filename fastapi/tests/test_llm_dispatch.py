"""
Unit tests for agents/llm_dispatch.py — the flat per-feature LLM config.

CropSetu is Gemini-only. Covers:
  - _detect_provider accepts gemini-* and rejects everything else
  - get_feature_config reads AI_<FEATURE>_* env vars correctly
  - defaults (all Gemini) are used when env vars are unset
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from agents.llm_dispatch import (
    AI_FEATURES,
    ConfigError,
    FeatureConfig,
    _detect_provider,
    _groq_fallback,
    get_feature_config,
)


# ── Provider detection (Gemini-only) ─────────────────────────────────────────

class TestDetectProvider:
    def test_gemini_prefix_routes_to_gemini(self):
        assert _detect_provider("gemini-2.5-flash", None) == "gemini"
        assert _detect_provider("gemini-2.5-pro", None) == "gemini"

    def test_case_insensitive(self):
        assert _detect_provider("Gemini-2.5-Flash", None) == "gemini"

    def test_non_gemini_models_raise(self):
        for bad in ("claude-haiku-4-5-20251001", "gpt-4o", "llama-3.3-70b-versatile",
                    "deepseek-chat", "grok-2", "whisper-large-v3-turbo", "", "foo-mystery"):
            with pytest.raises(ConfigError):
                _detect_provider(bad, None)


# ── Feature-config loader ────────────────────────────────────────────────────

class TestGetFeatureConfig:
    @pytest.fixture(autouse=True)
    def _clean_env(self, monkeypatch):
        # Clear the relevant env vars so tests start from a known state.
        for feat in AI_FEATURES:
            for suffix in ("_MODEL", "_API_KEY", "_BASE_URL"):
                monkeypatch.delenv(f"AI_{feat}{suffix}", raising=False)

    def test_falls_back_to_gemini_defaults_when_env_unset(self):
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.feature == "TEXT_CHAT"
        assert cfg.model == "gemini-2.5-flash"  # baked-in default
        assert cfg.base_url is None
        assert cfg.provider == "gemini"
        # api_key defaults to GEMINI_API_KEY (may be empty in test env).
        assert isinstance(cfg.api_key, str)

    def test_env_vars_override_defaults(self, monkeypatch):
        monkeypatch.setenv("AI_TEXT_CHAT_MODEL", "gemini-2.5-pro")
        monkeypatch.setenv("AI_TEXT_CHAT_API_KEY", "test-key-12345")
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.model == "gemini-2.5-pro"
        assert cfg.api_key == "test-key-12345"
        assert cfg.provider == "gemini"

    def test_non_gemini_model_is_rejected_by_provider(self, monkeypatch):
        # A stray non-Gemini model id loads but fails fast when its provider is
        # resolved, rather than silently calling an unsupported endpoint.
        monkeypatch.setenv("AI_TEXT_CHAT_MODEL", "claude-sonnet-4-6")
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.model == "claude-sonnet-4-6"
        with pytest.raises(ConfigError):
            _ = cfg.provider

    def test_unknown_feature_raises(self):
        with pytest.raises(ValueError, match="Unknown AI feature"):
            get_feature_config("FAKE_FEATURE")

    def test_all_canonical_features_resolve(self, monkeypatch):
        # Every entry in AI_FEATURES should be loadable and Gemini-routed.
        for feat in AI_FEATURES:
            monkeypatch.setenv(f"AI_{feat}_MODEL", "gemini-2.5-flash")
            monkeypatch.setenv(f"AI_{feat}_API_KEY", "test-key")
        for feat in AI_FEATURES:
            cfg = get_feature_config(feat)
            assert isinstance(cfg, FeatureConfig)
            assert cfg.feature == feat
            assert cfg.model == "gemini-2.5-flash"
            assert cfg.provider == "gemini"

    def test_empty_string_env_treated_as_unset(self, monkeypatch):
        # Common ops mistake: AI_TEXT_CHAT_MODEL=  (trailing equals, no value).
        # Should fall back to the Gemini default, not an empty model name.
        monkeypatch.setenv("AI_TEXT_CHAT_MODEL", "")
        monkeypatch.setenv("AI_TEXT_CHAT_API_KEY", "")
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.model == "gemini-2.5-flash"


# ── Cross-provider Groq chat fallback ─────────────────────────────────────────

class TestGroqFallback:
    @pytest.fixture(autouse=True)
    def _clean_env(self, monkeypatch):
        # _groq_fallback reads GROQ_API_KEY at import time (module constant) AND
        # the per-feature AI_<F>_GROQ_* overrides live. Clear them all so each
        # test starts from a known state.
        for var in ("GROQ_API_KEY",):
            monkeypatch.delenv(var, raising=False)
        for feat in AI_FEATURES:
            for suffix in ("_GROQ_FALLBACK", "_GROQ_MODEL", "_GROQ_API_KEY"):
                monkeypatch.delenv(f"AI_{feat}{suffix}", raising=False)
        # _groq_fallback closes over the GROQ_API_KEY constant captured at import.
        # Patch it on the module so the per-test key is honoured.
        import agents.llm_dispatch as d
        monkeypatch.setattr(d, "GROQ_API_KEY", "", raising=False)

    def test_disabled_without_key(self, monkeypatch):
        # No GROQ_API_KEY → fallback off even for a chat feature.
        assert _groq_fallback("CHAT_WRITER") is None

    def test_enabled_for_chat_features_when_key_set(self, monkeypatch):
        import agents.llm_dispatch as d
        monkeypatch.setattr(d, "GROQ_API_KEY", "gsk_test", raising=False)
        for feat in ("TEXT_CHAT", "CHAT_WRITER", "CHAT_ENHANCER"):
            res = _groq_fallback(feat)
            assert res is not None, feat
            model, key = res
            assert model == "llama-3.3-70b-versatile"
            assert key == "gsk_test"

    def test_off_for_non_chat_features_even_with_key(self, monkeypatch):
        # Vision / diagnose / treatment / alert / pest must NOT fall over to Groq.
        import agents.llm_dispatch as d
        monkeypatch.setattr(d, "GROQ_API_KEY", "gsk_test", raising=False)
        for feat in ("CHAT_VISION", "CROP_DIAGNOSE", "CROP_TREATMENT", "ALERT", "PEST"):
            assert _groq_fallback(feat) is None, feat

    def test_per_feature_disable(self, monkeypatch):
        import agents.llm_dispatch as d
        monkeypatch.setattr(d, "GROQ_API_KEY", "gsk_test", raising=False)
        monkeypatch.setenv("AI_CHAT_WRITER_GROQ_FALLBACK", "false")
        assert _groq_fallback("CHAT_WRITER") is None

    def test_per_feature_model_override(self, monkeypatch):
        import agents.llm_dispatch as d
        monkeypatch.setattr(d, "GROQ_API_KEY", "gsk_test", raising=False)
        monkeypatch.setenv("AI_CHAT_WRITER_GROQ_MODEL", "llama-3.1-8b-instant")
        model, _ = _groq_fallback("CHAT_WRITER")
        assert model == "llama-3.1-8b-instant"

    def test_per_feature_opt_in_for_non_chat(self, monkeypatch):
        # An operator can opt a non-chat text feature into the Groq fallback.
        import agents.llm_dispatch as d
        monkeypatch.setattr(d, "GROQ_API_KEY", "gsk_test", raising=False)
        monkeypatch.setenv("AI_ALERT_GROQ_FALLBACK", "true")
        res = _groq_fallback("ALERT")
        assert res is not None and res[0] == "llama-3.3-70b-versatile"
