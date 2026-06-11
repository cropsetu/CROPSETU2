/**
 * Fake-review / fake-listing signals (FRAUD-5) — services/contentFraud.service.js.
 *
 * prisma, the moderation queue and audit are module-mocked so the heuristics run
 * without a database. ENV.CONTENT_FRAUD defaults apply (burst ≥ 5 in 60 min,
 * new-account < 3 days, flagScore 2; weights burst/duplicate = 2, new_account = 1).
 *
 * Acceptance covered: suspicious reviews/listings are detected and routed to the
 * moderation queue; clean content and lone weak signals are not.
 */
import { jest } from '@jest/globals';

const userFindUnique = jest.fn();
const reviewFindMany = jest.fn();
const productFindMany = jest.fn();
const enqueueFlag = jest.fn().mockResolvedValue(true);
const auditLog = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: {
    user:    { findUnique: userFindUnique },
    review:  { findMany: reviewFindMany },
    product: { findMany: productFindMany },
  },
}));
jest.unstable_mockModule('../../../src/services/moderation.service.js', () => ({
  enqueueFlag,
  MODERATION_STATUSES: ['PENDING', 'APPROVED', 'REJECTED'],
}));
jest.unstable_mockModule('../../../src/services/audit.service.js', () => ({
  auditLog,
  AUDIT_ACTIONS: { FRAUD_CONTENT_FLAG: 'FRAUD_CONTENT_FLAG' },
}));

const {
  normalizeText, scoreReasons, assessReview, assessListing, flagReviewIfSuspicious,
} = await import('../../../src/services/contentFraud.service.js');
const { ENV } = await import('../../../src/config/env.js');

const C = ENV.CONTENT_FRAUD;
const OLD = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);   // year-old account
const FRESH = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);    // 1-day-old account
const NOW = () => new Date();
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  userFindUnique.mockReset();
  reviewFindMany.mockReset();
  productFindMany.mockReset();
  enqueueFlag.mockClear();
  auditLog.mockClear();
});

// ── pure helpers ────────────────────────────────────────────────────────────
describe('normalizeText / scoreReasons', () => {
  test('normalizeText lowercases + collapses whitespace; empty for null', () => {
    expect(normalizeText('  Great   PRODUCT \n')).toBe('great product');
    expect(normalizeText(null)).toBe('');
  });
  test('scoreReasons weights burst/duplicate = 2, new_account = 1', () => {
    expect(scoreReasons(['burst'])).toBe(2);
    expect(scoreReasons(['new_account'])).toBe(1);
    expect(scoreReasons(['burst', 'new_account'])).toBe(3);
  });
});

// ── assessReview ──────────────────────────────────────────────────────────────
describe('assessReview', () => {
  test('clean review → not flagged', async () => {
    userFindUnique.mockResolvedValue({ createdAt: OLD });
    reviewFindMany.mockResolvedValue([{ id: 'self', comment: 'genuinely useful', createdAt: NOW() }]);
    const r = await assessReview({ userId: 'u1', reviewId: 'self', comment: 'genuinely useful' });
    expect(r.flagged).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  test('burst → flagged', async () => {
    userFindUnique.mockResolvedValue({ createdAt: OLD });
    reviewFindMany.mockResolvedValue(
      Array.from({ length: C.reviewBurstCount }, (_, i) => ({ id: `r${i}`, comment: `c${i}`, createdAt: NOW() })),
    );
    const r = await assessReview({ userId: 'u1', reviewId: 'r0', comment: 'c0-unique-text' });
    expect(r.reasons).toContain('burst');
    expect(r.flagged).toBe(true);
  });

  test('duplicate comment across the author\'s reviews → flagged', async () => {
    userFindUnique.mockResolvedValue({ createdAt: OLD });
    reviewFindMany.mockResolvedValue([
      { id: 'self',  comment: 'great product', createdAt: NOW() },
      { id: 'other', comment: 'Great   Product', createdAt: NOW() }, // normalizes equal
    ]);
    const r = await assessReview({ userId: 'u1', reviewId: 'self', comment: 'great product' });
    expect(r.reasons).toContain('duplicate');
    expect(r.flagged).toBe(true);
  });

  test('new account alone does NOT flag (score 1 < 2)', async () => {
    userFindUnique.mockResolvedValue({ createdAt: FRESH });
    reviewFindMany.mockResolvedValue([{ id: 'self', comment: 'looks good', createdAt: NOW() }]);
    const r = await assessReview({ userId: 'u1', reviewId: 'self', comment: 'looks good' });
    expect(r.reasons).toEqual(['new_account']);
    expect(r.flagged).toBe(false);
  });

  test('new account + burst → flagged', async () => {
    userFindUnique.mockResolvedValue({ createdAt: FRESH });
    reviewFindMany.mockResolvedValue(
      Array.from({ length: C.reviewBurstCount }, (_, i) => ({ id: `r${i}`, comment: `c${i}`, createdAt: NOW() })),
    );
    const r = await assessReview({ userId: 'u1', reviewId: 'r0', comment: 'fresh-unique' });
    expect(r.reasons).toEqual(expect.arrayContaining(['burst', 'new_account']));
    expect(r.flagged).toBe(true);
  });

  test('never throws — DB failure → not flagged', async () => {
    userFindUnique.mockRejectedValue(new Error('db down'));
    reviewFindMany.mockRejectedValue(new Error('db down'));
    const r = await assessReview({ userId: 'u1', reviewId: 'self', comment: 'x' });
    expect(r.flagged).toBe(false);
  });
});

// ── assessListing ─────────────────────────────────────────────────────────────
describe('assessListing', () => {
  test('duplicate listing name by the same seller → flagged', async () => {
    userFindUnique.mockResolvedValue({ createdAt: OLD });
    productFindMany.mockResolvedValue([
      { id: 'self',  name: 'Organic Tomato Seeds', createdAt: NOW() },
      { id: 'other', name: 'organic   tomato seeds', createdAt: NOW() },
    ]);
    const r = await assessListing({ sellerId: 's1', productId: 'self', name: 'Organic Tomato Seeds' });
    expect(r.reasons).toContain('duplicate');
    expect(r.flagged).toBe(true);
  });

  test('clean listing → not flagged', async () => {
    userFindUnique.mockResolvedValue({ createdAt: OLD });
    productFindMany.mockResolvedValue([{ id: 'self', name: 'Drip Irrigation Kit', createdAt: NOW() }]);
    const r = await assessListing({ sellerId: 's1', productId: 'self', name: 'Drip Irrigation Kit' });
    expect(r.flagged).toBe(false);
  });
});

// ── routing to moderation ───────────────────────────────────────────────────────
describe('flagReviewIfSuspicious', () => {
  test('flagged → routed to the moderation queue', async () => {
    userFindUnique.mockResolvedValue({ createdAt: OLD });
    reviewFindMany.mockResolvedValue(
      Array.from({ length: C.reviewBurstCount }, (_, i) => ({ id: `r${i}`, comment: `c${i}`, createdAt: NOW() })),
    );
    const r = await flagReviewIfSuspicious({ reviewId: 'r0', userId: 'u1', comment: 'spammy' });
    expect(r.flagged).toBe(true);
    expect(enqueueFlag).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'Review', entityId: 'r0', authorId: 'u1' }));
    await flush();
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'FRAUD_CONTENT_FLAG' }));
  });

  test('not flagged → nothing routed', async () => {
    userFindUnique.mockResolvedValue({ createdAt: OLD });
    reviewFindMany.mockResolvedValue([{ id: 'self', comment: 'fine', createdAt: NOW() }]);
    const r = await flagReviewIfSuspicious({ reviewId: 'self', userId: 'u1', comment: 'fine' });
    expect(r.flagged).toBe(false);
    expect(enqueueFlag).not.toHaveBeenCalled();
  });
});
