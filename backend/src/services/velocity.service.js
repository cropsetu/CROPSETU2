/**
 * Fraud velocity service (FRAUD-1) — the risk engine behind velocity limits.
 *
 * This is NOT the per-endpoint UX rate limiter (middleware/rateLimit.js). That
 * one caps request RATE per endpoint and returns 429 for traffic shaping. This
 * one tracks the VELOCITY of a small set of fraud-sensitive *actions* (placing
 * orders, refunds/cancellations, successful logins) across three identity
 * dimensions — user, device, IP — and turns the counts into a risk decision:
 *
 *   • flag  — a dimension reached the FLAG threshold → record a fraud signal,
 *             but the action is still allowed through.
 *   • limit — a dimension reached the LIMIT threshold (and the rule blocks) →
 *             the action is rejected AND flagged.
 *
 * The decision uses the WORST (highest-count) dimension, so abuse spread across
 * many fresh accounts from a single device/IP is caught even when each per-user
 * count stays low — which a per-account limiter would miss.
 *
 * Counters are Redis sliding windows (ZSET of event timestamps, one per action ×
 * dimension × identity), shared across instances. When Redis is unavailable
 * (dev / test / outage) it transparently falls back to an in-process store so a
 * single instance is still protected and tests stay deterministic. This engine
 * NEVER throws and ALWAYS fails open (a counter error degrades to "allow") — a
 * fraud-scoring glitch must never take down checkout or login.
 *
 * Thresholds + windows live in ENV.VELOCITY_RULES (config/env.js), tunable per
 * action without code. The flag/block side effects (audit + incident) live in
 * middleware/velocityLimit.js so this module stays a pure, DB-free risk engine.
 *
 * Overlaps COMP-10 (velocity + device fingerprinting feeding risk scoring) and
 * FRAUD-3 (device fingerprinting); deviceFingerprint() here is the shared seam.
 */
import crypto from 'crypto';
import redis from '../config/redis.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';
import { deviceKey } from './loginRisk.service.js';

/** Canonical action keys (must match the keys in ENV.VELOCITY_RULES). */
export const VELOCITY_ACTIONS = Object.freeze({
  ORDER:  'order',
  REFUND: 'refund',
  LOGIN:  'login',
});

// Identity dimensions, scored independently and combined by taking the worst.
const DIMENSIONS = ['user', 'device', 'ip'];

// Keeps ZSET members unique within the same millisecond (mirrors rateLimit.js).
let _seq = 0;

// In-memory fallback: key -> sorted array of event timestamps (ms). Pruned to the
// active window on every access so a key can't outgrow its window's traffic.
const mem = new Map();

/** Test-only: clear the in-memory store so counters don't leak between files. */
export function resetVelocityStore() {
  mem.clear();
}

function useRedis() {
  return redis?.status === 'ready';
}

/**
 * Coarse, stable device fingerprint for the request. Prefers an explicit
 * client-supplied device id (the mobile app may send `X-Device-Id`); otherwise
 * falls back to the version-stripped User-Agent fingerprint (deviceKey). The
 * basis is hashed to a short, key-safe token so we never use a raw UA or an
 * arbitrary client header value as a Redis key (and the length stays bounded).
 * Returns null when there's nothing to fingerprint on.
 */
export function deviceFingerprint(req) {
  const raw = req?.headers?.['x-device-id'];
  const explicit = typeof raw === 'string' ? raw.trim().slice(0, 256) : '';
  const basis = explicit || deviceKey(req?.headers?.['user-agent']);
  if (!basis) return null;
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24);
}

/** Extract the three identity dimensions from an Express request. */
export function identitiesFromRequest(req) {
  return {
    user:   req?.user?.id || null,
    device: deviceFingerprint(req),
    ip:     req?.ip || req?.socket?.remoteAddress || null,
  };
}

// ── Sliding-window record + count (one identity dimension) ───────────────────
// Records THIS event, then returns the surviving count in the window. Unlike the
// UX rate limiter — which skips recording rejected requests so a user can drain
// out of a 429 — fraud velocity records every checked attempt: a persistent
// abuser SHOULD stay over the limit as long as they keep trying, and the global
// per-IP limiter already bounds total request volume (hence the ZSET size).

async function redisRecord(key, windowMs, now) {
  const cutoff = now - windowMs;
  const member = `${now}-${_seq++}`;
  const res = await redis
    .multi()
    .zremrangebyscore(key, 0, cutoff) // drop expired entries
    .zadd(key, now, member)           // record this event
    .zcard(key)                       // surviving count (incl. this one)
    .pexpire(key, windowMs)           // bound key lifetime to the window
    .exec();
  // ioredis multi() → [[err, result], ...]; zcard is the 3rd command.
  const count = res?.[2]?.[1];
  return Number(count) || 0;
}

function memRecord(key, windowMs, now) {
  const cutoff = now - windowMs;
  const hits = (mem.get(key) || []).filter((ts) => ts > cutoff);
  hits.push(now);
  mem.set(key, hits);
  return hits.length;
}

async function recordDimension(key, windowMs, now) {
  if (useRedis()) {
    try {
      return await redisRecord(key, windowMs, now);
    } catch (err) {
      logger.warn('[Velocity] redis record failed, using fallback: %s', err.message);
    }
  }
  return memRecord(key, windowMs, now);
}

/**
 * The shape returned for every assessment. Exported for callers/tests.
 * @typedef {object} VelocityDecision
 * @property {string}  action
 * @property {'allow'|'flag'|'limit'} decision
 * @property {boolean} flagged           — at least one dimension reached FLAG
 * @property {boolean} limited           — worst dimension reached LIMIT (rule blocks)
 * @property {Object.<string,number>} counts  — per-dimension windowed counts
 * @property {string[]} signals          — e.g. ['velocity:order:ip']
 * @property {?string} worstDim
 * @property {number}  worstCount
 * @property {number}  flagThreshold
 * @property {number}  limitThreshold
 * @property {number}  windowSec
 * @property {number}  retryAfterSec
 */

function allowDecision(action, windowSec = 0) {
  return {
    action, decision: 'allow', flagged: false, limited: false,
    counts: {}, signals: [], worstDim: null, worstCount: 0,
    flagThreshold: 0, limitThreshold: 0, windowSec, retryAfterSec: 0,
  };
}

/**
 * Record a sensitive action against its velocity counters and return the risk
 * decision. Never throws.
 *
 * @param {object} p
 * @param {string} p.action      — one of VELOCITY_ACTIONS
 * @param {object} p.identities  — { user?, device?, ip? } (any subset; nulls skipped)
 * @returns {Promise<VelocityDecision>}
 */
export async function recordVelocity({ action, identities = {} } = {}) {
  const rule = ENV.VELOCITY_RULES?.[action];
  // Unknown action / unconfigured rule → nothing to enforce. Fail open.
  if (!rule) return allowDecision(action);

  const windowMs = rule.windowSec * 1000;
  const now = Date.now();
  const counts = {};
  const signals = [];
  let worstCount = 0;
  let worstDim = null;

  for (const dim of DIMENSIONS) {
    const id = identities[dim];
    if (!id) continue; // dimension absent (e.g. no device id) → skip, don't block

    const key = `vel:${action}:${dim}:${id}`;
    let count;
    try {
      count = await recordDimension(key, windowMs, now);
    } catch (err) {
      // Belt-and-braces: recordDimension already falls back, but never let a
      // single dimension failure break the whole assessment.
      logger.warn('[Velocity] %s/%s assessment skipped: %s', action, dim, err.message);
      continue;
    }

    counts[dim] = count;
    if (rule.flag > 0 && count >= rule.flag) signals.push(`velocity:${action}:${dim}`);
    if (count > worstCount) { worstCount = count; worstDim = dim; }
  }

  const flagged = signals.length > 0;
  const limited = rule.block && rule.limit > 0 && worstCount >= rule.limit;

  return {
    action,
    decision: limited ? 'limit' : flagged ? 'flag' : 'allow',
    flagged,
    limited,
    counts,
    signals,
    worstDim,
    worstCount,
    flagThreshold: rule.flag,
    limitThreshold: rule.limit,
    windowSec: rule.windowSec,
    // Conservative: the worst dimension's window fully drains within windowSec of
    // the last recorded attempt. Honest for a real abuser; thresholds are set
    // high enough that a legitimate user is very unlikely to ever see this.
    retryAfterSec: limited ? rule.windowSec : 0,
  };
}
