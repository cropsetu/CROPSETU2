/**
 * Redis-backed rate limiter — works across multiple Node.js processes.
 *
 * The default `express-rate-limit` uses in-memory storage, which means each
 * process has its own counter. In a clustered deployment (PM2, Kubernetes),
 * a user can bypass limits by hitting different processes.
 *
 * This middleware uses Redis INCR + EXPIRE for atomic, cross-process counters.
 * Falls back to permissive behavior if Redis is unavailable.
 *
 * Usage:
 *   import { redisRateLimit } from '../middleware/redisRateLimit.js';
 *   router.post('/expensive', redisRateLimit({ max: 10, windowSec: 60 }), handler);
 */
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { sendError } from '../utils/response.js';

// Keeps ZSET members unique within the same millisecond.
let _seq = 0;

/**
 * Redis ZSET sliding-window check (shared across every instance). One entry per
 * request scored by timestamp; expired entries are dropped; the request is
 * rejected once the surviving count reaches `max`. Rejected requests are NOT
 * recorded, so a flood can't keep extending its own window.
 */
async function slidingWindow(key, windowMs, max, now) {
  const cutoff = now - windowMs;
  await redis.zremrangebyscore(key, 0, cutoff);
  const count = await redis.zcard(key);
  if (count >= max) {
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES'); // [member, score]
    const oldestScore = oldest.length ? Number(oldest[1]) : now;
    return { limited: true, retryAfterMs: oldestScore + windowMs - now };
  }
  await redis.multi().zadd(key, now, `${now}-${_seq++}`).pexpire(key, windowMs).exec();
  return { limited: false, retryAfterMs: 0 };
}

/**
 * Per-user/IP sliding-window rate limiter, shared across instances via Redis.
 * Fails OPEN (allows + logs) when Redis is unavailable so a blip never takes the
 * endpoint down. Keep the client-side cooldown as a UX nicety; THIS is the
 * server-side source of truth.
 *
 * @param {object} opts
 * @param {number} opts.max        — max requests per window
 * @param {number} opts.windowSec  — window size in seconds
 * @param {string} [opts.prefix]   — Redis key prefix
 * @param {function} [opts.keyGenerator] — (req) => string
 * @param {string} [opts.message]  — error message on limit hit
 */
export function redisRateLimit(opts = {}) {
  const {
    max = 30,
    windowSec = 60,
    prefix = 'rl:ai',
    keyGenerator = (req) => req.user?.id || req.ip,
    message = 'Too many requests. Please wait a minute.',
  } = opts;
  const windowMs = windowSec * 1000;

  return async (req, res, next) => {
    let id;
    try { id = keyGenerator(req); } catch { id = null; }
    if (!id) return next();                 // nothing to key on → don't block

    // Redis not connected (dev / outage) → fail open.
    if (redis?.status !== 'ready') return next();

    try {
      const { limited, retryAfterMs } = await slidingWindow(`${prefix}:${id}`, windowMs, max, Date.now());
      res.setHeader('RateLimit-Limit', max);
      if (limited) {
        const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
        res.setHeader('Retry-After', retryAfter);
        return sendError(res, message, 429, { retryAfter });
      }
    } catch (err) {
      logger.warn('[RateLimit] %s check failed, allowing request: %s', prefix, err.message);
    }
    return next();
  };
}

/**
 * Per-user rate limiter for AI endpoints.
 * Enforces stricter limits than the global rate limiter.
 */
export const aiChatLimit = redisRateLimit({
  max: 30,
  windowSec: 60,
  prefix: 'rl:ai:chat',
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Too many AI chat requests. Please wait a minute.',
});

export const aiScanLimit = redisRateLimit({
  max: 100,
  windowSec: 60,
  prefix: 'rl:ai:scan',
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Too many scan requests. Please wait a minute.',
});

export const aiVoiceLimit = redisRateLimit({
  max: 15,
  windowSec: 60,
  prefix: 'rl:ai:voice',
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Too many voice requests. Please wait a minute.',
});
