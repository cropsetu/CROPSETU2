/**
 * OTP brute-force lockout — tracks failed verifications per phone and locks the
 * number after too many failures, with exponential backoff across lock cycles.
 *
 * State lives in Redis (shared across instances) keyed by phone:
 *   otp:fail:<phone>      consecutive failure counter (TTL = fail window)
 *   otp:lock:<phone>      lock marker (TTL = current backoff duration)
 *   otp:lockcycle:<phone> number of locks in this cycle window → drives backoff
 *
 * Falls back to an in-process store when Redis is unavailable (dev / test /
 * outage) so a single instance is still protected and tests stay deterministic.
 *
 * Lock clears on: the backoff TTL elapsing (timeout) or clearOtpLockout()
 * (called after a successful verification — the "verified reset").
 */
import redis from '../config/redis.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';

const FAIL_KEY  = (p) => `otp:fail:${p}`;
const LOCK_KEY  = (p) => `otp:lock:${p}`;
const CYCLE_KEY = (p) => `otp:lockcycle:${p}`;

// In-memory fallback: phone -> { fails, failExpiry, lockUntil, cycles, cycleExpiry }
const mem = new Map();

/** Test-only: clear the in-memory store so locks don't leak between test files. */
export function resetOtpLockoutStore() {
  mem.clear();
}

/** Backoff (seconds) for the Nth lock in a cycle window: base × 2^(cycle-1), capped. */
function lockSecondsForCycle(cycle) {
  const secs = ENV.OTP_LOCK_BASE_SECONDS * Math.pow(2, Math.max(0, cycle - 1));
  return Math.min(ENV.OTP_LOCK_MAX_SECONDS, secs);
}

function useRedis() {
  return redis?.status === 'ready';
}

// ── Redis implementation ───────────────────────────────────────────────────────
async function redisCheckLock(phone) {
  const ttlMs = await redis.pttl(LOCK_KEY(phone)); // -2 no key, -1 no expiry
  if (ttlMs > 0) return { locked: true, retryAfterSec: Math.ceil(ttlMs / 1000) };
  return { locked: false, retryAfterSec: 0 };
}

async function redisRecordFailure(phone) {
  const fails = await redis.incr(FAIL_KEY(phone));
  if (fails === 1) await redis.expire(FAIL_KEY(phone), ENV.OTP_FAIL_WINDOW_SECONDS);

  if (fails >= ENV.OTP_LOCK_THRESHOLD) {
    const cycle = await redis.incr(CYCLE_KEY(phone));
    if (cycle === 1) await redis.expire(CYCLE_KEY(phone), ENV.OTP_LOCK_CYCLE_WINDOW_SECONDS);
    const lockSeconds = lockSecondsForCycle(cycle);
    await redis.set(LOCK_KEY(phone), '1', 'EX', lockSeconds);
    await redis.del(FAIL_KEY(phone)); // fresh attempts after the lock lifts
    return { locked: true, retryAfterSec: lockSeconds, lockSeconds, cycle };
  }
  return { locked: false, retryAfterSec: 0, attemptsRemaining: ENV.OTP_LOCK_THRESHOLD - fails };
}

async function redisClear(phone) {
  await redis.del(FAIL_KEY(phone), LOCK_KEY(phone), CYCLE_KEY(phone));
}

// ── In-memory implementation ───────────────────────────────────────────────────
function memEntry(phone, now) {
  let e = mem.get(phone);
  if (!e) {
    e = { fails: 0, failExpiry: 0, lockUntil: 0, cycles: 0, cycleExpiry: 0 };
    mem.set(phone, e);
  }
  if (e.failExpiry && now > e.failExpiry)   { e.fails = 0; e.failExpiry = 0; }
  if (e.cycleExpiry && now > e.cycleExpiry) { e.cycles = 0; e.cycleExpiry = 0; }
  return e;
}

function memCheckLock(phone, now) {
  const e = memEntry(phone, now);
  if (e.lockUntil && now < e.lockUntil) {
    return { locked: true, retryAfterSec: Math.ceil((e.lockUntil - now) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

function memRecordFailure(phone, now) {
  const e = memEntry(phone, now);
  e.fails += 1;
  if (e.fails === 1) e.failExpiry = now + ENV.OTP_FAIL_WINDOW_SECONDS * 1000;

  if (e.fails >= ENV.OTP_LOCK_THRESHOLD) {
    e.cycles += 1;
    if (e.cycles === 1) e.cycleExpiry = now + ENV.OTP_LOCK_CYCLE_WINDOW_SECONDS * 1000;
    const lockSeconds = lockSecondsForCycle(e.cycles);
    e.lockUntil = now + lockSeconds * 1000;
    e.fails = 0;
    e.failExpiry = 0;
    return { locked: true, retryAfterSec: lockSeconds, lockSeconds, cycle: e.cycles };
  }
  return { locked: false, retryAfterSec: 0, attemptsRemaining: ENV.OTP_LOCK_THRESHOLD - e.fails };
}

// ── Public API (Redis when ready, else in-memory) ──────────────────────────────

/** @returns {Promise<{locked:boolean, retryAfterSec:number}>} */
export async function checkOtpLock(phone) {
  if (useRedis()) {
    try { return await redisCheckLock(phone); }
    catch (err) { logger.warn('[OtpLockout] redis checkLock failed, using fallback: %s', err.message); }
  }
  return memCheckLock(phone, Date.now());
}

/**
 * Record a failed verification. Locks the number when the threshold is reached.
 * @returns {Promise<{locked:boolean, retryAfterSec:number, lockSeconds?:number, cycle?:number, attemptsRemaining?:number}>}
 */
export async function recordOtpFailure(phone) {
  if (useRedis()) {
    try { return await redisRecordFailure(phone); }
    catch (err) { logger.warn('[OtpLockout] redis recordFailure failed, using fallback: %s', err.message); }
  }
  return memRecordFailure(phone, Date.now());
}

/** Clear all lockout state for a phone (called after a successful verification). */
export async function clearOtpLockout(phone) {
  if (useRedis()) {
    try { await redisClear(phone); return; }
    catch (err) { logger.warn('[OtpLockout] redis clear failed, using fallback: %s', err.message); }
  }
  mem.delete(phone);
}
