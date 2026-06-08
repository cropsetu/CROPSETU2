/**
 * Retention Service — automated enforcement of the data-retention policy.
 *
 * runRetentionSweep() walks RETENTION_POLICY and purges every row past its
 * window. It is data-driven (one entry per category), idempotent, and safe to
 * run repeatedly — a sweep that finds nothing expired is a no-op. The sweep is
 * scheduled daily in server.js; it can also be invoked manually for ops/testing.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { RETENTION_POLICY, MS_PER_DAY } from '../constants/retention.js';

/**
 * Compute the purge cutoff Date for each policy entry. Pure + exported for
 * tests: rows with dateField < cutoff[key] are expired.
 */
export function retentionCutoffs(now = new Date()) {
  const out = {};
  for (const p of RETENTION_POLICY) {
    out[p.key] = new Date(now.getTime() - p.days * MS_PER_DAY);
  }
  return out;
}

/**
 * Run the retention sweep.
 * @param {object}  [opts]
 * @param {Date}    [opts.now]    — reference time (injectable for testing)
 * @param {boolean} [opts.dryRun] — count instead of delete (preview, no mutation)
 * @returns {Promise<object>} per-category counts purged (or that would be purged)
 */
export async function runRetentionSweep({ now = new Date(), dryRun = false } = {}) {
  const cutoffs = retentionCutoffs(now);
  const results = {};

  for (const p of RETENTION_POLICY) {
    const where = { [p.dateField]: { lt: cutoffs[p.key] } };
    try {
      if (dryRun) {
        results[p.key] = await prisma[p.model].count({ where });
      } else {
        const { count } = await prisma[p.model].deleteMany({ where });
        results[p.key] = count;
      }
    } catch (err) {
      // One failing category must not abort the rest of the sweep.
      logger.error({ err, category: p.key }, '[Retention] purge failed for category');
      results[p.key] = { error: err.message };
    }
  }

  return results;
}
