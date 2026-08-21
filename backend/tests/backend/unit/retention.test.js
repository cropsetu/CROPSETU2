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
const { RETENTION_POLICY, MS_PER_DAY, AI_SCAN_RETENTION_DAYS } = await import('../../../src/constants/retention.js');
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
    // `model: null` is a category the Prisma-driven loop deliberately cannot
    // serve — see the ai_scan_diagnoses tests below.
    for (const p of RETENTION_POLICY.filter((x) => x.model)) {
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

  test('every policy either names a real Prisma delegate or is explicitly not one', () => {
    for (const p of RETENTION_POLICY) {
      if (p.model === null) continue;
      expect(typeof prisma[p.model]?.deleteMany).toBe('function');
    }
  });

  test('only the entry that needs a status filter has one', () => {
    const withExtra = RETENTION_POLICY.filter((p) => p.extraWhere);
    expect(withExtra.map((p) => p.key)).toEqual(['stockReservations']);
  });
});


// ── The two tables Prisma cannot see (claude.md §26, §27) ───────────────────
// ai_scan_diagnoses and ai_scan_feedback are created by the FastAPI service
// through asyncpg and are absent from schema.prisma. They were the only tables
// in the §26 list with no retention AT ALL, and the reason was structural, not
// an oversight: the sweep is a loop over `prisma[p.model]`, and there is no
// delegate to name. These pin the shape of the fix so the next person who
// "tidies up" the null model understands what it is load-bearing for.
describe('FastAPI-owned scan tables', () => {
  const entry = RETENTION_POLICY.find((p) => p.key === 'aiScanDiagnoses');

  test('the category exists and carries a cutoff like every other', () => {
    expect(entry).toBeDefined();
    expect(retentionCutoffs(new Date('2026-06-08T00:00:00.000Z')).aiScanDiagnoses.toISOString())
      .toBe('2025-06-08T00:00:00.000Z'); // 365 days
  });

  test('it names NO Prisma model, on purpose', () => {
    // If this ever becomes a string, either the table was added to
    // schema.prisma (fine — then delete sweepAiScanTables) or someone guessed a
    // delegate name that does not exist and the loop will throw at 2am.
    expect(entry.model).toBeNull();
    expect(prisma.aiScanDiagnosis).toBeUndefined();
  });

  test('it uses the snake_case column the AI service actually wrote', () => {
    // Prisma models here use createdAt; this table is not a Prisma model and its
    // column is created_at. Getting this wrong deletes nothing, silently.
    expect(entry.dateField).toBe('created_at');
  });

  test('the window is longer than the log-shaped categories', () => {
    // These rows are the only record of what the pipeline decided — model,
    // prompt hash, confidence, safety blockers. A season is the minimum useful
    // comparison window; 90 days would make one impossible.
    const errorLogs = RETENTION_POLICY.find((p) => p.key === 'errorLogs');
    expect(entry.days).toBeGreaterThan(errorLogs.days);
    expect(entry.days).toBe(AI_SCAN_RETENTION_DAYS);
  });

  test('the window is a single source of truth', () => {
    expect(AI_SCAN_RETENTION_DAYS).toBe(365);
  });
});
