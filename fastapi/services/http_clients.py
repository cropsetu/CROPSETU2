"""
Shared, long-lived HTTP clients for LLM providers.

Opening `httpx.AsyncClient` per request wastes a TLS handshake on every
LLM call (≈50–200 ms) and exhausts ephemeral source ports under burst
load. This module keeps one pooled client per upstream alive for the
whole app lifetime, plus a singleton Anthropic SDK client (the SDK
manages its own connection pool internally).

Lifecycle:
    - Clients are created lazily on first `get_*()` call.
    - `close_all()` MUST be called from the FastAPI lifespan shutdown
      so connections are flushed cleanly on redeploy.
"""
from __future__ import annotations

import httpx
from anthropic import AsyncAnthropic

from config import ANTHROPIC_API_KEY

_gemini: httpx.AsyncClient | None = None
_groq: httpx.AsyncClient | None = None
_sarvam: httpx.AsyncClient | None = None
_anthropic_sdk: AsyncAnthropic | None = None


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
    """Pooled client for `api.groq.com`."""
    global _groq
    if _groq is None:
        _groq = _make_client(default_read_timeout=90.0)
    return _groq


def get_sarvam() -> httpx.AsyncClient:
    """Pooled client for `api.sarvam.ai` (translate, STT, TTS endpoints)."""
    global _sarvam
    if _sarvam is None:
        # Sarvam translate is a short call; 15 s is plenty.
        _sarvam = _make_client(default_read_timeout=15.0)
    return _sarvam


def get_anthropic() -> AsyncAnthropic:
    """Singleton Anthropic SDK client. The SDK pools connections itself."""
    global _anthropic_sdk
    if _anthropic_sdk is None:
        _anthropic_sdk = AsyncAnthropic(
            api_key=ANTHROPIC_API_KEY,
            timeout=60.0,
            max_retries=2,
        )
    return _anthropic_sdk


async def close_all() -> None:
    """Close all pooled clients. Call from lifespan shutdown."""
    global _gemini, _groq, _sarvam, _anthropic_sdk
    if _gemini is not None:
        await _gemini.aclose()
        _gemini = None
    if _groq is not None:
        await _groq.aclose()
        _groq = None
    if _sarvam is not None:
        await _sarvam.aclose()
        _sarvam = None
    if _anthropic_sdk is not None:
        await _anthropic_sdk.close()
        _anthropic_sdk = None
