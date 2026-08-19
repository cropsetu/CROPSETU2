/**
 * Referential integrity for the money rails.
 *
 * SellerLedgerEntry, Payout and Dispute reference users through BARE STRING
 * SCALARS with no foreign key. That is deliberate — these models were added
 * additively so `prisma db push` stays the deploy path, and introducing FKs onto
 * User now would break it. The cost is that nothing stops a ledger entry, a
 * payout or a dispute pointing at a user id that does not exist, or that stops
 * existing rows being orphaned when a user is deleted.
 *
 * So the guarantee is rebuilt in two halves, because neither is sufficient alone:
 *
 *   1. `assertUsersExist` at WRITE time — catches the typo, the stale id from a
 *      copy-pasted admin console, the seller deleted between page load and
 *      submit. This is the half that prevents new orphans.
 *   2. `findOrphanedReferences` on a SCHEDULE — catches what write-time checks
 *      structurally cannot: rows orphaned AFTER they were written, by a user
 *      deletion that no FK was there to refuse. Reporting only; deciding what a
 *      payout to a deleted user means is an operator's call, not a sweeper's.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';

/**
 * Refuse a write that references a user id which does not exist.
 *
 * @param {Array<?string>} ids   user ids to check; null/undefined entries are
 *                               skipped so optional columns need no special case
 *                               at the call site
 * @param {string} [label]       what is being written, for the error message
 * @throws {Error} statusCode 400 / expose when any id is missing
 */
export async function assertUsersExist(ids, label = 'record') {
  const wanted = [...new Set(ids.filter(Boolean).map(String))];
  if (!wanted.length) return;

  const found = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true },
  });
  const have = new Set(found.map((u) => u.id));
  const missing = wanted.filter((id) => !have.has(id));

  if (missing.length) {
    throw Object.assign(
      new Error(
        missing.length === 1
          ? `Cannot create this ${label}: the referenced user no longer exists.`
          : `Cannot create this ${label}: ${missing.length} referenced users no longer exist.`,
      ),
      { statusCode: 400, expose: true, code: 'UNKNOWN_USER_REFERENCE', missing },
    );
  }
}

/**
 * Which columns on which tables point at a user without a foreign key.
 *
 * Kept as data rather than three hand-written queries so adding a fourth
 * FK-less model is one line here, not a new function nobody remembers to call.
 */
const USER_REFERENCES = [
  { model: 'sellerLedgerEntry', label: 'SellerLedgerEntry', columns: ['sellerId', 'createdBy'] },
  { model: 'payout', label: 'Payout', columns: ['sellerId', 'processedBy'] },
  { model: 'dispute', label: 'Dispute', columns: ['raisedBy', 'againstUser', 'assignedTo'] },
];

/**
 * Report rows whose user references have gone missing.
 *
 * Read-only by design. An orphaned payout may mean a real accounting problem, a
 * test fixture, or a user erased on request — deleting it automatically would
 * destroy the evidence needed to tell those apart.
 *
 * @param {{ limitPerColumn?: number }} [opts]
 * @returns {Promise<{ total: number, byModel: object[] }>}
 */
export async function findOrphanedReferences({ limitPerColumn = 50 } = {}) {
  const byModel = [];
  let total = 0;

  for (const { model, label, columns } of USER_REFERENCES) {
    for (const column of columns) {
      // Distinct referenced ids first, so a table with 100k rows pointing at one
      // deleted seller costs one lookup rather than 100k.
      // No `where: { not: null }` here: Prisma rejects that on a NON-nullable
      // column, and this list deliberately mixes required (sellerId, raisedBy)
      // with optional (createdBy, assignedTo) ones. Nulls are dropped below,
      // where the same line covers both cases.
      const grouped = await prisma[model].groupBy({
        by: [column],
        _count: { _all: true },
      });
      const ids = grouped.map((g) => g[column]).filter(Boolean);
      if (!ids.length) continue;

      const found = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
      const have = new Set(found.map((u) => u.id));

      const orphans = grouped
        .filter((g) => g[column] && !have.has(g[column]))
        .map((g) => ({ userId: g[column], rows: g._count._all }))
        .slice(0, limitPerColumn);

      if (orphans.length) {
        const rows = orphans.reduce((n, o) => n + o.rows, 0);
        total += rows;
        byModel.push({ model: label, column, missingUsers: orphans.length, rows, orphans });
      }
    }
  }

  return { total, byModel };
}

/**
 * Cron entry point: run the check and log the result.
 *
 * Logged at WARN when anything is found, because a silent integrity report is
 * the same as no integrity report.
 */
export async function reportOrphanedReferences() {
  const result = await findOrphanedReferences();
  if (result.total) {
    logger.warn({ ...result }, '[Integrity] rows reference users that no longer exist');
  } else {
    logger.info('[Integrity] no orphaned user references');
  }
  return result;
}
