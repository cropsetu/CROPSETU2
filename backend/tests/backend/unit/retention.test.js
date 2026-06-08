/**
 * Unit tests for the data-retention policy (DPDP minimisation).
 *   - retentionCutoffs(): pure cutoff-date computation per category
 *   - policy integrity: each entry maps to a real Prisma delegate + sane window
 */
import { jest } from '@jest/globals';

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // env.js requires this at import
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/x';
process.env.JWT_SECRET = 'a'.repeat(32);

const { retentionCutoffs } = await import('../../../src/services/retention.service.js');
const { RETENTION_POLICY, MS_PER_DAY } = await import('../../../src/constants/retention.js');
const { default: prisma } = await import('../../../src/config/db.js');

describe('retentionCutoffs', () => {
  const NOW = new Date('2026-06-08T00:00:00.000Z');
  const cutoffs = retentionCutoffs(NOW);

  test('each category cutoff is exactly now - (days × 1 day)', () => {
    for (const p of RETENTION_POLICY) {
      const expected = new Date(NOW.getTime() - p.days * MS_PER_DAY);
      expect(cutoffs[p.key].toISOString()).toBe(expected.toISOString());
    }
  });

  test('known windows resolve to the right dates', () => {
    expect(cutoffs.otpSessions.toISOString()).toBe('2026-06-07T00:00:00.000Z'); // 1 day
    expect(cutoffs.auditLogs.toISOString()).toBe('2025-06-08T00:00:00.000Z');   // 365 days
  });

  test('all cutoffs are in the past relative to now', () => {
    for (const key of Object.keys(cutoffs)) {
      expect(cutoffs[key].getTime()).toBeLessThan(NOW.getTime());
    }
  });

  test('defaults to current time when now is omitted', () => {
    const c = retentionCutoffs();
    expect(c.otpSessions instanceof Date).toBe(true);
  });
});

describe('RETENTION_POLICY integrity', () => {
  test('keys are unique', () => {
    const keys = RETENTION_POLICY.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every entry has a positive day window and a date field', () => {
    for (const p of RETENTION_POLICY) {
      expect(p.days).toBeGreaterThan(0);
      expect(typeof p.dateField).toBe('string');
      expect(p.dateField.length).toBeGreaterThan(0);
    }
  });

  test('every model maps to a real Prisma delegate with deleteMany + count', () => {
    for (const p of RETENTION_POLICY) {
      const delegate = prisma[p.model];
      expect(delegate).toBeDefined();
      expect(typeof delegate.deleteMany).toBe('function');
      expect(typeof delegate.count).toBe('function');
    }
  });
});
