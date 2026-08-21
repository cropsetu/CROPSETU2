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
    expect(cutoffs.mspRates.toISOString()).toBe('2023-06-09T00:00:00.000Z');    // 1095 days (~3y)
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

  test('MSP rates are covered by an expiry policy (unbounded-growth fix)', () => {
    const msp = RETENTION_POLICY.find((p) => p.model === 'mSPRate');
    expect(msp).toBeDefined();
    // Pruned by createdAt (stable vintage), not updatedAt (re-sync would refresh it
    // and keep ancient rows alive forever).
    expect(msp.dateField).toBe('createdAt');
    expect(msp.days).toBe(1095); // ~3 crop years — preserves the multi-year trend
    expect(typeof prisma.mSPRate.deleteMany).toBe('function');
  });
});

// ── Coverage of the tables that actually grow (claude.md §26) ────────────────
// The sweep covered seven categories and none of the fastest-growing tables.
// These pin both halves of the decision: what was added, and what was
// deliberately left out — because the omissions are the part that would
// otherwise read as an oversight and get "fixed" by someone in a hurry.
describe('§26 coverage', () => {
  const byKey = Object.fromEntries(RETENTION_POLICY.map((p) => [p.key, p]));

  test('the regenerable and log-shaped tables are swept', () => {
    expect(byKey.mandiPrices).toMatchObject({ model: 'mandiPrice', dateField: 'priceDate' });
    expect(byKey.errorLogs).toMatchObject({ model: 'errorLog', dateField: 'createdAt' });
    expect(byKey.apiHealthLogs).toMatchObject({ model: 'aPIHealthLog', dateField: 'timestamp' });
  });

  test('mandi prices are aged on the PRICE date, not on when we fetched them', () => {
    // fetchedAt says when we collected a row; priceDate says how old the price
    // is. Only the second is what a farmer or a trend chart cares about.
    expect(byKey.mandiPrices.dateField).toBe('priceDate');
  });

  test('the mandi window is far deeper than anything that reads it', () => {
    // The deepest read in the app looks back 7 days (mandi.routes.js). Keeping a
    // year means this bounds growth without pre-deciding what a future trend
    // feature may want.
    expect(byKey.mandiPrices.days).toBeGreaterThanOrEqual(365);
  });

  test('stock reservations are only swept once TERMINAL', () => {
    // A HELD row is live inventory — units off a shelf that nobody returned.
    // Deleting one loses stock with no trace.
    const statuses = byKey.stockReservations.extraWhere.status.in;
    expect(statuses).toEqual(expect.arrayContaining(['CONSUMED', 'RELEASED', 'EXPIRED']));
    expect(statuses).not.toContain('HELD');
  });

  test("a user's own messages are NOT on a deletion timer", () => {
    // Conversations are the farmer's record of what was agreed about a price or
    // a delivery. Expiring them on a timer withdraws a product promise quietly.
    // They are already hard-deleted on DPDP erasure, which is the right lever.
    const models = RETENTION_POLICY.map((p) => p.model);
    for (const m of ['chatMessage', 'groupMessage', 'directMessage', 'aIMessage', 'voiceMessage']) {
      expect(models).not.toContain(m);
    }
  });

  test('financial records are NOT on a deletion timer', () => {
    // Statutory retention, not a storage question.
    const models = RETENTION_POLICY.map((p) => p.model);
    for (const m of ['order', 'orderItem', 'payment', 'paymentIntent', 'settlement']) {
      expect(models).not.toContain(m);
    }
  });

  test('every policy still names a real Prisma delegate', () => {
    for (const p of RETENTION_POLICY) {
      expect(typeof prisma[p.model]?.deleteMany).toBe('function');
    }
  });

  test('only the entry that needs a status filter has one', () => {
    const withExtra = RETENTION_POLICY.filter((p) => p.extraWhere);
    expect(withExtra.map((p) => p.key)).toEqual(['stockReservations']);
  });
});
