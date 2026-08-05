/**
 * Shared form validators — single source of truth for field validation rules
 * used across every client form (login, checkout, KYC, ...).
 *
 * Centralised so the regexes can't drift between screens (the bug this fixes:
 * the phone regex was copy-pasted in LoginScreen and CheckoutScreen, and the
 * pincode regex lived only in CheckoutScreen). The backend remains AUTHORITATIVE;
 * these mirror its expectations to give fast, consistent client-side feedback.
 *
 * Each rule is exported both as a RegExp (for callers that need it) and as a
 * boolean predicate that trims/normalises input first.
 */

// Indian mobile number: 10 digits, first digit 6-9 (the valid operator series).
export const PHONE_RE = /^[6-9]\d{9}$/;
// Indian PIN code: exactly 6 digits.
export const PINCODE_RE = /^\d{6}$/;
// One-time password: 6 digits.
export const OTP_RE = /^\d{6}$/;
// GSTIN, e.g. 27ABCDE1234F1Z5.
export const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
// Bank IFSC, e.g. SBIN0012345.
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// Aadhaar: 12 digits.
export const AADHAAR_RE = /^\d{12}$/;
// PAN, e.g. ABCDE1234F.
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Reduce raw phone input to a bare 10-digit national number. Strips non-digits,
 * then drops a +91 country code (12 digits) or a leading 0 trunk prefix (11
 * digits). Length-aware so it never strips "91" from a genuine 10-digit number
 * that happens to start with 91 (the bug in the old CheckoutScreen normPhone).
 */
export function normalizePhone(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** True for a valid Indian mobile number (after normalisation). */
export function isValidPhone(value) {
  return PHONE_RE.test(normalizePhone(value));
}

/** True for a valid 6-digit PIN code. */
export function isValidPincode(value) {
  return PINCODE_RE.test(String(value ?? '').trim());
}

/** True for a valid 6-digit OTP. */
export function isValidOtp(value) {
  return OTP_RE.test(String(value ?? '').trim());
}

/** True for a valid GSTIN (case-insensitive). */
export function isValidGst(value) {
  return GST_RE.test(String(value ?? '').trim().toUpperCase());
}

/** True for a valid bank IFSC (case-insensitive). */
export function isValidIfsc(value) {
  return IFSC_RE.test(String(value ?? '').trim().toUpperCase());
}

/** True for a valid 12-digit Aadhaar number. */
export function isValidAadhaar(value) {
  return AADHAAR_RE.test(String(value ?? '').trim());
}

/** True for a valid PAN (case-insensitive). */
export function isValidPan(value) {
  return PAN_RE.test(String(value ?? '').trim().toUpperCase());
}
