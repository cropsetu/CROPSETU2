/**
 * BullMQ workers — the consumer side that actually performs queued jobs.
 *
 * `startWorkers()` spins up one Worker per registered queue, each pulling jobs
 * and dispatching to the handler in processors.js with bounded concurrency.
 * Run it two ways:
 *   - In-process (default): server.js calls startWorkers() after listen, so a
 *     single-service deploy processes jobs with no extra infra.
 *   - Standalone: `npm run worker` (src/worker.js) runs ONLY workers, letting
 *     you scale the worker tier independently of the web tier.
 *
 * A job that throws is retried per the queue's backoff policy; exhausted jobs
 * land in the failed set (retained for triage) and are logged here.
 */
import { Worker } from 'bullmq';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';
import { createQueueConnection } from './connection.js';
import { PROCESSORS, QUEUE_NAMES } from './processors.js';

/**
 * Start a Worker for every queue in PROCESSORS.
 * @returns {import('bullmq').Worker[]} the workers (for graceful shutdown).
 */
export function startWorkers() {
  const workers = [];
  for (const queueName of Object.values(QUEUE_NAMES)) {
    const handlers = PROCESSORS[queueName];
    const worker = new Worker(
      queueName,
      async (job) => {
        const handler = handlers?.[job.name];
        if (!handler) throw new Error(`No processor for ${queueName}/${job.name}`);
        return handler(job.data);
      },
      {
        connection: createQueueConnection(), // each worker blocks → own connection
        concurrency: ENV.QUEUE_CONCURRENCY,
      },
    );
    worker.on('failed', (job, err) =>
      logger.warn('[Worker] %s/%s failed (attempt %d): %s', queueName, job?.name, job?.attemptsMade, err.message));
    worker.on('error', (err) => logger.warn('[Worker] %s worker error: %s', queueName, err.message));
    workers.push(worker);
  }
  logger.info('[Worker] Started %d queue worker(s) (concurrency=%d)', workers.length, ENV.QUEUE_CONCURRENCY);
  return workers;
}

/** Close all workers (drains in-flight jobs up to the shutdown grace window). */
export async function stopWorkers(workers = []) {
  await Promise.allSettled(workers.map((w) => w.close()));
}
