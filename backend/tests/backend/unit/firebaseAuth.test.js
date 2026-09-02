/**
 * Unit tests for the Firebase Phone Auth login path.
 *
 * This path exists only because SMS to Indian numbers needs a DLT-registered
 * sender, which KrushiSarva does not yet have. It runs ALONGSIDE the MSG91 OTP
 * flow — these tests must never require otp.service.js to change.
 *
 * What matters here is the trust boundary: a Firebase ID token is Google-signed
 * and unforgeable, but we trust it for exactly ONE claim (phone_number) and
 * re-validate that claim with our own phone rules before it can reach the DB.
 */
import { jest } from '@jest/globals';

const FIREBASE_ENV = {
  FIREBASE_AUTH_ENABLED: 'true',
  FIREBASE_PROJECT_ID:   'krushisarva-test',
  FIREBASE_CLIENT_EMAIL: 'sa@krushisarva-test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:  '-----BEGIN PRIVATE KEY-----\\nFAKE\\n-----END PRIVATE KEY-----\\n',
};

/**
 * Load the service with a stubbed firebase-admin.
 * ENV is frozen at import time, so env vars must be set BEFORE the dynamic import
 * and the module registry reset between cases.
 */
async function loadService({ decodedToken, verifyError, env = FIREBASE_ENV } = {}) {
  jest.resetModules();
  Object.assign(process.env, env);

  const verifyIdToken = jest.fn(async () => {
    if (verifyError) throw verifyError;
    return decodedToken;
  });

  jest.unstable_mockModule('firebase-admin/app', () => ({
    initializeApp: jest.fn(() => ({ name: 'test' })),
    cert:          jest.fn((c) => c),
    getApps:       jest.fn(() => []),
  }));
  jest.unstable_mockModule('firebase-admin/auth', () => ({
    getAuth: jest.fn(() => ({ verifyIdToken })),
  }));

  const mod = await import('../../../src/services/firebaseAuth.service.js');
  return { ...mod, verifyIdToken };
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(FIREBASE_ENV)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('isFirebaseAuthEnabled', () => {
  test('false when the flag is off, even with a full service account', async () => {
    const { isFirebaseAuthEnabled } = await loadService({
      env: { ...FIREBASE_ENV, FIREBASE_AUTH_ENABLED: 'false' },
    });
    expect(isFirebaseAuthEnabled()).toBe(false);
  });

  test('false when the flag is on but the service account is incomplete', async () => {
    // A flag flipped on against an unconfigured server must not half-work — the
    // route 503s instead of throwing an opaque error per request.
    const { isFirebaseAuthEnabled } = await loadService({
      env: { ...FIREBASE_ENV, FIREBASE_PRIVATE_KEY: '' },
    });
    expect(isFirebaseAuthEnabled()).toBe(false);
  });

  test('true only when the flag AND all three credentials are present', async () => {
    const { isFirebaseAuthEnabled } = await loadService();
    expect(isFirebaseAuthEnabled()).toBe(true);
  });
});

describe('verifyFirebaseIdToken', () => {
  test('returns the canonical 10-digit phone from an E.164 claim', async () => {
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { phone_number: '+919876543210', uid: 'abc123' },
    });
    const result = await verifyFirebaseIdToken('valid.id.token');
    // The rest of the app (and User.phone) stores 10 digits — the same shape
    // verify-otp produces, so downstream code can't tell the paths apart.
    expect(result.phone).toBe('9876543210');
    expect(result.firebaseUid).toBe('abc123');
  });

  test('checks revocation, not just signature and expiry', async () => {
    // checkRevoked=true means a Firebase-side account disable takes effect
    // immediately instead of being honoured until the token naturally expires.
    const { verifyFirebaseIdToken, verifyIdToken } = await loadService({
      decodedToken: { phone_number: '+919876543210', uid: 'abc123' },
    });
    await verifyFirebaseIdToken('valid.id.token');
    expect(verifyIdToken).toHaveBeenCalledWith('valid.id.token', true);
  });

  test('rejects a token with no phone_number claim', async () => {
    // Firebase issues ID tokens for every provider it supports. Only the phone
    // provider proves control of a number; an anonymous/email token must not be
    // able to log anyone in.
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { uid: 'anon-user', email: 'someone@example.com' },
    });
    await expect(verifyFirebaseIdToken('anon.token'))
      .rejects.toThrow(/no phone number/i);
  });

  test('rejects a non-Indian number even though the token is validly signed', async () => {
    // Google will happily verify a US number. Our phone column and the MSG91
    // path are India-only, so the token being genuine is not sufficient.
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { phone_number: '+14155552671', uid: 'us-user' },
    });
    await expect(verifyFirebaseIdToken('us.token'))
      .rejects.toThrow(/not a valid Indian mobile/i);
  });

  test('propagates a signature/expiry failure from the SDK', async () => {
    const { verifyFirebaseIdToken } = await loadService({
      verifyError: new Error('Firebase ID token has expired'),
    });
    await expect(verifyFirebaseIdToken('expired.token'))
      .rejects.toThrow(/expired/i);
  });

  test('throws a clear error when the server has no Firebase credentials', async () => {
    const { verifyFirebaseIdToken } = await loadService({
      env: { ...FIREBASE_ENV, FIREBASE_PROJECT_ID: '', FIREBASE_CLIENT_EMAIL: '', FIREBASE_PRIVATE_KEY: '' },
    });
    await expect(verifyFirebaseIdToken('any.token'))
      .rejects.toThrow(/not configured/i);
  });
});
