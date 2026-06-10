/**
 * AgriStore Routes
 * GET  /api/v1/agristore/categories
 * GET  /api/v1/agristore/products           ?category&search&page&limit
 * GET  /api/v1/agristore/products/:id
 * GET  /api/v1/agristore/cart
 * POST /api/v1/agristore/cart               { productId, quantity }
 * PUT  /api/v1/agristore/cart/:productId    { quantity }
 * DELETE /api/v1/agristore/cart/:productId
 * POST /api/v1/agristore/orders             { deliveryAddress, paymentMethod, notes }
 * GET  /api/v1/agristore/orders
 * GET  /api/v1/agristore/orders/:id
 * POST /api/v1/agristore/products/:id/review { rating, comment }
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
import { sendSuccess, sendCreated, sendError, sendNotFound, sendServerError, paginationMeta, parsePageSize } from '../utils/response.js';
import { keysetPage } from '../utils/keyset.js';
import { applyStockDeltas } from '../utils/stockBatch.js';
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
import { ENV } from '../config/env.js';

const router = Router();
router.param('id', uuidParamGuard);        // product / order / seller-product ids
router.param('productId', uuidParamGuard); // cart item product id

// ── Authoritative pricing helpers ─────────────────────────────────────────────
// Cart totals are ALWAYS recomputed server-side from the DB product price — the
// client's number is never trusted as the source of truth. When the client also
// sends the total it displayed (`expectedTotal`), assertClientTotalMatches
// REJECTS the checkout if that number disagrees with the server computation.
// This defends against a tampered client trying to understate the total, and
// also surfaces price/stock drift since the cart was last viewed. Compared in
// integer paise to avoid floating-point drift.
const toPaise = (amount) => toMinorUnits(amount, 100);
// Sum line items exactly in Decimal (price is a Prisma.Decimal). Returns a Decimal.
// Used where the line items are already loaded in memory (cart listing, checkout,
// payment-verify — all of which need the rows for other reasons anyway).
const cartTotal = (cartItems) => cartItems.reduce((sum, i) => sum.plus(D(i.product.price).times(i.quantity)), D(0));

// Aggregate the cart total in a SINGLE SQL query — SUM(price * quantity) joined
// across cart_items → products — for paths that need ONLY the total, not the
// rows. Avoids shipping every line item + full product object back just to add
// them up in memory. Postgres returns numeric SUM as a string; D() parses it
// into an exact Decimal. COUNT lets callers detect an empty cart without a
// second query. Mirrors cartTotal()'s arithmetic exactly (no isActive filter —
// stock/availability is revalidated later inside the checkout transaction).
async function cartTotalFromDB(userId) {
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count,
           COALESCE(SUM(p.price * c.quantity), 0) AS total
    FROM cart_items c
    JOIN products p ON p.id = c."productId"
    WHERE c."userId" = ${userId}
  `;
  return { count: row?.count ?? 0, total: D(row?.total ?? 0) };
}

function assertClientTotalMatches(expectedTotal, authoritativeTotal) {
  if (expectedTotal === undefined || expectedTotal === null) return;
  if (toPaise(expectedTotal) !== toPaise(authoritativeTotal)) {
    throw Object.assign(
      new Error('Cart total has changed. Please review your cart and try again.'),
      // `tamper` lets the confirm flow (FRAUD-6) raise an alarm on a client/server
      // amount mismatch; harmless on other callers, which don't read it.
      { statusCode: 400, expose: true, tamper: { kind: 'client_total_mismatch', expectedPaise: toPaise(expectedTotal), actualPaise: toPaise(authoritativeTotal) } },
    );
  }
}

// ── Listing cache namespaces + short TTLs ─────────────────────────────────────
// Public catalogue reads are identical across users, so we cache them in Redis
// (shared across instances) and invalidate by bumping the namespace version on
// any catalogue write. TTLs are short so order-driven stock drift (which we do
// NOT invalidate on — too write-heavy) self-corrects quickly; cart/checkout always
// re-reads fresh stock inside its transaction, so listings showing slightly stale
// stock is safe.
const NS_CATEGORIES = 'agristore:categories';
const NS_PRODUCTS   = 'agristore:products';
const CATEGORIES_TTL = 300; // categories change rarely (seed/migration)
const PRODUCTS_TTL   = 60;  // short — bounds stock drift between writes

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

// ── Products list (public) ────────────────────────────────────────────────────
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
    const { category, featured, district } = req.query;
    const search = sanitizeSearch(req.query.search); // strip LIKE wildcards / cap length

    const { subcategory } = req.query;
    const where = { isActive: true };
    if (category)    where.categoryId  = category;
    if (subcategory) where.subcategory = subcategory;
    if (featured)    where.isFeatured  = true;
    if (search) {
      where.OR = [
        { name:        { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags:        { has: search.toLowerCase() } },
      ];
    }

    // District filter: show products for that district + products with no restriction (national)
    if (district) {
      where.AND = [{
        OR: [
          { district: { equals: district, mode: 'insensitive' } },
          { district: null },
        ],
      }];
    }

    // Cache per distinct query-param signature. The response is user-independent
    // (the WHERE clause uses only public filters), so it's safe to share globally.
    const identity = JSON.stringify([category || '', subcategory || '', featured ? 1 : 0, district || '', search || '', page, limit]);
    const { data, meta, cached } = await cachedListing(NS_PRODUCTS, identity, PRODUCTS_TTL, async () => {
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: { category: { select: { id: true, name: true, icon: true, color: true } } },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ isFeatured: 'desc' }, { rating: 'desc' }],
        }),
        prisma.product.count({ where }),
      ]);
      return { data: products, meta: paginationMeta(total, page, limit) };
    });

    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return sendSuccess(res, data, 200, meta);
  }
);

// ── Single product ────────────────────────────────────────────────────────────
router.get('/products/:id', async (req, res) => {
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
  return sendSuccess(res, product);
});

// ── Cart (auth required) ──────────────────────────────────────────────────────
router.get('/cart', authenticate, async (req, res) => {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user.id },
    include: { product: { include: { category: { select: { name: true } } } } },
  });
  const total = cartTotal(items);
  return sendSuccess(res, { items, total });
});

router.post(
  '/cart',
  authenticate,
  [
    body('productId').notEmpty(),
    body('quantity').isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    const { productId, quantity } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) return sendNotFound(res, 'Product');

    // Cap by stock against the post-add total, not just the increment.
    const existing = await prisma.cartItem.findUnique({
      where: { userId_productId: { userId: req.user.id, productId } },
    });
    const totalAfter = (existing?.quantity || 0) + quantity;
    if (product.stock < totalAfter) {
      return sendError(res, `Only ${product.stock} in stock`, 400);
    }

    const item = await prisma.cartItem.upsert({
      where: { userId_productId: { userId: req.user.id, productId } },
      create: { userId: req.user.id, productId, quantity },
      update: { quantity: { increment: quantity } },
      include: { product: true },
    });

    return sendCreated(res, item);
  }
);

router.put(
  '/cart/:productId',
  authenticate,
  [body('quantity').isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    const product = await prisma.product.findUnique({ where: { id: req.params.productId } });
    if (!product || !product.isActive) return sendNotFound(res, 'Product');
    if (product.stock < req.body.quantity) {
      return sendError(res, `Only ${product.stock} in stock`, 400);
    }
    const item = await prisma.cartItem.updateMany({
      where: { userId: req.user.id, productId: req.params.productId },
      data: { quantity: req.body.quantity },
    });
    if (!item.count) return sendNotFound(res, 'Cart item');
    return sendSuccess(res, { updated: true });
  }
);

router.delete('/cart/:productId', authenticate, async (req, res) => {
  await prisma.cartItem.deleteMany({
    where: { userId: req.user.id, productId: req.params.productId },
  });
  return sendSuccess(res, { deleted: true });
});

// ── Orders ────────────────────────────────────────────────────────────────────
// velocityGuard(ORDER): FRAUD-1 — block/flag runaway checkout velocity per
// user/device/IP. Guards the two endpoints that actually PLACE an order (this
// COD path + /orders/confirm for online); /orders/initiate is intentionally not
// counted so a single online purchase (initiate→confirm) isn't double-counted.
router.post(
  '/orders',
  authenticate,
  velocityGuard(VELOCITY_ACTIONS.ORDER),
  [
    body('paymentMethod').optional().isIn(['cod', 'upi', 'card']),
    // Accept either a saved address id OR an inline address object
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
    // Optional client-displayed total — server recomputes and rejects on mismatch.
    body('expectedTotal').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    let { deliveryAddress, deliveryAddressId, paymentMethod = 'cod', notes, expectedTotal } = req.body;

    // Resolve address from saved address if id provided
    if (deliveryAddressId) {
      const saved = await prisma.savedAddress.findFirst({
        where: { id: deliveryAddressId, userId: req.user.id },
      });
      if (!saved) return sendError(res, 'Saved address not found', 400);
      deliveryAddress = {
        type:    saved.type,
        name:    saved.name,
        phone:   saved.phone,
        flat:    saved.flat,
        street:  saved.street,
        city:    saved.city,
        state:   saved.state,
        pincode: saved.pincode,
        ...(saved.landmark ? { landmark: saved.landmark } : {}),
      };
    }

    if (!deliveryAddress || typeof deliveryAddress !== 'object') {
      return sendError(res, 'deliveryAddress or deliveryAddressId is required', 400);
    }

    // [FIX] Validate required address fields
    const { name: addrName, phone: addrPhone, city, state: addrState, pincode } = deliveryAddress;
    if (!addrName || !addrPhone || !city || !addrState || !pincode) {
      return sendError(res, 'Delivery address must include name, phone, city, state, and pincode', 400);
    }

    // [FIX #7] Sanitize delivery address to prevent XSS in stored JSON
    deliveryAddress = deepStripHtml(deliveryAddress);

    // [FIX #2] Entire checkout (cart read + stock validation + order create + stock
    // decrement + cart clear) runs inside a Serializable transaction to prevent
    // two concurrent checkouts of the last unit from both succeeding.
    try {
      const order = await prisma.$transaction(async (tx) => {
        const cartItems = await tx.cartItem.findMany({
          where: { userId: req.user.id },
          include: { product: true },
        });
        if (!cartItems.length) {
          throw Object.assign(new Error('Cart is empty'), { statusCode: 400, expose: true });
        }

        // Validate stock INSIDE the transaction so concurrent checkouts
        // see consistent stock values. Batch-fetch all products in one query
        // (constant query count regardless of cart size) and validate in memory.
        const freshProducts = await tx.product.findMany({
          where: { id: { in: cartItems.map((i) => i.productId) } },
        });
        const freshById = new Map(freshProducts.map((p) => [p.id, p]));
        for (const item of cartItems) {
          const freshProduct = freshById.get(item.productId);
          if (!freshProduct || !freshProduct.isActive) {
            throw Object.assign(new Error(`Product "${item.product.name}" is no longer available`), { statusCode: 400, expose: true });
          }
          if (freshProduct.stock < item.quantity) {
            throw Object.assign(new Error(`Insufficient stock for ${freshProduct.name}`), { statusCode: 400, expose: true });
          }
        }

        const totalAmount = cartTotal(cartItems);

        // Reject if the client's displayed total disagrees with the server's
        // authoritative recomputation (tampered client / stale price).
        assertClientTotalMatches(expectedTotal, totalAmount);

        const o = await tx.order.create({
          data: {
            userId: req.user.id,
            totalAmount,
            deliveryAddress,
            paymentMethod,
            notes,
            items: {
              create: cartItems.map((i) => ({
                productId:  i.productId,
                sellerId:   i.product.sellerId || null,
                quantity:   i.quantity,
                unitPrice:  i.product.price,
                totalPrice: D(i.product.price).times(i.quantity),
              })),
            },
          },
          include: { items: { include: { product: true } } },
        });

        // Decrement stock for the whole cart in a single statement.
        await applyStockDeltas(tx, cartItems.map((i) => ({ productId: i.productId, delta: -i.quantity })));

        // Clear cart
        await tx.cartItem.deleteMany({ where: { userId: req.user.id } });

        return o;
      }, {
        isolationLevel: 'Serializable',
      });

      // FRAUD-3: record device→account link for multi-account detection (no-op
      // without an X-Device-Id header). Fire-and-forget — never delays checkout.
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

  // Keyset pagination (flat deep-page latency): used when the client sends a
  // cursor, or on the first page when it opts in with ?paginate=cursor. Rides
  // the [userId, createdAt] index. Falls back to legacy offset otherwise so
  // existing page-based clients keep working.
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

// ── [FIX #15] Buyer order cancellation ───────────────────────────────────────
// Two complementary fraud layers run before the handler:
//   • velocityGuard(REFUND) — FRAUD-1: short-window cancel/refund BURST per
//     user/device/IP (temporary block).
//   • refundAbuseGuard()    — FRAUD-2: SERIAL refund abuse over the account's
//     order history (restricts repeat offenders, flags for review).
// Both target cancellation, the buyer-initiated reversal that exists today; real
// Razorpay refunds, when wired, reuse the same guards.
router.put('/orders/:id/cancel', authenticate, velocityGuard(VELOCITY_ACTIONS.REFUND), refundAbuseGuard(), async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { items: true },
  });
  if (!order) return sendNotFound(res, 'Order');

  if (order.status !== 'PENDING') {
    return sendError(res, `Cannot cancel a ${order.status.toLowerCase()} order. Only pending orders can be cancelled.`, 400);
  }

  // Cancel order + restore stock in a transaction
  const cancelled = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });

    // Restore stock for the whole order in a single statement.
    await applyStockDeltas(tx, order.items.map((item) => ({ productId: item.productId, delta: item.quantity })));

    // Cancel every item of this order in one statement.
    await tx.orderItem.updateMany({
      where: { orderId: order.id },
      data: { status: 'CANCELLED' },
    });

    return updated;
  });

  // Audit log the cancellation
  auditOrderStatusChange(req, cancelled.id, 'PENDING', 'CANCELLED').catch(() => {});

  return sendSuccess(res, { id: cancelled.id, status: cancelled.status });
});

// ── Payment: initiate (Razorpay) ─────────────────────────────────────────────
// Step 1: Client calls this to get a Razorpay order ID for the checkout modal.
// Step 2: Client opens Razorpay SDK with the returned orderId.
// Step 3: After payment, client calls POST /orders/confirm with payment details.
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

      // We need only the authoritative total here (not the line items), so let
      // the DB aggregate it in one query instead of fetching every cart row.
      const { count, total: totalAmount } = await cartTotalFromDB(req.user.id);
      if (!count) return sendError(res, 'Cart is empty', 400);

      // Authorize the SERVER total, not the client's. Reject before creating the
      // payment order if the client's displayed total disagrees.
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
    } catch (err) {
      return sendError(res, 'Payment initiation failed', 500);
    }
  }
);

// ── Payment: confirm ─────────────────────────────────────────────────────────
// Called after Razorpay checkout succeeds. Verifies HMAC signature, then
// creates the order exactly like POST /orders but with paymentStatus = 'paid'.
router.post(
  '/orders/confirm',
  authenticate,
  velocityGuard(VELOCITY_ACTIONS.ORDER), // FRAUD-1: count the completed online order
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
    const {
      razorpayOrderId, razorpayPaymentId, razorpaySignature,
      deliveryAddress: rawAddress, deliveryAddressId, expectedTotal,
    } = req.body;

    // Verify Razorpay signature (HMAC SHA256)
    const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
    if (!isValid) {
      return sendError(res, 'Payment verification failed — signature mismatch', 400);
    }

    // Resolve delivery address
    let deliveryAddress = rawAddress;
    if (deliveryAddressId) {
      const saved = await prisma.savedAddress.findFirst({
        where: { id: deliveryAddressId, userId: req.user.id },
      });
      if (!saved) return sendError(res, 'Saved address not found', 400);
      deliveryAddress = {
        type: saved.type, name: saved.name, phone: saved.phone,
        flat: saved.flat, street: saved.street, city: saved.city,
        state: saved.state, pincode: saved.pincode,
      };
    }

    if (!deliveryAddress) return sendError(res, 'deliveryAddress is required', 400);
    deliveryAddress = deepStripHtml(deliveryAddress);

    try {
      // Authoritative record of what was actually authorized/captured at /initiate.
      // Fetched OUTSIDE the txn (external call); bound to the cart total inside it.
      const paymentOrder = await fetchPaymentOrder(razorpayOrderId);

      const order = await prisma.$transaction(async (tx) => {
        const cartItems = await tx.cartItem.findMany({
          where: { userId: req.user.id },
          include: { product: true },
        });
        if (!cartItems.length) {
          throw Object.assign(new Error('Cart is empty'), { statusCode: 400, expose: true });
        }

        // Batch-fetch all products in one query (constant query count
        // regardless of cart size) and validate stock in memory.
        const freshProducts = await tx.product.findMany({
          where: { id: { in: cartItems.map((i) => i.productId) } },
        });
        const freshById = new Map(freshProducts.map((p) => [p.id, p]));
        for (const item of cartItems) {
          const freshProduct = freshById.get(item.productId);
          if (!freshProduct || !freshProduct.isActive) {
            throw Object.assign(new Error(`Product "${item.product.name}" unavailable`), { statusCode: 400, expose: true });
          }
          if (freshProduct.stock < item.quantity) {
            throw Object.assign(new Error(`Insufficient stock for ${freshProduct.name}`), { statusCode: 400, expose: true });
          }
        }

        const totalAmount = cartTotal(cartItems);

        // Optional client-side total check (defense in depth).
        assertClientTotalMatches(expectedTotal, totalAmount);

        // CRITICAL: bind the amount that was actually authorized/paid to the
        // freshly recomputed cart total. Without this, a client can initiate +
        // pay for a cheap cart, then add expensive items before confirming — the
        // signature would still verify (it only covers orderId|paymentId), and a
        // fully-paid order would be created for far more than was paid. Skipped
        // only in mock mode (dev, no real funds). Compared in integer paise.
        if (!paymentOrder.mock) {
          // The payment must belong to THIS user's initiated checkout (the
          // receipt was set to `cart_<userId>` at /initiate) — blocks replaying
          // another user's payment id.
          if (paymentOrder.receipt !== `cart_${req.user.id}`) {
            throw Object.assign(
              new Error('This payment does not match your cart.'),
              { statusCode: 400, expose: true, tamper: { kind: 'receipt_mismatch', expectedPaise: toPaise(totalAmount), actualPaise: Number(paymentOrder.amount) } },
            );
          }
          if (toPaise(totalAmount) !== Number(paymentOrder.amount)) {
            throw Object.assign(
              new Error('Paid amount does not match your cart total. Your cart may have changed — no order was created.'),
              { statusCode: 400, expose: true, tamper: { kind: 'paid_amount_mismatch', expectedPaise: toPaise(totalAmount), actualPaise: Number(paymentOrder.amount) } },
            );
          }
        }

        const o = await tx.order.create({
          data: {
            userId: req.user.id,
            totalAmount,
            deliveryAddress,
            paymentMethod: 'online',
            paymentStatus: 'paid',
            notes: `razorpay:${razorpayPaymentId}`,
            items: {
              create: cartItems.map((i) => ({
                productId: i.productId,
                sellerId: i.product.sellerId || null,
                quantity: i.quantity,
                unitPrice: i.product.price,
                totalPrice: D(i.product.price).times(i.quantity),
              })),
            },
          },
          include: { items: { include: { product: true } } },
        });

        await applyStockDeltas(tx, cartItems.map((i) => ({ productId: i.productId, delta: -i.quantity })));

        await tx.cartItem.deleteMany({ where: { userId: req.user.id } });
        return o;
      }, { isolationLevel: 'Serializable' });

      // FRAUD-3: record device→account link for multi-account detection (no-op
      // without an X-Device-Id header). Fire-and-forget — never delays checkout.
      if (ENV.DEVICE_FINGERPRINT_ENABLED) {
        recordDeviceLink({ userId: req.user.id, fingerprint: strongDeviceId(req), ip: req.ip, context: 'order' }).catch(() => {});
      }

      return sendCreated(res, order);
    } catch (err) {
      // FRAUD-6: a payment-amount mismatch already aborted the txn (blocking
      // confirmation). Raise the tamper alarm HERE — outside/after the rolled-back
      // txn so the audit + incident persist. Fire-and-forget; never alters the
      // blocking response the buyer receives.
      if (err?.tamper && ENV.PAYMENT_TAMPER_ALARM_ENABLED) {
        raisePaymentTamperAlarm({
          userId: req.user.id,
          ...err.tamper,
          orderRef: razorpayOrderId,
          paymentRef: razorpayPaymentId,
          ip: req.ip,
          requestId: req.id,
        }).catch(() => {});
      }
      return sendServerError(res, err, 'Order confirmation failed. Please try again.');
    }
  }
);

// ── Seller: product CRUD ──────────────────────────────────────────────────────
// POST   /seller/products        → create a new product listing
// GET    /seller/products        → list own products
// PUT    /seller/products/:id    → update own product
// DELETE /seller/products/:id    → delete own product
// GET    /seller/stats           → dashboard stats
// GET    /seller/orders          → orders that include seller's products

// Per-field character caps for product free-text — bound DB row size and reject
// oversized payloads with 400. Shared by create + update.
const PRODUCT_TEXT_LIMITS = {
  name: 150, nameHi: 150, nameMr: 150, description: 5000, unit: 40,
  district: 120, taluka: 120, village: 120, state: 120,
  harvestDate: 40, subcategory: 100, brand: 100, manufacturer: 120, countryOfOrigin: 80,
};

// [FIX #5] All seller routes require SELLER, VERIFIED_FARMER, or ADMIN role.
// Previously any FARMER could create products.
router.post(
  '/seller/products',
  authenticate,
  requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'),
  [
    body('name').trim().notEmpty().withMessage('name required'),
    body('categoryId').notEmpty(),
    body('price').isFloat({ min: 0.01 }),
    body('stock').isInt({ min: 0 }),
    body('unit').notEmpty(),
    body('description').optional().trim(),
    body('mrp').optional().isFloat({ min: 0 }),
    body('minOrderQty').optional().isInt({ min: 1 }),
    body('tags').optional().isArray(),
    body('images').optional().isArray(),
    body('district').optional().trim(),
    body('taluka').optional().trim(),
    body('village').optional().trim(),
    body('state').optional().trim(),
    body('sellScope').optional().isIn(['village', 'taluka', 'district', 'state', 'all_india']),
    body('harvestDate').optional().trim(),
    body('subcategory').optional().trim(),
    body('brand').optional().trim(),
    body('manufacturer').optional().trim(),
    body('countryOfOrigin').optional().trim(),
    body('highlights').optional().isArray(),
    body('specifications').optional().isObject(),
    ...maxLen(PRODUCT_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    const {
      name, nameHi, nameMr, categoryId, description,
      price, mrp, unit, stock, minOrderQty,
      images = [], tags = [],
      district, taluka, village, state, sellScope, harvestDate, subcategory,
      brand, manufacturer, countryOfOrigin, highlights = [], specifications,
    } = req.body;

    const cat = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) return sendError(res, 'Invalid category', 400);

    // [FIX #7] Sanitize all user-supplied text to prevent stored XSS
    const product = await prisma.product.create({
      data: {
        name: stripHtml(name), nameHi: stripHtml(nameHi), nameMr: stripHtml(nameMr),
        categoryId, description: stripHtml(description),
        price:       parseFloat(price),
        mrp:         mrp ? parseFloat(mrp) : null,
        unit,
        stock:       parseInt(stock),
        minOrderQty: minOrderQty ? parseInt(minOrderQty) : 1,
        images, tags,
        district:    district    || null,
        taluka:      taluka      || null,
        village:     village     || null,
        state:       state       || null,
        sellScope:   sellScope   || 'district',
        harvestDate: harvestDate || null,
        subcategory: subcategory || null,
        brand:           stripHtml(brand)           || null,
        manufacturer:    stripHtml(manufacturer)    || null,
        countryOfOrigin: stripHtml(countryOfOrigin) || null,
        highlights:      deepStripHtml(highlights),
        specifications:  deepStripHtml(specifications) || null,
        sellerId:    req.user.id,
      },
      include: { category: { select: { id: true, name: true, icon: true, color: true } } },
    });
    await bumpListingVersion(NS_PRODUCTS); // new listing → invalidate product caches

    // FRAUD-5: score the new listing (burst/duplicate/new-account) and route it
    // to the moderation queue if suspicious. Fire-and-forget — never delays or
    // blocks the create (suspicious listings are reviewed, not auto-removed).
    if (ENV.CONTENT_FRAUD_ENABLED) {
      flagListingIfSuspicious({ productId: product.id, sellerId: req.user.id, name: product.name }).catch(() => {});
    }

    return sendCreated(res, product);
  }
);

router.get('/seller/products', authenticate, requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'), async (req, res) => {
  const limit = parsePageSize(req.query.limit, 20, 50);
  const include = { category: { select: { id: true, name: true, icon: true, color: true } } };

  // Keyset pagination (rides the [sellerId, createdAt] index) — see /orders.
  if (req.query.cursor !== undefined || req.query.paginate === 'cursor') {
    const { items, nextCursor, hasMore } = await keysetPage(prisma, {
      table: 'products', filterColumn: 'sellerId', filterValue: req.user.id,
      cursor: req.query.cursor, limit,
      hydrate: (ids) => prisma.product.findMany({ where: { id: { in: ids } }, include }),
    });
    return sendSuccess(res, items, 200, { limit, nextCursor, hasMore });
  }

  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where: { sellerId: req.user.id },
      include,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where: { sellerId: req.user.id } }),
  ]);
  return sendSuccess(res, products, 200, paginationMeta(total, page, limit));
});

router.put(
  '/seller/products/:id',
  authenticate,
  requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'),
  [
    body('name').optional().trim().notEmpty(),
    body('price').optional().isFloat({ min: 0.01 }),
    body('stock').optional().isInt({ min: 0 }),
    body('minOrderQty').optional().isInt({ min: 1 }),
    body('sellScope').optional().isIn(['village', 'taluka', 'district', 'state', 'all_india']),
    body('harvestDate').optional().trim(),
    body('brand').optional().trim(),
    body('manufacturer').optional().trim(),
    body('countryOfOrigin').optional().trim(),
    body('highlights').optional().isArray(),
    body('specifications').optional().isObject(),
    ...maxLen(PRODUCT_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    const product = await prisma.product.findFirst({ where: { id: req.params.id, sellerId: req.user.id } });
    if (!product) return sendNotFound(res, 'Product');

    const {
      name, nameHi, nameMr, description,
      price, mrp, unit, stock, minOrderQty,
      images, tags, isActive,
      district, taluka, village, state, sellScope, harvestDate,
      brand, manufacturer, countryOfOrigin, highlights, specifications,
    } = req.body;

    // [FIX #7] Sanitize all text fields on update
    const data = {};
    if (name            !== undefined) data.name            = stripHtml(name);
    if (nameHi          !== undefined) data.nameHi          = stripHtml(nameHi);
    if (nameMr          !== undefined) data.nameMr          = stripHtml(nameMr);
    if (description     !== undefined) data.description     = stripHtml(description);
    if (price           !== undefined) data.price           = parseFloat(price);
    if (mrp             !== undefined) data.mrp             = mrp ? parseFloat(mrp) : null;
    if (unit            !== undefined) data.unit            = unit;
    if (stock           !== undefined) data.stock           = parseInt(stock);
    if (minOrderQty     !== undefined) data.minOrderQty     = parseInt(minOrderQty);
    if (images          !== undefined) data.images          = images;
    if (tags            !== undefined) data.tags            = tags;
    if (isActive        !== undefined) data.isActive        = isActive;
    if (district        !== undefined) data.district        = district        || null;
    if (taluka          !== undefined) data.taluka          = taluka          || null;
    if (village         !== undefined) data.village         = village         || null;
    if (state           !== undefined) data.state           = state           || null;
    if (sellScope       !== undefined) data.sellScope       = sellScope;
    if (harvestDate     !== undefined) data.harvestDate     = harvestDate     || null;
    if (brand           !== undefined) data.brand           = stripHtml(brand)           || null;
    if (manufacturer    !== undefined) data.manufacturer    = stripHtml(manufacturer)    || null;
    if (countryOfOrigin !== undefined) data.countryOfOrigin = stripHtml(countryOfOrigin) || null;
    if (highlights      !== undefined) data.highlights      = deepStripHtml(highlights);
    if (specifications  !== undefined) data.specifications  = deepStripHtml(specifications) || null;
    if (req.body.subcategory !== undefined) data.subcategory = req.body.subcategory || null;

    const updated = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: { category: { select: { id: true, name: true, icon: true, color: true } } },
    });
    await bumpListingVersion(NS_PRODUCTS); // listing fields may have changed → invalidate
    return sendSuccess(res, updated);
  }
);

router.delete('/seller/products/:id', authenticate, requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'), async (req, res) => {
  const product = await prisma.product.findFirst({ where: { id: req.params.id, sellerId: req.user.id } });
  if (!product) return sendNotFound(res, 'Product');
  // [FIX #16] Soft-delete and also remove from all carts to prevent checkout of unavailable items
  await prisma.$transaction([
    prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } }),
    prisma.cartItem.deleteMany({ where: { productId: req.params.id } }),
  ]);

  await bumpListingVersion(NS_PRODUCTS); // removed from listings → invalidate

  // Audit the listing removal (the audit service explicitly tracks deletions).
  auditAction(req, {
    action:   AUDIT_ACTIONS.PRODUCT_DELETE,
    entity:   'Product',
    entityId: req.params.id,
    metadata: { sellerId: req.user.id, name: product.name },
  }).catch(() => {});

  return sendSuccess(res, { archived: true });
});

router.get('/seller/stats', authenticate, requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'), async (req, res) => {
  // Served from a precomputed cached rollup (CACHE-6) so this hot dashboard read
  // doesn't re-run the ever-growing revenue aggregate on every load. Refreshed
  // periodically by a leader-locked cron; falls back to a live compute when
  // Redis is unavailable.
  const stats = await getSellerStats(req.user.id);
  return sendSuccess(res, stats);
});

// ── Seller: update order item status ─────────────────────────────────────────
// [FIX #4] Only updates THIS seller's items in the order, not the entire order.
// Previously, any seller with one item could change the whole order's status,
// which meant Seller A could mark Seller B's items as DELIVERED.
// Now we track status per OrderItem for multi-seller orders.
router.put(
  '/seller/orders/:orderId/status',
  authenticate,
  requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'),
  [
    body('status')
      .isIn(['CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'])
      .withMessage('status must be one of CONFIRMED, SHIPPED, DELIVERED, CANCELLED'),
  ],
  validate,
  async (req, res) => {
    const { orderId } = req.params;
    const { status }  = req.body;

    // Only update items belonging to THIS seller in this order
    const updated = await prisma.orderItem.updateMany({
      where: { orderId, sellerId: req.user.id },
      data:  { status },
    });

    if (!updated.count) return sendNotFound(res, 'Order');

    // Auto-derive the overall Order status from all item statuses:
    // If ALL items are DELIVERED → Order is DELIVERED
    // If ALL items are CANCELLED → Order is CANCELLED
    // If ANY item is SHIPPED → Order is SHIPPED
    // If ANY item is CONFIRMED → Order is CONFIRMED
    // Otherwise → PENDING
    const allItems = await prisma.orderItem.findMany({
      where: { orderId },
      select: { status: true },
    });

    const statuses = allItems.map(i => i.status);
    let orderStatus = 'PENDING';
    if (statuses.length && statuses.every(s => s === 'DELIVERED'))  orderStatus = 'DELIVERED';
    else if (statuses.length && statuses.every(s => s === 'CANCELLED')) orderStatus = 'CANCELLED';
    else if (statuses.includes('SHIPPED'))    orderStatus = 'SHIPPED';
    else if (statuses.includes('CONFIRMED'))  orderStatus = 'CONFIRMED';

    await prisma.order.update({
      where: { id: orderId },
      data:  { status: orderStatus },
    });

    return sendSuccess(res, {
      orderId,
      itemsUpdated: updated.count,
      itemStatus: status,
      orderStatus,
    });
  }
);

router.get('/seller/orders', authenticate, requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'), async (req, res) => {
  const page  = parseInt(req.query.page  || '1', 10);
  const limit = parseInt(req.query.limit || '15', 10);
  // Uses the denormalised sellerId index — O(1) lookup, no join through products
  const [items, total] = await Promise.all([
    prisma.orderItem.findMany({
      where: { sellerId: req.user.id },
      include: {
        product: { select: { id: true, name: true, images: true, unit: true } },
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
  return sendSuccess(res, items, 200, paginationMeta(total, page, limit));
});

// ── Product review ────────────────────────────────────────────────────────────
router.post(
  '/products/:id/review',
  authenticate,
  [
    body('rating').isInt({ min: 1, max: 5 }),
    body('comment').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    const { rating, comment } = req.body;
    const productId = req.params.id;
    // [FIX #7] Sanitize review comment to prevent stored XSS
    const safeComment = stripHtml(comment) || null;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return sendNotFound(res, 'Product');

    const review = await prisma.$transaction(async (tx) => {
      const r = await tx.review.upsert({
        where: { userId_productId: { userId: req.user.id, productId } },
        create: { userId: req.user.id, productId, rating, comment: safeComment },
        update: { rating, comment: safeComment },
      });

      // Recalculate average rating
      const agg = await tx.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { rating: true },
      });

      await tx.product.update({
        where: { id: productId },
        data: {
          rating: agg._avg.rating || 0,
          ratingCount: agg._count.rating,
        },
      });

      return r;
    });

    // The product's avg rating changed — it orders the listing, so invalidate.
    await bumpListingVersion(NS_PRODUCTS);

    // FRAUD-5: score the new review (burst/duplicate/new-account) and route it to
    // the moderation queue if suspicious. Fire-and-forget; review stays visible
    // until a moderator acts.
    if (ENV.CONTENT_FRAUD_ENABLED) {
      flagReviewIfSuspicious({ reviewId: review.id, userId: req.user.id, comment: safeComment }).catch(() => {});
    }

    return sendCreated(res, review);
  }
);

export default router;
