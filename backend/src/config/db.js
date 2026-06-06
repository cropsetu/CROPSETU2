import { PrismaClient } from '@prisma/client';
import { ENV } from './env.js';
import logger from '../utils/logger.js';

// Prisma reads pool size from the connection URL. The default is tiny
// (~num_cpus*2+1), which can starve under concurrent slow AI calls and make the
// WHOLE API hang (login, profile, everything). Pin an explicit limit + timeout.
// String-appended (not URL-reparsed) so a password with special chars is untouched.
function withPool(url) {
  if (!url) return url;
  let out = url;
  if (!/[?&]connection_limit=/.test(out)) {
    out += (out.includes('?') ? '&' : '?') + `connection_limit=${process.env.DB_CONNECTION_LIMIT || '10'}`;
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
