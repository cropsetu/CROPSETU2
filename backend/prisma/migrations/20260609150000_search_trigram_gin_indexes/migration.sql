-- Trigram (pg_trgm) GIN indexes for substring search.
--
-- The search endpoints filter free text with `col ILIKE '%term%'` (Prisma
-- `contains` + `mode: 'insensitive'`). The leading wildcard makes a btree index
-- unusable, so these degrade to a sequential scan as tables grow. A GIN index
-- with gin_trgm_ops accelerates ILIKE/LIKE/~* with no query rewrite, preserving
-- the existing substring-match semantics.
--
-- NOTE: every column OR'd together in a search is indexed — Postgres can only
-- index an `a ILIKE x OR b ILIKE x` query when BOTH branches have an index
-- (BitmapOr); a single missing index forces a full scan of the whole OR.
--
-- PROD: building a GIN index takes a table lock that blocks writes for the
-- duration. On large tables, build these with CREATE INDEX CONCURRENTLY during
-- low traffic (cannot run inside a transaction) instead of applying this file
-- directly. pg_trgm must be installable by the DB role (it is on most managed
-- Postgres, incl. Railway).

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Products (catalogue search: name, description)
CREATE INDEX "products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "products_description_trgm" ON "products" USING GIN ("description" gin_trgm_ops);

-- Animal listings (animal, breed, sellerLocation)
CREATE INDEX "animal_listings_animal_trgm" ON "animal_listings" USING GIN ("animal" gin_trgm_ops);
CREATE INDEX "animal_listings_breed_trgm" ON "animal_listings" USING GIN ("breed" gin_trgm_ops);
CREATE INDEX "animal_listings_sellerLocation_trgm" ON "animal_listings" USING GIN ("sellerLocation" gin_trgm_ops);

-- Machinery listings (name, brand, description, location)
CREATE INDEX "machinery_listings_name_trgm" ON "machinery_listings" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "machinery_listings_brand_trgm" ON "machinery_listings" USING GIN ("brand" gin_trgm_ops);
CREATE INDEX "machinery_listings_description_trgm" ON "machinery_listings" USING GIN ("description" gin_trgm_ops);
CREATE INDEX "machinery_listings_location_trgm" ON "machinery_listings" USING GIN ("location" gin_trgm_ops);

-- Labour listings (name, leader, description, location)
CREATE INDEX "labour_listings_name_trgm" ON "labour_listings" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "labour_listings_leader_trgm" ON "labour_listings" USING GIN ("leader" gin_trgm_ops);
CREATE INDEX "labour_listings_description_trgm" ON "labour_listings" USING GIN ("description" gin_trgm_ops);
CREATE INDEX "labour_listings_location_trgm" ON "labour_listings" USING GIN ("location" gin_trgm_ops);

-- Community posts (title, description)
CREATE INDEX "posts_title_trgm" ON "posts" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "posts_description_trgm" ON "posts" USING GIN ("description" gin_trgm_ops);

-- Group discovery (name)
CREATE INDEX "groups_name_trgm" ON "groups" USING GIN ("name" gin_trgm_ops);
