/**
 * Standalone worker process — runs ONLY the BullMQ workers, no HTTP server.
 *
 *   npm run worker
 *
 * Use this to scale the worker tier independently of the web tier (more worker
 * replicas to drain a backlog without adding web capacity). When running
 * standalone, set QUEUE_INPROCESS_WORKER=false on the web service so jobs aren't
 * also processed there.
 */
import 'dotenv/config';
import { startWorkers, stopWorkers } from './queue/worker.js';
import { closeProducerConnection } from './queue/connection.js';
import prisma from './config/db.js';
import logger from './utils/logger.js';

const workers = startWorkers();
logger.info('[Worker] Standalone worker process ready');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('[Worker] %s received — draining jobs and shutting down', signal);
  const forceTimer = setTimeout(() => {
    logger.error('[Worker] Shutdown timed out after 15s — forcing exit');
    process.exit(1);
  }, 15_000).unref();
  await stopWorkers(workers);
  await Promise.allSettled([prisma.$disconnect(), closeProducerConnection()]);
  clearTimeout(forceTimer);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) =>
  logger.error('[Worker] Unhandled rejection — %s', reason?.message || reason));
