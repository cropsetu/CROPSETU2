/**
 * Job queue producer — heavy-work offload (BullMQ).
 *
 * Acceptance: heavy operations run async without blocking requests. We assert
 * enqueue() hands work to BullMQ when Redis is healthy (offloaded, non-blocking)
 * and FAILS OPEN to inline execution when the queue is unavailable, so a
 * side-effect is never silently dropped.
 */
import { jest } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const added = []; // jobs handed to BullMQ
class FakeQueue {
  constructor(name) { this.name = name; }
  async add(jobName, data, opts) { const job = { id: `job-${added.length + 1}`, jobName, data, opts }; added.push(job); return job; }
  on() {}
  async close() {}
}
jest.unstable_mockModule('bullmq', () => ({ Queue: FakeQueue }));

// Mirrors the real config/env.js keys this module reads. A short mock here is
// not harmless: jobQueue reads ENV.QUEUE_INLINE_MAX_CONCURRENCY, and leaving it
// out would resolve to undefined and quietly disable the inline bound in the
// exact suite meant to prove it works.
const env = { ENV: { QUEUE_ENABLED: true, QUEUE_CONCURRENCY: 5, QUEUE_INLINE_MAX_CONCURRENCY: 3 } };
jest.unstable_mockModule('../../../src/config/env.js', () => env);

const redisStub = { status: 'ready' };
jest.unstable_mockModule('../../../src/config/redis.js', () => ({ default: redisStub }));

jest.unstable_mockModule('../../../src/queue/connection.js', () => ({
  getProducerConnection: () => ({}),
}));

const runJobInline = jest.fn(async () => ({ enqueued: false, ranInline: true }));
const isBestEffort = jest.fn(() => true);
jest.unstable_mockModule('../../../src/queue/processors.js', () => ({
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  runJobInline,
  isBestEffort,
}));

jest.unstable_mockModule('../../../src/utils/logger.js', () => ({
  default: { warn() {}, info() {}, error() {} },
}));

const { enqueue, QUEUE_NAMES, inlineStats, _resetInlineStats } = await import('../../../src/queue/jobQueue.js');

beforeEach(() => {
  added.length = 0;
  runJobInline.mockClear();
  env.ENV.QUEUE_ENABLED = true;
  redisStub.status = 'ready';
  isBestEffort.mockReset().mockReturnValue(true);
  _resetInlineStats();
});

describe('enqueue', () => {
  it('offloads to the queue (does not run inline) when Redis is healthy', async () => {
    const res = await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: 'u1' });
    expect(res).toEqual({ enqueued: true, jobId: 'job-1' });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ jobName: 'user-notification', data: { userId: 'u1' } });
    expect(runJobInline).not.toHaveBeenCalled(); // work left the request path
  });

  it('reuses one Queue instance across calls to the same queue', async () => {
    await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: 'a' });
    await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: 'b' });
    expect(added).toHaveLength(2); // both enqueued; no crash from re-instantiating
  });

  it('fails open to inline execution when Redis is not ready', async () => {
    redisStub.status = 'connecting';
    const res = await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: 'u2' });
    expect(runJobInline).toHaveBeenCalledWith('notifications', 'user-notification', { userId: 'u2' });
    expect(res).toEqual({ enqueued: false, ranInline: true });
    expect(added).toHaveLength(0); // nothing queued
  });

  it('fails open to inline execution when the queue is disabled', async () => {
    env.ENV.QUEUE_ENABLED = false;
    await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: 'u3' });
    expect(runJobInline).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(0);
  });

  it('fails open when queue.add throws (transient Redis error mid-enqueue)', async () => {
    const spy = jest.spyOn(FakeQueue.prototype, 'add').mockRejectedValueOnce(new Error('LOADING'));
    const res = await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: 'u4' });
    expect(runJobInline).toHaveBeenCalledWith('notifications', 'user-notification', { userId: 'u4' });
    expect(res).toEqual({ enqueued: false, ranInline: true });
    spy.mockRestore();
  });
});

// ── The fail-open path is bounded ────────────────────────────────────────────
// Failing open is right for ONE job. It is catastrophic for a fan-out: an admin
// broadcast calls enqueue() once per recipient — 5,000 by shipped default — so a
// Redis outage used to put 5,000 jobs of three DB operations each onto the
// request path at once, against a Prisma pool of twelve, and every other request
// in the process queued behind them until pool_timeout. The Redis outage became
// an API outage.
describe('inline fail-open bounding', () => {
  // Hold every inline job open so concurrency can be observed rather than raced.
  function gate() {
    let release;
    const held = new Promise((r) => { release = r; });
    runJobInline.mockImplementation(async () => {
      await held;
      return { enqueued: false, ranInline: true };
    });
    return () => release();
  }

  it('runs a single job inline exactly as before', async () => {
    redisStub.status = 'connecting';
    const res = await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: 'solo' });
    expect(res).toEqual({ enqueued: false, ranInline: true });
    expect(inlineStats().shedSinceBoot).toBe(0);
  });

  it('sheds best-effort jobs past the ceiling instead of running them all', async () => {
    redisStub.status = 'connecting';
    const release = gate();

    // 3 fill the ceiling and stay in flight; the next 7 must be shed.
    const inFlight = Array.from({ length: 3 }, (_, i) =>
      enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: `hold-${i}` }));
    const shed = await Promise.all(Array.from({ length: 7 }, (_, i) =>
      enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { userId: `shed-${i}` })));

    expect(shed.every((r) => r.shed === true)).toBe(true);
    expect(shed.every((r) => r.ranInline === false)).toBe(true);
    expect(inlineStats().shedSinceBoot).toBe(7);
    expect(runJobInline).toHaveBeenCalledTimes(3); // NOT 10

    release();
    await Promise.all(inFlight);
    expect(inlineStats().active).toBe(0); // the slot is given back
  });

  it('NEVER sheds a job that is not marked best-effort', async () => {
    // Correctness outranks latency: dropping a critical side-effect is a silent
    // data problem, and anything not explicitly best-effort is critical.
    isBestEffort.mockReturnValue(false);
    redisStub.status = 'connecting';
    const release = gate();

    const all = Array.from({ length: 8 }, (_, i) =>
      enqueue(QUEUE_NAMES.NOTIFICATIONS, 'critical-job', { n: i }));
    release();
    const res = await Promise.all(all);

    expect(res.every((r) => r.ranInline === true)).toBe(true);
    expect(inlineStats().shedSinceBoot).toBe(0);
    expect(runJobInline).toHaveBeenCalledTimes(8);
  });

  it('recovers capacity once the outage passes', async () => {
    redisStub.status = 'connecting';
    const release = gate();
    const held = Array.from({ length: 3 }, (_, i) =>
      enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { n: i }));
    await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { n: 'shed' });
    expect(inlineStats().shedSinceBoot).toBe(1);

    release();
    await Promise.all(held);
    runJobInline.mockImplementation(async () => ({ enqueued: false, ranInline: true }));

    const after = await enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { n: 'after' });
    expect(after).toEqual({ enqueued: false, ranInline: true });
  });

  it('does not bound the healthy path — Redis up means nothing is shed', async () => {
    const res = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', { n: i })));
    expect(res.every((r) => r.enqueued === true)).toBe(true);
    expect(inlineStats().shedSinceBoot).toBe(0);
    expect(added).toHaveLength(50);
  });
});
