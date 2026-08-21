/**
 * writeQueue retries must not double-apply (claude.md §46).
 *
 * The file used to promise this and not deliver it: api.js mints the
 * Idempotency-Key in a request interceptor guarded by
 * `!config.headers['Idempotency-Key']`, which only makes the key survive a
 * retransmission of the SAME config object (the 401-refresh replay). withWrite
 * retries by calling `fn()` again, which builds a brand-new request — no
 * header, fresh key, and the backend sees an unrelated write.
 *
 * The consequence is not abstract. A farmer on a village connection saves a
 * farm; the POST commits server-side; the response is lost; axios times out;
 * the retry lands under a new key and they now have two farms. The retry that
 * exists to survive a bad network was the thing corrupting their data.
 *
 * These tests assert the property at the level it has to hold: every attempt of
 * one logical write carries ONE key, and separate writes carry different ones.
 */
import { withWrite } from '../writeQueue';

const keyOf = (cfg) => cfg?.headers?.['Idempotency-Key'];

// The failure the fix is for: server commits, response never arrives.
const timeout = () => Object.assign(new Error('timeout of 15000ms exceeded'), { response: undefined });

describe('withWrite idempotency', () => {
  test('every retry of one write carries the SAME key', async () => {
    const seen = [];
    let attempts = 0;
    await withWrite((cfg) => {
      seen.push(keyOf(cfg));
      attempts += 1;
      if (attempts < 3) throw timeout();   // two lost responses, then success
      return 'ok';
    }, { label: 'createFarm' });

    expect(attempts).toBe(3);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);    // ← the whole point
    expect(seen[0]).toBeTruthy();
  });

  test('two separate writes get DIFFERENT keys', async () => {
    // A farmer deliberately adding two farms must not have the second deduped
    // into the first. Reusing one key would be the opposite bug.
    const a = []; const b = [];
    await withWrite((cfg) => { a.push(keyOf(cfg)); return 1; }, { label: 'w1' });
    await withWrite((cfg) => { b.push(keyOf(cfg)); return 2; }, { label: 'w2' });
    expect(a[0]).not.toBe(b[0]);
  });

  test('concurrent writes do not share a key', async () => {
    // Rules out fixing this with an ambient "current key" module global, which
    // would look correct until two saves overlap.
    const keys = await Promise.all(
      [1, 2, 3].map((n) => withWrite((cfg) => keyOf(cfg), { label: `w${n}` })),
    );
    expect(new Set(keys).size).toBe(3);
  });

  test('a 4xx is not retried, so it stays a single attempt', async () => {
    // 409/422 means the server rejected the content; retrying just repeats it.
    let n = 0;
    await expect(withWrite(() => {
      n += 1;
      throw Object.assign(new Error('bad'), { response: { status: 422 } });
    }, { label: 'w', retries: 3 })).rejects.toThrow('bad');
    expect(n).toBe(1);
  });

  test('the key reaches axios as a config the interceptor will honour', async () => {
    // api.js only leaves a caller key alone if it arrives at
    // `config.headers['Idempotency-Key']`. Pinning the shape here means a
    // refactor of writeQueue that changes it fails HERE rather than silently
    // reverting to per-attempt keys in production.
    const cfg = await withWrite((c) => c, { label: 'shape' });
    expect(cfg).toHaveProperty('headers.Idempotency-Key');
    expect(typeof cfg.headers['Idempotency-Key']).toBe('string');
  });
});

describe('withWrite backoff', () => {
  test('backoff is jittered, so a tower coming back does not sync the retries', async () => {
    // Every phone under one tower is released at the same instant after an
    // outage. On a fixed 400/800/1600 grid they retry in lockstep and arrive as
    // a wave; §46 asks for jitter for this reason.
    const delays = [];
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => { delays.push(ms); return realSetTimeout(fn, 0); };
    try {
      let n = 0;
      await withWrite(() => { n += 1; if (n < 3) throw timeout(); return 'ok'; }, { label: 'w' });
    } finally {
      global.setTimeout = realSetTimeout;
    }
    expect(delays).toHaveLength(2);
    // Still exponential in shape...
    expect(delays[0]).toBeGreaterThanOrEqual(400);
    expect(delays[1]).toBeGreaterThanOrEqual(800);
    // ...but not on the grid: jitter is up to +50%.
    expect(delays[0]).toBeLessThanOrEqual(600);
    expect(delays[1]).toBeLessThanOrEqual(1200);
    expect(delays.some((d) => d % 400 !== 0)).toBe(true);
  });
});
