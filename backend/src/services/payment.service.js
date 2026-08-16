/**
 * Payment Service — Razorpay integration
 *
 * Provides:
 *   createPaymentOrder(amount, currency, receipt)  → Razorpay order object
 *   verifyPaymentSignature(orderId, paymentId, signature) → boolean
 *   processRefund(paymentId, amount) → refund object
 *
 * Requires env:
 *   RAZORPAY_KEY_ID      — from Razorpay dashboard (test or live)
 *   RAZORPAY_KEY_SECRET  — corresponding secret
 *
 * In development (no keys set), operates in mock mode:
 *   - createPaymentOrder returns a fake order with id prefix `mock_`
 *   - verifyPaymentSignature always returns true
 *   - processRefund returns a fake refund
 *
 * Usage flow:
 *   1. Client calls POST /agristore/orders/initiate → gets Razorpay orderId
 *   2. Client opens Razorpay checkout with orderId
 *   3. Client sends payment confirmation to POST /agristore/orders/confirm
 *   4. Server verifies signature → creates the real order
 */
import crypto from 'crypto';
import axios from 'axios';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';
import { razorpayBreaker, httpFailure } from '../resilience/breakers.js';

const RAZORPAY_API = 'https://api.razorpay.com/v1';
/**
 * Is the gateway unconfigured (i.e. are we faking responses)?
 *
 * Evaluated PER CALL, not frozen at module load. It was
 * `const isMock = !ENV.RAZORPAY_KEY_ID || ...`, which meant the value was
 * decided the first time this file was imported and could never change —
 * untestable, and it would have reported the wrong answer to
 * GET /agristore/payment-config for the whole life of the process if the
 * config were ever adjusted at runtime. Two property reads per call is nothing
 * next to the network round-trip that follows.
 */
function isMock() {
  return !ENV.RAZORPAY_KEY_ID || !ENV.RAZORPAY_KEY_SECRET;
}

/**
 * Create a Razorpay payment order.
 * @param {number} amountInPaise — amount in smallest currency unit (paise for INR)
 * @param {string} currency — 'INR'
 * @param {string} receipt — unique receipt id (e.g. order UUID)
 * @returns {{ id, amount, currency, receipt, status }}
 */
export async function createPaymentOrder(amountInPaise, currency = 'INR', receipt = '') {
  if (isMock()) {
    logger.warn('[Payment] Running in MOCK mode — no Razorpay keys configured');
    return {
      id: `mock_order_${crypto.randomUUID().slice(0, 8)}`,
      amount: amountInPaise,
      currency,
      receipt,
      status: 'created',
      mock: true,
    };
  }

  const auth = Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${ENV.RAZORPAY_KEY_SECRET}`).toString('base64');

  // Breaker: if Razorpay is down, fail fast (503) rather than holding every
  // checkout for 10s. 4xx (bad request) don't trip it — only 5xx/timeout/network.
  const data = await razorpayBreaker().execute(async () => {
    const res = await axios.post(`${RAZORPAY_API}/orders`, {
      amount: amountInPaise,
      currency,
      receipt,
      payment_capture: 1, // auto-capture
    }, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    return res.data;
  }, { isFailure: httpFailure });

  return data;
}

/**
 * Fetch an existing Razorpay order — the authoritative record of the amount that
 * was locked in at /initiate (and auto-captured on payment). Used at /confirm to
 * bind "what was actually authorized/paid" to the freshly recomputed cart total,
 * so a client can't initiate+pay for a cheap cart and then enlarge it before
 * confirming.
 * @param {string} orderId — Razorpay order id (razorpayOrderId)
 * @returns {Promise<{ id, amount, amount_paid, currency, receipt, status, mock? }>}
 *          In mock mode returns `{ id, mock: true }` (no amount to bind against).
 */
export async function fetchPaymentOrder(orderId) {
  if (isMock()) {
    return { id: orderId, mock: true };
  }

  const auth = Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${ENV.RAZORPAY_KEY_SECRET}`).toString('base64');

  const data = await razorpayBreaker().execute(async () => {
    const res = await axios.get(`${RAZORPAY_API}/orders/${orderId}`, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000,
    });
    return res.data;
  }, { isFailure: httpFailure });

  return data; // { id, amount, amount_paid, currency, receipt, status, ... }
}

/**
 * Verify the Razorpay payment signature (HMAC SHA256).
 * @param {string} razorpayOrderId
 * @param {string} razorpayPaymentId
 * @param {string} razorpaySignature
 * @returns {boolean}
 */
export function verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  if (isMock()) return true;

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', ENV.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  // timingSafeEqual THROWS RangeError when the two buffers differ in length, and
  // Buffer.from(x, 'hex') silently truncates anything non-hex — so a client
  // sending `razorpaySignature: "zz"` produced an uncaught throw out of a handler
  // that calls this OUTSIDE its try block, i.e. a 500 with a stack instead of a
  // clean 400. A malformed signature is simply an invalid signature.
  if (typeof razorpaySignature !== 'string' || !/^[0-9a-f]{64}$/i.test(razorpaySignature)) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(razorpaySignature, 'hex'),
  );
}

/**
 * Verify a Razorpay WEBHOOK signature against the RAW request body.
 *
 * A different secret and a different payload from the checkout signature above:
 * webhooks are signed with RAZORPAY_WEBHOOK_SECRET over the exact bytes Razorpay
 * sent. Re-serialising the parsed JSON does not reproduce those bytes (key order,
 * unicode escaping, whitespace), so the route must receive the raw Buffer — see
 * the express.raw mount in app.js.
 *
 * Fails CLOSED: with no webhook secret configured, no webhook is trusted. A
 * webhook is the one channel that can mark money as received without a logged-in
 * user behind it, so "no secret" must mean "reject", never "accept".
 *
 * @param {Buffer|string} rawBody
 * @param {string} signature  X-Razorpay-Signature header
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!ENV.RAZORPAY_WEBHOOK_SECRET) {
    logger.error('[Payment] Webhook received but RAZORPAY_WEBHOOK_SECRET is not set — rejecting');
    return false;
  }
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  if (rawBody == null) return false;

  const expected = crypto
    .createHmac('sha256', ENV.RAZORPAY_WEBHOOK_SECRET)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

/**
 * Fetch a single payment. The authority on whether money actually moved.
 *
 * Used by the reconciler: when the app died between /initiate and /confirm the
 * ONLY way to learn the truth is to ask the gateway, because the client that
 * would have told us is gone.
 *
 * @returns {Promise<{id, order_id, status, amount, method, error_description?}|null>}
 */
export async function fetchPayment(paymentId) {
  if (isMock()) return { id: paymentId, status: 'captured', mock: true };

  const auth = Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${ENV.RAZORPAY_KEY_SECRET}`).toString('base64');
  try {
    return await razorpayBreaker().execute(async () => {
      const res = await axios.get(`${RAZORPAY_API}/payments/${paymentId}`, {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 10000,
      });
      return res.data;
    }, { isFailure: httpFailure });
  } catch (err) {
    logger.warn('[Payment] fetchPayment(%s) failed: %s', paymentId, err.message);
    return null;
  }
}

/**
 * List the payments raised against one gateway order.
 *
 * The reconciler holds a providerOrderId (it created it) but usually NOT a
 * paymentId — the client never got far enough to report one. This is how it
 * finds out whether that order was ever paid.
 */
export async function fetchOrderPayments(providerOrderId) {
  if (isMock()) return [];

  const auth = Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${ENV.RAZORPAY_KEY_SECRET}`).toString('base64');
  try {
    const data = await razorpayBreaker().execute(async () => {
      const res = await axios.get(`${RAZORPAY_API}/orders/${providerOrderId}/payments`, {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 10000,
      });
      return res.data;
    }, { isFailure: httpFailure });
    return Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    logger.warn('[Payment] fetchOrderPayments(%s) failed: %s', providerOrderId, err.message);
    return [];
  }
}

/** True when no gateway keys are configured and the service is faking responses. */
export const isMockPayments = () => isMock();

/**
 * Process a refund via Razorpay.
 * @param {string} paymentId — Razorpay payment ID
 * @param {number} amountInPaise — amount to refund (partial allowed)
 * @returns {{ id, payment_id, amount, status }}
 */
export async function processRefund(paymentId, amountInPaise) {
  if (isMock()) {
    return {
      id: `mock_refund_${crypto.randomUUID().slice(0, 8)}`,
      payment_id: paymentId,
      amount: amountInPaise,
      status: 'processed',
      mock: true,
    };
  }

  const auth = Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${ENV.RAZORPAY_KEY_SECRET}`).toString('base64');

  const data = await razorpayBreaker().execute(async () => {
    const res = await axios.post(`${RAZORPAY_API}/payments/${paymentId}/refund`, {
      amount: amountInPaise,
    }, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    return res.data;
  }, { isFailure: httpFailure });

  return data;
}
