/**
 * Keyset pagination must not depend on the database session TimeZone.
 *
 * Prisma maps a bare `DateTime` to `timestamp(3) WITHOUT time zone` — true of
 * every createdAt in this schema — but binds a JS Date through
 * $queryRawUnsafe as `timestamptz`. Comparing the two makes Postgres convert
 * the naive column using the SESSION TimeZone. The stored value is a UTC wall
 * clock, so under a non-UTC session it reads as a local time and shifts: at
 * Asia/Kolkata every row looks 5h30m earlier than it is, `< cursor` matches the
 * whole table, and the seek returns page 1 forever.
 *
 * Production is almost certainly UTC, which is why this was never seen. That is
 * exactly what makes it worth a test: the code was correct only by accident of
 * where the server happens to run, and it was already broken on any developer
 * machine that is not UTC. A test that runs only in the ambient timezone would
 * keep passing on CI and keep lying.
 *
 * So these tests SET TimeZone explicitly and walk to exhaustion. The invariant
 * is "every row is reachable exactly once", which is the property a user cares
 * about and which holds regardless of page size, row count or clock.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { keysetPage, encodeCursor, decodeCursor } from '../../../src/utils/keyset.js';
import prisma from '../../../src/config/db.js';

const TABLE = '_keyset_tz_test';
const q = (sql, ...a) => prisma.$queryRawUnsafe(sql, ...a);

// A cursor walk is the whole point: a single page proves nothing, because page
// one is correct even when the seek predicate is broken.
async function walkAll(limit = 20, maxPages = 20) {
  const seen = []; let cursor; let pages = 0; let stuck = false;
  while (pages < maxPages) {
    const r = await keysetPage(prisma, {
      table: TABLE, filterColumn: 'ownerId', filterValue: 'owner1', cursor, limit,
      hydrate: async (ids) => q(`SELECT id, "createdAt" FROM "${TABLE}" WHERE id = ANY($1)`, ids),
    });
    seen.push(...r.items.map((i) => i.id));
    pages += 1;
    if (!r.hasMore) break;
    if (r.nextCursor === cursor) { stuck = true; break; }
    cursor = r.nextCursor;
  }
  return { seen, pages, stuck, unique: new Set(seen).size };
}

beforeAll(async () => {
  await q(`DROP TABLE IF EXISTS "${TABLE}"`);
  await q(`CREATE TABLE "${TABLE}" (id text primary key, "ownerId" text, "createdAt" timestamp(3))`);
  // Written the way Prisma writes: a naive column holding the UTC wall clock.
  await q(`INSERT INTO "${TABLE}"
             SELECT 'r' || lpad(i::text, 3, '0'), 'owner1',
                    (timezone('UTC', now()) - (i || ' minutes')::interval)
             FROM generate_series(1, 50) i`);
  // Rows sharing a createdAt, so the id tiebreak is exercised too.
  await q(`INSERT INTO "${TABLE}" VALUES
             ('tieA', 'owner1', timezone('UTC', now()) - interval '9 minutes'),
             ('tieB', 'owner1', timezone('UTC', now()) - interval '9 minutes')`);
  // A row belonging to someone else: the filter must survive the fix.
  await q(`INSERT INTO "${TABLE}" VALUES ('other', 'owner2', timezone('UTC', now()))`);
});

afterAll(async () => {
  await q(`DROP TABLE IF EXISTS "${TABLE}"`);
  await q(`SET TimeZone = 'UTC'`);
  await prisma.$disconnect().catch(() => {});
});

describe('keysetPage is timezone-independent', () => {
  // UTC is the control: it passed before the fix too, so on its own it proves
  // nothing. It is here to show the others are not passing for some other reason.
  for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Kiritimati']) {
    it(`reaches every row exactly once under TimeZone=${tz}`, async () => {
      await q(`SET TimeZone = '${tz}'`);
      const { seen, unique, stuck, pages } = await walkAll(20);

      expect(stuck).toBe(false);           // the failure signature: cursor never advances
      expect(unique).toBe(52);             // 50 + the two tied rows
      expect(seen.length).toBe(52);        // exactly once — no row served twice
      expect(pages).toBe(3);               // 52 rows at 20/page
      expect(seen).not.toContain('other'); // the ownerId filter still holds
    });
  }

  it('returns rows in strict descending (createdAt, id) order across page boundaries', async () => {
    // A cursor that shifts under timezone conversion can also SKIP rows rather
    // than repeat them, which a count alone would not catch if the count is
    // right by luck. Ordering across the boundary is what catches that.
    await q(`SET TimeZone = 'Asia/Kolkata'`);
    const { seen } = await walkAll(7); // deliberately not a divisor of 52
    const rows = await q(`SELECT id, "createdAt" FROM "${TABLE}" WHERE "ownerId" = 'owner1'
                          ORDER BY "createdAt" DESC, id DESC`);
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it('page size does not change which rows are reachable', async () => {
    await q(`SET TimeZone = 'America/New_York'`);
    const a = await walkAll(5);
    const b = await walkAll(50);
    expect(new Set(a.seen)).toEqual(new Set(b.seen));
    expect(a.unique).toBe(52);
    expect(b.unique).toBe(52);
  });

  it('round-trips a cursor without losing precision', async () => {
    // The cursor carries milliseconds; dropping them would make two rows in the
    // same millisecond collide and silently truncate a page.
    const d = new Date('2026-08-19T01:39:35.237Z');
    const back = decodeCursor(encodeCursor({ createdAt: d, id: 'x' }));
    expect(back.createdAt.toISOString()).toBe('2026-08-19T01:39:35.237Z');
    expect(back.id).toBe('x');
  });
});
