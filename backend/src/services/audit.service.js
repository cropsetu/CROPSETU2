/**
 * Audit Logging Service
 *
 * Records sensitive operations for forensic analysis and compliance.
 * Logs: PII changes, order status changes, product deletions, auth events.
 *
 * Storage: Prisma AuditLog model (must be added to schema).
 * Falls back to structured logging if the DB table doesn't exist yet.
 */
import prisma from "../config/db.js";
import logger from "../utils/logger.js";

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
  userId,
  action,
  entity,
  entityId,
  before = null,
  after = null,
  ip = null,
  requestId = null,
  metadata = null,
}) {
  const entry = {
    userId,
    action,
    entity,
    entityId,
    before,
    after,
    ip,
    requestId,
    metadata,
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
    logger.info(
      { audit: entry },
      `[Audit] ${action} on ${entity}/${entityId} by ${userId}`,
    );
  }
}

// ── Audit action taxonomy ────────────────────────────────────────────────────
// One coordinated catalogue of sensitive-operation action names (OPS-8). Use
// these constants instead of string literals so the taxonomy stays consistent
// and greppable across routes. AUTH_* events live in AUTH_ACTIONS below.
export const AUDIT_ACTIONS = {
  // Already emitted elsewhere — listed here so the taxonomy is complete.
  PII_UPDATE: "PII_UPDATE",
  ORDER_STATUS_CHANGE: "ORDER_STATUS_CHANGE",
  ACCOUNT_ERASURE: "ACCOUNT_ERASURE",
  // Newly covered sensitive operations.
  PRODUCT_DELETE: "PRODUCT_DELETE", // seller removes a product listing
  FEATURE_FLAG_CHANGE: "FEATURE_FLAG_CHANGE", // admin toggles a feature flag (config change)
  KYC_ACCESS: "KYC_ACCESS", // admin views another user's KYC documents (PII access)
  GROUP_MEMBER_REMOVE: "GROUP_MEMBER_REMOVE", // group admin removes a member
  CONSENT_CHANGE: "CONSENT_CHANGE", // DPDP consent grant/withdraw
  // Soft-delete lifecycle — archiving hides a row from reads but keeps it in the
  // DB, so the actor/timestamp must be captured here to stay accountable.
  RESOURCE_ARCHIVE: "RESOURCE_ARCHIVE", // soft-delete/archive of a resource (listing, post, conversation, farm)
  RESOURCE_RESTORE: "RESOURCE_RESTORE", // un-archive/restore of a previously soft-deleted resource
  // Fraud velocity (FRAUD-1) — a sensitive action (order/refund/login) crossed a
  // per-user/device/IP velocity threshold. FLAG = allowed-but-recorded signal;
  // BLOCK = the action was rejected (limit tier).
  FRAUD_VELOCITY_FLAG: "FRAUD_VELOCITY_FLAG",
  FRAUD_VELOCITY_BLOCK: "FRAUD_VELOCITY_BLOCK",
  // Refund/chargeback abuse (FRAUD-2 / COMP-5) — a serial-abuse pattern over the
  // user's order history. FLAG = allowed-but-recorded; RESTRICT = the account is
  // blocked from new refunds/cancellations (restrict tier).
  FRAUD_REFUND_ABUSE_FLAG: "FRAUD_REFUND_ABUSE_FLAG",
  FRAUD_REFUND_ABUSE_RESTRICT: "FRAUD_REFUND_ABUSE_RESTRICT",
  // Multi-account detection (FRAUD-3) — one device fingerprint linked to several
  // distinct accounts; the cluster is surfaced for review (flag-only).
  FRAUD_MULTI_ACCOUNT_FLAG: "FRAUD_MULTI_ACCOUNT_FLAG",
  // Fake content (FRAUD-5) — a review/listing was routed to the moderation queue
  // by burst/duplication/account-age heuristics.
  FRAUD_CONTENT_FLAG: "FRAUD_CONTENT_FLAG",
  // Payment-amount tamper (FRAUD-6) — the confirmed/paid amount (or a client-sent
  // total, or the payment's owner) disagreed with the authoritative order amount
  // at checkout confirmation; the confirmation was blocked.
  FRAUD_PAYMENT_TAMPER: "FRAUD_PAYMENT_TAMPER",
};

/**
 * Thin request-aware wrapper over auditLog for route handlers: pulls the actor,
 * IP and request id off `req` so a caller only specifies the action + target.
 * Best-effort (auditLog never throws on a DB miss); call sites still attach
 * `.catch(() => {})` so auditing can never break the operation it records.
 */
export async function auditAction(
  req,
  { action, entity, entityId, before = null, after = null, metadata = null },
) {
  await auditLog({
    userId: req.user?.id,
    action,
    entity,
    entityId,
    before,
    after,
    ip: req.ip,
    requestId: req.id,
    metadata,
  });
}

// ── Pre-built audit helpers ──────────────────────────────────────────────────

export async function auditPiiUpdate(req, entity, entityId, changedFields) {
  // Redact actual PII values — only log which fields changed
  const redacted = {};
  const SENSITIVE = [
    "aadharNumber",
    "panNumber",
    "phone",
    // Bank financial PII — now encrypted at rest; never echo the value
    // (even ciphertext) into the audit trail.
    "bankAccountNumber",
    "bankHolderName",
    "bankName",
    "bankIfsc",
    // KYC document references (private Cloudinary public_ids).
    "kycDocumentUrls",
  ];
  for (const key of Object.keys(changedFields)) {
    if (SENSITIVE.includes(key)) {
      redacted[key] = "***REDACTED***";
    } else {
      redacted[key] = changedFields[key];
    }
  }

  await auditLog({
    userId: req.user?.id,
    action: "PII_UPDATE",
    entity,
    entityId,
    after: redacted,
    ip: req.ip,
    requestId: req.id,
  });
}

export async function auditOrderStatusChange(
  req,
  orderId,
  oldStatus,
  newStatus,
) {
  await auditLog({
    userId: req.user?.id,
    action: "ORDER_STATUS_CHANGE",
    entity: "Order",
    entityId: orderId,
    before: { status: oldStatus },
    after: { status: newStatus },
    ip: req.ip,
    requestId: req.id,
  });
}

// Structured action names for authentication events (the "outcome" is encoded
// in the name; an explicit `outcome` is also added to metadata for clarity).
export const AUTH_ACTIONS = {
  LOGIN: "AUTH_LOGIN",
  LOGIN_RISKY: "AUTH_LOGIN_RISKY", // successful login flagged by risk signals (new device / IP)
  LOGIN_GEO_ANOMALY: "AUTH_LOGIN_GEO_ANOMALY", // login flagged by geo anomaly (impossible travel / new country) — FRAUD-4
  LOGOUT: "AUTH_LOGOUT",
  OTP_FAILURE: "AUTH_OTP_FAILURE",
  OTP_LOCKOUT: "AUTH_OTP_LOCKOUT",
  TOKEN_REFRESH: "AUTH_TOKEN_REFRESH",
  TOKEN_REUSE: "AUTH_TOKEN_REUSE",
};

/** Mask a phone for audit metadata — keep the last 4 digits only. */
export function maskPhone(phone) {
  if (!phone || typeof phone !== "string") return null;
  return phone.length <= 4
    ? phone
    : "*".repeat(phone.length - 4) + phone.slice(-4);
}

/**
 * Record an authentication event (login, logout, OTP failure, token rotation…).
 * `userId` is the actor; for events without a known actor (e.g. a failed OTP on
 * an unregistered number) it falls back to the 'anonymous' sentinel so the row
 * still persists. Never throws — auditing must not break the auth flow.
 */
export async function auditAuthEvent(userId, action, ip, metadata = null) {
  await auditLog({
    userId: userId || "anonymous",
    action,
    entity: "Auth",
    entityId: userId || "anonymous",
    ip,
    metadata,
  });
}
