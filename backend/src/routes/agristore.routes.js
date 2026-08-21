/**
 * AgriStore Routes — catalog / offers / cart / orders
 *
 * ── CATALOG SPLIT ────────────────────────────────────────────────────────────
 * A `products` row used to be catalog identity AND one seller's offer fused into
 * one record, with no unique constraint of any kind. Two Krushi Seva Kendras
 * listing "Mahyco Bt Cotton Seed" produced two rows and two product pages.
 * It is now three tables:
 *
 *   products         catalog identity, shared            (name, brand, images, …)
 *     └ product_variants   the sellable unit (PACK SIZE) (450 g / 1 kg)
 *         └ seller_listings   one OFFER per seller       (price, stock, geo)
 *
 * Buyer routes are keyed on the CATALOG product id; cart and orders are keyed on
 * the LISTING id, because that is the only thing that identifies whose stock is
 * being bought.
 *
 * DUAL-READ WINDOW: until the backfill has run everywhere, a product may have no
 * variants at all. Every read path below falls back to the legacy offer columns
 * in that case, so the storefront does not go blank mid-migration. Each fallback
 * is marked `DUAL-READ` and is removed at CONTRACT.
 *
 * Buyer:
 *   GET    /categories
 *   GET    /products                    ?category&search&district&featured&page&limit
 *   GET    /products/:id                catalog + winning offer
 *   GET    /products/:id/offers         every eligible offer, buy-box order
 *   GET    /cart
 *   POST   /cart                        { listingId | productId, quantity }
 *   PUT    /cart/:listingId             { quantity }
 *   DELETE /cart/:listingId
 *   POST   /orders  ·  /orders/initiate  ·  /orders/confirm
 *   GET    /orders  ·  /orders/:id  ·  PUT /orders/:id/cancel
 *   POST   /products/:id/review         { rating, comment, orderItemId }
 *
 * Seller (authenticate + requireRole SELLER|VERIFIED_FARMER|ADMIN):
 *   GET    /catalog/search              ?q&gtin&brand&categoryId
 *   POST   /catalog/products            → PENDING_QC
 *   GET    /listings                    my offers, each with buy-box status
 *   POST   /listings  ·  PATCH /listings/:id  ·  DELETE /listings/:id
 *   GET    /seller/products             (legacy shim over /listings)
 *   PUT    /seller/products/:id         (legacy shim — OFFER fields only)
 *   DELETE /seller/products/:id         (legacy shim — removes MY offer)
 *   GET    /seller/stats  ·  GET /seller/orders  ·  PUT /seller/orders/:orderId/status
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate, optionalAuth, requireRole } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { validate } from '../middleware/validate.js';
import { maxLen } from '../middleware/textLength.js';
import { sanitizeSearch } from '../utils/sanitizeSearch.js';
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { cachedListing, bumpListingVersion } from '../utils/listingCache.js';
import {
  sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendServerError, paginationMeta, parsePageSize, parsePageNumber,
} from '../utils/response.js';
import { keysetPage } from '../utils/keyset.js';
import { applyListingStockDeltas, applyStockDeltas } from '../utils/stockBatch.js';
import { withSerializableRetry } from '../utils/txRetry.js';
import { D, toMinorUnits } from '../utils/money.js';
import { stripHtml, deepStripHtml } from '../utils/encrypt.js';
import {
  createPaymentOrder, verifyPaymentSignature, fetchPaymentOrder, isMockPayments,
} from '../services/payment.service.js';
import { auditOrderStatusChange, auditAction, AUDIT_ACTIONS } from '../services/audit.service.js';
import { getSellerStats } from '../services/sellerStats.service.js';
import { velocityGuard } from '../middleware/velocityLimit.js';
import { VELOCITY_ACTIONS } from '../services/velocity.service.js';
import { refundAbuseGuard } from '../middleware/refundAbuseGuard.js';
import { recordDeviceLink, strongDeviceId } from '../services/deviceLink.service.js';
import { flagReviewIfSuspicious, flagListingIfSuspicious } from '../services/contentFraud.service.js';
import { raisePaymentTamperAlarm } from '../services/paymentTamper.service.js';
import {
  searchCatalog, findCatalogDuplicate, normalizeProductKey, resolveCanonicalProductId,
} from '../services/catalogMatch.service.js';
import {
  getProductBuyBox, rankOffersForVariant, cheapestOfferByProduct, listingGeoWhere,
  invalidateBuyBox, syncListingStockStatus,
} from '../services/buyBox.service.js';
import { transitionTimestampFor } from '../services/sellerMetrics.service.js';
import { getSetting } from '../services/settings.service.js';
import { idempotency } from '../middleware/idempotency.js';
import {
  buildQuote, isQuoteCheckoutable, orderTotalsFromQuote, orderItemExtrasFromQuote, QUOTE_ISSUES,
} from '../services/shopPricing.service.js';
import {
  evaluateSaleEligibility, complianceIssuesFrom, getProductSafetyPanel,
} from '../services/shopCompliance.service.js';
import { checkProductServiceability, normalizePincode } from '../services/serviceability.service.js';
import {
  createIntent, findIntent, markIntentPaid, markIntentFailed, attachOrderToIntent,
  receiptFor, intentPublicStatus,
} from '../services/shopPayment.service.js';
import {
  holdStock, heldFor, consumeReservations, releaseReservations, reservationConfig,
} from '../services/stockReservation.service.js';
import { recordEvent, SHOP_EVENTS } from '../services/shopMetrics.service.js';
import { ENV } from '../config/env.js';

const router = Router();
router.param('id', uuidParamGuard);        // product / order id
router.param('productId', uuidParamGuard);
router.param('listingId', uuidParamGuard);
// PUT /seller/orders/:orderId/status used to 500 on a non-UUID instead of 400,
// because :orderId was never registered as a guarded param.
router.param('orderId', uuidParamGuard);

const SELLER_ROLES = ['SELLER', 'VERIFIED_FARMER', 'ADMIN'];

// ── Authoritative pricing helpers ─────────────────────────────────────────────
// Cart totals are ALWAYS recomputed server-side from the DB — the client's number
// is never trusted. When the client also sends the total it displayed
// (`expectedTotal`), assertClientTotalMatches REJECTS the checkout on any
// disagreement: a tampered client understating the total, or plain price drift
// since the cart was last viewed. Compared in integer paise.
const toPaise = (amount) => toMinorUnits(amount, 100);

/**
 * Sum loaded cart rows exactly in Decimal.
 * Price comes from the LISTING — the offer the buyer actually chose. DUAL-READ:
 * falls back to the legacy product price for rows written before the backfill.
 */
const cartTotal = (cartItems) =>
  cartItems.reduce((sum, i) => sum.plus(D(i.listing?.sellingPrice ?? i.product?.price).times(i.quantity)), D(0));

// REMOVED: cartTotalFromDB().
// It aggregated the goods subtotal in one query and was the amount /orders/initiate
// raised the Razorpay order for — which is precisely the bug: the app displayed
// subtotal + a client-side ₹49 delivery fee and the gateway charged the subtotal.
// The payable is now the QUOTE's total (shopPricing.service.js), so a second,
// parallel definition of "the amount" is exactly what must not exist here.

function assertClientTotalMatches(expectedTotal, authoritativeTotal) {
  if (expectedTotal === undefined || expectedTotal === null) return;
  if (toPaise(expectedTotal) !== toPaise(authoritativeTotal)) {
    throw Object.assign(
      new Error('Cart total has changed. Please review your cart and try again.'),
      { statusCode: 400, expose: true, tamper: { kind: 'client_total_mismatch', expectedPaise: toPaise(expectedTotal), actualPaise: toPaise(authoritativeTotal) } },
    );
  }
}

// ── Listing cache namespaces + short TTLs ─────────────────────────────────────
const NS_CATEGORIES = 'agristore:categories';
const NS_PRODUCTS   = 'agristore:products';
const CATEGORIES_TTL = 300;
const PRODUCTS_TTL   = 60;

/** Invalidate everything a listing write can affect. */
async function invalidateCatalogCaches() {
  await Promise.all([bumpListingVersion(NS_PRODUCTS), invalidateBuyBox()]);
}

/**
 * The buyer's geography, which gates buy-box eligibility.
 *
 * Query-param driven, exactly like the pre-split `?district=` filter — req.user is
 * `{ id, role }` only, so there is no district on the token and loading the user
 * row would add a query to every catalogue read. The apps already send it.
 */
function buyerScope(req) {
  const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    district: pick(req.query.district),
    taluka:   pick(req.query.taluka),
    village:  pick(req.query.village),
    state:    pick(req.query.state),
  };
}

/** Shape one listing for the client: the offer plus who is behind it. */
function toOffer(l) {
  return {
    listingId: l.id,
    variantId: l.variantId,
    sellerId:  l.sellerId,
    sellerName: l.seller?.name || null,
    sellerDistrict: l.seller?.district || null,
    sellerState: l.seller?.state || null,
    sellerRating: l.sellerRating ?? l.rating ?? 0,
    sellerRatingCount: l.sellerRatingCount ?? l.ratingCount ?? 0,
    price: l.sellingPrice,
    mrp: l.mrp,
    stock: l.stockQty,
    condition: l.condition,
    dispatchSlaDays: l.dispatchSlaDays,
    minOrderQty: l.minOrderQty,
    harvestDate: l.harvestDate,
    images: l.images || [],
    district: l.district,
    taluka: l.taluka,
    village: l.village,
    state: l.state,
    isFeatured: l.isFeatured,
    buyBoxScore: l.buyBoxScore ?? null,
    scoreParts: l.scoreParts ?? undefined,
  };
}

/**
 * Attach offer data to catalog rows for list screens.
 *
 * DUAL-READ: a product with no variants yet keeps its legacy price/stock/unit so
 * the storefront renders normally during the migration.
 */
async function decorateWithOffers(products, buyer) {
  if (!products.length) return products;
  const summary = await cheapestOfferByProduct(products.map((p) => p.id), buyer);
  for (const p of products) {
    const s = summary.get(p.id);
    if (s && s.offerCount > 0) {
      // A card shows a PRICE, so it shows the cheapest ELIGIBLE offer — cheapest
      // among sellers who can actually deliver to this buyer. Not a buy-box
      // score: ranking sellers is a product-page question, not a card question.
      p.price = s.lowestPrice;
      p.mrp = s.lowestMrp;
      p.stock = s.totalStock;
      p.lowestPrice = s.lowestPrice;
      p.offerCount = s.offerCount;
      p.sellerCount = s.sellerCount;
    } else {
      p.offerCount = 0;
      p.sellerCount = p.sellerId ? 1 : 0; // DUAL-READ: legacy fused row
      p.lowestPrice = p.price ?? null;
    }
  }
  return products;
}

// ── Categories (public, cached) ───────────────────────────────────────────────
/**
 * Category master data, now with SUBCATEGORIES.
 *
 * `products.subcategory` was a free-text string typed by whichever seller created
 * the row, so the app had no list to filter by and an admin could not rename,
 * reorder or retire one. Subcategories are rows now; the string column stays
 * dual-written so existing filters keep working.
 *
 * `attributeSchema` tells the app which dynamic form / detail sections to render
 * for the category — so adding "Sprayers" with its own fields is an admin edit
 * rather than an app release.
 */
router.get('/categories', async (_req, res) => {
  const { data, cached } = await cachedListing(NS_CATEGORIES, 'v2:all', CATEGORIES_TTL, async () => ({
    data: await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        subcategories: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, nameHi: true, nameMr: true, icon: true, attributeSchema: true },
        },
      },
    }),
  }));
  res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
  return sendSuccess(res, data);
});

// ── Storefront product list (public) ──────────────────────────────────────────
/**
 * CARD FIELDS ONLY.
 *
 * The list used to return the full `products` row — description, specifications,
 * highlights, tags, normalizedKey, every QC column — for 40 rows at a time, when
 * a grid card renders six of them. The detail screen refetches by id anyway, so
 * every one of those bytes was paid for on a 2G connection and discarded.
 */
const PRODUCT_CARD_SELECT = {
  id: true, name: true, nameHi: true, nameMr: true,
  images: true, brand: true, rating: true, ratingCount: true,
  categoryId: true, subcategory: true, subcategoryId: true,
  // DUAL-READ: legacy offer columns, still the price source for a product with
  // no listings yet. decorateWithOffers overwrites them when offers exist.
  price: true, mrp: true, stock: true, unit: true, sellerId: true,
  createdAt: true,
  category: { select: { id: true, name: true, icon: true, color: true } },
};

/**
 * Sort options. Each maps to an orderBy the schema has an index for — a sort the
 * database cannot serve is a filesort over the whole result set on every page.
 *
 * `popularity` deliberately uses viewCount, the only real engagement signal that
 * exists. There is no sales counter, so there is no "best seller" sort: inventing
 * one from a rating order would be a fabricated claim about what other farmers
 * bought. `relevance` is rating-ordered for a browse, and similarity-ordered when
 * there is a search term.
 */
const SORTS = {
  relevance:  [{ rating: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  latest:     [{ createdAt: 'desc' }, { id: 'desc' }],
  rating:     [{ rating: 'desc' }, { ratingCount: 'desc' }, { id: 'desc' }],
  popularity: [{ viewCount: 'desc' }, { rating: 'desc' }, { id: 'desc' }],
};
/** Sorts that depend on OFFER data, so they are applied after decoration. */
const OFFER_SORTS = new Set(['price_asc', 'price_desc', 'discount']);

router.get(
  '/products',
  optionalAuth,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('sort').optional().isIn([...Object.keys(SORTS), ...OFFER_SORTS]),
    query('minPrice').optional().isFloat({ min: 0 }),
    query('maxPrice').optional().isFloat({ min: 0 }),
    query('minRating').optional().isFloat({ min: 0, max: 5 }),
    query('inStock').optional().isBoolean(),
    query('verifiedSeller').optional().isBoolean(),
    query('brand').optional().isString().isLength({ max: 100 }),
    query('subcategoryId').optional().isUUID(),
  ],
  validate,
  async (req, res) => {
    const page  = parsePageNumber(req.query.page);
    const limit = parsePageSize(req.query.limit, 20, 50);
    const { category, featured, subcategory, subcategoryId } = req.query;
    const search = sanitizeSearch(req.query.search);
    const buyer  = buyerScope(req);
    const sort   = SORTS[req.query.sort] ? req.query.sort : (OFFER_SORTS.has(req.query.sort) ? req.query.sort : 'relevance');
    const brand  = sanitizeSearch(req.query.brand, 100);
    const minRating = req.query.minRating != null ? Number(req.query.minRating) : null;

    // Catalog-side predicates.
    const and = [{ status: 'APPROVED' }];
    if (category)      and.push({ categoryId: category });
    if (subcategoryId) and.push({ subcategoryId });
    else if (subcategory) and.push({ subcategory });
    if (brand)         and.push({ brand: { contains: brand, mode: 'insensitive' } });
    if (minRating)     and.push({ rating: { gte: minRating } });
    if (search) {
      and.push({
        OR: [
          { name:         { contains: search, mode: 'insensitive' } },
          // Marathi and Hindi names were NOT searchable — a farmer typing
          // "बियाणे" matched nothing, on an app whose whole point is that they
          // can use their own language. Both are indexed columns on the same row.
          { nameMr:       { contains: search, mode: 'insensitive' } },
          { nameHi:       { contains: search, mode: 'insensitive' } },
          { brand:        { contains: search, mode: 'insensitive' } },
          { manufacturer: { contains: search, mode: 'insensitive' } },
          { description:  { contains: search, mode: 'insensitive' } },
          { tags:         { has: search.toLowerCase() } },
        ],
      });
    }

    // Offer-side predicates. Geography now gates at the LISTING level, which is
    // where sellScope/district actually live; the pre-split filter compared them
    // on the fused product row.
    const priceFilter = {};
    if (req.query.minPrice != null) priceFilter.gte = Number(req.query.minPrice);
    if (req.query.maxPrice != null) priceFilter.lte = Number(req.query.maxPrice);

    const listingWhere = {
      status: 'ACTIVE',
      stockQty: { gt: 0 },
      ...(featured ? { isFeatured: true } : {}),
      ...(Object.keys(priceFilter).length ? { sellingPrice: priceFilter } : {}),
      // A "verified seller" badge must come from a platform-controlled field, so
      // the filter reads the seller's KYC state — never a seller-settable flag.
      ...(req.query.verifiedSeller === 'true' ? { seller: { kycStatus: 'VERIFIED' } } : {}),
      ...listingGeoWhere(buyer),
    };
    and.push({
      OR: [
        { variants: { some: { listings: { some: listingWhere } } } },
        // DUAL-READ: not yet migrated — judge it on the legacy columns so it does
        // not vanish from the storefront mid-migration. Price and verified-seller
        // filters cannot be applied to a legacy row's offer, so an explicitly
        // filtered request excludes them rather than returning unfiltered results.
        ...(Object.keys(priceFilter).length || req.query.verifiedSeller === 'true' ? [] : [{
          variants: { none: {} },
          isActive: true,
          ...(featured ? { isFeatured: true } : {}),
          ...(buyer.district ? { OR: [{ district: { equals: buyer.district, mode: 'insensitive' } }, { district: null }] } : {}),
        }]),
      ],
    });

    const where = { AND: and };

    const identity = JSON.stringify([
      category || '', subcategory || '', subcategoryId || '', featured ? 1 : 0,
      buyer.district || '', buyer.taluka || '', buyer.village || '', buyer.state || '',
      search || '', brand || '', minRating || '', req.query.minPrice || '', req.query.maxPrice || '',
      req.query.inStock || '', req.query.verifiedSeller || '', sort, page, limit,
    ]);
    const { data, meta, cached } = await cachedListing(NS_PRODUCTS, identity, PRODUCTS_TTL, async () => {
      // An offer-ordered sort has to see more than one page of candidates before
      // it can order them, because the price lives on a different table. Bounded
      // at 5 pages so a "price low to high" on a broad category cannot turn into
      // an unbounded scan.
      const offerSorted = OFFER_SORTS.has(sort);
      const take = offerSorted ? Math.min(limit * 5, 200) : limit;
      const skip = offerSorted ? 0 : (page - 1) * limit;

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          select: PRODUCT_CARD_SELECT,
          skip,
          take,
          // `id` is the unique tiebreaker. Without it, rows sharing a rating
          // ordered arbitrarily between queries, so offset pages duplicated and
          // skipped rows. isFeatured is no longer a product column post-split —
          // featuring is per-offer and is applied as a FILTER above instead.
          orderBy: SORTS[offerSorted ? 'relevance' : sort],
        }),
        prisma.product.count({ where }),
      ]);

      let decorated = await decorateWithOffers(products, buyer);

      if (req.query.inStock === 'true') decorated = decorated.filter((p) => (p.stock ?? 0) > 0);

      if (offerSorted) {
        const num = (v) => (v == null ? null : Number(v));
        const discountPct = (p) => {
          const mrp = num(p.mrp); const price = num(p.price);
          return mrp && price && mrp > price ? ((mrp - price) / mrp) * 100 : 0;
        };
        decorated.sort((a, b) => {
          if (sort === 'price_asc')  return (num(a.lowestPrice) ?? Infinity) - (num(b.lowestPrice) ?? Infinity);
          if (sort === 'price_desc') return (num(b.lowestPrice) ?? -Infinity) - (num(a.lowestPrice) ?? -Infinity);
          return discountPct(b) - discountPct(a);
        });
        decorated = decorated.slice((page - 1) * limit, page * limit);
      }

      return {
        data: decorated,
        meta: {
          ...paginationMeta(total, page, limit),
          sort,
          // Honest about the bound above, rather than presenting a truncated
          // price sort as if it had ranked the whole catalogue.
          sortScope: offerSorted ? `top ${take} by relevance` : 'full',
        },
      };
    });

    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return sendSuccess(res, data, 200, meta);
  }
);

/**
 * Facets for the filter sheet: the brands and price range that actually exist
 * inside the current category, so the sheet offers real choices instead of a
 * static list that filters to zero results.
 */
router.get(
  '/products/facets',
  [query('category').optional().isUUID()],
  validate,
  async (req, res) => {
    const { category } = req.query;
    const { data, cached } = await cachedListing(NS_PRODUCTS, `facets:${category || 'all'}`, PRODUCTS_TTL, async () => {
      const where = { status: 'APPROVED', ...(category ? { categoryId: category } : {}) };
      const [brands, subcategories, priceRange] = await Promise.all([
        prisma.product.groupBy({
          by: ['brand'],
          where: { ...where, brand: { not: null } },
          _count: { brand: true },
          orderBy: { _count: { brand: 'desc' } },
          take: 40,
        }),
        category
          ? prisma.subcategory.findMany({
              where: { categoryId: category, isActive: true },
              select: { id: true, name: true, nameMr: true, nameHi: true, icon: true },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            })
          : [],
        prisma.sellerListing.aggregate({
          where: {
            status: 'ACTIVE',
            ...(category ? { variant: { product: { categoryId: category } } } : {}),
          },
          _min: { sellingPrice: true },
          _max: { sellingPrice: true },
        }),
      ]);

      return {
        data: {
          brands: brands.filter((b) => b.brand).map((b) => ({ value: b.brand, count: b._count.brand })),
          subcategories,
          priceMin: priceRange._min.sellingPrice != null ? Number(priceRange._min.sellingPrice) : null,
          priceMax: priceRange._max.sellingPrice != null ? Number(priceRange._max.sellingPrice) : null,
          sorts: [...Object.keys(SORTS), ...OFFER_SORTS],
        },
      };
    });

    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return sendSuccess(res, data);
  },
);

// ── Single product: catalog + winning offer ───────────────────────────────────
router.get('/products/:id', optionalAuth, async (req, res) => {
  const buyer = buyerScope(req);

  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: {
      category: true,
      reviews: {
        include: { user: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
  if (!product) return sendNotFound(res, 'Product');

  // A MERGED duplicate redirects to the row it was folded into, so old links,
  // bookmarks and CropReportShare.recommendedProductIds keep resolving.
  if (product.status === 'MERGED' && product.mergedIntoId) {
    const canonical = await resolveCanonicalProductId(product.id);
    if (canonical && canonical !== product.id) {
      return sendSuccess(res, { redirectTo: canonical }, 301);
    }
  }

  // This endpoint had NO auth and NO isActive filter, so a soft-deleted product
  // stayed fetchable by id forever. Only APPROVED catalog rows are public; the
  // seller who owns it and admins can still fetch it while it is in QC.
  const isOwner = req.user && (req.user.id === product.createdBySellerId || req.user.id === product.sellerId);
  const isAdmin = req.user?.role === 'ADMIN';
  if (product.status !== 'APPROVED' && !isOwner && !isAdmin) return sendNotFound(res, 'Product');
  if (product.status === 'APPROVED' && product.isActive === false && !isOwner && !isAdmin) {
    return sendNotFound(res, 'Product'); // DUAL-READ: legacy soft-delete flag
  }

  // Two independent extras, fetched together with the buy box.
  //   safety   — the approved-label panel for a regulated product. NULL for
  //              everything else, so a hand tool renders no chemical sections.
  //   recalls  — an active recall must be visible ON the page, not only enforced
  //              at add-to-cart.
  const [buyBox, safety, activeRecall] = await Promise.all([
    getProductBuyBox(product.id, buyer),
    getProductSafetyPanel(product.id),
    prisma.productRecall.findFirst({
      where: { productId: product.id, isActive: true },
      select: { reason: true, advice: true, severity: true, batchNumber: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return sendSuccess(res, {
    ...product,
    variants: buyBox.variants,
    offerCount: buyBox.offerCount,
    lowestPrice: buyBox.lowestPrice,
    // Everything here is transcribed from the approved manufacturer label and
    // reviewed. The platform authors none of it — see shopCompliance.service.js.
    safety,
    recall: activeRecall
      ? { active: true, severity: activeRecall.severity, reason: activeRecall.reason, advice: activeRecall.advice, batchNumber: activeRecall.batchNumber }
      : null,
    // The winning offer. Everything price-shaped on the buyer's product page —
    // the ₹ headline, the struck MRP, "You save", the qty cap — reads off THIS,
    // never off the catalog row.
    buyBox: buyBox.winner ? toOffer(buyBox.winner) : null,
    // DUAL-READ: no listings yet → surface the legacy offer so the page renders.
    legacyOffer: buyBox.winner ? null : {
      price: product.price, mrp: product.mrp, stock: product.stock,
      unit: product.unit, minOrderQty: product.minOrderQty, sellerId: product.sellerId,
    },
  });
});

/**
 * "Will it reach my PIN code, and by when?"
 *
 * The product page rendered a "Delivery — coming soon" placeholder because there
 * was nothing to ask. Public: a delivery estimate for a public catalogue entry
 * is not private, and requiring login to see one would push farmers into an
 * account before they know whether the shop serves their village at all.
 */
router.get(
  '/products/:id/serviceability',
  [query('pincode').isString().isLength({ min: 6, max: 6 })],
  validate,
  async (req, res) => {
    const pincode = normalizePincode(req.query.pincode);
    if (!pincode) {
      return sendError(res, 'Enter a valid 6-digit PIN code.', 400, { reason: 'INVALID_PINCODE' });
    }
    const productId = await resolveCanonicalProductId(req.params.id);
    if (!productId) return sendNotFound(res, 'Product');

    const result = await checkProductServiceability({ productId, pincode });
    return sendSuccess(res, { pincode, ...result });
  },
);

/**
 * Paginated reviews for a product.
 *
 * GET /products/:id returned the 10 most recent reviews inline on EVERY product
 * fetch — joined to users, on a payload the detail screen re-requests on each
 * open — and there was no way to see the eleventh. Reviews move to their own
 * keyset-paginated endpoint and the inline block shrinks to a summary.
 */
router.get(
  '/products/:id/reviews',
  [query('limit').optional().isInt({ min: 1, max: 50 })],
  validate,
  async (req, res) => {
    const productId = await resolveCanonicalProductId(req.params.id);
    if (!productId) return sendNotFound(res, 'Product');

    const limit = parsePageSize(req.query.limit, 10, 50);
    const { items, nextCursor, hasMore } = await keysetPage(prisma, {
      table: 'reviews', filterColumn: 'productId', filterValue: productId,
      cursor: req.query.cursor, limit,
      hydrate: (ids) => prisma.review.findMany({
        where: { id: { in: ids } },
        // `avatar` and first name only — a review must never expose the reviewer's
        // phone number, district or anything else the User row carries.
        include: { user: { select: { id: true, name: true, avatar: true } } },
      }),
    });

    // The star distribution, computed in ONE grouped query rather than by
    // counting five separate filters.
    const buckets = await prisma.review.groupBy({
      by: ['rating'],
      where: { productId },
      _count: { rating: true },
    });
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0; let weighted = 0;
    for (const b of buckets) {
      distribution[b.rating] = b._count.rating;
      total += b._count.rating;
      weighted += b.rating * b._count.rating;
    }

    return sendSuccess(
      res,
      {
        reviews: items.map((r) => ({
          id: r.id, rating: r.rating, comment: r.comment, createdAt: r.createdAt,
          // Verified-purchase is a fact about the review, and the review can only
          // exist against a DELIVERED order item — so it is always true here.
          // Stated explicitly rather than implied.
          verifiedPurchase: !!r.orderItemId,
          user: { id: r.user?.id, name: r.user?.name || null, avatar: r.user?.avatar || null },
        })),
        summary: {
          average: total ? Number((weighted / total).toFixed(2)) : 0,
          count: total,
          distribution,
        },
      },
      200,
      { limit, nextCursor, hasMore },
    );
  },
);

// ── Every eligible offer for a product, buy-box order ─────────────────────────
router.get('/products/:id/offers', optionalAuth, async (req, res) => {
  const buyer = buyerScope(req);
  const productId = await resolveCanonicalProductId(req.params.id);
  if (!productId) return sendNotFound(res, 'Product');

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true, attributes: true, unit: true, gtin: true, sku: true, isDefault: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  const wanted = req.query.variantId
    ? variants.filter((v) => v.id === req.query.variantId)
    : variants;

  const groups = await Promise.all(wanted.map(async (v) => {
    const { offers } = await rankOffersForVariant(v.id, buyer);
    return {
      variant: v,
      offers: offers.map(toOffer),
      winnerListingId: offers[0]?.id ?? null,
      lowestPrice: offers.length ? Math.min(...offers.map((o) => Number(o.sellingPrice))) : null,
    };
  }));

  return sendSuccess(res, {
    productId,
    variants: groups,
    totalOffers: groups.reduce((s, g) => s + g.offers.length, 0),
  });
});

/**
 * Can this build actually take an online payment?
 *
 * The app used to render UPI and Card tiles unconditionally, then post the
 * chosen method to POST /orders — which creates an order and never asks for
 * money. A farmer picked UPI, saw "Order Placed!" with a UPI badge, and nothing
 * was ever charged. Offering a payment method the server cannot collect with is
 * the worst kind of broken: it looks like it worked.
 *
 * The app now asks first and only shows what can actually be collected.
 *
 * `keyId` is Razorpay's PUBLISHABLE key — it is designed to sit in a client and
 * identifies the merchant when opening checkout. The SECRET never leaves the
 * server, and the payment signature is verified server-side, so a tampered
 * client cannot manufacture a paid order.
 */
router.get('/payment-config', authenticate, async (_req, res) => {
  const mock = isMockPayments();
  return sendSuccess(res, {
    // False whenever the gateway is unconfigured (no keys) — in that state the
    // app must fall back to cash on delivery rather than opening a checkout
    // sheet that cannot complete.
    onlineEnabled: !mock,
    provider: 'razorpay',
    keyId: mock ? null : ENV.RAZORPAY_KEY_ID,
    methods: mock ? ['cod'] : ['cod', 'upi', 'card'],
  });
});

// ── Cart ──────────────────────────────────────────────────────────────────────
// The variant's product select carries the four columns the QUOTE needs
// (categoryId for the return rules, taxRatePct for the tax split, shippingClass
// and weightKg for the delivery band). Without them the pricing service silently
// falls back to defaults and quotes a fee for a rotavator as if it were a seed
// packet.
const CART_INCLUDE = {
  // DUAL-READ: `product` is still included so pre-backfill rows render.
  product: { include: { category: { select: { name: true } } } },
  listing: {
    include: {
      seller: { select: { id: true, name: true, district: true, state: true } },
      variant: {
        include: {
          product: {
            select: {
              id: true, name: true, nameHi: true, nameMr: true, images: true, brand: true,
              categoryId: true, taxRatePct: true, shippingClass: true, weightKg: true,
            },
          },
        },
      },
    },
  },
};

/**
 * Load the cart and price it authoritatively.
 *
 * Every screen that shows a number — cart, checkout, the payment sheet — reads
 * THIS. The app no longer computes a delivery fee, a tax, or a grand total; it
 * had a hard-coded `total >= 999 ? 0 : 49` that the server never saw, so the
 * amount the farmer approved and the amount recorded on the order were different
 * numbers.
 */
async function loadPricedCart(userId, { paymentMethod = 'cod', pincode = null, buyer = {}, reservedByListing = null } = {}) {
  const items = await prisma.cartItem.findMany({
    where: { userId },
    include: CART_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });

  // Compliance is evaluated for the whole cart in one batched pass — five
  // queries regardless of cart size — and its refusals become quote issues, so a
  // blocked chemical is visible on the cart screen rather than at the payment
  // sheet.
  const complianceLines = items
    .filter((i) => i.listingId && i.listing)
    .map((i) => ({
      listingId: i.listingId,
      sellerId: i.listing.sellerId,
      productId: i.listing.variant?.productId || i.productId,
      categoryId: i.listing.variant?.product?.categoryId || null,
      quantity: i.quantity,
    }));

  const eligibility = complianceLines.length
    ? await evaluateSaleEligibility({ lines: complianceLines, buyer })
    : new Map();

  const namesByListing = new Map(
    items.filter((i) => i.listingId).map((i) => [i.listingId, { name: i.listing?.variant?.product?.name || i.product?.name }]),
  );

  const quote = await buildQuote({
    cartItems: items,
    paymentMethod,
    pincode,
    complianceIssues: complianceIssuesFrom(eligibility, namesByListing),
    reservedByListing,
  });

  return { items, quote, eligibility };
}

router.get('/cart', authenticate, async (req, res) => {
  const { items, quote } = await loadPricedCart(req.user.id, {
    paymentMethod: req.query.paymentMethod === 'online' ? 'online' : 'cod',
    pincode: normalizePincode(req.query.pincode),
    buyer: buyerScope(req),
  });

  // Surface price drift since the line was added, rather than silently
  // re-pricing it. The buyer sees it here and again at checkout.
  const withDrift = items.map((i) => {
    const live = i.listing ? D(i.listing.sellingPrice) : D(i.product?.price);
    const snap = i.unitPriceSnapshot != null ? D(i.unitPriceSnapshot) : null;
    return {
      ...i,
      unitPrice: live,
      priceChanged: snap ? !snap.equals(live) : false,
      previousPrice: snap && !snap.equals(live) ? snap : null,
    };
  });

  // `total` keeps its old meaning (goods subtotal) so an un-upgraded app build
  // renders exactly what it does today; `quote` is the new, complete answer.
  return sendSuccess(res, { items: withDrift, total: cartTotal(items), quote });
});

/**
 * The authoritative quote for the current cart.
 *
 * Separate from GET /cart because checkout needs to re-price as the buyer changes
 * payment method and delivery PIN code, without re-fetching every cart row's
 * images and specs on each keystroke.
 */
router.get(
  '/cart/quote',
  authenticate,
  [
    query('paymentMethod').optional().isIn(['cod', 'upi', 'card', 'online']),
    query('pincode').optional().isString().isLength({ max: 10 }),
  ],
  validate,
  async (req, res) => {
    const { quote } = await loadPricedCart(req.user.id, {
      paymentMethod: req.query.paymentMethod || 'cod',
      pincode: normalizePincode(req.query.pincode),
      buyer: buyerScope(req),
    });
    recordEvent(SHOP_EVENTS.QUOTE_OK);
    return sendSuccess(res, quote);
  },
);

/**
 * Resolve what the client asked to add.
 * `listingId` is the real key. `productId` is accepted for older clients and for
 * "Add to cart" straight off a product card: it resolves to that product's
 * buy-box winner, which is exactly what the card was showing a price for.
 */
async function resolveCartTarget({ listingId, productId, variantId, buyer }) {
  if (listingId) {
    const listing = await prisma.sellerListing.findUnique({
      where: { id: listingId },
      include: { variant: { select: { id: true, productId: true } } },
    });
    return listing || null;
  }
  if (!productId) return null;
  const canonical = await resolveCanonicalProductId(productId);
  if (!canonical) return null;
  if (variantId) {
    const { winner } = await rankOffersForVariant(variantId, buyer);
    return winner || null;
  }
  const { winner } = await getProductBuyBox(canonical, buyer);
  if (!winner) return null;
  return prisma.sellerListing.findUnique({
    where: { id: winner.id },
    include: { variant: { select: { id: true, productId: true } } },
  });
}

/**
 * DUAL-READ cart add for a product with no offers yet (pre-backfill). Validates
 * and prices off the legacy columns, keyed on productId as it always was.
 * Deleted at CONTRACT along with cart_items.productId.
 */
async function addLegacyProductToCart(req, res, productId, quantity) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: { select: { id: true }, take: 1 } },
  });
  // Only rows that genuinely predate the split take this path. A migrated product
  // with variants but no eligible offer is a real "no seller here" 404.
  if (!product || product.variants.length) return null;
  if (product.isActive === false || product.status !== 'APPROVED') return sendNotFound(res, 'Product');

  const existing = await prisma.cartItem.findFirst({ where: { userId: req.user.id, productId, listingId: null } });
  const totalAfter = (existing?.quantity || 0) + quantity;
  if (totalAfter < product.minOrderQty) {
    return sendError(res, `This seller's minimum order is ${product.minOrderQty}`, 400);
  }
  if (product.stock < totalAfter) return sendError(res, `Only ${product.stock} in stock`, 400);

  const item = existing
    ? await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: totalAfter, unitPriceSnapshot: product.price },
        include: CART_INCLUDE,
      })
    : await prisma.cartItem.create({
        data: { userId: req.user.id, productId, quantity, unitPriceSnapshot: product.price },
        include: CART_INCLUDE,
      });

  return sendCreated(res, item);
}

router.post(
  '/cart',
  authenticate,
  [
    body('listingId').optional().isUUID(),
    body('productId').optional().isUUID(),
    body('variantId').optional().isUUID(),
    body('quantity').isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    const { listingId, productId, variantId, quantity } = req.body;
    if (!listingId && !productId) return sendError(res, 'listingId or productId is required', 400);

    const target = await resolveCartTarget({ listingId, productId, variantId, buyer: buyerScope(req) });

    // DUAL-READ: a product that has not been backfilled yet has no variants and
    // therefore no offers, so there is no listing to resolve. Without this branch
    // every pre-backfill product becomes unbuyable the moment this code deploys —
    // the storefront would still show it and Add to Cart would 404.
    if (!target && productId) {
      const legacy = await addLegacyProductToCart(req, res, productId, quantity);
      if (legacy) return legacy;
    }

    if (!target) return sendNotFound(res, 'Offer');
    if (target.status !== 'ACTIVE') return sendError(res, 'This offer is no longer available', 400);

    // Compliance gate, at the FIRST point the buyer commits to an item. Refusing
    // an expired, recalled, unlicensed or region-blocked chemical here — rather
    // than at the payment sheet — is the difference between a clear "choose
    // another seller" and a farmer discovering it after entering their address.
    {
      const productId2 = target.variant?.productId ?? productId;
      const category = productId2
        ? await prisma.product.findUnique({ where: { id: productId2 }, select: { categoryId: true } })
        : null;
      const verdicts = await evaluateSaleEligibility({
        lines: [{
          listingId: target.id, sellerId: target.sellerId,
          productId: productId2, categoryId: category?.categoryId || null, quantity,
        }],
        buyer: buyerScope(req),
      });
      const verdict = verdicts.get(target.id);
      if (verdict && !verdict.allowed) {
        recordEvent(SHOP_EVENTS.CART_ADD_BLOCKED_COMPLIANCE);
        recordEvent(SHOP_EVENTS.CART_ADD_FAIL);
        return sendError(res, verdict.message, 409, { reason: verdict.code });
      }
    }

    try {
      // The add used to be check-then-upsert across two statements, so two
      // concurrent adds could both pass the stock check and over-fill the cart.
      // Read + validate + write now share one transaction.
      const item = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        const fresh = await tx.sellerListing.findUnique({ where: { id: target.id } });
        if (!fresh || fresh.status !== 'ACTIVE') {
          throw Object.assign(new Error('This offer is no longer available'), { statusCode: 400, expose: true });
        }

        const existing = await tx.cartItem.findUnique({
          where: { userId_listingId: { userId: req.user.id, listingId: fresh.id } },
        });
        const totalAfter = (existing?.quantity || 0) + quantity;

        // minOrderQty was stored on every create/update and read by NOTHING —
        // quantity was bounded only by the 1..100 validator and by stock. A
        // Kendra that sells seed by the 5-packet carton had no way to enforce it.
        if (totalAfter < fresh.minOrderQty) {
          throw Object.assign(
            new Error(`This seller's minimum order is ${fresh.minOrderQty}`),
            { statusCode: 400, expose: true },
          );
        }
        if (fresh.stockQty < totalAfter) {
          // The out-of-stock RATE the brief asks for: a rising value means the
          // catalogue is advertising stock it does not have.
          recordEvent(SHOP_EVENTS.OUT_OF_STOCK_HIT);
          throw Object.assign(new Error(`Only ${fresh.stockQty} in stock`), { statusCode: 400, expose: true });
        }

        return tx.cartItem.upsert({
          where: { userId_listingId: { userId: req.user.id, listingId: fresh.id } },
          create: {
            userId: req.user.id,
            listingId: fresh.id,
            // DUAL-READ: productId is still NOT NULL until CONTRACT.
            productId: target.variant?.productId ?? productId,
            quantity,
            unitPriceSnapshot: fresh.sellingPrice,
          },
          update: { quantity: { increment: quantity }, unitPriceSnapshot: fresh.sellingPrice },
          include: CART_INCLUDE,
        });
      }, { isolationLevel: 'Serializable' }));

      recordEvent(SHOP_EVENTS.CART_ADD_OK);
      return sendCreated(res, item);
    } catch (err) {
      recordEvent(SHOP_EVENTS.CART_ADD_FAIL);
      return sendServerError(res, err, 'Could not add to cart. Please try again.');
    }
  }
);

/** Find a cart row by listing id, falling back to product id for older clients. */
async function findCartRow(userId, key) {
  return (
    (await prisma.cartItem.findFirst({ where: { userId, listingId: key } })) ||
    (await prisma.cartItem.findFirst({ where: { userId, productId: key } }))
  );
}

router.put(
  '/cart/:listingId',
  authenticate,
  [body('quantity').isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    const row = await findCartRow(req.user.id, req.params.listingId);
    if (!row) return sendNotFound(res, 'Cart item');

    const listing = row.listingId
      ? await prisma.sellerListing.findUnique({ where: { id: row.listingId } })
      : null;

    if (listing) {
      if (listing.status !== 'ACTIVE') return sendError(res, 'This offer is no longer available', 400);
      if (req.body.quantity < listing.minOrderQty) {
        return sendError(res, `This seller's minimum order is ${listing.minOrderQty}`, 400);
      }
      if (listing.stockQty < req.body.quantity) return sendError(res, `Only ${listing.stockQty} in stock`, 400);
    } else {
      // DUAL-READ
      const product = await prisma.product.findUnique({ where: { id: row.productId } });
      if (!product || product.isActive === false) return sendNotFound(res, 'Product');
      if (product.stock < req.body.quantity) return sendError(res, `Only ${product.stock} in stock`, 400);
    }

    await prisma.cartItem.update({ where: { id: row.id }, data: { quantity: req.body.quantity } });
    return sendSuccess(res, { updated: true });
  }
);

router.delete('/cart/:listingId', authenticate, async (req, res) => {
  const row = await findCartRow(req.user.id, req.params.listingId);
  if (!row) return sendSuccess(res, { deleted: true }); // idempotent
  await prisma.cartItem.delete({ where: { id: row.id } });
  return sendSuccess(res, { deleted: true });
});

// ── Checkout ──────────────────────────────────────────────────────────────────
/**
 * Load the cart and validate every line against the LIVE listing, inside `tx`.
 * Returns the rows plus the OrderItem payloads, so both checkout paths build the
 * order identically.
 */
/**
 * The cart the order is written from must be the cart the quote priced.
 *
 * Compliance and pricing run BEFORE the Serializable transaction opens, to keep
 * the lock window short. That leaves a gap in which the buyer could add a line
 * from another device — and the order would then contain an item the quote never
 * charged for. Comparing the two baskets closes it: same lines, same quantities,
 * same unit prices, or the checkout refuses and re-quotes.
 *
 * Compared on (listing|product, qty, price) rather than on the quote fingerprint
 * so the error can name what changed.
 */
function assertCartMatchesQuote(orderItems, quote) {
  const key = (listingId, productId, qty, price) => `${listingId || productId}:${qty}:${D(price).toFixed(2)}`;
  const quoted = new Set(
    (quote.shipments || []).flatMap((s) => s.items).map((i) => key(i.listingId, i.productId, i.quantity, i.unitPrice)),
  );
  const actual = orderItems.map((i) => key(i.listingId, i.productId, i.quantity, i.unitPrice));

  if (actual.length !== quoted.size || actual.some((k) => !quoted.has(k))) {
    throw Object.assign(
      new Error('Your cart changed while you were checking out. Please review it and try again.'),
      { statusCode: 409, expose: true, code: 'CART_CHANGED' },
    );
  }
}

/**
 * @param {Map<string,number>} [reservedByListing]
 *   Units this checkout is ALREADY holding for each listing. They have been
 *   decremented from `stockQty` at /orders/initiate, so the availability check
 *   below has to add them back — otherwise the buyer who reserved the last unit
 *   is told at confirm that the last unit is gone, which is exactly the failure
 *   the reservation exists to prevent.
 */
async function validateCartForCheckout(tx, userId, { reservedByListing = null } = {}) {
  const cartItems = await tx.cartItem.findMany({
    where: { userId },
    include: {
      product: true,
      listing: { include: { variant: { select: { id: true, productId: true } } } },
    },
  });
  if (!cartItems.length) {
    throw Object.assign(new Error('Cart is empty'), { statusCode: 400, expose: true });
  }

  const listingIds = cartItems.map((i) => i.listingId).filter(Boolean);
  const fresh = listingIds.length
    ? await tx.sellerListing.findMany({ where: { id: { in: listingIds } } })
    : [];
  const freshById = new Map(fresh.map((l) => [l.id, l]));

  const orderItems = [];
  const deltas = [];
  // Pre-backfill lines, whose stock lives on products.stock rather than on a
  // seller_listing. Collected separately because the two are different tables
  // and different statements — see utils/stockBatch.js.
  const productDeltas = [];

  for (const item of cartItems) {
    const label = item.listing?.variant?.productId ? item.product?.name : item.product?.name;

    if (item.listingId) {
      const l = freshById.get(item.listingId);
      // Units this checkout already holds count as available TO THIS CHECKOUT.
      const alreadyHeld = (l && reservedByListing?.get(l.id)) || 0;
      // OUT_OF_STOCK is DERIVED from stockQty hitting zero, so a buyer who
      // reserved the last unit puts the listing into it themselves. Their own
      // hold has to be allowed through, or the reservation locks them out of the
      // purchase it exists to protect. INACTIVE and BLOCKED never pass — those
      // are seller and trust-and-safety decisions, not stock arithmetic.
      const passableForHolder = alreadyHeld > 0 && l?.status === 'OUT_OF_STOCK';
      if (!l || (l.status !== 'ACTIVE' && !passableForHolder)) {
        throw Object.assign(new Error(`"${label}" is no longer available from this seller`), { statusCode: 400, expose: true });
      }
      if (l.stockQty + alreadyHeld < item.quantity) {
        throw Object.assign(new Error(`Insufficient stock for ${label}`), { statusCode: 400, expose: true });
      }
      if (item.quantity < l.minOrderQty) {
        throw Object.assign(new Error(`Minimum order for ${label} is ${l.minOrderQty}`), { statusCode: 400, expose: true });
      }
      // Revalidate price against the live listing and surface any difference
      // rather than charging the snapshot.
      if (item.unitPriceSnapshot != null && !D(item.unitPriceSnapshot).equals(D(l.sellingPrice))) {
        throw Object.assign(
          new Error(`The price of "${label}" changed from ₹${D(item.unitPriceSnapshot)} to ₹${D(l.sellingPrice)}. Please review your cart.`),
          { statusCode: 409, expose: true },
        );
      }
      orderItems.push({
        cartItemId: item.id,   // join key for the quote's snapshot fields; stripped before create
        productId:  item.listing.variant.productId,
        listingId:  l.id,
        variantId:  l.variantId,
        sellerId:   l.sellerId,
        quantity:   item.quantity,
        unitPrice:  l.sellingPrice,
        totalPrice: D(l.sellingPrice).times(item.quantity),
      });
      deltas.push({ listingId: l.id, delta: -item.quantity });
    } else {
      // DUAL-READ: pre-backfill row. Validated and priced off the legacy columns.
      const p = await tx.product.findUnique({ where: { id: item.productId } });
      if (!p || p.isActive === false) {
        throw Object.assign(new Error(`Product "${label}" is no longer available`), { statusCode: 400, expose: true });
      }
      if (p.stock < item.quantity) {
        throw Object.assign(new Error(`Insufficient stock for ${p.name}`), { statusCode: 400, expose: true });
      }
      orderItems.push({
        cartItemId: item.id,
        productId: p.id, listingId: null, variantId: null, sellerId: p.sellerId || null,
        quantity: item.quantity, unitPrice: p.price, totalPrice: D(p.price).times(item.quantity),
      });
      // The line above validated p.stock and then, until now, recorded no
      // decrement anywhere — so the check ran against a number no order ever
      // moved, and the last unit of a pre-backfill product could be sold over
      // and over. The listing branch has always pushed its delta; this one
      // simply never did.
      productDeltas.push({ productId: p.id, delta: -item.quantity });
    }
  }

  return { cartItems, orderItems, deltas, productDeltas, total: cartTotal(cartItems) };
}

/**
 * Merge the quote's frozen snapshot onto each order item and drop the join key.
 *
 * The snapshot is why an order from 2024 still renders correctly after the
 * catalog row was renamed, re-photographed or merged — order history used to
 * JOIN products for the name and image, so an admin edit silently rewrote what a
 * farmer's past order said they had bought.
 */
function withOrderItemSnapshots(orderItems, quote, eligibility) {
  const extras = orderItemExtrasFromQuote(quote);
  return orderItems.map(({ cartItemId, ...item }) => {
    const extra = extras.get(cartItemId) || {};
    const verdict = item.listingId ? eligibility?.get(item.listingId) : null;
    return {
      ...item,
      ...extra,
      // Which physical lot was allocated, and which label revision was in force.
      // Without these a recall cannot identify its buyers and the safety text
      // shown at purchase is unreproducible.
      batchNumber: verdict?.batch?.batchNumber ?? null,
      batchExpiry: verdict?.batch?.expiryDate ?? null,
      labelVersion: verdict?.labelVersion ?? null,
    };
  });
}

async function resolveDeliveryAddress(req) {
  let { deliveryAddress, deliveryAddressId } = req.body;
  if (deliveryAddressId) {
    const saved = await prisma.savedAddress.findFirst({
      where: { id: deliveryAddressId, userId: req.user.id },
    });
    if (!saved) throw Object.assign(new Error('Saved address not found'), { statusCode: 400, expose: true });
    deliveryAddress = {
      type: saved.type, name: saved.name, phone: saved.phone,
      flat: saved.flat, street: saved.street, city: saved.city,
      state: saved.state, pincode: saved.pincode,
      ...(saved.landmark ? { landmark: saved.landmark } : {}),
    };
  }
  if (!deliveryAddress || typeof deliveryAddress !== 'object') {
    throw Object.assign(new Error('deliveryAddress or deliveryAddressId is required'), { statusCode: 400, expose: true });
  }

  // An INLINE address (as opposed to a saved one) used to be checked for
  // PRESENCE only. POST /addresses validates properly — 6-digit pincode, length
  // caps — but that validation was bypassed entirely by posting the object
  // straight to checkout. A pincode of "abc" or a 10 KB city string was accepted,
  // landed in the order JSON, and silently nulled `deliveryPincode`, which made
  // serviceability skip without saying why.
  //
  // Same rules as the saved-address route, so an address is validated the same
  // way whichever door it comes through.
  const FIELD_MAX = { name: 100, phone: 20, flat: 100, street: 200, city: 100, state: 100, landmark: 200 };
  const bad = (msg) => Object.assign(new Error(msg), { statusCode: 400, expose: true });

  const { name, phone, city, state, pincode } = deliveryAddress;
  if (!name || !phone || !city || !state || !pincode) {
    throw bad('Delivery address must include name, phone, city, state, and pincode');
  }
  for (const [field, max] of Object.entries(FIELD_MAX)) {
    const v = deliveryAddress[field];
    if (v != null && String(v).length > max) {
      throw bad(`Delivery address ${field} is too long (maximum ${max} characters).`);
    }
  }
  if (!/^[1-9][0-9]{5}$/.test(String(pincode).trim())) {
    throw bad('Enter a valid 6-digit PIN code for delivery.');
  }
  // 10 digits, starting 6–9 — the same shape the app's own validator enforces.
  if (!/^[6-9][0-9]{9}$/.test(String(phone).replace(/\D/g, '').slice(-10))) {
    throw bad('Enter a valid 10-digit mobile number for delivery.');
  }

  return deepStripHtml({ ...deliveryAddress, pincode: String(pincode).trim() });
}

/**
 * Idempotency for order creation.
 *
 * COD checkout had NO protection at all: the client attached an Idempotency-Key
 * only to /farms, /cycles and /animals, and this route never looked for one. A
 * double-tap on "Place Order" — or the axios 401-refresh replay, or a retry after
 * a timeout on a village connection — created a SECOND order and decremented
 * stock twice. The online path was accidentally covered by the unique on
 * `paymentRef`; the cash path, which is the one most farmers use, was not.
 */
const idemOrder = idempotency('shop_order');

router.post(
  '/orders',
  authenticate,
  velocityGuard(VELOCITY_ACTIONS.ORDER),
  idemOrder,
  [
    body('paymentMethod').optional().isIn(['cod', 'upi', 'card']),
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
    body('expectedTotal').optional().isFloat({ min: 0 }),
    body('expectedPayable').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    const { paymentMethod = 'cod', notes, expectedTotal, expectedPayable } = req.body;

    try {
      const deliveryAddress = await resolveDeliveryAddress(req);

      // Price and compliance-check BEFORE opening the transaction: both are read
      // paths, and holding a Serializable lock across five compliance queries
      // would widen the window every concurrent checkout contends over.
      const { quote, eligibility } = await loadPricedCart(req.user.id, {
        paymentMethod,
        pincode: normalizePincode(deliveryAddress.pincode),
        buyer: { state: deliveryAddress.state, district: deliveryAddress.city },
      });

      if (!isQuoteCheckoutable(quote)) {
        const first = quote.issues[0];
        recordEvent(SHOP_EVENTS.CHECKOUT_BLOCKED_ISSUES);
        return sendError(res, first.message, first.code === QUOTE_ISSUES.EMPTY_CART ? 400 : 409, {
          issues: quote.issues,
          quote: { total: quote.total, subtotal: quote.subtotal },
        });
      }

      const totals = orderTotalsFromQuote(quote);

      // `expectedTotal` keeps its existing meaning — the GOODS subtotal — so an
      // un-upgraded app build still validates correctly. `expectedPayable` is the
      // new field for the amount actually charged. Both are checked when sent.
      assertClientTotalMatches(expectedTotal, quote.subtotal);
      assertClientTotalMatches(expectedPayable, quote.total);

      // Two buyers racing for the last unit is a NORMAL marketplace event, not a
      // server error — a 40001 abort is replayed instead of surfacing as a 500.
      const { order, crossedZero } = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        const { orderItems, deltas, productDeltas } = await validateCartForCheckout(tx, req.user.id);
        assertCartMatchesQuote(orderItems, quote);

        const o = await tx.order.create({
          data: {
            userId: req.user.id,
            // Every money column comes from the QUOTE, never from a sum computed
            // here and never from anything the client sent.
            totalAmount: totals.totalAmount,
            subtotal: totals.subtotal,
            deliveryFee: totals.deliveryFee,
            taxAmount: totals.taxAmount,
            discountAmount: totals.discountAmount,
            pricingSnapshot: totals.pricingSnapshot,
            deliveryPincode: totals.deliveryPincode,
            promisedEtaDays: totals.promisedEtaDays,
            deliveryAddress,
            paymentMethod,
            notes,
            items: { create: withOrderItemSnapshots(orderItems, quote, eligibility) },
          },
          include: { items: { include: { product: true } } },
        });

        const { crossedZero } = await applyListingStockDeltas(tx, deltas);
        await syncListingStockStatus(tx, crossedZero);
        // Pre-backfill lines decrement products.stock instead. Inside the same
        // Serializable transaction that validated them, so the read-validate-
        // write stays atomic exactly as it does for listings.
        const { crossedZero: productCrossedZero } = await applyStockDeltas(tx, productDeltas);
        await tx.cartItem.deleteMany({ where: { userId: req.user.id } });

        return { order: o, crossedZero: [...crossedZero, ...productCrossedZero] };
      }, { isolationLevel: 'Serializable' }));

      // Only a zero crossing can change a buy-box winner, so only that bumps the
      // cache. Ordinary decrements ride the 60 s TTL, as before.
      if (crossedZero.length) await invalidateCatalogCaches();

      if (ENV.DEVICE_FINGERPRINT_ENABLED) {
        recordDeviceLink({ userId: req.user.id, fingerprint: strongDeviceId(req), ip: req.ip, context: 'order' }).catch(() => {});
      }

      recordEvent(SHOP_EVENTS.CHECKOUT_OK);
      return sendCreated(res, order);
    } catch (err) {
      recordEvent(SHOP_EVENTS.CHECKOUT_FAIL);
      recordEvent(SHOP_EVENTS.ORDER_CREATE_FAIL);
      return sendServerError(res, err, 'Checkout failed. Please try again.');
    }
  }
);

router.get('/orders', authenticate, async (req, res) => {
  const limit = parsePageSize(req.query.limit, 10, 50);
  const include = { items: { include: { product: { select: { name: true, images: true } } } } };

  if (req.query.cursor !== undefined || req.query.paginate === 'cursor') {
    const { items, nextCursor, hasMore } = await keysetPage(prisma, {
      table: 'orders', filterColumn: 'userId', filterValue: req.user.id,
      cursor: req.query.cursor, limit,
      hydrate: (ids) => prisma.order.findMany({ where: { id: { in: ids } }, include }),
    });
    return sendSuccess(res, items, 200, { limit, nextCursor, hasMore });
  }

  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { userId: req.user.id },
      include,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where: { userId: req.user.id } }),
  ]);

  return sendSuccess(res, orders, 200, paginationMeta(total, page, limit));
});

router.get('/orders/:id', authenticate, async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { items: { include: { product: true } } },
  });
  if (!order) return sendNotFound(res, 'Order');
  return sendSuccess(res, order);
});

router.put('/orders/:id/cancel', authenticate, velocityGuard(VELOCITY_ACTIONS.REFUND), refundAbuseGuard(), async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { items: true },
  });
  if (!order) return sendNotFound(res, 'Order');
  if (order.status !== 'PENDING') {
    return sendError(res, `Cannot cancel a ${order.status.toLowerCase()} order. Only pending orders can be cancelled.`, 400);
  }

  const { cancelled, crossedZero } = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });

    // Restock the OFFERS, not the catalog rows: stock is a property of one
    // seller's listing, so decrementing the shared catalog row would drain every
    // Kendra's stock for one buyer's purchase.
    //
    // Pre-backfill items have no listingId and their stock lives on the product
    // row instead. This comment used to say they were "restored by the legacy
    // path below" — there was no such path, here or anywhere else, and nothing
    // in the codebase moved products.stock at all. Both halves are present now:
    // checkout decrements (validateCartForCheckout), and this restores.
    const listingDeltas = order.items
      .filter((i) => i.listingId)
      .map((i) => ({ listingId: i.listingId, delta: i.quantity }));
    const { crossedZero } = await applyListingStockDeltas(tx, listingDeltas);
    await syncListingStockStatus(tx, crossedZero);

    const productDeltas = order.items
      .filter((i) => !i.listingId && i.productId)
      .map((i) => ({ productId: i.productId, delta: i.quantity }));
    await applyStockDeltas(tx, productDeltas);

    await tx.orderItem.updateMany({
      where: { orderId: order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    return { cancelled: updated, crossedZero };
  });

  if (crossedZero.length) await invalidateCatalogCaches();
  auditOrderStatusChange(req, cancelled.id, 'PENDING', 'CANCELLED').catch(() => {});

  return sendSuccess(res, { id: cancelled.id, status: cancelled.status });
});

// ── Payment: initiate ─────────────────────────────────────────────────────────
router.post(
  '/orders/initiate',
  authenticate,
  idempotency('shop_payment_initiate'),
  [
    body('paymentMethod').isIn(['upi', 'card']).withMessage('paymentMethod must be upi or card'),
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
    body('expectedTotal').optional().isFloat({ min: 0 }),
    body('expectedPayable').optional().isFloat({ min: 0 }),
    body('pincode').optional().isString().isLength({ max: 10 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { expectedTotal, expectedPayable } = req.body;

      // The Razorpay order used to be raised for the GOODS SUBTOTAL, while the
      // app displayed subtotal + ₹49. The delivery fee was shown and never
      // charged. The gateway amount is now the quote's payable, full stop.
      const pincode = normalizePincode(req.body.pincode)
        || (req.body.deliveryAddressId
          ? normalizePincode((await prisma.savedAddress.findFirst({
              where: { id: req.body.deliveryAddressId, userId: req.user.id },
              select: { pincode: true },
            }))?.pincode)
          : normalizePincode(req.body.deliveryAddress?.pincode));

      const { quote } = await loadPricedCart(req.user.id, {
        paymentMethod: 'online',
        pincode,
        buyer: buyerScope(req),
      });

      if (!isQuoteCheckoutable(quote)) {
        const first = quote.issues[0];
        return sendError(res, first.message, first.code === QUOTE_ISSUES.EMPTY_CART ? 400 : 409, { issues: quote.issues });
      }

      if (expectedTotal !== undefined && toPaise(expectedTotal) !== toPaise(quote.subtotal)) {
        return sendError(res, 'Cart total has changed. Please review your cart and try again.', 409, { quote });
      }
      if (expectedPayable !== undefined && toPaise(expectedPayable) !== toPaise(quote.total)) {
        return sendError(res, 'The amount payable has changed. Please review your cart and try again.', 409, { quote });
      }

      const amountInPaise = quote.totalPaise;
      // Unique per checkout. The old receipt was `cart_${userId}` — identical for
      // every payment that user ever made — so /confirm's receipt check proved
      // only that the gateway order belonged to this user, never that it belonged
      // to THIS checkout.
      const receipt = receiptFor(req.user.id);
      const razorpayOrder = await createPaymentOrder(amountInPaise, 'INR', receipt);

      // Recorded BEFORE we hand the id to the app. If the phone dies on the next
      // screen, this row is what the reconciler and the webhook converge on.
      await createIntent({
        userId: req.user.id,
        providerOrderId: razorpayOrder.id,
        amount: quote.total,
        receipt,
        quote,
      }).catch((err) => {
        // Never fail a checkout because telemetry could not be written — but log
        // it loudly, because an unrecorded intent is an unreconcilable payment.
        logger.error({ err, providerOrderId: razorpayOrder.id }, '[Shop] failed to record payment intent');
      });

      // ── Hold the stock for the payment window ───────────────────────────────
      // Stock used to be decremented only at /orders/confirm — AFTER the money
      // had moved — so two buyers could both pay for the last bag of seed and the
      // second was told "insufficient stock" having already been charged. The
      // units are taken now and returned automatically if the payment is
      // abandoned, fails or times out.
      let reservation = null;
      const resCfg = await reservationConfig();
      if (resCfg.enabled) {
        const lines = quote.shipments
          .flatMap((s) => s.items)
          .filter((i) => i.listingId)
          .map((i) => ({ listingId: i.listingId, quantity: i.quantity }));

        if (lines.length) {
          try {
            reservation = await withSerializableRetry(() => prisma.$transaction(
              (tx) => holdStock(tx, {
                userId: req.user.id,
                providerOrderId: razorpayOrder.id,
                lines,
                ttlMs: resCfg.ttlMs,
              }),
              { isolationLevel: 'Serializable' },
            ));
            if (reservation.crossedZero?.length) await invalidateCatalogCaches();
          } catch (err) {
            // Someone took the last unit between the quote and the hold. The
            // gateway order is already created but NOTHING has been charged, so
            // refusing here is clean — and far better than letting the buyer pay
            // for stock we cannot supply. The orphan gateway order expires.
            await markIntentFailed({ providerOrderId: razorpayOrder.id, reason: 'stock unavailable at reservation' })
              .catch(() => {});
            recordEvent(SHOP_EVENTS.INVENTORY_OVERSELL_BLOCKED);
            recordEvent(SHOP_EVENTS.PAYMENT_INITIATE_FAIL);
            return sendServerError(res, err, 'An item in your cart just sold out. Please review your cart and try again.', 409);
          }
        }
      }

      recordEvent(SHOP_EVENTS.PAYMENT_INITIATE_OK);
      return sendSuccess(res, {
        // How long the buyer has to complete payment before the units go back on
        // the shelf. The app shows this so a hold is never a silent deadline.
        reservedUntil: reservation?.expiresAt ?? null,
        razorpayOrderId: razorpayOrder.id,
        // `amount` stays the payable for older clients that render it directly.
        amount: quote.total,
        amountInPaise,
        currency: 'INR',
        receipt,
        quote,
        mock: razorpayOrder.mock || false,
      });
    } catch (err) {
      return sendServerError(res, err, 'Payment initiation failed. Please try again.');
    }
  }
);

/**
 * "Did my payment go through?"
 *
 * The app calls this after any interrupted payment instead of guessing. Without
 * it, a farmer whose connection dropped between paying and confirming saw a
 * generic failure and paid again — the single worst outcome this module can
 * produce.
 */
router.get('/orders/payment-status/:providerOrderId', authenticate, async (req, res) => {
  const { providerOrderId } = req.params;
  if (typeof providerOrderId !== 'string' || providerOrderId.length > 64) {
    return sendError(res, 'Invalid payment reference', 400);
  }

  const intent = await findIntent(providerOrderId);
  // Object-level authorization: an intent id is guessable enough that it must not
  // reveal another buyer's payment state.
  if (!intent || intent.userId !== req.user.id) return sendNotFound(res, 'Payment');

  const status = intentPublicStatus(intent);
  let order = null;
  if (intent.orderId) {
    order = await prisma.order.findFirst({
      where: { id: intent.orderId, userId: req.user.id },
      select: { id: true, status: true, paymentStatus: true, totalAmount: true, createdAt: true },
    });
  }

  return sendSuccess(res, { ...status, amount: String(intent.amount), order });
});

// ── Payment: confirm ──────────────────────────────────────────────────────────
router.post(
  '/orders/confirm',
  authenticate,
  velocityGuard(VELOCITY_ACTIONS.ORDER),
  idempotency('shop_payment_confirm'),
  [
    body('razorpayOrderId').notEmpty().isString().isLength({ max: 64 }),
    body('razorpayPaymentId').notEmpty().isString().isLength({ max: 64 }),
    body('razorpaySignature').notEmpty().isString().isLength({ max: 128 }),
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
    body('expectedTotal').optional().isFloat({ min: 0 }),
    body('expectedPayable').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, expectedTotal, expectedPayable } = req.body;

    if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return sendError(res, 'Payment verification failed — signature mismatch', 400);
    }

    // The webhook may already have created this order while the app was
    // reconnecting. Return it rather than racing to make a second one.
    const already = await prisma.order.findUnique({ where: { paymentRef: razorpayPaymentId } });
    if (already) {
      if (already.userId !== req.user.id) return sendError(res, 'Payment verification failed', 400);
      return sendSuccess(res, already, 200);
    }

    try {
      const deliveryAddress = await resolveDeliveryAddress(req);
      const paymentOrder = await fetchPaymentOrder(razorpayOrderId);

      // The intent is what /initiate priced this payment for. It is also the
      // object-level authorization check: a signature proves Razorpay signed the
      // pair, not that the pair belongs to THIS buyer.
      const intent = await findIntent(razorpayOrderId);
      if (intent && intent.userId !== req.user.id) {
        return sendError(res, 'Payment verification failed', 400);
      }

      // ── What is being held for this payment ─────────────────────────────────
      // /orders/initiate took these units off the shelf. Resolved BEFORE the
      // quote, because the quote's own availability check has to count this
      // buyer's hold as available TO THEM — reserving the last unit drops the
      // listing to OUT_OF_STOCK, and without this the hold would lock the buyer
      // out of the purchase it was protecting.
      const held = await heldFor(razorpayOrderId);
      const reservedByListing = new Map();
      for (const h of held) {
        reservedByListing.set(h.listingId, (reservedByListing.get(h.listingId) || 0) + h.quantity);
      }

      const { quote, eligibility } = await loadPricedCart(req.user.id, {
        paymentMethod: 'online',
        pincode: normalizePincode(deliveryAddress.pincode),
        buyer: { state: deliveryAddress.state, district: deliveryAddress.city },
        reservedByListing,
      });

      if (!isQuoteCheckoutable(quote)) {
        const first = quote.issues[0];
        // The money has already moved, so this is NOT a plain rejection: the
        // intent stays PAID and the reconciler will surface it for refund.
        // The hold is released either way — no order is coming, so those units
        // belong back on the shelf immediately rather than at TTL.
        await releaseReservations(razorpayOrderId, 'checkout blocked after payment').catch(() => {});
        await markIntentPaid({ providerOrderId: razorpayOrderId, providerPaymentId: razorpayPaymentId }).catch(() => {});
        recordEvent(SHOP_EVENTS.PAYMENT_CONFIRM_FAIL);
        recordEvent(SHOP_EVENTS.CHECKOUT_BLOCKED_ISSUES);
        return sendError(
          res,
          `Your payment went through, but your order could not be completed: ${first.message} Our team will contact you about a refund — please do not pay again.`,
          409,
          { issues: quote.issues, paymentCaptured: true, providerOrderId: razorpayOrderId },
        );
      }

      // The payment was raised for a specific basket. A same-total basket with
      // different items would pass the amount check, so the quote fingerprint is
      // compared too. On a mismatch the hold is wrong for this cart, so release
      // it and refuse — the money is already captured, which the reconciler and
      // the message below both account for.
      if (held.length && intent?.cartHash && quote.fingerprint !== intent.cartHash) {
        await releaseReservations(razorpayOrderId, 'cart changed between payment and confirmation').catch(() => {});
        await markIntentPaid({ providerOrderId: razorpayOrderId, providerPaymentId: razorpayPaymentId }).catch(() => {});
        recordEvent(SHOP_EVENTS.PAYMENT_CONFIRM_FAIL);
        return sendError(
          res,
          'Your payment went through, but your cart changed while you were paying, so the order could not be completed. Our team will contact you about a refund — please do not pay again.',
          409,
          { paymentCaptured: true, providerOrderId: razorpayOrderId, code: 'CART_CHANGED' },
        );
      }

      const totals = orderTotalsFromQuote(quote);

      const { order, crossedZero } = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        const { orderItems, deltas, productDeltas } = await validateCartForCheckout(tx, req.user.id, { reservedByListing });
        assertCartMatchesQuote(orderItems, quote);
        assertClientTotalMatches(expectedTotal, quote.subtotal);
        assertClientTotalMatches(expectedPayable, quote.total);

        if (!paymentOrder.mock) {
          // Bind the gateway order to THIS checkout by its unique receipt. The
          // previous check compared against `cart_${userId}`, a constant per user,
          // so any of that user's past gateway orders satisfied it.
          const expectedReceipt = intent?.receipt || null;
          if (expectedReceipt && paymentOrder.receipt !== expectedReceipt) {
            throw Object.assign(
              new Error('This payment does not match your cart.'),
              { statusCode: 400, expose: true, tamper: { kind: 'receipt_mismatch', expectedPaise: toPaise(quote.total), actualPaise: Number(paymentOrder.amount) } },
            );
          }
          if (toPaise(quote.total) !== Number(paymentOrder.amount)) {
            throw Object.assign(
              new Error('Paid amount does not match your order total. Your cart may have changed — no order was created.'),
              { statusCode: 400, expose: true, tamper: { kind: 'paid_amount_mismatch', expectedPaise: toPaise(quote.total), actualPaise: Number(paymentOrder.amount) } },
            );
          }
        }

        const o = await tx.order.create({
          data: {
            userId: req.user.id,
            totalAmount: totals.totalAmount,
            subtotal: totals.subtotal,
            deliveryFee: totals.deliveryFee,
            taxAmount: totals.taxAmount,
            discountAmount: totals.discountAmount,
            pricingSnapshot: totals.pricingSnapshot,
            deliveryPincode: totals.deliveryPincode,
            promisedEtaDays: totals.promisedEtaDays,
            deliveryAddress,
            paymentMethod: 'online',
            paymentStatus: 'paid',
            notes: `razorpay:${razorpayPaymentId}`,
            // Unique column. Replaying the same signed triple after re-filling
            // the cart now fails at the DB (P2002) instead of creating a second
            // fully-paid order — the payment id used to live only in `notes`.
            paymentRef: razorpayPaymentId,
            items: { create: withOrderItemSnapshots(orderItems, quote, eligibility) },
          },
          include: { items: { include: { product: true } } },
        });

        // Consume the hold rather than decrementing again. `consumeReservations`
        // is guarded on `status: 'HELD'`, so a replayed confirm transitions
        // nothing and cannot free stock twice.
        const consumed = await consumeReservations(tx, razorpayOrderId);

        // No hold (reservations disabled, or the TTL expired and the sweeper
        // released it) → fall back to the original behaviour and decrement now.
        // Stock may genuinely have gone in the meantime, in which case this
        // throws and the buyer lands on the paid-but-no-order path.
        let crossedZero = [];
        if (!consumed) {
          ({ crossedZero } = await applyListingStockDeltas(tx, deltas));
          await syncListingStockStatus(tx, crossedZero);
        }
        // NOT gated on `consumed`: that flag means the LISTING reservation taken
        // at /orders/initiate has already been converted, and a pre-backfill line
        // never had one — /orders/initiate reserves seller_listings only. Skipping
        // these here would leave them permanently undecremented on the paid path.
        const { crossedZero: productCrossedZero } = await applyStockDeltas(tx, productDeltas);

        await tx.cartItem.deleteMany({ where: { userId: req.user.id } });
        return { order: o, crossedZero: [...crossedZero, ...productCrossedZero] };
      }, { isolationLevel: 'Serializable' }));

      recordEvent(SHOP_EVENTS.PAYMENT_CONFIRM_OK);
      recordEvent(SHOP_EVENTS.CHECKOUT_OK);

      // Bind the intent to the order it produced. UNIQUE orderId means the
      // webhook and the reconciler can never produce a second one.
      await markIntentPaid({ providerOrderId: razorpayOrderId, providerPaymentId: razorpayPaymentId }).catch(() => {});
      await attachOrderToIntent({ providerOrderId: razorpayOrderId, orderId: order.id }).catch(() => {});

      if (crossedZero.length) await invalidateCatalogCaches();

      if (ENV.DEVICE_FINGERPRINT_ENABLED) {
        recordDeviceLink({ userId: req.user.id, fingerprint: strongDeviceId(req), ip: req.ip, context: 'order' }).catch(() => {});
      }

      return sendCreated(res, order);
    } catch (err) {
      if (err?.code === 'P2002') {
        // The unique on paymentRef fired: this payment already produced an order.
        const existing = await prisma.order.findUnique({ where: { paymentRef: razorpayPaymentId } });
        if (existing) return sendSuccess(res, existing, 200);
      }
      if (err?.tamper && ENV.PAYMENT_TAMPER_ALARM_ENABLED) {
        raisePaymentTamperAlarm({
          userId: req.user.id, ...err.tamper,
          orderRef: razorpayOrderId, paymentRef: razorpayPaymentId,
          ip: req.ip, requestId: req.id,
        }).catch(() => {});
      }
      // The order was not created, so nothing will consume the hold. Release it
      // now rather than leaving stock off the shelf until the TTL — the sweeper
      // is the backstop, not the primary path.
      await releaseReservations(razorpayOrderId, 'order confirmation failed').catch(() => {});
      recordEvent(SHOP_EVENTS.PAYMENT_CONFIRM_FAIL);
      recordEvent(SHOP_EVENTS.ORDER_CREATE_FAIL);
      return sendServerError(res, err, 'Order confirmation failed. Please try again.');
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SELLER — catalog search, catalog create, offers
// ═══════════════════════════════════════════════════════════════════════════════

const PRODUCT_TEXT_LIMITS = {
  name: 150, nameHi: 150, nameMr: 150, description: 5000, unit: 40,
  district: 120, taluka: 120, village: 120, state: 120,
  harvestDate: 40, subcategory: 100, brand: 100, manufacturer: 120,
  countryOfOrigin: 80, modelNumber: 80, sellerSku: 80, gtin: 20,
};

/**
 * STEP 1 of the add-product flow. The seller app calls this BEFORE showing any
 * create form. Exact GTIN → brand + modelNumber → trigram on name.
 */
router.get(
  '/catalog/search',
  authenticate,
  requireRole(...SELLER_ROLES),
  [
    query('q').optional().isString(),
    query('gtin').optional().isString(),
    query('brand').optional().isString(),
    query('categoryId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 25 }),
  ],
  validate,
  async (req, res) => {
    // sanitizeSearch guards the LIKE path; normalisation for COMPARISON happens
    // inside catalogMatch. They are different jobs and both are needed.
    const q = sanitizeSearch(req.query.q, 150);
    const { matchType, results } = await searchCatalog({
      q,
      gtin: req.query.gtin,
      brand: req.query.brand,
      categoryId: req.query.categoryId,
      limit: req.query.limit,
    });

    // Tell the seller which of these they already sell, so the app can show
    // "You already have an offer here" instead of letting them hit the unique.
    const variantIds = results.flatMap((p) => p.variants.map((v) => v.id));
    const mine = variantIds.length
      ? await prisma.sellerListing.findMany({
          where: { sellerId: req.user.id, variantId: { in: variantIds } },
          select: { id: true, variantId: true, sellingPrice: true, stockQty: true, status: true },
        })
      : [];
    const mineByVariant = new Map(mine.map((l) => [l.variantId, l]));
    for (const p of results) {
      for (const v of p.variants) v.myListing = mineByVariant.get(v.id) || null;
      p.hasMyListing = p.variants.some((v) => v.myListing);
    }

    return sendSuccess(res, { matchType, results });
  }
);

/**
 * STEP 3 of the add-product flow — only reached when the catalog search found
 * nothing. Creates the CATALOG row (and its first variant); it carries NO price,
 * stock or geography. The offer is a separate POST /listings.
 */
router.post(
  '/catalog/products',
  authenticate,
  requireRole(...SELLER_ROLES),
  [
    body('name').trim().notEmpty().withMessage('name required'),
    body('categoryId').notEmpty(),
    body('description').optional().trim(),
    body('brand').optional().trim(),
    body('manufacturer').optional().trim(),
    body('modelNumber').optional().trim(),
    body('countryOfOrigin').optional().trim(),
    body('subcategory').optional().trim(),
    body('tags').optional().isArray(),
    body('images').optional().isArray(),
    body('highlights').optional().isArray(),
    body('specifications').optional().isObject(),
    body('variants').optional().isArray({ min: 1 }),
    ...maxLen(PRODUCT_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    const {
      name, nameHi, nameMr, categoryId, description, brand, manufacturer,
      modelNumber, countryOfOrigin, subcategory, tags = [], images = [],
      highlights = [], specifications, variants = [],
    } = req.body;

    const cat = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) return sendError(res, 'Invalid category', 400);

    // THE GATE. Cross-seller, pre-commit, blocking — unlike the post-hoc,
    // seller-scoped, fire-and-forget heuristic this replaces.
    const dup = await findCatalogDuplicate({
      categoryId, brand, manufacturer, name, modelNumber,
      gtin: variants[0]?.gtin,
    });
    if (dup.duplicate) {
      return sendError(
        res,
        'This product is already in the catalogue. Add your price and stock to the existing listing instead of creating a duplicate.',
        409,
        { reason: dup.reason, productId: dup.productId, candidates: dup.candidates },
      );
    }

    const requireQc = await getSetting('catalog.requireQcForNewProducts');

    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          name: stripHtml(name), nameHi: stripHtml(nameHi), nameMr: stripHtml(nameMr),
          categoryId,
          description: stripHtml(description),
          brand:           stripHtml(brand)           || null,
          manufacturer:    stripHtml(manufacturer)    || null,
          modelNumber:     stripHtml(modelNumber)     || null,
          countryOfOrigin: stripHtml(countryOfOrigin) || null,
          subcategory:     subcategory || null,
          images, tags,
          highlights:      deepStripHtml(highlights),
          specifications:  deepStripHtml(specifications) || null,
          normalizedKey:   normalizeProductKey({ categoryId, brand, manufacturer, name }),
          // Products used to go live instantly — POST /seller/products relied on
          // the schema default isActive = true with no approval gate at all.
          status: requireQc ? 'PENDING_QC' : 'APPROVED',
          createdBySellerId: req.user.id,
          // DUAL-READ: legacy columns the pre-split reads still touch.
          sellerId: req.user.id,
          isActive: !requireQc,
        },
        include: { category: { select: { id: true, name: true, icon: true, color: true } } },
      });

      const variantRows = (variants.length ? variants : [{ unit: 'kg', attributes: {} }]).map((v, idx) => ({
        productId: p.id,
        attributes: deepStripHtml(v.attributes || {}),
        unit: stripHtml(v.unit) || 'kg',
        gtin: v.gtin ? String(v.gtin).trim() : null,
        sku: v.sku ? stripHtml(v.sku) : null,
        isDefault: idx === 0,
      }));
      await tx.productVariant.createMany({ data: variantRows });

      return tx.product.findUnique({
        where: { id: p.id },
        include: {
          category: { select: { id: true, name: true, icon: true, color: true } },
          variants: true,
        },
      });
    });

    await invalidateCatalogCaches();

    auditAction(req, {
      action: AUDIT_ACTIONS.PRODUCT_CREATE_PENDING_QC,
      entity: 'Product',
      entityId: product.id,
      after: { name: product.name, status: product.status, categoryId },
      metadata: { sellerId: req.user.id, normalizedKey: product.normalizedKey },
    }).catch(() => {});

    // contentFraud keeps its burst / new-account job. It no longer owns
    // "is this a duplicate" — that is the blocking gate above.
    if (ENV.CONTENT_FRAUD_ENABLED) {
      flagListingIfSuspicious({ productId: product.id, sellerId: req.user.id, name: product.name }).catch(() => {});
    }

    return sendCreated(res, product);
  }
);

// ── Seller offers ─────────────────────────────────────────────────────────────
const LISTING_FIELDS = [
  body('sellingPrice').optional().isFloat({ min: 0.01 }),
  body('mrp').optional({ nullable: true }).isFloat({ min: 0 }),
  body('stockQty').optional().isInt({ min: 0 }),
  body('dispatchSlaDays').optional().isInt({ min: 0, max: 60 }),
  body('minOrderQty').optional().isInt({ min: 1 }),
  body('sellerSku').optional().trim(),
  body('condition').optional().isIn(['NEW', 'REFURBISHED']),
  body('sellScope').optional().isIn(['village', 'taluka', 'district', 'state', 'all_india']),
  body('district').optional().trim(),
  body('taluka').optional().trim(),
  body('village').optional().trim(),
  body('state').optional().trim(),
  body('harvestDate').optional().trim(),
  body('images').optional().isArray(),
  body('status').optional().isIn(['ACTIVE', 'INACTIVE']),
];

/** Build the offer patch. Only offer fields — never catalog fields. */
function listingPatch(b) {
  const d = {};
  if (b.sellingPrice    !== undefined) d.sellingPrice    = D(b.sellingPrice).toFixed(2);
  if (b.mrp             !== undefined) d.mrp             = b.mrp === null || b.mrp === '' ? null : D(b.mrp).toFixed(2);
  if (b.stockQty        !== undefined) d.stockQty        = parseInt(b.stockQty, 10);
  if (b.dispatchSlaDays !== undefined) d.dispatchSlaDays = parseInt(b.dispatchSlaDays, 10);
  if (b.minOrderQty     !== undefined) d.minOrderQty     = parseInt(b.minOrderQty, 10);
  if (b.sellerSku       !== undefined) d.sellerSku       = stripHtml(b.sellerSku) || null;
  if (b.condition       !== undefined) d.condition       = b.condition;
  if (b.sellScope       !== undefined) d.sellScope       = b.sellScope;
  if (b.district        !== undefined) d.district        = stripHtml(b.district) || null;
  if (b.taluka          !== undefined) d.taluka          = stripHtml(b.taluka)   || null;
  if (b.village         !== undefined) d.village         = stripHtml(b.village)  || null;
  if (b.state           !== undefined) d.state           = stripHtml(b.state)    || null;
  if (b.harvestDate     !== undefined) d.harvestDate     = stripHtml(b.harvestDate) || null;
  if (b.images          !== undefined) d.images          = deepStripHtml(b.images);
  return d;
}

/** Derive the state a listing should be in, given its stock and the seller's intent. */
function derivedStatus(intent, stockQty) {
  if (intent === 'INACTIVE') return 'INACTIVE';
  return stockQty > 0 ? 'ACTIVE' : 'OUT_OF_STOCK';
}

/**
 * STEP 2 of the add-product flow: "Sell this product". The seller supplies ONLY
 * offer fields — no name, no description, no catalog imagery. No `products` row
 * is created.
 */
router.post(
  '/listings',
  authenticate,
  requireRole(...SELLER_ROLES),
  [
    body('variantId').notEmpty().isUUID(),
    body('sellingPrice').isFloat({ min: 0.01 }),
    body('stockQty').isInt({ min: 0 }),
    ...LISTING_FIELDS,
    ...maxLen(PRODUCT_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.body.variantId },
      include: { product: { select: { id: true, name: true, status: true, createdBySellerId: true } } },
    });
    if (!variant) return sendNotFound(res, 'Variant');

    // Attaching to a product still in QC is only allowed for the seller who
    // proposed it — that is the "draft listing flips to ACTIVE on approval" case.
    if (variant.product.status !== 'APPROVED') {
      if (variant.product.status !== 'PENDING_QC' || variant.product.createdBySellerId !== req.user.id) {
        return sendError(res, 'This product is not available to sell yet', 400);
      }
    }

    const stockQty = parseInt(req.body.stockQty, 10);
    const data = {
      ...listingPatch(req.body),
      sellerId: req.user.id,      // NEVER from the body — it comes from the JWT
      variantId: variant.id,
      stockQty,
      // A listing on a PENDING_QC product stays INACTIVE until the product is
      // approved; the QC decision flips it.
      status: variant.product.status === 'APPROVED'
        ? derivedStatus(req.body.status, stockQty)
        : 'INACTIVE',
    };

    try {
      const listing = await prisma.sellerListing.create({ data, include: { variant: true } });
      await invalidateCatalogCaches();
      return sendCreated(res, listing);
    } catch (err) {
      if (err?.code === 'P2002') {
        return sendError(res, 'You already have an offer for this pack size. Edit it instead of creating a second one.', 409);
      }
      return sendServerError(res, err, 'Could not create the offer. Please try again.');
    }
  }
);

router.get('/listings', authenticate, requireRole(...SELLER_ROLES), async (req, res) => {
  const limit = parsePageSize(req.query.limit, 20, 50);
  const include = {
    variant: {
      include: {
        product: {
          select: {
            id: true, name: true, nameHi: true, nameMr: true, images: true,
            brand: true, status: true,
            category: { select: { id: true, name: true, icon: true, color: true } },
          },
        },
      },
    },
  };

  let listings; let meta;
  if (req.query.cursor !== undefined || req.query.paginate === 'cursor') {
    // Rides seller_listings(sellerId, createdAt DESC) — the replacement for the
    // old products(sellerId, createdAt) composite, since sellerId moved tables.
    const r = await keysetPage(prisma, {
      table: 'seller_listings', filterColumn: 'sellerId', filterValue: req.user.id,
      cursor: req.query.cursor, limit,
      hydrate: (ids) => prisma.sellerListing.findMany({ where: { id: { in: ids } }, include }),
    });
    listings = r.items;
    meta = { limit, nextCursor: r.nextCursor, hasMore: r.hasMore };
  } else {
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const [rows, total] = await Promise.all([
      prisma.sellerListing.findMany({
        where: { sellerId: req.user.id },
        include, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit, take: limit,
      }),
      prisma.sellerListing.count({ where: { sellerId: req.user.id } }),
    ]);
    listings = rows;
    meta = paginationMeta(total, page, limit);
  }

  // Buy-box standing per offer — the answer to "am I the featured seller here,
  // and if not, what am I competing against".
  //
  // This was `Promise.all(listings.map(… rankOffersForVariant …))` — one full
  // ranking pass per row, so a 50-row page of a seller's own offers issued 50
  // scoring passes, each of which reads settings and every competing listing for
  // that variant. Deduplicating by variantId first collapses that to one pass per
  // DISTINCT variant, which for a seller who lists several pack sizes of the same
  // product is a large reduction and for the common case is simply correct.
  const distinctVariantIds = [...new Set(listings.map((l) => l.variantId))];
  const rankings = new Map(
    await Promise.all(distinctVariantIds.map(async (variantId) => {
      const { offers } = await rankOffersForVariant(variantId, {});
      return [variantId, offers];
    })),
  );

  const decorated = listings.map((l) => {
    const offers = rankings.get(l.variantId) || [];
    const winner = offers[0];
    const lowest = offers.length ? Math.min(...offers.map((o) => Number(o.sellingPrice))) : null;
    return {
      ...l,
      buyBox: {
        isWinner: winner?.id === l.id,
        competitorCount: Math.max(offers.length - (offers.some((o) => o.id === l.id) ? 1 : 0), 0),
        lowestPrice: lowest,
        winningPrice: winner ? Number(winner.sellingPrice) : null,
      },
    };
  });

  return sendSuccess(res, decorated, 200, meta);
});

router.patch(
  '/listings/:listingId',
  authenticate,
  requireRole(...SELLER_ROLES),
  [...LISTING_FIELDS, ...maxLen(PRODUCT_TEXT_LIMITS)],
  validate,
  async (req, res) => {
    const listing = await prisma.sellerListing.findUnique({ where: { id: req.params.listingId } });
    if (!listing) return sendNotFound(res, 'Offer');
    if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') return sendForbidden(res, 'Not your offer');

    // BLOCKED is a trust-and-safety action; a seller cannot lift it by editing.
    if (listing.status === 'BLOCKED' && req.user.role !== 'ADMIN') {
      return sendForbidden(res, 'This offer has been blocked by CropSetu. Contact support.');
    }

    const data = listingPatch(req.body);
    const nextStock = data.stockQty ?? listing.stockQty;
    if (req.body.status !== undefined || data.stockQty !== undefined) {
      data.status = derivedStatus(req.body.status ?? (listing.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'), nextStock);
    }

    const updated = await prisma.sellerListing.update({
      where: { id: listing.id },
      data,
      include: { variant: { include: { product: { select: { id: true, name: true } } } } },
    });

    // Price / stock / status all move the buy box.
    await invalidateCatalogCaches();
    return sendSuccess(res, updated);
  }
);

router.delete('/listings/:listingId', authenticate, requireRole(...SELLER_ROLES), async (req, res) => {
  const listing = await prisma.sellerListing.findUnique({ where: { id: req.params.listingId } });
  if (!listing) return sendNotFound(res, 'Offer');
  if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') return sendForbidden(res, 'Not your offer');

  // Removes MY OFFER, never the catalog row — the old DELETE soft-deleted the
  // product and ran cartItem.deleteMany({ where: { productId } }), wiping the
  // product from EVERY buyer's cart including buyers who had chosen a different
  // Kendra. Only this seller's cart lines are cleared now.
  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { listingId: listing.id } }),
    prisma.sellerListing.delete({ where: { id: listing.id } }),
  ]);

  await invalidateCatalogCaches();

  auditAction(req, {
    action: AUDIT_ACTIONS.PRODUCT_DELETE,
    entity: 'SellerListing',
    entityId: listing.id,
    before: { sellingPrice: String(listing.sellingPrice), stockQty: listing.stockQty, variantId: listing.variantId },
    metadata: { sellerId: req.user.id },
  }).catch(() => {});

  return sendSuccess(res, { deleted: true });
});

// ── Legacy seller/product shims ───────────────────────────────────────────────
// Older seller-app builds still call these. They now operate on OFFERS.
//
// The app store cannot be forced to update in step with a deploy, so removing
// these outright would brick every seller who had not upgraded — mid-migration,
// on the money-earning screen. They are deprecated, not deleted.

/**
 * DEPRECATED. The pre-split "create a product" call: ONE flat payload mixing
 * catalog keys with offer keys. It now does what the new flow does in two steps —
 * find-or-create the catalog entry, then attach this seller's offer — so an old
 * build stops creating a duplicate catalog row per seller even though it is still
 * sending the old payload.
 *
 * New builds call POST /catalog/products + POST /listings instead, which is the
 * only path that can surface the duplicate candidates to the seller.
 */
router.post(
  '/seller/products',
  authenticate,
  requireRole(...SELLER_ROLES),
  [
    body('name').trim().notEmpty().withMessage('name required'),
    body('categoryId').notEmpty(),
    body('price').isFloat({ min: 0.01 }),
    body('stock').isInt({ min: 0 }),
    body('unit').notEmpty(),
    body('mrp').optional().isFloat({ min: 0 }),
    body('minOrderQty').optional().isInt({ min: 1 }),
    body('sellScope').optional().isIn(['village', 'taluka', 'district', 'state', 'all_india']),
    body('tags').optional().isArray(),
    body('images').optional().isArray(),
    body('highlights').optional().isArray(),
    body('specifications').optional().isObject(),
    ...maxLen(PRODUCT_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    const b = req.body;
    const cat = await prisma.category.findUnique({ where: { id: b.categoryId } });
    if (!cat) return sendError(res, 'Invalid category', 400);

    try {
      // Find-or-create, rather than create. An old client sending the same
      // product a second Kendra already listed ATTACHES to it instead of forking
      // the catalogue — which is the entire point of the split.
      const dup = await findCatalogDuplicate({
        categoryId: b.categoryId, brand: b.brand, manufacturer: b.manufacturer, name: b.name,
      });

      const requireQc = await getSetting('catalog.requireQcForNewProducts');
      const unit = stripHtml(b.unit) || 'kg';

      const result = await prisma.$transaction(async (tx) => {
        let productId = dup.duplicate ? dup.productId : null;
        let productStatus = 'APPROVED';

        if (!productId) {
          const created = await tx.product.create({
            data: {
              name: stripHtml(b.name), nameHi: stripHtml(b.nameHi), nameMr: stripHtml(b.nameMr),
              categoryId: b.categoryId, description: stripHtml(b.description),
              brand: stripHtml(b.brand) || null,
              manufacturer: stripHtml(b.manufacturer) || null,
              countryOfOrigin: stripHtml(b.countryOfOrigin) || null,
              subcategory: b.subcategory || null,
              images: b.images || [], tags: b.tags || [],
              highlights: deepStripHtml(b.highlights || []),
              specifications: deepStripHtml(b.specifications) || null,
              normalizedKey: normalizeProductKey({
                categoryId: b.categoryId, brand: b.brand, manufacturer: b.manufacturer, name: b.name,
              }),
              status: requireQc ? 'PENDING_QC' : 'APPROVED',
              createdBySellerId: req.user.id,
              sellerId: req.user.id,          // DUAL-READ
              isActive: !requireQc,           // DUAL-READ
            },
            select: { id: true, status: true },
          });
          productId = created.id;
          productStatus = created.status;
        } else {
          const existing = await tx.product.findUnique({ where: { id: productId }, select: { status: true } });
          productStatus = existing?.status ?? 'APPROVED';
        }

        // One variant per unit — the same axis the backfill uses, so an old client
        // and the migration agree about what a "pack" is.
        let variant = await tx.productVariant.findFirst({ where: { productId, unit } });
        if (!variant) {
          variant = await tx.productVariant.create({
            data: { productId, unit, attributes: { unit }, isDefault: true },
            select: { id: true },
          });
        }

        const stockQty = parseInt(b.stock, 10);
        const listing = await tx.sellerListing.upsert({
          where: { sellerId_variantId: { sellerId: req.user.id, variantId: variant.id } },
          create: {
            sellerId: req.user.id, variantId: variant.id,
            sellingPrice: D(b.price).toFixed(2),
            mrp: b.mrp ? D(b.mrp).toFixed(2) : null,
            stockQty,
            minOrderQty: b.minOrderQty ? parseInt(b.minOrderQty, 10) : 1,
            sellScope: b.sellScope || 'district',
            district: b.district || null, taluka: b.taluka || null,
            village: b.village || null, state: b.state || null,
            harvestDate: b.harvestDate || null,
            status: productStatus === 'APPROVED' ? derivedStatus('ACTIVE', stockQty) : 'INACTIVE',
          },
          update: {
            sellingPrice: D(b.price).toFixed(2),
            stockQty,
            status: productStatus === 'APPROVED' ? derivedStatus('ACTIVE', stockQty) : 'INACTIVE',
          },
        });

        const product = await tx.product.findUnique({
          where: { id: productId },
          include: { category: { select: { id: true, name: true, icon: true, color: true } } },
        });
        return { product, listing };
      });

      await invalidateCatalogCaches();

      if (ENV.CONTENT_FRAUD_ENABLED) {
        flagListingIfSuspicious({ productId: result.product.id, sellerId: req.user.id, name: result.product.name }).catch(() => {});
      }

      // Shaped like the pre-split response so an old client still reads it.
      return sendCreated(res, {
        ...result.product,
        listingId: result.listing.id,
        variantId: result.listing.variantId,
        price: result.listing.sellingPrice,
        stock: result.listing.stockQty,
        attachedToExisting: !!dup.duplicate,
      });
    } catch (err) {
      return sendServerError(res, err, 'Could not save the product. Please try again.');
    }
  },
);

router.get('/seller/products', authenticate, requireRole(...SELLER_ROLES), async (req, res) => {
  const limit = parsePageSize(req.query.limit, 20, 50);
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);

  const [listings, total] = await Promise.all([
    prisma.sellerListing.findMany({
      where: { sellerId: req.user.id },
      include: {
        variant: {
          include: {
            product: {
              include: { category: { select: { id: true, name: true, icon: true, color: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit, take: limit,
    }),
    prisma.sellerListing.count({ where: { sellerId: req.user.id } }),
  ]);

  // Flatten back into the pre-split product shape old clients expect.
  const shaped = listings.map((l) => ({
    ...l.variant.product,
    id: l.variant.product.id,
    listingId: l.id,
    variantId: l.variantId,
    price: l.sellingPrice,
    mrp: l.mrp,
    stock: l.stockQty,
    unit: l.variant.unit,
    minOrderQty: l.minOrderQty,
    sellScope: l.sellScope,
    district: l.district, taluka: l.taluka, village: l.village, state: l.state,
    harvestDate: l.harvestDate,
    isActive: l.status === 'ACTIVE',
    isFeatured: l.isFeatured,
  }));

  return sendSuccess(res, shaped, 200, paginationMeta(total, page, limit));
});

/**
 * Legacy edit. The pre-split version sent the FULL payload via PUT and the
 * handler wrote any key present — so on a shared catalog row, one Kendra editing
 * their price would have overwritten name / description / specs / images FOR
 * EVERY OTHER SELLER. Catalog keys are now rejected outright; only offer fields
 * are applied, and only to this seller's own listing.
 */
router.put(
  '/seller/products/:id',
  authenticate,
  requireRole(...SELLER_ROLES),
  [
    body('price').optional().isFloat({ min: 0.01 }),
    body('stock').optional().isInt({ min: 0 }),
    body('minOrderQty').optional().isInt({ min: 1 }),
    body('sellScope').optional().isIn(['village', 'taluka', 'district', 'state', 'all_india']),
    ...maxLen(PRODUCT_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    const CATALOG_KEYS = ['name', 'nameHi', 'nameMr', 'description', 'brand', 'manufacturer', 'countryOfOrigin', 'highlights', 'specifications', 'images', 'tags', 'subcategory', 'categoryId'];
    const attempted = CATALOG_KEYS.filter((k) => req.body[k] !== undefined);

    const listing = await prisma.sellerListing.findFirst({
      where: { sellerId: req.user.id, variant: { productId: req.params.id } },
    });
    if (!listing) return sendNotFound(res, 'Offer');

    if (attempted.length) {
      return sendError(
        res,
        'Product details are shared with every seller of this product and cannot be edited from an offer. Only your price, stock and delivery details can change here.',
        403,
        { rejectedFields: attempted },
      );
    }

    const b = req.body;
    const data = listingPatch({
      sellingPrice: b.price, mrp: b.mrp, stockQty: b.stock,
      minOrderQty: b.minOrderQty, sellScope: b.sellScope,
      district: b.district, taluka: b.taluka, village: b.village, state: b.state,
      harvestDate: b.harvestDate,
    });
    // `if (isActive !== undefined) data.isActive = isActive` with no state-machine
    // guard is exactly how a seller could flip their own visibility unchecked.
    // A seller may pause or resume; they cannot clear a BLOCKED state.
    if (b.isActive !== undefined) {
      if (listing.status === 'BLOCKED') return sendForbidden(res, 'This offer has been blocked by CropSetu. Contact support.');
      data.status = derivedStatus(b.isActive ? 'ACTIVE' : 'INACTIVE', data.stockQty ?? listing.stockQty);
    } else if (data.stockQty !== undefined && listing.status !== 'BLOCKED') {
      data.status = derivedStatus(listing.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', data.stockQty);
    }

    const updated = await prisma.sellerListing.update({ where: { id: listing.id }, data });
    await invalidateCatalogCaches();
    return sendSuccess(res, updated);
  }
);

router.delete('/seller/products/:id', authenticate, requireRole(...SELLER_ROLES), async (req, res) => {
  const listing = await prisma.sellerListing.findFirst({
    where: { sellerId: req.user.id, variant: { productId: req.params.id } },
  });
  if (!listing) return sendNotFound(res, 'Offer');

  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { listingId: listing.id } }),
    prisma.sellerListing.delete({ where: { id: listing.id } }),
  ]);
  await invalidateCatalogCaches();

  auditAction(req, {
    action: AUDIT_ACTIONS.PRODUCT_DELETE,
    entity: 'SellerListing',
    entityId: listing.id,
    metadata: { sellerId: req.user.id, productId: req.params.id },
  }).catch(() => {});

  return sendSuccess(res, { archived: true });
});

router.get('/seller/stats', authenticate, requireRole(...SELLER_ROLES), async (req, res) => {
  const stats = await getSellerStats(req.user.id);
  return sendSuccess(res, stats);
});

// ── Seller: order item status ─────────────────────────────────────────────────
router.put(
  '/seller/orders/:orderId/status',
  authenticate,
  requireRole(...SELLER_ROLES),
  [
    body('status')
      .isIn(['CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'])
      .withMessage('status must be one of CONFIRMED, SHIPPED, DELIVERED, CANCELLED'),
  ],
  validate,
  async (req, res) => {
    const { orderId } = req.params;
    const { status }  = req.body;

    try {
      const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        const mine = await tx.orderItem.findMany({
          where: { orderId, sellerId: req.user.id },
          select: { id: true, status: true, quantity: true, listingId: true, productId: true },
        });
        if (!mine.length) return null;

        const now = new Date();
        await tx.orderItem.updateMany({
          where: { orderId, sellerId: req.user.id },
          // Transition timestamps are the ONLY source for dispatch SLA and
          // cancellation rate — without them sellerMetrics has nothing to read.
          data: { status, ...transitionTimestampFor(status, now) },
        });

        // A seller-set CANCELLED never restocked, unlike buyer-cancel. The units
        // stayed reserved against an order nobody was going to receive.
        let crossedZero = [];
        if (status === 'CANCELLED') {
          const deltas = mine
            .filter((i) => i.listingId && i.status !== 'CANCELLED')
            .map((i) => ({ listingId: i.listingId, delta: i.quantity }));
          ({ crossedZero } = await applyListingStockDeltas(tx, deltas));
          await syncListingStockStatus(tx, crossedZero);
          // Pre-backfill items, same as the buyer-cancel path above.
          await applyStockDeltas(tx, mine
            .filter((i) => !i.listingId && i.productId && i.status !== 'CANCELLED')
            .map((i) => ({ productId: i.productId, delta: i.quantity })));
        }

        // The rollup used to run OUTSIDE the transaction, so two sellers updating
        // the same multi-seller order concurrently could each persist a rollup
        // computed from a stale read. It is inside now, under Serializable.
        const allItems = await tx.orderItem.findMany({ where: { orderId }, select: { status: true } });
        const statuses = allItems.map((i) => i.status);
        const live = statuses.filter((s) => s !== 'CANCELLED');

        // A partially-cancelled order used to read as PENDING: `every(DELIVERED)`
        // failed because of the cancelled item, and none of the ANY branches
        // matched. The rollup now describes the items that are still live, so an
        // order with one item cancelled and one delivered reads DELIVERED.
        let orderStatus;
        if (!statuses.length)      orderStatus = 'PENDING';
        else if (!live.length)     orderStatus = 'CANCELLED';
        else if (live.every((s) => s === 'DELIVERED')) orderStatus = 'DELIVERED';
        else if (live.includes('SHIPPED'))   orderStatus = 'SHIPPED';
        else if (live.includes('CONFIRMED')) orderStatus = 'CONFIRMED';
        else orderStatus = 'PENDING';

        const before = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
        await tx.order.update({ where: { id: orderId }, data: { status: orderStatus } });

        return { itemsUpdated: mine.length, orderStatus, previousStatus: before?.status, crossedZero };
      }, { isolationLevel: 'Serializable' }));

      if (!result) return sendNotFound(res, 'Order');
      if (result.crossedZero?.length) await invalidateCatalogCaches();

      auditOrderStatusChange(req, orderId, result.previousStatus, result.orderStatus).catch(() => {});

      return sendSuccess(res, {
        orderId,
        itemsUpdated: result.itemsUpdated,
        itemStatus: status,
        orderStatus: result.orderStatus,
      });
    } catch (err) {
      return sendServerError(res, err, 'Could not update the order. Please try again.');
    }
  }
);

router.get('/seller/orders', authenticate, requireRole(...SELLER_ROLES), async (req, res) => {
  const page  = parsePageNumber(req.query.page);
  const limit = parsePageSize(req.query.limit, 15, 50);
  const [items, total] = await Promise.all([
    prisma.orderItem.findMany({
      where: { sellerId: req.user.id },
      include: {
        product: { select: { id: true, name: true, images: true } },
        order: {
          select: {
            id: true, status: true, paymentMethod: true, paymentStatus: true,
            deliveryAddress: true, createdAt: true,
            user: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { order: { createdAt: 'desc' } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.orderItem.count({ where: { sellerId: req.user.id } }),
  ]);

  // The unit sold lives on the VARIANT now, not on the product row.
  const variantIds = [...new Set(items.map((i) => i.variantId).filter(Boolean))];
  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, unit: true, attributes: true },
      })
    : [];
  const byVariant = new Map(variants.map((v) => [v.id, v]));
  for (const i of items) i.variant = i.variantId ? byVariant.get(i.variantId) || null : null;

  return sendSuccess(res, items, 200, paginationMeta(total, page, limit));
});

// ── Product review ────────────────────────────────────────────────────────────
router.post(
  '/products/:id/review',
  authenticate,
  [
    body('rating').isInt({ min: 1, max: 5 }),
    body('comment').optional().trim().isLength({ max: 500 }),
    body('orderItemId').optional().isUUID(),
  ],
  validate,
  async (req, res) => {
    const { rating, comment, orderItemId } = req.body;
    const productId = req.params.id;
    const safeComment = stripHtml(comment) || null;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return sendNotFound(res, 'Product');

    // There was no verified-purchase check and no requireRole — any authenticated
    // user could review any product. A review is now anchored to a delivered
    // order item, which is also what makes it attributable to a SELLER: without
    // that, buy-box weight w2 has no honest source.
    const purchase = await prisma.orderItem.findFirst({
      where: {
        ...(orderItemId ? { id: orderItemId } : {}),
        productId,
        order: { userId: req.user.id },
        status: 'DELIVERED',
      },
      select: { id: true, sellerId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!purchase) {
      return sendError(res, 'You can only review a product you have received.', 403);
    }

    // Serializable, because this is a read-modify-write of a denormalised
    // counter and the read is an aggregate over a table the racers are all
    // inserting into. Under the default Read Committed each concurrent reviewer
    // takes its own snapshot of `reviews`, counts the subset that had committed
    // by then, and writes that stale total over the product — last writer wins,
    // with an undercount. Five simultaneous reviews reproducibly left
    // ratingCount at 3, and `rating`/`ratingCount` are what order the storefront
    // and feed the buy box, so the discarded ratings are not cosmetic.
    //
    // Retried for the same reason checkout is: losing a serialization race is a
    // normal event here, not a server error, and the replay re-runs the
    // aggregate against the winner's committed row.
    //
    // A larger attempt budget than checkout's default 3, because the contention
    // shape is different. Checkout racers conflict only when they want the same
    // listing; every reviewer of one product conflicts with every other by
    // construction, since they all rewrite the same counter row. With N
    // simultaneous reviewers one of them can lose N-1 times before it is the
    // only writer left, so a budget of 3 turns the fifth reviewer's 409-shaped
    // retry into a 500. Six covers realistic same-product concurrency; the
    // backoff is 25 ms × attempt + jitter, so the worst case is a few hundred
    // milliseconds on a request that is already writing.
    const review = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      // Keyed on the ORDER ITEM. The old @@unique([userId, productId]) meant a
      // buyer who bought the same seed from two Kendras could rate only one.
      const r = await tx.review.upsert({
        where: { userId_orderItemId: { userId: req.user.id, orderItemId: purchase.id } },
        create: {
          userId: req.user.id, productId, orderItemId: purchase.id,
          sellerId: purchase.sellerId, rating, comment: safeComment,
        },
        update: { rating, comment: safeComment },
      });

      const agg = await tx.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { rating: true },
      });
      await tx.product.update({
        where: { id: productId },
        data: { rating: agg._avg.rating || 0, ratingCount: agg._count.rating },
      });

      return r;
    }, { isolationLevel: 'Serializable' }), { attempts: 6 });

    // Product rating orders the storefront; seller rating feeds the buy box.
    await invalidateCatalogCaches();

    if (ENV.CONTENT_FRAUD_ENABLED) {
      flagReviewIfSuspicious({ reviewId: review.id, userId: req.user.id, comment: safeComment }).catch(() => {});
    }

    return sendCreated(res, review);
  }
);

export default router;
