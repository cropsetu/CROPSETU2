/**
 * Unit tests for the OTP brute-force lockout service.
 *
 * Runs against the in-memory fallback store (Redis is not connected under the
 * test harness), so behaviour is deterministic. Covers: lock after N failures,
 * exponential backoff across cycles, clear-on-verified-reset, and auto-clear on
 * timeout.
 */
import { jest } from '@jest/globals';
import {
  checkOtpLock,
  recordOtpFailure,
  clearOtpLockout,
  resetOtpLockoutStore,
} from '../../../src/services/otpLockout.service.js';
import { ENV } from '../../../src/config/env.js';

const PHONE = '9000000001';

beforeEach(() => {
  resetOtpLockoutStore();
});

async function failUntilLocked(phone) {
  let res;
  for (let i = 0; i < ENV.OTP_LOCK_THRESHOLD; i++) {
    res = await recordOtpFailure(phone);
  }
  return res;
}

test('does not lock before the threshold and reports attemptsRemaining', async () => {
  for (let i = 1; i < ENV.OTP_LOCK_THRESHOLD; i++) {
    const res = await recordOtpFailure(PHONE);
    expect(res.locked).toBe(false);
    expect(res.attemptsRemaining).toBe(ENV.OTP_LOCK_THRESHOLD - i);
  }
  expect((await checkOtpLock(PHONE)).locked).toBe(false);
});

test('locks after the threshold with a positive retry-after', async () => {
  const res = await failUntilLocked(PHONE);
  expect(res.locked).toBe(true);
  expect(res.retryAfterSec).toBeGreaterThan(0);
  expect(res.retryAfterSec).toBe(ENV.OTP_LOCK_BASE_SECONDS); // first cycle = base

  const check = await checkOtpLock(PHONE);
  expect(check.locked).toBe(true);
  expect(check.retryAfterSec).toBeGreaterThan(0);
});

test('exponential backoff grows across successive lock cycles', async () => {
  const c1 = await failUntilLocked(PHONE);
  const c2 = await failUntilLocked(PHONE);
  const c3 = await failUntilLocked(PHONE);

  expect(c1.locked && c2.locked && c3.locked).toBe(true);
  expect(c2.retryAfterSec).toBe(Math.min(ENV.OTP_LOCK_MAX_SECONDS, ENV.OTP_LOCK_BASE_SECONDS * 2));
  expect(c3.retryAfterSec).toBe(Math.min(ENV.OTP_LOCK_MAX_SECONDS, ENV.OTP_LOCK_BASE_SECONDS * 4));
  expect(c2.retryAfterSec).toBeGreaterThan(c1.retryAfterSec);
  expect(c3.retryAfterSec).toBeGreaterThanOrEqual(c2.retryAfterSec);
});

test('clearOtpLockout lifts the lock (verified reset)', async () => {
  await failUntilLocked(PHONE);
  expect((await checkOtpLock(PHONE)).locked).toBe(true);

  await clearOtpLockout(PHONE);
  expect((await checkOtpLock(PHONE)).locked).toBe(false);
});

test('lock auto-clears once the backoff window elapses (timeout)', async () => {
  jest.useFakeTimers();
  try {
    await failUntilLocked(PHONE);
    expect((await checkOtpLock(PHONE)).locked).toBe(true);

    // Advance past the longest possible first-cycle lock.
    jest.advanceTimersByTime((ENV.OTP_LOCK_BASE_SECONDS + 1) * 1000);
    expect((await checkOtpLock(PHONE)).locked).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
