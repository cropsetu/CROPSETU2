"""Atomic check-and-reserve on the daily spend cap (AI-05), and the re-probe (AI-06).

The cap used to be READ in the uvicorn web process at enqueue and INCREMENTED in
the Celery worker at completion. Between those two moments the counter did not
move, so N scans submitted together all read the same pre-spend total and every
one of them passed. The cap only ever caught the request that arrived after the
first worker had finished — minutes later, by which point the money was spent.

Reserving makes the check and the increment one operation, so the Nth concurrent
request sees the first N-1 reserves.

These tests drive the in-memory path (no Redis configured under pytest), which is
the same decision tree the Lua script implements server-side.
"""
import importlib

import pytest
from fastapi import HTTPException


@pytest.fixture()
def spend(monkeypatch):
    """A freshly imported spend module with a known cap and no Redis."""
    monkeypatch.setenv("DAILY_SPEND_CAP_USD", "1.00")
    monkeypatch.setenv("SPEND_CAP_ENABLED", "true")
    monkeypatch.delenv("RATE_LIMIT_STORAGE_URI", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    import security.spend as spend_mod
    importlib.reload(spend_mod)
    spend_mod._MEM.clear()
    return spend_mod


def test_reserve_increments_immediately(spend):
    """The whole point: the reserve is visible to the very next caller."""
    assert spend.get_used("u1") == 0.0
    spend.check_under_cap("u1", reserve=0.25)
    assert spend.get_used("u1") == pytest.approx(0.25)


def test_a_burst_is_bounded_rather_than_unbounded(spend):
    """Reserves accumulate, so a burst stops itself.

    The gate is `used >= cap` — deliberately the SAME rule as the read-only
    check, so a request that starts under the cap is allowed to finish even if it
    ends up over. What changed is that each reserve is now VISIBLE to the next
    caller: 4 x 0.30 reaches 1.20 and the fifth is refused.

    Under the old read-then-increment shape none of them moved the counter, so an
    unbounded number of concurrent scans all passed the same check.
    """
    for _ in range(4):
        spend.check_under_cap("u2", reserve=0.30)
    assert spend.get_used("u2") == pytest.approx(1.20)

    with pytest.raises(HTTPException) as exc:
        spend.check_under_cap("u2", reserve=0.30)
    assert exc.value.status_code == 402
    # The refusal must not have charged anything.
    assert spend.get_used("u2") == pytest.approx(1.20)


def test_refusal_does_not_consume_budget(spend):
    """A rejected reserve must not leave a partial charge behind."""
    spend.check_under_cap("u3", reserve=1.00)
    before = spend.get_used("u3")
    with pytest.raises(HTTPException):
        spend.check_under_cap("u3", reserve=0.10)
    assert spend.get_used("u3") == pytest.approx(before)


def test_settle_replaces_the_estimate(spend):
    """Settling swaps the reserve for the real cost — it must not add on top."""
    spend.check_under_cap("u4", reserve=0.03)
    spend.settle_spend("u4", reserved=0.03, actual=0.11)
    assert spend.get_used("u4") == pytest.approx(0.11)


def test_settle_can_refund_an_overestimate(spend):
    spend.check_under_cap("u5", reserve=0.50)
    spend.settle_spend("u5", reserved=0.50, actual=0.02)
    assert spend.get_used("u5") == pytest.approx(0.02)


def test_release_gives_the_whole_reserve_back(spend):
    """A crashed or timed-out job produced nothing, so it must cost nothing.

    Leaving it counted would lock the farmer out of scanning for the rest of the
    UTC day for work that never ran.
    """
    spend.check_under_cap("u6", reserve=0.30)
    spend.release_spend("u6", reserved=0.30)
    assert spend.get_used("u6") == pytest.approx(0.0)


def test_counter_never_goes_negative(spend):
    """A double release, or a release of a hold that was never taken."""
    spend.release_spend("u7", reserved=0.50)
    assert spend.get_used("u7") >= 0.0


def test_read_only_check_is_unchanged(spend):
    """check_under_cap(uid) with no reserve must still not move the counter —
    five existing tests in test_security.py depend on exactly that."""
    spend.check_under_cap("u8")
    assert spend.get_used("u8") == 0.0


def test_reserve_pins_its_utc_day(spend):
    """A job that finishes after midnight settles against the day it reserved
    from, not the new one — otherwise it refunds a bucket it never charged."""
    ymd = spend.utc_ymd()
    spend.check_under_cap("u9", reserve=0.20)
    spend.release_spend("u9", reserved=0.20, ymd=ymd)
    assert spend.get_used("u9") == pytest.approx(0.0)


def test_mem_fallback_is_bounded(spend):
    """The in-memory mirror grew one entry per (user, day) forever, in every web
    and worker process (MEM-04)."""
    for i in range(spend._MEM_MAX + 250):
        spend.record_spend(f"user-{i}", 0.001)
    assert len(spend._MEM) <= spend._MEM_MAX


def test_disabled_cap_short_circuits(spend, monkeypatch):
    monkeypatch.setattr(spend, "SPEND_ENABLED", False)
    spend.check_under_cap("u10", reserve=99.0)
    assert spend.get_used("u10") == 0.0
