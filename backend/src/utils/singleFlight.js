/**
 * In-process single-flight (a.k.a. request coalescing) — the cache-stampede /
 * thundering-herd guard for cache-aside recomputes.
 *
 * While a call for `key` is in flight, every other caller for the SAME key awaits
 * the SAME promise instead of launching its own recompute. So N concurrent misses
 * on a hot key trigger ONE expensive recompute (LLM call / DB query / external
 * fetch), not N.
 *
 * Scope is per Node process. Behind multiple instances each process does at most
 * one recompute per key, so the worst-case herd is bounded by instance count
 * (small, fixed) rather than concurrent-request count (unbounded). The expensive
 * backend is protected either way; combine with jittered TTLs so keys populated
 * together don't all expire — and stampede — in lockstep.
 *
 * Failure is not cached: the in-flight entry is cleared in a `finally`, so a
 * rejected `fn` doesn't poison the key — the next caller retries cleanly. Every
 * caller coalesced onto a failing flight observes the same rejection.
 */
const inflight = new Map();

/**
 * Run `fn` at most once per `key` for the duration of its execution, sharing the
 * result with all concurrent callers.
 * @template T
 * @param {string} key            coalescing key (usually the cache key)
 * @param {() => Promise<T>|T} fn the recompute to run on a miss
 * @returns {Promise<T>}
 */
export function singleFlight(key, fn) {
  const existing = inflight.get(key);
  if (existing) return existing;

  // Promise.resolve().then(fn) so a synchronous throw inside fn becomes a
  // rejected promise (and still triggers the finally cleanup) rather than
  // throwing past the in-flight bookkeeping.
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/** Number of keys currently in flight (test/diagnostics). */
export function inflightCount() {
  return inflight.size;
}

/** Test-only: drop all in-flight tracking so state doesn't leak between tests. */
export function resetSingleFlight() {
  inflight.clear();
}
