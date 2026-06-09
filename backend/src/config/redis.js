import Redis from 'ioredis';
import { ENV } from './env.js';
import logger from '../utils/logger.js';
import { CACHE_SCHEMA_VERSION } from '../constants/cacheVersion.js';

// ── Reconnect backoff ─────────────────────────────────────────────────────────
// Bounded exponential backoff that NEVER gives up. The previous strategy
// (`times > 2 ? null : 500`) returned null after ~3 attempts, which tells ioredis
// to stop reconnecting PERMANENTLY — so any blip lasting more than ~1.5s (a Redis
// restart, a brief network partition) dropped Redis for the rest of the process's
// life, silently disabling every dependent feature with no recovery.
//
// We now back off 100ms → 200 → 400 … capped at 5s and keep retrying forever, so a
// short outage auto-recovers the moment Redis returns, and a sustained outage keeps
// trying (having already alerted via markDown) until it comes back. The bound is on
// the DELAY, not the retry count — bounding the count is exactly what caused the bug.
const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS  = 5000;
export function reconnectDelay(times) {
  const backoff = RECONNECT_BASE_MS * 2 ** Math.min(times - 1, 6); // cap exponent so it can't overflow
  return Math.min(backoff, RECONNECT_MAX_MS);
}

const redis = new Redis(ENV.REDIS_URL, {
  maxRetriesPerRequest: 1,   // commands fail fast during an outage → fail-open paths kick in
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy: reconnectDelay,
});

// ── Explicit health state (CACHE-9) ──────────────────────────────────────────
// Redis is optional for liveness, but its failures used to degrade SILENTLY: the
// per-call warnings are suppressed in production (logger.warn only prints in dev),
// so a prod outage left cache / rate-limit / idempotency quietly running on a
// per-instance fallback with nobody alerted. We now track health explicitly and
// emit ONE loud, greppable alert on the healthy→down transition (and a recovery
// note on the way back) so log-based alerting (OPS-4) can hook the marker, and we
// expose getRedisHealth() so /readyz can report the real state instead of a vague
// "degraded".
const IS_PROD = process.env.NODE_ENV === 'production';

const _health = {
  healthy: false,      // true only while the connection is 'ready'
  everReady: false,    // has it connected successfully at least once?
  downSince: null,     // epoch ms it went down (or first failed to connect)
  lastReadyAt: null,   // epoch ms of the last successful 'ready'
  lastError: null,     // message of the most recent connection error
  lastErrorAt: null,   // epoch ms of the most recent connection error
};
let _alerted = false;          // ensures a single alert per outage (no flapping spam)
let _escalated = false;        // ensures a single escalation per sustained outage
let _intentionalClose = false; // suppress false alerts during graceful shutdown

// Re-alert once if an outage persists this long, so a sustained failure is
// surfaced again even if the first [ALERT] line scrolled past. ioredis keeps
// emitting close/error while it reconnects, so markDown runs often enough to trip.
const ESCALATE_AFTER_MS = 5 * 60 * 1000;

/** Mark intent to shut down so the close/end events don't fire a spurious alert. */
export function beginRedisShutdown() {
  _intentionalClose = true;
}

// logger.error ALWAYS prints (even in prod); the [ALERT][Redis] marker is what
// OPS-4 alerting greps for. logger.warn would be invisible in production — so in
// dev/test we use warn (keeps local runs without Redis from looking like a firing
// production alert), and in prod we use error.
function emitAlert(...args) {
  if (IS_PROD) logger.error(...args);
  else         logger.warn(...args);
}

function markDown(reason) {
  _health.healthy = false;
  if (!_health.downSince) _health.downSince = Date.now();

  if (!_alerted) {
    _alerted = true;
    emitAlert(
      '[ALERT][Redis] UNAVAILABLE — %s. Shared cache, rate-limiting and idempotency ' +
      'are degraded to per-instance behaviour; security-critical limiters configured ' +
      'fail-closed will now reject. Reconnecting with backoff — investigate the Redis backend.',
      reason,
    );
    return;
  }

  // Already alerted: escalate ONCE if the outage is sustained.
  if (!_escalated && Date.now() - _health.downSince >= ESCALATE_AFTER_MS) {
    _escalated = true;
    emitAlert(
      '[ALERT][Redis] STILL UNAVAILABLE after %d minutes (%s). Reconnect attempts are ' +
      'ongoing but the backend has not recovered — escalate.',
      Math.round((Date.now() - _health.downSince) / 60000), reason,
    );
  }
}

function markUp() {
  const wasDown = _alerted;
  _health.healthy = true;
  _health.everReady = true;
  _health.lastReadyAt = Date.now();
  _health.downSince = null;
  _intentionalClose = false;
  _alerted = false;
  _escalated = false;
  if (wasDown) logger.info('[Redis] Recovered — connection healthy again');
}

redis.on('connect', () => logger.info('[Redis] Connected'));
redis.on('ready', markUp);
redis.on('error', (err) => {
  _health.lastError = err.message;
  _health.lastErrorAt = Date.now();
  // 'error' can fire while a connection is still usable; only treat it as an
  // outage once the client is no longer ready (the de-dup in markDown handles
  // the burst of errors ioredis emits while retrying).
  if (redis.status !== 'ready') markDown(err.message);
});
redis.on('close', () => { if (!_intentionalClose && _health.everReady) markDown('connection closed'); });
redis.on('end',   () => { if (!_intentionalClose) markDown('connection ended (no reconnects left)'); });

/**
 * Snapshot of Redis connection health for /readyz and metrics (CACHE-9).
 * @returns {{healthy:boolean, status:string, everReady:boolean, downSince:number|null,
 *            downForMs:number|null, lastReadyAt:number|null, lastError:string|null,
 *            lastErrorAt:number|null}}
 */
export function getRedisHealth() {
  return {
    healthy:    redis.status === 'ready',
    status:     redis.status,
    everReady:  _health.everReady,
    downSince:  _health.downSince,
    downForMs:  _health.downSince ? Date.now() - _health.downSince : null,
    lastReadyAt: _health.lastReadyAt,
    lastError:   _health.lastError,
    lastErrorAt: _health.lastErrorAt,
  };
}

/** True only when the shared store is usable (connection is 'ready'). */
export function isRedisHealthy() {
  return redis.status === 'ready';
}

// ── Redis memory metrics (observability) ──────────────────────────────────────
// Parse the fields we care about out of `INFO memory`. Pure + exported for tests.
export function parseInfoMemory(info) {
  const out = { used_memory: null, used_memory_rss: null, maxmemory: null, frag_ratio: null };
  if (typeof info !== 'string') return out;
  for (const line of info.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i);
    const val = line.slice(i + 1).trim();
    if (key === 'used_memory')             out.used_memory     = Number(val);
    else if (key === 'used_memory_rss')    out.used_memory_rss = Number(val);
    else if (key === 'maxmemory')          out.maxmemory       = Number(val);
    else if (key === 'mem_fragmentation_ratio') out.frag_ratio = Number(val);
  }
  return out;
}

// Throttled snapshot so the hot /readyz path never issues an INFO per call. A
// stale read triggers a fire-and-forget refresh and returns the last sample
// immediately, so callers never block on Redis.
const MEM_TTL_MS = 30_000;
let _mem = { used_memory: null, used_memory_rss: null, maxmemory: null, used_memory_pct: null, frag_ratio: null, sampledAt: null };
let _memRefreshing = false;

async function refreshRedisMemory() {
  if (_memRefreshing || redis.status !== 'ready') return;
  _memRefreshing = true;
  try {
    const parsed = parseInfoMemory(await redis.info('memory'));
    const pct = parsed.maxmemory > 0 ? Number(((parsed.used_memory / parsed.maxmemory) * 100).toFixed(2)) : null;
    _mem = { ...parsed, used_memory_pct: pct, sampledAt: Date.now() };
  } catch { /* keep the previous snapshot */ }
  finally { _memRefreshing = false; }
}

/**
 * Last sampled Redis memory metrics. Triggers a background refresh when stale and
 * returns the cached snapshot immediately (never blocks). `used_memory_pct` is
 * null when maxmemory is unset (no ceiling configured → no eviction risk to gauge).
 */
export function getRedisMemoryMetrics() {
  if (!_mem.sampledAt || Date.now() - _mem.sampledAt > MEM_TTL_MS) {
    refreshRedisMemory(); // fire-and-forget
  }
  return { ..._mem };
}

/**
 * Generic cache key builder. Prefixes every key with the schema version so a
 * CACHE_SCHEMA_VERSION bump (on a cached-payload shape change) misses all old keys
 * cleanly. Pure + exported for tests.
 */
export function cacheKey(key, schema = CACHE_SCHEMA_VERSION) {
  return `cache:s${schema}:${key}`;
}

/**
 * Cache-aside helper: get from Redis (schema-versioned key), parse JSON.
 * Returns null silently if Redis is unavailable (graceful degradation).
 */
export async function cacheGet(key) {
  try {
    const val = await redis.get(cacheKey(key));
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

export async function cacheSet(key, data, ttlSeconds = 300) {
  try {
    await redis.set(cacheKey(key), JSON.stringify(data), 'EX', ttlSeconds);
  } catch { /* Redis optional — swallow */ }
}

export default redis;
