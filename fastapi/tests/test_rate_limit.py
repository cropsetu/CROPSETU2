"""
Rate limiting — production enforcement + cross-instance shared storage.

Acceptance: prod enforces limits under test. We prove (1) a limiter built by the
production factory actually returns 429 once the window is exceeded, and (2) when
a Redis storage URI is configured the factory wires SHARED storage so the limit
holds across instances (not a per-process bucket).
"""
import importlib
import os
import sys

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import rate_limit  # noqa: E402


def _build_app(limit):
    """Minimal app wired exactly like main.py, with a fixed key so every request
    shares one bucket regardless of the test client's address."""
    limiter = rate_limit.make_limiter(lambda request: "test-key", default_limits=[limit])
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    @app.get("/ping")
    async def ping(request: Request):  # noqa: ANN001
        return {"ok": True}

    return app


def test_limiter_enforces_429_when_exceeded():
    """The prod factory's limiter rejects over-cap requests with 429."""
    client = TestClient(_build_app("3/minute"))
    statuses = [client.get("/ping").status_code for _ in range(6)]
    assert statuses[:3] == [200, 200, 200]   # first 3 allowed
    assert statuses[3:] == [429, 429, 429]    # rest throttled


def test_factory_wires_shared_redis_storage_when_configured(monkeypatch):
    """With a storage URI configured, make_limiter passes it to SlowAPI so the
    window is shared across instances — plus the fail-open safety nets."""
    captured = {}

    class FakeLimiter:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(rate_limit, "Limiter", FakeLimiter)
    monkeypatch.setattr(rate_limit, "RATE_LIMIT_STORAGE_URI", "redis://example:6379/0")

    rate_limit.make_limiter(lambda r: "k", default_limits=["60/minute"])

    assert captured["storage_uri"] == "redis://example:6379/0"  # shared backend
    assert captured["swallow_errors"] is True                    # fail-open
    assert captured["in_memory_fallback_enabled"] is True        # degrade, don't die


def test_factory_uses_memory_when_unconfigured(monkeypatch):
    """No storage URI → no storage_uri kwarg → SlowAPI's in-memory default
    (dev/test behaviour unchanged)."""
    captured = {}

    class FakeLimiter:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(rate_limit, "Limiter", FakeLimiter)
    monkeypatch.setattr(rate_limit, "RATE_LIMIT_STORAGE_URI", "")

    rate_limit.make_limiter(lambda r: "k")

    assert "storage_uri" not in captured


def test_config_defaults_storage_to_redis_url(monkeypatch):
    """In prod, RATE_LIMIT_STORAGE_URI falls back to REDIS_URL automatically, so
    a deployment that already provisions Redis gets shared limiting for free."""
    monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: None)  # ignore any local .env
    monkeypatch.delenv("RATE_LIMIT_STORAGE_URI", raising=False)
    monkeypatch.setenv("REDIS_URL", "redis://prod-redis:6379/3")
    import config
    importlib.reload(config)
    try:
        assert config.RATE_LIMIT_STORAGE_URI == "redis://prod-redis:6379/3"
    finally:
        importlib.reload(config)  # restore module state for other tests
