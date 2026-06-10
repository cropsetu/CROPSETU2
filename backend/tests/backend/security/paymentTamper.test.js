/**
 * Payment-amount tamper alarms (FRAUD-6) — services/paymentTamper.service.js.
 *
 * audit, incident and redis are module-mocked. Verifies that a blocked
 * confirmation raises the alarm (audit + deduped FRAUD incident), with severity
 * by mismatch kind, and that alarming never throws.
 *
 * (Blocking itself is the existing PAY-3 behaviour, exercised by the agristore
 * checkout API tests; this covers the alarm FRAUD-6 adds on top.)
 */
import { jest } from '@jest/globals';

const auditLog = jest.fn().mockResolvedValue(undefined);
const reportSecurityEvent = jest.fn().mockResolvedValue(undefined);
const redisSet = jest.fn().mockResolvedValue('OK');

jest.unstable_mockModule('../../../src/services/audit.service.js', () => ({
  auditLog,
  AUDIT_ACTIONS: { FRAUD_PAYMENT_TAMPER: 'FRAUD_PAYMENT_TAMPER' },
}));
jest.unstable_mockModule('../../../src/services/incident.service.js', () => ({
  reportSecurityEvent,
}));
jest.unstable_mockModule('../../../src/config/redis.js', () => ({
  default: { status: 'ready', set: redisSet },
}));

const { raisePaymentTamperAlarm } = await import('../../../src/services/paymentTamper.service.js');

const base = { userId: 'u1', orderRef: 'order_x', paymentRef: 'pay_x', ip: '1.2.3.4', requestId: 'req-1' };

beforeEach(() => {
  auditLog.mockClear();
  reportSecurityEvent.mockClear();
  redisSet.mockClear().mockResolvedValue('OK');
});

test('paid-amount mismatch → audits + opens a MEDIUM FRAUD incident', async () => {
  await raisePaymentTamperAlarm({ ...base, kind: 'paid_amount_mismatch', expectedPaise: 50000, actualPaise: 100 });

  expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
    action: 'FRAUD_PAYMENT_TAMPER', entity: 'Order', entityId: 'order_x',
    metadata: expect.objectContaining({ kind: 'paid_amount_mismatch', expectedPaise: 50000, actualPaise: 100 }),
  }));
  expect(redisSet).toHaveBeenCalledWith(expect.stringContaining('fraud:paytamper:inc:u1'), '1', 'EX', expect.any(Number), 'NX');
  expect(reportSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
    category: 'FRAUD', severity: 'MEDIUM', affectedUserIds: ['u1'],
  }));
});

test('receipt mismatch (payment replay) → MEDIUM incident', async () => {
  await raisePaymentTamperAlarm({ ...base, kind: 'receipt_mismatch', expectedPaise: 50000, actualPaise: 50000 });
  expect(reportSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: 'MEDIUM' }));
});

test('client-total mismatch → LOW severity (often benign drift)', async () => {
  await raisePaymentTamperAlarm({ ...base, kind: 'client_total_mismatch', expectedPaise: 50000, actualPaise: 49900 });
  expect(reportSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: 'LOW' }));
});

test('incident is deduped per user (audit still fires)', async () => {
  redisSet.mockResolvedValue(null); // SET NX → already held this window
  await raisePaymentTamperAlarm({ ...base, kind: 'paid_amount_mismatch', expectedPaise: 1, actualPaise: 2 });
  expect(auditLog).toHaveBeenCalled();
  expect(reportSecurityEvent).not.toHaveBeenCalled();
});

test('never throws — an audit failure is swallowed', async () => {
  auditLog.mockRejectedValue(new Error('db down'));
  await expect(raisePaymentTamperAlarm({ ...base, kind: 'paid_amount_mismatch' })).resolves.toBeUndefined();
});

test('unknown kind falls back to a generic MEDIUM alarm', async () => {
  await raisePaymentTamperAlarm({ ...base, kind: 'something_new' });
  expect(auditLog).toHaveBeenCalled();
  expect(reportSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: 'MEDIUM' }));
});
