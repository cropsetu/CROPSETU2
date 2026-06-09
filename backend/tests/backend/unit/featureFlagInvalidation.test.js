/**
 * Tests for cross-instance feature-flag cache invalidation via Redis pub/sub
 * (services/featureFlag.service.js).
 *
 * Acceptance: changing a flag on ONE instance invalidates the cache on every
 * other instance within seconds. We model two instances by driving the service's
 * subscriber with a broadcast on the shared channel and asserting the local cache
 * is dropped (the next read re-queries the DB).
 *
 * Redis is module-mocked with a tiny in-memory pub/sub so the publish→deliver
 * round-trip runs without a live server; prisma is mocked so flag reads are
 * observable (each cache miss = one findMany call).
 */
import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// ── Fake Redis: a publisher whose PUBLISH fans out to every subscriber created
//    via duplicate(). Mirrors how ioredis pub/sub behaves across connections.
const subscribers = [];
const publish = jest.fn(async (channel, message) => {
  subscribers.forEach((s) => s.emit('message', channel, message));
  return subscribers.length;
});
const fakeRedis = Object.assign(new EventEmitter(), {
  status: 'ready',
  publish,
  duplicate() {
    const sub = Object.assign(new EventEmitter(), {
      status: 'ready',
      connect: jest.fn(async () => {}),
      subscribe: jest.fn(async function () { subscribers.push(this); }),
      quit: jest.fn(async function () {
        const i = subscribers.indexOf(this);
        if (i >= 0) subscribers.splice(i, 1);
      }),
    });
    return sub;
  },
});
jest.unstable_mockModule('../../../src/config/redis.js', () => ({ default: fakeRedis }));

// ── Fake prisma: findMany returns one enabled flag; call count reveals cache hits.
const findMany = jest.fn(async () => [{ featureKey: 'mandi_bhav', isEnabled: true }]);
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { featureFlag: { findMany } },
}));

const {
  isEnabled, invalidateCache,
  initFlagInvalidationSubscriber, stopFlagInvalidationSubscriber,
} = await import('../../../src/services/featureFlag.service.js');

beforeEach(() => {
  invalidateCache();            // reset the module's in-process cache between tests
  findMany.mockClear();
  publish.mockClear();
});
afterEach(async () => { await stopFlagInvalidationSubscriber(); });

describe('feature-flag cross-instance invalidation', () => {
  test('a broadcast from another instance drops this instance\'s cache', async () => {
    await initFlagInvalidationSubscriber();

    await isEnabled('mandi_bhav');             // populates cache → 1 DB read
    await isEnabled('mandi_bhav');             // served from cache → no DB read
    expect(findMany).toHaveBeenCalledTimes(1);

    // Another instance toggles the flag and broadcasts on the shared channel.
    await fakeRedis.publish('featureflags:invalidate', 'mandi_bhav');

    await isEnabled('mandi_bhav');             // cache was cleared → fresh DB read
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  test('invalidateCache broadcasts on the channel AND clears locally', async () => {
    await initFlagInvalidationSubscriber();

    await isEnabled('mandi_bhav');
    expect(findMany).toHaveBeenCalledTimes(1);

    invalidateCache('mandi_bhav');             // admin path on this instance
    expect(publish).toHaveBeenCalledWith('featureflags:invalidate', 'mandi_bhav');

    await isEnabled('mandi_bhav');             // local cache cleared → fresh read
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  test('initFlagInvalidationSubscriber is idempotent (one subscription)', async () => {
    await initFlagInvalidationSubscriber();
    await initFlagInvalidationSubscriber();
    expect(subscribers.length).toBe(1);
  });
});
