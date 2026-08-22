/**
 * Stock reservation — holding units while a payment is in flight.
 *
 * ── The race ─────────────────────────────────────────────────────────────────
 * Stock was decremented at order creation, which on the online path happens at
 * /orders/confirm — AFTER the money has moved. Two buyers could both open the
 * payment sheet for the last bag of seed, both pay, and the second would be told
 * "insufficient stock" having already been charged. The platform then owed a
 * refund for a checkout it had itself allowed to proceed.
 *
 * That is not a rare edge: it is precisely the popular, nearly-sold-out product
 * where two farmers are most likely to be checking out at the same moment.
 *
 * ── The fix ──────────────────────────────────────────────────────────────────
 *   initiate  decrement stockQty, write HELD rows with a TTL
 *   confirm   create the order WITHOUT decrementing; flip HELD → CONSUMED
 *   failure   RELEASE — increment stockQty back
 *   expiry    a sweeper RELEASEs anything past its TTL
 *
 * The decisive design choice is that `stockQty` keeps its existing meaning:
 * "units available to sell right now". Every read path — buy box, product list,
 * cart validation, storefront filtering — is therefore untouched. The obvious
 * alternative (leave stock alone, subtract live reservations at read time) would
 * have required all of those paths to learn about reservations, and any one that
 * forgot would oversell. This way, forgetting is impossible.
 *
 * ── Why a farmer cannot lose stock to this ───────────────────────────────────
 * Every path out of HELD is covered: confirm consumes, the webhook's
 * payment.failed releases, the reconciler releases on FAILED/EXPIRED, and the
 * sweeper releases anything the other three miss. Release is an increment, and
 * it is idempotent through a status transition guarded by `updateMany` on
 * `status: 'HELD'` — so a double release is a no-op rather than free inventory.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { getSetting } from './settings.service.js';
import { applyListingStockDeltas, } from '../utils/stockBatch.js';
import { withSerializableRetry } from '../utils/txRetry.js';
import { syncListingStockStatus } from './buyBox.service.js';
import { recordEvent, SHOP_EVENTS } from './shopMetrics.service.js';

async function config() {
  const [enabled, ttlMinutes] = await Promise.all([
    getSetting('shop.reservation.enabled'),
    getSetting('shop.reservation.ttlMinutes'),
  ]);
  return {
    enabled: enabled !== false,
    ttlMs: Math.max(1, Number(ttlMinutes) || 15) * 60_000,
  };
}

/**
 * Hold stock for a set of cart lines, inside the caller's transaction.
 *
 * MUST run inside a Serializable transaction that has already validated the
 * lines — the decrement carries its own `>= 0` guard as defence in depth, but
 * the guarantee comes from the isolation level, exactly as checkout's does.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.providerOrderId
 * @param {Array<{listingId: string, quantity: number}>} args.lines
 * @param {number} args.ttlMs
 * @returns {Promise<{reserved: number, crossedZero: string[], expiresAt: Date}>}
 */
export async function holdStock(tx, { userId, providerOrderId, lines, ttlMs }) {
  const expiresAt = new Date(Date.now() + ttlMs);
  const deltas = lines.map((l) => ({ listingId: l.listingId, delta: -l.quantity }));

  // Throws a client-safe 400 if any line would go negative — the same guard the
  // ordinary checkout decrement uses.
  const { crossedZero } = await applyListingStockDeltas(tx, deltas);
  await syncListingStockStatus(tx, crossedZero);

  await tx.stockReservation.createMany({
    data: lines.map((l) => ({
      listingId: l.listingId,
      userId,
      quantity: l.quantity,
      providerOrderId,
      status: 'HELD',
      expiresAt,
    })),
  });

  recordEvent(SHOP_EVENTS.RESERVATION_HELD, lines.length);
  return { reserved: lines.length, crossedZero, expiresAt };
}

/**
 * The live holds for a gateway order, if any.
 * Read OUTSIDE a transaction by the confirm path so it can decide which branch
 * to take before opening one.
 */
export async function heldFor(providerOrderId) {
  if (!providerOrderId) return [];
  return prisma.stockReservation.findMany({
    where: { providerOrderId, status: 'HELD' },
    select: { id: true, listingId: true, quantity: true, userId: true, expiresAt: true },
  });
}

/**
 * Mark a gateway order's holds CONSUMED, inside the caller's transaction.
 *
 * Guarded on `status: 'HELD'`, so a replayed confirm consumes nothing a second
 * time. Returns how many rows actually transitioned — the caller uses that to
 * decide whether the stock was genuinely already held or whether it must fall
 * back to decrementing.
 */
export async function consumeReservations(tx, providerOrderId) {
  if (!providerOrderId) return 0;
  const { count } = await tx.stockReservation.updateMany({
    where: { providerOrderId, status: 'HELD' },
    data: { status: 'CONSUMED' },
  });
  if (count) recordEvent(SHOP_EVENTS.RESERVATION_CONSUMED, count);
  return count;
}

/**
 * Release the holds for a gateway order, returning the units to stock.
 *
 * Idempotent: the `status: 'HELD'` predicate means a second call transitions
 * nothing and therefore increments nothing. That property is what makes it safe
 * to call from four different places (confirm-failure, webhook, reconciler,
 * sweeper) without coordinating between them.
 *
 * Runs in its own transaction — callers reach it from error paths where the
 * original transaction has already rolled back.
 */
export async function releaseReservations(providerOrderId, reason = 'released') {
  if (!providerOrderId) return { released: 0 };

  try {
    // Retried: a release that loses a serialization race leaves the units HELD
    // until the sweeper comes round, and held-forever stock is invisible lost
    // inventory. A replay is exactly what fixes a 40001.
    const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      // Lock the rows by transitioning them FIRST, then compute the restock from
      // exactly the rows this call won. Reading then updating would let two
      // concurrent releases both read HELD and both restock.
      const held = await tx.stockReservation.findMany({
        where: { providerOrderId, status: 'HELD' },
        select: { id: true, listingId: true, quantity: true },
      });
      if (!held.length) return { released: 0, crossedZero: [] };

      const { count } = await tx.stockReservation.updateMany({
        where: { id: { in: held.map((h) => h.id) }, status: 'HELD' },
        data: { status: 'RELEASED', releasedAt: new Date(), releaseReason: String(reason).slice(0, 200) },
      });
      if (!count) return { released: 0, crossedZero: [] };

      const { crossedZero } = await applyListingStockDeltas(
        tx,
        held.map((h) => ({ listingId: h.listingId, delta: h.quantity })),
      );
      await syncListingStockStatus(tx, crossedZero);
      return { released: count, crossedZero };
    }, { isolationLevel: 'Serializable' }));

    if (result.released) recordEvent(SHOP_EVENTS.RESERVATION_RELEASED, result.released);
    return result;
  } catch (err) {
    // A failed release means stock stays held until the sweeper retries it.
    // Loud, because held-forever stock is invisible lost inventory.
    logger.error({ err, providerOrderId }, '[Reservation] release failed — stock stays held until the sweep');
    return { released: 0, error: true };
  }
}

/**
 * Release every hold past its TTL.
 *
 * The backstop for all three other release paths. An abandoned payment sheet is
 * the common case and produces no signal at all — no webhook, no client call —
 * so without this the units would be held until the heat death of the listing.
 *
 * Batched, because a burst of abandonments should not become one enormous
 * transaction holding locks across the whole catalogue.
 */
export async function sweepExpiredReservations({ batchSize = 200 } = {}) {
  const now = new Date();
  let releasedTotal = 0;
  let bumped = false;

  try {
    const expired = await prisma.stockReservation.findMany({
      where: { status: 'HELD', expiresAt: { lt: now } },
      select: { providerOrderId: true },
      distinct: ['providerOrderId'],
      take: batchSize,
    });

    for (const { providerOrderId } of expired) {
      if (!providerOrderId) continue;
      const r = await releaseReservations(providerOrderId, 'expired: payment not completed in time');
      releasedTotal += r.released || 0;
      if (r.crossedZero?.length) bumped = true;
    }

    // Rows with no gateway order id (defensive — the write path always sets one).
    const orphaned = await prisma.stockReservation.updateMany({
      where: { status: 'HELD', expiresAt: { lt: now }, providerOrderId: null },
      data: { status: 'EXPIRED', releasedAt: now, releaseReason: 'expired without a gateway order' },
    });

    if (releasedTotal) recordEvent(SHOP_EVENTS.RESERVATION_EXPIRED, releasedTotal);
    return { released: releasedTotal, orphaned: orphaned.count, bumped };
  } catch (err) {
    logger.error({ err }, '[Reservation] expiry sweep failed');
    return { released: 0, orphaned: 0, error: true };
  }
}

export { config as reservationConfig };
