/**
 * The rate limiter's in-memory fallback store must not grow without bound.
 *
 * When Redis is unavailable the limiter falls back to an in-process store so a
 * single instance stays protected. The per-key VALUE was always bounded — at
 * most `max` timestamps — but the KEY SET was not: every distinct IP or user id
 * seen during the outage minted an entry that was never removed, so one Redis
 * outage under a flood grew the map for the life of the process. That is the
 * classic unbounded-Map leak, and this is the regression guard for its fix.
 *
 * These tests exercise the fallback path deliberately: under the test env no
 * Redis client reaches `status === 'ready'`, so `check()` routes to `memCheck`.
 */
import { jest } from '@jest/globals';

const { rateLimiter, resetRateLimitStore, rateLimitStoreSize } =
  await import('../../../src/middleware/rateLimit.js');

const MEM_MAX_KEYS = 50_000; // must track the constant in rateLimit.js

/** Minimal req double — the limiter only needs a key source. */
function fakeReq(id) {
  return { testKey: id, ip: id, socket: {}, headers: {} };
}

function limiter(opts = {}) {
  return rateLimiter({
    windowMs: 60_000,
    max: 5,
    prefix: 'test',
    key: (req) => req.testKey,
    ...opts,
  });
}

/**
 * Drive one request through the middleware and resolve with its outcome.
 *
 * The limiter has two exits: it calls next() when the request is allowed, or it
 * writes a 429 and returns WITHOUT calling next() when it is not. A harness that
 * only waits on next() therefore hangs on every rejected request, so the res
 * double resolves the same promise when the response is written.
 */
function fire(mw, id) {
  return new Promise((resolve) => {
    const res = {
      setHeader: () => {},
      status() { return res; },
      json() { resolve('limited'); return res; },
      send() { resolve('limited'); return res; },
    };
    mw(fakeReq(id), res, () => resolve('allowed'));
  });
}

describe('in-memory fallback store bounds', () => {
  beforeEach(() => { resetRateLimitStore(); });
  afterAll(() => { resetRateLimitStore(); });

  test('starts empty and grows one key per distinct client', async () => {
    const mw = limiter();
    expect(rateLimitStoreSize()).toBe(0);
    await fire(mw, 'client-a');
    await fire(mw, 'client-b');
    await fire(mw, 'client-a'); // repeat client reuses its key
    expect(rateLimitStoreSize()).toBe(2);
  });

  test('key count is capped once distinct clients exceed the LRU ceiling', async () => {
    const mw = limiter();
    for (let i = 0; i < MEM_MAX_KEYS + 500; i++) await fire(mw, `flood-${i}`);
    expect(rateLimitStoreSize()).toBeLessThanOrEqual(MEM_MAX_KEYS);
  }, 60_000);

  test('eviction drops the coldest key, and an active one keeps its window', async () => {
    const mw = limiter({ max: 2 });
    expect(await fire(mw, 'hot')).toBe('allowed'); // hit 1 of 2
    expect(await fire(mw, 'hot')).toBe('allowed'); // hit 2 of 2 — budget spent

    // Flood past the ceiling, keeping 'hot' recently-used so LRU spares it.
    for (let i = 0; i < MEM_MAX_KEYS; i++) {
      await fire(mw, `cold-${i}`);
      if (i % 5_000 === 0) await fire(mw, 'hot');
    }

    // If 'hot' had been evicted it would read as a brand-new client and be
    // allowed again. Its window surviving the flood is the point of the LRU
    // ordering: eviction must cost the coldest client, never the active one.
    expect(await fire(mw, 'hot')).toBe('limited');
    expect(rateLimitStoreSize()).toBeLessThanOrEqual(MEM_MAX_KEYS);
  }, 120_000);

  test('resetRateLimitStore clears every key', async () => {
    const mw = limiter();
    await fire(mw, 'x');
    expect(rateLimitStoreSize()).toBeGreaterThan(0);
    resetRateLimitStore();
    expect(rateLimitStoreSize()).toBe(0);
  });
});
