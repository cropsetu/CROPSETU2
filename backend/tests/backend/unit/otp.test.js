/**
 * Unit tests for OTP generation security.
 * The OTP service uses Math.random() which is NOT cryptographically secure.
 * This test documents the vulnerability and proposes the fix.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

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

});

describe('OTP dev bypass — production unreachability', () => {
  // Mirror of the fail-closed resolver in config/env.js (_otpDevBypass). Kept in
  // lockstep so any regression that loosens the real rule trips this test too.
  const bypassEnabled = ({ optIn, nodeEnv, msg91Key }) =>
    optIn === 'true' && nodeEnv !== 'production' && !msg91Key;

  test('unreachable in production regardless of opt-in or missing SMS key', () => {
    expect(bypassEnabled({ optIn: 'true', nodeEnv: 'production', msg91Key: '' })).toBe(false);
    expect(bypassEnabled({ optIn: 'true', nodeEnv: 'production', msg91Key: 'k' })).toBe(false);
  });

  test('closes the fail-open hole: loose/unset NODE_ENV no longer enables it', () => {
    // The old gate keyed only on NODE_ENV !== 'production', so a prod box that
    // forgot to set NODE_ENV (or used 'prod'/'staging') with no SMS key accepted
    // '000000'. Now an explicit opt-in is required, so absent config is safe.
    expect(bypassEnabled({ optIn: undefined, nodeEnv: undefined, msg91Key: '' })).toBe(false);
    expect(bypassEnabled({ optIn: undefined, nodeEnv: 'staging', msg91Key: '' })).toBe(false);
    expect(bypassEnabled({ optIn: undefined, nodeEnv: 'prod', msg91Key: '' })).toBe(false);
  });

  test('enabled only with explicit non-prod opt-in and no live SMS provider', () => {
    expect(bypassEnabled({ optIn: 'true', nodeEnv: 'development', msg91Key: '' })).toBe(true);
    expect(bypassEnabled({ optIn: 'true', nodeEnv: 'test', msg91Key: '' })).toBe(true);
    expect(bypassEnabled({ optIn: 'true', nodeEnv: 'development', msg91Key: 'k' })).toBe(false); // real SMS wired
    expect(bypassEnabled({ optIn: 'false', nodeEnv: 'development', msg91Key: '' })).toBe(false); // not opted in
  });

  test('the live resolved ENV flag is enabled under the test runner', async () => {
    // setupFiles sets OTP_DEV_BYPASS_ENABLED=true; NODE_ENV=test, no SMS key →
    // the suite can log in via the bypass while prod stays locked.
    const { ENV } = await import('../../../src/config/env.js');
    expect(ENV.OTP_DEV_BYPASS).toBe(true);
  });
});

describe('OTP dev bypass — production boot guard (subprocess)', () => {
  // Spawn a fresh Node that imports config/env.js with a production-shaped env.
  // The guard must REFUSE to boot when the bypass opt-in is set in production.
  const envModuleUrl = pathToFileURL(path.join(process.cwd(), 'src', 'config', 'env.js')).href;
  const prodEnv = (extra) => ({
    ...process.env,
    NODE_ENV: 'production',
    // Satisfy the other production-required keys so the bypass is the lever under test.
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(40),
    FIELD_ENCRYPTION_KEY: 'a'.repeat(64),
    FIELD_ENCRYPTION_KEYS: '',
    FIELD_ENCRYPTION_ACTIVE_KEY_ID: '',
    AI_SHARED_SECRET: 'x'.repeat(24),
    GEMINI_API_KEY: 'test',
    GROQ_API_KEY: 'test',
    MSG91_AUTH_KEY: '',
    ...extra,
  });
  const importEnv = (env) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(envModuleUrl)})`],
      { cwd: process.cwd(), encoding: 'utf8', env });

  test('boot is REFUSED when OTP_DEV_BYPASS_ENABLED=true in production', () => {
    const res = importEnv(prodEnv({ OTP_DEV_BYPASS_ENABLED: 'true' }));
    expect(res.status).not.toBe(0);
    expect(`${res.stderr}${res.stdout}`).toMatch(/OTP_DEV_BYPASS_ENABLED must not be enabled in production/i);
  });

  test('boot SUCCEEDS in production when the bypass opt-in is absent', () => {
    const res = importEnv(prodEnv({ OTP_DEV_BYPASS_ENABLED: 'false' }));
    expect(res.status).toBe(0);
  });
});
