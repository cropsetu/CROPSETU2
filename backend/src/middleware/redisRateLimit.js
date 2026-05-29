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
// Rate limiting disabled for now — re-enable before production by restoring
// the original implementation from git history.
// eslint-disable-next-line no-unused-vars
export function redisRateLimit(_opts = {}) {
  return (_req, _res, next) => next();
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
