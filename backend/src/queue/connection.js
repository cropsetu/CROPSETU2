/**
 * Dedicated Redis connections for BullMQ.
 *
 * BullMQ uses blocking commands (BRPOPLPUSH / BZPOPMIN) and REQUIRES
 * `maxRetriesPerRequest: null` on its connection — the shared app client in
 * config/redis.js uses `maxRetriesPerRequest: 1` (fail-fast so cache/limiter
 * fall-open quickly), which BullMQ rejects. So the queue gets its OWN
 * connections here, reusing the same URL and reconnect backoff.
 *
 * Producers (Queue) may share one connection; each Worker blocks on its
 * connection and so needs its own. `createQueueConnection()` returns a fresh
 * client; `getProducerConnection()` memoises one for the enqueue side.
 */
import Redis from 'ioredis';
import { ENV } from '../config/env.js';
import { reconnectDelay } from '../config/redis.js';
import logger from '../utils/logger.js';

/** A new ioredis connection configured for BullMQ. */
export function createQueueConnection() {
  const conn = new Redis(ENV.REDIS_URL, {
    maxRetriesPerRequest: null, // REQUIRED by BullMQ
    enableReadyCheck: false,
    retryStrategy: reconnectDelay,
    family: 0, // resolve IPv6 too — Railway private networking is IPv6-only
  });
  // Without a listener, ioredis throws 'error' as an unhandled exception during
  // an outage. The queue's own fail-open logic handles unavailability; here we
  // just keep the process alive and leave a breadcrumb.
  conn.on('error', (err) => logger.warn('[Queue] redis connection error: %s', err.message));
  return conn;
}

let _producer = null;
/** Shared producer-side connection (lazily created). */
export function getProducerConnection() {
  if (!_producer) _producer = createQueueConnection();
  return _producer;
}

/** Close the shared producer connection (graceful shutdown). */
export async function closeProducerConnection() {
  if (_producer) {
    await _producer.quit().catch(() => {});
    _producer = null;
  }
}
