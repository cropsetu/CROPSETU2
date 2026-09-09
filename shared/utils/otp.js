// ─────────────────────────────────────────────────────────────────────────────
// OTP box logic — pure, so the six-box field's paste / SMS-autofill / backspace
// behaviour can be tested without a renderer.
// ─────────────────────────────────────────────────────────────────────────────

export const OTP_LENGTH = 6;

/**
 * Fold one box's raw onChangeText into the whole code.
 *
 * A paste or an SMS autofill drops the ENTIRE code into a single box, so the
 * multi-character case spreads the digits across the boxes from `index`
 * onwards. (This is also why box 0 must carry maxLength = OTP_LENGTH rather
 * than 1: maxLength is enforced natively, so a 1-char box truncates a 6-digit
 * autofill to its first digit before onChangeText ever fires.)
 *
 * Returns the next digit array and the box that should take focus, or
 * `focus: null` when focus should stay put (backspace clearing a box).
 */
export function applyOtpInput(prev, index, raw, len = OTP_LENGTH) {
  const next = Array.isArray(prev) ? [...prev] : Array(len).fill('');
  if (!Number.isInteger(index) || index < 0 || index >= len) return { digits: next, focus: null };

  const digits = String(raw ?? '').replace(/\D/g, '');

  if (digits.length > 1) {
    for (let k = 0; k < digits.length && index + k < len; k++) next[index + k] = digits[k];
    const filledTo = Math.min(index + digits.length, len);
    return { digits: next, focus: filledTo >= len ? len - 1 : filledTo };
  }

  // Single character (typing) or empty string (backspace clears the box).
  const ch = digits.slice(-1);
  next[index] = ch;
  return { digits: next, focus: ch && index < len - 1 ? index + 1 : null };
}

export function isOtpComplete(digits, len = OTP_LENGTH) {
  return Array.isArray(digits) && digits.length === len && digits.every((d) => /^[0-9]$/.test(d));
}

/**
 * Should the code submit itself, without the farmer tapping "Verify"?
 *
 * Guards, in order: the code must be complete; a verify must not already be in
 * flight; and the exact same code must not have been auto-submitted already —
 * otherwise a re-render after a failed attempt would fire a second identical
 * request. `lastSubmitted` is reset by the caller on error / resend / going
 * back, so a farmer retyping the same code by hand is still allowed through.
 */
export function shouldAutoSubmitOtp({ digits, verifying, lastSubmitted, len = OTP_LENGTH }) {
  if (!isOtpComplete(digits, len)) return false;
  if (verifying) return false;
  return digits.join('') !== lastSubmitted;
}
