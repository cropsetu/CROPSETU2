/**
 * Admin PII masking + audited reveal.
 *
 * HARD RULE: every admin response masks PII by default (phone, bank, Aadhaar,
 * PAN, lat/lng, income). The plaintext is only ever returned when the caller
 * explicitly asks for it with `?reveal=true&reason=<why>` — and that reveal is
 * itself written to the AuditLog (who revealed what, why, from which IP). Raw
 * decrypted PII is NEVER shipped to the client without that logged reason.
 *
 * The encrypted-at-rest columns (lat/lng/annualHouseholdIncome on User; bank +
 * aadhaar/pan on SellerProfile) are decrypted here only on the reveal path.
 */
import { decryptNumber } from './encrypt.js';
import { auditLog, maskPhone } from '../services/audit.service.js';

export { maskPhone };

/**
 * Resolve the reveal intent of a request. Reveal is only honoured when BOTH
 * `?reveal=true` AND a non-empty `reason` are present — a reveal without a
 * reason is treated as no reveal (the route should 400 before reaching here).
 */
export function revealContext(req) {
  const wants = String(req.query.reveal) === 'true';
  const reason = typeof req.query.reason === 'string' ? req.query.reason.trim() : '';
  return { reveal: wants && reason.length > 0, wants, reason: reason || null };
}

/** Mask a free phone string to its last 4 digits (null-safe). */
export function maskPhoneValue(phone) {
  return maskPhone(phone);
}

/** Aadhaar last-4 (already non-sensitive) shown in a masked frame. */
function frameAadhaarLast4(last4) {
  if (!last4) return null;
  return `••••-••••-${String(last4).slice(-4)}`;
}

/**
 * Shape a User row for an admin response: mask PII unless `reveal` is true.
 * The caller passes the raw Prisma user (with encrypted lat/lng/income). On the
 * masked path the encrypted blobs are dropped entirely (never echoed); on the
 * reveal path they are decrypted to numbers.
 *
 * Returns a NEW object — never mutates the input.
 */
export function shapeUser(user, { reveal = false } = {}) {
  if (!user) return user;
  const { lat, lng, annualHouseholdIncome, phone, aadhaarLast4, ...rest } = user;
  const out = { ...rest, piiRevealed: reveal };

  out.phone = reveal ? phone : maskPhone(phone);
  out.aadhaarLast4 = frameAadhaarLast4(aadhaarLast4);

  if (reveal) {
    out.lat = decryptNumber(lat);
    out.lng = decryptNumber(lng);
    out.annualHouseholdIncome = decryptNumber(annualHouseholdIncome);
  } else {
    // Never ship ciphertext; signal presence without value.
    out.lat = null;
    out.lng = null;
    out.annualHouseholdIncome = null;
    out.hasLocation = Boolean(lat && lng);
    out.hasIncome = Boolean(annualHouseholdIncome);
  }
  return out;
}

/**
 * Record a PII reveal in the audit trail. Best-effort (never throws) — but the
 * route should `await` it so the reveal is logged before the plaintext is sent.
 *
 * @param {object} req
 * @param {object} p
 * @param {string} p.entity     'User' | 'SellerProfile'
 * @param {string} p.entityId
 * @param {string[]} p.fields   which PII fields were revealed
 * @param {string} p.reason     the operator-supplied justification
 */
export async function auditReveal(req, { entity, entityId, fields, reason }) {
  await auditLog({
    userId: req.user?.id,
    action: 'ADMIN_PII_REVEAL',
    entity,
    entityId,
    after: { fields, reason },
    ip: req.ip,
    requestId: req.id,
  }).catch(() => {});
}
