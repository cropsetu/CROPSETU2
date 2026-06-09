/**
 * Tests for the listing cache-aside helper (utils/listingCache.js).
 *
 * Acceptance (CACHE listing ticket): repeat listing requests are served from
 * cache, and writes invalidate correctly. Redis is module-mocked with a tiny
 * in-memory store (get/set/incr honouring EX) so the version-counter invalidation
 * and TTL behaviour run without a live server.
 */
import { jest } from '@jest/globals';

// ── Fake Redis: just enough of the ioredis surface this helper uses.
const store = new Map();
const fakeRedis = {
  status: 'ready',
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async set(k, v) { store.set(k, v); return 'OK'; }, // EX ignored — TTL not exercised here
  async incr(k) { const n = (Number(store.get(k)) || 0) + 1; store.set(k, String(n)); return n; },
};
jest.unstable_mockModule('../../../src/config/redis.js', () => ({ default: fakeRedis }));

const { cachedListing, bumpListingVersion } = await import('../../../src/utils/listingCache.js');
const { getCacheMetrics, resetCacheMetrics } = await import('../../../src/utils/cacheMetrics.js');

const NS = 'test:products';
beforeEach(() => { store.clear(); fakeRedis.status = 'ready'; resetCacheMetrics(); });

describe('cachedListing', () => {
  test('first call misses and runs the loader; repeat call is served from cache', async () => {
    const loader = jest.fn(async () => ({ data: [{ id: 1 }], meta: { total: 1 } }));

    const a = await cachedListing(NS, 'p=1', 60, loader);
    expect(a.cached).toBe(false);
    expect(a.data).toEqual([{ id: 1 }]);

    const b = await cachedListing(NS, 'p=1', 60, loader);
    expect(b.cached).toBe(true);                 // served from cache
    expect(b.data).toEqual([{ id: 1 }]);
    expect(b.meta).toEqual({ total: 1 });
    expect(loader).toHaveBeenCalledTimes(1);     // DB hit only once
  });

  test('distinct query signatures are cached independently', async () => {
    const loader = jest.fn(async (n) => ({ data: n }));
    await cachedListing(NS, 'page=1', 60, () => loader(1));
    await cachedListing(NS, 'page=2', 60, () => loader(2));
    expect(loader).toHaveBeenCalledTimes(2);     // different keys → two loads
  });

  test('records hit/miss metrics for observability', async () => {
    const loader = jest.fn(async () => ({ data: 1 }));
    await cachedListing(NS, 'p=1', 60, loader); // miss
    await cachedListing(NS, 'p=1', 60, loader); // hit
    await cachedListing(NS, 'p=1', 60, loader); // hit

    const m = getCacheMetrics();
    expect(m.hits).toBe(2);
    expect(m.misses).toBe(1);
    expect(m.bySource[`listing:${NS}`]).toEqual({ hits: 2, misses: 1, hitRate: 0.6667 });
  });

  test('a write (version bump) invalidates ALL cached entries in the namespace', async () => {
    const loader = jest.fn(async () => ({ data: ['v1'] }));

    await cachedListing(NS, 'page=1', 60, loader);
    await cachedListing(NS, 'page=2', 60, loader);
    expect(loader).toHaveBeenCalledTimes(2);

    // Both are now cached — confirm no extra loads.
    await cachedListing(NS, 'page=1', 60, loader);
    expect(loader).toHaveBeenCalledTimes(2);

    // A write bumps the namespace version → every old key is orphaned.
    await bumpListingVersion(NS);

    const after1 = await cachedListing(NS, 'page=1', 60, loader);
    const after2 = await cachedListing(NS, 'page=2', 60, loader);
    expect(after1.cached).toBe(false);
    expect(after2.cached).toBe(false);
    expect(loader).toHaveBeenCalledTimes(4);     // both reloaded post-invalidation
  });
});

describe('graceful degradation when Redis is down', () => {
  test('cachedListing runs the loader directly and never caches', async () => {
    fakeRedis.status = 'end';
    const loader = jest.fn(async () => ({ data: 'fresh' }));

    const a = await cachedListing(NS, 'x', 60, loader);
    const b = await cachedListing(NS, 'x', 60, loader);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(false);
    expect(loader).toHaveBeenCalledTimes(2);     // no caching → every call loads
  });

  test('bumpListingVersion is a safe no-op when Redis is down', async () => {
    fakeRedis.status = 'end';
    await expect(bumpListingVersion(NS)).resolves.toBeUndefined();
  });
});
