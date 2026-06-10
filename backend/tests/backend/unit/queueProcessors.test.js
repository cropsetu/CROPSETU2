/**
 * Job processor registry — maps (queue, job) → handler, shared by the worker and
 * the enqueue() fail-open path. We mock push.service (the only real dependency)
 * so this stays a pure registry test and also proves the push.service ⇄ queue
 * import cycle resolves without a TDZ crash.
 */
import { jest } from '@jest/globals';

const deliverUserNotification = jest.fn(async () => {});
jest.unstable_mockModule('../../../src/services/push.service.js', () => ({
  deliverUserNotification,
}));

const { QUEUE_NAMES, getProcessor, runJobInline } = await import('../../../src/queue/processors.js');

beforeEach(() => deliverUserNotification.mockClear());

describe('processor registry', () => {
  it('resolves the notification handler', () => {
    const fn = getProcessor(QUEUE_NAMES.NOTIFICATIONS, 'user-notification');
    expect(typeof fn).toBe('function');
  });

  it('throws for an unregistered (queue, job) pair', () => {
    expect(() => getProcessor(QUEUE_NAMES.NOTIFICATIONS, 'nope')).toThrow(/No processor/);
    expect(() => getProcessor('ghost-queue', 'x')).toThrow(/No processor/);
  });

  it('runJobInline dispatches to the handler with the payload', async () => {
    const payload = { userId: 'u1', title: 'hi' };
    const res = await runJobInline(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', payload);
    expect(deliverUserNotification).toHaveBeenCalledWith(payload);
    expect(res).toEqual({ enqueued: false, ranInline: true });
  });
});
