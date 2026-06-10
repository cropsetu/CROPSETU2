/**
 * Velocity-limit middleware (FRAUD-1) — the enforcement + flagging layer over the
 * velocity risk engine (services/velocity.service.js).
 *
 * `velocityGuard(action)` records the action against its per-user/device/IP
 * velocity counters and then:
 *   • LIMIT tier → responds 429 (Retry-After) AND flags the event.
 *   • FLAG tier  → flags the event but lets the request through (req.velocity is
 *                  set so downstream handlers can factor it into risk decisions).
 *   • otherwise  → passes through untouched.
 *
 * Flagging means an audit-log row for every flag/block, plus — on the block tier
 * only — a security incident routed for review, deduped to at most one per
 * (action, dimension, identity) per window so a sustained flood can't spam the
 * incident table.
 *
 * Master-gated by ENV.VELOCITY_ENABLED and fully fail-open: any error in the
 * scoring or flagging path degrades to "allow", because a fraud-scoring glitch
 * must never break checkout or login.
 */
import { ENV } from '../config/env.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { sendError } from '../utils/response.js';
import { auditLog, AUDIT_ACTIONS } from '../services/audit.service.js';
import { reportSecurityEvent } from '../services/incident.service.js';
import { recordVelocity, identitiesFromRequest } from '../services/velocity.service.js';

/**
 * Reserve the single incident slot for (action, worstDim, identity) within the
 * window. Returns true at most once per window so we don't open an incident per
 * blocked attempt. Uses Redis SET NX EX; when Redis is unavailable we skip the
 * incident entirely (the audit-log row still records every block) rather than
 * risk flooding the incident table without a shared dedupe store.
 */
async function reserveIncidentSlot(action, result) {
  if (redis?.status !== 'ready') return false;
  const dim = result.worstDim || 'any';
  const key = `vel:inc:${action}:${dim}`;
  try {
    const r = await redis.set(key, '1', 'EX', Math.max(60, result.windowSec), 'NX');
    return r === 'OK';
  } catch (err) {
    logger.warn('[Velocity] incident dedupe failed: %s', err.message);
    return false;
  }
}

/**
 * Record the flag/block side effects for a velocity decision. Best-effort and
 * never throws — auditing/incident logging must not break the guarded request.
 *
 * @param {import('express').Request} req
 * @param {string} action
 * @param {object} result   — decision from recordVelocity()
 * @param {object} [opts]
 * @param {string} [opts.actorId] — explicit actor when req.user isn't set yet
 *                                  (e.g. the login flow, before authenticate()).
 */
export async function flagVelocity(req, action, result, { actorId } = {}) {
  try {
    const userId = actorId || req?.user?.id || 'anonymous';
    const metadata = {
      action,
      decision: result.decision,
      signals: result.signals,
      counts: result.counts,
      worstDim: result.worstDim,
      worstCount: result.worstCount,
      flagThreshold: result.flagThreshold,
      limitThreshold: result.limitThreshold,
      windowSec: result.windowSec,
    };

    // Audit every flag/block — lightweight and safe at high volume.
    await auditLog({
      userId,
      action: result.limited ? AUDIT_ACTIONS.FRAUD_VELOCITY_BLOCK : AUDIT_ACTIONS.FRAUD_VELOCITY_FLAG,
      entity: 'Velocity',
      entityId: action,
      ip: req?.ip || null,
      requestId: req?.id || null,
      metadata,
    });

    // Raise an incident only when an action was actually BLOCKED (the strong
    // signal), deduped per window. Classified under the FRAUD category (shared by
    // the FRAUD-* detectors); FRAUD is NOT a breach-notification category, so it
    // won't spuriously trip the DPDP notify duty. MEDIUM severity for the same reason.
    if (result.limited && (await reserveIncidentSlot(action, result))) {
      await reportSecurityEvent({
        title: `High-velocity ${action} activity blocked`,
        description:
          `Velocity limit exceeded for "${action}": ${result.worstDim} count ` +
          `${result.worstCount} ≥ limit ${result.limitThreshold} within ${result.windowSec}s. ` +
          `The action was blocked and routed for review.`,
        category: 'FRAUD',
        severity: 'MEDIUM',
        affectedUserIds: userId && userId !== 'anonymous' ? [userId] : [],
        metadata: { action, ip: req?.ip || null, signals: result.signals, counts: result.counts },
      });
    }
  } catch (err) {
    logger.warn('[Velocity] flag side effects failed: %s', err.message);
  }
}

/**
 * Express middleware: enforce velocity limits for `action` (one of
 * VELOCITY_ACTIONS). Mount AFTER `authenticate` so req.user is available as the
 * user dimension.
 */
export function velocityGuard(action) {
  return async (req, res, next) => {
    if (!ENV.VELOCITY_ENABLED) return next();

    let result;
    try {
      result = await recordVelocity({ action, identities: identitiesFromRequest(req) });
    } catch (err) {
      // recordVelocity is already fail-open, but never let the guard 500 a request.
      logger.warn('[Velocity] guard "%s" failed open: %s', action, err.message);
      return next();
    }

    // Expose the decision so downstream handlers can fold it into their own risk
    // logic (e.g. require step-up, mark an order for manual review).
    req.velocity = result;

    if (result.flagged || result.limited) {
      // Fire-and-forget: flagging must not add latency to the request path.
      flagVelocity(req, action, result).catch(() => {});
    }

    if (result.limited) {
      const retryAfter = Math.max(1, result.retryAfterSec);
      res.setHeader('Retry-After', retryAfter);
      res.setHeader('RateLimit-Limit', result.limitThreshold);
      return sendError(
        res,
        'This action is temporarily blocked due to unusually high activity. Please try again later or contact support.',
        429,
        { retryAfter },
      );
    }

    return next();
  };
}
