/**
 * Audit-logging tests for sensitive operations.
 *
 * Acceptance for this finding: sensitive actions are auditable — they produce an
 * AuditLog record carrying who/what/when. prisma is module-mocked so we can
 * assert the persisted shape without a database, and confirm auditing is
 * best-effort (a DB failure must never throw into the calling handler).
 */
import { jest } from '@jest/globals';

const create = jest.fn();
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { auditLog: { create } },
}));

const { auditAction, AUDIT_ACTIONS } = await import('../../../src/services/audit.service.js');

const reqFor = () => ({ user: { id: 'admin-1' }, ip: '203.0.113.9', id: 'req-42' });

beforeEach(() => create.mockReset().mockResolvedValue({}));

describe('audit taxonomy (OPS-8 coordination)', () => {
  test('every newly-covered sensitive op has a stable action name', () => {
    expect(AUDIT_ACTIONS.PRODUCT_DELETE).toBe('PRODUCT_DELETE');
    expect(AUDIT_ACTIONS.FEATURE_FLAG_CHANGE).toBe('FEATURE_FLAG_CHANGE');
    expect(AUDIT_ACTIONS.KYC_ACCESS).toBe('KYC_ACCESS');
    expect(AUDIT_ACTIONS.GROUP_MEMBER_REMOVE).toBe('GROUP_MEMBER_REMOVE');
    expect(AUDIT_ACTIONS.CONSENT_CHANGE).toBe('CONSENT_CHANGE');
  });
});

describe('auditAction', () => {
  test('persists actor, action, target, ip and request id', async () => {
    await auditAction(reqFor(), {
      action:   AUDIT_ACTIONS.FEATURE_FLAG_CHANGE,
      entity:   'FeatureFlag',
      entityId: 'mandi_bhav',
      after:    { isEnabled: false },
      metadata: { updatedBy: 'admin-1' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId:    'admin-1',
      action:    'FEATURE_FLAG_CHANGE',
      entity:    'FeatureFlag',
      entityId:  'mandi_bhav',
      ip:        '203.0.113.9',
      requestId: 'req-42',
    });
    // before/after/metadata are JSON-serialized for storage.
    expect(JSON.parse(data.after)).toEqual({ isEnabled: false });
    expect(JSON.parse(data.metadata)).toEqual({ updatedBy: 'admin-1' });
  });

  test('KYC access audit records who accessed whose documents', async () => {
    await auditAction(reqFor(), {
      action:   AUDIT_ACTIONS.KYC_ACCESS,
      entity:   'SellerProfile',
      entityId: 'victim-user-7',
      metadata: { accessedBy: 'admin-1', docCount: 3 },
    });
    const data = create.mock.calls[0][0].data;
    expect(data.action).toBe('KYC_ACCESS');
    expect(data.entityId).toBe('victim-user-7');
    expect(JSON.parse(data.metadata)).toEqual({ accessedBy: 'admin-1', docCount: 3 });
  });

  test('best-effort: a DB failure is swallowed, never thrown to the handler', async () => {
    create.mockRejectedValueOnce(new Error('audit table missing'));
    await expect(
      auditAction(reqFor(), { action: AUDIT_ACTIONS.PRODUCT_DELETE, entity: 'Product', entityId: 'p1' }),
    ).resolves.toBeUndefined();
  });
});
