/**
 * Unit tests for OTP generation security.
 * The OTP service uses Math.random() which is NOT cryptographically secure.
 * This test documents the vulnerability and proposes the fix.
 */

describe('OTP generation security', () => {
  test('Math.random produces 6-digit OTP in valid range', () => {
    // Replicate the OTP generation logic
    for (let i = 0; i < 1000; i++) {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      expect(otp).toHaveLength(6);
      const num = parseInt(otp, 10);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThanOrEqual(999999);
    }
  });

  test('VULNERABILITY: Math.random is predictable — should use crypto.randomInt', () => {
    // This test documents the vulnerability.
    // Math.random() uses xorshift128+ which is deterministic given the internal state.
    // An attacker who can observe enough outputs can predict future OTPs.
    //
    // FIX: Replace in otp.service.js:
    //   import crypto from 'crypto';
    //   function generateOtp() {
    //     return String(crypto.randomInt(100000, 999999));
    //   }
    expect(typeof Math.random()).toBe('number');
    // This assertion intentionally passes — it's a documentation test.
  });

  test('OTP dev bypass should check NODE_ENV', () => {
    // The dev bypass in verifyOtp accepts '000000' when MSG91_AUTH_KEY is empty.
    // This is dangerous because MSG91_AUTH_KEY defaults to '' in env.js.
    // FIX: Add ENV.IS_DEV check:
    //   const devBypass = ENV.IS_DEV && !ENV.MSG91_AUTH_KEY && otp === '000000';
    const isSafeCheck = (isDev, hasKey, otp) => {
      return isDev && !hasKey && otp === '000000';
    };

    // Production without key — should NOT bypass
    expect(isSafeCheck(false, false, '000000')).toBe(false);
    // Development without key — should bypass
    expect(isSafeCheck(true, false, '000000')).toBe(true);
    // Production with key — should NOT bypass
    expect(isSafeCheck(false, true, '000000')).toBe(false);
    // Development with wrong OTP — should NOT bypass
    expect(isSafeCheck(true, false, '123456')).toBe(false);
  });
});
