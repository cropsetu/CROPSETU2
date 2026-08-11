/**
 * Retry a Serializable transaction that lost a serialization race.
 *
 * Postgres aborts one of two concurrent Serializable transactions with SQLSTATE
 * 40001 (serialization_failure) or 40P01 (deadlock_detected). Under the previous
 * checkout code that surfaced to the buyer as a 500 "Checkout failed. Please try
 * again." — but two buyers racing for the last unit of a popular seed is a NORMAL
 * event in a marketplace, not a server error. The correct response is to replay
 * the transaction, which re-reads stock and either succeeds or fails with a
 * truthful "out of stock".
 *
 * Only 40001/40P01 are retried. A business error thrown from inside the callback
 * (insufficient stock, cart empty, price changed) propagates on the first attempt
 * — retrying it would just produce the same answer more slowly.
 *
 * Backoff is randomised so two racers do not re-collide in lockstep.
 *
 * @param {(attempt:number)=>Promise<T>} run  performs the whole $transaction
 * @param {{ attempts?: number, baseDelayMs?: number }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
const RETRYABLE = new Set(['40001', 'P2034', '40P01']);

function isRetryable(err) {
  const code = err?.code || err?.meta?.code || err?.originalError?.code;
  if (RETRYABLE.has(String(code))) return true;
  // Prisma sometimes only surfaces the Postgres code inside the message.
  return /could not serialize access|deadlock detected|write conflict/i.test(err?.message || '');
}

export async function withSerializableRetry(run, { attempts = 3, baseDelayMs = 25 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      const jitter = Math.random() * baseDelayMs;
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt + jitter));
    }
  }
  throw lastErr;
}
