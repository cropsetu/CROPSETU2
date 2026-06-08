/**
 * Unit tests for the security-incident service — pure logic only (no DB).
 *   - computeNotificationRequirement(): when the §8(6) duty triggers + deadline
 *   - incidentReference(): human-friendly reference derivation
 *   - delegate integrity: the Prisma models exist
 */
import { jest } from '@jest/globals';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/x';
process.env.JWT_SECRET = 'a'.repeat(32);

const { computeNotificationRequirement, incidentReference, NOTIFY_WINDOW_HOURS } =
  await import('../../../src/services/incident.service.js');
const { default: prisma } = await import('../../../src/config/db.js');

describe('computeNotificationRequirement', () => {
  const detectedAt = new Date('2026-06-08T00:00:00.000Z');

  test('breach-class categories always require notification', () => {
    for (const category of ['DATA_BREACH', 'PII_EXPOSURE', 'ACCOUNT_TAKEOVER', 'SYSTEM_COMPROMISE']) {
      const { required } = computeNotificationRequirement({ category, severity: 'LOW', detectedAt });
      expect(required).toBe(true);
    }
  });

  test('high/critical severity requires notification regardless of category', () => {
    expect(computeNotificationRequirement({ category: 'OTHER', severity: 'HIGH', detectedAt }).required).toBe(true);
    expect(computeNotificationRequirement({ category: 'OTHER', severity: 'CRITICAL', detectedAt }).required).toBe(true);
  });

  test('low-impact, non-breach incidents do not require notification', () => {
    const { required, notifyDueAt } = computeNotificationRequirement({ category: 'VULNERABILITY', severity: 'LOW', detectedAt });
    expect(required).toBe(false);
    expect(notifyDueAt).toBeNull();
  });

  test('deadline is detectedAt + NOTIFY_WINDOW_HOURS when required', () => {
    const { notifyDueAt } = computeNotificationRequirement({ category: 'DATA_BREACH', severity: 'CRITICAL', detectedAt });
    const expected = new Date(detectedAt.getTime() + NOTIFY_WINDOW_HOURS * 3600 * 1000);
    expect(notifyDueAt.toISOString()).toBe(expected.toISOString());
  });
});

describe('incidentReference', () => {
  test('derives a stable INC- reference from a uuid', () => {
    expect(incidentReference('1a2b3c4d-5e6f-7080-9000-abcdef123456')).toBe('INC-1A2B3C4D');
  });

  test('is deterministic for the same id', () => {
    const id = 'ffffffff-0000-0000-0000-000000000000';
    expect(incidentReference(id)).toBe(incidentReference(id));
  });
});

describe('Prisma incident delegates exist', () => {
  test('securityIncident + incidentUpdate are usable delegates', () => {
    expect(typeof prisma.securityIncident.create).toBe('function');
    expect(typeof prisma.securityIncident.findMany).toBe('function');
    expect(typeof prisma.incidentUpdate.create).toBe('function');
  });
});
