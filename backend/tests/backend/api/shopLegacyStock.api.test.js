/**
 * Stock accounting for PRE-BACKFILL products.
 *
 * A product that predates the catalog split has no variants, therefore no
 * seller_listing, therefore no listingId on its cart row. Checkout takes the
 * DUAL-READ branch in validateCartForCheckout, where stock lives on
 * `products.stock` and the listing-targeted statement cannot reach it.
 *
 * That branch validated `p.stock < quantity` and then recorded no decrement
 * anywhere — `applyStockDeltas`, the only function that writes products.stock,
 * had zero call sites. So the check ran forever against a number no order ever
 * moved, and the last unit of such a product could be sold without limit. 20 of
 * 67 products in the development database have no variants, so this was a live
 * branch, not a vestigial one.
 *
 * The invariant here is the same one shopReservation.api.test.js defends for
 * offers: units leave the shelf exactly once and come back exactly once.
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller, createTestCategory,
  createTestProduct, cleanupTestData, prisma,
} from '../../fixtures/setup.js';

const API = '/api/v1/agristore';

let app; let farmer; let seller; let category;

const address = {
  type: 'HOME', name: 'Test Farmer', phone: '9876543210',
  flat: '1A', street: 'Main', city: 'Pune', state: 'Maharashtra', pincode: '411001',
};

/** A product with stock and NO variants — the pre-backfill shape. */
async function legacyProduct(stock) {
  const p = await createTestProduct(seller.user.id, category.id, {
    name: `Legacy ${Date.now()}-${Math.random()}`, stock, price: 100,
  });
  // The branch under test is selected by the ABSENCE of variants, so assert it
  // rather than trust the factory — if createTestProduct ever starts creating
  // one, every assertion below would silently move to the listing path.
  const variants = await prisma.productVariant.count({ where: { productId: p.id } });
  expect(variants).toBe(0);
  return p;
}

const stockOf = async (id) => (await prisma.product.findUnique({ where: { id } })).stock;

const addToCart = (user, productId, quantity = 1) =>
  request(app).post(`${API}/cart`).set(user.headers).send({ productId, quantity });

const placeOrder = (user) =>
  request(app).post(`${API}/orders`).set(user.headers)
    .send({ paymentMethod: 'cod', deliveryAddress: address });

beforeAll(async () => {
  app = await getApp();
  farmer   = await createTestUser();
  seller   = await createTestSeller();
  category = await createTestCategory();
});

afterAll(async () => { await cleanupTestData(); });

beforeEach(async () => {
  await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
});

describe('pre-backfill product stock', () => {
  test('ordering decrements products.stock', async () => {
    const p = await legacyProduct(5);

    expect((await addToCart(farmer, p.id, 2)).status).toBe(201);
    expect((await placeOrder(farmer)).status).toBe(201);

    expect(await stockOf(p.id)).toBe(3);
  });

  test('the last unit cannot be sold twice', async () => {
    const p = await legacyProduct(1);

    expect((await addToCart(farmer, p.id, 1)).status).toBe(201);
    expect((await placeOrder(farmer)).status).toBe(201);
    expect(await stockOf(p.id)).toBe(0);

    // Before the decrement existed, stock was still 1 here and this second
    // order succeeded — the same unit sold twice, and again for as long as
    // anyone kept asking.
    const second = await addToCart(farmer, p.id, 1);
    expect(second.status).toBe(400);
    expect(String(second.body.error.message)).toMatch(/in stock/i);

    expect(await stockOf(p.id)).toBe(0);
  });

  test('cancelling the order puts the units back', async () => {
    const p = await legacyProduct(4);

    expect((await addToCart(farmer, p.id, 3)).status).toBe(201);
    const created = await placeOrder(farmer);
    expect(created.status).toBe(201);
    expect(await stockOf(p.id)).toBe(1);

    const cancelled = await request(app)
      .put(`${API}/orders/${created.body.data.id}/cancel`)
      .set(farmer.headers);
    expect(cancelled.status).toBe(200);

    // The buyer-cancel path claimed in a comment that these were "restored by
    // the legacy path below". No such path existed.
    expect(await stockOf(p.id)).toBe(4);
  });

  test('stock is never driven negative even if validation is outraced', async () => {
    // Defence in depth: applyStockDeltas carries `stock + delta >= 0` in the SQL,
    // so a delta that would go negative matches no row, the RETURNING count comes
    // up short and the statement throws rather than clamping. Clamping would turn
    // an oversell into a successful order for the wrong quantity.
    const p = await legacyProduct(1);
    const { applyStockDeltas } = await import('../../../src/utils/stockBatch.js');

    await expect(
      prisma.$transaction((tx) => applyStockDeltas(tx, [{ productId: p.id, delta: -5 }])),
    ).rejects.toThrow(/sold out/i);

    expect(await stockOf(p.id)).toBe(1);
  });
});
