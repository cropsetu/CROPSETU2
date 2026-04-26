import { PrismaClient } from '@prisma/client';
import { ENV } from './env.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient({
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
