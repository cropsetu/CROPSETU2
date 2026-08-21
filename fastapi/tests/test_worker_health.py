"""
Celery worker liveness, as seen from the web process (claude.md §35).

A healthy FastAPI process says nothing about whether any worker exists. Deploy
the web role without the worker role — one `$ROLE` variable in
fastapi/railway.json — and every scan is accepted, queued and never run, while
/health stays green and the farmer watches a spinner. Nothing in this service
could observe that, which is the gap these tests close.

The signal is deliberately a PAIR. Queue depth alone is a busy afternoon;
completion staleness alone is a quiet one. Both at once means work is arriving
and nothing is consuming it, which is the shape of a missing worker and also of
a wedged one.

Redis is stubbed: what is under test is the verdict, not the client.
"""
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from jobs import queue as q  # noqa: E402


class _FakeRedis:
    def __init__(self, depth=0, last=None):
        self.store = {}
        self.depth = depth
        if last is not None:
            self.store[q._HEARTBEAT_KEY] = str(last)

    def llen(self, _key):
        return self.depth

    def get(self, key):
        return self.store.get(key)

    def setex(self, key, _ttl, value):
        self.store[key] = value


@pytest.fixture
def redis_up(monkeypatch):
    """Install a fake Redis and force the availability probe to succeed."""
    def _install(depth=0, last=None):
        fake = _FakeRedis(depth=depth, last=last)
        monkeypatch.setattr(q, "_redis", fake)
        monkeypatch.setattr(q, "_redis_available", lambda: True)
        return fake
    return _install


def test_no_worker_deployed_is_reported_as_stuck(redis_up):
    """Scans piling up, nothing ever completed — the case that was invisible."""
    redis_up(depth=12, last=None)
    h = q.worker_health()
    assert h["available"] is True
    assert h["depth"] == 12
    assert h["seconds_since_completion"] is None
    assert h["stuck"] is True


def test_worker_wedged_is_reported_as_stuck(redis_up):
    """A worker that ran once and then stopped consuming looks the same."""
    redis_up(depth=5, last=time.time() - (q._STUCK_AFTER_SEC + 60))
    h = q.worker_health()
    assert h["depth"] == 5
    assert h["seconds_since_completion"] > q._STUCK_AFTER_SEC
    assert h["stuck"] is True


def test_a_busy_but_healthy_queue_is_not_stuck(redis_up):
    """Depth alone must not raise an alarm — that is just traffic."""
    redis_up(depth=40, last=time.time() - 5)
    h = q.worker_health()
    assert h["depth"] == 40
    assert h["stuck"] is False


def test_an_idle_fleet_that_has_never_run_a_task_is_not_stuck(redis_up):
    """
    Nothing queued and nothing ever completed is a fresh deploy on a quiet
    night, not a fault. Reporting it as stuck would make the signal cry wolf
    from the moment it shipped.
    """
    redis_up(depth=0, last=None)
    h = q.worker_health()
    assert h["depth"] == 0
    assert h["stuck"] is False


def test_a_long_running_scan_alone_does_not_trip_it(redis_up):
    """
    The threshold sits above task_time_limit (300s) on purpose: one genuinely
    slow scan running by itself must not read as a dead fleet.
    """
    assert q._STUCK_AFTER_SEC > 300
    redis_up(depth=1, last=time.time() - 299)
    assert q.worker_health()["stuck"] is False


def test_redis_down_reports_unavailable_rather_than_raising(monkeypatch):
    """An ops read must never become an outage of its own."""
    monkeypatch.setattr(q, "_redis_available", lambda: False)
    h = q.worker_health()
    assert h == {"available": False, "reason": "redis unavailable"}


def test_a_redis_error_mid_read_is_contained(monkeypatch):
    class _Boom:
        def llen(self, _k):
            raise ConnectionError("redis went away")

    monkeypatch.setattr(q, "_redis", _Boom())
    monkeypatch.setattr(q, "_redis_available", lambda: True)
    monkeypatch.setattr(q, "_mark_redis_down", lambda *_a, **_k: None)
    assert q.worker_health()["available"] is False


def test_mark_task_completed_writes_a_readable_heartbeat(redis_up):
    """The worker half: what it writes must be what worker_health reads."""
    fake = redis_up(depth=3, last=None)
    assert q.worker_health()["stuck"] is True

    q.mark_task_completed()
    assert q._HEARTBEAT_KEY in fake.store

    h = q.worker_health()
    assert h["seconds_since_completion"] is not None
    assert h["seconds_since_completion"] < 5
    assert h["stuck"] is False


def test_mark_task_completed_is_silent_when_redis_is_down(monkeypatch):
    """Observability must never be able to fail a scan."""
    monkeypatch.setattr(q, "_redis_available", lambda: False)
    q.mark_task_completed()  # must not raise


def test_a_corrupt_heartbeat_value_does_not_crash_the_read(redis_up):
    fake = redis_up(depth=2, last=None)
    fake.store[q._HEARTBEAT_KEY] = "not-a-timestamp"
    h = q.worker_health()
    assert h["last_completion_epoch"] is None
    assert h["stuck"] is True  # unreadable is treated as unknown, with work waiting
