/**
 * Geo-anomaly login detection (FRAUD-4) — services/geoAnomaly.service.js.
 *
 * The pure scorer (scoreGeoAnomaly / impliedSpeedKmh) is tested directly; the IO
 * path (assessLoginGeoAnomaly, flagGeoAnomaly) is exercised with prisma, the
 * IP→geo resolver, push and incident all module-mocked.
 *
 * Acceptance covered: impossible-travel and new-country logins are detected and
 * trigger alert + a FRAUD incident + a step-up action; plausible travel and
 * coarse intra-region jitter do not.
 */
import { jest } from '@jest/globals';

const auditFindMany = jest.fn();
const resolveIpGeo = jest.fn();
const sendPushToUser = jest.fn().mockResolvedValue(undefined);
const reportSecurityEvent = jest.fn().mockResolvedValue(undefined);
const redisSet = jest.fn().mockResolvedValue('OK');

jest.unstable_mockModule('../../../src/config/db.js', () => ({ default: { auditLog: { findMany: auditFindMany } } }));
jest.unstable_mockModule('../../../src/services/geoIp.service.js', () => ({ resolveIpGeo }));
jest.unstable_mockModule('../../../src/services/push.service.js', () => ({ sendPushToUser }));
jest.unstable_mockModule('../../../src/services/incident.service.js', () => ({ reportSecurityEvent }));
jest.unstable_mockModule('../../../src/config/redis.js', () => ({ default: { status: 'ready', set: redisSet } }));

const { impliedSpeedKmh, scoreGeoAnomaly, assessLoginGeoAnomaly, flagGeoAnomaly } =
  await import('../../../src/services/geoAnomaly.service.js');

// Reference coordinates.
const DELHI  = { lat: 28.61, lng: 77.21, country: 'IN' };
const MUMBAI = { lat: 19.07, lng: 72.87, country: 'IN' };
const NYC    = { lat: 40.71, lng: -74.0, country: 'US' };
const MINUTES = (n) => n * 60 * 1000;

beforeEach(() => {
  auditFindMany.mockReset();
  resolveIpGeo.mockReset();
  sendPushToUser.mockClear();
  reportSecurityEvent.mockClear();
  redisSet.mockClear().mockResolvedValue('OK');
});

// ── impliedSpeedKmh ─────────────────────────────────────────────────────────────
describe('impliedSpeedKmh', () => {
  test('far apart in minutes → implausibly fast', () => {
    const t0 = 1_000_000_000_000;
    const v = impliedSpeedKmh({ ...DELHI, at: t0 }, { ...MUMBAI, at: t0 + MINUTES(6) });
    expect(v).toBeGreaterThan(900); // ~1150 km in 0.1 h
  });
  test('same instant but far apart → Infinity', () => {
    const t0 = 1_000_000_000_000;
    expect(impliedSpeedKmh({ ...DELHI, at: t0 }, { ...MUMBAI, at: t0 })).toBe(Infinity);
  });
  test('same place → zero', () => {
    const t0 = 1_000_000_000_000;
    expect(impliedSpeedKmh({ ...DELHI, at: t0 }, { ...DELHI, at: t0 + MINUTES(60) })).toBe(0);
  });
});

// ── scoreGeoAnomaly (pure) ──────────────────────────────────────────────────────
describe('scoreGeoAnomaly', () => {
  const T = 1_000_000_000_000;

  test('no current geo → not anomalous', () => {
    const r = scoreGeoAnomaly({ currGeo: null, currAt: T });
    expect(r.anomalous).toBe(false);
    expect(r.action).toBe('none');
  });

  test('impossible travel → flagged, action step_up', () => {
    const r = scoreGeoAnomaly({ currGeo: MUMBAI, currAt: T + MINUTES(10), prevGeo: DELHI, prevAt: T, knownCountries: ['IN'] });
    expect(r.reasons).toContain('impossible_travel');
    expect(r.anomalous).toBe(true);
    expect(r.action).toBe('step_up');
    expect(r.distanceKm).toBeGreaterThan(500);
  });

  test('plausible travel (hours apart) → not anomalous', () => {
    const r = scoreGeoAnomaly({ currGeo: MUMBAI, currAt: T + MINUTES(240), prevGeo: DELHI, prevAt: T, knownCountries: ['IN'] });
    expect(r.anomalous).toBe(false); // ~1150 km in 4 h ≈ 288 km/h < 900
  });

  test('short hop at high speed but below minKm → NOT impossible (jitter guard)', () => {
    // ~110 km apart, 1 minute → huge speed, but distance < minKm (500) → ignored.
    const near = { lat: 28.61, lng: 78.34, country: 'IN' };
    const r = scoreGeoAnomaly({ currGeo: near, currAt: T + MINUTES(1), prevGeo: DELHI, prevAt: T, knownCountries: ['IN'] });
    expect(r.reasons).not.toContain('impossible_travel');
    expect(r.anomalous).toBe(false);
  });

  test('new country (with prior country history) → flagged, action alert', () => {
    const r = scoreGeoAnomaly({ currGeo: NYC, currAt: T, knownCountries: ['IN'] });
    expect(r.reasons).toEqual(['new_country']);
    expect(r.action).toBe('alert');
  });

  test('first geolocated login (no known countries) → not anomalous', () => {
    const r = scoreGeoAnomaly({ currGeo: NYC, currAt: T, knownCountries: [] });
    expect(r.anomalous).toBe(false);
  });
});

// ── assessLoginGeoAnomaly (IO wiring) ───────────────────────────────────────────
describe('assessLoginGeoAnomaly', () => {
  test('geo unknown (resolver returns null) → inert, history not queried', async () => {
    resolveIpGeo.mockResolvedValue(null);
    const r = await assessLoginGeoAnomaly({ userId: 'u1', ip: '8.8.8.8', at: Date.now() });
    expect(r.anomalous).toBe(false);
    expect(r.currGeo).toBeNull();
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  test('current Mumbai vs prior Delhi minutes ago → impossible travel', async () => {
    resolveIpGeo.mockResolvedValue(MUMBAI);
    auditFindMany.mockResolvedValue([
      { createdAt: new Date(Date.now() - MINUTES(5)), metadata: JSON.stringify({ geo: { country: 'IN', lat: DELHI.lat, lng: DELHI.lng } }) },
    ]);
    const r = await assessLoginGeoAnomaly({ userId: 'u1', ip: '8.8.8.8', at: Date.now() });
    expect(r.reasons).toContain('impossible_travel');
    expect(r.action).toBe('step_up');
    expect(r.currGeo).toEqual(MUMBAI);
  });

  test('never throws — resolver failure → inert', async () => {
    resolveIpGeo.mockRejectedValue(new Error('boom'));
    const r = await assessLoginGeoAnomaly({ userId: 'u1', ip: '8.8.8.8', at: Date.now() });
    expect(r.anomalous).toBe(false);
  });
});

// ── flagGeoAnomaly ──────────────────────────────────────────────────────────────
describe('flagGeoAnomaly', () => {
  const decision = { anomalous: true, reasons: ['impossible_travel'], action: 'step_up', impliedSpeedKmh: 12000, distanceKm: 1150 };

  test('alerts the owner and opens a deduped FRAUD incident', async () => {
    await flagGeoAnomaly('u1', decision, { ip: '8.8.8.8' });
    expect(sendPushToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'SYSTEM' }));
    expect(redisSet).toHaveBeenCalledWith(expect.stringContaining('fraud:geoanomaly:inc:u1'), '1', 'EX', expect.any(Number), 'NX');
    expect(reportSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ category: 'FRAUD', severity: 'MEDIUM', affectedUserIds: ['u1'] }));
  });

  test('incident suppressed when dedupe slot is taken (owner still alerted)', async () => {
    redisSet.mockResolvedValue(null);
    await flagGeoAnomaly('u1', decision, { ip: '8.8.8.8' });
    expect(sendPushToUser).toHaveBeenCalled();
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });
});
