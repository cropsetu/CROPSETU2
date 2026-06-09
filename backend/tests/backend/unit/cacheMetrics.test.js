/**
 * Tests for cache observability (utils/cacheMetrics.js): hit/miss counters,
 * hit-rate computation, by-source breakdown, and windowed threshold alerting.
 *
 * Acceptance (observability ticket): metrics expose hit rate + memory, and alerts
 * fire on a low hit rate / high memory. logger is mocked so we can assert the
 * [ALERT] markers without console noise.
 */
import { jest } from '@jest/globals';

const error = jest.fn();
jest.unstable_mockModule('../../../src/utils/logger.js', () => ({
  default: { error, warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const {
  recordCacheHit, recordCacheMiss, getCacheMetrics, resetCacheMetrics, checkCacheAlerts,
} = await import('../../../src/utils/cacheMetrics.js');

beforeEach(() => { resetCacheMetrics(); error.mockClear(); });

describe('hit/miss counters', () => {
  test('getCacheMetrics computes hit rate and per-source breakdown', () => {
    recordCacheHit('listing:x');
    recordCacheHit('listing:x');
    recordCacheMiss('listing:x');
    recordCacheHit('market');

    const m = getCacheMetrics();
    expect(m.hits).toBe(3);
    expect(m.misses).toBe(1);
    expect(m.total).toBe(4);
    expect(m.hitRate).toBe(0.75);
    expect(m.bySource['listing:x']).toEqual({ hits: 2, misses: 1, hitRate: 0.6667 });
    expect(m.bySource['market']).toEqual({ hits: 1, misses: 0, hitRate: 1 });
  });

  test('hit rate is null with no traffic', () => {
    expect(getCacheMetrics().hitRate).toBeNull();
  });
});

describe('checkCacheAlerts — hit rate', () => {
  test('alerts when windowed hit rate is below the floor (enough samples)', () => {
    for (let i = 0; i < 30; i++) recordCacheHit('x');   // 30 hits
    for (let i = 0; i < 70; i++) recordCacheMiss('x');  // 70 misses → 30% hit rate
    const r = checkCacheAlerts({ minSamples: 50, hitRateFloor: 0.5, memPct: null });
    expect(r.hitRateAlert).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[ALERT][Cache] low hit rate'), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  test('no alert when hit rate is healthy', () => {
    for (let i = 0; i < 90; i++) recordCacheHit('x');
    for (let i = 0; i < 10; i++) recordCacheMiss('x');  // 90% hit rate
    const r = checkCacheAlerts({ minSamples: 50, hitRateFloor: 0.5, memPct: null });
    expect(r.hitRateAlert).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  test('no alert below the minimum sample size (avoids cold-start noise)', () => {
    recordCacheMiss('x'); recordCacheMiss('x'); // only 2 reads, 0% rate
    const r = checkCacheAlerts({ minSamples: 50, hitRateFloor: 0.5, memPct: null });
    expect(r.hitRateAlert).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  test('the window resets each call — a recovered rate clears the alert', () => {
    for (let i = 0; i < 100; i++) recordCacheMiss('x');
    expect(checkCacheAlerts({ minSamples: 50, hitRateFloor: 0.5 }).hitRateAlert).toBe(true);

    // Next window: all hits → healthy, no alert.
    for (let i = 0; i < 100; i++) recordCacheHit('x');
    const r = checkCacheAlerts({ minSamples: 50, hitRateFloor: 0.5 });
    expect(r.hitRateAlert).toBe(false);
    expect(r.windowHitRate).toBe(1);
  });
});

describe('checkCacheAlerts — memory', () => {
  test('alerts when memory % is at/over the ceiling', () => {
    const r = checkCacheAlerts({ memPct: 90, memPctCeil: 85 });
    expect(r.memoryAlert).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[ALERT][Redis][Memory]'), expect.anything(), expect.anything());
  });

  test('no alert when memory is below the ceiling or unknown (no maxmemory)', () => {
    expect(checkCacheAlerts({ memPct: 50, memPctCeil: 85 }).memoryAlert).toBe(false);
    expect(checkCacheAlerts({ memPct: null, memPctCeil: 85 }).memoryAlert).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });
});
