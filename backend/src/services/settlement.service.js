/**
 * Seller settlement service (admin WI-4, scope FINANCE).
 *
 * Pure-ish helpers over the SellerLedgerEntry / Payout models:
 *   - getSellerBalance(sellerId)  — net of every ledger entry (the running balance).
 *   - getCommissionRatePct()      — the marketplace commission rate from runtime settings.
 *   - generatePayoutForPeriod(...) — compute a seller's payable amount for a window
 *     and atomically create a PENDING Payout + a matching PAYOUT ledger entry.
 *
 * MONEY MODEL: the ledger is signed and append-only. SALE entries are positive
 * (credit the seller); COMMISSION, REFUND and PAYOUT entries are negative (debit);
 * ADJUSTMENT is a signed manual correction. The seller's balance is therefore just
 * the SUM of `amount` over all their entries. Each entry snapshots `balanceAfter`
 * for auditability. All arithmetic uses Prisma.Decimal so money stays exact.
 *
 * Seeding SALE/COMMISSION/REFUND entries from completed orders is OUT OF SCOPE for
 * this work item — wiring order-completion to write ledger rows is a follow-up.
 * The admin surface + manual ADJUSTMENT entries are what this build exposes.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { getSetting } from './settings.service.js';

const D = (v) => new Prisma.Decimal(v ?? 0);
const ZERO = new Prisma.Decimal(0);

/** Net balance for a seller = sum of every ledger entry's signed amount. */
export async function getSellerBalance(sellerId) {
  const agg = await prisma.sellerLedgerEntry.aggregate({
    where: { sellerId },
    _sum: { amount: true },
  });
  return D(agg._sum.amount ?? 0);
}

/** Marketplace commission rate (%), from runtime settings (default 5). */
export async function getCommissionRatePct() {
  const pct = await getSetting('marketplace.commissionRatePct');
  const n = Number(pct);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/**
 * Sum a seller's ledger entries of a given type within an (inclusive) window,
 * returning a positive Decimal magnitude regardless of the stored sign.
 */
async function sumTypeInPeriod(sellerId, type, from, to) {
  const agg = await prisma.sellerLedgerEntry.aggregate({
    where: { sellerId, type, createdAt: { gte: from, lte: to } },
    _sum: { amount: true },
  });
  return D(agg._sum.amount ?? 0).abs();
}

/**
 * Total already paid (or in flight) for an OVERLAPPING settlement period — the
 * idempotency basis. Payout rows carry the settlement window (periodFrom/periodTo),
 * not "now", so prior payouts are matched on window overlap, not the ledger entry's
 * createdAt. FAILED payouts are excluded (their money was never settled).
 */
async function priorPayoutsForPeriod(sellerId, from, to) {
  const agg = await prisma.payout.aggregate({
    where: {
      sellerId,
      status: { not: 'FAILED' },
      periodFrom: { lte: to },
      periodTo: { gte: from },
    },
    _sum: { amount: true },
  });
  return D(agg._sum.amount ?? 0);
}

/**
 * Compute and create a payout for a seller over [from, to].
 *
 * payable = sales − commission − refunds − priorPayouts (all over the period).
 *   - `sales` is the gross SALE total in the window.
 *   - `commission` is the COMMISSION debited in the window; if no commission rows
 *     exist yet (ledger seeding is a follow-up) it falls back to
 *     sales * commissionRatePct so the figure is never understated.
 *   - `refunds` is the REFUND total in the window.
 *   - `priorPayouts` is anything already paid out for the same window (idempotency).
 *
 * Atomically writes a PENDING Payout row AND a negative PAYOUT ledger entry whose
 * `balanceAfter` snapshots the seller's new running balance. Returns the payout +
 * the computed breakdown. Throws (exposed 400) when the payable is not positive.
 *
 * @returns {Promise<{ payout: object, breakdown: object }>}
 */
export async function generatePayoutForPeriod(sellerId, from, to, createdBy = null) {
  const periodFrom = from instanceof Date ? from : new Date(from);
  const periodTo = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime())) {
    throw Object.assign(new Error('Invalid settlement period'), { expose: true, statusCode: 400 });
  }
  if (periodFrom > periodTo) {
    throw Object.assign(new Error('periodFrom must be on or before periodTo'), { expose: true, statusCode: 400 });
  }

  const ratePct = await getCommissionRatePct();
  const [sales, commissionLogged, refunds, priorPayouts] = await Promise.all([
    sumTypeInPeriod(sellerId, 'SALE', periodFrom, periodTo),
    sumTypeInPeriod(sellerId, 'COMMISSION', periodFrom, periodTo),
    sumTypeInPeriod(sellerId, 'REFUND', periodFrom, periodTo),
    priorPayoutsForPeriod(sellerId, periodFrom, periodTo),
  ]);

  // Use explicit COMMISSION rows when present; otherwise derive from the rate so a
  // ledger without commission rows (pre-seeding) still nets the platform cut.
  const commission = commissionLogged.gt(ZERO)
    ? commissionLogged
    : sales.mul(D(ratePct)).div(100);

  const payable = sales.minus(commission).minus(refunds).minus(priorPayouts);

  if (payable.lte(ZERO)) {
    throw Object.assign(
      new Error('Nothing payable for this seller over the selected period'),
      { expose: true, statusCode: 400 },
    );
  }

  // 2 dp so the payout and ledger entry match the stored Decimal(12,2) scale.
  const amount = payable.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

  const result = await prisma.$transaction(async (tx) => {
    const balAgg = await tx.sellerLedgerEntry.aggregate({ where: { sellerId }, _sum: { amount: true } });
    const balanceBefore = D(balAgg._sum.amount ?? 0);
    const balanceAfter = balanceBefore.minus(amount);

    const payout = await tx.payout.create({
      data: {
        sellerId,
        amount,
        status: 'PENDING',
        periodFrom,
        periodTo,
        processedBy: createdBy,
      },
    });

    const ledger = await tx.sellerLedgerEntry.create({
      data: {
        sellerId,
        type: 'PAYOUT',
        amount: amount.negated(), // debit the seller's balance
        balanceAfter,
        note: `Payout ${payout.id} for ${periodFrom.toISOString().slice(0, 10)}…${periodTo.toISOString().slice(0, 10)}`,
        createdBy,
      },
    });

    return { payout, ledgerEntryId: ledger.id };
  });

  return {
    payout: result.payout,
    breakdown: {
      sales,
      commission,
      commissionRatePct: ratePct,
      commissionDerived: !commissionLogged.gt(ZERO),
      refunds,
      priorPayouts,
      payable: amount,
      ledgerEntryId: result.ledgerEntryId,
    },
  };
}
