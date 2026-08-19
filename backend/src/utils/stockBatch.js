import { Prisma } from '@prisma/client';

/**
 * Stock mutation: signed deltas applied to seller_listings.stockQty, keyed by
 * LISTING id, in a SINGLE SQL statement.
 *
 * Stock is a property of one seller's offer, not of the catalog entry. This
 * replaced a product-targeted `UPDATE products SET stock = stock + delta` that
 * decremented a row shared by every Kendra — one buyer's purchase silently
 * drained all three sellers' stock. That statement is gone; every checkout,
 * confirm, reservation and restock path goes through this one.
 *
 * Negative deltas decrement (checkout), positive increment (cancellation /
 * restock). Duplicate listingIds are summed so a single listing never gets a
 * partial update — an UPDATE with multiple matching VALUES rows would otherwise
 * apply only one of them.
 *
 * MUST be called inside the same transaction (`tx`) that validated stock, so the
 * read-validate-write stays atomic under Serializable isolation.
 *
 * Also returns which listings CROSSED the zero boundary, because that is the only
 * stock event the buy box has to invalidate on (see buyBox.service.js).
 *
 * The `stockQty + delta >= 0` guard in the SQL is DEFENCE IN DEPTH, not a
 * replacement for validating before the write. The deleted product-targeted
 * statement had none, so correctness rested entirely on the caller remembering to
 * validate first plus Serializable isolation; any path that forgot drove stock
 * negative silently. Here a row that would go negative simply does not match, the
 * RETURNING count comes up short, and the caller-agnostic check below throws a
 * client-safe 400 that aborts the transaction.
 *
 * The guard is NOT `GREATEST(stockQty + delta, 0)`: clamping would turn an
 * over-sell into a *successful* order for the wrong quantity.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Array<{ listingId: string, delta: number }>} deltas
 * @returns {Promise<{ rows: number, crossedZero: string[] }>}
 * @throws {Error} statusCode 400 / expose when a delta would drive stock negative
 */
export async function applyListingStockDeltas(tx, deltas) {
  if (!deltas || !deltas.length) return { rows: 0, crossedZero: [] };

  const byId = new Map();
  for (const { listingId, delta } of deltas) {
    byId.set(listingId, (byId.get(listingId) || 0) + delta);
  }

  const values = [...byId.entries()].map(
    ([listingId, delta]) => Prisma.sql`(${listingId}::text, ${delta}::int)`,
  );

  // RETURNING lets us detect zero crossings in the same round-trip rather than
  // re-reading every touched listing afterwards.
  const updated = await tx.$queryRaw`
    UPDATE seller_listings AS l
    SET "stockQty" = l."stockQty" + v.delta
    FROM (VALUES ${Prisma.join(values)}) AS v(id, delta)
    WHERE l.id = v.id
      AND l."stockQty" + v.delta >= 0
    RETURNING l.id, l."stockQty" AS "stockAfter", (l."stockQty" - v.delta) AS "stockBefore"
  `;

  if (updated.length !== byId.size) {
    throw Object.assign(
      new Error('An item in your cart just sold out. Please review your cart and try again.'),
      { statusCode: 400, expose: true },
    );
  }

  const crossedZero = updated
    .filter((r) => (Number(r.stockBefore) > 0) !== (Number(r.stockAfter) > 0))
    .map((r) => r.id);

  return { rows: updated.length, crossedZero };
}
