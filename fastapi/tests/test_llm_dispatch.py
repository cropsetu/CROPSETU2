"""
Unit tests for agents/llm_dispatch.py — the flat per-feature LLM config.

Covers:
  - _detect_provider routes model-name prefixes to the right provider
  - explicit base_url overrides auto-detection
  - unknown prefix + no base_url raises ConfigError
  - get_feature_config reads AI_<FEATURE>_* env vars correctly
  - defaults are used when env vars are unset
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
    _resolve_base_url,
    get_feature_config,
)


# ── Provider auto-detection ──────────────────────────────────────────────────

class TestDetectProvider:
    def test_claude_prefix_routes_to_anthropic(self):
        assert _detect_provider("claude-haiku-4-5-20251001", None) == "anthropic"
        assert _detect_provider("claude-sonnet-4-6", None) == "anthropic"

    def test_gemini_prefix_routes_to_gemini(self):
        assert _detect_provider("gemini-2.5-flash", None) == "gemini"
        assert _detect_provider("gemini-2.5-pro", None) == "gemini"

    def test_gpt_prefix_routes_to_openai_compatible(self):
        assert _detect_provider("gpt-4o", None) == "openai_compatible"
        assert _detect_provider("gpt-4o-mini", None) == "openai_compatible"

    def test_o1_o3_prefixes_route_to_openai_compatible(self):
        assert _detect_provider("o1-preview", None) == "openai_compatible"
        assert _detect_provider("o3-mini", None) == "openai_compatible"

    def test_llama_prefix_routes_to_openai_compatible(self):
        # Groq uses OpenAI-compatible protocol, so llama-* models go through
        # the same generic path with a Groq base URL.
        assert _detect_provider("llama-3.3-70b-versatile", None) == "openai_compatible"
        assert _detect_provider("llama-3.1-8b-instant", None) == "openai_compatible"

    def test_deepseek_prefix_routes_to_openai_compatible(self):
        assert _detect_provider("deepseek-chat", None) == "openai_compatible"
        assert _detect_provider("deepseek-reasoner", None) == "openai_compatible"

    def test_grok_prefix_routes_to_openai_compatible(self):
        assert _detect_provider("grok-2-vision-1212", None) == "openai_compatible"

    def test_explicit_base_url_always_wins(self):
        # Admin override — works for OpenRouter / private hosting / Ollama
        # even when the model id matches a known native-provider prefix.
        assert _detect_provider("claude-haiku-4-5-20251001",
                                "https://openrouter.ai/api/v1") == "openai_compatible"
        assert _detect_provider("anything-custom",
                                "https://my.local/v1") == "openai_compatible"

    def test_unknown_prefix_without_base_url_raises(self):
        with pytest.raises(ConfigError):
            _detect_provider("foo-mystery-model", None)
        with pytest.raises(ConfigError):
            _detect_provider("", None)

    def test_case_insensitive(self):
        assert _detect_provider("CLAUDE-haiku", None) == "anthropic"
        assert _detect_provider("Gemini-2.5-Flash", None) == "gemini"


# ── Base URL resolution ──────────────────────────────────────────────────────

class TestResolveBaseUrl:
    def test_explicit_base_url_passes_through(self):
        assert _resolve_base_url("anything", "https://custom.local/v1") == "https://custom.local/v1"

    def test_gpt_resolves_to_openai(self):
        assert _resolve_base_url("gpt-4o", None) == "https://api.openai.com/v1"

    def test_llama_resolves_to_groq(self):
        assert _resolve_base_url("llama-3.3-70b-versatile", None) == "https://api.groq.com/openai/v1"

    def test_deepseek_resolves_to_deepseek(self):
        assert _resolve_base_url("deepseek-chat", None) == "https://api.deepseek.com/v1"

    def test_grok_resolves_to_xai(self):
        assert _resolve_base_url("grok-2", None) == "https://api.x.ai/v1"

    def test_whisper_resolves_to_groq(self):
        # STT also uses the openai_compatible path with Groq as default.
        assert _resolve_base_url("whisper-large-v3-turbo", None) == "https://api.groq.com/openai/v1"

    def test_unknown_prefix_raises(self):
        with pytest.raises(ConfigError):
            _resolve_base_url("foo-mystery-model", None)


# ── Feature-config loader ────────────────────────────────────────────────────

class TestGetFeatureConfig:
    @pytest.fixture(autouse=True)
    def _clean_env(self, monkeypatch):
        # Clear the relevant env vars so tests start from a known state.
        for feat in AI_FEATURES:
            for suffix in ("_MODEL", "_API_KEY", "_BASE_URL"):
                monkeypatch.delenv(f"AI_{feat}{suffix}", raising=False)

    def test_falls_back_to_defaults_when_env_unset(self):
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.feature == "TEXT_CHAT"
        assert cfg.model == "llama-3.3-70b-versatile"  # baked-in default
        assert cfg.base_url is None
        # api_key defaults to GROQ_API_KEY (whatever is set in config.py at
        # module-load time — may be empty in test env). Just check the
        # field exists and is a string.
        assert isinstance(cfg.api_key, str)

    def test_env_vars_override_defaults(self, monkeypatch):
        monkeypatch.setenv("AI_TEXT_CHAT_MODEL", "gpt-4o")
        monkeypatch.setenv("AI_TEXT_CHAT_API_KEY", "sk-test-12345")
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.model == "gpt-4o"
        assert cfg.api_key == "sk-test-12345"
        assert cfg.provider == "openai_compatible"

    def test_base_url_override(self, monkeypatch):
        monkeypatch.setenv("AI_TEXT_CHAT_MODEL", "custom-private-model")
        monkeypatch.setenv("AI_TEXT_CHAT_API_KEY", "secret")
        monkeypatch.setenv("AI_TEXT_CHAT_BASE_URL", "https://my-llm.local/v1")
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.base_url == "https://my-llm.local/v1"
        assert cfg.provider == "openai_compatible"

    def test_swap_chat_to_anthropic_only_changes_two_lines(self, monkeypatch):
        """Documents the headline admin workflow."""
        monkeypatch.setenv("AI_TEXT_CHAT_MODEL", "claude-sonnet-4-6")
        monkeypatch.setenv("AI_TEXT_CHAT_API_KEY", "sk-ant-test")
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.model == "claude-sonnet-4-6"
        assert cfg.api_key == "sk-ant-test"
        assert cfg.provider == "anthropic"  # auto-detected from prefix

    def test_unknown_feature_raises(self):
        with pytest.raises(ValueError, match="Unknown AI feature"):
            get_feature_config("FAKE_FEATURE")

    def test_all_canonical_features_resolve(self, monkeypatch):
        # Every entry in AI_FEATURES should be loadable without error.
        # Set arbitrary models so the lookup works regardless of defaults.
        for feat in AI_FEATURES:
            monkeypatch.setenv(f"AI_{feat}_MODEL", "claude-haiku-4-5-20251001")
            monkeypatch.setenv(f"AI_{feat}_API_KEY", "test-key")
        for feat in AI_FEATURES:
            cfg = get_feature_config(feat)
            assert isinstance(cfg, FeatureConfig)
            assert cfg.feature == feat
            assert cfg.model == "claude-haiku-4-5-20251001"

    def test_empty_string_env_treated_as_unset(self, monkeypatch):
        # Common ops mistake: AI_TEXT_CHAT_MODEL=  (trailing equals, no value).
        # Should fall back to the default, not produce an empty model name.
        monkeypatch.setenv("AI_TEXT_CHAT_MODEL", "")
        monkeypatch.setenv("AI_TEXT_CHAT_API_KEY", "")
        cfg = get_feature_config("TEXT_CHAT")
        assert cfg.model == "llama-3.3-70b-versatile"
