"""
The weather cache's SHARED half has to actually be shared (claude.md §31).

Open-Meteo's grid is ~11 km, so the service buckets coordinates to 0.1° and
reuses one forecast across every caller in that bucket for thirty minutes. The
point of that is to stay under a 10k/day free tier while several uvicorn workers
and several Celery workers all run crop scans.

It never worked in production. The client was built as
`Redis(host="localhost")` — where Redis lives on a laptop, not on Railway — so
the ping at import failed, a module-level flag latched False for the life of the
process, and every lookup fell through to a 200-entry per-process dict. Each
worker kept its own cache, and orchestrator.py imports this, so every scan paid
it.

These pin the address, the fallback, and the re-probe.
"""
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_REDIS_VARS = ("REDIS_URL", "RATE_LIMIT_STORAGE_URI")


def _load(**env):
    """Import weather_service fresh under a specific environment."""
    for k in _REDIS_VARS:
        os.environ.pop(k, None)
    os.environ.update(env)
    sys.modules.pop("weather_service", None)
    return importlib.import_module("weather_service")


@pytest.fixture(autouse=True)
def _restore_env():
    saved = {k: os.environ.get(k) for k in _REDIS_VARS}
    yield
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    sys.modules.pop("weather_service", None)


def test_the_client_is_built_from_the_environment_not_localhost():
    """
    The whole defect in one assertion: a configured REDIS_URL must produce a
    client pointed at it. Nothing may hardcode a host.
    """
    ws = _load(REDIS_URL="redis://example-redis:6379/2")
    assert ws._REDIS_URL == "redis://example-redis:6379/2"
    assert ws._redis is not None
    # from_url parsed the address we gave it, not a compiled-in one.
    assert ws._redis.connection_pool.connection_kwargs["host"] == "example-redis"


def test_rate_limit_storage_uri_wins_when_both_are_set():
    """Same precedence as security/spend.py and services/idempotency.py, so all
    three land on one instance rather than three opinions about where Redis is."""
    ws = _load(RATE_LIMIT_STORAGE_URI="redis://a:6379/0", REDIS_URL="redis://b:6379/0")
    assert ws._REDIS_URL == "redis://a:6379/0"


def test_no_redis_configured_still_caches_in_process():
    """A developer with no Redis must keep working — that path was never broken
    and must not become broken by fixing the other one."""
    ws = _load()
    assert ws._redis is None
    assert ws._redis_available() is False

    ws._cache_set("weather:om:18.5:73.8", {"temp": 30})
    assert ws._cache_get("weather:om:18.5:73.8") == {"temp": 30}


def test_an_unreachable_redis_degrades_rather_than_raising():
    """A crop scan must not fail because a cache is down."""
    ws = _load(REDIS_URL="redis://127.0.0.1:6399/0")   # nothing listens there
    assert ws._redis_available() is False

    ws._cache_set("weather:om:19.0:72.9", {"temp": 28})
    assert ws._cache_get("weather:om:19.0:72.9") == {"temp": 28}


def test_health_is_re_probed_rather_than_latched_at_import():
    """
    The old flag was decided once, at import. A Redis blip while a Celery worker
    forked therefore dropped that worker onto the in-memory cache for its whole
    life, with nothing to say so — the same failure jobs/queue.py and
    security/spend.py each had to fix.
    """
    ws = _load(REDIS_URL="redis://127.0.0.1:6399/0")
    assert ws._redis_available() is False

    class _Up:
        def ping(self):
            return True

    ws._redis = _Up()
    ws._redis_next_probe = 0.0      # the retry window has elapsed
    assert ws._redis_available() is True, "recovery must be observable without a restart"


def test_a_probe_failure_is_not_retried_on_every_single_lookup():
    """Backoff, so a down Redis costs one probe per window rather than one per
    scan — otherwise the fallback is more expensive than the cache."""
    ws = _load(REDIS_URL="redis://127.0.0.1:6399/0")

    calls = {"n": 0}

    class _Down:
        def ping(self):
            calls["n"] += 1
            raise ConnectionError("nope")

    ws._redis = _Down()
    ws._redis_ok = False
    ws._redis_next_probe = 0.0

    assert ws._redis_available() is False
    for _ in range(20):
        ws._redis_available()
    assert calls["n"] == 1, "a failed probe must open a retry window, not retry every call"


def test_the_cache_key_buckets_coordinates_to_the_open_meteo_grid():
    """
    Two farms within the same 0.1° cell must share one forecast — that is what
    makes the shared cache worth having at all.

    Note the bucketing is plain rounding, so neighbours either side of a cell
    boundary (…73.84 and …73.86) do NOT share, however close they are. That is
    inherent to bucketing rather than a defect, and the coordinates here are
    deliberately chosen inside one cell rather than across an edge.
    """
    ws = _load()
    assert ws._cache_key(18.52, 73.81) == ws._cache_key(18.54, 73.84)
    assert ws._cache_key(18.52, 73.81) != ws._cache_key(19.52, 73.81)
