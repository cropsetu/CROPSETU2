/**
 * Payment-amount tamper alarms (FRAUD-6).
 *
 * The checkout-confirm flow already VERIFIES and BLOCKS amount mismatches (PAY-3):
 * the paid/authorized amount is bound to the server-recomputed cart total, the
 * payment must belong to this user, and an optional client-sent total must agree.
 * Each mismatch aborts the transaction so no order is created.
 *
 * This module adds the missing half — the ALARM — so a blocked tamper attempt
 * does not go unnoticed: an audit row for every mismatch plus a deduped FRAUD
 * security incident routed to ops. It records the actor and the expected vs
 * actual amounts (in integer paise) without ever exposing them to the client.
 *
 * MUST be invoked OUTSIDE the confirm transaction (from the route's catch, after
 * the rollback), so these writes persist even though the order creation was
 * rolled back. Best-effort and NEVER throws — alarming must not change the
 * response the buyer already gets (the blocking 400).
 */
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { auditLog, AUDIT_ACTIONS } from './audit.service.js';
import { reportSecurityEvent } from './incident.service.js';

const INCIDENT_DEDUPE_TTL_SEC = 60 * 60; // one payment-tamper incident per user/hour

// Human-readable + severity per mismatch kind. A paid/owner mismatch is a real
// manipulation attempt (MEDIUM); a client display-total mismatch is more often
// benign price/stock drift, so it only audits at LOW.
const KINDS = {
  paid_amount_mismatch:  { label: 'paid amount differs from order amount', severity: 'MEDIUM' },
  receipt_mismatch:      { label: 'payment belongs to a different cart/user', severity: 'MEDIUM' },
  client_total_mismatch: { label: 'client-sent total differs from server total', severity: 'LOW' },
};

async function reserveIncidentSlot(userId) {
  if (redis?.status !== 'ready') return false;
  try {
    const r = await redis.set(`fraud:paytamper:inc:${userId}`, '1', 'EX', INCIDENT_DEDUPE_TTL_SEC, 'NX');
    return r === 'OK';
  } catch { return false; }
}

/**
 * Raise the tamper alarm for a blocked confirmation. Never throws.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {'paid_amount_mismatch'|'receipt_mismatch'|'client_total_mismatch'} p.kind
 * @param {?number} [p.expectedPaise]  authoritative server amount (paise)
 * @param {?number} [p.actualPaise]    confirmed/paid/client amount (paise)
 * @param {?string} [p.orderRef]       gateway order id (razorpayOrderId)
 * @param {?string} [p.paymentRef]     gateway payment id (razorpayPaymentId)
 * @param {?string} [p.ip]
 * @param {?string} [p.requestId]
 */
export async function raisePaymentTamperAlarm({
  userId, kind, expectedPaise = null, actualPaise = null,
  orderRef = null, paymentRef = null, ip = null, requestId = null,
}) {
  const info = KINDS[kind] || { label: 'payment amount mismatch', severity: 'MEDIUM' };
  const metadata = { kind, expectedPaise, actualPaise, orderRef, paymentRef };

  try {
    await auditLog({
      userId: userId || 'anonymous',
      action: AUDIT_ACTIONS.FRAUD_PAYMENT_TAMPER,
      entity: 'Order',
      entityId: orderRef || paymentRef || 'unknown',
      ip,
      requestId,
      metadata,
    });
  } catch (err) {
    logger.warn('[PaymentTamper] audit failed: %s', err.message);
  }

  try {
    if (await reserveIncidentSlot(userId)) {
      await reportSecurityEvent({
        title: 'Payment-amount tamper detected',
        description:
          `Checkout confirmation blocked — ${info.label}` +
          (expectedPaise != null && actualPaise != null
            ? ` (expected ₹${(expectedPaise / 100).toFixed(2)}, got ₹${(actualPaise / 100).toFixed(2)}).`
            : '.') +
          ' No order was created.',
        category: 'FRAUD',
        severity: info.severity,
        affectedUserIds: userId ? [userId] : [],
        metadata: { ...metadata, ip },
      });
    }
  } catch (err) {
    logger.warn('[PaymentTamper] incident failed: %s', err.message);
  }
}
