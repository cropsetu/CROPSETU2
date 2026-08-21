/**
 * Sliding-window rate limiting middleware.
 *
 * Backed by Redis sorted sets (a ZSET of request timestamps per key) so the
 * limit is shared across every API instance. When Redis is unavailable
 * (dev / test / outage) it transparently falls back to an in-process store so a
 * single instance is still protected and tests stay deterministic.
 *
 * Each limiter is a true sliding window: one ZSET entry per request scored by
 * its timestamp, expired entries (older than `windowMs`) are dropped, and the
 * request is rejected once the surviving count reaches `max`. Rejected requests
 * are NOT recorded, so a flood can't keep extending its own window.
 */
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { BoundedMap } from '../utils/boundedMap.js';
import { sendError } from '../utils/response.js';

// Counter to keep ZSET members unique within the same millisecond.
let seq = 0;

// ── In-memory fallback store ───────────────────────────────────────────────────
// key -> sorted array of hit timestamps (ms). Pruned on every access so it can
// only grow to `max` entries per active key.
//
// The VALUES were always bounded (at most `max` timestamps each); the KEY SET
// was not. Every distinct IP or user seen while Redis was unavailable minted an
// entry that was never removed, so one Redis outage under a flood grew this map
// for the life of the process. `MEM_MAX_KEYS` caps it: at capacity the
// least-recently-seen key is evicted first — i.e. the least active client.
//
// Deliberately NO TTL. The longest window in use is OTP_RATE_LIMIT_WINDOW_MS
// (1 h), and expiring a bucket early would *weaken* a security control by
// handing back attempts. The trade-off this accepts: during a flood of more
// than MEM_MAX_KEYS distinct keys, with Redis down, the coldest buckets are
// evicted and those clients get a fresh allowance. Bounded memory is worth more
// than perfect fidelity in a fallback path that is already per-instance.
const MEM_MAX_KEYS = 50_000;
const memHits = new BoundedMap({ maxSize: MEM_MAX_KEYS });

/**
 * Test-only: clear the in-memory fallback store so rate-limit counters don't
 * leak between test files that share a worker process. No-op against Redis.
 */
export function resetRateLimitStore() {
  memHits.clear();
}

/**
 * Test-only: live key count in the in-memory fallback store, so the LRU bound
 * above can be asserted rather than assumed. No-op against Redis.
 */
export function rateLimitStoreSize() {
  return memHits.size;
}

function memCheck(key, windowMs, max, now) {
  const cutoff = now - windowMs;
  const hits = (memHits.get(key) || []).filter((ts) => ts > cutoff);
  if (hits.length >= max) {
    memHits.set(key, hits);
    return { limited: true, count: hits.length, retryAfterMs: hits[0] + windowMs - now };
  }
  hits.push(now);
  memHits.set(key, hits);
  return { limited: false, count: hits.length, retryAfterMs: 0 };
}

// Prune, count, and admit-or-refuse as ONE server-side operation.
//
// This was four sequential round trips with a gap between the ZCARD and the
// ZADD, so N concurrent requests could all read the same count and all be
// admitted — the classic check-then-act race, and the more concurrency an
// attacker brings the more the limit leaks. 500 parallel uploads against a
// 200/hour ceiling is trivial to arrange over HTTP/2, and this is the control
// standing in front of a billed Cloudinary account.
//
// Collapsing it into Lua fixes the race AND cuts the per-request Redis cost:
// every authenticated request pays this limiter, so three saved round trips is
// three fewer per request across the whole fleet.
//
// Returns {limited, count, oldestScore} — oldestScore only matters when limited.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local max = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)

if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {1, count, oldest[2] or tostring(now)}
end

redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, windowMs)
return {0, count + 1, '0'}
`;

async function redisCheck(key, windowMs, max, now) {
  const member = `${now}-${seq++}`;
  const [limited, count, oldestRaw] = await redis.eval(
    SLIDING_WINDOW_LUA, 1, key,
    String(now), String(windowMs), String(max), member,
  );

  if (Number(limited) === 1) {
    const oldestScore = Number(oldestRaw) || now;
    return { limited: true, count: Number(count), retryAfterMs: oldestScore + windowMs - now };
  }
  return { limited: false, count: Number(count), retryAfterMs: 0 };
}

async function check(key, windowMs, max, now) {
  if (redis?.status === 'ready') {
    try {
      return await redisCheck(key, windowMs, max, now);
    } catch (err) {
      logger.warn('[RateLimit] Redis check failed, using in-memory fallback: %s', err.message);
    }
  }
  return memCheck(key, windowMs, max, now);
}

/**
 * Resolve the client IP to key per-IP limits on.
 *
 * Uses Express's req.ip, which is the trust-proxy-resolved client address: with
 * `app.set('trust proxy', <hops>)` configured (see app.js) Express walks
 * X-Forwarded-For from the RIGHT and returns the first hop the trusted proxy
 * chain did not add — an address the client cannot forge. Keying on raw
 * left-most XFF (the previous behaviour) trusted a client-controlled value, so a
 * flood could mint a fresh bucket per request and bypass the limiter entirely.
 *
 * Falls back to the socket peer when req.ip is somehow unset (e.g. non-HTTP
 * harness). Returns null when nothing is resolvable so the limiter skips rather
 * than collapsing every caller onto one shared key.
 */
export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

/**
 * Build a sliding-window rate-limit middleware.
 *
 * @param {object} opts
 * @param {number} opts.windowMs              window length in ms
 * @param {number} opts.max                   max requests allowed per key per window
 * @param {string} opts.prefix                Redis key namespace (e.g. 'otp:phone')
 * @param {(req)=>string|null} opts.key       derives the limit key from the request;
 *                                            return null to skip limiting this request
 * @param {string} [opts.message]             429 body message
 */
export function rateLimiter({ windowMs, max, prefix, key, message }) {
  return async (req, res, next) => {
    let id;
    try {
      id = key(req);
    } catch {
      id = null;
    }
    // Nothing to key on (e.g. malformed/absent phone) → let downstream
    // validation produce the proper 422 instead of rate-limiting blind.
    if (!id) return next();

    const fullKey = `rl:${prefix}:${id}`;
    const now = Date.now();

    let result;
    try {
      result = await check(fullKey, windowMs, max, now);
    } catch (err) {
      // Never let the limiter take down the endpoint — fail open.
      logger.warn('[RateLimit] check errored, allowing request: %s', err.message);
      return next();
    }

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - result.count));

    if (result.limited) {
      const retryAfter = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.setHeader('Retry-After', retryAfter);
      return sendError(
        res,
        message || 'Too many requests. Please try again later.',
        429,
        { retryAfter }
      );
    }
    next();
  };
}
