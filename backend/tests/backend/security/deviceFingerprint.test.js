/**
 * Device fingerprinting & multi-account detection (FRAUD-3) — services/deviceLink.service.js.
 *
 * prisma / redis / audit / incident are module-mocked so the linking + cluster
 * detection logic runs without a database. ENV.DEVICE_LINK defaults apply
 * (flagAccounts = 3, lookback 30d).
 *
 * Acceptance covered: a device backing several distinct accounts is detected and
 * the linked cluster is surfaced for review (audit + a FRAUD incident listing the
 * accounts); weak signals and missing device ids do not link (no false clusters).
 */
import { jest } from '@jest/globals';

const upsert = jest.fn().mockResolvedValue({});
const findMany = jest.fn();
const groupBy = jest.fn();
const auditLog = jest.fn().mockResolvedValue(undefined);
const reportSecurityEvent = jest.fn().mockResolvedValue(undefined);
const redisSet = jest.fn().mockResolvedValue('OK');

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { deviceAccountLink: { upsert, findMany, groupBy } },
}));
jest.unstable_mockModule('../../../src/services/audit.service.js', () => ({
  auditLog,
  AUDIT_ACTIONS: { FRAUD_MULTI_ACCOUNT_FLAG: 'FRAUD_MULTI_ACCOUNT_FLAG' },
}));
jest.unstable_mockModule('../../../src/services/incident.service.js', () => ({
  reportSecurityEvent,
}));
jest.unstable_mockModule('../../../src/config/redis.js', () => ({
  default: { status: 'ready', set: redisSet },
}));

const { strongDeviceId, recordDeviceLink, listDeviceClusters } =
  await import('../../../src/services/deviceLink.service.js');
const { ENV } = await import('../../../src/config/env.js');

const FLAG = ENV.DEVICE_LINK.flagAccounts; // default 3
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  upsert.mockClear().mockResolvedValue({});
  findMany.mockReset();
  groupBy.mockReset();
  auditLog.mockClear();
  reportSecurityEvent.mockClear();
  redisSet.mockClear().mockResolvedValue('OK');
});

// ── strong device id ──────────────────────────────────────────────────────────
describe('strongDeviceId', () => {
  test('hashes the X-Device-Id header to a stable token', () => {
    const a = strongDeviceId({ headers: { 'x-device-id': 'install-abc' } });
    const b = strongDeviceId({ headers: { 'x-device-id': 'install-abc' } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });

  test('different device ids → different tokens', () => {
    expect(strongDeviceId({ headers: { 'x-device-id': 'a' } }))
      .not.toBe(strongDeviceId({ headers: { 'x-device-id': 'b' } }));
  });

  test('returns null without a usable X-Device-Id (UA is NOT used for linking)', () => {
    expect(strongDeviceId({ headers: { 'user-agent': 'FarmApp/1.0 (Android 13)' } })).toBeNull();
    expect(strongDeviceId({ headers: { 'x-device-id': '   ' } })).toBeNull();
    expect(strongDeviceId({ headers: {} })).toBeNull();
  });
});

// ── recordDeviceLink ────────────────────────────────────────────────────────────
describe('recordDeviceLink', () => {
  test('no fingerprint (no strong device id) → no-op, nothing recorded', async () => {
    const r = await recordDeviceLink({ userId: 'u1', fingerprint: null, context: 'login' });
    expect(r).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  test('no userId → no-op', async () => {
    const r = await recordDeviceLink({ userId: null, fingerprint: 'fp1', context: 'login' });
    expect(r).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  test('below the flag threshold → recorded, not flagged', async () => {
    findMany.mockResolvedValue(Array.from({ length: FLAG - 1 }, (_, i) => ({ userId: `u${i}` })));
    const r = await recordDeviceLink({ userId: 'u1', fingerprint: 'fp1', ip: '1.2.3.4', context: 'login' });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(r.flagged).toBe(false);
    expect(r.accountCount).toBe(FLAG - 1);
    await flush();
    expect(auditLog).not.toHaveBeenCalled();
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });

  test('reaching the threshold → flagged, audited, and surfaced as a FRAUD incident', async () => {
    const linked = Array.from({ length: FLAG }, (_, i) => ({ userId: `u${i}` }));
    findMany.mockResolvedValue(linked);
    const r = await recordDeviceLink({ userId: 'u0', fingerprint: 'fpHot', ip: '9.9.9.9', context: 'order' });

    expect(r.flagged).toBe(true);
    expect(r.accountCount).toBe(FLAG);
    await flush();
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FRAUD_MULTI_ACCOUNT_FLAG', entity: 'Device', entityId: 'fpHot',
    }));
    expect(redisSet).toHaveBeenCalledWith(expect.stringContaining('fraud:devicelink:inc:fpHot'), '1', 'EX', expect.any(Number), 'NX');
    expect(reportSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: 'FRAUD',
      severity: 'MEDIUM',
      affectedUserIds: linked.map((l) => l.userId),
    }));
  });

  test('incident is suppressed when the dedupe slot is already taken (audit still fires)', async () => {
    findMany.mockResolvedValue(Array.from({ length: FLAG }, (_, i) => ({ userId: `u${i}` })));
    redisSet.mockResolvedValue(null); // SET NX → already held this window
    await recordDeviceLink({ userId: 'u0', fingerprint: 'fpHot', context: 'login' });
    await flush();
    expect(auditLog).toHaveBeenCalled();
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });

  test('never throws — a DB failure is a no-op (login/checkout unaffected)', async () => {
    upsert.mockRejectedValue(new Error('table missing'));
    const r = await recordDeviceLink({ userId: 'u1', fingerprint: 'fp1', context: 'login' });
    expect(r).toBeNull();
  });
});

// ── listDeviceClusters (admin review) ───────────────────────────────────────────
describe('listDeviceClusters', () => {
  test('groups linked accounts per device, newest-busiest first', async () => {
    groupBy.mockResolvedValue([{ fingerprint: 'fpA', _count: { userId: 3 } }]);
    findMany.mockResolvedValue([
      { fingerprint: 'fpA', userId: 'u1', lastSeenAt: new Date(), seenCount: 2, lastContext: 'login' },
      { fingerprint: 'fpA', userId: 'u2', lastSeenAt: new Date(), seenCount: 1, lastContext: 'order' },
      { fingerprint: 'fpA', userId: 'u3', lastSeenAt: new Date(), seenCount: 5, lastContext: 'login' },
    ]);
    const clusters = await listDeviceClusters({ minAccounts: 3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ fingerprint: 'fpA', accountCount: 3 });
    expect(clusters[0].accounts.map((a) => a.userId).sort()).toEqual(['u1', 'u2', 'u3']);
  });

  test('no qualifying clusters → empty array', async () => {
    groupBy.mockResolvedValue([]);
    expect(await listDeviceClusters()).toEqual([]);
  });

  test('never throws — a query failure returns []', async () => {
    groupBy.mockRejectedValue(new Error('db down'));
    expect(await listDeviceClusters()).toEqual([]);
  });
});
