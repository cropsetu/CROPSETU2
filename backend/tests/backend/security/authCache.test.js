/**
 * The auth hot-path cache, and the thing that makes it safe (claude.md §9).
 *
 * Every authenticated request ran a `SELECT tokenVersion, isActive FROM users`.
 * Caching it for a few seconds removes 1–2.5 ms of serial latency from 100% of
 * traffic and takes Postgres out of the critical path of authentication itself.
 *
 * The risk is entirely in invalidation: a stale entry is a banned account that
 * still works. There are NINE sites that write users.tokenVersion and only two
 * go through bumpTokenVersion; the admin ban writes isActive and does not touch
 * tokenVersion at all. Asking each to call an invalidator is asking to be wrong
 * later, so the hook watches the DATABASE — a write cannot avoid it by being
 * new. That property is what most of this file is about.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../src/config/redis.js', () => ({
  default: { status: 'end', publish: jest.fn(), duplicate: jest.fn() },
}));

const {
  getCachedAuth, setCachedAuth, invalidateAuth, resetAuthCache,
  attachAuthCacheInvalidation, authCacheStats,
} = await import('../../../src/services/authCache.js');

/** A stand-in Prisma client that records the middleware and can invoke it. */
function fakePrisma() {
  let mw = null;
  return {
    $use: (fn) => { mw = fn; },
    /** Simulate a query flowing through the registered middleware. */
    run: (params) => mw(params, async () => ({ ok: true })),
    get attached() { return Boolean(mw); },
  };
}

beforeEach(() => resetAuthCache());

describe('the cache itself', () => {
  it('returns what was stored, and null for anything else', () => {
    setCachedAuth('u1', { tokenVersion: 2, isActive: true });
    expect(getCachedAuth('u1')).toEqual({ tokenVersion: 2, isActive: true });
    expect(getCachedAuth('u2')).toBeNull();
  });

  it('is bounded, so it cannot grow with unique users seen', () => {
    const { max, ttlMs } = authCacheStats();
    expect(max).toBeGreaterThan(0);
    expect(ttlMs).toBeGreaterThan(0);
  });

  it('keeps the TTL well inside the access token lifetime', () => {
    // 900 s is the token's own window. A revocation missed by BOTH the hook and
    // the broadcast must still land inside a window that already exists.
    expect(authCacheStats().ttlMs).toBeLessThanOrEqual(30_000);
  });

  it('counts hits and misses, so the hit rate is observable', () => {
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });
    getCachedAuth('u1');
    getCachedAuth('u1');
    getCachedAuth('nobody');

    expect(authCacheStats()).toMatchObject({ hits: 2, misses: 1 });
    expect(authCacheStats().hitRate).toBeCloseTo(0.6667, 3);
  });
});

describe('invalidation is driven by the database, not by call sites', () => {
  it('registers a middleware on the client it is given', () => {
    const p = fakePrisma();
    attachAuthCacheInvalidation(p);
    expect(p.attached).toBe(true);
  });

  it('drops the entry when tokenVersion is written — however it is written', async () => {
    // The seven sites that increment inline rather than via bumpTokenVersion.
    const p = fakePrisma();
    attachAuthCacheInvalidation(p);
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });

    await p.run({
      model: 'User', action: 'update',
      args: { where: { id: 'u1' }, data: { tokenVersion: { increment: 1 } } },
    });

    expect(getCachedAuth('u1')).toBeNull();
  });

  it('drops the entry when isActive is written — the admin ban', async () => {
    // The ban writes isActive and does NOT bump tokenVersion, so a hook on the
    // helper alone would miss precisely the revocation that matters most.
    const p = fakePrisma();
    attachAuthCacheInvalidation(p);
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });

    await p.run({
      model: 'User', action: 'update',
      args: { where: { id: 'u1' }, data: { isActive: false } },
    });

    expect(getCachedAuth('u1')).toBeNull();
  });

  it('clears everything on a BULK auth write, rather than guessing', async () => {
    // updateMany cannot report which rows it touched.
    const p = fakePrisma();
    attachAuthCacheInvalidation(p);
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });
    setCachedAuth('u2', { tokenVersion: 0, isActive: true });

    await p.run({
      model: 'User', action: 'updateMany',
      args: { where: { role: 'ADMIN' }, data: { tokenVersion: { increment: 1 } } },
    });

    expect(getCachedAuth('u1')).toBeNull();
    expect(getCachedAuth('u2')).toBeNull();
  });

  it('drops the entry when the account is deleted', async () => {
    const p = fakePrisma();
    attachAuthCacheInvalidation(p);
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });

    await p.run({ model: 'User', action: 'delete', args: { where: { id: 'u1' } } });
    expect(getCachedAuth('u1')).toBeNull();
  });

  it('leaves the cache alone for writes that cannot affect auth', async () => {
    // A farmer editing their village must not cost every replica its cache.
    const p = fakePrisma();
    attachAuthCacheInvalidation(p);
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });

    await p.run({
      model: 'User', action: 'update',
      args: { where: { id: 'u1' }, data: { village: 'Testpur' } },
    });

    expect(getCachedAuth('u1')).toEqual({ tokenVersion: 0, isActive: true });
  });

  it('ignores writes to other models entirely', async () => {
    const p = fakePrisma();
    attachAuthCacheInvalidation(p);
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });

    await p.run({
      model: 'Product', action: 'update',
      args: { where: { id: 'p1' }, data: { isActive: false } },
    });

    expect(getCachedAuth('u1')).toEqual({ tokenVersion: 0, isActive: true });
  });

  it('returns the write result untouched, and never fails the write', async () => {
    const p = fakePrisma();
    attachAuthCacheInvalidation(p);
    // Malformed args — the hook must not turn a successful write into an error.
    await expect(
      p.run({ model: 'User', action: 'update', args: null }),
    ).resolves.toEqual({ ok: true });
  });
});

describe('invalidateAuth', () => {
  it('drops the local entry even when Redis cannot be published to', () => {
    // The replica that performed the write must be correct regardless of the
    // broadcast, which is why the local delete happens first.
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });
    invalidateAuth('u1');
    expect(getCachedAuth('u1')).toBeNull();
  });

  it('ignores a missing id rather than clearing everything', () => {
    setCachedAuth('u1', { tokenVersion: 0, isActive: true });
    invalidateAuth(undefined);
    expect(getCachedAuth('u1')).not.toBeNull();
  });
});
