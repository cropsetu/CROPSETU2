/**
 * Server-authoritative shop pricing.
 *
 * The bug these tests exist for: the delivery fee lived in the mobile app
 * (`total >= 999 ? 0 : 49` in CartScreen) and was never sent to the server, so
 * the farmer approved one number and the order recorded another. Every test here
 * asserts that the SERVER decides the payable and that the recorded order equals
 * the quoted amount, line for line.
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller, createTestCategory,
  createTestCatalogProduct, createTestListing, createTestProduct, cleanupTestData, prisma,
} from '../../fixtures/setup.js';

const API = '/api/v1/agristore';

let app; let farmer; let sellerA; let sellerB; let category;

const address = {
  type: 'HOME', name: 'Test Farmer', phone: '9876543210',
  flat: '1A', street: 'Main', city: 'Pune', state: 'Maharashtra', pincode: '411001',
};

/** Put exactly these listings in the farmer's cart, replacing whatever is there. */
async function setCart(lines) {
  await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
  for (const { listing, productId, quantity } of lines) {
    await prisma.cartItem.create({
      data: {
        userId: farmer.user.id,
        listingId: listing.id,
        productId,
        quantity,
        unitPriceSnapshot: listing.sellingPrice,
      },
    });
  }
}

beforeAll(async () => {
  app = await getApp();
  farmer = await createTestUser();
  sellerA = await createTestSeller();
  sellerB = await createTestSeller();
  category = await createTestCategory();
});

afterAll(async () => { await cleanupTestData(); });

describe('GET /cart/quote — the payable is computed on the server', () => {
  let product; let listing;

  beforeAll(async () => {
    product = await createTestCatalogProduct(category.id, { name: 'Quote Urea 50kg' });
    listing = await createTestListing(sellerA.user.id, product.variants[0].id, {
      sellingPrice: 200, stockQty: 50,
    });
  });

  test('adds the delivery fee below the free-delivery threshold', async () => {
    await setCart([{ listing, productId: product.id, quantity: 2 }]);

    const res = await request(app).get(`${API}/cart/quote`).set(farmer.headers);

    expect(res.status).toBe(200);
    const q = res.body.data;
    expect(Number(q.subtotal)).toBeCloseTo(400, 2);
    expect(Number(q.deliveryFee)).toBeCloseTo(49, 2);   // default feePerShipment
    expect(Number(q.total)).toBeCloseTo(449, 2);
    expect(q.totalPaise).toBe(44900);
    expect(q.issues).toHaveLength(0);
  });

  test('waives delivery once the shipment clears the threshold', async () => {
    // 6 × 200 = 1200, over the default 999.
    await setCart([{ listing, productId: product.id, quantity: 6 }]);

    const res = await request(app).get(`${API}/cart/quote`).set(farmer.headers);

    const q = res.body.data;
    expect(Number(q.subtotal)).toBeCloseTo(1200, 2);
    expect(Number(q.deliveryFee)).toBeCloseTo(0, 2);
    expect(Number(q.total)).toBeCloseTo(1200, 2);
    expect(q.shipments[0].freeDeliveryApplied).toBe(true);
    expect(q.shipments[0].freeDeliveryShortfall).toBeNull();
  });

  test('the shortfall to free delivery is real arithmetic, not a nudge', async () => {
    await setCart([{ listing, productId: product.id, quantity: 2 }]);
    const res = await request(app).get(`${API}/cart/quote`).set(farmer.headers);
    // 999 − 400. If this were a marketing string rather than a computation it
    // would not survive changing the quantity.
    expect(Number(res.body.data.shipments[0].freeDeliveryShortfall)).toBeCloseTo(599, 2);
  });

  test('charges delivery PER SELLER, because each seller dispatches separately', async () => {
    const productB = await createTestCatalogProduct(category.id, { name: 'Quote DAP 50kg' });
    const listingB = await createTestListing(sellerB.user.id, productB.variants[0].id, {
      sellingPrice: 150, stockQty: 20,
    });

    await setCart([
      { listing, productId: product.id, quantity: 1 },     // seller A: 200
      { listing: listingB, productId: productB.id, quantity: 1 }, // seller B: 150
    ]);

    const res = await request(app).get(`${API}/cart/quote`).set(farmer.headers);
    const q = res.body.data;

    expect(q.shipmentCount).toBe(2);
    expect(Number(q.subtotal)).toBeCloseTo(350, 2);
    // Two dispatches → two fees. A single cart-wide fee would undercharge here.
    expect(Number(q.deliveryFee)).toBeCloseTo(98, 2);
    expect(Number(q.total)).toBeCloseTo(448, 2);
    expect(q.warnings.some((w) => w.code === 'MULTIPLE_SHIPMENTS')).toBe(true);
  });

  test('free delivery is judged per shipment, not on the cart-wide total', async () => {
    const productB = await createTestCatalogProduct(category.id, { name: 'Quote Cheap Twine' });
    const listingB = await createTestListing(sellerB.user.id, productB.variants[0].id, {
      sellingPrice: 20, stockQty: 100,
    });

    await setCart([
      { listing, productId: product.id, quantity: 6 },              // A: 1200 → free
      { listing: listingB, productId: productB.id, quantity: 1 },   // B: 20   → charged
    ]);

    const res = await request(app).get(`${API}/cart/quote`).set(farmer.headers);
    const shipments = res.body.data.shipments;
    const a = shipments.find((s) => s.sellerId === sellerA.user.id);
    const b = shipments.find((s) => s.sellerId === sellerB.user.id);

    expect(Number(a.deliveryFee)).toBeCloseTo(0, 2);
    // The ₹20 line does NOT ride free on the other seller's ₹1200.
    expect(Number(b.deliveryFee)).toBeCloseTo(49, 2);
  });

  test('reports insufficient stock as a blocking issue with the real number', async () => {
    await setCart([{ listing, productId: product.id, quantity: 999 }]);

    const res = await request(app).get(`${API}/cart/quote`).set(farmer.headers);
    const issue = res.body.data.issues.find((i) => i.code === 'INSUFFICIENT_STOCK');

    expect(issue).toBeDefined();
    expect(issue.available).toBe(50);
  });

  test('an empty cart quotes zero and says why', async () => {
    await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
    const res = await request(app).get(`${API}/cart/quote`).set(farmer.headers);

    expect(Number(res.body.data.total)).toBe(0);
    expect(res.body.data.issues[0].code).toBe('EMPTY_CART');
  });

  test('401 — a quote is a private cart read', async () => {
    const res = await request(app).get(`${API}/cart/quote`);
    expect(res.status).toBe(401);
  });
});

describe('POST /orders — the order records exactly what was quoted', () => {
  let product; let listing;

  beforeAll(async () => {
    product = await createTestCatalogProduct(category.id, { name: 'Order Pricing Seed' });
    listing = await createTestListing(sellerA.user.id, product.variants[0].id, {
      sellingPrice: 250, stockQty: 100,
    });
  });

  test('persists subtotal, delivery and total, and they reconcile', async () => {
    await setCart([{ listing, productId: product.id, quantity: 2 }]);

    const quoteRes = await request(app).get(`${API}/cart/quote`).set(farmer.headers);
    const quoted = quoteRes.body.data;

    const res = await request(app)
      .post(`${API}/orders`)
      .set(farmer.headers)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });

    expect(res.status).toBe(201);
    const order = res.body.data;
    // The whole point: what was shown IS what was recorded.
    expect(Number(order.totalAmount)).toBeCloseTo(Number(quoted.total), 2);
    expect(Number(order.subtotal)).toBeCloseTo(Number(quoted.subtotal), 2);
    expect(Number(order.deliveryFee)).toBeCloseTo(Number(quoted.deliveryFee), 2);
    expect(Number(order.subtotal) + Number(order.deliveryFee) + Number(order.taxAmount))
      .toBeCloseTo(Number(order.totalAmount), 2);
  });

  test('rejects a client-supplied total that understates the goods subtotal', async () => {
    await setCart([{ listing, productId: product.id, quantity: 2 }]);
    const before = await prisma.order.count({ where: { userId: farmer.user.id } });

    const res = await request(app)
      .post(`${API}/orders`)
      .set(farmer.headers)
      .send({ deliveryAddress: address, paymentMethod: 'cod', expectedTotal: 1 });

    expect(res.status).toBe(400);
    expect(await prisma.order.count({ where: { userId: farmer.user.id } })).toBe(before);
  });

  test('rejects a tampered expectedPayable even when the subtotal is honest', async () => {
    await setCart([{ listing, productId: product.id, quantity: 2 }]);

    const res = await request(app)
      .post(`${API}/orders`)
      .set(farmer.headers)
      // Correct goods subtotal, but claims the payable excludes delivery — which
      // is precisely the shape of the old client-side bug, now caught.
      .send({ deliveryAddress: address, paymentMethod: 'cod', expectedTotal: 500, expectedPayable: 500 });

    expect(res.status).toBe(400);
  });

  test('freezes a product-name snapshot so renaming the catalog cannot rewrite history', async () => {
    await setCart([{ listing, productId: product.id, quantity: 1 }]);

    const res = await request(app)
      .post(`${API}/orders`)
      .set(farmer.headers)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });

    expect(res.status).toBe(201);
    const itemId = res.body.data.items[0].id;

    await prisma.product.update({
      where: { id: product.id },
      data: { name: 'RENAMED BY AN ADMIN' },
    });

    const item = await prisma.orderItem.findUnique({ where: { id: itemId } });
    expect(item.productName).toBe('Order Pricing Seed');
    expect(item.productName).not.toBe('RENAMED BY AN ADMIN');
  });

  test('freezes return eligibility at order time rather than deciding it later', async () => {
    await setCart([{ listing, productId: product.id, quantity: 1 }]);

    const res = await request(app)
      .post(`${API}/orders`)
      .set(farmer.headers)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });

    const item = await prisma.orderItem.findUnique({ where: { id: res.body.data.items[0].id } });
    expect(item.returnEligible).toBe(true);
    expect(item.returnWindowDays).toBeGreaterThan(0);
  });
});

describe('POST /orders — duplicate submission', () => {
  let product; let listing;

  beforeAll(async () => {
    product = await createTestCatalogProduct(category.id, { name: 'Double Tap Pesticide' });
    listing = await createTestListing(sellerA.user.id, product.variants[0].id, {
      sellingPrice: 100, stockQty: 100,
    });
  });

  test('the same Idempotency-Key replays the first order instead of creating a second', async () => {
    await setCart([{ listing, productId: product.id, quantity: 1 }]);
    const before = await prisma.order.count({ where: { userId: farmer.user.id } });
    const key = `test-idem-${Date.now()}`;

    const first = await request(app)
      .post(`${API}/orders`)
      .set(farmer.headers)
      .set('Idempotency-Key', key)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });

    expect(first.status).toBe(201);

    // A double-tap on "Place Order", or the axios 401-refresh replay: same key.
    const second = await request(app)
      .post(`${API}/orders`)
      .set(farmer.headers)
      .set('Idempotency-Key', key)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });

    // Either the cached 201 is replayed (Redis up) or the empty cart rejects the
    // duplicate (Redis down — the middleware fails open). What must NEVER happen
    // is two orders and two stock decrements.
    const after = await prisma.order.count({ where: { userId: farmer.user.id } });
    expect(after).toBe(before + 1);
    if (second.status === 201) {
      expect(second.body.data.id).toBe(first.body.data.id);
    }
  });

  test('stock is decremented once, not twice, for a replayed order', async () => {
    const fresh = await createTestCatalogProduct(category.id, { name: 'Stock Once Fungicide' });
    const freshListing = await createTestListing(sellerA.user.id, fresh.variants[0].id, {
      sellingPrice: 100, stockQty: 5,
    });
    await setCart([{ listing: freshListing, productId: fresh.id, quantity: 2 }]);

    const key = `test-idem-stock-${Date.now()}`;
    await request(app).post(`${API}/orders`).set(farmer.headers).set('Idempotency-Key', key)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });
    await request(app).post(`${API}/orders`).set(farmer.headers).set('Idempotency-Key', key)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });

    const after = await prisma.sellerListing.findUnique({ where: { id: freshListing.id } });
    expect(after.stockQty).toBe(3);
  });
});

describe('Inventory under concurrent checkout', () => {
  test('two buyers racing for the last unit produce exactly one order', async () => {
    const buyerB = await createTestUser();
    const product = await createTestCatalogProduct(category.id, { name: 'Last Unit Sprayer' });
    const listing = await createTestListing(sellerA.user.id, product.variants[0].id, {
      sellingPrice: 500, stockQty: 1,
    });

    for (const buyer of [farmer, buyerB]) {
      await prisma.cartItem.deleteMany({ where: { userId: buyer.user.id } });
      await prisma.cartItem.create({
        data: { userId: buyer.user.id, listingId: listing.id, productId: product.id, quantity: 1, unitPriceSnapshot: 500 },
      });
    }

    const [a, b] = await Promise.all([
      request(app).post(`${API}/orders`).set(farmer.headers).send({ deliveryAddress: address, paymentMethod: 'cod' }),
      request(app).post(`${API}/orders`).set(buyerB.headers).send({ deliveryAddress: address, paymentMethod: 'cod' }),
    ]);

    const created = [a, b].filter((r) => r.status === 201);
    expect(created).toHaveLength(1);

    // And the stock landed on exactly zero — never negative, never still 1.
    const after = await prisma.sellerListing.findUnique({ where: { id: listing.id } });
    expect(after.stockQty).toBe(0);
    expect(after.status).toBe('OUT_OF_STOCK');
  });
});

describe('Stock cannot be driven negative', () => {
  test('applyListingStockDeltas refuses a delta that would go below zero, even with no caller validation', async () => {
    // H-1 was defence in depth: the SQL had no `stock + delta >= 0` guard, so
    // correctness rested ENTIRELY on every caller validating first inside a
    // Serializable transaction. This calls it the way a future caller that
    // forgot would — straight to the write, no validation — and it must still
    // refuse rather than silently oversell.
    const { applyListingStockDeltas } = await import('../../../src/utils/stockBatch.js');
    const product = await createTestCatalogProduct(category.id, { name: 'Guard Test Seed' });
    const listing = await createTestListing(sellerA.user.id, product.variants[0].id, {
      sellingPrice: 100, stockQty: 3,
    });

    await expect(
      prisma.$transaction((tx) => applyListingStockDeltas(tx, [{ listingId: listing.id, delta: -5 }])),
    ).rejects.toThrow(/sold out/i);

    // The transaction aborted, so the row is untouched — not clamped to 0, which
    // would turn an over-sell into a successful order for the wrong quantity.
    const after = await prisma.sellerListing.findUnique({ where: { id: listing.id } });
    expect(after.stockQty).toBe(3);
  });

  test('a delta that lands exactly on zero is allowed', async () => {
    const { applyListingStockDeltas } = await import('../../../src/utils/stockBatch.js');
    const product = await createTestCatalogProduct(category.id, { name: 'Exact Zero Seed' });
    const listing = await createTestListing(sellerA.user.id, product.variants[0].id, {
      sellingPrice: 100, stockQty: 2,
    });

    const { crossedZero } = await prisma.$transaction(
      (tx) => applyListingStockDeltas(tx, [{ listingId: listing.id, delta: -2 }]),
    );

    expect(crossedZero).toEqual([listing.id]);
    const after = await prisma.sellerListing.findUnique({ where: { id: listing.id } });
    expect(after.stockQty).toBe(0);
  });
});

describe('POST /cart is not a check-then-act race', () => {
  test('concurrent adds cannot push the cart past available stock', async () => {
    const product = await createTestCatalogProduct(category.id, { name: 'Race Add Urea' });
    const listing = await createTestListing(sellerA.user.id, product.variants[0].id, {
      sellingPrice: 150, stockQty: 3,
    });
    await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });

    // H-2: the read and the upsert used to be separate statements, so all five
    // of these passed the stock check against the same stale read and every
    // increment landed — a cart holding 5 of a 3-stock listing. The overfill was
    // only caught at the payment step.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post(`${API}/cart`).set(farmer.headers)
        .send({ listingId: listing.id, quantity: 1 })),
    );

    const row = await prisma.cartItem.findFirst({
      where: { userId: farmer.user.id, listingId: listing.id },
    });
    expect(row.quantity).toBeLessThanOrEqual(3);

    // A refusal has to tell the buyer what IS available, at add time, rather than
    // failing later with a generic error.
    for (const r of results.filter((x) => x.status === 400)) {
      expect(r.body.error.message).toMatch(/in stock/i);
    }
  });

  test('concurrent adds on the pre-backfill legacy path are bounded too', async () => {
    // The DUAL-READ branch (a product with no variants, so no listing to resolve)
    // kept the old check-then-upsert shape after the listing path was fixed.
    const legacy = await createTestProduct(sellerA.user.id, category.id, {
      name: 'Legacy Race Product', stock: 3, price: 150, minOrderQty: 1,
    });
    await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post(`${API}/cart`).set(farmer.headers)
        .send({ productId: legacy.id, quantity: 1 })),
    );

    const row = await prisma.cartItem.findFirst({
      where: { userId: farmer.user.id, productId: legacy.id, listingId: null },
    });
    expect(row.quantity).toBeLessThanOrEqual(3);

    for (const r of results.filter((x) => x.status === 400)) {
      expect(r.body.error.message).toMatch(/in stock/i);
    }
  });
});
