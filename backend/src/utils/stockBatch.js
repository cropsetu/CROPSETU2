import { Prisma } from '@prisma/client';

/**
 * Apply per-product stock deltas in a SINGLE SQL statement.
 *
 * The naive checkout/cancel path looped `tx.product.update({ decrement })` once
 * per cart item — O(n) DB round-trips, so write latency (and the time the
 * Serializable transaction holds its locks) scaled with cart size. This folds
 * every delta into one `UPDATE ... FROM (VALUES ...)`, giving a constant number
 * of statements per checkout regardless of cart size.
 *
 * `delta` is signed: negative decrements (checkout), positive increments
 * (cancellation/restock). Duplicate productIds are summed so a single product
 * never gets a partial update (an UPDATE with multiple matching VALUES rows
 * would otherwise apply only one of them).
 *
 * MUST be called inside the same transaction (`tx`) that validated stock, so
 * the read-validate-write stays atomic under Serializable isolation.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Array<{ productId: string, delta: number }>} deltas
 * @returns {Promise<number>} rows affected
 */
export async function applyStockDeltas(tx, deltas) {
  if (!deltas || !deltas.length) return 0;

  // Collapse duplicates so each product appears at most once in the VALUES list.
  const byId = new Map();
  for (const { productId, delta } of deltas) {
    byId.set(productId, (byId.get(productId) || 0) + delta);
  }

  const rows = [...byId.entries()].map(
    ([productId, delta]) => Prisma.sql`(${productId}::text, ${delta}::int)`,
  );

  return tx.$executeRaw`
    UPDATE products AS p
    SET stock = p.stock + v.delta
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, delta)
    WHERE p.id = v.id
  `;
}
