/**
 * Refund / chargeback abuse detection (FRAUD-2 / COMP-5).
 *
 * Where the velocity layer (FRAUD-1) catches a *burst* — too many cancellations
 * in a short window, blocked temporarily per action — this catches the *serial*
 * abuser: an account whose refund/cancellation RATE over its ORDER HISTORY is
 * abnormally high. It reads the user's order history from the DB (the ticket's
 * "needs payment history"), computes refunds ÷ orders over a lookback window, and
 * returns a tiered decision used to flag and, for repeat offenders, RESTRICT the
 * account from new refunds/cancellations.
 *
 * Two guards against false positives:
 *   • a MINIMUM refund count per tier, so a tiny sample (1 order, 1 cancel = 100%)
 *     never trips a flag;
 *   • a bounded lookback window, so old behaviour ages out — a restriction lifts
 *     itself once the user's recent history is clean again (no manual unflag).
 *
 * "Refunds" today = orders in a terminal reversal state (CANCELLED / REFUNDED) —
 * the only refund signal the schema models. When the real Razorpay refund flow
 * and chargeback webhooks land (COMP-6 / PAY-*), they set the same states (or a
 * `refunded` paymentStatus) and feed this assessment unchanged.
 *
 * Pure read; NEVER throws — a refund-abuse scoring failure must not break a
 * legitimate cancellation, so it fails OPEN (assessed as not-abusive).
 */
import prisma from '../config/db.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';

// Order states that count as a refund/cancellation in a user's history.
export const REFUND_STATUSES = ['CANCELLED', 'REFUNDED'];

function okDecision(rule, extra = {}) {
  return {
    decision: 'ok', flagged: false, restricted: false,
    orders: 0, refunds: 0, rate: 0,
    lookbackDays: rule.lookbackDays,
    flagCount: rule.flagCount, flagRate: rule.flagRate,
    restrictCount: rule.restrictCount, restrictRate: rule.restrictRate,
    ...extra,
  };
}

/**
 * Assess refund/chargeback abuse for a user from their order history.
 *
 * @param {string} userId
 * @returns {Promise<{decision:'ok'|'flag'|'restrict', flagged:boolean, restricted:boolean,
 *   orders:number, refunds:number, rate:number, lookbackDays:number,
 *   flagCount:number, flagRate:number, restrictCount:number, restrictRate:number}>}
 */
export async function assessRefundAbuse(userId) {
  const rule = ENV.REFUND_ABUSE;
  if (!userId) return okDecision(rule);

  try {
    const since = new Date(Date.now() - rule.lookbackDays * 24 * 60 * 60 * 1000);
    const baseWhere = { userId, createdAt: { gte: since } };

    // Two indexed COUNTs (rides @@index([userId, status]) / @@index([userId, createdAt])).
    const [orders, refunds] = await Promise.all([
      prisma.order.count({ where: baseWhere }),
      prisma.order.count({ where: { ...baseWhere, status: { in: REFUND_STATUSES } } }),
    ]);

    // refunds ⊆ orders, so rate ∈ [0, 1]. orders === 0 ⇒ no refunds either ⇒ 0.
    const rate = orders > 0 ? refunds / orders : 0;

    // Each tier needs BOTH a high enough rate AND a minimum number of refunds.
    const flagged    = refunds >= rule.flagCount     && rate >= rule.flagRate;
    const restricted = refunds >= rule.restrictCount && rate >= rule.restrictRate;

    return {
      decision: restricted ? 'restrict' : flagged ? 'flag' : 'ok',
      flagged,
      restricted,
      orders,
      refunds,
      rate: Math.round(rate * 1000) / 1000, // 3 dp, stable for logs/metadata
      lookbackDays: rule.lookbackDays,
      flagCount: rule.flagCount,
      flagRate: rule.flagRate,
      restrictCount: rule.restrictCount,
      restrictRate: rule.restrictRate,
    };
  } catch (err) {
    logger.warn('[RefundAbuse] assessment failed, treating as non-abusive: %s', err.message);
    return okDecision(rule);
  }
}
