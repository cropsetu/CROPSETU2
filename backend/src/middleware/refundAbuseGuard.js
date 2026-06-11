/**
 * Refund / chargeback abuse guard (FRAUD-2 / COMP-5) — enforcement + flagging
 * over the refund-abuse risk engine (services/refundAbuse.service.js).
 *
 * Mount AFTER `authenticate` on refund/cancellation routes. On each attempt it
 * assesses the account's refund history and:
 *   • RESTRICT tier → responds 403 AND flags the account (audit + a deduped
 *                     security incident routed for review).
 *   • FLAG tier     → records a fraud signal (audit) but lets the request through
 *                     (req.refundAbuse is set so the handler can factor it in).
 *   • otherwise     → passes through untouched.
 *
 * Master-gated by ENV.REFUND_ABUSE_ENABLED and fully fail-open: any error in the
 * scoring or flagging path degrades to "allow", because a fraud-scoring glitch
 * must never block a legitimate cancellation.
 */
import { ENV } from '../config/env.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { sendError } from '../utils/response.js';
import { auditLog, AUDIT_ACTIONS } from '../services/audit.service.js';
import { reportSecurityEvent } from '../services/incident.service.js';
import { assessRefundAbuse } from '../services/refundAbuse.service.js';

// One incident per user per day, even if they keep hammering a restricted route.
const INCIDENT_DEDUPE_TTL_SEC = 24 * 60 * 60;

/**
 * Reserve the single incident slot for this user within the dedupe window.
 * Returns true at most once per window. Uses Redis SET NX EX; when Redis is
 * unavailable we skip the incident (the audit row still records the restriction)
 * rather than risk flooding the incident table without a shared dedupe store.
 */
async function reserveIncidentSlot(userId) {
  if (redis?.status !== 'ready') return false;
  try {
    const r = await redis.set(`fraud:refundabuse:inc:${userId}`, '1', 'EX', INCIDENT_DEDUPE_TTL_SEC, 'NX');
    return r === 'OK';
  } catch (err) {
    logger.warn('[RefundAbuse] incident dedupe failed: %s', err.message);
    return false;
  }
}

/**
 * Record the flag/restrict side effects for a refund-abuse decision. Best-effort;
 * never throws — auditing/incident logging must not break the guarded request.
 */
export async function flagRefundAbuse(req, assessment) {
  try {
    const userId = req?.user?.id || 'anonymous';
    const metadata = {
      decision: assessment.decision,
      orders: assessment.orders,
      refunds: assessment.refunds,
      rate: assessment.rate,
      lookbackDays: assessment.lookbackDays,
      flagCount: assessment.flagCount,
      flagRate: assessment.flagRate,
      restrictCount: assessment.restrictCount,
      restrictRate: assessment.restrictRate,
    };

    await auditLog({
      userId,
      action: assessment.restricted ? AUDIT_ACTIONS.FRAUD_REFUND_ABUSE_RESTRICT : AUDIT_ACTIONS.FRAUD_REFUND_ABUSE_FLAG,
      entity: 'User',
      entityId: userId,
      ip: req?.ip || null,
      requestId: req?.id || null,
      metadata,
    });

    // Raise an incident only when an account is RESTRICTED (the strong signal),
    // deduped per user per day so repeated blocked attempts don't spam the queue.
    if (assessment.restricted && (await reserveIncidentSlot(userId))) {
      await reportSecurityEvent({
        title: 'Refund/chargeback abuse — account restricted',
        description:
          `Account exceeded the refund-abuse threshold: ${assessment.refunds} of ` +
          `${assessment.orders} orders (${Math.round(assessment.rate * 100)}%) reversed within ` +
          `${assessment.lookbackDays} days. New refunds/cancellations are blocked; routed for review.`,
        category: 'FRAUD',
        severity: 'MEDIUM',
        affectedUserIds: userId !== 'anonymous' ? [userId] : [],
        metadata,
      });
    }
  } catch (err) {
    logger.warn('[RefundAbuse] flag side effects failed: %s', err.message);
  }
}

/**
 * Express middleware: flag/restrict refund-abusing accounts on refund/cancel
 * routes. Mount AFTER `authenticate`.
 */
export function refundAbuseGuard() {
  return async (req, res, next) => {
    if (!ENV.REFUND_ABUSE_ENABLED) return next();
    const userId = req.user?.id;
    if (!userId) return next(); // nothing to assess (route should be authenticated anyway)

    let assessment;
    try {
      assessment = await assessRefundAbuse(userId);
    } catch (err) {
      logger.warn('[RefundAbuse] guard failed open: %s', err.message);
      return next();
    }

    // Expose for the handler (e.g. to attach a "needs review" note to the order).
    req.refundAbuse = assessment;

    if (assessment.flagged || assessment.restricted) {
      flagRefundAbuse(req, assessment).catch(() => {}); // fire-and-forget
    }

    if (assessment.restricted) {
      return sendError(
        res,
        'Your account is temporarily restricted from refunds and cancellations due to repeated refund activity. Please contact support.',
        403,
        { reason: 'refund_abuse' },
      );
    }

    return next();
  };
}
