/**
 * Per-connection Socket.IO rate limiting (SCALE-9).
 *
 * Acceptance: burst emitters are throttled; the broadcast path stays stable. We
 * drive the token bucket with mocked time so the throttling is deterministic,
 * then assert the onLimited() wrapper drops over-budget events instead of
 * invoking the handler.
 */
import { jest } from '@jest/globals';
import {
  TokenBucket, createConnectionLimiter, onLimited, DEFAULT_LIMITS,
} from '../../../src/socket/socketRateLimit.js';

describe('TokenBucket', () => {
  it('allows up to capacity back-to-back, then throttles', () => {
    const t = 1_000_000;
    const b = new TokenBucket(3, 1, t); // burst 3, 1/sec, clock base t
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(false); // burst spent
    expect(b.tryRemove(t)).toBe(false);
  });

  it('refills at refillPerSec over time', () => {
    let t = 0;
    const b = new TokenBucket(2, 5, t); // 5 tokens/sec
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(false); // empty
    t += 200; // 0.2s × 5/sec = 1 token
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(false);
  });

  it('never refills beyond capacity', () => {
    let t = 0;
    const b = new TokenBucket(3, 100, t);
    b.tryRemove(t); // 2 left
    t += 10_000; // huge idle; would overflow without the cap
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(true);
    expect(b.tryRemove(t)).toBe(false); // capped at capacity (3), not 3 + 10000*100
  });
});

describe('createConnectionLimiter', () => {
  it('caps a sustained flood to roughly the refill rate', () => {
    const spy = jest.spyOn(Date, 'now');
    try {
      let now = 0;
      spy.mockImplementation(() => now);
      const allow = createConnectionLimiter({ message: { capacity: 10, refillPerSec: 5 } });

      // Blast 1000 events in a single instant — only the burst capacity passes.
      let accepted = 0;
      for (let i = 0; i < 1000; i++) if (allow('message')) accepted++;
      expect(accepted).toBe(10); // exactly the burst, the other 990 are throttled

      // Over the next full second, ~refillPerSec more get through.
      accepted = 0;
      now += 1000;
      for (let i = 0; i < 1000; i++) if (allow('message')) accepted++;
      expect(accepted).toBe(5);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps categories independent (a typing flood does not starve messages)', () => {
    const allow = createConnectionLimiter();
    // Drain typing entirely.
    while (allow('typing')) { /* spin */ }
    // Messages still have their own full budget.
    expect(allow('message')).toBe(true);
  });

  it('does not limit unknown categories', () => {
    const allow = createConnectionLimiter();
    for (let i = 0; i < 100; i++) expect(allow('uncategorised')).toBe(true);
  });

  it('ships sane defaults for every chat event category', () => {
    for (const cat of ['message', 'typing', 'read', 'join']) {
      expect(DEFAULT_LIMITS[cat].capacity).toBeGreaterThan(0);
      expect(DEFAULT_LIMITS[cat].refillPerSec).toBeGreaterThan(0);
    }
  });
});

describe('onLimited', () => {
  // Minimal fake socket: records handlers and emitted events.
  function fakeSocket() {
    const handlers = {};
    return {
      emitted: [],
      on(event, fn) { handlers[event] = fn; },
      emit(event, payload) { this.emitted.push({ event, payload }); },
      fire(event, ...args) { return handlers[event](...args); },
    };
  }

  it('invokes the handler while under budget and drops it when throttled', () => {
    const socket = fakeSocket();
    const allow = createConnectionLimiter({ message: { capacity: 2, refillPerSec: 0.0001 } });
    const handler = jest.fn();
    onLimited(socket, allow, 'send_message', 'message', handler);

    socket.fire('send_message', { text: 'a' });
    socket.fire('send_message', { text: 'b' });
    socket.fire('send_message', { text: 'c' }); // over budget → dropped
    socket.fire('send_message', { text: 'd' }); // dropped

    expect(handler).toHaveBeenCalledTimes(2);
    // 'message' category notifies the offending socket so a real client can back off.
    expect(socket.emitted.filter(e => e.event === 'rate_limited')).toHaveLength(2);
  });

  it('drops throttled typing events silently (no notify)', () => {
    const socket = fakeSocket();
    const allow = createConnectionLimiter({ typing: { capacity: 1, refillPerSec: 0.0001 } });
    const handler = jest.fn();
    onLimited(socket, allow, 'dm_typing', 'typing', handler);

    socket.fire('dm_typing', { isTyping: true });
    socket.fire('dm_typing', { isTyping: false }); // throttled

    expect(handler).toHaveBeenCalledTimes(1);
    expect(socket.emitted).toHaveLength(0); // silent — debounce semantics
  });

  it('passes handler arguments through untouched', () => {
    const socket = fakeSocket();
    const allow = createConnectionLimiter();
    const handler = jest.fn();
    onLimited(socket, allow, 'join_chat', 'join', handler);
    const payload = { chatId: 'abc' };
    socket.fire('join_chat', payload);
    expect(handler).toHaveBeenCalledWith(payload);
  });
});
