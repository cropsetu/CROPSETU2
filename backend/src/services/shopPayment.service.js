/**
 * Shop payments — intents, webhooks, reconciliation.
 *
 * ── The hole this closes ─────────────────────────────────────────────────────
 * The old flow was two calls with nothing between them:
 *
 *   POST /orders/initiate   → create a Razorpay order, return its id, WRITE NOTHING
 *   POST /orders/confirm    → verify the signature, create the Order
 *
 * If the phone lost signal, the app was killed, or the farmer closed the payment
 * sheet after paying — all routine on a village connection — the money was
 * captured and this system had no record that a payment had ever been started.
 * Nothing could reconcile it, because nothing knew. The farmer's only recourse
 * was a support ticket with a bank SMS as evidence.
 *
 * Three pieces fix it:
 *
 *   PaymentIntent   written BEFORE the gateway is called, so an interrupted
 *                   payment is a row in a queryable state, not a silence.
 *   Webhook         Razorpay tells us `payment.captured` even when the client
 *                   never comes back. Signature-verified, idempotent by event id.
 *   Reconciler      sweeps intents that never reached a terminal state and ASKS
 *                   the gateway what happened, because the client that would have
 *                   told us is gone.
 *
 * ── The invariant ────────────────────────────────────────────────────────────
 * An order is created from a paid intent EXACTLY ONCE, whichever of the three
 * paths gets there first. That is enforced at the database, not in code:
 * `payment_intents.orderId` and `orders.paymentRef` are both UNIQUE, so the
 * loser of any race gets P2002 and returns the winner's order.
 */
import crypto from 'crypto';
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { D, toMinorUnits } from '../utils/money.js';
import { fetchPayment, fetchOrderPayments, isMockPayments } from './payment.service.js';
import { releaseReservations } from './stockReservation.service.js';
import { recordEvent, SHOP_EVENTS } from './shopMetrics.service.js';

/** Intents older than this that never got paid are treated as abandoned. */
const INTENT_EXPIRY_MINUTES = 30;

/** Terminal states — the reconciler does not revisit these. */
const TERMINAL = new Set(['ORDER_CREATED', 'FAILED', 'CANCELLED', 'REFUNDED', 'EXPIRED']);

export function receiptFor(userId) {
  // Unique per intent. The old receipt was `cart_${userId}`, identical for every
  // payment that user ever made, so /confirm's `receipt === cart_${userId}` check
  // could not tell this payment from one made last week — it proved only that the
  // gateway order belonged to this user, never that it belonged to THIS checkout.
  return `cs_${userId.slice(0, 8)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Record an intent before the gateway call, so a crash after it is recoverable. */
export async function createIntent({ userId, providerOrderId, amount, receipt, quote }) {
  return prisma.paymentIntent.create({
    data: {
      userId,
      providerOrderId,
      amount: D(amount).toFixed(2),
      amountPaise: toMinorUnits(amount),
      receipt,
      status: 'CREATED',
      quoteSnapshot: quote ? {
        total: quote.total,
        subtotal: quote.subtotal,
        deliveryFee: quote.deliveryFee,
        taxAmount: quote.taxAmount,
        fingerprint: quote.fingerprint,
        pricedAt: quote.pricedAt,
        shipmentCount: quote.shipmentCount,
      } : undefined,
      cartHash: quote?.fingerprint || null,
    },
  });
}

export async function findIntent(providerOrderId) {
  return prisma.paymentIntent.findUnique({ where: { providerOrderId } });
}

/**
 * Mark an intent paid. Idempotent: safe to call from the client confirm AND from
 * a webhook for the same payment, in either order.
 */
export async function markIntentPaid({ providerOrderId, providerPaymentId, amountPaise }) {
  try {
    return await prisma.paymentIntent.update({
      where: { providerOrderId },
      data: {
        // Never regress a state that already produced an order.
        status: 'PAID',
        providerPaymentId,
        ...(amountPaise != null ? { amountPaise } : {}),
      },
    });
  } catch (err) {
    if (err?.code === 'P2025') return null; // no such intent
    // P2002 on providerPaymentId: this payment id is already recorded against a
    // different intent. Never overwrite — it means duplicate gateway data, and
    // silently reassigning it would detach a real payment from its real order.
    if (err?.code === 'P2002') {
      logger.warn({ providerOrderId, providerPaymentId }, '[ShopPayment] payment id already bound to another intent');
      return prisma.paymentIntent.findUnique({ where: { providerOrderId } });
    }
    throw err;
  }
}

export async function markIntentFailed({ providerOrderId, reason }) {
  try {
    return await prisma.paymentIntent.update({
      where: { providerOrderId },
      data: { status: 'FAILED', failureReason: String(reason || '').slice(0, 500) },
    });
  } catch { return null; }
}

/** Bind an intent to the order it produced. UNIQUE orderId makes this the gate. */
export async function attachOrderToIntent({ providerOrderId, orderId }) {
  try {
    return await prisma.paymentIntent.update({
      where: { providerOrderId },
      data: { status: 'ORDER_CREATED', orderId },
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      logger.warn({ providerOrderId, orderId }, '[ShopPayment] intent already bound to an order');
      return null;
    }
    if (err?.code === 'P2025') return null;
    throw err;
  }
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

/**
 * Claim a webhook event id. Returns false when it has been seen before.
 *
 * Razorpay retries a failed webhook for 24 hours, so this WILL receive the same
 * `payment.captured` many times. Without the claim, each redelivery would be a
 * second attempt at order creation. The unique index does the work; the insert
 * either succeeds (first delivery) or throws P2002 (a redelivery).
 */
export async function claimWebhookEvent({ eventId, eventType, providerOrderId, providerPaymentId, payloadDigest }) {
  try {
    await prisma.paymentWebhookEvent.create({
      data: { eventId, eventType, providerOrderId, providerPaymentId, payloadDigest },
    });
    return true;
  } catch (err) {
    if (err?.code === 'P2002') return false;
    throw err;
  }
}

export async function finishWebhookEvent(eventId, { status, error } = {}) {
  try {
    await prisma.paymentWebhookEvent.update({
      where: { eventId },
      data: { status, error: error ? String(error).slice(0, 500) : null, processedAt: new Date() },
    });
  } catch { /* the event row is telemetry; never fail the webhook over it */ }
}

/**
 * Derive a stable event id.
 *
 * Razorpay's webhook body has no guaranteed unique event id field across every
 * event type, so the id is (eventType, entity id) — which is exactly the
 * granularity idempotency needs: `payment.captured` for payment `pay_X` must be
 * processed once, no matter how many times it is delivered.
 */
export function webhookEventId(payload) {
  const type = payload?.event || 'unknown';
  const paymentId = payload?.payload?.payment?.entity?.id;
  const orderId = payload?.payload?.order?.entity?.id || payload?.payload?.payment?.entity?.order_id;
  const refundId = payload?.payload?.refund?.entity?.id;
  return `${type}:${refundId || paymentId || orderId || crypto.randomUUID()}`;
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/**
 * Sweep intents stuck outside a terminal state and settle them against the
 * gateway's own record.
 *
 * Four outcomes per intent:
 *   captured, order already exists   → bind and finish
 *   captured, NO order               → PAID + flagged for support: the farmer's
 *                                      money is with us and they have nothing.
 *                                      Deliberately NOT auto-ordered here — the
 *                                      cart is long gone and stock may have sold,
 *                                      so inventing an order would be worse than
 *                                      escalating a refund.
 *   failed                           → FAILED, with the gateway's reason
 *   no payment at all, past expiry   → EXPIRED (abandoned checkout)
 *
 * @returns {Promise<{scanned:number, paid:number, failed:number, expired:number, orphanedPaid:number}>}
 */
export async function reconcilePendingPayments({ olderThanMinutes = 10, limit = 200 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const expiryCutoff = new Date(Date.now() - INTENT_EXPIRY_MINUTES * 60_000);

  const stale = await prisma.paymentIntent.findMany({
    where: { status: { in: ['CREATED', 'PENDING', 'PAID'] }, createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const stats = { scanned: stale.length, paid: 0, failed: 0, expired: 0, orphanedPaid: 0 };
  if (!stale.length || isMockPayments()) return stats;

  for (const intent of stale) {
    try {
      // Ask the gateway. This is the whole point — the client is gone.
      const payments = intent.providerPaymentId
        ? [await fetchPayment(intent.providerPaymentId)].filter(Boolean)
        : await fetchOrderPayments(intent.providerOrderId);

      const captured = payments.find((p) => p?.status === 'captured' || p?.status === 'authorized');

      if (captured) {
        const existingOrder = await prisma.order.findUnique({
          where: { paymentRef: captured.id },
          select: { id: true },
        });

        if (existingOrder) {
          await prisma.paymentIntent.update({
            where: { id: intent.id },
            data: {
              status: 'ORDER_CREATED',
              providerPaymentId: captured.id,
              orderId: existingOrder.id,
              reconciledAt: new Date(),
              reconcileNote: 'order already existed',
            },
          }).catch(() => {});
          stats.paid += 1;
        } else {
          await prisma.paymentIntent.update({
            where: { id: intent.id },
            data: {
              status: 'PAID',
              providerPaymentId: captured.id,
              reconciledAt: new Date(),
              reconcileNote: 'PAID WITH NO ORDER — needs manual refund or fulfilment',
            },
          }).catch(() => {});
          stats.orphanedPaid += 1;
          recordEvent(SHOP_EVENTS.PAYMENT_CAPTURED_NO_ORDER);
          // The payment landed but no order exists, so nothing will ever consume
          // the hold. Release it — the buyer is owed a refund, not the rest of
          // the marketplace an out-of-stock listing.
          await releaseReservations(intent.providerOrderId, 'captured payment with no order').catch(() => {});
          // Loud on purpose: this is money held against nothing.
          logger.error({
            intentId: intent.id,
            providerOrderId: intent.providerOrderId,
            providerPaymentId: captured.id,
            amount: String(intent.amount),
          }, '[ShopPayment] RECONCILE: captured payment with no order');
        }
        continue;
      }

      const failedPayment = payments.find((p) => p?.status === 'failed');
      if (failedPayment) {
        await prisma.paymentIntent.update({
          where: { id: intent.id },
          data: {
            status: 'FAILED',
            providerPaymentId: failedPayment.id,
            failureReason: String(failedPayment.error_description || 'payment failed').slice(0, 500),
            reconciledAt: new Date(),
          },
        }).catch(() => {});
        stats.failed += 1;
        await releaseReservations(intent.providerOrderId, 'payment failed (reconciled)').catch(() => {});
        continue;
      }

      if (intent.createdAt < expiryCutoff) {
        await prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'EXPIRED', reconciledAt: new Date(), reconcileNote: 'no payment attempt within window' },
        }).catch(() => {});
        stats.expired += 1;
        // An abandoned payment sheet produces no signal at all — no webhook, no
        // client call. This is the only thing that puts those units back.
        await releaseReservations(intent.providerOrderId, 'payment abandoned (reconciled)').catch(() => {});
      }
    } catch (err) {
      logger.warn({ err, intentId: intent.id }, '[ShopPayment] reconcile failed for intent');
    }
  }

  return stats;
}

/**
 * What the app should show while a payment's fate is unknown.
 *
 * "Payment is being confirmed" is a distinct state from "payment failed", and
 * showing the second when the first is true is how a farmer pays twice.
 */
export function intentPublicStatus(intent) {
  if (!intent) return { state: 'UNKNOWN' };
  if (TERMINAL.has(intent.status)) {
    return {
      state: intent.status,
      orderId: intent.orderId || null,
      reason: intent.failureReason || null,
    };
  }
  return {
    state: intent.status === 'PAID' ? 'CONFIRMING' : 'PENDING',
    orderId: intent.orderId || null,
    message: intent.status === 'PAID'
      ? 'Your payment has gone through and we are creating your order. Do not pay again.'
      : 'We are still confirming your payment. Do not pay again — check My Orders in a few minutes.',
  };
}
