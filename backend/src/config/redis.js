import Redis from 'ioredis';
import { ENV } from './env.js';
import logger from '../utils/logger.js';

const redis = new Redis(ENV.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy: (times) => (times > 2 ? null : 500),
});

redis.on('connect', () => logger.info('[Redis] Connected'));
redis.on('error', (err) => logger.error('[Redis] Error: %s', err.message));

/**
 * Cache-aside helper: get from Redis, on miss call loader, set with TTL.
 * Returns null silently if Redis is unavailable (graceful degradation).
 */
export async function cacheGet(key) {
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

export async function cacheSet(key, data, ttlSeconds = 300) {
  try {
    await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch { /* Redis optional — swallow */ }
}

export default redis;
