/**
 * Payment webhook + interrupted-payment recovery.
 *
 * The hole: /orders/initiate created a Razorpay order and wrote nothing locally,
 * so a phone that died between paying and confirming left the money captured and
 * this system with no record a payment had been started. Nothing could reconcile
 * it because nothing knew.
 *
 * These tests cover the three properties a payment webhook must have — verified
 * signature over the RAW body, fail-closed on a missing secret, idempotent on
 * redelivery — plus the intent row that makes recovery possible at all.
 */
import crypto from 'crypto';
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller, createTestCategory,
  createTestCatalogProduct, createTestListing, cleanupTestData, prisma,
} from '../../fixtures/setup.js';

const API = '/api/v1/agristore';
const HOOK = '/api/v1/shop-webhooks/razorpay';

let app; let farmer; let seller; let category; let product; let listing;

const address = {
  type: 'HOME', name: 'Test Farmer', phone: '9876543210',
  flat: '1A', street: 'Main', city: 'Pune', state: 'Maharashtra', pincode: '411001',
};

const WEBHOOK_SECRET = 'test_webhook_secret_value';

/** Sign a payload exactly the way Razorpay does: HMAC-SHA256 over the raw bytes. */
function signed(payload, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return { raw, signature };
}

const capturedEvent = (providerOrderId, paymentId, amountPaise = 44900) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: providerOrderId, amount: amountPaise, status: 'captured' } } },
});

beforeAll(async () => {
  // env.js resolves process.env ONCE at import, and the fixtures pull it in
  // before any beforeAll runs — so setting process.env here would be too late.
  // The secret is written onto the resolved ENV object instead, which is what
  // the verifier actually reads.
  //
  // The webhook FAILS CLOSED with no secret, so the suite has to set one; that
  // fail-closed behaviour is itself asserted in its own test below.
  const { ENV } = await import('../../../src/config/env.js');
  ENV.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

  app = await getApp();
  farmer = await createTestUser();
  seller = await createTestSeller();
  category = await createTestCategory();
  product = await createTestCatalogProduct(category.id, { name: 'Webhook Test Urea' });
  listing = await createTestListing(seller.user.id, product.variants[0].id, { sellingPrice: 200, stockQty: 50 });
});

beforeEach(async () => {
  await prisma.paymentWebhookEvent.deleteMany();
  await prisma.paymentIntent.deleteMany();
});

afterAll(async () => { await cleanupTestData(); });

async function fillCart(quantity = 2) {
  await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
  await prisma.cartItem.create({
    data: { userId: farmer.user.id, listingId: listing.id, productId: product.id, quantity, unitPriceSnapshot: 200 },
  });
}

describe('POST /orders/initiate — the intent is recorded before the gateway is called', () => {
  test('writes a PaymentIntent for the QUOTE total, not the goods subtotal', async () => {
    await fillCart(2);

    const res = await request(app)
      .post(`${API}/orders/initiate`)
      .set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });

    expect(res.status).toBe(200);
    const { razorpayOrderId, amountInPaise } = res.body.data;

    // 2 × 200 goods + 49 delivery = 449. The old code raised the gateway order
    // for 400 while the app displayed 449.
    expect(amountInPaise).toBe(44900);
    expect(Number(res.body.data.quote.total)).toBeCloseTo(449, 2);

    const intent = await prisma.paymentIntent.findUnique({ where: { providerOrderId: razorpayOrderId } });
    expect(intent).toBeTruthy();
    expect(intent.userId).toBe(farmer.user.id);
    expect(intent.amountPaise).toBe(44900);
    expect(intent.status).toBe('CREATED');
  });

  test('the receipt is unique per checkout, not a per-user constant', async () => {
    await fillCart(1);
    const a = await request(app).post(`${API}/orders/initiate`).set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });
    await fillCart(1);
    const b = await request(app).post(`${API}/orders/initiate`).set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });

    // `cart_${userId}` was identical for every payment that user ever made, so
    // the confirm-time receipt check proved nothing about WHICH checkout it was.
    expect(a.body.data.receipt).not.toBe(b.body.data.receipt);
  });

  test('409 — refuses to raise a payment for a cart that cannot be checked out', async () => {
    await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
    await prisma.cartItem.create({
      data: { userId: farmer.user.id, listingId: listing.id, productId: product.id, quantity: 9999, unitPriceSnapshot: 200 },
    });

    const res = await request(app).post(`${API}/orders/initiate`).set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });

    expect(res.status).toBe(409);
    expect(res.body.error.details.issues.some((i) => i.code === 'INSUFFICIENT_STOCK')).toBe(true);
    // Nothing was raised with the gateway, so nothing needs reconciling.
    expect(await prisma.paymentIntent.count()).toBe(0);
  });
});

describe('GET /orders/payment-status — "did my payment go through?"', () => {
  test('reports a pending payment as CONFIRMING, never as failed', async () => {
    await fillCart(1);
    const init = await request(app).post(`${API}/orders/initiate`).set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });
    const providerOrderId = init.body.data.razorpayOrderId;

    await prisma.paymentIntent.update({ where: { providerOrderId }, data: { status: 'PAID' } });

    const res = await request(app).get(`${API}/orders/payment-status/${providerOrderId}`).set(farmer.headers);

    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('CONFIRMING');
    // The single most important string in this module: showing "failed" here is
    // how a farmer pays twice.
    expect(res.body.data.message).toMatch(/do not pay again/i);
  });

  test('404 — another buyer cannot read a payment they did not make', async () => {
    await fillCart(1);
    const init = await request(app).post(`${API}/orders/initiate`).set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });

    const other = await createTestUser();
    const res = await request(app)
      .get(`${API}/orders/payment-status/${init.body.data.razorpayOrderId}`)
      .set(other.headers);

    expect(res.status).toBe(404);
  });
});

describe('POST /shop-webhooks/razorpay — signature', () => {
  test('400 — a payload with no signature is rejected', async () => {
    const { raw } = signed(capturedEvent('order_x', 'pay_x'));
    const res = await request(app).post(HOOK).set('Content-Type', 'application/json').send(raw);
    expect(res.status).toBe(400);
  });

  test('400 — a forged signature is rejected', async () => {
    const { raw } = signed(capturedEvent('order_x', 'pay_x'));
    const res = await request(app)
      .post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'a'.repeat(64))
      .send(raw);
    expect(res.status).toBe(400);
  });

  test('400 — a malformed signature does not throw (timingSafeEqual length trap)', async () => {
    const { raw } = signed(capturedEvent('order_x', 'pay_x'));
    // Buffer.from('zz','hex') is shorter than the digest, and timingSafeEqual
    // THROWS on a length mismatch — a 500 with a stack, not a 400, unless the
    // shape is validated first.
    const res = await request(app)
      .post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'zz')
      .send(raw);
    expect(res.status).toBe(400);
  });

  test('400 — a signature computed with the WRONG secret is rejected', async () => {
    const payload = capturedEvent('order_x', 'pay_x');
    const { raw, signature } = signed(payload, 'not_the_real_secret');
    const res = await request(app)
      .post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .send(raw);
    expect(res.status).toBe(400);
  });

  test('400 — fails CLOSED when no webhook secret is configured', async () => {
    // A webhook can mark money as received with no authenticated user behind it,
    // so "no secret configured" must mean "reject", never "accept anything".
    const { ENV } = await import('../../../src/config/env.js');
    const saved = ENV.RAZORPAY_WEBHOOK_SECRET;
    ENV.RAZORPAY_WEBHOOK_SECRET = '';
    try {
      const { raw, signature } = signed(capturedEvent('order_closed', 'pay_closed'));
      const res = await request(app)
        .post(HOOK)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', signature)
        .send(raw);
      expect(res.status).toBe(400);
    } finally {
      ENV.RAZORPAY_WEBHOOK_SECRET = saved;
    }
  });
});

describe('POST /shop-webhooks/razorpay — processing', () => {
  async function initiate() {
    await fillCart(2);
    const res = await request(app).post(`${API}/orders/initiate`).set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });
    return res.body.data.razorpayOrderId;
  }

  test('a valid capture marks the intent PAID', async () => {
    const providerOrderId = await initiate();
    const payload = capturedEvent(providerOrderId, `pay_${Date.now()}`);
    const { raw, signature } = signed(payload);

    const res = await request(app)
      .post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .send(raw);

    expect(res.status).toBe(200);
    const intent = await prisma.paymentIntent.findUnique({ where: { providerOrderId } });
    expect(intent.status).toBe('PAID');
    expect(intent.providerPaymentId).toBe(payload.payload.payment.entity.id);
  });

  test('redelivery of the same event is a no-op, not a second effect', async () => {
    const providerOrderId = await initiate();
    const payload = capturedEvent(providerOrderId, `pay_dup_${Date.now()}`);
    const { raw, signature } = signed(payload);

    const send = () => request(app).post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .send(raw);

    const first = await send();
    // Razorpay retries for 24 hours. This WILL arrive many times.
    const second = await send();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.headers['x-webhook-replay']).toBe('true');
    // Exactly one event row, therefore exactly one pass through the handler.
    expect(await prisma.paymentWebhookEvent.count()).toBe(1);
  });

  test('a failure event records the gateway reason instead of leaving it PENDING', async () => {
    const providerOrderId = await initiate();
    const payload = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: `pay_fail_${Date.now()}`, order_id: providerOrderId,
            status: 'failed', error_description: 'insufficient funds',
          },
        },
      },
    };
    const { raw, signature } = signed(payload);

    await request(app).post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .send(raw);

    const intent = await prisma.paymentIntent.findUnique({ where: { providerOrderId } });
    expect(intent.status).toBe('FAILED');
    expect(intent.failureReason).toBe('insufficient funds');
  });

  test('a capture for an unknown gateway order is recorded as FAILED, not silently swallowed', async () => {
    const payload = capturedEvent(`order_unknown_${Date.now()}`, `pay_unknown_${Date.now()}`);
    const { raw, signature } = signed(payload);

    const res = await request(app).post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .send(raw);

    expect(res.status).toBe(200); // never ask the gateway to retry forever
    const event = await prisma.paymentWebhookEvent.findFirst({ orderBy: { receivedAt: 'desc' } });
    // A capture with no local intent means /initiate never recorded one — a real
    // hole, and it must be visible rather than a 200 with nothing behind it.
    expect(event.status).toBe('FAILED');
    expect(event.error).toMatch(/no matching payment intent/i);
  });

  test('a refund event flips the order out of "paid"', async () => {
    const paymentId = `pay_refund_${Date.now()}`;
    const order = await prisma.order.create({
      data: {
        userId: farmer.user.id, totalAmount: 449, subtotal: 400, deliveryFee: 49,
        deliveryAddress: address, paymentMethod: 'online', paymentStatus: 'paid',
        paymentRef: paymentId,
      },
    });

    const payload = {
      event: 'refund.processed',
      payload: { refund: { entity: { id: `rfnd_${Date.now()}`, payment_id: paymentId, amount: 44900 } } },
    };
    const { raw, signature } = signed(payload);

    await request(app).post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .send(raw);

    const after = await prisma.order.findUnique({ where: { id: order.id } });
    // An order that stays "paid" after a refund is what turns a refund into a
    // support ticket.
    expect(after.paymentStatus).toBe('refunded');
  });

  test('an event type we do not handle is acknowledged, not retried forever', async () => {
    const payload = { event: 'payment.authorized', payload: { payment: { entity: { id: `pay_auth_${Date.now()}` } } } };
    const { raw, signature } = signed(payload);

    const res = await request(app).post(HOOK)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature)
      .send(raw);

    expect(res.status).toBe(200);
    const event = await prisma.paymentWebhookEvent.findFirst({ orderBy: { receivedAt: 'desc' } });
    expect(event.status).toBe('IGNORED');
  });
});

describe('Order confirmation is bound to the buyer and the checkout', () => {
  test('400 — one buyer cannot confirm against another buyer\'s payment intent', async () => {
    await fillCart(1);
    const init = await request(app).post(`${API}/orders/initiate`).set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });
    const providerOrderId = init.body.data.razorpayOrderId;

    const attacker = await createTestUser();
    await prisma.cartItem.create({
      data: { userId: attacker.user.id, listingId: listing.id, productId: product.id, quantity: 1, unitPriceSnapshot: 200 },
    });

    // In mock mode the signature check passes for anyone, so the ONLY thing
    // standing between an attacker and someone else's paid order is the intent's
    // ownership check.
    const res = await request(app).post(`${API}/orders/confirm`).set(attacker.headers).send({
      razorpayOrderId: providerOrderId,
      razorpayPaymentId: `pay_steal_${Date.now()}`,
      razorpaySignature: 'x'.repeat(64),
      deliveryAddress: address,
    });

    expect(res.status).toBe(400);
  });

  test('a captured signed triple cannot be replayed into a second paid order', async () => {
    // C-2: the payment id used to live only inside the free-text `notes`
    // ("razorpay:<id>") with no constraint, so a buyer who completed ONE genuine
    // payment could re-fill the cart and replay the identical
    // (orderId, paymentId, signature) triple forever — N orders for the price of
    // one. `Order.paymentRef` is now UNIQUE and the replay is answered with the
    // order the payment already produced.
    await fillCart(1);
    const init = await request(app).post(`${API}/orders/initiate`).set(farmer.headers)
      .send({ paymentMethod: 'upi', deliveryAddress: address });
    const razorpayOrderId = init.body.data.razorpayOrderId;

    const triple = {
      razorpayOrderId,
      razorpayPaymentId: `pay_replay_${Date.now()}`,
      razorpaySignature: 'x'.repeat(64),
      deliveryAddress: address,
    };

    const first = await request(app).post(`${API}/orders/confirm`).set(farmer.headers).send(triple);
    expect(first.status).toBe(201);

    // Re-fill the cart: the replay is only worth anything if there is something
    // new to be shipped for free.
    await fillCart(1);

    // No Idempotency-Key — this must be stopped by the payment id itself, not by
    // the client happening to reuse a key.
    const second = await request(app).post(`${API}/orders/confirm`).set(farmer.headers).send(triple);

    // A legitimate retry (dropped response, app relaunch) looks identical, so the
    // replay is answered with the existing order rather than an error.
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const orders = await prisma.order.findMany({ where: { paymentRef: triple.razorpayPaymentId } });
    expect(orders).toHaveLength(1);
  });
});

describe('GET /payment-config — the app only offers what can be collected', () => {
  test('reports online payment DISABLED when the gateway has no keys', async () => {
    // The checkout screen used to render UPI and Card unconditionally, then post
    // the choice to POST /orders — which creates an order and never asks for
    // money. The farmer saw "Order Placed!" with a UPI badge and was charged
    // nothing. The app now asks first.
    const res = await request(app).get(`${API}/payment-config`).set(farmer.headers);

    expect(res.status).toBe(200);
    // The suite runs with no RAZORPAY_KEY_ID, i.e. mock mode.
    expect(res.body.data.onlineEnabled).toBe(false);
    expect(res.body.data.methods).toEqual(['cod']);
    // No key is exposed when there is none to expose.
    expect(res.body.data.keyId).toBeNull();
  });

  test('flips to ENABLED once the gateway is configured', async () => {
    // Proves the gate is driven by configuration rather than hard-coded off:
    // set a key and UPI/Card become available to the app, which is exactly what
    // happens on a deploy with real Razorpay credentials.
    const { ENV } = await import('../../../src/config/env.js');
    const savedId = ENV.RAZORPAY_KEY_ID;
    const savedSecret = ENV.RAZORPAY_KEY_SECRET;
    ENV.RAZORPAY_KEY_ID = 'rzp_test_publishable';
    ENV.RAZORPAY_KEY_SECRET = 'test_secret_value';
    try {
      const res = await request(app).get(`${API}/payment-config`).set(farmer.headers);
      expect(res.body.data.onlineEnabled).toBe(true);
      expect(res.body.data.methods).toEqual(['cod', 'upi', 'card']);
      // The PUBLISHABLE key reaches the client (it must, to open checkout)…
      expect(res.body.data.keyId).toBe('rzp_test_publishable');
      // …and the SECRET never does.
      expect(JSON.stringify(res.body)).not.toContain('test_secret_value');
    } finally {
      ENV.RAZORPAY_KEY_ID = savedId;
      ENV.RAZORPAY_KEY_SECRET = savedSecret;
    }
  });

  test('401 — not public', async () => {
    const res = await request(app).get(`${API}/payment-config`);
    expect(res.status).toBe(401);
  });

  test('never leaks the SECRET key', async () => {
    const res = await request(app).get(`${API}/payment-config`).set(farmer.headers);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/secret/i);
    // keyId is the PUBLISHABLE key by design; the secret must never appear.
    const { ENV } = await import('../../../src/config/env.js');
    if (ENV.RAZORPAY_KEY_SECRET) expect(body).not.toContain(ENV.RAZORPAY_KEY_SECRET);
  });
});

describe('Inline delivery addresses are validated like saved ones', () => {
  async function orderWith(address) {
    await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
    await prisma.cartItem.create({
      data: { userId: farmer.user.id, listingId: listing.id, productId: product.id, quantity: 1, unitPriceSnapshot: 200 },
    });
    return request(app).post(`${API}/orders`).set(farmer.headers)
      .send({ deliveryAddress: address, paymentMethod: 'cod' });
  }

  const base = {
    type: 'HOME', name: 'Test Farmer', phone: '9876543210',
    flat: '1A', street: 'Main', city: 'Pune', state: 'Maharashtra', pincode: '411001',
  };

  test('400 — a non-numeric PIN code is rejected', async () => {
    // POST /addresses enforces /^\d{6}$/, but posting the object straight to
    // checkout bypassed that entirely: "abc" was accepted, landed in the order
    // JSON, and silently nulled deliveryPincode so serviceability skipped.
    const res = await orderWith({ ...base, pincode: 'abcdef' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/PIN code/i);
  });

  test('400 — a 5-digit PIN code is rejected', async () => {
    const res = await orderWith({ ...base, pincode: '41100' });
    expect(res.status).toBe(400);
  });

  test('400 — a PIN code starting with 0 is rejected', async () => {
    // No Indian PIN code starts with 0.
    const res = await orderWith({ ...base, pincode: '011001' });
    expect(res.status).toBe(400);
  });

  test('400 — a malformed phone number is rejected', async () => {
    const res = await orderWith({ ...base, phone: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/mobile number/i);
  });

  test('400 — an absurdly long city is rejected rather than stored', async () => {
    const res = await orderWith({ ...base, city: 'x'.repeat(5000) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/too long/i);
  });

  test('201 — a valid inline address still works', async () => {
    const res = await orderWith(base);
    expect(res.status).toBe(201);
    // And the pincode is recorded, so serviceability and the ETA are real.
    expect(res.body.data.deliveryPincode).toBe('411001');
  });
});
