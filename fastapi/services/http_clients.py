"""
Shared, long-lived HTTP clients for LLM providers.

Opening `httpx.AsyncClient` per request wastes a TLS handshake on every
LLM call (≈50–200 ms) and exhausts ephemeral source ports under burst
load. This module keeps one pooled client per upstream (Gemini + Sarvam)
alive for the whole app lifetime.

Lifecycle:
    - Clients are created lazily on first `get_*()` call.
    - `close_all()` MUST be called from the FastAPI lifespan shutdown
      so connections are flushed cleanly on redeploy.
"""
from __future__ import annotations

import httpx

_gemini: httpx.AsyncClient | None = None
_groq: httpx.AsyncClient | None = None
_openai: httpx.AsyncClient | None = None
_sarvam: httpx.AsyncClient | None = None


def _make_client(*, default_read_timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=5.0,
            read=default_read_timeout,
            write=30.0,
            pool=5.0,
        ),
        limits=httpx.Limits(
            max_connections=100,
            max_keepalive_connections=20,
            keepalive_expiry=30.0,
        ),
    )


def get_gemini() -> httpx.AsyncClient:
    """Pooled client for `generativelanguage.googleapis.com`."""
    global _gemini
    if _gemini is None:
        # Vision calls need the longest budget; text callers can pass
        # a shorter `timeout=` per request to override.
        _gemini = _make_client(default_read_timeout=120.0)
    return _gemini


def get_groq() -> httpx.AsyncClient:
    """Pooled client for `api.groq.com` (OpenAI-compatible chat completions).

    Only used as the last-resort cross-provider chat fallback when the Gemini
    path is fully down — see agents/llm_dispatch.call_llm_text.
    """
    global _groq
    if _groq is None:
        _groq = _make_client(default_read_timeout=90.0)
    return _groq


def get_openai() -> httpx.AsyncClient:
    """Pooled client for `api.openai.com` (OpenAI-compatible chat completions).

    Only used by the crop-diagnosis ensemble voter (GPT-4o vision) — see
    agents/router._call_one_vision. Vision needs a long budget, so use the same
    120s read timeout as the Gemini client.
    """
    global _openai
    if _openai is None:
        _openai = _make_client(default_read_timeout=120.0)
    return _openai


def get_sarvam() -> httpx.AsyncClient:
    """Pooled client for `api.sarvam.ai` (translate, STT, TTS endpoints)."""
    global _sarvam
    if _sarvam is None:
        # Sarvam translate is a short call; 15 s is plenty.
        _sarvam = _make_client(default_read_timeout=15.0)
    return _sarvam


async def close_all() -> None:
    """Close all pooled clients. Call from lifespan shutdown."""
    global _gemini, _groq, _openai, _sarvam
    if _gemini is not None:
        await _gemini.aclose()
        _gemini = None
    if _groq is not None:
        await _groq.aclose()
        _groq = None
    if _openai is not None:
        await _openai.aclose()
        _openai = None
    if _sarvam is not None:
        await _sarvam.aclose()
        _sarvam = None
