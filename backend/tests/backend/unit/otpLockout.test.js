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

// ── §10 — the in-memory fallback must be bounded ────────────────────────────
// memEntry() creates an entry on every CHECK, not only on a failure, and only
// ever deletes on a successful verification. So an OTP flood against enumerated
// phone numbers while Redis is down grew this Map without limit, one entry per
// number tried — an attacker-controlled key space, which is precisely the shape
// §10 exists to stop.
describe('§10 bounded fallback store', () => {
  test('does not grow without limit as distinct numbers are probed', async () => {
    const { otpLockoutStoreSize } = await import('../../../src/services/otpLockout.service.js');
    for (let i = 0; i < 60_000; i++) {
      await checkOtpLock(`90000${String(i).padStart(5, '0')}`);
    }
    // 60k enumerated numbers against a 50k cap. Before the fix every one stayed.
    expect(otpLockoutStoreSize()).toBeLessThanOrEqual(50_000);
    expect(otpLockoutStoreSize()).toBeGreaterThan(0);
  });

  test('a number under active attack keeps its lockout while the tail is evicted', async () => {
    // The security question this bound raises, answered: does capping hand an
    // attacker their attempts back? No — LRU evicts the COLDEST keys, and a
    // number being attacked is the hottest. It survives; the quiet entries
    // holding long-expired state are what get dropped.
    const { otpLockoutStoreSize } = await import('../../../src/services/otpLockout.service.js');
    const victim = '9111111111';
    await failUntilLocked(victim);
    expect((await checkOtpLock(victim)).locked).toBe(true);

    for (let i = 0; i < 55_000; i++) {
      await checkOtpLock(`92000${String(i).padStart(5, '0')}`);
      // Keep the victim warm the way a real attack would.
      if (i % 5_000 === 0) await checkOtpLock(victim);
    }

    expect(otpLockoutStoreSize()).toBeLessThanOrEqual(50_000);
    expect((await checkOtpLock(victim)).locked).toBe(true);
  });
});
