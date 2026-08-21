"""
The shared asyncpg pool must never be handed to a loop it was not created on.

An asyncpg pool owns transports, timeout callbacks and waiter futures that all
belong to one event loop. Reusing it on another loop does not degrade — it
raises, and the caller in persistence/diagnosis_repo.py swallows the raise and
logs "continuing without". So the failure mode is silent data loss, not an
outage, which is why it needs a test rather than a dashboard.

The path that produced it: jobs/tasks.py used `asyncio.run(...)` per Celery
task, on the belief that the prefork pool is process-per-task. It is
process-per-WORKER, and `worker_max_tasks_per_child` is unset, so one child
handles tasks back to back — task 1 created the pool and closed its loop, and
every task after it inherited a pool bound to a dead loop.

No database is required here: asyncpg.create_pool is stubbed, because what is
under test is which pool object gets returned to which loop.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import db_pool  # noqa: E402


class _FakePool:
    """Stands in for an asyncpg pool, remembering the loop it was built on."""

    def __init__(self):
        self.loop = asyncio.get_running_loop()
        self.closed = False

    async def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _stub_pool(monkeypatch):
    created = []

    async def fake_create_pool(*_args, **_kwargs):
        p = _FakePool()
        created.append(p)
        return p

    import types
    monkeypatch.setitem(
        sys.modules, "asyncpg", types.SimpleNamespace(create_pool=fake_create_pool)
    )
    monkeypatch.setattr(db_pool, "DATABASE_URL", "postgresql://stub/stub")
    monkeypatch.setattr(db_pool, "_db_pool", None)
    monkeypatch.setattr(db_pool, "_pool_loop", None)
    yield created


def test_same_loop_reuses_one_pool(_stub_pool):
    """The uvicorn case: one loop for the process, so a plain singleton."""

    async def scenario():
        a = await db_pool.get_shared_pool()
        b = await db_pool.get_shared_pool()
        return a, b

    a, b = asyncio.run(scenario())
    assert a is b
    assert len(_stub_pool) == 1, "a second pool was built for the same loop"


def test_a_new_loop_never_receives_the_previous_loop_s_pool(_stub_pool):
    """
    The Celery case, and the actual defect.

    Three sequential `asyncio.run` calls, as three tasks in one prefork child.
    Each must get a pool belonging to its OWN loop. Before the fix the second
    and third received the first's, and every DB call through them raised
    `InterfaceError: cannot perform operation: another operation is in progress`.
    """
    pools = [asyncio.run(db_pool.get_shared_pool()) for _ in range(3)]

    # Every task got a pool built on the loop that was actually running.
    assert len({id(p) for p in pools}) == 3
    assert len(_stub_pool) == 3

    # And crucially, no pool was ever returned to a loop other than its own —
    # this is the assertion that fails against the old singleton.
    for p in pools:
        assert p.loop.is_closed(), "each task's loop should have finished"
    assert pools[0] is not pools[1] is not pools[2]


def test_stale_pool_is_dropped_not_closed(_stub_pool):
    """
    A pool whose loop has finished has no live sockets left to release, and
    awaiting close() on it would raise "Event loop is closed" — the very error
    being avoided. It must be discarded silently instead.
    """
    first = asyncio.run(db_pool.get_shared_pool())
    second = asyncio.run(db_pool.get_shared_pool())

    assert first is not second
    assert first.closed is False, "the stale pool must not be close()d across loops"


def test_close_shared_pool_from_a_foreign_loop_does_not_raise(_stub_pool):
    """
    Shutdown must be safe even when it runs on a different loop than the one
    that built the pool — otherwise a worker teardown turns into a traceback.
    """
    asyncio.run(db_pool.get_shared_pool())
    asyncio.run(db_pool.close_shared_pool())  # must not raise
    assert db_pool._db_pool is None
    assert db_pool._pool_loop is None


def test_close_shared_pool_on_its_own_loop_really_closes_it(_stub_pool):
    """The uvicorn shutdown path still has to release connections."""

    async def scenario():
        p = await db_pool.get_shared_pool()
        await db_pool.close_shared_pool()
        return p

    p = asyncio.run(scenario())
    assert p.closed is True
    assert db_pool._db_pool is None
