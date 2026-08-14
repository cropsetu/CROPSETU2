"""
Tests for pipeline/budget.py and services/idempotency.py.

Budget tests cover the per-stage time tracker + BudgetExhausted exit
path. Idempotency tests cover the key derivation contract that the
scan route depends on (double-tap dedup correctness).
"""
import asyncio
import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pipeline.budget import BudgetExhausted, PipelineBudget
from services import idempotency


# ══════════════════════════════════════════════════════════════════════════════
# Budget
# ══════════════════════════════════════════════════════════════════════════════

def test_budget_initial_state():
    b = PipelineBudget(total_seconds=120)
    assert b.total == 120
    assert b.remaining() <= 120
    assert b.remaining() > 119.9     # nothing elapsed yet
    assert b.elapsed() < 0.1


def test_budget_snapshot_shape():
    b = PipelineBudget(total_seconds=10)
    snap = b.snapshot()
    assert set(snap.keys()) == {
        "total_seconds", "elapsed_seconds", "remaining_seconds", "per_stage_seconds",
    }
    assert snap["total_seconds"] == 10
    assert snap["per_stage_seconds"] == {}


def test_budget_with_budget_runs_coroutine():
    b = PipelineBudget(total_seconds=10)

    async def work():
        await asyncio.sleep(0.05)
        return "done"

    result = asyncio.run(b.with_budget(work(), max_seconds=1.0, stage="diagnose"))
    assert result == "done"
    assert "diagnose" in b.stage_elapsed
    assert b.stage_elapsed["diagnose"] >= 0.05


def test_budget_raises_when_below_min_required():
    b = PipelineBudget(total_seconds=0.5)
    # Burn the budget
    time.sleep(0.4)

    async def work():
        return "done"

    # Remaining ~0.1s, but we require 5s minimum → must raise immediately
    with pytest.raises(BudgetExhausted):
        asyncio.run(b.with_budget(work(), max_seconds=2.0, stage="treatment", min_required=5.0))


def test_budget_with_budget_respects_max_seconds():
    b = PipelineBudget(total_seconds=10)

    async def slow():
        await asyncio.sleep(2.0)
        return "done"

    # max_seconds=0.1 must cancel the coroutine
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(b.with_budget(slow(), max_seconds=0.1, stage="diagnose"))


def test_budget_stage_elapsed_accumulates_across_calls():
    b = PipelineBudget(total_seconds=10)

    async def quick():
        await asyncio.sleep(0.02)

    asyncio.run(b.with_budget(quick(), max_seconds=1.0, stage="diagnose"))
    first = b.stage_elapsed["diagnose"]
    asyncio.run(b.with_budget(quick(), max_seconds=1.0, stage="diagnose"))
    assert b.stage_elapsed["diagnose"] > first


# ══════════════════════════════════════════════════════════════════════════════
# Idempotency
# ══════════════════════════════════════════════════════════════════════════════

def test_idempotency_header_key_wins():
    key1 = idempotency.cache_key({}, "abc-123")
    key2 = idempotency.cache_key({"params": {"crop": "tomato"}}, "abc-123")
    # Same header → same key, regardless of body
    assert key1 == key2
    assert "abc-123" in key1


def test_idempotency_body_hash_distinguishes_different_images():
    # The digest is over the image CONTENT, not its filename. This test used to
    # assert the opposite — that two different photos sharing a basename dedup to
    # one key — which is precisely how a farmer's second scan (a different plant)
    # was served the first plant's diagnosis and its pesticide.
    body_a = {"params": {"crop": "Tomato", "tier": "fast"},
              "images": [{"path": "/tmp/a/img.jpg", "type": "leaf"}]}
    body_b = {"params": {"crop": "Tomato", "tier": "fast"},
              "images": [{"path": "/tmp/b/img.jpg", "type": "leaf"}]}
    assert idempotency.cache_key(body_a, None) != idempotency.cache_key(body_b, None)


def test_idempotency_same_image_still_dedups():
    # The flip side: a genuine retry of the SAME submission must still collapse
    # to one key, or a double-tap bills the farmer twice.
    body = {"params": {"crop": "Tomato", "tier": "fast"},
            "images": [{"data": "aGVsbG8=", "type": "leaf"}]}
    assert idempotency.cache_key(body, None) == idempotency.cache_key(dict(body), None)


def test_idempotency_key_is_namespaced_per_user():
    # Without the user namespace the key is a bearer token: farmer B's identical
    # retry is served farmer A's stored report.
    body = {"params": {"crop": "Tomato", "tier": "fast"}, "images": []}
    assert idempotency.cache_key(body, None, user_id="u1") != \
           idempotency.cache_key(body, None, user_id="u2")
    # …and the same holds when the client supplies its own Idempotency-Key.
    assert idempotency.cache_key(body, "abc-123", user_id="u1") != \
           idempotency.cache_key(body, "abc-123", user_id="u2")


def test_idempotency_tier_change_yields_different_key():
    body_fast = {"params": {"crop": "Tomato", "tier": "fast"}, "images": []}
    body_best = {"params": {"crop": "Tomato", "tier": "best"}, "images": []}
    assert idempotency.cache_key(body_fast, None) != idempotency.cache_key(body_best, None)


def test_idempotency_different_crop_different_key():
    a = {"params": {"crop": "Tomato"}, "images": []}
    b = {"params": {"crop": "Potato"}, "images": []}
    assert idempotency.cache_key(a, None) != idempotency.cache_key(b, None)


def test_idempotency_get_returns_none_for_missing():
    assert idempotency.get("idem:scan:body:doesnotexist") is None


def test_idempotency_set_then_get_roundtrip():
    k = idempotency.cache_key({"params": {"crop": "RoundTripCrop"}}, None)
    payload = {"report_id": "abc", "confidence_score": 0.82}
    idempotency.set(k, payload)
    got = idempotency.get(k)
    assert got == payload


def test_idempotency_header_key_length_capped():
    long = "x" * 1000
    k = idempotency.cache_key({}, long)
    # The cache key string itself shouldn't grow unboundedly
    assert len(k) <= 200
