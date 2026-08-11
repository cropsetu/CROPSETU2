-- ============================================================================
-- CATALOG SPLIT — PHASE 3 of 3: CONTRACT
--
-- ***** THIS FILE DESTROYS DATA. IT IS THE ONLY ONE THAT DOES. *****
--
-- DO NOT RUN IT UNTIL ALL OF THESE ARE TRUE IN PRODUCTION:
--   [ ] catalog_split_1_expand.sql applied
--   [ ] catalog_split_2_backfill.sql applied AND every VERIFY query at the bottom
--       of that file returned the expected result (especially (2) NO FALSE MERGES)
--   [ ] catalog_split_near_miss has been worked through by an admin
--   [ ] the app has been running on the new tables long enough that you trust
--       them — dual-read is live, /agristore/products/:id serves the buy box, the
--       seller app writes seller_listings, checkout re-keys on listingId
--   [ ] you have a snapshot you can restore from
--
-- After this runs, `products` no longer knows a price, a stock level, a seller or
-- a geography. Anything still reading those columns breaks immediately.
--
-- ALSO REQUIRED: delete the matching fields from schema.prisma in the SAME deploy,
-- or the next `prisma db push` will re-add them as empty columns. The exact edit:
--   • model Product      — remove sellerId, price, mrp, unit, stock, minOrderQty,
--                          sellScope, district, state, taluka, village,
--                          harvestDate, isActive, isFeatured, the `seller`
--                          relation, and the @@index lines that reference them
--                          ([sellerId], [district], [taluka], [isActive,*],
--                          [sellerId, createdAt]); drop `sellerProducts` from
--                          model User
--   • model CartItem     — remove productId, the `product` relation and the
--                          @@index([userId, productId]); make listingId
--                          non-nullable (`listingId String`) and its relation
--                          non-optional. (@@unique([userId, productId]) was
--                          already dropped in EXPAND.)
--   • model Product      — normalizedKey: drop `@default("")` (real values exist now)
--
-- APPLY:
--   cd backend && DATABASE_URL=<prod> npx prisma db execute \
--       --file prisma/manual/catalog_split_3_contract.sql --schema prisma/schema.prisma
-- ============================================================================

BEGIN;

-- ── Guard: refuse to contract on an unfinished backfill ──────────────────────
-- Cheaper than restoring a snapshot.
DO $$
DECLARE
  unmapped   bigint;
  orphaned   bigint;
BEGIN
  SELECT count(*) INTO unmapped
  FROM "products" p LEFT JOIN "catalog_split_map" m ON m."productId" = p."id"
  WHERE m."productId" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'ABORT: % products are not in catalog_split_map. Re-run catalog_split_2_backfill.sql first.', unmapped;
  END IF;

  SELECT count(*) INTO orphaned
  FROM "cart_items" c JOIN "products" p ON p."id" = c."productId"
  WHERE c."listingId" IS NULL AND p."sellerId" IS NOT NULL;
  IF orphaned > 0 THEN
    RAISE EXCEPTION 'ABORT: % cart rows have a sellable product but no listingId. Re-run the backfill.', orphaned;
  END IF;
END $$;

-- ── Cart rows that can never be pointed at an offer ──────────────────────────
-- These reference admin/catalog-only products (no seller, therefore no offer).
-- They were reported as CART_ORPHAN by the backfill. Post-contract there is no
-- price to charge for them, so they cannot survive.
DELETE FROM "cart_items" WHERE "listingId" IS NULL;

ALTER TABLE "cart_items" ALTER COLUMN "listingId" SET NOT NULL;

-- The unique on (userId, productId) is already gone — EXPAND dropped it, because
-- the multi-seller cart does not function while it exists. Only the column and
-- its dual-read index go here.
DROP INDEX IF EXISTS "cart_items_userId_productId_idx";
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_productId_fkey";
ALTER TABLE "cart_items" DROP COLUMN IF EXISTS "productId";

-- ── products: drop the offer half ────────────────────────────────────────────
DROP INDEX IF EXISTS "products_sellerId_idx";
DROP INDEX IF EXISTS "products_sellerId_createdAt_idx";
DROP INDEX IF EXISTS "products_district_idx";
DROP INDEX IF EXISTS "products_taluka_idx";
DROP INDEX IF EXISTS "products_isActive_isFeatured_idx";
DROP INDEX IF EXISTS "products_isActive_rating_idx";

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_sellerId_fkey";

ALTER TABLE "products" DROP COLUMN IF EXISTS "sellerId";
ALTER TABLE "products" DROP COLUMN IF EXISTS "price";
ALTER TABLE "products" DROP COLUMN IF EXISTS "mrp";
ALTER TABLE "products" DROP COLUMN IF EXISTS "unit";
ALTER TABLE "products" DROP COLUMN IF EXISTS "stock";
ALTER TABLE "products" DROP COLUMN IF EXISTS "minOrderQty";
ALTER TABLE "products" DROP COLUMN IF EXISTS "sellScope";
ALTER TABLE "products" DROP COLUMN IF EXISTS "district";
ALTER TABLE "products" DROP COLUMN IF EXISTS "state";
ALTER TABLE "products" DROP COLUMN IF EXISTS "taluka";
ALTER TABLE "products" DROP COLUMN IF EXISTS "village";
ALTER TABLE "products" DROP COLUMN IF EXISTS "harvestDate";
ALTER TABLE "products" DROP COLUMN IF EXISTS "isActive";
ALTER TABLE "products" DROP COLUMN IF EXISTS "isFeatured";

ALTER TABLE "products" ALTER COLUMN "normalizedKey" DROP DEFAULT;

COMMIT;

-- ── Post-contract sanity ─────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'products' ORDER BY 1;   -- no price/stock/sellerId
--   SELECT count(*) FROM cart_items WHERE "listingId" IS NULL;  -- 0
--
-- catalog_split_map and catalog_split_near_miss are intentionally KEPT. They are
-- the only record of which rows were merged into which, and the merge tool's
-- redirect (products.mergedIntoId) is the only other one.
