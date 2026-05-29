"""
Unit tests for services/sarvam_translator.py

Mocks the pooled httpx client at get_sarvam() and verifies:
  - happy path: each block in dict gets translated
  - cache hit: repeat call for the same (text, lang) makes no new HTTP call
  - upstream failure: originals flow through, no exception raised
  - missing API key: short-circuits to originals
  - unsupported language: short-circuits to originals
"""
import asyncio
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import services.sarvam_translator as st


def _fake_response(text: str):
    r = MagicMock()
    r.raise_for_status = MagicMock()
    r.json = MagicMock(return_value={"translated_text": text})
    return r


def _reset_cache():
    st._cache.clear()


def test_translate_happy_path_returns_translated_values():
    _reset_cache()
    blocks = {"summary": "Hello", "treatment": "Spray Mancozeb"}

    fake_client = MagicMock()
    fake_client.post = AsyncMock(side_effect=[
        _fake_response("नमस्ते"),
        _fake_response("मँकोझेब फवारा"),
    ])

    with patch.object(st, "SARVAM_API_KEY", "dummy"), \
         patch.object(st, "get_sarvam", return_value=fake_client):
        out = asyncio.run(st.translate_blocks(blocks, "mr"))

    assert set(out.keys()) == {"summary", "treatment"}
    assert out["summary"] == "नमस्ते"
    assert out["treatment"] == "मँकोझेब फवारा"
    assert fake_client.post.await_count == 2


def test_cache_collapses_repeat_calls():
    _reset_cache()
    fake_client = MagicMock()
    fake_client.post = AsyncMock(return_value=_fake_response("नमस्ते"))

    with patch.object(st, "SARVAM_API_KEY", "dummy"), \
         patch.object(st, "get_sarvam", return_value=fake_client):
        # First call populates cache
        asyncio.run(st.translate_blocks({"a": "Hello"}, "mr"))
        # Second call with the same source text + lang should hit cache
        out = asyncio.run(st.translate_blocks({"b": "Hello"}, "mr"))

    assert out["b"] == "नमस्ते"
    assert fake_client.post.await_count == 1, "second call should not hit Sarvam"


def test_upstream_failure_returns_originals_no_raise():
    _reset_cache()
    fake_client = MagicMock()
    fake_client.post = AsyncMock(side_effect=RuntimeError("503 Service Unavailable"))

    with patch.object(st, "SARVAM_API_KEY", "dummy"), \
         patch.object(st, "get_sarvam", return_value=fake_client):
        out = asyncio.run(st.translate_blocks({"summary": "Hello"}, "mr"))

    assert out == {"summary": "Hello"}


def test_missing_api_key_short_circuits():
    _reset_cache()
    fake_client = MagicMock()
    fake_client.post = AsyncMock()

    with patch.object(st, "SARVAM_API_KEY", ""), \
         patch.object(st, "get_sarvam", return_value=fake_client):
        out = asyncio.run(st.translate_blocks({"summary": "Hello"}, "mr"))

    assert out == {"summary": "Hello"}
    assert fake_client.post.await_count == 0


def test_unsupported_language_short_circuits():
    _reset_cache()
    fake_client = MagicMock()
    fake_client.post = AsyncMock()

    with patch.object(st, "SARVAM_API_KEY", "dummy"), \
         patch.object(st, "get_sarvam", return_value=fake_client):
        # English is on the language list but we explicitly refuse en→en
        en_out = asyncio.run(st.translate_blocks({"summary": "Hello"}, "en"))
        # Assamese is not on Sarvam's list
        as_out = asyncio.run(st.translate_blocks({"summary": "Hello"}, "as"))

    assert en_out == {"summary": "Hello"}
    assert as_out == {"summary": "Hello"}
    assert fake_client.post.await_count == 0


def test_empty_values_pass_through_untouched():
    _reset_cache()
    fake_client = MagicMock()
    fake_client.post = AsyncMock(return_value=_fake_response("नमस्ते"))

    with patch.object(st, "SARVAM_API_KEY", "dummy"), \
         patch.object(st, "get_sarvam", return_value=fake_client):
        out = asyncio.run(st.translate_blocks(
            {"summary": "Hello", "empty": "", "blank": "   "}, "mr"))

    assert out["empty"] == ""
    assert out["blank"] == "   "
    assert out["summary"] == "नमस्ते"
    # Only the non-empty value should reach Sarvam
    assert fake_client.post.await_count == 1


def test_supported_helper():
    assert st.supported("mr") is True
    assert st.supported("hi") is True
    assert st.supported("en") is False, "en→en is intentionally unsupported"
    assert st.supported("as") is False, "Assamese not on Sarvam's list"
    assert st.supported("xx") is False
