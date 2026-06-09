/**
 * Shared phone-number validation/normalization (Indian mobiles).
 *
 * Replaces the ad-hoc `/^[6-9]\d{9}$/` regex that was duplicated across routes —
 * some sites normalized first, some didn't, so the SAME number could pass in one
 * place and fail in another (e.g. a "+91…" or "0…" prefix). This is the single
 * source of truth; every backend call site should use it. (Frontend mirrors it
 * via the same library — see FE-12.)
 *
 * Uses libphonenumber-js to accept real-world formatting (+91 / 91 / 0 prefixes,
 * spaces, dashes, parens) and then gates on the Indian mobile rule: a 10-digit
 * national number starting 6-9. The libphonenumber IN metadata alone is lenient
 * (it treats e.g. 1234567890 as "valid"), so the national-prefix check is what
 * actually enforces "mobile".
 */
import * as libphonenumber from 'libphonenumber-js';
import { body } from 'express-validator';

// Namespace import + fallback so this resolves under both native ESM and Jest's
// experimental-vm-modules CJS interop (where the bare named export is undefined).
const parsePhoneNumberFromString =
  libphonenumber.parsePhoneNumberFromString || libphonenumber.default?.parsePhoneNumberFromString;

const INDIAN_MOBILE_NATIONAL = /^[6-9]\d{9}$/;

/**
 * Digit-based fallback: strip non-digits, drop a leading 91 (country) or 0
 * (trunk) prefix ONLY when exactly 10 digits remain (so a mobile that genuinely
 * starts with "91", e.g. 9123456789, is preserved), then require the Indian
 * mobile shape. Used when libphonenumber can't be consulted.
 */
function fallbackNormalize(str) {
  const digits = str.replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
  return INDIAN_MOBILE_NATIONAL.test(digits) ? digits : null;
}

/**
 * Normalize any user-entered Indian mobile to its canonical 10-digit national
 * form (how phones are stored and how MSG91 formats them as `91${phone}`), or
 * null if it isn't a valid Indian mobile.
 *
 * Primary path is libphonenumber (rejects foreign numbers, validates ranges);
 * if it's unavailable for any reason the digit-based fallback still enforces the
 * Indian-mobile rule, so this never wrongly rejects a real number.
 *
 * @param {*} raw
 * @returns {string|null} 10-digit national number, or null
 */
export function normalizeIndianMobile(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  try {
    if (typeof parsePhoneNumberFromString === 'function') {
      const parsed = parsePhoneNumberFromString(str, 'IN');
      if (parsed && parsed.isValid()) {
        if (parsed.country && parsed.country !== 'IN') return null; // foreign number
        const national = String(parsed.nationalNumber);
        return INDIAN_MOBILE_NATIONAL.test(national) ? national : null;
      }
    }
  } catch {
    /* metadata/load issue — fall through to the digit-based check */
  }
  return fallbackNormalize(str);
}

/**
 * True if `raw` is a valid Indian mobile in any accepted format.
 * @param {*} raw
 * @returns {boolean}
 */
export function isValidIndianMobile(raw) {
  return normalizeIndianMobile(raw) !== null;
}

/**
 * Build an express-validator chain that normalizes the field to the canonical
 * 10-digit form (so downstream handlers + the DB always see the same value) and
 * rejects non-Indian-mobiles with 400. Returns a FRESH chain per call (chains
 * are stateful and must not be shared between routes).
 *
 * @param {string} [field='phone']
 * @param {string} [message]
 */
export function indianMobileBody(field = 'phone', message = 'Enter a valid 10-digit Indian mobile number') {
  return body(field)
    // Normalize valid input to 10 digits; keep the raw value when invalid so the
    // .custom() check below fails and surfaces the message.
    .customSanitizer((v) => normalizeIndianMobile(v) || v)
    .custom(isValidIndianMobile)
    .withMessage(message);
}
