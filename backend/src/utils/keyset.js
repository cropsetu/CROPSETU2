/**
 * Keyset (cursor) pagination for createdAt-DESC lists.
 *
 * Offset pagination (`skip: (page-1)*limit`) makes the DB walk and discard every
 * row before the requested page, so deep pages get progressively slower. Keyset
 * pagination seeks straight to the row after the client's cursor, so page N
 * costs the same as page 1.
 *
 * IMPORTANT — why this uses raw SQL: the only form Postgres can satisfy with an
 * index *seek* (rather than scan-and-filter) is the row-value comparison
 * `(createdAt, id) < (cursorCreatedAt, cursorId)`. Neither Prisma's `where`
 * builder nor its native `cursor` API emits that — both expand a compound cursor
 * into an `OR (createdAt < x OR (createdAt = x AND id < y))`, which the planner
 * applies as a Filter (verified via EXPLAIN: 50k "Rows Removed by Filter",
 * ~20ms at depth, degrading with depth). The row-value form gives `Index Cond:
 * createdAt <= x` and stays flat (~0.1ms at any depth).
 *
 * So we run a tiny raw seek to get the ordered page of ids (flat, index-only),
 * then hydrate full rows via Prisma (`where id IN …`, a constant-cost PK lookup)
 * so callers keep their `include`/`select`. The seek rides the
 * @@index([<filterColumn>, createdAt(sort: Desc)]) composites from DB-12.
 *
 * The cursor is an opaque base64url token of the last row's (createdAt, id); the
 * id tiebreaks rows that share a createdAt so paging never skips/dupes a row.
 */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/; // guard interpolated identifiers (never user input)

export function encodeCursor(row) {
  if (!row?.createdAt || !row?.id) return null;
  const ts = row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString();
  return Buffer.from(`${ts}|${row.id}`).toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(ts);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Keyset-paginate a createdAt-DESC list.
 *
 * @param prisma                 the Prisma client (for $queryRawUnsafe)
 * @param table                  physical table name (e.g. 'orders') — hardcoded, not user input
 * @param filterColumn           equality filter column (e.g. 'userId')   — hardcoded, not user input
 * @param filterValue            the value to filter by (parameterised)
 * @param cursor                 opaque cursor from a previous page (or undefined)
 * @param limit                  page size
 * @param hydrate                async (ids[]) => rows[] — fetch full rows by id (with include/select)
 * @returns { items, hasMore, nextCursor }
 */
export async function keysetPage(prisma, { table, filterColumn, filterValue, cursor, limit, hydrate }) {
  if (!IDENT.test(table) || !IDENT.test(filterColumn)) {
    throw new Error(`keysetPage: unsafe identifier (${table}.${filterColumn})`);
  }
  const c = decodeCursor(cursor);
  const params = [filterValue];
  let seek = '';
  if (c) {
    // Row-value comparison → index seek (flat). $2 = createdAt, $3 = id.
    seek = `AND ("createdAt", "id") < ($2, $3)`;
    params.push(c.createdAt, c.id);
  }
  // Fetch limit+1 ids to detect a further page without a COUNT.
  const seekRows = await prisma.$queryRawUnsafe(
    `SELECT "id", "createdAt" FROM "${table}" WHERE "${filterColumn}" = $1 ${seek} ` +
    `ORDER BY "createdAt" DESC, "id" DESC LIMIT ${Number(limit) + 1}`,
    ...params,
  );

  const hasMore = seekRows.length > limit;
  const pageRows = hasMore ? seekRows.slice(0, limit) : seekRows;
  if (!pageRows.length) return { items: [], hasMore: false, nextCursor: null };

  // Hydrate full rows (with relations) by primary key, then restore seek order.
  const ids = pageRows.map((r) => r.id);
  const hydrated = await hydrate(ids);
  const byId = new Map(hydrated.map((it) => [it.id, it]));
  const items = ids.map((id) => byId.get(id)).filter(Boolean);

  const last = pageRows[pageRows.length - 1];
  return { items, hasMore, nextCursor: hasMore ? encodeCursor(last) : null };
}
