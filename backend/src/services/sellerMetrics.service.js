/**
 * Seller fulfillment metrics — the DERIVED aggregates behind buy-box weights
 * w2 (sellerRating) and w4 (fulfillmentScore).
 *
 * These are refreshed by a scheduled job and read straight off SellerProfile.
 * They are NEVER computed per request: the buy box runs on every product page
 * load, and re-aggregating a seller's whole order history there is the same
 * mistake getSellerStats() already exists to avoid on the dashboard.
 *
 * ── WHAT MADE THIS POSSIBLE ─────────────────────────────────────────────────
 * None of this was computable before CATALOG-SPLIT:
 *   • Review had no sellerId, so a rating could not be attributed to a seller;
 *   • Review's @@unique([userId, productId]) meant a buyer who bought the same
 *     seed from two Kendras could only ever rate one of them;
 *   • OrderItem had only createdAt/updatedAt — no confirmedAt/shippedAt/
 *     deliveredAt/cancelledAt — so dispatch SLA and cancellation rate had
 *     literally no source data;
 *   • ReturnRequest had no seller reference at all.
 *
 * ── HISTORICAL DATA IS INCOMPLETE ON PURPOSE ────────────────────────────────
 * The backfill did NOT invent transition timestamps. Pre-split order items have
 * shippedAt = NULL because nobody recorded when they shipped. onTimeDispatchRate
 * therefore counts only items that actually have a shippedAt — an item with no
 * record is EXCLUDED, never scored as late. A seller with no post-split shipments
 * keeps metricsUpdatedAt = NULL, which the buy box reads as "no data" and handles
 * by zeroing the reputation weights rather than ranking on noise.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { getSetting } from './settings.service.js';
import { invalidateBuyBox } from './buyBox.service.js';

/** Item statuses that represent a finished outcome. */
const TERMINAL = ['DELIVERED', 'CANCELLED'];

async function windowStart() {
  const days = Number(await getSetting('sellerMetrics.windowDays')) || 180;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Recompute one seller's metrics and persist them.
 *
 * Returns the computed values, or null when the seller has no SellerProfile
 * (metrics live on the profile, and only KYC'd sellers have one).
 */
export async function refreshSellerMetrics(sellerId, since) {
  const from = since || (await windowStart());

  const profile = await prisma.sellerProfile.findUnique({
    where: { userId: sellerId },
    select: { id: true },
  });
  if (!profile) return null;

  const [ratingAgg, terminalItems, dispatchItems, deliveredCount, returnCount] = await Promise.all([
    // Rating: reviews attributed to THIS seller, not to the catalog product.
    prisma.review.aggregate({
      where: { sellerId },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    // Cancellation rate denominator: everything that reached a terminal state.
    prisma.orderItem.groupBy({
      by: ['status'],
      where: { sellerId, status: { in: TERMINAL }, createdAt: { gte: from } },
      _count: { _all: true },
    }),
    // Dispatch SLA: only items with a REAL shippedAt. Items missing one are
    // excluded from both numerator and denominator — see the header.
    prisma.orderItem.findMany({
      where: { sellerId, shippedAt: { not: null }, createdAt: { gte: from } },
      select: { createdAt: true, shippedAt: true, listingId: true },
    }),
    prisma.orderItem.count({ where: { sellerId, status: 'DELIVERED', createdAt: { gte: from } } }),
    prisma.returnRequest.count({
      where: { sellerId, createdAt: { gte: from }, status: { in: ['APPROVED', 'REFUNDED', 'COMPLETED'] } },
    }),
  ]);

  const byStatus = Object.fromEntries(terminalItems.map((r) => [r.status, r._count._all]));
  const cancelled = byStatus.CANCELLED || 0;
  const delivered = byStatus.DELIVERED || 0;
  const terminal  = cancelled + delivered;

  // Each item's own SLA comes from the listing it was sold through, so a seller
  // who promises 1 day on one offer and 5 on another is judged against what they
  // actually promised. Listings are fetched in one query, not per item.
  const listingIds = [...new Set(dispatchItems.map((i) => i.listingId).filter(Boolean))];
  const slaById = new Map(
    listingIds.length
      ? (await prisma.sellerListing.findMany({
          where: { id: { in: listingIds } },
          select: { id: true, dispatchSlaDays: true },
        })).map((l) => [l.id, l.dispatchSlaDays])
      : [],
  );
  const defaultSla = Number(await getSetting('sellerMetrics.defaultDispatchSlaDays')) || 2;

  let onTime = 0;
  for (const item of dispatchItems) {
    const slaDays = slaById.get(item.listingId) ?? defaultSla;
    const dueBy = new Date(new Date(item.createdAt).getTime() + slaDays * 24 * 60 * 60 * 1000);
    if (new Date(item.shippedAt) <= dueBy) onTime += 1;
  }

  const metrics = {
    rating:      Number((ratingAgg._avg.rating || 0).toFixed(2)),
    ratingCount: ratingAgg._count.rating || 0,
    cancellationRate:   terminal ? Number((cancelled / terminal).toFixed(4)) : 0,
    // No dispatch history → 1 (the schema default), not 0. "Unknown" must not read
    // as "always late", or every new Kendra starts at the bottom of the buy box.
    onTimeDispatchRate: dispatchItems.length ? Number((onTime / dispatchItems.length).toFixed(4)) : 1,
    returnRate:         delivered ? Number((returnCount / delivered).toFixed(4)) : 0,
    // Only stamp this once there is SOMETHING to stand on. While it is NULL the
    // buy box treats the seller as unrated and drops the reputation weights.
    metricsUpdatedAt: (ratingAgg._count.rating || terminal || dispatchItems.length) ? new Date() : null,
  };

  await prisma.sellerProfile.update({ where: { userId: sellerId }, data: metrics });

  // Mirror the rating onto this seller's listings so an offer row can be sorted
  // and rendered without a join back through SellerProfile.
  await prisma.sellerListing.updateMany({
    where: { sellerId },
    data: { rating: metrics.rating, ratingCount: metrics.ratingCount },
  });

  return metrics;
}

/**
 * Refresh every seller who has had activity in the window, plus anyone whose
 * metrics have never been computed. Bounded fan-out: sellers are processed in
 * small concurrent batches so a large marketplace does not open hundreds of
 * simultaneous connections against the pool.
 */
export async function refreshAllSellerMetrics({ batchSize = 10 } = {}) {
  const from = await windowStart();

  const [active, never] = await Promise.all([
    prisma.orderItem.findMany({
      where: { sellerId: { not: null }, createdAt: { gte: from } },
      select: { sellerId: true },
      distinct: ['sellerId'],
    }),
    prisma.sellerProfile.findMany({
      where: { metricsUpdatedAt: null },
      select: { userId: true },
      take: 500,
    }),
  ]);

  const sellerIds = [...new Set([...active.map((r) => r.sellerId), ...never.map((r) => r.userId)])].filter(Boolean);

  let refreshed = 0;
  for (let i = 0; i < sellerIds.length; i += batchSize) {
    const batch = sellerIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map((id) => refreshSellerMetrics(id, from)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) refreshed += 1;
      else if (r.status === 'rejected') logger.warn('[SellerMetrics] refresh failed: %s', r.reason?.message);
    }
  }

  // Ranking inputs moved → every cached buy box is stale.
  if (refreshed) await invalidateBuyBox();

  return { candidates: sellerIds.length, refreshed };
}

/**
 * Stamp the transition timestamp that matches an OrderItem status change, so the
 * metrics above have something to read. Returns the `data` patch to merge into
 * the update — deliberately a pure function of the status so it can be applied
 * inside the same statement that sets it.
 */
export function transitionTimestampFor(status, at = new Date()) {
  switch (status) {
    case 'CONFIRMED': return { confirmedAt: at };
    case 'SHIPPED':   return { shippedAt: at };
    case 'DELIVERED': return { deliveredAt: at };
    case 'CANCELLED': return { cancelledAt: at };
    default:          return {};
  }
}
