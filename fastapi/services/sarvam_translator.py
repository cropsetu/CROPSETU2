"""
Sarvam-backed text translator for report enrichment.

Used by the report generator to translate short per-section summaries from
English into the farmer's native language. Translation is treated as
enrichment, never as a blocker: every failure mode (missing API key,
upstream 5xx, unsupported language) returns the originals so the report
still ships.

Cache:
  Disease names, pesticide trade names, and section labels repeat heavily
  across reports. A small in-process FIFO cache keyed by (text, target)
  collapses most calls to free lookups. With ~5 blocks per scan and a
  long tail of repeated phrases, expected hit rate is >80% in steady
  state.
"""
from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict

from config import SARVAM_API_KEY
from services.http_clients import get_sarvam

logger = logging.getLogger(__name__)

# Sarvam Translate accepts BCP-47 language tags ending in "-IN". Anything
# absent from this map (e.g. "as" — Assamese is not yet on Sarvam's list)
# is skipped, and originals flow through untouched.
_SARVAM_LANG_TAG: dict[str, str] = {
    "en": "en-IN",
    "hi": "hi-IN",
    "mr": "mr-IN",
    "ta": "ta-IN",
    "te": "te-IN",
    "kn": "kn-IN",
    "ml": "ml-IN",
    "bn": "bn-IN",
    "gu": "gu-IN",
    "pa": "pa-IN",
    "or": "od-IN",
}

_TRANSLATE_URL = "https://api.sarvam.ai/translate"
_CACHE_MAX_ENTRIES = 2000

# (source_text, target_lang) -> translated_text.
# OrderedDict gives us FIFO eviction at constant time.
_cache: "OrderedDict[tuple[str, str], str]" = OrderedDict()
_cache_lock = asyncio.Lock()


def supported(target_lang: str) -> bool:
    """Sarvam can translate into this language code."""
    return target_lang in _SARVAM_LANG_TAG and target_lang != "en"


async def _cache_get(key: tuple[str, str]) -> str | None:
    async with _cache_lock:
        return _cache.get(key)


async def _cache_set(key: tuple[str, str], value: str) -> None:
    async with _cache_lock:
        _cache[key] = value
        if len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)


async def _translate_one(text: str, target_tag: str, source_tag: str) -> str:
    """Single Sarvam call. Caller handles caching and error mapping."""
    client = get_sarvam()
    resp = await client.post(
        _TRANSLATE_URL,
        headers={
            "api-subscription-key": SARVAM_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "input": text,
            "source_language_code": source_tag,
            "target_language_code": target_tag,
            "mode": "formal",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    out = data.get("translated_text") or ""
    if not out:
        raise ValueError("Sarvam returned empty translated_text")
    return out


async def translate_blocks(
    blocks: dict[str, str],
    target_lang: str,
    *,
    source_lang: str = "en",
) -> dict[str, str]:
    """
    Translate every value in `blocks` into `target_lang`.

    Returns the same keys; values are translated strings, or the original
    English on any failure. Empty/None values pass through untouched. The
    function never raises — translation is best-effort enrichment.
    """
    if not blocks:
        return {}
    if not SARVAM_API_KEY:
        logger.info("[Sarvam] SARVAM_API_KEY unset — returning originals")
        return dict(blocks)
    if not supported(target_lang):
        logger.info("[Sarvam] target_lang=%r not supported — returning originals", target_lang)
        return dict(blocks)

    target_tag = _SARVAM_LANG_TAG[target_lang]
    source_tag = _SARVAM_LANG_TAG.get(source_lang, "en-IN")

    async def _resolve(key: str, text: str) -> tuple[str, str]:
        if not text or not text.strip():
            return key, text
        cache_key = (text, target_lang)
        cached = await _cache_get(cache_key)
        if cached is not None:
            return key, cached
        try:
            translated = await _translate_one(text, target_tag, source_tag)
        except Exception as exc:
            logger.warning("[Sarvam] translate failed (%s → %s): %s", source_lang, target_lang, exc)
            return key, text
        await _cache_set(cache_key, translated)
        return key, translated

    results = await asyncio.gather(*(_resolve(k, v) for k, v in blocks.items()))
    return {k: v for k, v in results}
