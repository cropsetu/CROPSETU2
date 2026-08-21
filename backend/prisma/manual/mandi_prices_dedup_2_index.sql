-- mandi_prices STEP 2 of 2: the natural-key unique index (A2-06 / DSA-03).
--
-- RUN mandi_prices_dedup.sql FIRST and confirm its verification query returns
-- zero rows. A unique index over duplicated data fails — after doing all the work.
--
-- APPLY THIS FILE WITH psql, AS A SINGLE STATEMENT:
--   psql "$DATABASE_URL" -f backend/prisma/manual/mandi_prices_dedup_2_index.sql
--
-- NOT with `prisma db execute`, and NOT by pasting into Railway's Data/Query
-- tab. Both send a file as ONE multi-statement query string, which Postgres runs
-- inside an implicit transaction — and CREATE INDEX CONCURRENTLY cannot run in a
-- transaction block ("CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block", 25001). That is why this is its own file with nothing else in it.
--
-- CONCURRENTLY is worth the extra step here: mandi ingest is REQUEST-driven, not
-- cron-driven — any farmer opening the market screen writes to this table — so a
-- plain CREATE INDEX would block those writes for the duration of the build.
--
-- IF IT FAILS: a failed CONCURRENTLY build leaves an INVALID index behind, and
-- `IF NOT EXISTS` will then happily report success on a retry while the index
-- still enforces nothing. Check before trusting it:
--
--   SELECT indexrelid::regclass AS index, indisvalid
--     FROM pg_index
--    WHERE indexrelid = 'mandi_prices_natural_key_uidx'::regclass;
--
--   -- If indisvalid = false:
--   DROP INDEX CONCURRENTLY mandi_prices_natural_key_uidx;
--   -- then re-run file 1 (writes may have re-introduced duplicates) and this file.
--
-- Deliberately NOT declared as `@@unique` in schema.prisma: Prisma cannot
-- express a COALESCE expression index. `createMany({ skipDuplicates: true })`
-- emits ON CONFLICT DO NOTHING with no target, which any unique index satisfies,
-- so Prisma does not need to know this exists.
--
-- COALESCE on `variety` is load-bearing: in Postgres NULLs are DISTINCT in a
-- unique index, so null-variety rows would duplicate forever — the exact bug
-- being fixed. It must stay in agreement with the in-batch dedup key in
-- backend/src/services/mandiPrice.service.js.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS mandi_prices_natural_key_uidx
  ON mandi_prices (
    commodity,
    (COALESCE(variety, '')),
    market,
    district,
    state,
    "priceDate"
  );
