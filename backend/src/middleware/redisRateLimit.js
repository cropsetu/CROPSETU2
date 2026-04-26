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
import { sendError } from '../utils/response.js';

/**
 * @param {object} opts
 * @param {number} opts.max        — max requests per window
 * @param {number} opts.windowSec  — window size in seconds
 * @param {string} [opts.prefix]   — Redis key prefix
 * @param {function} [opts.keyGenerator] — (req) => string
 * @param {string} [opts.message]  — error message on limit hit
 */
export function redisRateLimit({
  max = 60,
  windowSec = 60,
  prefix = 'rl',
  keyGenerator = null,
  message = 'Too many requests. Please try again later.',
} = {}) {
  return async (req, res, next) => {
    try {
      const key = `${prefix}:${keyGenerator ? keyGenerator(req) : (req.user?.id || req.ip)}`;

      const count = await redis.incr(key);

      // Set expiry on first request in the window
      if (count === 1) {
        await redis.expire(key, windowSec);
      }

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        const ttl = await redis.ttl(key);
        res.setHeader('Retry-After', ttl > 0 ? ttl : windowSec);
        return sendError(res, message, 429);
      }

      next();
    } catch {
      // Redis unavailable — fail open (allow the request)
      // In-memory express-rate-limit still provides baseline protection
      next();
    }
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
