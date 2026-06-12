/**
 * Job queue producer (BullMQ) — the enqueue side of the heavy-work offload.
 *
 * `enqueue()` hands a job to BullMQ and returns immediately, so the request path
 * never waits on slow side-effects (notification delivery, external HTTP, etc.).
 * A separate worker (in-process or `npm run worker`) does the actual work with
 * retries, backoff and bounded concurrency.
 *
 * FAIL-OPEN: if the queue is disabled or Redis is unavailable, the job runs
 * INLINE via the shared processor registry instead of being dropped — these are
 * real side-effects, and single-instance / dev (no Redis) must keep working
 * exactly as before. The trade-off is that the inline path reintroduces the old
 * latency for that one call; the moment Redis returns, offloading resumes.
 */
import { Queue } from 'bullmq';
import { ENV } from '../config/env.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { getProducerConnection } from './connection.js';
import { QUEUE_NAMES, runJobInline } from './processors.js';

export { QUEUE_NAMES };

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s
  removeOnComplete: { count: 100, age: 3600 },     // keep last 100 / 1h
  removeOnFail: { count: 500, age: 24 * 3600 },     // keep failures 24h for triage
};

const _queues = new Map();
function getQueue(name) {
  let q = _queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getProducerConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    q.on('error', (err) => logger.warn('[Queue] %s error: %s', name, err.message));
    _queues.set(name, q);
  }
  return q;
}

/**
 * Enqueue a job for async processing, falling back to inline execution when the
 * queue can't be used. Returns `{ enqueued, jobId? }` (queued) or
 * `{ enqueued: false, ranInline: true }` (fail-open).
 *
 * @param {string} queueName  one of QUEUE_NAMES
 * @param {string} jobName    a job registered in processors.js for that queue
 * @param {object} data       plain JSON payload (NO secrets — failures persist)
 * @param {import('bullmq').JobsOptions} [opts]  per-job overrides
 */
export async function enqueue(queueName, jobName, data, opts = {}) {
  // Gate on the shared client's status as a cheap liveness proxy (same backend).
  if (!ENV.QUEUE_ENABLED || redis?.status !== 'ready') {
    if (ENV.QUEUE_ENABLED) {
      logger.warn('[Queue] Redis unavailable — running %s/%s inline', queueName, jobName);
    }
    return runJobInline(queueName, jobName, data);
  }
  try {
    const job = await getQueue(queueName).add(jobName, data, opts);
    return { enqueued: true, jobId: job.id };
  } catch (err) {
    logger.warn('[Queue] enqueue %s/%s failed (%s) — running inline', queueName, jobName, err.message);
    return runJobInline(queueName, jobName, data);
  }
}

/**
 * Snapshot job counts per queue for the admin Ops dashboard. Read-only; reports
 * `available: false` when the queue layer is disabled or Redis is down (the
 * fail-open inline path is running) rather than throwing.
 */
export async function getQueueStats() {
  const out = {};
  const usable = ENV.QUEUE_ENABLED && redis?.status === 'ready';
  for (const name of Object.values(QUEUE_NAMES)) {
    if (!usable) { out[name] = { available: false }; continue; }
    try {
      const counts = await getQueue(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      out[name] = { available: true, ...counts };
    } catch (err) {
      out[name] = { available: false, error: err.message };
    }
  }
  return out;
}

/** Close all producer queues (graceful shutdown). */
export async function closeQueues() {
  await Promise.allSettled([..._queues.values()].map((q) => q.close()));
  _queues.clear();
}
