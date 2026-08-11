-- ============================================================================
-- CATALOG SPLIT — PHASE 1 of 3: EXPAND (additive, DROP-FREE)
--
-- Splits `products` (catalog identity FUSED with one seller's offer) into
--   products         → catalog identity, shared by every seller
--   product_variants → the sellable unit (for agri-inputs: PACK SIZE)
--   seller_listings  → one offer per seller per variant
--
-- WHY MANUAL: the Railway deploy runs `prisma db push --skip-generate`, which
-- makes the DB match schema.prisma EXACTLY — so it tries to DROP tables Prisma
-- does not know about (FastAPI's ai_scan_diagnoses, mandi_prices, …). Once those
-- hold data, db push aborts on "data loss" and NONE of the schema applies. That
-- is how `users.adminScopes` went missing in prod and every login 500'd (P2022).
-- NEVER add --accept-data-loss to the deploy. See admin_v2_additive.sql.
--
-- A table split is a DECOMPOSE, not an additive change, so it is staged:
--   1. EXPAND   (this file)  — add tables/columns/indexes. Nothing reads them.
--   2. BACKFILL (catalog_split_2_backfill.sql) — populate + emit a near-miss report.
--   3. CONTRACT (catalog_split_3_contract.sql) — drop the old offer columns,
--      ONLY after the backfill has been verified in prod.
--
-- This file is ADDITIVE ONLY. The single non-additive statement is dropping the
-- `reviews_userId_productId_key` UNIQUE — that constraint is precisely what stops
-- a buyer who bought the same seed from two Kendras from rating both, so it has
-- to go. Dropping an index destroys no rows.
--
-- Generated drop-free via:
--   npx prisma migrate diff --from-schema-datamodel <pre-split> \
--       --to-schema-datamodel prisma/schema.prisma --script
-- then hand-edited for IF NOT EXISTS idempotency and the status-default ordering.
--
-- APPLY (any one):
--   cd backend && DATABASE_URL=<prod> npx prisma db execute \
--       --file prisma/manual/catalog_split_1_expand.sql --schema prisma/schema.prisma
--   psql "$DATABASE_URL" -f backend/prisma/manual/catalog_split_1_expand.sql
--   Railway → Postgres service → Data/Query tab → paste + run
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ── Enums ────────────────────────────────────────────────────────────────────
-- ProductStatus is deliberately NOT ModerationStatus (that vocabulary is shared
-- with ContentFlag's fraud queue, and adding PENDING_QC would change what that
-- queue means) and NOT ListingStatus (that belongs to Animal/Machinery/Labour).
DO $$ BEGIN
  CREATE TYPE "ProductStatus" AS ENUM ('PENDING_QC', 'APPROVED', 'REJECTED', 'MERGED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ListingState" AS ENUM ('ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Shared normalisation function ────────────────────────────────────────────
-- The dedup key must be byte-identical between this SQL and the JS
-- normalizeProductKey() in src/services/catalogMatch.service.js, or the backfill
-- and the runtime duplicate gate will disagree about what a duplicate is.
--
-- Rule: lowercase, replace every punctuation / symbol / whitespace run with a
-- single space, trim. It removes punctuation rather than "keeping only alnum"
-- ON PURPOSE: [[:alnum:]] excludes Unicode combining marks, which would strip the
-- matras out of every Hindi/Marathi name (नामे → नम) and silently collide
-- distinct products. Letters, digits and marks are all preserved.
--
-- JS counterpart:  s.toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]+/gu, ' ').trim()
-- NOTE: sanitizeSearch() is NOT this. It is a LIKE-injection guard — it replaces
-- % _ \ with spaces and neither lowercases nor strips punctuation.
CREATE OR REPLACE FUNCTION catalog_norm(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(lower(coalesce(txt, '')), '[[:punct:][:space:]]+', ' ', 'g'));
$$;

-- Build the composite dedup key. NULL brand / manufacturer collapse to the
-- sentinel '~', which can never equal a real normalised value (catalog_norm
-- strips '~' as punctuation), so "no brand" is its OWN bucket and never
-- wildcard-matches a branded product.
CREATE OR REPLACE FUNCTION catalog_key(
  category_id text, brand text, manufacturer text, name text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(category_id, '~') || '|'
      || coalesce(nullif(catalog_norm(brand), ''), '~') || '|'
      || coalesce(nullif(catalog_norm(manufacturer), ''), '~') || '|'
      || catalog_norm(name);
$$;

-- ── products: catalog identity columns ───────────────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "modelNumber"       TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "createdBySellerId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "mergedIntoId"      TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qcReviewedBy"      TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qcReviewedAt"      TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qcRejectionReason" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "normalizedKey"     TEXT NOT NULL DEFAULT '';

-- CRITICAL ORDERING. The schema default is PENDING_QC, but adding the column with
-- that default would put the ENTIRE existing catalogue into the QC queue the
-- moment anything starts reading `status` — every live product would vanish from
-- the storefront. So: add it defaulted to APPROVED (existing rows are, by
-- definition, already live), THEN switch the default so only NEW rows land in QC.
-- `prisma db push` afterwards sees a matching column + default and leaves data alone.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'status'
  ) THEN
    ALTER TABLE "products" ADD COLUMN "status" "ProductStatus" NOT NULL DEFAULT 'APPROVED';
    ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'PENDING_QC';
  END IF;
END $$;

-- A catalog-only row (admin-created, or created through the new attach flow) has
-- no price of its own. Dropping NOT NULL is non-destructive.
ALTER TABLE "products" ALTER COLUMN "price" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "products_status_categoryId_idx"  ON "products"("status", "categoryId");
CREATE INDEX IF NOT EXISTS "products_status_rating_idx"      ON "products"("status", "rating");
CREATE INDEX IF NOT EXISTS "products_normalizedKey_idx"      ON "products"("normalizedKey");
CREATE INDEX IF NOT EXISTS "products_brand_modelNumber_idx"  ON "products"("brand", "modelNumber");
CREATE INDEX IF NOT EXISTS "products_mergedIntoId_idx"       ON "products"("mergedIntoId");

-- ── product_variants ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_variants" (
    "id"         TEXT NOT NULL,
    "productId"  TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "unit"       TEXT NOT NULL DEFAULT 'kg',
    "gtin"       TEXT,
    "sku"        TEXT,
    "isDefault"  BOOLEAN NOT NULL DEFAULT false,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- Nullable UNIQUE: Postgres allows unlimited NULLs, which is the whole point —
-- most Indian agri-input SKUs have no retail barcode, so GTIN is a dedup
-- BACKSTOP, never the gate. The gate is products.normalizedKey.
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_gtin_key"          ON "product_variants"("gtin");
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_productId_sku_key" ON "product_variants"("productId", "sku");
CREATE INDEX        IF NOT EXISTS "product_variants_productId_idx"     ON "product_variants"("productId");

DO $$ BEGIN
  ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── seller_listings ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "seller_listings" (
    "id"              TEXT NOT NULL,
    "sellerId"        TEXT NOT NULL,
    "variantId"       TEXT NOT NULL,
    "sellingPrice"    DECIMAL(12,2) NOT NULL,
    "mrp"             DECIMAL(12,2),
    "stockQty"        INTEGER NOT NULL DEFAULT 0,
    "condition"       TEXT NOT NULL DEFAULT 'NEW',
    "dispatchSlaDays" INTEGER NOT NULL DEFAULT 2,
    "sellerSku"       TEXT,
    "minOrderQty"     INTEGER NOT NULL DEFAULT 1,
    "sellScope"       TEXT NOT NULL DEFAULT 'district',
    "district"        TEXT,
    "taluka"          TEXT,
    "village"         TEXT,
    "state"           TEXT,
    "harvestDate"     TEXT,
    "images"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status"          "ListingState" NOT NULL DEFAULT 'ACTIVE',
    "isFeatured"      BOOLEAN NOT NULL DEFAULT false,
    "rating"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_listings_pkey" PRIMARY KEY ("id")
);

-- One offer per seller per variant — a Kendra cannot list the same pack twice.
CREATE UNIQUE INDEX IF NOT EXISTS "seller_listings_sellerId_variantId_key"
  ON "seller_listings"("sellerId", "variantId");

-- ── Index plan after the split ───────────────────────────────────────────────
-- The old storefront rode products(isActive, isFeatured) / (isActive, rating) —
-- single-table composites over columns that now live on TWO tables, so that plan
-- is gone. The replacement shape is: filter + sort seller_listings (below), then
-- hydrate products by primary key. The trigram GIN indexes stay catalog-level and
-- can no longer be bitmap-ANDed with price/stock/geo btrees in one scan; that is
-- why catalogMatch materialises trigram candidates FIRST and joins offers after,
-- instead of asking the planner to combine them.
CREATE INDEX IF NOT EXISTS "seller_listings_variantId_status_sellingPrice_idx"
  ON "seller_listings"("variantId", "status", "sellingPrice");
CREATE INDEX IF NOT EXISTS "seller_listings_sellerId_createdAt_idx"
  ON "seller_listings"("sellerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "seller_listings_sellerId_status_idx" ON "seller_listings"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "seller_listings_district_idx"        ON "seller_listings"("district");
CREATE INDEX IF NOT EXISTS "seller_listings_taluka_idx"          ON "seller_listings"("taluka");
CREATE INDEX IF NOT EXISTS "seller_listings_status_isFeatured_idx" ON "seller_listings"("status", "isFeatured");

DO $$ BEGIN
  ALTER TABLE "seller_listings"
    ADD CONSTRAINT "seller_listings_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "seller_listings"
    ADD CONSTRAINT "seller_listings_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── cart_items: re-key to the offer ──────────────────────────────────────────
-- listingId stays NULLABLE here so EXPAND touches no rows; the backfill fills it
-- and CONTRACT makes it the only key.
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "listingId"         TEXT;
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "unitPriceSnapshot" DECIMAL(12,2);

CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_userId_listingId_key" ON "cart_items"("userId", "listingId");
CREATE INDEX        IF NOT EXISTS "cart_items_listingId_idx"        ON "cart_items"("listingId");

-- THE SECOND NON-ADDITIVE STATEMENT, and it belongs in EXPAND rather than
-- CONTRACT. `@@unique([userId, productId])` is exactly what stops a buyer holding
-- the same seed from two Kendras — the thing this whole project exists to allow.
-- Left in place through the dual-write window, adding a second seller's offer of
-- the same product to a cart fails on P2002, so the multi-seller cart would not
-- work until the very last step. Dropping a unique index destroys no rows; the
-- plain index that replaces it still serves the dual-read lookups on productId.
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_userId_productId_key";
DROP INDEX IF EXISTS "cart_items_userId_productId_key";
CREATE INDEX IF NOT EXISTS "cart_items_userId_productId_idx" ON "cart_items"("userId", "productId");

DO $$ BEGIN
  ALTER TABLE "cart_items"
    ADD CONSTRAINT "cart_items_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "seller_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── order_items: purchased-offer identity + state transitions ────────────────
-- listingId MUST land before the backfill. Afterwards, productId alone cannot say
-- which of three Kendras actually sold the item, so purchased-offer history would
-- be permanently unreconstructable.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "listingId"   TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "variantId"   TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "shippedAt"   TIMESTAMP(3);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
-- order_items had NO createdAt at all. The backfill copies orders.createdAt into
-- it; without that every historical row would be stamped at migration time and
-- sellerMetrics' rolling window would see the entire order book as "today".
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "order_items_listingId_idx" ON "order_items"("listingId");
CREATE INDEX IF NOT EXISTS "order_items_sellerId_status_createdAt_idx"
  ON "order_items"("sellerId", "status", "createdAt");

-- NOTE: no FK from order_items.listingId → seller_listings. Deleting an offer must
-- never cascade into order history, and money-rail models in this schema already
-- use bare String references for the same reason (see SellerLedgerEntry/Payout).

-- ── reviews: attributable + verifiable ───────────────────────────────────────
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "sellerId"    TEXT;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "orderItemId" TEXT;

-- THE ONE NON-ADDITIVE STATEMENT. `@@unique([userId, productId])` meant a buyer
-- who bought the same seed from two Kendras could only ever rate one of them, so
-- seller rating (buy-box weight w2) could never have a complete source. Replaced
-- by (userId, orderItemId): NULLs are distinct in a Postgres unique index, so
-- every pre-existing review (orderItemId NULL) survives the swap untouched.
ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_userId_productId_key";
DROP INDEX IF EXISTS "reviews_userId_productId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "reviews_userId_orderItemId_key" ON "reviews"("userId", "orderItemId");
CREATE INDEX        IF NOT EXISTS "reviews_userId_idx"             ON "reviews"("userId");
CREATE INDEX        IF NOT EXISTS "reviews_sellerId_idx"           ON "reviews"("sellerId");

-- ── return_requests: seller attribution ──────────────────────────────────────
ALTER TABLE "return_requests" ADD COLUMN IF NOT EXISTS "sellerId" TEXT;
CREATE INDEX IF NOT EXISTS "return_requests_sellerId_idx" ON "return_requests"("sellerId");

-- ── seller_profiles: derived fulfillment metrics ─────────────────────────────
-- Refreshed by sellerMetrics.service.js on a schedule, never per request.
-- metricsUpdatedAt NULL == "no history yet"; the buy box reads that as a signal to
-- substitute a neutral rating and zero the fulfillment weight, so a brand-new
-- marketplace degrades to lowest-price rather than to noise.
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "rating"             DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "ratingCount"        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "cancellationRate"   DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "onTimeDispatchRate" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "returnRate"         DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "metricsUpdatedAt"   TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "seller_profiles_rating_idx"           ON "seller_profiles"("rating");
CREATE INDEX IF NOT EXISTS "seller_profiles_metricsUpdatedAt_idx" ON "seller_profiles"("metricsUpdatedAt");

-- ── Pre-existing defects on the paths this project rewrites ──────────────────
-- Fixed here because the split's checkout/catalog code sits directly on them.

-- Order idempotency. razorpayPaymentId was stored only inside the free-text
-- `notes` column ("razorpay:<id>") with no constraint, so replaying the same
-- signed (orderId, paymentId, signature) triple after re-filling the cart created
-- a SECOND fully-paid order. Backfilled from notes so historical payments are
-- protected too. Partial index: only rows that actually carry a ref.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paymentRef" TEXT;

UPDATE "orders"
SET "paymentRef" = substring("notes" FROM '^razorpay:(.+)$')
WHERE "paymentRef" IS NULL
  AND "notes" LIKE 'razorpay:%'
  -- Skip any id that already appears twice: a duplicate predates this fix and
  -- would abort the index build. Those are reported below, not silently merged.
  AND substring("notes" FROM '^razorpay:(.+)$') IN (
    SELECT substring("notes" FROM '^razorpay:(.+)$')
    FROM "orders" WHERE "notes" LIKE 'razorpay:%'
    GROUP BY 1 HAVING count(*) = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS "orders_paymentRef_key" ON "orders"("paymentRef");

-- Double-payout guard. `payouts` had no unique at all, so nothing prevented two
-- payouts for the same seller and settlement window.
DO $$
DECLARE dupes bigint;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM "payouts" GROUP BY "sellerId", "periodFrom", "periodTo" HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE WARNING 'payouts: % duplicate (seller, period) groups already exist — unique index NOT created. Resolve them, then run: CREATE UNIQUE INDEX "payouts_sellerId_periodFrom_periodTo_key" ON "payouts"("sellerId","periodFrom","periodTo");', dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "payouts_sellerId_periodFrom_periodTo_key"
      ON "payouts"("sellerId", "periodFrom", "periodTo");
  END IF;
END $$;

-- The storefront search WHERE is an OR over name / description / tags. Per the
-- trigram migration's own warning, ONE unindexed OR branch forces a full scan of
-- the entire clause — so the two GIN indexes above were being cancelled out by
-- the `tags` branch. tags is TEXT[], so it needs an array GIN.
CREATE INDEX IF NOT EXISTS "products_tags_gin" ON "products" USING GIN ("tags");

-- ── Report tables consumed by phase 2 ────────────────────────────────────────
-- Deliberately real tables, not TEMP: the near-miss report has to outlive the
-- backfill session so an admin can work through it afterwards.
CREATE TABLE IF NOT EXISTS "catalog_split_map" (
    "productId"          TEXT NOT NULL,
    "groupKey"           TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "effectiveProductId" TEXT NOT NULL,
    "variantKey"         TEXT NOT NULL,
    "variantId"          TEXT NOT NULL,
    "listingId"          TEXT,
    "decision"           TEXT NOT NULL,
    "reason"             TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_split_map_pkey" PRIMARY KEY ("productId")
);
CREATE INDEX IF NOT EXISTS "catalog_split_map_canonical_idx" ON "catalog_split_map"("canonicalProductId");
CREATE INDEX IF NOT EXISTS "catalog_split_map_decision_idx"  ON "catalog_split_map"("decision");

CREATE TABLE IF NOT EXISTS "catalog_split_near_miss" (
    "id"          TEXT NOT NULL,
    "kind"        TEXT NOT NULL,
    "leftId"      TEXT NOT NULL,
    "rightId"     TEXT,
    "similarity"  DOUBLE PRECISION,
    "leftLabel"   TEXT,
    "rightLabel"  TEXT,
    "note"        TEXT,
    "resolvedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_split_near_miss_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "catalog_split_near_miss_kind_idx"     ON "catalog_split_near_miss"("kind");
CREATE INDEX IF NOT EXISTS "catalog_split_near_miss_resolved_idx" ON "catalog_split_near_miss"("resolvedAt");

COMMIT;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: 3 rows, all counts 0 (tables exist and are empty before the backfill).
--   SELECT 'variants' t, count(*) FROM product_variants
--   UNION ALL SELECT 'listings', count(*) FROM seller_listings
--   UNION ALL SELECT 'map',      count(*) FROM catalog_split_map;
-- Expect: every pre-existing product still APPROVED (NOT swept into the QC queue).
--   SELECT status, count(*) FROM products GROUP BY status;
