-- mandi_prices STEP 1 of 2: collapse existing duplicates (A2-06 / DSA-03).
--
-- WHY THIS EXISTS
-- `persistToDB` called `prisma.mandiPrice.upsert({ where: { id: 'dummy-will-not-match' } })`.
-- A Prisma upsert whose `where` matches nothing CREATES the row — it does not
-- throw — so the `.catch()` dedup branch under it had never executed once, and
-- every sync re-inserted the entire fetched state list as brand-new rows into a
-- table with no unique constraint. `expiresAt` was written and never read.
--
-- ORDER MATTERS. This is FILE 1 of 2. The unique index lives in
-- mandi_prices_dedup_2_index.sql and CANNOT be applied before this one: creating
-- a unique index over duplicated data fails, and it fails after doing all the
-- work. Run this, confirm the verification query returns 0 rows, then run file 2.
--
-- APPLY (any one):
--   cd backend && DATABASE_URL=<prod> npx prisma db execute --file prisma/manual/mandi_prices_dedup.sql --schema prisma/schema.prisma
--   psql "$DATABASE_URL" -f backend/prisma/manual/mandi_prices_dedup.sql
--   Railway → Postgres service → Data/Query tab → paste + run
--
-- NATURAL KEY: (commodity, variety, market, district, state, priceDate).
-- `variety` is included deliberately — data.gov.in genuinely reports several
-- varieties of one commodity in the same market on the same day (e.g. Onion
-- "Red" vs "Local"), and collapsing them would destroy real price spread rather
-- than duplicates. It is the only nullable column of the six, so it goes through
-- COALESCE: in Postgres NULLs are DISTINCT in a unique index, which would let
-- NULL-variety rows duplicate forever — exactly the bug being fixed.

BEGIN;

-- ── Step 1: collapse existing duplicates, keeping the freshest per key ───────
-- Batched by ctid ranges is unnecessary here: this runs once, and the DELETE is
-- a single set-based statement rather than a loop. If the table is very large
-- and the lock window matters, run it out of hours — it takes an ACCESS
-- EXCLUSIVE-free ROW EXCLUSIVE lock and readers are unaffected.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        commodity,
        COALESCE(variety, ''),
        market,
        district,
        state,
        "priceDate"
      -- Freshest wins: the most recently fetched row carries the latest revision
      -- of that day's price. `id` breaks ties so the result is deterministic.
      ORDER BY "fetchedAt" DESC, id DESC
    ) AS rn
  FROM mandi_prices
)
DELETE FROM mandi_prices m
USING ranked r
WHERE m.id = r.id
  AND r.rn > 1;

COMMIT;


-- ── Verify before running file 2 ─────────────────────────────────────────────
-- Expect 0 rows. Anything else means this did not fully collapse and the index
-- in file 2 will fail.
--
--   SELECT commodity, COALESCE(variety,'') AS variety, market, district, state,
--          "priceDate", COUNT(*)
--     FROM mandi_prices
--    GROUP BY 1,2,3,4,5,6
--   HAVING COUNT(*) > 1
--    LIMIT 20;
