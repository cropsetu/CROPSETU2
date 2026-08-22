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
 * One statement, not one per item: the naive checkout/cancel path looped
 * `tx.product.update({ decrement })` once per cart item — O(n) DB round-trips,
 * so write latency (and the time the Serializable transaction holds its locks)
 * scaled with cart size. Folding every delta into one
 * `UPDATE ... FROM (VALUES ...)` gives a constant number of statements per
 * checkout regardless of cart size. Both functions here keep that property.
 *
 * One product-keyed exception survives, immediately below. A product that
 * predates the catalog split has no variants, therefore no seller_listing,
 * therefore no listingId on its cart row: checkout takes the DUAL-READ branch in
 * validateCartForCheckout and its stock lives on `products.stock`, where
 * applyListingStockDeltas cannot reach it. applyStockDeltas serves that case,
 * and no other.
 */

/**
 * LEGACY product-keyed stock mutation: signed deltas applied to products.stock,
 * in a SINGLE SQL statement. Same shape and same guarantees as the listing-keyed
 * function below.
 *
 * STILL REQUIRED after the catalog split, for exactly one case: a product that
 * predates the split has no variants, therefore no seller_listing, therefore no
 * listingId on its cart row — so checkout takes the DUAL-READ branch in
 * validateCartForCheckout and stock lives on `products.stock`, where
 * applyListingStockDeltas cannot reach it.
 *
 * That case was validated and never written. This function was documented as
 * "retained only for the dual-write window" and had ZERO call sites, so no
 * order has ever moved products.stock: the legacy branch checked
 * `p.stock < quantity` against a number that never went down, and the same last
 * unit could be sold without limit. 20 of 67 products in the development
 * database have no variants, so this was not a hypothetical branch.
 *
 * It reaches ONLY rows that have no seller_listing, so it cannot drain stock
 * shared between Kendras — the failure that retired the old product-wide
 * statement — and it carries the same `>= 0` guard, so it cannot oversell.
 *
 * MUST be called inside the same transaction (`tx`) that validated stock, so the
 * read-validate-write stays atomic under Serializable isolation.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Array<{ productId: string, delta: number }>} deltas
 * @returns {Promise<{ rows: number, crossedZero: string[] }>}
 * @throws {Error} statusCode 400 / expose when a delta would drive stock negative
 */
export async function applyStockDeltas(tx, deltas) {
  if (!deltas || !deltas.length) return { rows: 0, crossedZero: [] };

  // Collapse duplicates so each product appears at most once in the VALUES list.
  const byId = new Map();
  for (const { productId, delta } of deltas) {
    byId.set(productId, (byId.get(productId) || 0) + delta);
  }

  const rows = [...byId.entries()].map(
    ([productId, delta]) => Prisma.sql`(${productId}::text, ${delta}::int)`,
  );

  // Same `>= 0` guard and RETURNING shape as applyListingStockDeltas below.
  // This statement used to be an unguarded $executeRaw, which was survivable
  // only for as long as it had no callers — and it had none, which was the
  // actual bug (see the note above this function).
  const updated = await tx.$queryRaw`
    UPDATE products AS p
    SET stock = p.stock + v.delta
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, delta)
    WHERE p.id = v.id
      AND p.stock + v.delta >= 0
    RETURNING p.id, p.stock AS "stockAfter", (p.stock - v.delta) AS "stockBefore"
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

/**
 * Post-CATALOG-SPLIT stock mutation: deltas apply to seller_listings.stockQty,
 * keyed by LISTING id. Every product that has variants takes this path; the
 * legacy function above covers only the ones that do not.
 *
 * Same contract as applyStockDeltas: signed deltas, duplicates summed, MUST run
 * inside the Serializable transaction that validated stock.
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
