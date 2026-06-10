/**
 * Job processor registry — the single source of truth mapping
 * (queue → job name → handler). Used both by the worker (config/queue/worker.js)
 * to process queued jobs and by the enqueue() fail-open path to run a job inline
 * when Redis is unavailable, so the SAME code runs either way.
 *
 * Handlers must be idempotent-friendly and self-contained: they receive only the
 * plain JSON job payload (no request context), and any error they throw triggers
 * BullMQ's retry/backoff. Never put secrets in a payload — failed jobs are
 * retained in Redis for inspection.
 */
import { deliverUserNotification } from '../services/push.service.js';

export const QUEUE_NAMES = Object.freeze({
  NOTIFICATIONS: 'notifications',
});

// queueName → { jobName → handler(data) }
export const PROCESSORS = Object.freeze({
  [QUEUE_NAMES.NOTIFICATIONS]: {
    // Deliver an in-app + push notification to a user. `deliverUserNotification`
    // is referenced lazily (call time) so the push.service ⇄ queue import cycle
    // resolves cleanly.
    'user-notification': (data) => deliverUserNotification(data),
  },
});

/** Look up a handler; throws if the (queue, job) pair is unregistered. */
export function getProcessor(queueName, jobName) {
  const fn = PROCESSORS[queueName]?.[jobName];
  if (!fn) throw new Error(`No processor registered for ${queueName}/${jobName}`);
  return fn;
}

/** Run a job synchronously in-process (enqueue fail-open path). */
export async function runJobInline(queueName, jobName, data) {
  await getProcessor(queueName, jobName)(data);
  return { enqueued: false, ranInline: true };
}
