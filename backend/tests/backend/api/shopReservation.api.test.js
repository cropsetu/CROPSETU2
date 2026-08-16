/**
 * Stock reservation during the payment window.
 *
 * The race being closed: stock was decremented at order creation, which on the
 * online path is AFTER the money has moved. Two buyers could both open the
 * payment sheet for the last bag of seed, both pay, and the second was told
 * "insufficient stock" having already been charged.
 *
 * The invariant these tests defend is narrow and absolute: **units are removed
 * from the shelf exactly once and returned exactly once.** Every path out of a
 * hold — consume, fail, abandon, expire, double-release — is exercised, because
 * a release bug leaks inventory and a consume bug oversells, and both are silent.
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller, createTestCategory,
  createTestCatalogProduct, createTestListing, cleanupTestData, prisma,
} from '../../fixtures/setup.js';
import {
  sweepExpiredReservations, releaseReservations,
} from '../../../src/services/stockReservation.service.js';

const API = '/api/v1/agristore';

let app; let farmer; let seller; let category;

const address = {
  type: 'HOME', name: 'Test Farmer', phone: '9876543210',
  flat: '1A', street: 'Main', city: 'Pune', state: 'Maharashtra', pincode: '411001',
};

async function makeOffer({ stockQty = 5, price = 200, name } = {}) {
  const product = await createTestCatalogProduct(category.id, { name: name || `Res ${Date.now()}-${Math.random()}` });
  const listing = await createTestListing(seller.user.id, product.variants[0].id, { sellingPrice: price, stockQty });
  return { product, listing };
}

async function fillCart(user, listing, product, quantity = 1) {
  await prisma.cartItem.deleteMany({ where: { userId: user.user.id } });
  await prisma.cartItem.create({
    data: {
      userId: user.user.id, listingId: listing.id, productId: product.id,
      quantity, unitPriceSnapshot: listing.sellingPrice,
    },
  });
}

const stockOf = async (id) => (await prisma.sellerListing.findUnique({ where: { id } })).stockQty;

const initiate = (user) => request(app).post(`${API}/orders/initiate`).set(user.headers)
  .send({ paymentMethod: 'upi', deliveryAddress: address });

const confirm = (user, providerOrderId, paymentId) =>
  request(app).post(`${API}/orders/confirm`).set(user.headers).send({
    razorpayOrderId: providerOrderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: 'x'.repeat(64), // mock mode accepts any well-formed signature
    deliveryAddress: address,
  });

beforeAll(async () => {
  app = await getApp();
  farmer = await createTestUser();
  seller = await createTestSeller();
  category = await createTestCategory();
});

afterAll(async () => { await cleanupTestData(); });

describe('Holding stock at /orders/initiate', () => {
  test('takes the units off the shelf before the buyer pays', async () => {
    const { product, listing } = await makeOffer({ stockQty: 5 });
    await fillCart(farmer, listing, product, 2);

    const res = await initiate(farmer);
    expect(res.status).toBe(200);

    // This is the whole point: the units are gone from availability while the
    // payment sheet is open, so nobody else can pay for them.
    expect(await stockOf(listing.id)).toBe(3);
    expect(res.body.data.reservedUntil).toBeTruthy();

    const held = await prisma.stockReservation.findMany({
      where: { providerOrderId: res.body.data.razorpayOrderId },
    });
    expect(held).toHaveLength(1);
    expect(held[0].quantity).toBe(2);
    expect(held[0].status).toBe('HELD');
  });

  test('a second buyer cannot even start paying for the last unit', async () => {
    const buyerB = await createTestUser();
    const { product, listing } = await makeOffer({ stockQty: 1 });

    await fillCart(farmer, listing, product, 1);
    const first = await initiate(farmer);
    expect(first.status).toBe(200);
    expect(await stockOf(listing.id)).toBe(0);

    await fillCart(buyerB, listing, product, 1);
    const second = await initiate(buyerB);

    // Refused BEFORE any money moves — which is the difference between an
    // apology and a refund.
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(await stockOf(listing.id)).toBe(0);
  });

  test('the listing flips to OUT_OF_STOCK when a hold takes the last unit', async () => {
    const { product, listing } = await makeOffer({ stockQty: 1 });
    await fillCart(farmer, listing, product, 1);

    await initiate(farmer);

    const after = await prisma.sellerListing.findUnique({ where: { id: listing.id } });
    expect(after.stockQty).toBe(0);
    expect(after.status).toBe('OUT_OF_STOCK');
  });
});

describe('Consuming the hold at /orders/confirm', () => {
  test('does NOT decrement a second time', async () => {
    const { product, listing } = await makeOffer({ stockQty: 5 });
    await fillCart(farmer, listing, product, 2);

    const init = await initiate(farmer);
    const providerOrderId = init.body.data.razorpayOrderId;
    expect(await stockOf(listing.id)).toBe(3);   // held

    const done = await confirm(farmer, providerOrderId, `pay_${Date.now()}`);
    expect(done.status).toBe(201);

    // Still 3. A double decrement would show 1 here — the oversell this whole
    // mechanism exists to make impossible.
    expect(await stockOf(listing.id)).toBe(3);

    const rows = await prisma.stockReservation.findMany({ where: { providerOrderId } });
    expect(rows.every((r) => r.status === 'CONSUMED')).toBe(true);
  });

  test('the buyer who reserved the LAST unit can still complete the purchase', async () => {
    const { product, listing } = await makeOffer({ stockQty: 1 });
    await fillCart(farmer, listing, product, 1);

    const init = await initiate(farmer);
    expect(await stockOf(listing.id)).toBe(0);

    // Availability is now zero — but zero because THIS buyer is holding it. The
    // confirm-time stock check has to count their own hold as available to them,
    // or the reservation would lock the buyer out of their own purchase.
    const done = await confirm(farmer, init.body.data.razorpayOrderId, `pay_last_${Date.now()}`);

    expect(done.status).toBe(201);
    expect(await stockOf(listing.id)).toBe(0);
  });

  test('a failed confirmation returns the units immediately, not at TTL', async () => {
    const { product, listing } = await makeOffer({ stockQty: 4 });
    await fillCart(farmer, listing, product, 2);

    const init = await initiate(farmer);
    const providerOrderId = init.body.data.razorpayOrderId;
    expect(await stockOf(listing.id)).toBe(2);

    // Emptying the cart makes the confirm fail: there is nothing to order.
    await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
    const failed = await confirm(farmer, providerOrderId, `pay_fail_${Date.now()}`);
    expect(failed.status).toBeGreaterThanOrEqual(400);

    // Back on the shelf. Waiting out the TTL here would keep saleable stock
    // hidden for 15 minutes for no reason.
    expect(await stockOf(listing.id)).toBe(4);
    const rows = await prisma.stockReservation.findMany({ where: { providerOrderId } });
    expect(rows.every((r) => r.status === 'RELEASED')).toBe(true);
  });
});

describe('Releasing a hold', () => {
  test('is idempotent — a double release cannot create free stock', async () => {
    const { product, listing } = await makeOffer({ stockQty: 3 });
    await fillCart(farmer, listing, product, 2);

    const init = await initiate(farmer);
    const providerOrderId = init.body.data.razorpayOrderId;
    expect(await stockOf(listing.id)).toBe(1);

    const first = await releaseReservations(providerOrderId, 'test');
    expect(first.released).toBe(1);
    expect(await stockOf(listing.id)).toBe(3);

    // Four different code paths can call release (confirm-failure, webhook,
    // reconciler, sweeper) without coordinating. If a second call restocked
    // again, the seller would gain inventory they do not have.
    const second = await releaseReservations(providerOrderId, 'test again');
    expect(second.released).toBe(0);
    expect(await stockOf(listing.id)).toBe(3);
  });

  test('the expiry sweep returns abandoned holds', async () => {
    const { product, listing } = await makeOffer({ stockQty: 6 });
    await fillCart(farmer, listing, product, 3);

    const init = await initiate(farmer);
    const providerOrderId = init.body.data.razorpayOrderId;
    expect(await stockOf(listing.id)).toBe(3);

    // An abandoned payment sheet produces no webhook and no client call — the
    // sweeper is the ONLY thing that recovers these units.
    await prisma.stockReservation.updateMany({
      where: { providerOrderId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const swept = await sweepExpiredReservations();
    expect(swept.released).toBeGreaterThanOrEqual(1);
    expect(await stockOf(listing.id)).toBe(6);
  });

  test('the sweep leaves un-expired holds alone', async () => {
    const { product, listing } = await makeOffer({ stockQty: 5 });
    await fillCart(farmer, listing, product, 2);

    const init = await initiate(farmer);
    await sweepExpiredReservations();

    // Still held — the buyer is mid-payment.
    expect(await stockOf(listing.id)).toBe(3);
    const rows = await prisma.stockReservation.findMany({
      where: { providerOrderId: init.body.data.razorpayOrderId },
    });
    expect(rows.every((r) => r.status === 'HELD')).toBe(true);
  });

  test('a payment.failed webhook returns the units', async () => {
    const crypto = await import('node:crypto');
    const { ENV } = await import('../../../src/config/env.js');
    const savedSecret = ENV.RAZORPAY_WEBHOOK_SECRET;
    ENV.RAZORPAY_WEBHOOK_SECRET = 'reservation_test_secret';

    try {
      const { product, listing } = await makeOffer({ stockQty: 4 });
      await fillCart(farmer, listing, product, 2);

      const init = await initiate(farmer);
      const providerOrderId = init.body.data.razorpayOrderId;
      expect(await stockOf(listing.id)).toBe(2);

      const payload = {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: `pay_wh_fail_${Date.now()}`, order_id: providerOrderId,
              status: 'failed', error_description: 'card declined',
            },
          },
        },
      };
      const raw = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', ENV.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');

      await request(app).post('/api/v1/shop-webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', signature)
        .send(raw);

      // The payment is not coming. On a nearly-sold-out product, returning these
      // now rather than at TTL is the difference between the next farmer being
      // able to buy it and being told it is gone.
      expect(await stockOf(listing.id)).toBe(4);
    } finally {
      ENV.RAZORPAY_WEBHOOK_SECRET = savedSecret;
    }
  });
});

describe('Cash on delivery is unaffected', () => {
  test('decrements directly — there is no payment window to hold across', async () => {
    const { product, listing } = await makeOffer({ stockQty: 5 });
    await fillCart(farmer, listing, product, 2);

    const res = await request(app).post(`${API}/orders`).set(farmer.headers)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });

    expect(res.status).toBe(201);
    expect(await stockOf(listing.id)).toBe(3);
    // No reservation rows: COD creates the order in one step.
    expect(await prisma.stockReservation.count({ where: { listingId: listing.id } })).toBe(0);
  });
});

describe('The setting turns it off', () => {
  test('with reservations disabled, initiate holds nothing', async () => {
    // setSetting invalidates the in-process settings cache; writing the row
    // directly would leave the cached `true` in force for up to a minute.
    const { setSetting } = await import('../../../src/services/settings.service.js');
    await setSetting('shop.reservation.enabled', false, null);

    try {
      const { product, listing } = await makeOffer({ stockQty: 5 });
      await fillCart(farmer, listing, product, 2);

      const res = await initiate(farmer);
      expect(res.status).toBe(200);

      // Old behaviour restored: stock untouched until the order is created.
      expect(await stockOf(listing.id)).toBe(5);
      expect(res.body.data.reservedUntil).toBeNull();
    } finally {
      await setSetting('shop.reservation.enabled', true, null);
    }
  });
});
