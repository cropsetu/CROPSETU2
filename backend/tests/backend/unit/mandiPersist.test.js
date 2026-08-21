/**
 * mandi_prices write path (A2-06 / DSA-03).
 *
 * The old `persistToDB` upserted with `where: { id: 'dummy-will-not-match' }`.
 * A Prisma upsert whose `where` matches nothing CREATES the row — so the
 * `.catch()` holding the only real dedup logic had never executed once, and
 * every sync re-inserted the whole fetched list as new rows into a table with no
 * unique constraint, one awaited round trip at a time.
 *
 * Two halves fix it, and only one of them is testable here:
 *   - cross-batch: the unique index in prisma/manual/mandi_prices_dedup.sql,
 *     which turns `skipDuplicates` into a real ON CONFLICT DO NOTHING;
 *   - within-batch: the dedup below. Not because repeats would ERROR — ON
 *     CONFLICT DO NOTHING tolerates them; only DO UPDATE raises "cannot affect
 *     row a second time" — but because something must CHOOSE which copy wins,
 *     and leaving that to Postgres makes the stored price depend on feed
 *     ordering. data.gov.in does return the same mandi twice in one response.
 */
import { jest } from '@jest/globals';

const createMany = jest.fn();
// $executeRaw is a tagged template, so it receives (strings, ...values). It MUST
// be in the mock: without it the update path throws into persistToDB's catch and
// every assertion below still passes while the revision half silently never runs.
const executeRaw = jest.fn();
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { mandiPrice: { createMany }, $executeRaw: executeRaw },
}));

const { persistToDB } = await import('../../../src/services/mandiPrice.service.js');

const DAY = new Date('2026-06-01T00:00:00.000Z');

function row(over = {}) {
  return {
    commodity: 'Onion',
    variety:   'Red',
    market:    'Pune',
    district:  'Pune',
    state:     'Maharashtra',
    priceDate: DAY,
    modalPrice: 2000,
    fetchedAt: new Date('2026-06-01T06:00:00.000Z'),
    ...over,
  };
}

/** Every row handed to createMany across all chunks. */
function written() {
  return createMany.mock.calls.flatMap(([arg]) => arg.data);
}

beforeEach(() => {
  createMany.mockReset();
  createMany.mockResolvedValue({ count: 0 });
  executeRaw.mockReset();
  executeRaw.mockResolvedValue(0);
});

describe('within-batch dedup', () => {
  test('identical rows collapse to one', async () => {
    await persistToDB([row(), row(), row()]);
    expect(written()).toHaveLength(1);
  });

  test('the freshest duplicate wins, matching the migration tie-break', async () => {
    await persistToDB([
      row({ modalPrice: 1000, fetchedAt: new Date('2026-06-01T05:00:00.000Z') }),
      row({ modalPrice: 2500, fetchedAt: new Date('2026-06-01T09:00:00.000Z') }),
      row({ modalPrice: 1500, fetchedAt: new Date('2026-06-01T07:00:00.000Z') }),
    ]);
    const rows = written();
    expect(rows).toHaveLength(1);
    expect(rows[0].modalPrice).toBe(2500);
  });

  test('a different variety is a DIFFERENT price, not a duplicate', async () => {
    // Deliberate: data.gov.in reports several varieties of one commodity in the
    // same market on the same day. Collapsing them would destroy real price
    // spread rather than duplicates.
    await persistToDB([row({ variety: 'Red' }), row({ variety: 'Local' })]);
    expect(written()).toHaveLength(2);
  });

  test('null and empty variety are the SAME key', async () => {
    // In Postgres NULLs are distinct in a unique index, which would let
    // null-variety rows duplicate forever — the migration uses COALESCE and this
    // must agree with it, or the two halves disagree at the boundary.
    await persistToDB([row({ variety: null }), row({ variety: '' })]);
    expect(written()).toHaveLength(1);
  });

  test.each([
    ['market',    { market: 'Nashik' }],
    ['district',  { district: 'Nashik' }],
    ['state',     { state: 'Gujarat' }],
    ['commodity', { commodity: 'Tomato' }],
    ['priceDate', { priceDate: new Date('2026-06-02T00:00:00.000Z') }],
  ])('a different %s is a distinct row', async (_label, diff) => {
    await persistToDB([row(), row(diff)]);
    expect(written()).toHaveLength(2);
  });
});

describe('batching and safety', () => {
  test('always uses skipDuplicates', async () => {
    await persistToDB([row()]);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  test('a large sync is chunked, not one giant statement and not one per row', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => row({ market: `M${i}` }));
    await persistToDB(many);

    expect(written()).toHaveLength(1200);
    // The old code issued 1200 sequential round trips, each holding a pool
    // connection, after the response had already been sent.
    expect(createMany.mock.calls.length).toBe(3);
    for (const [arg] of createMany.mock.calls) {
      expect(arg.data.length).toBeLessThanOrEqual(500);
    }
  });

  test('an empty or non-array input touches the database not at all', async () => {
    await persistToDB([]);
    await persistToDB(null);
    await persistToDB(undefined);
    expect(createMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  test('revised prices are applied, not just skipped as duplicates', async () => {
    // skipDuplicates alone would make the first fetch of a day permanent: the
    // feed revises modal/min/max as more arrivals are reported, so without the
    // update the 06:00 numbers would still be on screen at 18:00. The old
    // duplicate-inserting code got this right by accident.
    await persistToDB([row()]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  test('the update runs once per chunk, alongside each insert', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => row({ market: `M${i}` }));
    await persistToDB(many);
    expect(createMany).toHaveBeenCalledTimes(3);
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  test('a failing chunk does not abort the remaining chunks', async () => {
    createMany
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValue({ count: 0 });

    const many = Array.from({ length: 900 }, (_, i) => row({ market: `M${i}` }));
    await expect(persistToDB(many)).resolves.toBeUndefined();
    expect(createMany).toHaveBeenCalledTimes(2);
  });
});
