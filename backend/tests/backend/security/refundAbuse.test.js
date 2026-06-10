/**
 * Refund-abuse guard (FRAUD-2 / COMP-5) — middleware/refundAbuseGuard.js.
 *
 * The assessment engine, audit, incident, env and Redis collaborators are all
 * module-mocked so this exercises ONLY the restrict + flagging behaviour:
 *   • RESTRICT → 403, request NOT passed on, account flagged + incident (FRAUD).
 *   • FLAG     → request passes through, account flagged, NO incident.
 *   • ok       → passes through untouched, nothing flagged.
 *   • disabled / unauthenticated → passes through, engine not consulted.
 */
import { jest } from '@jest/globals';

const assessRefundAbuse = jest.fn();
const auditLog = jest.fn().mockResolvedValue(undefined);
const reportSecurityEvent = jest.fn().mockResolvedValue(undefined);
const redisSet = jest.fn().mockResolvedValue('OK');

jest.unstable_mockModule('../../../src/services/refundAbuse.service.js', () => ({
  assessRefundAbuse,
  REFUND_STATUSES: ['CANCELLED', 'REFUNDED'],
}));
jest.unstable_mockModule('../../../src/services/audit.service.js', () => ({
  auditLog,
  AUDIT_ACTIONS: { FRAUD_REFUND_ABUSE_FLAG: 'FRAUD_REFUND_ABUSE_FLAG', FRAUD_REFUND_ABUSE_RESTRICT: 'FRAUD_REFUND_ABUSE_RESTRICT' },
}));
jest.unstable_mockModule('../../../src/services/incident.service.js', () => ({
  reportSecurityEvent,
}));
jest.unstable_mockModule('../../../src/config/redis.js', () => ({
  default: { status: 'ready', set: redisSet },
}));
const mockEnv = { ENV: { REFUND_ABUSE_ENABLED: true } };
jest.unstable_mockModule('../../../src/config/env.js', () => mockEnv);

const { refundAbuseGuard, flagRefundAbuse } = await import('../../../src/middleware/refundAbuseGuard.js');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const mockReq = () => ({ id: 'req-1', ip: '1.2.3.4', user: { id: 'u1' } });
const flush = () => new Promise((r) => setImmediate(r));

const BASE = { orders: 10, lookbackDays: 90, flagCount: 3, flagRate: 0.5, restrictCount: 5, restrictRate: 0.7 };
const OK       = { ...BASE, decision: 'ok',       flagged: false, restricted: false, refunds: 1, rate: 0.1 };
const FLAG     = { ...BASE, decision: 'flag',     flagged: true,  restricted: false, refunds: 3, rate: 0.5 };
const RESTRICT = { ...BASE, decision: 'restrict', flagged: true,  restricted: true,  refunds: 7, rate: 0.7 };

beforeEach(() => {
  assessRefundAbuse.mockReset();
  auditLog.mockClear();
  reportSecurityEvent.mockClear();
  redisSet.mockClear().mockResolvedValue('OK');
  mockEnv.ENV.REFUND_ABUSE_ENABLED = true;
});

describe('refundAbuseGuard', () => {
  test('RESTRICT → 403 and the request is NOT passed on', async () => {
    assessRefundAbuse.mockResolvedValue(RESTRICT);
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await refundAbuseGuard()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.details).toEqual({ reason: 'refund_abuse' });
    expect(req.refundAbuse).toBe(RESTRICT);
    await flush();
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_REFUND_ABUSE_RESTRICT' }));
  });

  test('FLAG → request passes through and the account is flagged (no incident)', async () => {
    assessRefundAbuse.mockResolvedValue(FLAG);
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await refundAbuseGuard()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    await flush();
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_REFUND_ABUSE_FLAG' }));
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });

  test('ok → passes through and nothing is flagged', async () => {
    assessRefundAbuse.mockResolvedValue(OK);
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await refundAbuseGuard()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    await flush();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test('disabled → engine is never consulted', async () => {
    mockEnv.ENV.REFUND_ABUSE_ENABLED = false;
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await refundAbuseGuard()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(assessRefundAbuse).not.toHaveBeenCalled();
  });

  test('unauthenticated → passes through without assessing', async () => {
    const req = { id: 'r', ip: '1.2.3.4' }; // no req.user
    const res = mockRes(); const next = jest.fn();

    await refundAbuseGuard()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(assessRefundAbuse).not.toHaveBeenCalled();
  });

  test('a scoring error fails open (request still passes)', async () => {
    assessRefundAbuse.mockRejectedValue(new Error('boom'));
    const req = mockReq(); const res = mockRes(); const next = jest.fn();

    await refundAbuseGuard()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});

describe('flagRefundAbuse', () => {
  test('restrict tier audits RESTRICT and opens a deduped FRAUD incident', async () => {
    await flagRefundAbuse(mockReq(), RESTRICT);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_REFUND_ABUSE_RESTRICT', entity: 'User' }));
    expect(redisSet).toHaveBeenCalledWith(expect.stringContaining('fraud:refundabuse:inc:u1'), '1', 'EX', expect.any(Number), 'NX');
    expect(reportSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ category: 'FRAUD', severity: 'MEDIUM' }));
  });

  test('flag tier audits FLAG only — no incident', async () => {
    await flagRefundAbuse(mockReq(), FLAG);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_REFUND_ABUSE_FLAG' }));
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });

  test('incident is suppressed when the dedupe slot is already taken', async () => {
    redisSet.mockResolvedValue(null); // SET NX returns null → already held this window
    await flagRefundAbuse(mockReq(), RESTRICT);
    expect(auditLog).toHaveBeenCalled();
    expect(reportSecurityEvent).not.toHaveBeenCalled();
  });
});
