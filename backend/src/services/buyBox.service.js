/**
 * Buy Box — which seller's offer wins the product page (CATALOG-SPLIT §4).
 *
 *   score = w1·norm(price) + w2·sellerRating + w3·norm(dispatchSla) + w4·fulfillment
 *
 * Every term is normalised to [0,1] with 1 = better, so the weights are directly
 * comparable. Weights live in AppSetting (`buybox.weight.*`), price-heavy by
 * default — do not hard-code them; a marketplace's ranking policy is a business
 * decision an operator has to be able to change without a redeploy.
 *
 * ── BOOTSTRAPPING (day one, no data) ────────────────────────────────────────
 * SellerProfile metrics did not exist before this project, so on the day it ships
 * every seller has metricsUpdatedAt = NULL and w2/w4 would rank pure noise.
 * Rule: if NO candidate for a variant has metrics yet, w2 and w4 are dropped and
 * their weight is redistributed over w1/w3 — the buy box degrades to
 * cheapest-then-fastest, which is a defensible ranking rather than a random one.
 * If SOME candidates have metrics, the ones that don't get NEUTRAL values
 * (configurable) so a new Kendra is neither punished nor rewarded for being new.
 *
 * ── CACHE INVALIDATION (an explicit decision, not an oversight) ─────────────
 * The existing listing cache deliberately does NOT invalidate on stock changes
 * from orders — too write-heavy — and relies on a 60 s TTL, which is safe there
 * because checkout re-reads stock inside its Serializable transaction.
 * The buy box cannot inherit that: "if the winner goes out of stock, the next-best
 * listing takes over" is a correctness requirement, and up to 60 s of showing a
 * sold-out Kendra as the default Add-to-Cart is a bad checkout every time.
 * DECISION: invalidate on stock change, but ONLY when the change CROSSES ZERO —
 * i.e. when a listing enters or leaves OUT_OF_STOCK. That is the only stock event
 * that can change the winner, and it is rare, so the write amplification the
 * original comment was avoiding does not materialise. Ordinary decrements
 * (10 → 9) still ride the 60 s TTL exactly as before.
 * See applyListingStockDeltas() in utils/stockBatch.js, which reports the crossings.
 */
import prisma from '../config/db.js';
import { getSetting } from './settings.service.js';
import { cachedListing, bumpListingVersion } from '../utils/listingCache.js';
import logger from '../utils/logger.js';

export const NS_BUYBOX = 'agristore:buybox';
/** Short, like the products namespace — bounds drift between explicit bumps. */
export const BUYBOX_TTL = 60;

/** Invalidate every cached buy box. Call after any price/stock/status change. */
export async function invalidateBuyBox() {
  await bumpListingVersion(NS_BUYBOX);
}

async function weights() {
  const [w1, w2, w3, w4, neutralRating, maxSla] = await Promise.all([
    getSetting('buybox.weight.price'),
    getSetting('buybox.weight.sellerRating'),
    getSetting('buybox.weight.dispatchSla'),
    getSetting('buybox.weight.fulfillment'),
    getSetting('buybox.neutralSellerRating'),
    getSetting('buybox.maxDispatchSlaDays'),
  ]);
  return {
    price:       Number(w1) >= 0 ? Number(w1) : 0.6,
    rating:      Number(w2) >= 0 ? Number(w2) : 0.15,
    sla:         Number(w3) >= 0 ? Number(w3) : 0.15,
    fulfillment: Number(w4) >= 0 ? Number(w4) : 0.1,
    neutralRating: Number(neutralRating) || 3.5,
    maxSla:        Number(maxSla) || 14,
  };
}

/**
 * Geography eligibility, as a Prisma `where` fragment against seller_listings.
 *
 * Preserves the storefront's existing semantics exactly — a listing matches when
 * its geo column equals the buyer's OR is NULL (unrestricted) — and additionally
 * honours `sellScope`, which the old single-table filter ignored entirely. NULL
 * geo on the listing always passes: that is how a national supplier is modelled.
 *
 * `equals` + `mode: 'insensitive'` emits ILIKE, so the plain btree on
 * seller_listings(district) cannot serve it — same limitation the product-side
 * filter already had. Kept for behavioural parity rather than silently changing
 * which listings match; fixing it means a citext column or a lower() expression
 * index, which is a separate change.
 *
 * @param {{district?:string, taluka?:string, village?:string, state?:string}} buyer
 */
export function listingGeoWhere(buyer = {}) {
  const { district, taluka, village, state } = buyer;
  if (!district && !taluka && !village && !state) return {};

  const ci = (v) => ({ equals: v, mode: 'insensitive' });
  const scopeClause = (scope, field, value) =>
    value
      ? { AND: [{ sellScope: scope }, { OR: [{ [field]: ci(value) }, { [field]: null }] }] }
      : { sellScope: scope };

  return {
    OR: [
      { sellScope: 'all_india' },
      scopeClause('state',    'state',    state),
      scopeClause('district', 'district', district),
      scopeClause('taluka',   'taluka',   taluka),
      scopeClause('village',  'village',  village),
    ],
  };
}

/** min-max normalise so that LOWER raw values score HIGHER. All-equal → 1. */
function normLowerIsBetter(value, min, max) {
  if (!(max > min)) return 1;
  return (max - value) / (max - min);
}

/**
 * Score and rank the eligible offers for one variant.
 *
 * @param {string} variantId
 * @param {object} buyer  { district, taluka, village, state } — the eligibility gate
 * @returns {Promise<{winner: ?object, offers: object[], weights: object}>}
 */
export async function rankOffersForVariant(variantId, buyer = {}) {
  const cfg = await weights();

  const listings = await prisma.sellerListing.findMany({
    where: {
      variantId,
      status: 'ACTIVE',
      stockQty: { gt: 0 },
      ...listingGeoWhere(buyer),
    },
    include: {
      seller: {
        select: {
          id: true, name: true, district: true, taluka: true, state: true,
          sellerProfile: {
            select: {
              rating: true, ratingCount: true, cancellationRate: true,
              onTimeDispatchRate: true, returnRate: true, metricsUpdatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!listings.length) return { winner: null, offers: [], weights: cfg };

  const prices = listings.map((l) => Number(l.sellingPrice));
  const slas   = listings.map((l) => Math.min(Number(l.dispatchSlaDays) || 0, cfg.maxSla));
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minS = Math.min(...slas),   maxS = Math.max(...slas);

  // Bootstrap check: does ANY candidate have real metrics?
  const anyMetrics = listings.some((l) => l.seller?.sellerProfile?.metricsUpdatedAt);

  let { price: wP, rating: wR, sla: wS, fulfillment: wF } = cfg;
  if (!anyMetrics) {
    // Redistribute the reputation weight onto the two terms that DO have data,
    // in their existing proportion, so the score stays on the same [0,1] scale.
    const spare = wR + wF;
    const base = wP + wS;
    if (base > 0) { wP += spare * (wP / base); wS += spare * (wS / base); }
    wR = 0; wF = 0;
  }
  const total = wP + wR + wS + wF || 1;

  const scored = listings.map((l) => {
    const m = l.seller?.sellerProfile;
    const hasMetrics = !!m?.metricsUpdatedAt;

    // No metrics → neutral, never zero. Zero would rank an unrated new Kendra
    // below a badly-rated one, which is not what "no data" means.
    const rating5 = hasMetrics ? Number(m.rating) || 0 : cfg.neutralRating;
    const fulfillment = hasMetrics
      ? (Number(m.onTimeDispatchRate ?? 1) + (1 - Number(m.cancellationRate ?? 0)) + (1 - Number(m.returnRate ?? 0))) / 3
      : 0.5;

    const nPrice = normLowerIsBetter(Number(l.sellingPrice), minP, maxP);
    const nSla   = normLowerIsBetter(Math.min(Number(l.dispatchSlaDays) || 0, cfg.maxSla), minS, maxS);
    const nRating = Math.min(Math.max(rating5 / 5, 0), 1);

    const score = (wP * nPrice + wR * nRating + wS * nSla + wF * fulfillment) / total;

    return {
      ...l,
      buyBoxScore: Number(score.toFixed(6)),
      scoreParts: { price: nPrice, rating: nRating, sla: nSla, fulfillment, hasMetrics },
      sellerRating: rating5,
      sellerRatingCount: hasMetrics ? Number(m.ratingCount) || 0 : 0,
    };
  });

  // Deterministic ordering. Without the trailing id, two listings created in the
  // same millisecond would order arbitrarily and the "winner" could flip between
  // requests — the same class of bug as the unindexed listing sort.
  scored.sort((a, b) =>
    b.buyBoxScore - a.buyBoxScore ||
    b.sellerRating - a.sellerRating ||
    new Date(a.createdAt) - new Date(b.createdAt) ||
    (a.id < b.id ? -1 : 1),
  );

  return { winner: scored[0], offers: scored, weights: { wP, wR, wS, wF, bootstrapped: !anyMetrics } };
}

/**
 * Cached wrapper. The cache key includes the buyer's geography because
 * eligibility — and therefore the winner — genuinely differs per district; a
 * globally-shared entry would serve a Nagpur buyer a Kendra that cannot sell to
 * them.
 */
export async function getBuyBox(variantId, buyer = {}) {
  const identity = JSON.stringify([
    variantId,
    (buyer.district || '').toLowerCase(),
    (buyer.taluka   || '').toLowerCase(),
    (buyer.village  || '').toLowerCase(),
    (buyer.state    || '').toLowerCase(),
  ]);
  const { data } = await cachedListing(NS_BUYBOX, identity, BUYBOX_TTL, async () => ({
    data: await rankOffersForVariant(variantId, buyer),
  }));
  return data;
}

/**
 * Product-level buy box: the best offer across ALL of a product's variants, plus
 * the per-variant breakdown. This is what the product page and the storefront
 * card render — a card shows "from ₹1,150", which is the cheapest eligible offer
 * on any pack size, not the cheapest on an arbitrarily-chosen one.
 */
export async function getProductBuyBox(productId, buyer = {}) {
  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true, attributes: true, unit: true, gtin: true, sku: true, isDefault: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!variants.length) return { winner: null, variants: [], offerCount: 0, lowestPrice: null };

  const ranked = await Promise.all(variants.map(async (v) => {
    const r = await getBuyBox(v.id, buyer);
    return { variant: v, winner: r.winner, offers: r.offers };
  }));

  const withOffers = ranked.filter((r) => r.winner);
  const best = withOffers.reduce(
    (acc, r) => (!acc || r.winner.buyBoxScore > acc.winner.buyBoxScore ? r : acc),
    null,
  );
  const prices = withOffers.map((r) => Number(r.winner.sellingPrice));

  return {
    winner: best ? { ...best.winner, variantId: best.variant.id, variant: best.variant } : null,
    variants: ranked.map((r) => ({
      ...r.variant,
      offerCount: r.offers.length,
      lowestPrice: r.offers.length ? Math.min(...r.offers.map((o) => Number(o.sellingPrice))) : null,
      winnerListingId: r.winner?.id ?? null,
    })),
    offerCount: ranked.reduce((s, r) => s + r.offers.length, 0),
    lowestPrice: prices.length ? Math.min(...prices) : null,
  };
}

/**
 * Batch variant of getProductBuyBox for list screens (AgriStoreHome cards).
 *
 * The storefront used to be one indexed query over a single table. Post-split it
 * is a join, so doing it per card would be N+1 across three tables. This does the
 * whole page in two grouped queries and computes "cheapest eligible offer" in
 * memory — no scoring, because a card shows a price, not a winner.
 *
 * @returns {Promise<Map<string, {lowestPrice:?number, offerCount:number, sellerCount:number}>>}
 */
export async function cheapestOfferByProduct(productIds, buyer = {}) {
  const out = new Map(productIds.map((id) => [id, {
    lowestPrice: null, lowestMrp: null, offerCount: 0, sellerCount: 0, totalStock: 0,
  }]));
  if (!productIds.length) return out;

  const variants = await prisma.productVariant.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, productId: true },
  });
  if (!variants.length) return out;

  const productByVariant = new Map(variants.map((v) => [v.id, v.productId]));
  const listings = await prisma.sellerListing.findMany({
    where: {
      variantId: { in: variants.map((v) => v.id) },
      status: 'ACTIVE',
      stockQty: { gt: 0 },
      ...listingGeoWhere(buyer),
    },
    select: { variantId: true, sellingPrice: true, mrp: true, stockQty: true, sellerId: true },
  });

  const sellersByProduct = new Map();
  for (const l of listings) {
    const pid = productByVariant.get(l.variantId);
    if (!pid) continue;
    const row = out.get(pid);
    if (!row) continue;
    const price = Number(l.sellingPrice);
    row.offerCount += 1;
    row.totalStock += Number(l.stockQty) || 0;
    if (row.lowestPrice == null || price < row.lowestPrice) {
      row.lowestPrice = price;
      // The struck-through MRP on a card has to be the MRP of the offer whose
      // price is shown, not the highest MRP across sellers — otherwise the card
      // advertises a discount nobody is actually giving.
      row.lowestMrp = l.mrp == null ? null : Number(l.mrp);
    }
    if (!sellersByProduct.has(pid)) sellersByProduct.set(pid, new Set());
    sellersByProduct.get(pid).add(l.sellerId);
  }
  for (const [pid, set] of sellersByProduct) out.get(pid).sellerCount = set.size;
  return out;
}

/**
 * Keep `status` consistent with `stockQty` and report whether the listing crossed
 * the OUT_OF_STOCK boundary — the only stock event the buy box cache cares about.
 *
 * @returns {Promise<boolean>} true when a bump is warranted
 */
export async function syncListingStockStatus(tx, listingIds) {
  if (!listingIds?.length) return false;
  try {
    const rows = await tx.sellerListing.findMany({
      where: { id: { in: listingIds } },
      select: { id: true, stockQty: true, status: true },
    });
    const toOut = rows.filter((r) => r.stockQty <= 0 && r.status === 'ACTIVE').map((r) => r.id);
    const toIn  = rows.filter((r) => r.stockQty > 0 && r.status === 'OUT_OF_STOCK').map((r) => r.id);
    if (toOut.length) await tx.sellerListing.updateMany({ where: { id: { in: toOut } }, data: { status: 'OUT_OF_STOCK' } });
    if (toIn.length)  await tx.sellerListing.updateMany({ where: { id: { in: toIn  } }, data: { status: 'ACTIVE' } });
    return toOut.length > 0 || toIn.length > 0;
  } catch (err) {
    logger.warn('[BuyBox] stock status sync failed: %s', err.message);
    return false;
  }
}
