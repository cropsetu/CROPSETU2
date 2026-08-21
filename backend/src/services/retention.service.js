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
    // A null model is a category this loop cannot serve: the table has no Prisma
    // delegate because it is not in schema.prisma. It still carries a cutoff so
    // every retention window lives in one file — the sweep for it runs below.
    if (!p.model) continue;
    // `extraWhere` narrows a category beyond its age. Only one entry needs it
    // today and it is the reason it exists: stock reservations may be purged
    // once they reach a TERMINAL state, but a HELD row is live inventory — it is
    // units removed from a shelf that nobody has returned yet, and deleting one
    // loses stock silently.
    const where = { [p.dateField]: { lt: cutoffs[p.key] }, ...(p.extraWhere || {}) };
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

  // ── Tables Prisma cannot see ─────────────────────────────────────────────
  // ai_scan_diagnoses and ai_scan_feedback are created by the FastAPI service
  // through asyncpg and are absent from schema.prisma, so RETENTION_POLICY
  // structurally cannot name them — `prisma[p.model]` has no delegate to call.
  // They were therefore the only tables in §26's list with NO retention at all,
  // while carrying a full diagnosis payload per scan.
  //
  // Same shape as the erasure service's handling of the same two tables: probe
  // for existence FIRST, because Postgres aborts a whole transaction on a
  // missing relation and a deployment where the AI service has never booted must
  // still complete its sweep.
  Object.assign(results, await sweepAiScanTables(cutoffs.aiScanDiagnoses, dryRun));

  return results;
}

/**
 * Age out the FastAPI-owned scan tables.
 *
 * Kept beside the policy table rather than inside it so the data-driven loop
 * stays data-driven: every other category is a Prisma delegate and a column
 * name, and pretending these two are the same shape would mean teaching the
 * loop about raw SQL for a special case of two.
 */
async function sweepAiScanTables(cutoff, dryRun) {
  const out = {};
  const tables = ['ai_scan_feedback', 'ai_scan_diagnoses'];

  let present = [];
  try {
    const rows = await prisma.$queryRaw`
      SELECT c.name FROM unnest(${tables}::text[]) AS c(name)
      WHERE to_regclass('public.' || c.name) IS NOT NULL
    `;
    present = rows.map((r) => r.name);
  } catch (err) {
    logger.error({ err }, '[Retention] could not determine AI scan tables');
    return { aiScanDiagnoses: { error: err.message } };
  }

  for (const table of tables) {
    if (!present.includes(table)) { out[table] = { skipped: 'absent' }; continue; }
    try {
      if (dryRun) {
        const [{ n }] = await prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM "${table}" WHERE created_at < $1`, cutoff);
        out[table] = n;
      } else {
        out[table] = await prisma.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE created_at < $1`, cutoff);
      }
    } catch (err) {
      logger.error({ err, table }, '[Retention] purge failed for AI scan table');
      out[table] = { error: err.message };
    }
  }
  return out;
}
