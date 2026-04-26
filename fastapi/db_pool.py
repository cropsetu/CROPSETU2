"""
Shared asyncpg connection pool — singleton module.

Imported by main.py (startup/shutdown/health) and services that need DB access.
Extracted here to avoid circular imports (service -> main -> routes -> service).
"""
from __future__ import annotations

import logging

from config import DATABASE_URL

logger = logging.getLogger(__name__)

_db_pool = None


async def get_shared_pool():
    """Return the shared asyncpg pool, creating it once on first call."""
    global _db_pool
    if _db_pool is None and DATABASE_URL:
        import asyncpg
        _db_pool = await asyncpg.create_pool(
            DATABASE_URL, min_size=2, max_size=10, command_timeout=15
        )
    return _db_pool


async def close_shared_pool():
    """Close the pool gracefully (call during app shutdown)."""
    global _db_pool
    if _db_pool is not None:
        await _db_pool.close()
        _db_pool = None
        logger.info("[Config] PostgreSQL pool closed")
