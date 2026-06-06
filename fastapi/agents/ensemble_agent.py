"""
agents/ensemble_agent.py — parallel fan-out across multiple vision models.

Used by the orchestrator's cascade gate: when the cheap first-pass
diagnose returns low confidence (or an ambiguous primary-vs-differential
pair), this stage asks 2–3 frontier models the same question in parallel
and hands the results to agents/reconciler.fuse(). Total latency ≈
slowest model (not the sum) because each call runs concurrently via
asyncio.gather.

Per-member failures are tolerated. If Sonnet 429s, the other two still
vote. If everyone fails, the orchestrator falls back to the primary
result (cross_verify will already cap its confidence).

Specialist routing (MoE)
  When agents/specialists/ defines a model for a given crop,
  select(crop) appends it to the ensemble set so it votes alongside
  the frontier triplet. The reconciler treats the specialist as one
  more equal voter — its weight will be lifted by the Phase 8
  per-model accuracy table once feedback accumulates.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from agents.disease_diagnosis_agent import (
    _build_context,
    _diagnose_prompt,
    _normalise,
    _parse_json,
    _read_image_b64,
    _uncertain_fallback,
)
from agents.llm_utils import empty_token_info
from agents.registry import resolve_chain, MODEL_CATALOG
from agents.router import dispatch_one_vision
from agents.specialists import get_specialist

logger = logging.getLogger(__name__)


# Each ensemble member gets its own soft cap. The whole gather() is wrapped
# by the orchestrator's PipelineBudget.with_budget at a higher level (120s
# total), but per-member timeouts here let one slow model degrade
# gracefully instead of dragging the whole stage past the gather cap.
_PER_MEMBER_TIMEOUT_SECONDS = 90.0


def select(crop: str | None) -> list[str]:
    """
    Resolve the ordered list of model ids to fan out across.

    Order: the configured ensemble chain (typically Gemini Pro + Claude
    Sonnet + GPT-4o), then any crop-specific specialist registered in
    agents/specialists/. We dedupe in case a specialist's id is already
    in the ensemble chain.
    """
    # Tier is intentionally ignored — the ensemble stage always uses its
    # own "best" set regardless of the farmer-facing tier toggle (which
    # only controls the cheap cascade entry).
    base = resolve_chain("ensemble", "best") or []
    if not base:
        # Fall back to "best" diagnose chain (Gemini Flash + Haiku today)
        # so callers without an ensemble chain still get *some* fan-out.
        base = resolve_chain("diagnose", "best") or []
    members: list[str] = []
    for m in base:
        if m not in members:
            members.append(m)
    specialist = get_specialist(crop) if crop else None
    if specialist and specialist not in members and specialist in MODEL_CATALOG:
        members.append(specialist)
    return members


async def _run_one_model(
    *,
    model_id: str,
    images_b64: list[dict],
    system_prompt: str,
    user_prompt: str,
    prompt_meta: dict,
    temperature: float,
) -> tuple[Optional[dict], dict]:
    """Run one ensemble member; return (diagnosis_or_None, token_info)."""
    tok_empty = empty_token_info(model_id)
    try:
        raw, tok = await asyncio.wait_for(
            dispatch_one_vision(
                model_id=model_id,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                images_b64=images_b64,
                temperature=temperature,
            ),
            timeout=_PER_MEMBER_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("[Ensemble] member=%s timed out after %.0fs", model_id, _PER_MEMBER_TIMEOUT_SECONDS)
        return None, tok_empty
    except Exception as exc:  # noqa: BLE001 — one member failing is fine
        logger.warning("[Ensemble] member=%s failed: %s", model_id, exc)
        return None, tok_empty

    parsed = _parse_json(raw)
    if not parsed:
        logger.warning("[Ensemble] member=%s returned unparseable JSON", model_id)
        return None, tok

    result = _normalise(parsed)
    pd = result.get("primary_diagnosis") or {}
    if not pd.get("disease") or pd.get("disease") in ("Unknown", "UNCERTAIN", ""):
        logger.info("[Ensemble] member=%s returned UNCERTAIN — counted but low signal", model_id)
    # Stamp the model id so the reconciler can apply per-model weights later.
    result["_model"] = model_id
    result["_prompt_meta"] = prompt_meta
    return result, tok


async def run_parallel(
    *,
    images: list[dict],
    image_quality: dict,
    weather_risk: dict,
    params: dict,
    models: list[str],
    temperature: float = 0.3,
) -> tuple[list[dict], dict]:
    """
    Fan out a diagnose call across `models` in parallel.

    Returns (results, token_info). `results` contains only the members
    that produced a usable diagnosis (parsed JSON, non-uncertain primary).
    `token_info` is the SUM across all members so the orchestrator can
    bill the full ensemble cost to the user.
    """
    if not models:
        return [], empty_token_info("none")

    # Load images once and share across all members — same bytes, same
    # context, only the model differs. Mirrors how disease_diagnosis_agent
    # prepares its single call.
    images_b64: list[dict] = []
    for img in images[:1]:   # single-image pipeline (multi-image feature removed)
        try:
            b64, mime = _read_image_b64(img["path"])
            images_b64.append({"data": b64, "mime_type": mime})
        except Exception as exc:
            logger.warning("[Ensemble] cannot read image %s: %s", img.get("path"), exc)
    if not images_b64:
        logger.error("[Ensemble] no readable images — skipping ensemble")
        return [], empty_token_info(models[0])

    system_prompt, prompt_meta = _diagnose_prompt()
    user_prompt = _build_context(image_quality, weather_risk, params, local_prior=None)

    logger.info(
        "[Ensemble] fanning out across %d models: %s",
        len(models), ", ".join(models),
    )
    coros = [
        _run_one_model(
            model_id=m,
            images_b64=images_b64,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            prompt_meta=prompt_meta,
            temperature=temperature,
        )
        for m in models
    ]
    pairs = await asyncio.gather(*coros, return_exceptions=False)

    results: list[dict] = []
    total_in  = 0
    total_out = 0
    total_tok = 0
    total_cost = 0.0
    last_model = models[0]
    for (diag, tok), model_id in zip(pairs, models):
        total_in  += tok.get("input_tokens", 0)
        total_out += tok.get("output_tokens", 0)
        total_tok += tok.get("total_tokens", 0)
        total_cost += float(tok.get("cost_usd", 0.0) or 0.0)
        last_model = tok.get("model") or model_id
        if diag:
            results.append(diag)

    token_info = {
        "model":         f"ensemble({len(results)}/{len(models)})",
        "input_tokens":  total_in,
        "output_tokens": total_out,
        "total_tokens":  total_tok,
        "cost_usd":      round(total_cost, 6),
    }
    if not results:
        logger.error(
            "[Ensemble] all %d members failed — caller should fall back to primary",
            len(models),
        )
        # Return an uncertain shell so the caller can decide to fall back
        # to the primary cheap result instead of crashing.
        return [_uncertain_fallback(f"All {len(models)} ensemble members failed")], token_info
    logger.info(
        "[Ensemble] %d/%d members produced usable diagnoses",
        len(results), len(models),
    )
    return results, token_info
