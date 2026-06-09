/**
 * Brute-force protection + login risk-signal tests.
 *
 * Acceptance for this finding:
 *   1. Brute-force attempts are blocked — the per-phone OTP lockout locks a
 *      number after the failure threshold (exponential backoff).
 *   2. Risky logins are flagged — a successful login from a new device / IP is
 *      detected against the account's recent history.
 *
 * prisma is module-mocked so the risk assessment runs without a database.
 */
import { jest } from '@jest/globals';

const auditFindMany = jest.fn();
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { auditLog: { findMany: auditFindMany } },
}));

const { assessLoginRisk, deviceKey } = await import('../../../src/services/loginRisk.service.js');
const { recordOtpFailure, checkOtpLock, clearOtpLockout, resetOtpLockoutStore } =
  await import('../../../src/services/otpLockout.service.js');
const { ENV } = await import('../../../src/config/env.js');

// ── Part 1: brute-force is blocked ───────────────────────────────────────────
describe('OTP brute-force lockout', () => {
  const PHONE = '9990008888';
  beforeEach(async () => { resetOtpLockoutStore(); await clearOtpLockout(PHONE); });
  afterAll(async () => { await clearOtpLockout(PHONE); });

  test('a fresh number is not locked', async () => {
    expect((await checkOtpLock(PHONE)).locked).toBe(false);
  });

  test('locks the number once failures reach the threshold', async () => {
    let res;
    for (let i = 0; i < ENV.OTP_LOCK_THRESHOLD; i++) res = await recordOtpFailure(PHONE);
    expect(res.locked).toBe(true);
    expect(res.retryAfterSec).toBeGreaterThan(0);
    expect((await checkOtpLock(PHONE)).locked).toBe(true); // subsequent attempts are blocked
  });

  test('attempts below the threshold report remaining tries (not yet locked)', async () => {
    const res = await recordOtpFailure(PHONE);
    expect(res.locked).toBe(false);
    expect(res.attemptsRemaining).toBe(ENV.OTP_LOCK_THRESHOLD - 1);
  });
});

// ── Part 2: risky logins are flagged ─────────────────────────────────────────
describe('assessLoginRisk', () => {
  const HISTORY_DEVICE = JSON.stringify({ userAgent: 'FarmApp/1.0 (Android 13)' });
  beforeEach(() => auditFindMany.mockReset());

  test('deviceKey normalizes away version numbers', () => {
    expect(deviceKey('FarmApp/1.4.2 (Android 13)')).toBe(deviceKey('FarmApp/2.0.0 (Android 13)'));
  });

  test('first-ever login is the baseline — not risky', async () => {
    auditFindMany.mockResolvedValue([]);
    const r = await assessLoginRisk({ userId: 'u1', ip: '1.2.3.4', userAgent: 'FarmApp/1.0 (Android 13)' });
    expect(r.risky).toBe(false);
    expect(r.firstLogin).toBe(true);
  });

  test('same device + known IP → not risky', async () => {
    auditFindMany.mockResolvedValue([{ ip: '1.2.3.4', metadata: HISTORY_DEVICE }]);
    const r = await assessLoginRisk({ userId: 'u1', ip: '1.2.3.4', userAgent: 'FarmApp/1.5 (Android 13)' });
    expect(r.risky).toBe(false);
  });

  test('new device → risky AND user is notified', async () => {
    auditFindMany.mockResolvedValue([{ ip: '1.2.3.4', metadata: HISTORY_DEVICE }]);
    const r = await assessLoginRisk({ userId: 'u1', ip: '1.2.3.4', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' });
    expect(r.signals).toContain('new_device');
    expect(r.risky).toBe(true);
    expect(r.notify).toBe(true);
  });

  test('new IP only → flagged for audit but NOT push-notified (mobile-IP noise guard)', async () => {
    auditFindMany.mockResolvedValue([{ ip: '1.2.3.4', metadata: HISTORY_DEVICE }]);
    const r = await assessLoginRisk({ userId: 'u1', ip: '203.0.113.77', userAgent: 'FarmApp/1.0 (Android 13)' });
    expect(r.signals).toEqual(['new_ip']);
    expect(r.risky).toBe(true);
    expect(r.notify).toBe(false);
  });

  test('never throws — a DB failure fails open as non-risky', async () => {
    auditFindMany.mockRejectedValue(new Error('db down'));
    const r = await assessLoginRisk({ userId: 'u1', ip: '1.2.3.4', userAgent: 'x' });
    expect(r.risky).toBe(false);
  });
});
