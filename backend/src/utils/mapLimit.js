/**
 * Run an async mapper over a list with a ceiling on how many run at once.
 *
 * `Promise.all`/`allSettled` over a mapped array starts EVERY task in the same
 * tick. That is fine for ten items and wrong for five thousand: the admin
 * broadcast fanned out to `broadcast.maxRecipients` recipients simultaneously —
 * 5,000 by shipped default, not as a worst case — so one send opened 5,000
 * concurrent Redis writes, and with Redis down it opened 5,000 concurrent inline
 * jobs of three database operations each against a pool of twelve.
 *
 * Results come back in INPUT ORDER and in the shape `allSettled` uses, so this
 * is a drop-in for it and callers keep counting fulfilled/rejected the same way.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit                 max concurrent invocations (>= 1)
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<Array<{status:'fulfilled', value:R}|{status:'rejected', reason:any}>>}
 */
export async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const max = Math.max(1, Math.min(Math.floor(limit) || 1, list.length));
  const results = new Array(list.length);
  let next = 0;

  // `max` workers pulling from a shared cursor. A worker that finishes early
  // picks up the next item rather than waiting for its batch, so one slow
  // recipient cannot stall the others — which chunking into fixed batches does.
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(list[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: max }, worker));
  return results;
}
