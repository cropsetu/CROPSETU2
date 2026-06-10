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

const env = { ENV: { QUEUE_ENABLED: true, QUEUE_CONCURRENCY: 5 } };
jest.unstable_mockModule('../../../src/config/env.js', () => env);

const redisStub = { status: 'ready' };
jest.unstable_mockModule('../../../src/config/redis.js', () => ({ default: redisStub }));

jest.unstable_mockModule('../../../src/queue/connection.js', () => ({
  getProducerConnection: () => ({}),
}));

const runJobInline = jest.fn(async () => ({ enqueued: false, ranInline: true }));
jest.unstable_mockModule('../../../src/queue/processors.js', () => ({
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  runJobInline,
}));

jest.unstable_mockModule('../../../src/utils/logger.js', () => ({
  default: { warn() {}, info() {}, error() {} },
}));

const { enqueue, QUEUE_NAMES } = await import('../../../src/queue/jobQueue.js');

beforeEach(() => {
  added.length = 0;
  runJobInline.mockClear();
  env.ENV.QUEUE_ENABLED = true;
  redisStub.status = 'ready';
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
