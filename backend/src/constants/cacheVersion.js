/**
 * Schema version for serialized cache payloads.
 *
 * Persisted caches (Redis) survive across deploys. So if the SHAPE of a cached
 * value changes — a renamed field, a new required key, a restructured response —
 * a freshly deployed instance can read an OLD payload written by the previous
 * version and serve a broken/incompatible response. The bug isn't stale data,
 * it's stale STRUCTURE.
 *
 * Every persisted cache key is prefixed with this version (see the key builders in
 * utils/listingCache.js and the cacheGet/cacheSet helpers in config/redis.js).
 * Bump it in the SAME commit that changes a cached payload's shape: the new code
 * then reads under a new key space and misses every old key cleanly, while the
 * stale keys simply TTL-expire. No SCAN, no manual FLUSH, no broken reads during a
 * rolling deploy where old and new instances briefly coexist.
 *
 * ORTHOGONAL to runtime write-invalidation (the per-namespace version counter in
 * listingCache.js): that bumps on DATA changes at runtime; THIS bumps on SHAPE
 * changes at deploy time. A listing key carries both — `cache:<ns>:s<SCHEMA>:v<ver>:<hash>`.
 *
 * In-process caches (e.g. the Map in market.data.service.js) do NOT need this —
 * a deploy restarts the process and clears them, so they can never serve a payload
 * written by a different code version.
 *
 *   WHEN TO BUMP: any change to what a cached payload looks like (listing response
 *                 fields/structure, a cacheGet/cacheSet value shape, etc.).
 *   WHEN NOT TO:  pure data changes (handled by the runtime counter) or TTL tweaks.
 *
 * Integer, bumped monotonically: 1 → 2 → 3 …
 */
export const CACHE_SCHEMA_VERSION = 1;
