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

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const isMock = !ENV.RAZORPAY_KEY_ID || !ENV.RAZORPAY_KEY_SECRET;

/**
 * Create a Razorpay payment order.
 * @param {number} amountInPaise — amount in smallest currency unit (paise for INR)
 * @param {string} currency — 'INR'
 * @param {string} receipt — unique receipt id (e.g. order UUID)
 * @returns {{ id, amount, currency, receipt, status }}
 */
export async function createPaymentOrder(amountInPaise, currency = 'INR', receipt = '') {
  if (isMock) {
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

  const { data } = await axios.post(`${RAZORPAY_API}/orders`, {
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

  return data;
}

/**
 * Verify the Razorpay payment signature (HMAC SHA256).
 * @param {string} razorpayOrderId
 * @param {string} razorpayPaymentId
 * @param {string} razorpaySignature
 * @returns {boolean}
 */
export function verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  if (isMock) return true;

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', ENV.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(razorpaySignature, 'hex'),
  );
}

/**
 * Process a refund via Razorpay.
 * @param {string} paymentId — Razorpay payment ID
 * @param {number} amountInPaise — amount to refund (partial allowed)
 * @returns {{ id, payment_id, amount, status }}
 */
export async function processRefund(paymentId, amountInPaise) {
  if (isMock) {
    return {
      id: `mock_refund_${crypto.randomUUID().slice(0, 8)}`,
      payment_id: paymentId,
      amount: amountInPaise,
      status: 'processed',
      mock: true,
    };
  }

  const auth = Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${ENV.RAZORPAY_KEY_SECRET}`).toString('base64');

  const { data } = await axios.post(`${RAZORPAY_API}/payments/${paymentId}/refund`, {
    amount: amountInPaise,
  }, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  return data;
}
