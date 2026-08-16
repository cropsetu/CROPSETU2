/**
 * Payment webhooks — the gateway's side of the conversation.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The only thing that used to tell this system a payment had succeeded was the
 * mobile app, calling /orders/confirm. On a village connection the app very
 * often cannot: the connection drops between the payment sheet closing and the
 * confirm request, the OS kills the process, or the farmer switches away. The
 * money is captured, and nobody here hears about it.
 *
 * A webhook is the channel that does not depend on the buyer's phone still being
 * alive. Razorpay retries it for 24 hours.
 *
 * ── The three rules a webhook endpoint has to obey ───────────────────────────
 * 1. VERIFY THE SIGNATURE, over the RAW BYTES. Re-serialising parsed JSON does
 *    not reproduce what was signed, so this router is mounted with express.raw
 *    ahead of the global JSON parser (see app.js).
 * 2. FAIL CLOSED. No webhook secret configured → reject everything. This endpoint
 *    can mark money as received with no authenticated user behind it.
 * 3. BE IDEMPOTENT. Redelivery is normal, not exceptional. Every event id is
 *    claimed through a UNIQUE index before any work happens, so the second
 *    delivery of `payment.captured` is a no-op instead of a second order.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────
 * It does not create orders. By the time a webhook arrives the buyer's cart may
 * have changed, stock may have sold to someone else, and there is no delivery
 * address in the payload. Fabricating an order from a payment would produce a
 * shipment nobody chose. It records the payment against its intent; the client's
 * confirm creates the order, and reconciliation escalates anything left paid
 * with no order for a human to refund.
 */
import { Router } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { verifyWebhookSignature } from '../services/payment.service.js';
import {
  claimWebhookEvent, finishWebhookEvent, webhookEventId,
  markIntentPaid, markIntentFailed, findIntent,
} from '../services/shopPayment.service.js';
import prisma from '../config/db.js';
import { rateLimiter, clientIp } from '../middleware/rateLimit.js';
import { releaseReservations } from '../services/stockReservation.service.js';
import { recordEvent, SHOP_EVENTS } from '../services/shopMetrics.service.js';

const router = Router();

/**
 * This router is mounted ahead of the global per-IP limiter (it has to be, to get
 * the raw body), so it carries its own. Generous — a burst of legitimate
 * redeliveries after an outage is normal — but not unbounded, because signature
 * verification is an HMAC per request and this endpoint is unauthenticated.
 */
router.use(rateLimiter({
  windowMs: 60_000,
  max: 300,
  prefix: 'webhook:razorpay',
  key: clientIp,
  message: 'Too many webhook deliveries.',
}));

/**
 * Razorpay expects a 2xx quickly, and retries anything else. Handled events and
 * ignored events both return 200: an event type we do not act on is not an
 * error, and telling the gateway to retry it forever would be.
 */
router.post('/razorpay', async (req, res) => {
  const signature = req.get('X-Razorpay-Signature');
  const raw = req.body; // Buffer — express.raw, mounted before the JSON parser

  if (!verifyWebhookSignature(raw, signature)) {
    // Deliberately terse. An attacker probing this endpoint learns nothing about
    // whether a secret is configured or how the comparison failed.
    logger.warn({ ip: req.ip }, '[Webhook] rejected: bad or missing signature');
    recordEvent(SHOP_EVENTS.WEBHOOK_BAD_SIGNATURE);
    return res.status(400).json({ success: false });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  } catch {
    return res.status(400).json({ success: false });
  }

  const eventType = payload?.event || 'unknown';
  const paymentEntity = payload?.payload?.payment?.entity;
  const providerPaymentId = paymentEntity?.id || null;
  const providerOrderId = paymentEntity?.order_id || payload?.payload?.order?.entity?.id || null;
  const eventId = webhookEventId(payload);
  const payloadDigest = crypto.createHash('sha256').update(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))).digest('hex');

  // Claim first, work second. A redelivery loses the claim and returns 200
  // immediately, having changed nothing.
  let claimed;
  try {
    claimed = await claimWebhookEvent({ eventId, eventType, providerOrderId, providerPaymentId, payloadDigest });
  } catch (err) {
    logger.error({ err, eventId }, '[Webhook] could not claim event');
    // 500 so Razorpay retries — losing the event entirely is worse than a retry.
    return res.status(500).json({ success: false });
  }
  if (!claimed) {
    res.setHeader('X-Webhook-Replay', 'true');
    recordEvent(SHOP_EVENTS.WEBHOOK_DUPLICATE);
    return res.status(200).json({ success: true, duplicate: true });
  }

  try {
    switch (eventType) {
      case 'payment.captured':
      case 'order.paid': {
        if (!providerOrderId) { await finishWebhookEvent(eventId, { status: 'IGNORED' }); break; }

        const intent = await findIntent(providerOrderId);
        if (!intent) {
          // A capture with no local intent means /initiate never recorded one —
          // a real hole worth an alert, not a silent 200.
          logger.error({ providerOrderId, providerPaymentId }, '[Webhook] captured payment has no local intent');
          await finishWebhookEvent(eventId, { status: 'FAILED', error: 'no matching payment intent' });
          break;
        }

        await markIntentPaid({
          providerOrderId,
          providerPaymentId,
          amountPaise: paymentEntity?.amount ?? undefined,
        });

        // If the client's confirm already won the race, bind the two together so
        // reconciliation does not later flag a paid intent with no order.
        if (providerPaymentId && !intent.orderId) {
          const order = await prisma.order.findUnique({ where: { paymentRef: providerPaymentId }, select: { id: true } });
          if (order) {
            await prisma.paymentIntent.update({
              where: { providerOrderId },
              data: { status: 'ORDER_CREATED', orderId: order.id },
            }).catch(() => {});
          }
        }

        await finishWebhookEvent(eventId, { status: 'PROCESSED' });
        break;
      }

      case 'payment.failed': {
        if (providerOrderId) {
          await markIntentFailed({
            providerOrderId,
            reason: paymentEntity?.error_description || paymentEntity?.error_reason || 'payment failed',
          });
          // The payment is not coming, so the units this buyer was holding go
          // back on the shelf NOW rather than sitting out the TTL. On a
          // nearly-sold-out product that is the difference between the next
          // farmer being able to buy it and being told it is gone.
          await releaseReservations(providerOrderId, 'payment failed').catch(() => {});
        }
        await finishWebhookEvent(eventId, { status: 'PROCESSED' });
        recordEvent(SHOP_EVENTS.WEBHOOK_OK);
        break;
      }

      case 'refund.created':
      case 'refund.processed': {
        const refund = payload?.payload?.refund?.entity;
        const refPaymentId = refund?.payment_id;
        if (refPaymentId) {
          const status = eventType === 'refund.processed' ? 'REFUNDED' : 'REFUND_INITIATED';
          await prisma.paymentIntent.updateMany({
            where: { providerPaymentId: refPaymentId },
            data: { status },
          }).catch(() => {});
          // Keep the order's own payment state honest — a refunded order that
          // still reads "paid" is what turns a refund into a support ticket.
          await prisma.order.updateMany({
            where: { paymentRef: refPaymentId },
            data: { paymentStatus: eventType === 'refund.processed' ? 'refunded' : 'refund_initiated' },
          }).catch(() => {});
        }
        await finishWebhookEvent(eventId, { status: 'PROCESSED' });
        break;
      }

      default:
        await finishWebhookEvent(eventId, { status: 'IGNORED' });
        break;
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err, eventId, eventType }, '[Webhook] handler failed');
    recordEvent(SHOP_EVENTS.WEBHOOK_FAIL);
    await finishWebhookEvent(eventId, { status: 'FAILED', error: err.message });
    // 500 → Razorpay retries. The event row is already claimed, so the retry
    // short-circuits as a duplicate; recovery is the reconciler's job, which
    // reads the gateway directly rather than waiting for another delivery.
    return res.status(500).json({ success: false });
  }
});

export default router;
