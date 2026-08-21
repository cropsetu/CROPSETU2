"""
Shared asyncpg connection pool — singleton module.

Imported by main.py (startup/shutdown/health) and services that need DB access.
Extracted here to avoid circular imports (service -> main -> routes -> service).

The pool is keyed by the event loop that created it. An asyncpg pool holds
connections whose transports, timeout callbacks and waiter futures all belong to
one loop, so a pool reused on a different loop is not slow — it is broken.

Under uvicorn there is exactly one loop for the process lifetime and this is a
plain singleton, as before. It matters for CELERY. jobs/tasks.py runs each task
with its own `asyncio.run(...)`, which creates a fresh loop and closes it when
the task returns, and the Celery prefork pool is process-per-WORKER, not
process-per-task — a child handles tasks back to back for its whole life, and
`worker_max_tasks_per_child` is not set anywhere. So the second task in a child
inherited a pool bound to the loop the first task had already closed:

    task 1: OK
    task 2: InterfaceError: cannot perform operation: another operation is in progress
    task 3: InterfaceError: cannot perform operation: another operation is in progress
    Future exception was never retrieved
    future: <Future finished exception=ConnectionDoesNotExistError(...)>

persistence/diagnosis_repo.py catches that and logs "record_diagnosis failed —
continuing without", so the farmer still received their diagnosis and nothing
user-facing broke. What was lost, silently, was the scan record itself: every
crop scan after the first one a worker process handled went unwritten.
"""
from __future__ import annotations

import asyncio
import logging

from config import DATABASE_URL

logger = logging.getLogger(__name__)

_db_pool = None
# The loop `_db_pool` was created on. Compared by identity, never awaited on.
_pool_loop = None


async def get_shared_pool():
    """
    Return the asyncpg pool for the CURRENT event loop, creating it on demand.

    At most one pool is alive per process. When the running loop is not the one
    the cached pool belongs to, the stale pool is dropped rather than reused —
    its sockets died with its loop, so there is nothing left to close and
    awaiting close() on it would itself raise "Event loop is closed".
    """
    global _db_pool, _pool_loop

    running = asyncio.get_running_loop()

    if _db_pool is not None and _pool_loop is not running:
        # Dropped, not closed. See the docstring: the old loop is gone, and with
        # it every transport the pool owns.
        logger.info(
            "[Config] PostgreSQL pool belonged to a finished event loop — rebuilding"
        )
        _db_pool = None
        _pool_loop = None

    if _db_pool is None and DATABASE_URL:
        import asyncpg
        _db_pool = await asyncpg.create_pool(
            DATABASE_URL, min_size=2, max_size=10, command_timeout=15
        )
        _pool_loop = running

    return _db_pool


async def close_shared_pool():
    """Close the pool gracefully (call during app shutdown)."""
    global _db_pool, _pool_loop
    if _db_pool is not None:
        # Only closable from its own loop. Closing from another would raise the
        # very error this module exists to avoid, and a pool whose loop is gone
        # has no live sockets to release anyway.
        try:
            if _pool_loop is asyncio.get_running_loop():
                await _db_pool.close()
                logger.info("[Config] PostgreSQL pool closed")
        except RuntimeError:
            pass  # no running loop — nothing to close against
        _db_pool = None
        _pool_loop = None
