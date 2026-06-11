/**
 * Fake-review / fake-listing signals (FRAUD-5).
 *
 * Heuristics over new reviews and product listings, scored and — at/above the
 * flag threshold — routed to the moderation queue (REV-5) for human review.
 * Suspicious content is NEVER auto-removed here (that's the moderator's call);
 * this only surfaces it. Signals (overlaps REV-6):
 *
 *   • burst       — the author created many reviews/listings in a short window
 *                   (review bombing / listing spam).
 *   • duplicate   — the same normalized text re-posted across the author's items
 *                   (copy-paste review templates, cloned listings).
 *   • new_account — the author's account is only days old (fresh throwaway).
 *
 * Weighted score: burst/duplicate = 2, new_account = 1, so a lone new account
 * never flags on its own (too common for legitimate first-time users) — it only
 * amplifies a real signal. Every entry point is best-effort and NEVER throws —
 * fraud scoring must not break posting a review or creating a listing.
 */
import prisma from '../config/db.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';
import { auditLog, AUDIT_ACTIONS } from './audit.service.js';
import { enqueueFlag } from './moderation.service.js';

const WEIGHTS = { burst: 2, duplicate: 2, new_account: 1 };
const HISTORY_LIMIT = 100;

/** Normalize free text for duplicate detection: lowercase, collapse whitespace. */
export function normalizeText(s) {
  if (!s || typeof s !== 'string') return '';
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Sum the weighted score for a set of reasons. Pure. */
export function scoreReasons(reasons) {
  return reasons.reduce((sum, r) => sum + (WEIGHTS[r] || 0), 0);
}

function decide(reasons) {
  const score = scoreReasons(reasons);
  return { flagged: score >= ENV.CONTENT_FRAUD.flagScore, score, reasons };
}

function isNewAccount(createdAt) {
  if (!createdAt) return false;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs < ENV.CONTENT_FRAUD.newAccountDays * 24 * 60 * 60 * 1000;
}

/**
 * Assess a freshly-created review. Never throws (returns not-flagged on error).
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.reviewId   — the just-created review (excluded from duplicate self-match)
 * @param {?string} p.comment
 * @returns {Promise<{flagged:boolean, score:number, reasons:string[]}>}
 */
export async function assessReview({ userId, reviewId, comment }) {
  try {
    const cfg = ENV.CONTENT_FRAUD;
    const burstSince = Date.now() - cfg.burstWindowMin * 60 * 1000;
    const [author, recent] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
      prisma.review.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT,
        select: { id: true, comment: true, createdAt: true },
      }),
    ]);

    const reasons = [];
    if (recent.filter((r) => new Date(r.createdAt).getTime() >= burstSince).length >= cfg.reviewBurstCount) {
      reasons.push('burst');
    }
    const norm = normalizeText(comment);
    if (norm && recent.some((r) => r.id !== reviewId && normalizeText(r.comment) === norm)) {
      reasons.push('duplicate');
    }
    if (isNewAccount(author?.createdAt)) reasons.push('new_account');

    return decide(reasons);
  } catch (err) {
    logger.warn('[ContentFraud] review assessment failed: %s', err.message);
    return { flagged: false, score: 0, reasons: [] };
  }
}

/**
 * Assess a freshly-created listing. Never throws.
 * @param {object} p
 * @param {string} p.sellerId
 * @param {string} p.productId
 * @param {?string} p.name
 * @param {?string} p.description
 * @returns {Promise<{flagged:boolean, score:number, reasons:string[]}>}
 */
export async function assessListing({ sellerId, productId, name }) {
  try {
    const cfg = ENV.CONTENT_FRAUD;
    const burstSince = Date.now() - cfg.burstWindowMin * 60 * 1000;
    const [seller, recent] = await Promise.all([
      prisma.user.findUnique({ where: { id: sellerId }, select: { createdAt: true } }),
      prisma.product.findMany({
        where: { sellerId }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT,
        select: { id: true, name: true, createdAt: true },
      }),
    ]);

    const reasons = [];
    if (recent.filter((p) => new Date(p.createdAt).getTime() >= burstSince).length >= cfg.listingBurstCount) {
      reasons.push('burst');
    }
    const norm = normalizeText(name);
    if (norm && recent.some((p) => p.id !== productId && normalizeText(p.name) === norm)) {
      reasons.push('duplicate');
    }
    if (isNewAccount(seller?.createdAt)) reasons.push('new_account');

    return decide(reasons);
  } catch (err) {
    logger.warn('[ContentFraud] listing assessment failed: %s', err.message);
    return { flagged: false, score: 0, reasons: [] };
  }
}

/** Audit + route a flagged item to the moderation queue. Best-effort. */
async function routeToModeration({ entityType, entityId, authorId, decision }) {
  await enqueueFlag({
    entityType, entityId, authorId,
    reasons: decision.reasons, score: decision.score,
    metadata: { reasons: decision.reasons, score: decision.score },
  });
  auditLog({
    userId: authorId || 'system',
    action: AUDIT_ACTIONS.FRAUD_CONTENT_FLAG,
    entity: entityType,
    entityId,
    metadata: { reasons: decision.reasons, score: decision.score },
  }).catch(() => {});
}

/** Assess a new review and route it to moderation if suspicious. Never throws. */
export async function flagReviewIfSuspicious({ reviewId, userId, comment }) {
  try {
    const decision = await assessReview({ userId, reviewId, comment });
    if (decision.flagged) {
      await routeToModeration({ entityType: 'Review', entityId: reviewId, authorId: userId, decision });
    }
    return decision;
  } catch (err) {
    logger.warn('[ContentFraud] flagReview failed: %s', err.message);
    return { flagged: false, score: 0, reasons: [] };
  }
}

/** Assess a new listing and route it to moderation if suspicious. Never throws. */
export async function flagListingIfSuspicious({ productId, sellerId, name }) {
  try {
    const decision = await assessListing({ sellerId, productId, name });
    if (decision.flagged) {
      await routeToModeration({ entityType: 'Product', entityId: productId, authorId: sellerId, decision });
    }
    return decision;
  } catch (err) {
    logger.warn('[ContentFraud] flagListing failed: %s', err.message);
    return { flagged: false, score: 0, reasons: [] };
  }
}
