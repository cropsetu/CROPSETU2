/**
 * Bounded-concurrency map.
 *
 * Exists because `Promise.allSettled(list.map(fn))` starts every task in one
 * tick, and the admin broadcast handed it up to 5,000 recipients.
 */
import { mapLimit } from '../../../src/utils/mapLimit.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('mapLimit', () => {
  it('never exceeds the limit, however long the list is', async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 200 }, (_, i) => i), 5, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(1);
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // it really is running them concurrently
  });

  it('returns results in INPUT order, not completion order', async () => {
    // A drop-in for allSettled means callers can still zip results to inputs.
    const out = await mapLimit([30, 1, 20, 2], 4, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(out.map((r) => r.value)).toEqual([30, 1, 20, 2]);
  });

  it('uses the allSettled shape so a rejection does not lose the rest', async () => {
    const out = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('nope');
      return n * 10;
    });
    expect(out[0]).toEqual({ status: 'fulfilled', value: 10 });
    expect(out[1].status).toBe('rejected');
    expect(out[1].reason.message).toBe('nope');
    expect(out[2]).toEqual({ status: 'fulfilled', value: 30 });
  });

  it('does not let one slow item stall the others', async () => {
    // The reason this is a worker pool over a shared cursor rather than fixed
    // batches: a batch waits for its slowest member before starting the next.
    const finished = [];
    await mapLimit([50, 1, 1, 1], 2, async (ms, i) => {
      await tick(ms);
      finished.push(i);
    });
    expect(finished[finished.length - 1]).toBe(0); // the slow one finished last
    expect(finished).toHaveLength(4);
  });

  it('handles an empty list, and a limit larger than the list', async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual([]);
    const out = await mapLimit([1, 2], 100, async (n) => n);
    expect(out.map((r) => r.value)).toEqual([1, 2]);
  });

  it('treats a nonsense limit as one rather than as unbounded', async () => {
    let peak = 0;
    let active = 0;
    await mapLimit([1, 2, 3], 0, async () => {
      active += 1; peak = Math.max(peak, active);
      await tick(1);
      active -= 1;
    });
    expect(peak).toBe(1);
  });
});
