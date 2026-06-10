/**
 * Fraud velocity engine (FRAUD-1) — services/velocity.service.js.
 *
 * Drives the engine through its in-memory fallback (Redis is not "ready" under
 * the test runner, exactly like the OTP-lockout suite) so the threshold logic is
 * exercised deterministically without a database or Redis.
 *
 * Acceptance covered: actions above the per-user/device/IP thresholds are
 * flagged, and above the limit they are limited — including abuse spread across
 * many accounts from a single IP, which a per-account limiter would miss.
 */
import { jest } from '@jest/globals';

const {
  recordVelocity,
  deviceFingerprint,
  identitiesFromRequest,
  resetVelocityStore,
  VELOCITY_ACTIONS,
} = await import('../../../src/services/velocity.service.js');
const { ENV } = await import('../../../src/config/env.js');

const ORDER = ENV.VELOCITY_RULES.order;   // { windowSec, flag, limit, block:true }
const LOGIN = ENV.VELOCITY_RULES.login;   // flag-only (limit 0, block false)

beforeEach(() => resetVelocityStore());

// ── Device fingerprint ───────────────────────────────────────────────────────
describe('deviceFingerprint', () => {
  test('stable for the same User-Agent, ignoring version bumps', () => {
    const a = deviceFingerprint({ headers: { 'user-agent': 'FarmApp/1.4.2 (Android 13)' } });
    const b = deviceFingerprint({ headers: { 'user-agent': 'FarmApp/2.0.0 (Android 13)' } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });

  test('prefers an explicit X-Device-Id over the User-Agent', () => {
    const withId = deviceFingerprint({ headers: { 'x-device-id': 'device-123', 'user-agent': 'FarmApp/1.0' } });
    const uaOnly = deviceFingerprint({ headers: { 'user-agent': 'FarmApp/1.0' } });
    expect(withId).not.toBe(uaOnly);
    // Same explicit id → same fingerprint regardless of UA.
    expect(withId).toBe(deviceFingerprint({ headers: { 'x-device-id': 'device-123', 'user-agent': 'Other/9' } }));
  });

  test('returns null when there is nothing to fingerprint on', () => {
    expect(deviceFingerprint({ headers: {} })).toBeNull();
    expect(deviceFingerprint({})).toBeNull();
  });
});

describe('identitiesFromRequest', () => {
  test('extracts user / device / ip', () => {
    const ids = identitiesFromRequest({
      user: { id: 'u1' }, ip: '1.2.3.4', headers: { 'user-agent': 'FarmApp/1.0' },
    });
    expect(ids.user).toBe('u1');
    expect(ids.ip).toBe('1.2.3.4');
    expect(ids.device).toMatch(/^[0-9a-f]{24}$/);
  });
});

// ── Threshold decisions ────────────────────────────────────────────────────────
describe('recordVelocity — order rule (flag → limit)', () => {
  const run = (n, identities) => {
    let r;
    return (async () => {
      for (let i = 0; i < n; i++) r = await recordVelocity({ action: VELOCITY_ACTIONS.ORDER, identities });
      return r;
    })();
  };

  test('below the flag threshold → allow', async () => {
    const r = await run(ORDER.flag - 1, { user: 'u1' });
    expect(r.decision).toBe('allow');
    expect(r.flagged).toBe(false);
    expect(r.limited).toBe(false);
    expect(r.counts.user).toBe(ORDER.flag - 1);
  });

  test('reaching the flag threshold → flagged, still allowed', async () => {
    const r = await run(ORDER.flag, { user: 'u1' });
    expect(r.flagged).toBe(true);
    expect(r.limited).toBe(false);
    expect(r.decision).toBe('flag');
    expect(r.signals).toContain(`velocity:${VELOCITY_ACTIONS.ORDER}:user`);
    expect(r.worstDim).toBe('user');
  });

  test('reaching the limit threshold → limited + flagged, with Retry-After', async () => {
    const r = await run(ORDER.limit, { user: 'u1' });
    expect(r.limited).toBe(true);
    expect(r.flagged).toBe(true);
    expect(r.decision).toBe('limit');
    expect(r.retryAfterSec).toBe(ORDER.windowSec);
  });

  test('IP dimension catches multi-account abuse from one network', async () => {
    // Each call is a DIFFERENT fresh user, but the same IP — per-user counts stay
    // at 1 while the IP count climbs to the flag threshold.
    let r;
    for (let i = 0; i < ORDER.flag; i++) {
      r = await recordVelocity({ action: VELOCITY_ACTIONS.ORDER, identities: { user: `u${i}`, ip: '9.9.9.9' } });
    }
    expect(r.counts.user).toBe(1);
    expect(r.counts.ip).toBe(ORDER.flag);
    expect(r.flagged).toBe(true);
    expect(r.signals).toContain(`velocity:${VELOCITY_ACTIONS.ORDER}:ip`);
    expect(r.worstDim).toBe('ip');
  });
});

describe('recordVelocity — login rule (flag-only)', () => {
  test('flags past the threshold but NEVER limits (limit 0 / block false)', async () => {
    let r;
    for (let i = 0; i < LOGIN.flag + 5; i++) {
      r = await recordVelocity({ action: VELOCITY_ACTIONS.LOGIN, identities: { user: 'u1', ip: '1.2.3.4' } });
    }
    expect(r.flagged).toBe(true);
    expect(r.limited).toBe(false);
    expect(r.decision).toBe('flag');
    expect(r.retryAfterSec).toBe(0);
  });
});

describe('recordVelocity — robustness', () => {
  test('unknown / unconfigured action fails open as allow', async () => {
    const r = await recordVelocity({ action: 'not_a_real_action', identities: { user: 'u1' } });
    expect(r.decision).toBe('allow');
    expect(r.flagged).toBe(false);
    expect(r.limited).toBe(false);
  });

  test('no identities → nothing to key on → allow', async () => {
    const r = await recordVelocity({ action: VELOCITY_ACTIONS.ORDER, identities: {} });
    expect(r.decision).toBe('allow');
    expect(r.counts).toEqual({});
  });

  test('resetVelocityStore isolates counters between runs', async () => {
    await recordVelocity({ action: VELOCITY_ACTIONS.ORDER, identities: { user: 'u1' } });
    resetVelocityStore();
    const r = await recordVelocity({ action: VELOCITY_ACTIONS.ORDER, identities: { user: 'u1' } });
    expect(r.counts.user).toBe(1);
  });
});
