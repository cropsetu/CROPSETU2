/**
 * Mask/unwrap sensitive PII fields for API responses (SellerProfile).
 *
 * ALL bank/KYC fields are stored ENCRYPTED at rest (AES-256-GCM, see encrypt.js).
 * This shaper is the single "decrypt only when needed" boundary — it runs when
 * the owner reads their own profile and turns the stored ciphertext into:
 *
 *   - a partial mask for true identifiers we must never echo in full:
 *       aadharNumber      → ••••-••••-1234   (last 4)
 *       panNumber         → ABCDE•••4F       (first 5 + last 2)
 *       bankAccountNumber → ••••••1234       (last 4)
 *   - the full plaintext for fields the owner needs to read back:
 *       bankHolderName, bankName            (display names)
 *       bankIfsc                            (a branch code, not personal PII)
 *
 * Field names MUST match the Prisma SellerProfile model exactly. The mask/
 * decrypt helpers transparently pass legacy plaintext rows through, so the
 * encrypt -> store -> decrypt path stays symmetric during the migration window.
 */
import { maskAadhaar, maskPan, maskAccount, maskIfsc, decrypt } from './encrypt.js';

/** Decrypt to full plaintext for display; pass legacy plaintext through. */
function reveal(val) {
  if (!val) return val;
  return decrypt(val) ?? val;
}

export function maskSensitiveFields(profile) {
  if (!profile) return profile;

  const masked = { ...profile };

  // Partial masks (decrypt-then-redact) for sensitive identifiers
  if (masked.aadharNumber)      masked.aadharNumber      = maskAadhaar(masked.aadharNumber);
  if (masked.panNumber)         masked.panNumber         = maskPan(masked.panNumber);
  if (masked.bankAccountNumber) masked.bankAccountNumber = maskAccount(masked.bankAccountNumber);
  if (masked.bankIfsc)          masked.bankIfsc          = maskIfsc(masked.bankIfsc);

  // Full decrypt for display-only bank fields
  if (masked.bankHolderName)    masked.bankHolderName    = reveal(masked.bankHolderName);
  if (masked.bankName)          masked.bankName          = reveal(masked.bankName);

  // Never expose raw KYC document references in a profile payload — those are
  // private Cloudinary public_ids, served only via the dedicated signed-URL
  // endpoints (GET /me/kyc-documents, GET /:userId/kyc-documents).
  if ('kycDocumentUrls' in masked) delete masked.kycDocumentUrls;

  return masked;
}
