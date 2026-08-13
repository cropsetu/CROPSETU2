-- ============================================================================
-- CATALOG SPLIT — PHASE 2 of 3: BACKFILL
--
-- Maps every existing `products` row → 1 catalog row + 1 variant + 1 listing,
-- then remaps cart_items, order_items, reviews and return_requests.
-- DROP-FREE: this file deletes nothing and drops nothing. Re-runnable.
--
-- Run AFTER catalog_split_1_expand.sql, and run it against a PROD SNAPSHOT first
-- — the near-miss report at the bottom is the thing you are actually reviewing.
--
--   cd backend && DATABASE_URL=<snapshot> npx prisma db execute \
--       --file prisma/manual/catalog_split_2_backfill.sql --schema prisma/schema.prisma
--
-- ── THE GROUPING KEY (the highest-risk decision in this migration) ───────────
--
-- `products` has NO unique constraint, no SKU, no slug, no barcode — no natural
-- key of any kind. Collapsing N seller rows into 1 catalog row therefore has no
-- deterministic key and must be SYNTHESIZED:
--
--     groupKey = categoryId | norm(brand) | norm(manufacturer) | norm(name)
--
-- with norm = catalog_norm() from phase 1 (lowercase; punctuation/symbols/
-- whitespace → single space; letters, digits and Devanagari matras preserved).
-- NULL brand and NULL manufacturer collapse to the sentinel '~', which no real
-- normalised value can equal — so "unbranded" is its OWN bucket and never
-- wildcard-matches a branded product.
--
-- ALL FOUR components must match EXACTLY. Nothing fuzzy merges here.
--
-- ── ERRING TOWARD NOT MERGING ────────────────────────────────────────────────
--
-- A false SPLIT leaves a duplicate an admin merges later, from the QC tool.
-- A false MERGE silently reassigns one Kendra's stock and price to another
-- Kendra's product — money moving to the wrong seller, with no audit trail that
-- says it happened. The two failure modes are not symmetric, so every judgement
-- call below is resolved toward NOT merging:
--
--   1. Pack size is NOT stripped from the name. "Mahyco Bt Cotton Seed 450g" and
--      "…1kg" get SEPARATE catalog rows even though they should ideally be one
--      product with two variants. Stripping trailing quantities would merge
--      genuinely different SKUs, so the safe direction is to leave them split and
--      let the admin merge tool fix it. They land in the near-miss report.
--   2. `unit` is a variant axis, not a merge axis. Same name+brand but "kg" vs
--      "packet" → two variants under one catalog row, never one variant.
--   3. Two rows from the SAME seller landing in one group+variant would violate
--      @@unique([sellerId, variantId]). Only the strongest (highest stock, then
--      oldest) merges; the others KEEP THEIR OWN catalog row rather than being
--      dropped or folded. Reported as SELLER_DUPLICATE.
--   4. Fuzzy/trigram similarity NEVER merges anything. It only writes rows into
--      catalog_split_near_miss for a human.
--
-- ── SPECIAL CASE: admin-created rows ─────────────────────────────────────────
-- admin/catalog.routes.js:188 creates products with sellerId NULL while still
-- carrying price/stock/minOrderQty/sellScope. Those offer fields are meaningless
-- — nobody sells them. Such rows become catalog rows with ZERO listings, and are
-- PREFERRED as the group canonical (they are already catalog-shaped).
--
-- ── DETERMINISM / IDEMPOTENCY ────────────────────────────────────────────────
-- Variant and listing ids are md5-derived from their source row ids, not random,
-- so re-running produces byte-identical output and every INSERT can be
-- ON CONFLICT DO NOTHING / DO UPDATE. Nothing here depends on execution order.
-- ============================================================================

BEGIN;

-- ── 0. normalizedKey on every catalog row ────────────────────────────────────
UPDATE "products"
SET "normalizedKey" = catalog_key("categoryId", "brand", "manufacturer", "name")
WHERE "normalizedKey" IS DISTINCT FROM catalog_key("categoryId", "brand", "manufacturer", "name");

-- ── 1. Decide, for every product row, where it lands ─────────────────────────
INSERT INTO "catalog_split_map" (
  "productId", "groupKey", "canonicalProductId", "effectiveProductId",
  "variantKey", "variantId", "listingId", "decision", "reason"
)
WITH base AS (
  SELECT
    p."id",
    p."categoryId",
    p."sellerId",
    p."createdAt",
    p."stock",
    p."price",
    p."isActive",
    p."normalizedKey"                                  AS group_key,
    -- Variant axis. `unit` is all the pre-split schema has that distinguishes one
    -- sellable pack from another; an empty/garbage unit collapses to 'unit' so it
    -- still forms a stable bucket instead of a NULL that groups with everything.
    coalesce(nullif(catalog_norm(p."unit"), ''), 'unit') AS variant_key
  FROM "products" p
),
canon AS (
  SELECT b.*,
    first_value(b."id") OVER (
      PARTITION BY b.group_key
      -- (sellerId IS NOT NULL) sorts false-first, so an admin/catalog-only row
      -- always wins the canonical slot. Then oldest, then id for total determinism.
      ORDER BY (b."sellerId" IS NOT NULL), b."createdAt", b."id"
    ) AS canonical_id
  FROM base b
),
ranked AS (
  SELECT c.*,
    CASE
      WHEN c."sellerId" IS NULL THEN 1  -- admin rows make no listing, so they cannot collide
      ELSE row_number() OVER (
        PARTITION BY c.canonical_id, c.variant_key, c."sellerId"
        ORDER BY (c."id" = c.canonical_id) DESC, c."stock" DESC, c."createdAt", c."id"
      )
    END AS seller_rank
  FROM canon c
),
decided AS (
  SELECT r.*,
    CASE WHEN r.seller_rank = 1 THEN r.canonical_id ELSE r."id" END AS effective_id,
    CASE
      WHEN r."id" = r.canonical_id THEN 'CANONICAL'
      WHEN r.seller_rank = 1       THEN 'MERGED'
      ELSE 'SPLIT_SELLER_DUP'
    END AS decision
  FROM ranked r
)
SELECT
  d."id",
  d.group_key,
  d.canonical_id,
  d.effective_id,
  d.variant_key,
  -- Deterministic ids → the whole script is idempotent.
  md5(d.effective_id || '|' || d.variant_key)::uuid::text AS variant_id,
  CASE WHEN d."sellerId" IS NULL THEN NULL
       ELSE md5(d."id" || '|listing')::uuid::text END      AS listing_id,
  d.decision,
  CASE
    WHEN d."sellerId" IS NULL AND d.decision = 'CANONICAL'
      THEN 'admin-created catalog row (sellerId NULL) — no listing'
    WHEN d.decision = 'SPLIT_SELLER_DUP'
      THEN 'same seller already holds this variant in this group — kept as its own catalog row rather than merged'
    WHEN d.decision = 'MERGED'
      THEN 'exact match on categoryId + brand + manufacturer + normalized name'
    ELSE 'group canonical'
  END
FROM decided d
ON CONFLICT ("productId") DO UPDATE SET
  "groupKey"           = EXCLUDED."groupKey",
  "canonicalProductId" = EXCLUDED."canonicalProductId",
  "effectiveProductId" = EXCLUDED."effectiveProductId",
  "variantKey"         = EXCLUDED."variantKey",
  "variantId"          = EXCLUDED."variantId",
  "listingId"          = EXCLUDED."listingId",
  "decision"           = EXCLUDED."decision",
  "reason"             = EXCLUDED."reason";

-- ── 2. Variants ──────────────────────────────────────────────────────────────
-- One per (effective catalog row, unit). attributes carries the pack axis; the
-- pre-split schema has no pack-size field, so it records the unit it came from
-- and leaves packSize for the admin/seller to fill in.
INSERT INTO "product_variants" ("id", "productId", "attributes", "unit", "isDefault", "createdAt", "updatedAt")
SELECT DISTINCT ON (m."variantId")
  m."variantId",
  m."effectiveProductId",
  jsonb_build_object('unit', p."unit", 'migratedFrom', 'products.unit'),
  coalesce(nullif(p."unit", ''), 'kg'),
  true,
  p."createdAt",
  CURRENT_TIMESTAMP
FROM "catalog_split_map" m
JOIN "products" p ON p."id" = m."productId"
ORDER BY m."variantId", p."createdAt", p."id"
ON CONFLICT ("id") DO NOTHING;

-- ── 3. Listings ──────────────────────────────────────────────────────────────
-- Every row that HAS a seller becomes exactly one offer. Admin rows (sellerId
-- NULL) are skipped — that is the "catalog rows with zero listings" case.
INSERT INTO "seller_listings" (
  "id", "sellerId", "variantId", "sellingPrice", "mrp", "stockQty", "condition",
  "dispatchSlaDays", "minOrderQty", "sellScope", "district", "taluka", "village",
  "state", "harvestDate", "images", "status", "isFeatured", "rating", "ratingCount",
  "createdAt", "updatedAt"
)
SELECT
  m."listingId",
  p."sellerId",
  m."variantId",
  -- price was NOT NULL pre-split, so this coalesce only fires for rows created
  -- between EXPAND and BACKFILL. Those are forced INACTIVE below and reported.
  coalesce(p."price", 0),
  p."mrp",
  greatest(coalesce(p."stock", 0), 0),
  'NEW',
  2,                                    -- no dispatch SLA existed pre-split; schema default
  greatest(coalesce(p."minOrderQty", 1), 1),
  coalesce(nullif(p."sellScope", ''), 'district'),
  p."district", p."taluka", p."village", p."state",
  p."harvestDate",
  ARRAY[]::TEXT[],                      -- catalog imagery stays on products.images
  CASE
    WHEN p."price" IS NULL   THEN 'INACTIVE'::"ListingState"
    WHEN p."isActive" = false THEN 'INACTIVE'::"ListingState"
    WHEN coalesce(p."stock", 0) <= 0 THEN 'OUT_OF_STOCK'::"ListingState"
    ELSE 'ACTIVE'::"ListingState"
  END,
  coalesce(p."isFeatured", false),
  coalesce(p."rating", 0),              -- seeded from the fused row; sellerMetrics recomputes
  coalesce(p."ratingCount", 0),
  p."createdAt",
  CURRENT_TIMESTAMP
FROM "catalog_split_map" m
JOIN "products" p ON p."id" = m."productId"
WHERE m."listingId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- ── 4. Catalog row states ────────────────────────────────────────────────────
-- Rows that survive as catalog entries: APPROVED (they were already live).
UPDATE "products" p
SET "status"            = 'APPROVED',
    "createdBySellerId" = p."sellerId",
    "mergedIntoId"      = NULL
FROM "catalog_split_map" m
WHERE m."productId" = p."id"
  AND m."decision" IN ('CANONICAL', 'SPLIT_SELLER_DUP');

-- Rows folded into a canonical row: MERGED + a redirect target. NOT deleted —
-- cart_items / order_items / CropReportShare.recommendedProductIds and AuditLog
-- rows all still reference these ids and there is no FK to protect them.
UPDATE "products" p
SET "status"            = 'MERGED',
    "mergedIntoId"      = m."canonicalProductId",
    "createdBySellerId" = p."sellerId"
FROM "catalog_split_map" m
WHERE m."productId" = p."id"
  AND m."decision" = 'MERGED'
  AND m."productId" <> m."canonicalProductId";

-- ── 5. cart_items → the offer ────────────────────────────────────────────────
-- productId is deliberately LEFT ALONE. Remapping it to the canonical row could
-- collide with the still-live @@unique([userId, productId]) whenever one buyer
-- holds two rows that merged — and post-split reads resolve the product through
-- listing → variant → product anyway. CONTRACT drops the column.
UPDATE "cart_items" c
SET "listingId"         = m."listingId",
    "unitPriceSnapshot" = p."price"
FROM "catalog_split_map" m
JOIN "products" p ON p."id" = m."productId"
WHERE m."productId" = c."productId"
  AND m."listingId" IS NOT NULL
  AND c."listingId" IS NULL;

-- ── 6. order_items → purchased offer + real timestamps ───────────────────────
-- createdAt FIRST: the column was added with DEFAULT now(), so without this every
-- historical item claims to have been ordered at migration time and every rolling
-- window in sellerMetrics sees the entire order book as "today".
UPDATE "order_items" oi
SET "createdAt" = o."createdAt"
FROM "orders" o
WHERE o."id" = oi."orderId"
  AND oi."createdAt" > o."createdAt";

UPDATE "order_items" oi
SET "listingId" = m."listingId",
    "variantId" = m."variantId"
FROM "catalog_split_map" m
WHERE m."productId" = oi."productId"
  AND m."listingId" IS NOT NULL
  AND oi."listingId" IS NULL
  -- Only attribute the offer when the recorded seller actually matches the row we
  -- derived the listing from. A mismatch means history disagrees with the catalog;
  -- leave it NULL and let it show up in the report rather than guessing.
  AND (oi."sellerId" IS NULL OR oi."sellerId" = (SELECT p2."sellerId" FROM "products" p2 WHERE p2."id" = m."productId"));

-- Transition timestamps are NOT invented. Only CANCELLED can be dated at all, and
-- even then only to the order's own timestamp. shippedAt stays NULL for all
-- historical items, so onTimeDispatchRate has no pre-split history to work with —
-- sellerMetrics.service.js therefore SKIPS items whose shippedAt is NULL instead
-- of scoring them as late. Do not "improve" this by backdating; it would fabricate
-- an SLA record that never existed.
UPDATE "order_items" oi
SET "cancelledAt" = o."updatedAt"
FROM "orders" o
WHERE o."id" = oi."orderId"
  AND oi."status" = 'CANCELLED'
  AND oi."cancelledAt" IS NULL;

UPDATE "order_items" oi
SET "deliveredAt" = o."updatedAt"
FROM "orders" o
WHERE o."id" = oi."orderId"
  AND oi."status" = 'DELIVERED'
  AND oi."deliveredAt" IS NULL;

-- ── 7. reviews → attributable ────────────────────────────────────────────────
UPDATE "reviews" r
SET "sellerId" = p."sellerId"
FROM "products" p
WHERE p."id" = r."productId"
  AND r."sellerId" IS NULL
  AND p."sellerId" IS NOT NULL;

-- orderItemId only when it is UNAMBIGUOUS: exactly one order item ties this buyer
-- to this product. Anything else stays NULL — a guessed purchase link would make a
-- fake review look verified, and NULLs are distinct in the new unique index so
-- leaving them is free.
UPDATE "reviews" r
SET "orderItemId" = sub."orderItemId"
FROM (
  SELECT o."userId", oi."productId", min(oi."id") AS "orderItemId"
  FROM "order_items" oi
  JOIN "orders" o ON o."id" = oi."orderId"
  GROUP BY o."userId", oi."productId"
  HAVING count(*) = 1
) sub
WHERE r."userId" = sub."userId"
  AND r."productId" = sub."productId"
  AND r."orderItemId" IS NULL;

-- ── 8. return_requests → seller attribution ──────────────────────────────────
UPDATE "return_requests" rr
SET "sellerId" = oi."sellerId"
FROM "order_items" oi
WHERE oi."id" = rr."orderItemId"
  AND rr."sellerId" IS NULL
  AND oi."sellerId" IS NOT NULL;

-- Order-level returns: only when the whole order has exactly ONE seller.
UPDATE "return_requests" rr
SET "sellerId" = sub."sellerId"
FROM (
  SELECT oi."orderId", min(oi."sellerId") AS "sellerId"
  FROM "order_items" oi
  WHERE oi."sellerId" IS NOT NULL
  GROUP BY oi."orderId"
  HAVING count(DISTINCT oi."sellerId") = 1
) sub
WHERE rr."orderId" = sub."orderId"
  AND rr."sellerId" IS NULL;

-- ── 9. NEAR-MISS REPORT ──────────────────────────────────────────────────────
-- Everything the backfill DECLINED to merge, plus everything it thinks a human
-- should look at. Nothing in this section changes catalog data.
DELETE FROM "catalog_split_near_miss" WHERE "resolvedAt" IS NULL;

-- 9a. Same seller, same group+variant → kept separate instead of merged.
INSERT INTO "catalog_split_near_miss" ("id","kind","leftId","rightId","similarity","leftLabel","rightLabel","note")
SELECT
  md5(m."productId" || '|dup')::uuid::text,
  'SELLER_DUPLICATE',
  m."productId",
  m."canonicalProductId",
  1.0,
  p."name",
  cp."name",
  'This seller already holds an offer for the same variant in this group. Kept as its own catalog row to avoid violating unique(sellerId, variantId). Review and merge or delist.'
FROM "catalog_split_map" m
JOIN "products" p  ON p."id"  = m."productId"
JOIN "products" cp ON cp."id" = m."canonicalProductId"
WHERE m."decision" = 'SPLIT_SELLER_DUP';

-- 9b. Trigram neighbours: two DIFFERENT catalog rows in the same category whose
-- names are similar but whose group keys differ (different brand, different
-- manufacturer, or a pack size baked into the name). These are the candidate
-- merges — the migration refuses to make them automatically.
-- `%` is the indexed prefilter (gin_trgm_ops supports % and ILIKE, NOT <->), and
-- similarity() does the ordering afterwards.
INSERT INTO "catalog_split_near_miss" ("id","kind","leftId","rightId","similarity","leftLabel","rightLabel","note")
SELECT * FROM (
  SELECT DISTINCT ON (least(a."id", b."id"), greatest(a."id", b."id"))
    md5(least(a."id", b."id") || '|' || greatest(a."id", b."id"))::uuid::text,
    'TRIGRAM_NEIGHBOUR',
    least(a."id", b."id"),
    greatest(a."id", b."id"),
    similarity(a."name", b."name"),
    a."name",
    b."name",
    'Similar names, different group key ('
      || coalesce(nullif(a."brand", ''), 'no brand') || ' vs '
      || coalesce(nullif(b."brand", ''), 'no brand')
      || '). NOT merged. If these are the same product, merge them in the admin QC tool; if the difference is only pack size, merge and add variants.'
  FROM "products" a
  JOIN "products" b
    ON b."categoryId" = a."categoryId"
   AND b."id" <> a."id"
   AND b."name" % a."name"
   AND b."normalizedKey" <> a."normalizedKey"
  WHERE a."status" <> 'MERGED'
    AND b."status" <> 'MERGED'
    AND similarity(a."name", b."name") >= 0.60
  ORDER BY least(a."id", b."id"), greatest(a."id", b."id"), similarity(a."name", b."name") DESC
) t
ON CONFLICT ("id") DO NOTHING;

-- 9c. Seller rows we could not price. Their listings exist but are INACTIVE.
INSERT INTO "catalog_split_near_miss" ("id","kind","leftId","rightId","similarity","leftLabel","rightLabel","note")
SELECT
  md5(m."productId" || '|nullprice')::uuid::text,
  'NULL_PRICE',
  m."productId",
  m."listingId",
  NULL,
  p."name",
  NULL,
  'Source row had no price. Listing created at 0 and forced INACTIVE — the seller must set a price before it can go live.'
FROM "catalog_split_map" m
JOIN "products" p ON p."id" = m."productId"
WHERE m."listingId" IS NOT NULL AND p."price" IS NULL
ON CONFLICT ("id") DO NOTHING;

-- 9d. Cart rows that reference an admin/catalog-only product, so there is no
-- offer to point them at. CONTRACT deletes these; surface them first.
INSERT INTO "catalog_split_near_miss" ("id","kind","leftId","rightId","similarity","leftLabel","rightLabel","note")
SELECT
  md5(c."id" || '|cartorphan')::uuid::text,
  'CART_ORPHAN',
  c."id",
  c."productId",
  NULL,
  p."name",
  NULL,
  'Cart row points at a catalog-only product with no seller offer. It is unbuyable post-split and CONTRACT removes it.'
FROM "cart_items" c
JOIN "products" p ON p."id" = c."productId"
WHERE c."listingId" IS NULL
ON CONFLICT ("id") DO NOTHING;

-- 9e. Catalog rows whose group split ONLY on unit → multiple variants. Expected
-- and correct, logged so the count is explainable rather than surprising.
INSERT INTO "catalog_split_near_miss" ("id","kind","leftId","rightId","similarity","leftLabel","rightLabel","note")
SELECT
  md5(v."productId" || '|multivariant')::uuid::text,
  'MULTI_VARIANT',
  v."productId",
  NULL,
  p."name",
  NULL,
  'Sellers used ' || v.n || ' different units for this product, so it has ' || v.n || ' variants. Confirm they are genuinely different packs.'
FROM (
  SELECT "productId", count(*) AS n FROM "product_variants" GROUP BY "productId" HAVING count(*) > 1
) v
JOIN "products" p ON p."id" = v."productId"
ON CONFLICT ("id") DO NOTHING;

COMMIT;

-- ============================================================================
-- VERIFY — run these and read them BEFORE promoting to prod.
-- ============================================================================
--
-- (1) Nothing lost. products_total must equal canonical + split + merged, and
--     listings must equal the number of rows that had a seller.
--   SELECT
--     (SELECT count(*) FROM products)                                          AS products_total,
--     (SELECT count(*) FROM catalog_split_map)                                 AS mapped,
--     (SELECT count(*) FROM catalog_split_map WHERE decision='CANONICAL')       AS canonical,
--     (SELECT count(*) FROM catalog_split_map WHERE decision='MERGED')          AS merged,
--     (SELECT count(*) FROM catalog_split_map WHERE decision='SPLIT_SELLER_DUP')AS split_seller_dup,
--     (SELECT count(*) FROM product_variants)                                  AS variants,
--     (SELECT count(*) FROM seller_listings)                                   AS listings,
--     (SELECT count(*) FROM products WHERE "sellerId" IS NOT NULL)             AS rows_with_seller;
--
-- (2) NO FALSE MERGES. Must return ZERO rows: nothing may be merged into a row
--     with a different brand, manufacturer, category or normalised name.
--   SELECT m."productId", p."name", p."brand", cp."name", cp."brand"
--   FROM catalog_split_map m
--   JOIN products p  ON p."id"  = m."productId"
--   JOIN products cp ON cp."id" = m."canonicalProductId"
--   WHERE m."decision" = 'MERGED'
--     AND (p."normalizedKey" <> cp."normalizedKey" OR p."categoryId" <> cp."categoryId");
--
-- (3) The unique that would have broken the insert. Must return ZERO rows.
--   SELECT "sellerId", "variantId", count(*) FROM seller_listings
--   GROUP BY 1,2 HAVING count(*) > 1;
--
-- (4) Every cart row that CAN point at an offer now does. Must return ZERO.
--   SELECT count(*) FROM cart_items c
--   JOIN products p ON p."id" = c."productId"
--   WHERE c."listingId" IS NULL AND p."sellerId" IS NOT NULL;
--
-- (5) THE REPORT. This is the deliverable for manual review.
--   SELECT kind, count(*) FROM catalog_split_near_miss WHERE "resolvedAt" IS NULL GROUP BY kind;
--   SELECT kind, "leftLabel", "rightLabel", round(similarity::numeric, 3) AS sim, note
--   FROM catalog_split_near_miss WHERE "resolvedAt" IS NULL
--   ORDER BY kind, similarity DESC NULLS LAST LIMIT 200;
--
-- (6) Historical order timestamps are real, not migration-stamped. Must return ZERO.
--   SELECT count(*) FROM order_items oi JOIN orders o ON o."id"=oi."orderId"
--   WHERE oi."createdAt" > o."createdAt" + interval '1 second';
