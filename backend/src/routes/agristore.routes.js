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
import { cachedListing, bumpListingVersion } from '../utils/listingCache.js';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendServerError, paginationMeta, parsePageSize } from '../utils/response.js';
import { keysetPage } from '../utils/keyset.js';
import { applyListingStockDeltas } from '../utils/stockBatch.js';
import { withSerializableRetry } from '../utils/txRetry.js';
import { D, toMinorUnits } from '../utils/money.js';
import { stripHtml, deepStripHtml } from '../utils/encrypt.js';
import { createPaymentOrder, verifyPaymentSignature, fetchPaymentOrder } from '../services/payment.service.js';
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

/**
 * Aggregate the cart total in ONE query, for paths that need only the number.
 *
 * THIS IS THE ONLY TOTAL THAT AUTHORISES THE RAZORPAY AMOUNT at /orders/initiate.
 * A wrong join here charges the wrong amount, so it is spelled out rather than
 * shared with the in-memory path — but it must mirror cartTotal() exactly.
 *
 * DUAL-READ: the LEFT JOIN onto products, and COALESCE onto p.price, exist only
 * so a cart row written before the backfill still contributes its real price
 * instead of silently dropping out of the SUM (which would UNDERCHARGE). Delete
 * both at CONTRACT, when cart_items.productId is gone.
 */
async function cartTotalFromDB(userId) {
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count,
           COALESCE(SUM(COALESCE(l."sellingPrice", p."price") * c."quantity"), 0) AS total
    FROM cart_items c
    LEFT JOIN seller_listings l ON l."id" = c."listingId"
    LEFT JOIN products p        ON p."id" = c."productId"
    WHERE c."userId" = ${userId}
  `;
  return { count: row?.count ?? 0, total: D(row?.total ?? 0) };
}

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
router.get('/categories', async (_req, res) => {
  const { data, cached } = await cachedListing(NS_CATEGORIES, 'all', CATEGORIES_TTL, async () => ({
    data: await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
  }));
  res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
  return sendSuccess(res, data);
});

// ── Storefront product list (public) ──────────────────────────────────────────
router.get(
  '/products',
  optionalAuth,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  validate,
  async (req, res) => {
    const page  = parseInt(req.query.page  || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const { category, featured, subcategory } = req.query;
    const search = sanitizeSearch(req.query.search);
    const buyer  = buyerScope(req);

    // Catalog-side predicates.
    const and = [{ status: 'APPROVED' }];
    if (category)    and.push({ categoryId: category });
    if (subcategory) and.push({ subcategory });
    if (search) {
      and.push({
        OR: [
          { name:        { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { tags:        { has: search.toLowerCase() } },
        ],
      });
    }

    // Offer-side predicates. Geography now gates at the LISTING level, which is
    // where sellScope/district actually live; the pre-split filter compared them
    // on the fused product row.
    const listingWhere = {
      status: 'ACTIVE',
      stockQty: { gt: 0 },
      ...(featured ? { isFeatured: true } : {}),
      ...listingGeoWhere(buyer),
    };
    and.push({
      OR: [
        { variants: { some: { listings: { some: listingWhere } } } },
        // DUAL-READ: not yet migrated — judge it on the legacy columns so it does
        // not vanish from the storefront mid-migration.
        {
          variants: { none: {} },
          isActive: true,
          ...(featured ? { isFeatured: true } : {}),
          ...(buyer.district ? { OR: [{ district: { equals: buyer.district, mode: 'insensitive' } }, { district: null }] } : {}),
        },
      ],
    });

    const where = { AND: and };

    const identity = JSON.stringify([
      category || '', subcategory || '', featured ? 1 : 0,
      buyer.district || '', buyer.taluka || '', buyer.village || '', buyer.state || '',
      search || '', page, limit,
    ]);
    const { data, meta, cached } = await cachedListing(NS_PRODUCTS, identity, PRODUCTS_TTL, async () => {
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: { category: { select: { id: true, name: true, icon: true, color: true } } },
          skip: (page - 1) * limit,
          take: limit,
          // `id` is the unique tiebreaker. Without it, rows sharing a rating
          // ordered arbitrarily between queries, so offset pages duplicated and
          // skipped rows. isFeatured is no longer a product column post-split —
          // featuring is per-offer and is applied as a FILTER above instead.
          orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        }),
        prisma.product.count({ where }),
      ]);
      return { data: await decorateWithOffers(products, buyer), meta: paginationMeta(total, page, limit) };
    });

    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return sendSuccess(res, data, 200, meta);
  }
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

  const buyBox = await getProductBuyBox(product.id, buyer);

  return sendSuccess(res, {
    ...product,
    variants: buyBox.variants,
    offerCount: buyBox.offerCount,
    lowestPrice: buyBox.lowestPrice,
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

// ── Cart ──────────────────────────────────────────────────────────────────────
const CART_INCLUDE = {
  // DUAL-READ: `product` is still included so pre-backfill rows render.
  product: { include: { category: { select: { name: true } } } },
  listing: {
    include: {
      seller: { select: { id: true, name: true, district: true, state: true } },
      variant: {
        include: {
          product: {
            select: { id: true, name: true, nameHi: true, nameMr: true, images: true, brand: true },
          },
        },
      },
    },
  },
};

router.get('/cart', authenticate, async (req, res) => {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user.id },
    include: CART_INCLUDE,
    orderBy: { createdAt: 'asc' },
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

  return sendSuccess(res, { items: withDrift, total: cartTotal(items) });
});

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

      return sendCreated(res, item);
    } catch (err) {
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
async function validateCartForCheckout(tx, userId) {
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

  for (const item of cartItems) {
    const label = item.listing?.variant?.productId ? item.product?.name : item.product?.name;

    if (item.listingId) {
      const l = freshById.get(item.listingId);
      if (!l || l.status !== 'ACTIVE') {
        throw Object.assign(new Error(`"${label}" is no longer available from this seller`), { statusCode: 400, expose: true });
      }
      if (l.stockQty < item.quantity) {
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
        productId: p.id, listingId: null, variantId: null, sellerId: p.sellerId || null,
        quantity: item.quantity, unitPrice: p.price, totalPrice: D(p.price).times(item.quantity),
      });
    }
  }

  return { cartItems, orderItems, deltas, total: cartTotal(cartItems) };
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
  const { name, phone, city, state, pincode } = deliveryAddress;
  if (!name || !phone || !city || !state || !pincode) {
    throw Object.assign(new Error('Delivery address must include name, phone, city, state, and pincode'), { statusCode: 400, expose: true });
  }
  return deepStripHtml(deliveryAddress);
}

router.post(
  '/orders',
  authenticate,
  velocityGuard(VELOCITY_ACTIONS.ORDER),
  [
    body('paymentMethod').optional().isIn(['cod', 'upi', 'card']),
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
    body('expectedTotal').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    const { paymentMethod = 'cod', notes, expectedTotal } = req.body;

    try {
      const deliveryAddress = await resolveDeliveryAddress(req);

      // Two buyers racing for the last unit is a NORMAL marketplace event, not a
      // server error — a 40001 abort is replayed instead of surfacing as a 500.
      const { order, crossedZero } = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        const { orderItems, deltas, total } = await validateCartForCheckout(tx, req.user.id);
        assertClientTotalMatches(expectedTotal, total);

        const o = await tx.order.create({
          data: {
            userId: req.user.id,
            totalAmount: total,
            deliveryAddress,
            paymentMethod,
            notes,
            items: { create: orderItems },
          },
          include: { items: { include: { product: true } } },
        });

        const { crossedZero } = await applyListingStockDeltas(tx, deltas);
        await syncListingStockStatus(tx, crossedZero);
        await tx.cartItem.deleteMany({ where: { userId: req.user.id } });

        return { order: o, crossedZero };
      }, { isolationLevel: 'Serializable' }));

      // Only a zero crossing can change a buy-box winner, so only that bumps the
      // cache. Ordinary decrements ride the 60 s TTL, as before.
      if (crossedZero.length) await invalidateCatalogCaches();

      if (ENV.DEVICE_FINGERPRINT_ENABLED) {
        recordDeviceLink({ userId: req.user.id, fingerprint: strongDeviceId(req), ip: req.ip, context: 'order' }).catch(() => {});
      }

      return sendCreated(res, order);
    } catch (err) {
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

    // Restock the OFFERS, not the catalog rows. Pre-backfill items have no
    // listingId and are skipped here — their stock still lives on the product row
    // and is restored by the legacy path below.
    const listingDeltas = order.items
      .filter((i) => i.listingId)
      .map((i) => ({ listingId: i.listingId, delta: i.quantity }));
    const { crossedZero } = await applyListingStockDeltas(tx, listingDeltas);
    await syncListingStockStatus(tx, crossedZero);

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
  [
    body('paymentMethod').isIn(['upi', 'card']).withMessage('paymentMethod must be upi or card'),
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
    body('expectedTotal').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { expectedTotal } = req.body;
      const { count, total: totalAmount } = await cartTotalFromDB(req.user.id);
      if (!count) return sendError(res, 'Cart is empty', 400);

      if (expectedTotal !== undefined && toPaise(expectedTotal) !== toPaise(totalAmount)) {
        return sendError(res, 'Cart total has changed. Please review your cart and try again.', 400);
      }

      const amountInPaise = toPaise(totalAmount);
      const razorpayOrder = await createPaymentOrder(amountInPaise, 'INR', `cart_${req.user.id}`);

      return sendSuccess(res, {
        razorpayOrderId: razorpayOrder.id,
        amount: totalAmount,
        amountInPaise,
        currency: 'INR',
        mock: razorpayOrder.mock || false,
      });
    } catch {
      return sendError(res, 'Payment initiation failed', 500);
    }
  }
);

// ── Payment: confirm ──────────────────────────────────────────────────────────
router.post(
  '/orders/confirm',
  authenticate,
  velocityGuard(VELOCITY_ACTIONS.ORDER),
  [
    body('razorpayOrderId').notEmpty(),
    body('razorpayPaymentId').notEmpty(),
    body('razorpaySignature').notEmpty(),
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
    body('expectedTotal').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, expectedTotal } = req.body;

    if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return sendError(res, 'Payment verification failed — signature mismatch', 400);
    }

    try {
      const deliveryAddress = await resolveDeliveryAddress(req);
      const paymentOrder = await fetchPaymentOrder(razorpayOrderId);

      const { order, crossedZero } = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        const { orderItems, deltas, total } = await validateCartForCheckout(tx, req.user.id);
        assertClientTotalMatches(expectedTotal, total);

        if (!paymentOrder.mock) {
          if (paymentOrder.receipt !== `cart_${req.user.id}`) {
            throw Object.assign(
              new Error('This payment does not match your cart.'),
              { statusCode: 400, expose: true, tamper: { kind: 'receipt_mismatch', expectedPaise: toPaise(total), actualPaise: Number(paymentOrder.amount) } },
            );
          }
          if (toPaise(total) !== Number(paymentOrder.amount)) {
            throw Object.assign(
              new Error('Paid amount does not match your cart total. Your cart may have changed — no order was created.'),
              { statusCode: 400, expose: true, tamper: { kind: 'paid_amount_mismatch', expectedPaise: toPaise(total), actualPaise: Number(paymentOrder.amount) } },
            );
          }
        }

        const o = await tx.order.create({
          data: {
            userId: req.user.id,
            totalAmount: total,
            deliveryAddress,
            paymentMethod: 'online',
            paymentStatus: 'paid',
            notes: `razorpay:${razorpayPaymentId}`,
            // Unique column. Replaying the same signed triple after re-filling
            // the cart now fails at the DB (P2002) instead of creating a second
            // fully-paid order — the payment id used to live only in `notes`.
            paymentRef: razorpayPaymentId,
            items: { create: orderItems },
          },
          include: { items: { include: { product: true } } },
        });

        const { crossedZero } = await applyListingStockDeltas(tx, deltas);
        await syncListingStockStatus(tx, crossedZero);
        await tx.cartItem.deleteMany({ where: { userId: req.user.id } });
        return { order: o, crossedZero };
      }, { isolationLevel: 'Serializable' }));

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
  const decorated = await Promise.all(listings.map(async (l) => {
    const { offers } = await rankOffersForVariant(l.variantId, {});
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
  }));

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
          select: { id: true, status: true, quantity: true, listingId: true },
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
  const page  = parseInt(req.query.page  || '1', 10);
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

    const review = await prisma.$transaction(async (tx) => {
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
    });

    // Product rating orders the storefront; seller rating feeds the buy box.
    await invalidateCatalogCaches();

    if (ENV.CONTENT_FRAUD_ENABLED) {
      flagReviewIfSuspicious({ reviewId: review.id, userId: req.user.id, comment: safeComment }).catch(() => {});
    }

    return sendCreated(res, review);
  }
);

export default router;
