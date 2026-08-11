/**
 * Catalog matching + duplicate gate (CATALOG-SPLIT).
 *
 * Two jobs:
 *   1. searchCatalog()  — what the seller app calls FIRST, before any create
 *      form is shown. Exact GTIN → brand + modelNumber → trigram on name.
 *   2. assertNoCatalogDuplicate() — the server-side re-check on submit.
 *
 * WHY THIS REPLACES contentFraud.assessListing() FOR DUPLICATES
 * The pre-existing heuristic could not have caught a cross-seller duplicate even
 * in principle:
 *   • it queried `where: { sellerId }` — scoped to the submitting seller, so a
 *     second Kendra listing the same seed was invisible to it;
 *   • it compared name-only, exact normalized equality, over that seller's last
 *     100 products;
 *   • it ran AFTER the row was committed, fire-and-forget
 *     (`flagListingIfSuspicious(...).catch(() => {})`), so it could only file a
 *     moderation flag, never prevent the duplicate.
 * The check here is CROSS-SELLER, PRE-COMMIT and BLOCKING. contentFraud keeps its
 * burst / new-account job; it just no longer owns "is this a duplicate".
 *
 * TRIGRAM MECHANICS — read before touching the SQL
 * The GIN indexes on products.name/description are `gin_trgm_ops`. That opclass
 * supports the `%` similarity operator and ILIKE, but NOT the `<->` distance
 * operator (KNN ordering needs `gist_trgm_ops`). So every query here MATERIALISES
 * candidates with `%` — which is index-served — and only then orders the
 * (small) candidate set by similarity() in the outer query. Never write
 * `ORDER BY name <-> $1` against these indexes: it parses, then seq-scans.
 */
import prisma from '../config/db.js';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger.js';
import { getSetting } from './settings.service.js';

/**
 * The `%` operator tests against the session GUC pg_trgm.similarity_threshold,
 * which defaults to 0.3. Our own threshold is applied on top with an explicit
 * similarity() predicate, so it must be >= this value or `%` would pre-filter
 * away rows we still wanted. Clamped rather than SET LOCAL'd because SET LOCAL
 * needs its own transaction on the pooled connection for a read that does not
 * otherwise need one.
 */
const TRGM_OPERATOR_FLOOR = 0.3;

/** Cap on rows pulled back from any single trigram probe. */
const CANDIDATE_LIMIT = 25;

/**
 * Normalise a free-text product name for comparison.
 *
 * MUST stay byte-identical to catalog_norm() in
 * prisma/manual/catalog_split_1_expand.sql, or the backfill and this runtime gate
 * will disagree about what a duplicate is.
 *
 * Rule: lowercase, then collapse every run of punctuation / symbols / separators
 * / whitespace into a single space, then trim. It removes punctuation rather
 * than "keeping only alphanumerics" ON PURPOSE — \p{L}\p{N} (like POSIX
 * [[:alnum:]]) excludes Unicode combining marks, which would strip the matras out
 * of every Hindi/Marathi name and silently collide distinct products.
 *
 * NOTE: this is NOT sanitizeSearch(). That one is a LIKE-injection guard — it
 * replaces % _ \ with spaces and neither lowercases nor strips punctuation.
 * Both are applied, for different reasons: sanitizeSearch on the way into a
 * `contains` filter, this on the way into a comparison.
 */
export function normalizeProductName(raw) {
  if (raw == null) return '';
  return String(raw)
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, ' ')
    .trim();
}

/**
 * The deterministic dedup key. Mirrors catalog_key() in the expand SQL.
 *
 * NULL/empty brand and manufacturer collapse to the sentinel '~', which no
 * normalised value can ever equal (normalizeProductName strips '~' as
 * punctuation). So "unbranded" is its OWN bucket and never wildcard-matches a
 * branded product — the direction that avoids false merges.
 *
 * Pack size is deliberately NOT stripped from the name. "Mahyco Bt Cotton Seed
 * 450g" and "…1kg" therefore produce different keys. That is a false SPLIT, which
 * an admin merges in one click; the opposite error would silently reassign one
 * Kendra's stock and price to another Kendra's product.
 */
export function normalizeProductKey({ categoryId, brand, manufacturer, name }) {
  const part = (v) => normalizeProductName(v) || '~';
  return [categoryId || '~', part(brand), part(manufacturer), normalizeProductName(name)].join('|');
}

/** Tunable thresholds, admin-editable via AppSetting. Never hard-code these. */
async function thresholds() {
  const [block, suggest] = await Promise.all([
    getSetting('catalog.dedupBlockSimilarity'),
    getSetting('catalog.dedupSuggestSimilarity'),
  ]);
  return {
    block:   Math.max(TRGM_OPERATOR_FLOOR, Number(block)   || 0.72),
    suggest: Math.max(TRGM_OPERATOR_FLOOR, Number(suggest) || 0.45),
  };
}

/**
 * Trigram probe. Index-served `%` prefilter, similarity() ordering afterwards.
 * Returns [{ id, name, brand, similarity }] most-similar first.
 *
 * @param {string}  name        raw seller-supplied name
 * @param {number}  minScore    inclusive similarity floor
 * @param {?string} categoryId  restrict to one category when known
 * @param {?string} excludeId   the row being edited
 */
async function trigramCandidates(name, minScore, categoryId, excludeId) {
  const probe = String(name || '').trim();
  if (probe.length < 3) return []; // trigrams need 3 chars to mean anything

  const catFilter = categoryId ? Prisma.sql`AND p."categoryId" = ${categoryId}` : Prisma.empty;
  const exclFilter = excludeId ? Prisma.sql`AND p."id" <> ${excludeId}` : Prisma.empty;

  return prisma.$queryRaw`
    SELECT p."id", p."name", p."brand", p."manufacturer", p."categoryId",
           similarity(p."name", ${probe}) AS "similarity"
    FROM "products" p
    WHERE p."name" % ${probe}
      AND p."status" IN ('APPROVED', 'PENDING_QC')
      ${catFilter}
      ${exclFilter}
      AND similarity(p."name", ${probe}) >= ${minScore}
    ORDER BY "similarity" DESC, p."createdAt" ASC
    LIMIT ${CANDIDATE_LIMIT}
  `;
}

/**
 * Follow a MERGED product to its surviving row. One hop is enough — the merge
 * tool always points at a live canonical, never at another MERGED row — but the
 * loop is bounded anyway so a bad manual UPDATE can't hang a request.
 */
export async function resolveCanonicalProductId(productId) {
  let id = productId;
  for (let hop = 0; hop < 5; hop++) {
    const row = await prisma.product.findUnique({
      where: { id },
      select: { id: true, status: true, mergedIntoId: true },
    });
    if (!row) return null;
    if (row.status !== 'MERGED' || !row.mergedIntoId) return row.id;
    id = row.mergedIntoId;
  }
  logger.warn('[CatalogMatch] merge chain too deep from %s', productId);
  return id;
}

/**
 * Catalog search for the seller "Add product" flow.
 *
 * Match order is deliberate: GTIN is exact and unforgeable but almost never
 * present on Indian agri-inputs; brand + modelNumber is exact when the
 * manufacturer publishes one; trigram is the fallback that actually fires for
 * most seeds and fertilisers.
 *
 * Each hit carries an offer summary so the seller sees the thing that matters —
 * "3 Kendras already sell this, from ₹1,150" — before deciding to attach.
 *
 * @returns {Promise<{ matchType: 'gtin'|'model'|'fuzzy'|'none', results: object[] }>}
 */
export async function searchCatalog({ q, gtin, brand, categoryId, limit = 10 }) {
  const take = Math.min(Math.max(Number(limit) || 10, 1), 25);

  // 1. Exact GTIN — a barcode match is definitive, so it short-circuits.
  if (gtin) {
    const variant = await prisma.productVariant.findUnique({
      where: { gtin: String(gtin).trim() },
      select: { productId: true },
    });
    if (variant) {
      const results = await hydrate([variant.productId]);
      if (results.length) return { matchType: 'gtin', results };
    }
  }

  // 2. brand + modelNumber.
  if (brand && q) {
    const byModel = await prisma.product.findMany({
      where: {
        brand: { equals: String(brand).trim(), mode: 'insensitive' },
        modelNumber: { equals: String(q).trim(), mode: 'insensitive' },
        status: { in: ['APPROVED', 'PENDING_QC'] },
      },
      select: { id: true },
      take,
    });
    if (byModel.length) return { matchType: 'model', results: await hydrate(byModel.map((p) => p.id)) };
  }

  // 3. Trigram on name.
  if (q) {
    const { suggest } = await thresholds();
    const cands = await trigramCandidates(q, suggest, categoryId, null);
    if (cands.length) {
      const ordered = cands.slice(0, take).map((c) => c.id);
      const scoreById = new Map(cands.map((c) => [c.id, Number(c.similarity)]));
      const results = await hydrate(ordered);
      results.forEach((r) => { r.matchScore = scoreById.get(r.id) ?? null; });
      results.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
      return { matchType: 'fuzzy', results };
    }
  }

  return { matchType: 'none', results: [] };
}

/**
 * Load catalog rows by id, preserving nothing about order (callers re-sort), with
 * the variant list and a live offer summary per variant.
 */
async function hydrate(ids) {
  if (!ids.length) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, nameHi: true, nameMr: true, brand: true, manufacturer: true,
      modelNumber: true, description: true, images: true, categoryId: true, subcategory: true,
      status: true, rating: true, ratingCount: true,
      category: { select: { id: true, name: true, icon: true, color: true } },
      variants: {
        select: { id: true, attributes: true, unit: true, gtin: true, sku: true, isDefault: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const offerAgg = variantIds.length
    ? await prisma.sellerListing.groupBy({
        by: ['variantId'],
        where: { variantId: { in: variantIds }, status: 'ACTIVE', stockQty: { gt: 0 } },
        _count: { _all: true },
        _min: { sellingPrice: true },
      })
    : [];
  const aggByVariant = new Map(offerAgg.map((a) => [a.variantId, a]));

  for (const p of products) {
    for (const v of p.variants) {
      const a = aggByVariant.get(v.id);
      v.offerCount = a?._count?._all ?? 0;
      v.lowestPrice = a?._min?.sellingPrice ?? null;
    }
    p.offerCount = p.variants.reduce((s, v) => s + v.offerCount, 0);
    const prices = p.variants.map((v) => v.lowestPrice).filter((x) => x != null);
    p.lowestPrice = prices.length ? prices.reduce((a, b) => (Number(a) <= Number(b) ? a : b)) : null;
  }
  return products;
}

/**
 * THE GATE. Cross-seller, pre-commit, blocking.
 *
 * Call this INSIDE the create transaction, before `product.create`. It returns a
 * verdict rather than throwing so the caller can shape a 409 that tells the
 * seller "this already exists — attach to it" and hands back the id to attach to,
 * which is the entire point of the flow.
 *
 * @returns {Promise<{ duplicate: boolean, reason: ?string, productId: ?string, candidates: object[] }>}
 */
export async function findCatalogDuplicate({
  categoryId, brand, manufacturer, name, modelNumber, gtin, excludeProductId = null,
}) {
  const none = { duplicate: false, reason: null, productId: null, candidates: [] };
  try {
    // 1. GTIN — the unique index would reject it at insert anyway; catching it
    //    here turns a Prisma P2002 into a message the seller can act on.
    if (gtin) {
      const v = await prisma.productVariant.findUnique({
        where: { gtin: String(gtin).trim() },
        select: { productId: true },
      });
      if (v && v.productId !== excludeProductId) {
        return { duplicate: true, reason: 'gtin', productId: v.productId, candidates: await hydrate([v.productId]) };
      }
    }

    // 2. Exact dedup key — same category, brand, manufacturer and normalised
    //    name. This is the primary gate: most agri-inputs have neither a GTIN nor
    //    a model number.
    const key = normalizeProductKey({ categoryId, brand, manufacturer, name });
    const exact = await prisma.product.findFirst({
      where: {
        normalizedKey: key,
        status: { in: ['APPROVED', 'PENDING_QC'] },
        ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (exact) {
      return { duplicate: true, reason: 'exact_key', productId: exact.id, candidates: await hydrate([exact.id]) };
    }

    // 3. brand + modelNumber.
    if (brand && modelNumber) {
      const m = await prisma.product.findFirst({
        where: {
          brand: { equals: String(brand).trim(), mode: 'insensitive' },
          modelNumber: { equals: String(modelNumber).trim(), mode: 'insensitive' },
          status: { in: ['APPROVED', 'PENDING_QC'] },
          ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
        },
        select: { id: true },
      });
      if (m) return { duplicate: true, reason: 'brand_model', productId: m.id, candidates: await hydrate([m.id]) };
    }

    // 4. Fuzzy. Only blocks at the high threshold; between suggest and block the
    //    seller is shown the candidates but allowed through, because a false block
    //    on a genuinely new product is a dead end for the seller with no recourse.
    const { block, suggest } = await thresholds();
    const cands = await trigramCandidates(name, suggest, categoryId, excludeProductId);
    if (!cands.length) return none;

    // A DIFFERENT, EXPLICIT brand is decisive: "Bt Cotton Seed" from Mahyco and
    // "Bt Cotton Seed" from Rasi are different products with identical names, so
    // similarity() on the name alone is 1.0 and would block the second one
    // outright. Trigram is a NAME heuristic; brand is a fact. Only candidates
    // whose brand is compatible — same normalised brand, or one of the two
    // unstated — can block. The rest are still surfaced as suggestions.
    const myBrand = normalizeProductName(brand);
    const brandCompatible = (c) => {
      const theirs = normalizeProductName(c.brand);
      if (!myBrand || !theirs) return true; // unstated on either side → inconclusive
      return myBrand === theirs;
    };

    const blockers = cands.filter((c) => Number(c.similarity) >= block && brandCompatible(c));
    if (blockers.length) {
      return {
        duplicate: true, reason: 'fuzzy_name', productId: blockers[0].id,
        candidates: await hydrate(blockers.slice(0, 5).map((c) => c.id)),
      };
    }
    return { ...none, candidates: await hydrate(cands.slice(0, 5).map((c) => c.id)) };
  } catch (err) {
    // A dedup failure must not take the create path down with it. Log loudly —
    // this is a gate, and a silently-open gate is worth knowing about.
    logger.error({ err }, '[CatalogMatch] duplicate check failed — allowing create');
    return none;
  }
}
