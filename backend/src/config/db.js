import { PrismaClient } from '@prisma/client';
import { ENV } from './env.js';
import logger from '../utils/logger.js';
import { attachAuthCacheInvalidation } from '../services/authCache.js';

// ── Connection pool sizing ───────────────────────────────────────────────────
// Prisma opens ONE pool per app instance and reads its size from the connection
// URL. Prisma's own default is tiny (num_cpus*2+1) and starves under concurrent
// load: once every connection is checked out, further queries queue up to
// `pool_timeout` seconds and then error, hanging the WHOLE API (login, profile,
// everything) — not just the slow route that drained the pool.
//
// PINNED, not derived (DB-01). The old default was max(os.cpus().length*2+1, 20),
// and Node's os.cpus() reports the HOST's core count, not the container's cgroup
// CPU quota — so one replica on a shared 32-core Railway host silently claimed 65
// connections against a default max_connections of 100. The pool size has to be a
// number we CHOSE, because every other tier's headroom is computed against it.
//
// Sizing by Little's law (L = λ × W) at the 300 req/s peak target:
//   fast path  300 req/s × ~4 queries/req = 1200 q/s × ~2 ms      ≈ 2.4 busy
//   slow tail  1% of those at ~250 ms (bounded geo scans, trigram
//              probes, admin aggregates)  = 12 q/s × 0.25 s       ≈ 3.0 busy
//   fleet ≈ 5.4 busy; ×2 so queueing stays negligible             ≈ 11 fleet-wide
//   → ~3 per replica at 4 replicas, for the HTTP path.
// The SAME per-replica pool also serves the in-process BullMQ worker
// (ENV.QUEUE_CONCURRENCY, default 5) and the in-process node-cron schedules
// (~2 concurrent long holders, e.g. the mandi sync). 3 + 5 + 2 = 10, rounded to 12.
//
// Ceiling: max_connections 100 − 3 superuser reserve − 10 FastAPI asyncpg
// − 10 Celery asyncpg − 5 ops headroom = 72 for Express → 6 replicas at 12.
// Raise DB_CONNECTION_LIMIT only together with that arithmetic, and past ~6
// replicas only once a pooler (PgBouncer in transaction mode) fronts DATABASE_URL.
const DEFAULT_CONNECTION_LIMIT = 12;
const DEFAULT_POOL_TIMEOUT     = 20;

/**
 * Read a positive-integer env override, or fall back loudly.
 *
 * A malformed value used to be interpolated into the URL verbatim
 * (`connection_limit=abc`), which fails at the first query rather than at boot.
 */
function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn('[Prisma] Ignoring invalid %s=%j; using %d', name, raw, fallback);
    return fallback;
  }
  return n;
}

// String-appended (not URL-reparsed) so a password with special chars is untouched.
function withPool(url) {
  if (!url) return url;
  let out = url;
  if (!/[?&]connection_limit=/.test(out)) {
    out += (out.includes('?') ? '&' : '?') + `connection_limit=${intEnv('DB_CONNECTION_LIMIT', DEFAULT_CONNECTION_LIMIT)}`;
  }
  if (!/[?&]pool_timeout=/.test(out)) {
    out += (out.includes('?') ? '&' : '?') + `pool_timeout=${intEnv('DB_POOL_TIMEOUT', DEFAULT_POOL_TIMEOUT)}`;
  }
  return out;
}

const prisma = new PrismaClient({
  datasources: { db: { url: withPool(ENV.DATABASE_URL) } },
  log: ENV.IS_DEV
    ? [
        { level: 'query', emit: 'event' },
        { level: 'warn',  emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ]
    : ['warn', 'error'],
});

// Log slow queries in dev (> 200ms) to catch N+1 and unindexed scans
if (ENV.IS_DEV) {
  prisma.$on('query', (e) => {
    if (e.duration > 200) {
      logger.warn({ duration: e.duration, query: e.query.slice(0, 200) }, '[Prisma] Slow query (%dms)', e.duration);
    }
  });
}

// Invalidate the auth cache on ANY write to a user's auth-relevant columns.
// Registered here, on the shared client, rather than at each of the nine
// tokenVersion write sites — seven of which do not go through bumpTokenVersion,
// and none of which is the site somebody adds next year.
attachAuthCacheInvalidation(prisma);

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
