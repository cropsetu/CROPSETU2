/**
 * Tests for the cache-stampede / thundering-herd guard (utils/singleFlight.js).
 *
 * Acceptance (CACHE ticket): concurrent misses on a hot key trigger ONE recompute,
 * not many. These tests drive the coalescing primitive directly so the guarantee
 * is verified deterministically without the Groq-backed market service.
 */
import { jest } from '@jest/globals';
import { singleFlight, inflightCount, resetSingleFlight } from '../../../src/utils/singleFlight.js';

// Defer a promise so several callers can pile up while the first is "in flight".
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('singleFlight', () => {
  beforeEach(() => resetSingleFlight());

  test('collapses N concurrent calls on the same key into ONE execution', async () => {
    const d = deferred();
    const fn = jest.fn(() => d.promise);

    // 20 concurrent callers for the same hot key.
    const callers = Array.from({ length: 20 }, () => singleFlight('hot', fn));
    expect(inflightCount()).toBe(1);

    d.resolve('VALUE');
    const results = await Promise.all(callers);

    expect(fn).toHaveBeenCalledTimes(1);                 // one recompute, not 20
    expect(results).toEqual(Array(20).fill('VALUE'));    // everyone gets the result
    expect(inflightCount()).toBe(0);                     // cleaned up after settle
  });

  test('different keys run independently (no false coalescing)', async () => {
    const fnA = jest.fn(async () => 'A');
    const fnB = jest.fn(async () => 'B');
    const [a, b] = await Promise.all([singleFlight('a', fnA), singleFlight('b', fnB)]);
    expect(a).toBe('A');
    expect(b).toBe('B');
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  test('a new call after the flight settles recomputes (flight is not cached)', async () => {
    const fn = jest.fn(async () => 'X');
    await singleFlight('k', fn);
    await singleFlight('k', fn); // flight already cleared → runs again
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('rejection does not poison the key — next caller retries and the herd shares the error', async () => {
    const d = deferred();
    const failing = jest.fn(() => d.promise);
    const callers = Array.from({ length: 5 }, () => singleFlight('k', failing).catch((e) => e.message));

    d.reject(new Error('boom'));
    const settled = await Promise.all(callers);

    expect(failing).toHaveBeenCalledTimes(1);             // one failed recompute shared by all
    expect(settled).toEqual(Array(5).fill('boom'));
    expect(inflightCount()).toBe(0);                      // cleared despite rejection

    // Key is usable again afterwards.
    const ok = jest.fn(async () => 'recovered');
    await expect(singleFlight('k', ok)).resolves.toBe('recovered');
  });

  test('a synchronous throw inside fn is surfaced as a rejection and still cleans up', async () => {
    const throwing = () => { throw new Error('sync'); };
    await expect(singleFlight('k', throwing)).rejects.toThrow('sync');
    expect(inflightCount()).toBe(0);
  });
});
