/**
 * PII masking helpers for API responses.
 *
 * These functions take a potentially encrypted value, decrypt it,
 * then return only a safe partial representation.
 * They are thin wrappers over encrypt.js so callers don't need to
 * import both files.
 *
 * IMPORTANT: Never return raw (decrypted) PII in any API response.
 * Always pass stored field values through a mask function before sending.
 *
 * Usage:
 *   import { maskSensitiveFields } from './mask.js';
 *   const safe = maskSensitiveFields(sellerProfile);
 */
import { maskAadhaar, maskAccount, maskPan, maskIfsc } from './encrypt.js';

export { maskAadhaar, maskAccount, maskPan, maskIfsc };

/**
 * Returns a copy of a seller profile object with all PII fields masked.
 * Any unknown/extra fields are dropped — only the listed safe fields are returned.
 *
 * @param {object|null} sp  Raw seller profile from Prisma
 * @returns {object|null}
 */
export function maskSensitiveFields(sp) {
  if (!sp) return null;
  return {
    id:                sp.id                ?? null,
    bankHolderName:    sp.bankHolderName    ?? null,
    bankName:          sp.bankName          ?? null,
    bankAccountNumber: maskAccount(sp.bankAccountNumber),
    bankIfsc:          maskIfsc(sp.bankIfsc),
    aadharNumber:      maskAadhaar(sp.aadharNumber),
    panNumber:         maskPan(sp.panNumber),
    kycVerifiedAt:     sp.kycVerifiedAt     ?? null,
    kycRejectedReason: sp.kycRejectedReason ?? null,
    updatedAt:         sp.updatedAt         ?? null,
  };
}
