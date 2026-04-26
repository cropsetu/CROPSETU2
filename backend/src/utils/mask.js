/**
 * Mask sensitive PII fields for API responses.
 * Aadhaar: show last 4 digits, PAN: show last 4, bank account: show last 4.
 */

function maskValue(value, visibleChars = 4) {
  if (!value || typeof value !== 'string') return value;
  if (value.length <= visibleChars) return value;
  return '*'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

export function maskSensitiveFields(profile) {
  if (!profile) return profile;

  const masked = { ...profile };

  if (masked.aadhaarNumber) masked.aadhaarNumber = maskValue(masked.aadhaarNumber);
  if (masked.panNumber)     masked.panNumber     = maskValue(masked.panNumber);
  if (masked.bankAccount)   masked.bankAccount   = maskValue(masked.bankAccount);
  if (masked.ifscCode)      masked.ifscCode      = maskValue(masked.ifscCode, 6);

  return masked;
}
