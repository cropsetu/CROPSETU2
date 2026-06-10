/**
 * Per-connection Socket.IO rate limiting (SCALE-9).
 *
 * Every inbound socket event here does real work — a DB write and/or a broadcast
 * fan-out to a room. Without a limit, a single misbehaving or malicious client
 * can blast `send_message` / `group_message` / `*_typing` as fast as the socket
 * allows, hammering Postgres and flooding every other client in the room. That
 * degrades the broadcast path for everyone, not just the abuser.
 *
 * We throttle each connection with a per-category token bucket:
 *   - capacity      → the burst a client may send back-to-back
 *   - refillPerSec  → the sustained rate once the burst is spent
 *
 * A bucket smooths bursts (the capacity) while capping the long-run rate (the
 * refill), which is exactly "throttle bursts, keep broadcast stable". Categories
 * let chatty pure-broadcast events (typing) be throttled harder than rarer
 * DB-write events. State lives on the connection's closure, so it's naturally
 * bounded by the live-connection count and GC'd the moment the socket
 * disconnects — no shared map to leak.
 *
 * In-process by design: a socket is pinned to one instance, so per-connection
 * limits need no cross-instance coordination (unlike the HTTP limiter).
 */

// category → { capacity: burst, refillPerSec: sustained rate }.
// Tuned for human chat: generous enough that a real user never trips it, tight
// enough that an automated flood is throttled to a trickle.
export const DEFAULT_LIMITS = {
  // DB-write + broadcast (send_message, group_message, dm_send)
  message: { capacity: 10, refillPerSec: 5 },
  // pure broadcast, naturally chatty (start/stop typing) → throttle hardest
  typing:  { capacity: 4,  refillPerSec: 2 },
  // DB-write, small emit (mark_read, dm_read)
  read:    { capacity: 10, refillPerSec: 5 },
  // DB-read + history emit (join_chat, join_group, leave)
  join:    { capacity: 20, refillPerSec: 8 },
};

/**
 * A classic token bucket. `tokens` regenerate continuously at `refillPerSec` up
 * to `capacity`; each accepted event removes one. Lazily refilled on access so
 * there are no timers to manage or clean up.
 */
export class TokenBucket {
  constructor(capacity, refillPerSec, now = Date.now()) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity; // start full so the first burst is allowed
    this.last = now;
  }

  /** @returns {boolean} true if a token was available (event allowed). */
  tryRemove(now = Date.now()) {
    const elapsedSec = (now - this.last) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.last = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/**
 * Build a per-connection limiter. Call once per socket; the returned `allow`
 * closure holds this connection's buckets.
 *
 * @param {Record<string, {capacity:number, refillPerSec:number}>} [limits]
 * @returns {(category: string) => boolean} allow(category) — false ⇒ throttled.
 */
export function createConnectionLimiter(limits = DEFAULT_LIMITS) {
  const buckets = new Map();
  return function allow(category) {
    const cfg = limits[category];
    if (!cfg) return true; // unknown/uncategorised events are not rate-limited
    let bucket = buckets.get(category);
    if (!bucket) {
      bucket = new TokenBucket(cfg.capacity, cfg.refillPerSec);
      buckets.set(category, bucket);
    }
    return bucket.tryRemove();
  };
}

/**
 * Register a socket event handler guarded by the connection limiter. When the
 * client exceeds its budget for `category`, the event is dropped instead of
 * doing DB work / broadcasting. For `message` events we send a lightweight
 * `rate_limited` notice back to the offending socket only (so a real client can
 * surface "you're going too fast"); chatty events like typing are dropped
 * silently (debounce semantics — a missed typing frame is invisible).
 *
 * @param {import('socket.io').Socket} socket
 * @param {(category:string)=>boolean} allow
 * @param {string} event     socket event name
 * @param {string} category  limiter category (message|typing|read|join)
 * @param {Function} handler  the original async handler
 * @param {{ notify?: boolean }} [opts]
 */
export function onLimited(socket, allow, event, category, handler, { notify = category === 'message' } = {}) {
  socket.on(event, (...args) => {
    if (!allow(category)) {
      if (notify) socket.emit('rate_limited', { event });
      return undefined;
    }
    return handler(...args);
  });
}
