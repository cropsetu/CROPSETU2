/**
 * Leader election for scheduled jobs (COMP-16 / CACHE-6).
 *
 * Acceptance: a scheduled job runs once per tick across the fleet. We model the
 * fleet as N instances all calling withLeaderLock against ONE shared Redis SET
 * NX, and assert exactly one runs. We also assert the fail-open behaviour when
 * Redis is unavailable so maintenance never silently stops.
 */
import { jest } from '@jest/globals';

// A single in-memory store shared by all "instances", so a SET NX from one
// instance is visible to the others — exactly like a real shared Redis.
const store = new Map();
let status = 'ready';

const redisMock = {
  get status() { return status; },
  // Minimal SET emulation supporting the (key, val, 'PX', ttl, 'NX') form.
  set: jest.fn(async (key, val, _px, _ttl, nx) => {
    if (nx === 'NX' && store.has(key)) return null; // someone already holds it
    store.set(key, val);
    return 'OK';
  }),
};

jest.unstable_mockModule('../../../src/config/redis.js', () => ({
  default: redisMock,
}));

const { withLeaderLock, leaderLockKey } = await import('../../../src/utils/leaderLock.js');

beforeEach(() => {
  store.clear();
  status = 'ready';
  redisMock.set.mockClear();
});

describe('withLeaderLock', () => {
  it('runs the job exactly once across a fleet contending for the same tick', async () => {
    let runs = 0;
    const job = async () => { runs++; };

    // 5 instances fire the same scheduled job at the same tick.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => withLeaderLock('daily-sweep', job)),
    );

    expect(runs).toBe(1);
    expect(results.filter(Boolean)).toHaveLength(1); // exactly one reported "ran"
  });

  it('holds the lock until TTL (does not release on completion) so a late straggler skips', async () => {
    const job = jest.fn(async () => {});
    const ran = await withLeaderLock('daily-sweep', job);
    expect(ran).toBe(true);

    // A second instance whose clock fired a few seconds later finds the key held.
    const ranLate = await withLeaderLock('daily-sweep', job);
    expect(ranLate).toBe(false);
    expect(job).toHaveBeenCalledTimes(1);
    // Key is still present (TTL-based, not released after the job finished).
    expect(store.has(leaderLockKey('daily-sweep'))).toBe(true);
  });

  it('passes the TTL through to Redis via PX', async () => {
    await withLeaderLock('seed', async () => {}, { ttlMs: 600_000 });
    expect(redisMock.set).toHaveBeenCalledWith(
      leaderLockKey('seed'), expect.any(String), 'PX', 600_000, 'NX',
    );
  });

  it('fails open and runs the job when Redis is unavailable', async () => {
    status = 'connecting'; // not 'ready'
    let runs = 0;
    const ran = await withLeaderLock('daily-sweep', async () => { runs++; });
    expect(ran).toBe(true);
    expect(runs).toBe(1);
    expect(redisMock.set).not.toHaveBeenCalled(); // never even attempted
  });

  it('fails open when the Redis SET throws mid-command', async () => {
    redisMock.set.mockRejectedValueOnce(new Error('connection reset'));
    let runs = 0;
    const ran = await withLeaderLock('daily-sweep', async () => { runs++; });
    expect(ran).toBe(true);
    expect(runs).toBe(1);
  });

  it('swallows a job error so a cron tick never sees an unhandled rejection', async () => {
    const ran = await withLeaderLock('daily-sweep', async () => { throw new Error('boom'); });
    expect(ran).toBe(false); // reported as "did not complete", but did not throw
  });

  it('lets a different job name run independently (separate locks)', async () => {
    const a = await withLeaderLock('job-a', async () => {});
    const b = await withLeaderLock('job-b', async () => {});
    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});
