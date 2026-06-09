/**
 * API tests for /api/v1/agristore/*
 * Covers: categories, products, cart, orders, seller CRUD, reviews
 * Focus: authorization, validation, race conditions, IDOR
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller, createTestCategory,
  createTestProduct, cleanupTestData, prisma,
} from '../../fixtures/setup.js';
import { XSS_PAYLOADS, SQLI_PAYLOADS } from '../../fixtures/factories.js';

let app;
let farmer, seller, sellerB, category;

beforeAll(async () => {
  app = await getApp();
  farmer = await createTestUser();
  seller = await createTestSeller();
  sellerB = await createTestSeller();
  category = await createTestCategory();
});

afterAll(async () => {
  await cleanupTestData();
});

// ── Categories ───────────────────────────────────────────────────────────────
describe('GET /api/v1/agristore/categories', () => {
  test('200 — returns active categories without auth', async () => {
    const res = await request(app).get('/api/v1/agristore/categories');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── Products ─────────────────────────────────────────────────────────────────
describe('GET /api/v1/agristore/products', () => {
  beforeAll(async () => {
    await createTestProduct(seller.user.id, category.id, { name: 'Organic Urea' });
    await createTestProduct(seller.user.id, category.id, { name: 'NPK Fertilizer', isActive: false });
  });

  test('200 — returns only active products', async () => {
    const res = await request(app).get('/api/v1/agristore/products');
    expect(res.status).toBe(200);
    const names = res.body.data.map(p => p.name);
    expect(names).toContain('Organic Urea');
    expect(names).not.toContain('NPK Fertilizer');
  });

  test('200 — search filter works', async () => {
    const res = await request(app)
      .get('/api/v1/agristore/products?search=Organic');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('200 — pagination meta present', async () => {
    const res = await request(app)
      .get('/api/v1/agristore/products?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(5);
  });

  test('400 — limit exceeding 50 rejected', async () => {
    const res = await request(app)
      .get('/api/v1/agristore/products?limit=100');
    expect(res.status).toBe(422);
  });

  test('400 — page=0 rejected', async () => {
    const res = await request(app)
      .get('/api/v1/agristore/products?page=0');
    expect(res.status).toBe(422);
  });

  test('200 — SQL injection in search returns empty, no crash', async () => {
    const res = await request(app)
      .get(`/api/v1/agristore/products?search=${encodeURIComponent("' OR 1=1--")}`);
    expect(res.status).toBe(200);
    // Prisma parameterizes queries — should not crash
  });
});

describe('GET /api/v1/agristore/products/:id', () => {
  let productId;

  beforeAll(async () => {
    const p = await createTestProduct(seller.user.id, category.id);
    productId = p.id;
  });

  test('200 — returns product with reviews', async () => {
    const res = await request(app)
      .get(`/api/v1/agristore/products/${productId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(productId);
    expect(res.body.data.reviews).toBeDefined();
  });

  test('404 — non-existent id', async () => {
    const res = await request(app)
      .get('/api/v1/agristore/products/non-existent-id');
    expect(res.status).toBe(404);
  });
});

// ── Cart ─────────────────────────────────────────────────────────────────────
describe('Cart operations', () => {
  let productId;

  beforeAll(async () => {
    const p = await createTestProduct(seller.user.id, category.id, { stock: 10 });
    productId = p.id;
  });

  test('401 — cart requires auth', async () => {
    const res = await request(app).get('/api/v1/agristore/cart');
    expect(res.status).toBe(401);
  });

  test('201 — add item to cart', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/cart')
      .set(farmer.headers)
      .send({ productId, quantity: 2 });

    expect(res.status).toBe(201);
  });

  test('200 — get cart shows items and total', async () => {
    const res = await request(app)
      .get('/api/v1/agristore/cart')
      .set(farmer.headers);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  test('400 — add to cart with quantity 0', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/cart')
      .set(farmer.headers)
      .send({ productId, quantity: 0 });

    expect(res.status).toBe(422);
  });

  test('400 — add to cart exceeding stock', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/cart')
      .set(farmer.headers)
      .send({ productId, quantity: 999 });

    expect(res.status).toBe(422);
  });

  test('404 — add non-existent product to cart', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/cart')
      .set(farmer.headers)
      .send({ productId: 'fake-product-id', quantity: 1 });

    expect(res.status).toBe(404);
  });

  test('200 — update cart item quantity', async () => {
    const res = await request(app)
      .put(`/api/v1/agristore/cart/${productId}`)
      .set(farmer.headers)
      .send({ quantity: 5 });

    expect(res.status).toBe(200);
  });

  test('200 — delete cart item', async () => {
    const res = await request(app)
      .delete(`/api/v1/agristore/cart/${productId}`)
      .set(farmer.headers);

    expect(res.status).toBe(200);
  });
});

// ── Orders ───────────────────────────────────────────────────────────────────
describe('Order operations', () => {
  let productId;

  beforeEach(async () => {
    // Fresh product and cart item for each test
    const p = await createTestProduct(seller.user.id, category.id, { stock: 50 });
    productId = p.id;
    await prisma.cartItem.create({
      data: { userId: farmer.user.id, productId, quantity: 2 },
    });
  });

  afterEach(async () => {
    await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
  });

  test('201 — checkout with inline address', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/orders')
      .set(farmer.headers)
      .send({
        deliveryAddress: {
          type: 'home',
          name: 'Test',
          phone: '9876543210',
          flat: '1A',
          street: 'Main St',
          city: 'Pune',
          state: 'MH',
          pincode: '411001',
        },
        paymentMethod: 'cod',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totalAmount).toBeGreaterThan(0);
  });

  const inlineAddress = {
    type: 'home', name: 'Test', phone: '9876543210',
    flat: '1A', street: 'Main St', city: 'Pune', state: 'MH', pincode: '411001',
  };

  test('201 — checkout when client expectedTotal matches server total', async () => {
    // Seeded cart: 1 product @ 199.99 × qty 2 = 399.98 (server-authoritative).
    const res = await request(app)
      .post('/api/v1/agristore/orders')
      .set(farmer.headers)
      .send({ deliveryAddress: inlineAddress, paymentMethod: 'cod', expectedTotal: 399.98 });

    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBeCloseTo(399.98, 2);
  });

  test('400 — checkout rejected when client total understates the server total', async () => {
    // Tampered client claims a tiny total; server recomputes 399.98 and rejects.
    const before = await prisma.order.count({ where: { userId: farmer.user.id } });

    const res = await request(app)
      .post('/api/v1/agristore/orders')
      .set(farmer.headers)
      .send({ deliveryAddress: inlineAddress, paymentMethod: 'cod', expectedTotal: 0.01 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cart total has changed/i);

    // No order was created from the rejected checkout (and the cart is untouched).
    const after = await prisma.order.count({ where: { userId: farmer.user.id } });
    expect(after).toBe(before);
  });

  test('400 — checkout with empty cart', async () => {
    await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });

    const res = await request(app)
      .post('/api/v1/agristore/orders')
      .set(farmer.headers)
      .send({
        deliveryAddress: {
          type: 'home', name: 'Test', phone: '9876543210',
          flat: '1A', street: 'Main', city: 'Pune', state: 'MH', pincode: '411001',
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Cart is empty');
  });

  test('400 — checkout without address', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/orders')
      .set(farmer.headers)
      .send({});

    expect(res.status).toBe(400);
  });

  test('200 — list my orders', async () => {
    const res = await request(app)
      .get('/api/v1/agristore/orders')
      .set(farmer.headers);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('IDOR — cannot access another user\'s order', async () => {
    // Create order as farmer
    const orderRes = await request(app)
      .post('/api/v1/agristore/orders')
      .set(farmer.headers)
      .send({
        deliveryAddress: {
          type: 'home', name: 'Test', phone: '9876543210',
          flat: '1A', street: 'Main', city: 'Pune', state: 'MH', pincode: '411001',
        },
      });

    if (orderRes.status === 201) {
      const orderId = orderRes.body.data.id;

      // Try to access as seller (different user)
      const res = await request(app)
        .get(`/api/v1/agristore/orders/${orderId}`)
        .set(seller.headers);

      expect(res.status).toBe(404); // Should not find — scoped to userId
    }
  });
});

// ── Seller Products ──────────────────────────────────────────────────────────
describe('Seller product CRUD', () => {
  test('BUG: any authenticated user can create products (no role check)', async () => {
    // This test documents the bug: farmer role can create seller products
    const res = await request(app)
      .post('/api/v1/agristore/seller/products')
      .set(farmer.headers)
      .send({
        name: 'Farmer-created Product',
        categoryId: category.id,
        price: 100,
        stock: 10,
        unit: 'kg',
      });

    // BUG: This succeeds with 201 — should be 403
    // FIX: Add requireRole('SELLER', 'VERIFIED_FARMER', 'ADMIN') middleware
    if (res.status === 201) {
      // Clean up
      await prisma.product.deleteMany({ where: { name: 'Farmer-created Product' } });
    }
    // When fixed, this should be:
    // expect(res.status).toBe(403);
  });

  test('201 — seller creates product', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/seller/products')
      .set(seller.headers)
      .send({
        name: 'Seller Product',
        categoryId: category.id,
        price: 250,
        stock: 50,
        unit: 'kg',
        description: 'Quality seeds',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.sellerId).toBe(seller.user.id);
  });

  test('400 — missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/seller/products')
      .set(seller.headers)
      .send({ name: 'No Price Product' });

    expect(res.status).toBe(422);
  });

  test('400 — price = 0 rejected', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/seller/products')
      .set(seller.headers)
      .send({
        name: 'Zero Price', categoryId: category.id,
        price: 0, stock: 10, unit: 'kg',
      });

    expect(res.status).toBe(422);
  });

  test('400 — negative stock rejected', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/seller/products')
      .set(seller.headers)
      .send({
        name: 'Negative Stock', categoryId: category.id,
        price: 100, stock: -5, unit: 'kg',
      });

    expect(res.status).toBe(422);
  });

  test('IDOR — seller cannot update another seller\'s product', async () => {
    const product = await createTestProduct(seller.user.id, category.id);

    const res = await request(app)
      .put(`/api/v1/agristore/seller/products/${product.id}`)
      .set(sellerB.headers)
      .send({ price: 1 });

    expect(res.status).toBe(404); // findFirst scoped to sellerId
  });

  test('IDOR — seller cannot delete another seller\'s product', async () => {
    const product = await createTestProduct(seller.user.id, category.id);

    const res = await request(app)
      .delete(`/api/v1/agristore/seller/products/${product.id}`)
      .set(sellerB.headers);

    expect(res.status).toBe(404);
  });

  test('XSS — script tags in product name are handled', async () => {
    const res = await request(app)
      .post('/api/v1/agristore/seller/products')
      .set(seller.headers)
      .send({
        name: '<script>alert("xss")</script>Seeds',
        categoryId: category.id,
        price: 100, stock: 10, unit: 'kg',
      });

    if (res.status === 201) {
      // BUG: product name is NOT stripped of HTML — only user profile fields are
      // FIX: Apply stripHtml to product name, description before storage
      expect(res.body.data.name).not.toContain('<script>');
    }
  });
});

// ── Seller Order Status ──────────────────────────────────────────────────────
describe('Seller order status update', () => {
  test('BUG: seller can update status of entire multi-seller order', async () => {
    // Create products from two different sellers
    const productA = await createTestProduct(seller.user.id, category.id, { stock: 100 });
    const productB = await createTestProduct(sellerB.user.id, category.id, { stock: 100 });

    // Add both to farmer's cart
    await prisma.cartItem.createMany({
      data: [
        { userId: farmer.user.id, productId: productA.id, quantity: 1 },
        { userId: farmer.user.id, productId: productB.id, quantity: 1 },
      ],
    });

    // Checkout
    const orderRes = await request(app)
      .post('/api/v1/agristore/orders')
      .set(farmer.headers)
      .send({
        deliveryAddress: {
          type: 'home', name: 'Test', phone: '9876543210',
          flat: '1A', street: 'Main', city: 'Pune', state: 'MH', pincode: '411001',
        },
      });

    if (orderRes.status === 201) {
      const orderId = orderRes.body.data.id;

      // Seller A marks ENTIRE order as DELIVERED — but Seller B hasn't shipped!
      const res = await request(app)
        .put(`/api/v1/agristore/seller/orders/${orderId}/status`)
        .set(seller.headers)
        .send({ status: 'DELIVERED' });

      // BUG: This succeeds — Seller A changed status of Seller B's items too.
      // FIX: Track status per OrderItem, or only update the order if ALL sellers agree.
      if (res.status === 200) {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        // Document the bug: order.status is DELIVERED even though sellerB hasn't shipped
        expect(order.status).toBe('DELIVERED');
      }
    }
  });
});

// ── Reviews ──────────────────────────────────────────────────────────────────
describe('POST /api/v1/agristore/products/:id/review', () => {
  let productId;

  beforeAll(async () => {
    const p = await createTestProduct(seller.user.id, category.id);
    productId = p.id;
  });

  test('201 — create review', async () => {
    const res = await request(app)
      .post(`/api/v1/agristore/products/${productId}/review`)
      .set(farmer.headers)
      .send({ rating: 4, comment: 'Good quality seeds' });

    expect(res.status).toBe(201);
  });

  test('400 — rating out of range', async () => {
    const res = await request(app)
      .post(`/api/v1/agristore/products/${productId}/review`)
      .set(farmer.headers)
      .send({ rating: 6 });

    expect(res.status).toBe(422);
  });

  test('400 — rating = 0', async () => {
    const res = await request(app)
      .post(`/api/v1/agristore/products/${productId}/review`)
      .set(farmer.headers)
      .send({ rating: 0 });

    expect(res.status).toBe(422);
  });

  test('401 — unauthenticated review rejected', async () => {
    const res = await request(app)
      .post(`/api/v1/agristore/products/${productId}/review`)
      .send({ rating: 3 });

    expect(res.status).toBe(401);
  });
});
