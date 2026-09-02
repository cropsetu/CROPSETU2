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

// A well-formed phone-provider token. sign_in_provider is load-bearing: it is the
// only thing distinguishing SMS possession from any other Firebase sign-in.
const PHONE_TOKEN = {
  phone_number: '+919876543210',
  uid: 'abc123',
  firebase: { sign_in_provider: 'phone' },
};

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
      decodedToken: PHONE_TOKEN,
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
      decodedToken: PHONE_TOKEN,
    });
    await verifyFirebaseIdToken('valid.id.token');
    expect(verifyIdToken).toHaveBeenCalledWith('valid.id.token', true);
  });

  test('rejects a non-geographic number that normalizes onto an Indian account', async () => {
    // THE ATTACK THIS GATE EXISTS FOR. normalizeIndianMobile's foreign guard is
    // `parsed.country && parsed.country !== 'IN'`, which is SKIPPED when
    // libphonenumber returns no country — true for satellite/non-geographic ranges.
    // '+8816123456789' really does normalize to '6123456789', a valid Indian mobile,
    // so without the +91 gate this token would mint a session for whoever owns
    // those digits. Verified against the real phone.js, not a mock.
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { phone_number: '+8816123456789', uid: 'sat', firebase: { sign_in_provider: 'phone' } },
    });
    await expect(verifyFirebaseIdToken('satellite.token'))
      .rejects.toThrow(/not an Indian mobile/i);
  });

  test('rejects a validly-signed token from a NON-phone provider', async () => {
    // phone_number lives on the Firebase USER RECORD, so it is stamped into every
    // token for that user regardless of provider. Anyone holding the victim's
    // Firebase email password would otherwise get a KrushiSarva session.
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { phone_number: '+919876543210', uid: 'abc123', firebase: { sign_in_provider: 'password' } },
    });
    await expect(verifyFirebaseIdToken('email.token'))
      .rejects.toThrow(/not issued by the phone provider/i);
  });

  test('rejects a custom-token sign-in (service-account minted, not SMS possession)', async () => {
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { phone_number: '+919876543210', uid: 'abc123', firebase: { sign_in_provider: 'custom' } },
    });
    await expect(verifyFirebaseIdToken('custom.token'))
      .rejects.toThrow(/not issued by the phone provider/i);
  });

  test('never puts the phone number in the error message (it is logged unredacted)', async () => {
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { phone_number: '+8816123456789', uid: 'sat', firebase: { sign_in_provider: 'phone' } },
    });
    await expect(verifyFirebaseIdToken('satellite.token'))
      .rejects.not.toThrow(/8816123456789/);
  });

  test('rejects a phone-provider token that somehow carries no phone_number', async () => {
    // Defence in depth behind the provider check: even a token Firebase labels
    // 'phone' must not get through without the claim we actually rely on.
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { uid: 'odd-user', firebase: { sign_in_provider: 'phone' } },
    });
    await expect(verifyFirebaseIdToken('anon.token'))
      .rejects.toThrow(/no phone number/i);
  });

  test('rejects a non-Indian number even though the token is validly signed', async () => {
    // Google will happily verify a US number. Our phone column and the MSG91
    // path are India-only, so the token being genuine is not sufficient.
    const { verifyFirebaseIdToken } = await loadService({
      decodedToken: { phone_number: '+14155552671', uid: 'us-user', firebase: { sign_in_provider: 'phone' } },
    });
    await expect(verifyFirebaseIdToken('us.token'))
      .rejects.toThrow(/not an Indian mobile/i);
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
