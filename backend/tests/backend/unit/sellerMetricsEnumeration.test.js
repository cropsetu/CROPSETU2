/**
 * The seller-metrics refresh must enumerate sellers with GROUP BY, not by
 * streaming every order item into the process.
 *
 * This is a query-SHAPE test, and it has to be, because the two implementations
 * return exactly the same answer. `findMany({ distinct: ['sellerId'] })` yields
 * the correct set of sellers — Prisma just does not push `distinct` into SQL. It
 * emits a plain SELECT with no DISTINCT and no LIMIT, pulls every matching row
 * across the DB→process boundary, and dedupes in the query engine.
 *
 * So every assertion a normal test would make — "candidates === 3", "each active
 * seller was refreshed" — passes identically before and after the fix. That is
 * precisely why nothing caught it, and why asserting the RESULT here would be
 * worthless. The thing that differs is the statement, and the number of rows it
 * moves: measured on a 630k-row probe, 540,036 rows and +127.8 MB RSS before,
 * 5,000 rows and +0.1 MB after.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGroupBy = jest.fn();
const mockOrderItemFindMany = jest.fn();
const mockSellerFindMany = jest.fn();

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  __esModule: true,
  default: {
    orderItem:     { groupBy: mockGroupBy, findMany: mockOrderItemFindMany, count: jest.fn() },
    sellerProfile: { findMany: mockSellerFindMany, update: jest.fn().mockResolvedValue({}) },
    sellerListing: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));
jest.unstable_mockModule('../../../src/services/settings.service.js', () => ({
  __esModule: true,
  getSetting: jest.fn().mockResolvedValue(180),
}));

const { refreshAllSellerMetrics } = await import('../../../src/services/sellerMetrics.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockGroupBy.mockResolvedValue([{ sellerId: 's1' }, { sellerId: 's2' }, { sellerId: 's3' }]);
  mockOrderItemFindMany.mockResolvedValue([]);
  mockSellerFindMany.mockResolvedValue([]);
});

describe('seller enumeration', () => {
  it('enumerates with GROUP BY on sellerId', async () => {
    await refreshAllSellerMetrics();
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['sellerId'] }),
    );
  });

  it('never enumerates with findMany + distinct', async () => {
    // The invariant, stated against the SHAPE rather than the API name: no call
    // may lean on Prisma's `distinct`, because Prisma resolves it in the client
    // after fetching every row, not in SQL.
    await refreshAllSellerMetrics();
    for (const call of mockOrderItemFindMany.mock.calls) {
      expect(call[0]).not.toHaveProperty('distinct');
    }
  });

  it('still scopes the enumeration to the window and to real sellers', async () => {
    // The fix must not quietly widen what is counted. `sellerId: not null`
    // excludes legacy rows; `createdAt >= from` is the configurable window.
    await refreshAllSellerMetrics();
    const where = mockGroupBy.mock.calls[0][0].where;
    expect(where.sellerId).toEqual({ not: null });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it('does not cap the enumeration', async () => {
    // A `take` here would silently drop sellers from the refresh and leave
    // their metrics stale forever, with no signal. Whatever else changes, the
    // enumeration must stay complete.
    await refreshAllSellerMetrics();
    expect(mockGroupBy.mock.calls[0][0]).not.toHaveProperty('take');
    expect(mockGroupBy.mock.calls[0][0]).not.toHaveProperty('skip');
  });

  it('feeds every enumerated seller through, deduped against the never-computed set', async () => {
    // Guards the consumer, which the shape change flows into: groupBy returns
    // rows in hash-aggregate order rather than table order, so anything that
    // depended on ordering would break here.
    mockSellerFindMany.mockResolvedValue([{ userId: 's3' }, { userId: 's4' }]);
    const out = await refreshAllSellerMetrics();
    expect(out.candidates).toBe(4); // s1, s2, s3, s4 — s3 counted once
  });
});
