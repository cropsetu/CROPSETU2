/**
 * The admin dashboard is cached (claude.md §29).
 *
 * getDashboardMetrics fires sixteen aggregates in one Promise.all, several of
 * them unbounded whole-table reads — user.count(), order.groupBy(['status']),
 * booking.count(). At a hundred thousand users those are sequential scans, and
 * an admin leaving the dashboard open re-ran all sixteen on every refresh.
 *
 * Acceptance: a warm read costs ZERO database queries, a cold one still works,
 * the window parameter cannot be served the wrong window's numbers, and Redis
 * being down degrades to the old behaviour rather than to an error.
 */
import { jest } from '@jest/globals';

let dbCalls = 0;
const agg = () => { dbCalls += 1; return Promise.resolve({ _count: { _all: 0 }, _sum: {} }); };
const cnt = () => { dbCalls += 1; return Promise.resolve(0); };
const grp = () => { dbCalls += 1; return Promise.resolve([]); };

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: {
    user:              { count: cnt, groupBy: grp },
    order:             { aggregate: agg, groupBy: grp },
    booking:           { count: cnt, groupBy: grp },
    aIUsage:           { aggregate: agg },
    cropDiseaseReport: { count: cnt },
    contentFlag:       { count: cnt },
    securityIncident:  { count: cnt },
    aPIHealthLog:      { groupBy: grp, findMany: () => { dbCalls += 1; return Promise.resolve([]); } },
    $queryRaw:         () => { dbCalls += 1; return Promise.resolve([]); },
  },
}));

const store = new Map();
let redisUp = true;
const cacheGet = jest.fn(async (k) => (redisUp ? store.get(k) ?? null : null));
const cacheSet = jest.fn(async (k, v) => { if (redisUp) store.set(k, v); });
jest.unstable_mockModule('../../../src/config/redis.js', () => ({
  default: {}, cacheGet, cacheSet,
}));

const { getDashboardMetrics } = await import('../../../src/services/adminMetrics.service.js');

beforeEach(() => {
  dbCalls = 0;
  store.clear();
  redisUp = true;
  cacheGet.mockClear();
  cacheSet.mockClear();
});

describe('getDashboardMetrics', () => {
  it('hits the database on a cold read, and stores the result', async () => {
    const out = await getDashboardMetrics({ days: 30 });
    expect(dbCalls).toBeGreaterThan(10);   // the sixteen aggregates
    expect(out).toHaveProperty('users');
    expect(cacheSet).toHaveBeenCalledTimes(1);
  });

  it('a warm read costs ZERO database queries', async () => {
    await getDashboardMetrics({ days: 30 });
    const cold = dbCalls;
    dbCalls = 0;

    const warm = await getDashboardMetrics({ days: 30 });
    expect(dbCalls).toBe(0);
    expect(warm).toHaveProperty('users');
    expect(cold).toBeGreaterThan(10);
  });

  it('never serves one window the numbers from another', async () => {
    // `days` is a query parameter. A single shared key would hand a 7-day view
    // the 30-day figures for the whole TTL, which is worse than being slow.
    await getDashboardMetrics({ days: 30 });
    dbCalls = 0;

    await getDashboardMetrics({ days: 7 });
    expect(dbCalls).toBeGreaterThan(10); // a genuine miss, not the 30-day entry

    dbCalls = 0;
    await getDashboardMetrics({ days: 7 });
    expect(dbCalls).toBe(0);             // and now its own entry is warm
  });

  it('falls back to computing when Redis is down', async () => {
    redisUp = false;
    await getDashboardMetrics({ days: 30 });
    dbCalls = 0;
    const out = await getDashboardMetrics({ days: 30 });

    expect(dbCalls).toBeGreaterThan(10); // no cache, so it recomputes
    expect(out).toHaveProperty('users'); // and still answers
  });
});
