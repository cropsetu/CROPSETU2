/**
 * Serialization-conflict retry.
 *
 * The finding: both checkout paths opened a Serializable transaction with no
 * retry, so Postgres aborting one of two racers with SQLSTATE 40001 reached the
 * buyer as a 500 "Checkout failed. Please try again." Two farmers going for the
 * last bag of seed is a normal marketplace event, not a server error.
 *
 * Two properties matter and both are asserted here: a conflict is REPLAYED
 * (which usually succeeds), and a conflict that survives every attempt is a 409,
 * not a 500 — because the 5xx rate is how you find real outages, and losing a
 * race is not one.
 */
import { withSerializableRetry } from '../../../src/utils/txRetry.js';

/** What Prisma surfaces for a Postgres serialization_failure. */
const conflict = (code = '40001') => Object.assign(new Error('could not serialize access due to read/write dependencies'), { code });

describe('withSerializableRetry', () => {
  test('a conflict is replayed and the retry’s result is returned', async () => {
    let attempts = 0;
    const result = await withSerializableRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw conflict();
      return 'order-created';
    }, { baseDelayMs: 1 });

    expect(result).toBe('order-created');
    expect(attempts).toBe(2);
  });

  test.each(['40001', '40P01', 'P2034'])('%s is treated as retryable', async (code) => {
    let attempts = 0;
    await withSerializableRetry(async () => {
      attempts += 1;
      if (attempts < 2) throw conflict(code);
      return 'ok';
    }, { baseDelayMs: 1 });
    expect(attempts).toBe(2);
  });

  test('a conflict recognised only by its message is still retried', async () => {
    // Prisma does not always surface the SQLSTATE in `code`.
    let attempts = 0;
    await withSerializableRetry(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('deadlock detected');
      return 'ok';
    }, { baseDelayMs: 1 });
    expect(attempts).toBe(2);
  });

  test('exhausting every attempt yields a client-safe 409, not a 500', async () => {
    let attempts = 0;
    const err = await withSerializableRetry(async () => {
      attempts += 1;
      throw conflict();
    }, { attempts: 3, baseDelayMs: 1 }).catch((e) => e);

    expect(attempts).toBe(3);
    // sendServerError reads both of these: without them the buyer gets a 500 and
    // a generic "something went wrong".
    expect(err.statusCode).toBe(409);
    expect(err.expose).toBe(true);
    expect(err.code).toBe('SERIALIZATION_CONFLICT');
    expect(err.message).toMatch(/try again/i);
    // The original is kept for the logs — the operator still needs the SQLSTATE.
    expect(err.cause?.code).toBe('40001');
  });

  test('a business error is NOT retried and propagates untouched', async () => {
    // "Insufficient stock" would give the same answer more slowly, and rewriting
    // it as a conflict would hide a truthful message from the buyer.
    let attempts = 0;
    const outOfStock = Object.assign(new Error('An item in your cart just sold out.'), {
      statusCode: 400, expose: true,
    });

    const err = await withSerializableRetry(async () => {
      attempts += 1;
      throw outOfStock;
    }, { baseDelayMs: 1 }).catch((e) => e);

    expect(attempts).toBe(1);
    expect(err).toBe(outOfStock);
    expect(err.statusCode).toBe(400);
  });

  test('the conflict observer counts every retried conflict', async () => {
    const { setSerializableConflictObserver } = await import('../../../src/utils/txRetry.js');
    let seen = 0;
    setSerializableConflictObserver(() => { seen += 1; });
    try {
      await withSerializableRetry(async () => { throw conflict(); }, { attempts: 3, baseDelayMs: 1 })
        .catch(() => {});
      // Contention rate is an operational signal; a silent retry hides a
      // sustained problem behind acceptable latency.
      expect(seen).toBe(3);
    } finally {
      setSerializableConflictObserver(null);
    }
  });

  test('an observer that throws never breaks the checkout', async () => {
    const { setSerializableConflictObserver } = await import('../../../src/utils/txRetry.js');
    setSerializableConflictObserver(() => { throw new Error('metrics backend down'); });
    try {
      let attempts = 0;
      const result = await withSerializableRetry(async () => {
        attempts += 1;
        if (attempts === 1) throw conflict();
        return 'ok';
      }, { baseDelayMs: 1 });
      expect(result).toBe('ok');
    } finally {
      setSerializableConflictObserver(null);
    }
  });
});
