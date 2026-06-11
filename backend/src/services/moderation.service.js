/**
 * Moderation queue (FRAUD-5 → REV-5).
 *
 * The durable queue that suspicious content (flagged by contentFraud.service)
 * is routed to for human review. Content is NOT auto-removed — a moderator
 * approves (clears) or rejects (removes) each item. One flag row per content
 * item; re-assessment refreshes its reasons/score without reopening an already-
 * resolved item.
 *
 * enqueueFlag is best-effort and never throws (flagging must not break the
 * create it piggybacks on). The admin read/resolve helpers surface errors to the
 * route, which maps them to a 500.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';

export const MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

/**
 * Route a content item into the moderation queue (or refresh an existing flag).
 * Idempotent per (entityType, entityId). Never throws.
 *
 * @param {object} p
 * @param {'Review'|'Product'} p.entityType
 * @param {string} p.entityId
 * @param {?string} [p.authorId]
 * @param {string[]} p.reasons
 * @param {number} p.score
 * @param {object} [p.metadata]
 * @returns {Promise<boolean>} whether the flag was persisted
 */
export async function enqueueFlag({ entityType, entityId, authorId = null, reasons, score, metadata = null }) {
  try {
    await prisma.contentFlag.upsert({
      where:  { entityType_entityId: { entityType, entityId } },
      create: { entityType, entityId, authorId, reasons, score, metadata: metadata ? JSON.stringify(metadata) : null },
      // Refresh the signal on re-assessment; leave `status` alone so a resolved
      // item isn't silently reopened by a later identical flag.
      update: { authorId, reasons, score, metadata: metadata ? JSON.stringify(metadata) : null },
    });
    return true;
  } catch (err) {
    logger.warn('[Moderation] enqueue failed for %s/%s: %s', entityType, entityId, err.message);
    return false;
  }
}

/**
 * List the moderation queue, newest first. Defaults to PENDING (the work queue).
 * @param {object} [opts]
 * @param {string} [opts.status]      one of MODERATION_STATUSES (default PENDING)
 * @param {string} [opts.entityType]  'Review' | 'Product'
 * @param {number} [opts.limit]
 */
export async function listFlags({ status = 'PENDING', entityType, limit = 50 } = {}) {
  const where = {};
  if (status) where.status = status;
  if (entityType) where.entityType = entityType;
  return prisma.contentFlag.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

/**
 * Resolve a flag — APPROVED (content is legitimate, cleared) or REJECTED
 * (content removed/hidden by the moderator). Returns the updated row, or null if
 * the flag doesn't exist.
 */
export async function resolveFlag({ id, status, reviewedById = null, note = null }) {
  if (!MODERATION_STATUSES.includes(status) || status === 'PENDING') {
    throw Object.assign(new Error('Resolution status must be APPROVED or REJECTED'), { statusCode: 400, expose: true });
  }
  const existing = await prisma.contentFlag.findUnique({ where: { id } });
  if (!existing) return null;
  return prisma.contentFlag.update({
    where: { id },
    data:  { status, reviewedById, reviewedAt: new Date(), resolution: note },
  });
}
