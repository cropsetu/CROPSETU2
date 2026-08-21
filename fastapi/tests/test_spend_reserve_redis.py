"""The spend counter against a REAL Redis — the path that actually runs in production.

test_spend_reserve.py exercises the in-memory fallback. That is not enough, and
this file exists because of exactly how it was not enough: `_adjust` clamped the
in-memory mirror to zero but wrote the raw delta to Redis, so the production
counter could go NEGATIVE while the in-memory test of "the counter never goes
negative" passed. A negative total disables the cap outright — the gate is
`used >= cap`, which is false for every negative value — so one extra release
bought unbounded spend.

Anything asserting a clamp, a floor, or an atomic operation has to run against
Redis or it is testing a different implementation than the one that ships.

Skipped automatically when no Redis is reachable, so this stays safe in CI.
"""
import importlib
import os

import pytest

redis_lib = pytest.importorskip("redis")

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:6379/15")


def _redis_available() -> bool:
    try:
        redis_lib.Redis.from_url(REDIS_URL, socket_connect_timeout=1).ping()
        return True
    except Exception:  # noqa: BLE001
        return False


pytestmark = pytest.mark.skipif(
    not _redis_available(), reason="no Redis reachable for the real-path tests"
)


@pytest.fixture()
def spend(monkeypatch):
    """spend module bound to a scratch Redis db, wiped before each test."""
    monkeypatch.setenv("RATE_LIMIT_STORAGE_URI", REDIS_URL)
    monkeypatch.setenv("DAILY_SPEND_CAP_USD", "1.00")
    monkeypatch.setenv("SPEND_CAP_ENABLED", "true")
    import security.spend as spend_mod
    importlib.reload(spend_mod)
    spend_mod._MEM.clear()

    client = redis_lib.Redis.from_url(REDIS_URL)
    client.flushdb()
    yield spend_mod
    client.flushdb()


def _redis_value(spend, user_id):
    """Read the counter Redis actually holds, bypassing the in-memory mirror."""
    raw = spend._redis.get(spend._redis_key(*spend._today_key(user_id)))
    return float(raw) if raw is not None else 0.0


def test_reserve_lands_in_redis(spend):
    spend.check_under_cap("r1", reserve=0.03)
    assert _redis_value(spend, "r1") == pytest.approx(0.03)


def test_double_release_cannot_drive_redis_negative(spend):
    """The regression. A worker redelivery, or a release after a settle, used to
    leave the shared counter below zero — and a negative counter passes the cap
    check forever, because `used >= cap` is false for every negative value."""
    spend.check_under_cap("r2", reserve=0.03)
    spend.release_spend("r2", reserved=0.03)
    spend.release_spend("r2", reserved=0.03)  # the extra one
    assert _redis_value(spend, "r2") >= 0.0


def test_many_spurious_releases_do_not_buy_headroom(spend):
    """32 extra releases previously reached -$0.93, i.e. $1.93 of free spend
    against a $1.00 cap."""
    for _ in range(32):
        spend.release_spend("r3", reserved=0.03)
    assert _redis_value(spend, "r3") >= 0.0

    # And the cap must still bite once real spend reaches it.
    spend.record_spend("r3", 1.00)
    with pytest.raises(Exception):
        spend.check_under_cap("r3", reserve=0.01)


def test_settle_against_an_uncharged_bucket_floors_at_zero(spend):
    """Redis down at reserve, up at settle: the settle subtracts a reserve that
    Redis was never charged."""
    spend.settle_spend("r4", reserved=0.03, actual=0.005)
    assert _redis_value(spend, "r4") >= 0.0


def test_reserves_are_atomic_under_a_burst(spend):
    """The reserve must be visible to the next caller — that is the whole point.
    Four 0.30 reserves reach 1.20 and the fifth is refused."""
    from fastapi import HTTPException

    for _ in range(4):
        spend.check_under_cap("r5", reserve=0.30)
    assert _redis_value(spend, "r5") == pytest.approx(1.20)

    with pytest.raises(HTTPException) as exc:
        spend.check_under_cap("r5", reserve=0.30)
    assert exc.value.status_code == 402
    # A refusal must not charge.
    assert _redis_value(spend, "r5") == pytest.approx(1.20)


def test_settle_replaces_rather_than_adds(spend):
    spend.check_under_cap("r6", reserve=0.03)
    spend.settle_spend("r6", reserved=0.03, actual=0.11)
    assert _redis_value(spend, "r6") == pytest.approx(0.11)


def test_the_key_carries_a_ttl(spend):
    """Without an expiry these accumulate one key per user per day forever."""
    spend.check_under_cap("r7", reserve=0.03)
    ttl = spend._redis.ttl(spend._redis_key(*spend._today_key("r7")))
    assert 0 < ttl <= spend._KEY_TTL_SEC


def test_client_survives_a_failed_startup_ping(monkeypatch):
    """AI-06: the re-probe can only work if the client is KEPT when the ping
    fails. Nulling it in a shared `except` meant `_redis_ready()` short-circuited
    on `_redis is None` and could never reach its own ping — so a worker that
    imported during a blip stayed latched for the life of the process, returning
    402 for every scan because the cap fails closed."""
    monkeypatch.setenv("RATE_LIMIT_STORAGE_URI", "redis://127.0.0.1:6399/0")  # nothing listening
    import security.spend as spend_mod
    importlib.reload(spend_mod)

    assert spend_mod._redis is not None, "client discarded — re-probe can never fire"
    assert spend_mod._REDIS_OK is False
