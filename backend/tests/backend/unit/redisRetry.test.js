/**
 * Unit test for the Redis reconnect backoff (config/redis.js).
 *
 * Acceptance (CACHE retry ticket): short outages auto-recover. That hinges on the
 * retry strategy NEVER giving up — the old `times > 2 ? null : 500` returned null
 * after ~3 tries, permanently dropping Redis. These tests lock in bounded
 * exponential backoff that always returns a positive delay (keeps reconnecting).
 */
import { jest } from '@jest/globals';

// config/redis.js imports config/env.js at load; provide the vars env.js requires.
process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/x';
process.env.JWT_SECRET = 'a'.repeat(32);

const { reconnectDelay } = await import('../../../src/config/redis.js');

describe('reconnectDelay (reconnect backoff)', () => {
  test('backs off exponentially from 100ms', () => {
    expect(reconnectDelay(1)).toBe(100);
    expect(reconnectDelay(2)).toBe(200);
    expect(reconnectDelay(3)).toBe(400);
    expect(reconnectDelay(4)).toBe(800);
    expect(reconnectDelay(5)).toBe(1600);
    expect(reconnectDelay(6)).toBe(3200);
  });

  test('is bounded — never exceeds the 5s cap', () => {
    for (const t of [7, 8, 20, 100, 10_000]) {
      expect(reconnectDelay(t)).toBe(5000);
    }
  });

  test('NEVER gives up — always returns a positive number (the core fix)', () => {
    for (let t = 1; t <= 1000; t++) {
      const d = reconnectDelay(t);
      expect(typeof d).toBe('number');
      expect(d).toBeGreaterThan(0);
      expect(d).not.toBeNull();
    }
  });

  test('delay is monotonic non-decreasing up to the cap', () => {
    let prev = 0;
    for (let t = 1; t <= 10; t++) {
      const d = reconnectDelay(t);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});
