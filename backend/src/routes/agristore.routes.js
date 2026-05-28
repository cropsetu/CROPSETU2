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
import { validate } from '../middleware/validate.js';
import prisma from '../config/db.js';
import { sendSuccess, sendCreated, sendError, sendNotFound, paginationMeta } from '../utils/response.js';
import { stripHtml, deepStripHtml } from '../utils/encrypt.js';
import { createPaymentOrder, verifyPaymentSignature } from '../services/payment.service.js';
import { auditOrderStatusChange } from '../services/audit.service.js';

const router = Router();

// ── Categories (public) ───────────────────────────────────────────────────────
router.get('/categories', async (_req, res) => {
  const cats = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return sendSuccess(res, cats);
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
    const { category, search, featured, district } = req.query;

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

    return sendSuccess(res, products, 200, paginationMeta(total, page, limit));
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
  const total = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
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
router.post(
  '/orders',
  authenticate,
  [
    body('paymentMethod').optional().isIn(['cod', 'upi', 'card']),
    // Accept either a saved address id OR an inline address object
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
  ],
  validate,
  async (req, res) => {
    let { deliveryAddress, deliveryAddressId, paymentMethod = 'cod', notes } = req.body;

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
          throw Object.assign(new Error('Cart is empty'), { statusCode: 400 });
        }

        // Validate stock INSIDE the transaction so concurrent checkouts
        // see consistent stock values.
        for (const item of cartItems) {
          // Re-read product with fresh data inside the transaction
          const freshProduct = await tx.product.findUnique({ where: { id: item.productId } });
          if (!freshProduct || !freshProduct.isActive) {
            throw Object.assign(new Error(`Product "${item.product.name}" is no longer available`), { statusCode: 400 });
          }
          if (freshProduct.stock < item.quantity) {
            throw Object.assign(new Error(`Insufficient stock for ${freshProduct.name}`), { statusCode: 400 });
          }
        }

        const totalAmount = cartItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);

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
                totalPrice: i.product.price * i.quantity,
              })),
            },
          },
          include: { items: { include: { product: true } } },
        });

        // Decrement stock
        for (const item of cartItems) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          });
        }

        // Clear cart
        await tx.cartItem.deleteMany({ where: { userId: req.user.id } });

        return o;
      }, {
        isolationLevel: 'Serializable',
      });

      return sendCreated(res, order);
    } catch (err) {
      const status = err.statusCode || 500;
      return sendError(res, err.message || 'Checkout failed', status);
    }
  }
);

router.get('/orders', authenticate, async (req, res) => {
  const page  = parseInt(req.query.page  || '1', 10);
  const limit = parseInt(req.query.limit || '10', 10);

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { userId: req.user.id },
      include: { items: { include: { product: { select: { name: true, images: true } } } } },
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
router.put('/orders/:id/cancel', authenticate, async (req, res) => {
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

    // Restore stock for each item
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
      // Also cancel each item's status
      await tx.orderItem.update({
        where: { id: item.id },
        data: { status: 'CANCELLED' },
      });
    }

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
  ],
  validate,
  async (req, res) => {
    try {
      const cartItems = await prisma.cartItem.findMany({
        where: { userId: req.user.id },
        include: { product: true },
      });
      if (!cartItems.length) return sendError(res, 'Cart is empty', 400);

      const totalAmount = cartItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
      const amountInPaise = Math.round(totalAmount * 100);

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
  [
    body('razorpayOrderId').notEmpty(),
    body('razorpayPaymentId').notEmpty(),
    body('razorpaySignature').notEmpty(),
    body('deliveryAddressId').optional().isString(),
    body('deliveryAddress').optional().isObject(),
  ],
  validate,
  async (req, res) => {
    const {
      razorpayOrderId, razorpayPaymentId, razorpaySignature,
      deliveryAddress: rawAddress, deliveryAddressId,
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
      const order = await prisma.$transaction(async (tx) => {
        const cartItems = await tx.cartItem.findMany({
          where: { userId: req.user.id },
          include: { product: true },
        });
        if (!cartItems.length) {
          throw Object.assign(new Error('Cart is empty'), { statusCode: 400 });
        }

        for (const item of cartItems) {
          const freshProduct = await tx.product.findUnique({ where: { id: item.productId } });
          if (!freshProduct || !freshProduct.isActive) {
            throw Object.assign(new Error(`Product "${item.product.name}" unavailable`), { statusCode: 400 });
          }
          if (freshProduct.stock < item.quantity) {
            throw Object.assign(new Error(`Insufficient stock for ${freshProduct.name}`), { statusCode: 400 });
          }
        }

        const totalAmount = cartItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);

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
                totalPrice: i.product.price * i.quantity,
              })),
            },
          },
          include: { items: { include: { product: true } } },
        });

        for (const item of cartItems) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          });
        }

        await tx.cartItem.deleteMany({ where: { userId: req.user.id } });
        return o;
      }, { isolationLevel: 'Serializable' });

      return sendCreated(res, order);
    } catch (err) {
      return sendError(res, err.message || 'Order confirmation failed', err.statusCode || 500);
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
    return sendCreated(res, product);
  }
);

router.get('/seller/products', authenticate, requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'), async (req, res) => {
  const page  = parseInt(req.query.page  || '1', 10);
  const limit = parseInt(req.query.limit || '20', 10);
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where: { sellerId: req.user.id },
      include: { category: { select: { id: true, name: true, icon: true, color: true } } },
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
  return sendSuccess(res, { archived: true });
});

router.get('/seller/stats', authenticate, requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN'), async (req, res) => {
  const [totalProducts, activeProducts, revenueAgg] = await Promise.all([
    prisma.product.count({ where: { sellerId: req.user.id } }),
    prisma.product.count({ where: { sellerId: req.user.id, isActive: true } }),
    // Uses denormalised sellerId index — no join through products
    prisma.orderItem.aggregate({
      where: { sellerId: req.user.id },
      _sum: { totalPrice: true, quantity: true },
    }),
  ]);
  return sendSuccess(res, {
    totalProducts,
    activeProducts,
    totalRevenue: revenueAgg._sum.totalPrice || 0,
    totalSold:    revenueAgg._sum.quantity   || 0,
  });
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

    return sendCreated(res, review);
  }
);

export default router;
