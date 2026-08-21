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

/**
 * Which jobs may be DROPPED rather than run on the request path.
 *
 * A SIBLING map on purpose. The obvious shape — making each PROCESSORS value
 * `{ run, critical }` — would break every queued job in production, because
 * worker.js does not go through getProcessor: it reads
 * `PROCESSORS[queueName]?.[job.name]` and calls the value directly
 * (worker.js:28-34). An object is not callable, and no test covers worker.js,
 * so CI would have stayed green all the way to deploy.
 *
 * Anything absent is treated as CRITICAL. A job added later without a thought
 * about its criticality must not become silently droppable.
 */
export const BEST_EFFORT = Object.freeze({
  // A push notification. Losing one during a Redis outage is a farmer missing
  // one alert; running five thousand of them inline instead takes the API down
  // for everyone, farmer and seller alike, for the length of the outage.
  [QUEUE_NAMES.NOTIFICATIONS]: Object.freeze({ 'user-notification': true }),
});

/** True when this job may be shed under load instead of run inline. */
export function isBestEffort(queueName, jobName) {
  return BEST_EFFORT[queueName]?.[jobName] === true;
}

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
