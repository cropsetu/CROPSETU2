/**
 * Velocity-limit middleware (FRAUD-1) — middleware/velocityLimit.js.
 *
 * The velocity engine, audit, incident, env and Redis collaborators are all
 * module-mocked so this exercises ONLY the enforcement + flagging behaviour:
 *   • LIMIT  → 429 + Retry-After, request NOT passed on, event flagged + incident.
 *   • FLAG   → request passes through, event flagged, NO incident.
 *   • allow  → passes through untouched, nothing flagged.
 *   • disabled (VELOCITY_ENABLED=false) → passes through, engine not consulted.
 */
import { jest } from '@jest/globals';

const recordVelocity = jest.fn();
const identitiesFromRequest = jest.fn(() => ({ user: 'u1', device: 'd1', ip: '1.2.3.4' }));
const auditLog = jest.fn().mockResolvedValue(undefined);
const reportSecurityEvent = jest.fn().mockResolvedValue(undefined);
const redisSet = jest.fn().mockResolvedValue('OK');

jest.unstable_mockModule('../../../src/services/velocity.service.js', () => ({
  recordVelocity,
  identitiesFromRequest,
  VELOCITY_ACTIONS: { ORDER: 'order', REFUND: 'refund', LOGIN: 'login' },
}));
jest.unstable_mockModule('../../../src/services/audit.service.js', () => ({
  auditLog,
  AUDIT_ACTIONS: { FRAUD_VELOCITY_FLAG: 'FRAUD_VELOCITY_FLAG', FRAUD_VELOCITY_BLOCK: 'FRAUD_VELOCITY_BLOCK' },
}));
jest.unstable_mockModule('../../../src/services/incident.service.js', () => ({
  reportSecurityEvent,
}));
jest.unstable_mockModule('../../../src/config/redis.js', () => ({
  default: { status: 'ready', set: redisSet },
}));
const mockEnv = { ENV: { VELOCITY_ENABLED: true } };
jest.unstable_mockModule('../../../src/config/env.js', () => mockEnv);

const { velocityGuard, flagVelocity } = await import('../../../src/middleware/velocityLimit.js');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const mockReq = () => ({ id: 'req-1', ip: '1.2.3.4', user: { id: 'u1' }, headers: {} });
const flush = () => new Promise((r) => setImmediate(r));

const ALLOW  = { action: 'order', decision: 'allow', flagged: false, limited: false, counts: {}, signals: [], worstDim: null, worstCount: 0, flagThreshold: 6, limitThreshold: 12, windowSec: 3600, retryAfterSec: 0 };
const FLAG   = { ...ALLOW, decision: 'flag',  flagged: true,  signals: ['velocity:order:user'], worstDim: 'user', worstCount: 6 };
const LIMIT  = { ...ALLOW, decision: 'limit', flagged: true,  limited: true, signals: ['velocity:order:ip'], worstDim: 'ip', worstCount: 12, retryAfterSec: 3600 };

beforeEach(() => {
  recordVelocity.mockReset();
  auditLog.mockClear();
  reportSecurityEvent.mockClear();
  redisSet.mockClear().mockResolvedValue('OK');
  mockEnv.ENV.VELOCITY_ENABLED = true;
});

describe('velocityGuard', () => {
  test('LIMIT → 429 with Retry-After and the request is NOT passed on', async () => {
    recordVelocity.mockResolvedValue(LIMIT);
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await velocityGuard('order')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe(3600);
    expect(res.body.success).toBe(false);
    expect(req.velocity).toBe(LIMIT);
    await flush(); // let fire-and-forget flagging settle
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_VELOCITY_BLOCK' }));
  });

  test('FLAG → request passes through and the event is flagged (no incident)', async () => {
    recordVelocity.mockResolvedValue(FLAG);
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await velocityGuard('order')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    await flush();
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_VELOCITY_FLAG' }));
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });

  test('allow → passes through and nothing is flagged', async () => {
    recordVelocity.mockResolvedValue(ALLOW);
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await velocityGuard('order')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    await flush();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test('disabled → engine is never consulted', async () => {
    mockEnv.ENV.VELOCITY_ENABLED = false;
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await velocityGuard('order')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(recordVelocity).not.toHaveBeenCalled();
  });

  test('a scoring error fails open (request still passes)', async () => {
    recordVelocity.mockRejectedValue(new Error('boom'));
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await velocityGuard('order')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});

describe('flagVelocity', () => {
  test('block tier audits BLOCK and opens a deduped incident', async () => {
    await flagVelocity(mockReq(), 'order', LIMIT);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_VELOCITY_BLOCK', entity: 'Velocity', entityId: 'order' }));
    expect(redisSet).toHaveBeenCalledWith(expect.stringContaining('vel:inc:order'), '1', 'EX', expect.any(Number), 'NX');
    expect(reportSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ category: 'FRAUD', severity: 'MEDIUM' }));
  });

  test('flag tier audits FLAG only — no incident', async () => {
    await flagVelocity(mockReq(), 'order', FLAG);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_VELOCITY_FLAG' }));
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });

  test('incident is suppressed when the dedupe slot is already taken', async () => {
    redisSet.mockResolvedValue(null); // SET NX returns null → slot already held
    await flagVelocity(mockReq(), 'order', LIMIT);
    expect(auditLog).toHaveBeenCalled(); // still audited
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });

  test('uses the explicit actorId when req.user is absent (login flow)', async () => {
    const req = { id: 'r', ip: '1.2.3.4', headers: {} }; // no req.user
    await flagVelocity(req, 'login', { ...FLAG, action: 'login' }, { actorId: 'login-user' });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: 'login-user' }));
  });
});
