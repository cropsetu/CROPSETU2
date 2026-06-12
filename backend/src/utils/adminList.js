/**
 * Keyset-paginated list helper for the admin API.
 *
 * The repo's utils/keyset.js does a raw index seek for the HOT, single-equality
 * mobile list paths. Admin lists instead need flexible, multi-column filters
 * (role + kyc + isActive + search + date ranges …) that the single-`filterColumn`
 * raw seek can't express. So this helper uses Prisma's keyset form — the
 * row-value comparison `(createdAt, id) < (cursor.createdAt, cursor.id)` written
 * as the nested OR Prisma understands — ordered by (createdAt DESC, id DESC).
 *
 * That still rides the @@index([..., createdAt]) composites and seeks straight to
 * the page (NO offset scan), keeping deep admin pages flat while admitting
 * arbitrary `where` filters. Bounded limits (boundedLimit) cap the page size so a
 * crafted `?limit=` can never request an unbounded fetch.
 *
 * Cursor tokens are the SAME opaque base64url (createdAt|id) the rest of the app
 * uses, so encode/decode are reused from utils/keyset.js.
 */
import { encodeCursor, decodeCursor } from './keyset.js';

/**
 * Parse a client-supplied page size into a bounded integer.
 * Clamps to [1, max]; falls back to `def` for missing/non-numeric input.
 */
export function boundedLimit(raw, def = 25, max = 100) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

/**
 * Keyset-paginate a Prisma model on (createdAt DESC, id DESC).
 *
 * @param {object} model   a Prisma delegate, e.g. prisma.user
 * @param {object} opts
 * @param {object} [opts.where]    Prisma where (filters/search) — combined with the cursor seek
 * @param {string} [opts.cursor]   opaque cursor from a previous page
 * @param {number} [opts.limit]    page size (already bounded by the caller)
 * @param {object} [opts.include]  Prisma include
 * @param {object} [opts.select]   Prisma select (mutually exclusive with include)
 * @returns {Promise<{ items: any[], hasMore: boolean, nextCursor: string|null }>}
 */
export async function keysetList(model, { where = {}, cursor, limit = 25, include, select } = {}) {
  const c = decodeCursor(cursor);
  // Row-value seek: everything strictly "after" the cursor in (createdAt, id) DESC order.
  const seek = c
    ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }
    : null;
  const finalWhere = seek ? { AND: [where, seek] } : where;

  const query = {
    where: finalWhere,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1, // fetch one extra to detect a further page without a COUNT
  };
  if (include) query.include = include;
  if (select) query.select = select;

  const rows = await model.findMany(query);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
