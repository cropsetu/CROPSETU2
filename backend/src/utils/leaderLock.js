/**
 * Leader election for scheduled jobs (COMP-16 / CACHE-6).
 *
 * A cron schedule or setInterval fires on EVERY process in a multi-instance
 * deployment. For jobs that mutate shared state (DB purges, external sync
 * triggers) that means the same work runs N times per tick — duplicate writes,
 * wasted API calls, and data races between instances racing the same rows.
 *
 * `withLeaderLock` elects a single runner per tick using an atomic Redis
 * `SET key token PX ttl NX`: exactly one instance wins the key, runs the job,
 * and everyone else skips. The lock is deliberately NOT released when the job
 * finishes — it expires after `ttlMs`, so an instance whose clock fired a few
 * seconds late (skew) still finds the key held and skips instead of double-
 * running. Choose `ttlMs` so that:
 *
 *     max clock skew + job duration   <   ttlMs   <   the job's interval
 *
 * (long enough to cover a late straggler, short enough that the *next* tick can
 * re-acquire). The default (30 min) suits daily/monthly maintenance jobs.
 *
 * Fail-open by design: if Redis is down we cannot coordinate, so we RUN the job
 * and warn. The locked jobs are idempotent cleanups/refreshes — a rare duplicate
 * during a Redis outage is far cheaper than the alternative (skipping retention
 * sweeps / cache purges fleet-wide and silently letting data pile up). This also
 * keeps single-instance dev, where Redis may be absent, working unchanged.
 */
import crypto from 'crypto';
import redis from '../config/redis.js';
import logger from './logger.js';

// Unique per process so the lock value identifies THIS instance — handy in logs
// and a guard against ever mistaking another instance's lock for our own.
const INSTANCE_ID = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min — covers skew, well under a daily tick

/** Build the namespaced lock key for a job. */
export function leaderLockKey(jobName) {
  return `lock:cron:${jobName}`;
}

/**
 * Run `fn` on at most one instance per tick across the fleet.
 *
 * @param {string} jobName  stable id for the job (becomes the Redis key).
 * @param {() => (void|Promise<void>)} fn  the job body.
 * @param {{ ttlMs?: number }} [opts]
 * @returns {Promise<boolean>} true if this instance ran the job, false if it skipped.
 */
export async function withLeaderLock(jobName, fn, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const key = leaderLockKey(jobName);

  // Decide whether this instance runs. Default to running (fail-open) and only
  // back off to "skip" when Redis positively tells us another instance won.
  let shouldRun = true;
  if (redis?.status === 'ready') {
    try {
      const ok = await redis.set(key, INSTANCE_ID, 'PX', ttlMs, 'NX');
      shouldRun = ok === 'OK';
    } catch (err) {
      logger.warn('[LeaderLock] %s: acquire failed (%s) — running uncoordinated', jobName, err.message);
      shouldRun = true; // transient Redis error mid-command → fail open
    }
  } else {
    logger.warn('[LeaderLock] %s: Redis unavailable — running uncoordinated (single-instance assumption)', jobName);
  }

  if (!shouldRun) {
    logger.info('[LeaderLock] %s: claimed this tick by another instance — skipping', jobName);
    return false;
  }

  try {
    await fn();
    return true;
  } catch (err) {
    // Never let a job error escape into an unhandled rejection inside a cron tick.
    logger.error({ err }, '[LeaderLock] %s: job threw', jobName);
    return false;
  }
}

export default withLeaderLock;
