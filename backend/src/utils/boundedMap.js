/**
 * BoundedMap — a Map that can't leak memory under sustained load.
 *
 * Plain `new Map()` used as a per-user / per-IP store grows forever: every new
 * key is kept until process restart, so a busy instance trends toward OOM. This
 * wraps a Map with two independent bounds:
 *
 *   - TTL    — entries older than `ttlMs` are treated as absent and dropped on
 *              access (lazy expiry; no background timer needed).
 *   - maxSize — when full, inserting evicts the least-recently-used key first
 *              (LRU, via Map insertion-order: a `get`/`set` hit re-inserts the
 *              key so it becomes "newest").
 *
 * Either bound alone caps growth; together they keep both the key count and the
 * staleness bounded regardless of traffic. Use it anywhere a module-scope Map
 * is keyed by unbounded input (user id, IP, request id, cache key).
 *
 * Not a distributed store — state is per-process. For cross-instance correctness
 * (rate limits, single-use markers) prefer Redis; this is the in-memory fallback
 * / local cache, now safely bounded.
 */
export class BoundedMap {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxSize=1000] hard cap on live keys (LRU eviction).
   * @param {number} [opts.ttlMs=0]      entry lifetime; 0 disables TTL.
   */
  constructor({ maxSize = 1000, ttlMs = 0 } = {}) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error('BoundedMap: maxSize must be a positive integer');
    }
    this.maxSize = maxSize;
    this.ttlMs = ttlMs > 0 ? ttlMs : 0;
    this._m = new Map(); // key -> { v, exp } where exp=0 means "never expires"
  }

  _expired(entry, now) {
    return entry.exp !== 0 && now >= entry.exp;
  }

  /** @returns the stored value, or `undefined` if absent or expired. */
  get(key) {
    const entry = this._m.get(key);
    if (entry === undefined) return undefined;
    if (this._expired(entry, Date.now())) {
      this._m.delete(key);
      return undefined;
    }
    // Mark as most-recently-used: delete + re-insert moves it to the tail.
    this._m.delete(key);
    this._m.set(key, entry);
    return entry.v;
  }

  /** Insert/update `key`, evicting the LRU entry if at capacity. */
  set(key, value) {
    // Re-insert keeps insertion-order LRU semantics correct on update.
    if (this._m.has(key)) this._m.delete(key);
    this._m.set(key, { v: value, exp: this.ttlMs ? Date.now() + this.ttlMs : 0 });
    // Evict oldest (front of insertion order) until within capacity.
    while (this._m.size > this.maxSize) {
      const oldest = this._m.keys().next().value;
      this._m.delete(oldest);
    }
    return this;
  }

  /** True if a live (non-expired) entry exists. */
  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this._m.delete(key);
  }

  clear() {
    this._m.clear();
  }

  /** Live key count (may include not-yet-swept expired entries). */
  get size() {
    return this._m.size;
  }

  /**
   * Drop all expired entries now. Optional — `get`/`set` already bound memory.
   * Useful to call from an existing periodic sweep to release stale keys early.
   * @returns {number} entries removed.
   */
  sweep() {
    if (!this.ttlMs) return 0;
    const now = Date.now();
    let removed = 0;
    for (const [k, entry] of this._m) {
      if (this._expired(entry, now)) {
        this._m.delete(k);
        removed++;
      }
    }
    return removed;
  }
}

export default BoundedMap;
