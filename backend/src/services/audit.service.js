/**
 * Audit Logging Service
 *
 * Records sensitive operations for forensic analysis and compliance.
 * Logs: PII changes, order status changes, product deletions, auth events.
 *
 * Storage: Prisma AuditLog model (must be added to schema).
 * Falls back to structured logging if the DB table doesn't exist yet.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';

/**
 * Record an audit event.
 *
 * @param {object} params
 * @param {string} params.userId     — who performed the action
 * @param {string} params.action     — e.g. 'PII_UPDATE', 'ORDER_CANCEL', 'PRODUCT_DELETE'
 * @param {string} params.entity     — e.g. 'User', 'Order', 'Product'
 * @param {string} params.entityId   — the record's primary key
 * @param {object} [params.before]   — old values (redacted PII)
 * @param {object} [params.after]    — new values (redacted PII)
 * @param {string} [params.ip]       — request IP
 * @param {string} [params.requestId]— x-request-id header
 * @param {object} [params.metadata] — any extra context
 */
export async function auditLog({
  userId, action, entity, entityId,
  before = null, after = null,
  ip = null, requestId = null, metadata = null,
}) {
  const entry = {
    userId, action, entity, entityId,
    before, after, ip, requestId, metadata,
    timestamp: new Date().toISOString(),
  };

  // Try to write to DB; fall back to structured log
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        before: before ? JSON.stringify(before) : null,
        after: after ? JSON.stringify(after) : null,
        ip,
        requestId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch {
    // Table may not exist yet — log to stdout for ops visibility
    logger.info({ audit: entry }, `[Audit] ${action} on ${entity}/${entityId} by ${userId}`);
  }
}

// ── Pre-built audit helpers ──────────────────────────────────────────────────

export async function auditPiiUpdate(req, entity, entityId, changedFields) {
  // Redact actual PII values — only log which fields changed
  const redacted = {};
  for (const key of Object.keys(changedFields)) {
    if (['aadharNumber', 'panNumber', 'bankAccountNumber', 'phone'].includes(key)) {
      redacted[key] = '***REDACTED***';
    } else {
      redacted[key] = changedFields[key];
    }
  }

  await auditLog({
    userId: req.user?.id,
    action: 'PII_UPDATE',
    entity,
    entityId,
    after: redacted,
    ip: req.ip,
    requestId: req.id,
  });
}

export async function auditOrderStatusChange(req, orderId, oldStatus, newStatus) {
  await auditLog({
    userId: req.user?.id,
    action: 'ORDER_STATUS_CHANGE',
    entity: 'Order',
    entityId: orderId,
    before: { status: oldStatus },
    after: { status: newStatus },
    ip: req.ip,
    requestId: req.id,
  });
}

export async function auditAuthEvent(userId, action, ip, metadata = null) {
  await auditLog({
    userId,
    action,
    entity: 'Auth',
    entityId: userId || 'unknown',
    ip,
    metadata,
  });
}
