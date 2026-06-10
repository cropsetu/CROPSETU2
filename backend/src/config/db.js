import os from 'node:os';
import { PrismaClient } from '@prisma/client';
import { ENV } from './env.js';
import logger from '../utils/logger.js';

// ── Connection pool sizing for the 1000-concurrent-user target ───────────────
// Prisma opens ONE pool per app instance and reads its size from the connection
// URL. Prisma's own default is tiny (num_cpus*2+1) and starves under concurrent
// load: once every connection is checked out, further queries queue up to
// `pool_timeout` seconds and then error, hanging the WHOLE API (login, profile,
// everything) — not just the slow route that drained the pool.
//
// 1000 concurrent USERS does NOT mean 1000 DB connections. Queries here are short
// and most hot reads are cached, so a modest pool serves high concurrency. We
// default to (cpus*2+1) with a floor of 20 so small 2-vCPU prod boxes still get
// enough headroom to pass the k6 load test (500 browse + 50 seller VUs) without
// pool exhaustion. Override per-deploy with DB_CONNECTION_LIMIT.
//
// IMPORTANT (overlaps SCALE-4): total server-side connections =
// (app instances) × connection_limit, and PostgreSQL's default max_connections
// is 100. Keep instances × connection_limit comfortably under that. For true
// 1000-connection fan-out, front Postgres with a pooler (PgBouncer in
// transaction mode, or Prisma Accelerate) and point DATABASE_URL at it.
const DEFAULT_CONNECTION_LIMIT = Math.max(os.cpus().length * 2 + 1, 20);

// String-appended (not URL-reparsed) so a password with special chars is untouched.
function withPool(url) {
  if (!url) return url;
  let out = url;
  if (!/[?&]connection_limit=/.test(out)) {
    out += (out.includes('?') ? '&' : '?') + `connection_limit=${process.env.DB_CONNECTION_LIMIT || DEFAULT_CONNECTION_LIMIT}`;
  }
  if (!/[?&]pool_timeout=/.test(out)) {
    out += (out.includes('?') ? '&' : '?') + `pool_timeout=${process.env.DB_POOL_TIMEOUT || '20'}`;
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

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
