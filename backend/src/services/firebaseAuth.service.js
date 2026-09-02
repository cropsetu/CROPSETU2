/**
 * Firebase Phone Auth — ID-token verification.
 *
 * WHY THIS EXISTS (and why it does NOT replace otp.service.js):
 * SMS to Indian numbers requires the sender to be registered on the telecom
 * operators' DLT platform (TRAI TCCCPR). Until KrushiSarva's own DLT registration
 * is approved, MSG91 cannot deliver a single OTP — the operator drops it silently.
 * Firebase Phone Auth works today because *Google* is the DLT-registered sender.
 *
 * So this is a PARALLEL login path, not a migration:
 *   • MSG91 path  — we generate the OTP, hash it, verify it, own the lockout.
 *   • Firebase path — Google generates, sends and verifies the OTP; we only
 *     verify the resulting ID token and mint our own session.
 *
 * otp.service.js is deliberately untouched. When DLT approval lands, flip
 * FIREBASE_AUTH_ENABLED off and the MSG91 path is exactly as it was.
 *
 * TRUST MODEL — read before changing anything here:
 * The ID token is a Google-signed JWT. verifyIdToken() checks the signature
 * against Google's rotating public keys, the issuer, the audience (our project),
 * and expiry. A client cannot forge one. But we trust it ONLY for the single
 * claim we need — `phone_number` — and we re-normalize that through our own
 * phone validator before it reaches the database. Nothing else in the token
 * (name, picture, uid) is allowed to influence the account we issue tokens for.
 */
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';
import { normalizeIndianMobile } from '../utils/phone.js';

let adminApp = null;
let initError = null;

/**
 * Lazily initialise firebase-admin.
 *
 * Lazy on purpose: the backend must boot fine with Firebase unconfigured (it is
 * an optional login path, exactly like MSG91). Importing/initialising at module
 * load would make a missing service account a boot failure for every deploy that
 * doesn't use Firebase.
 *
 * Returns the admin auth instance, or throws a clean error the route turns into
 * a 503. Never throws at import time.
 */
async function getFirebaseAuth() {
  if (adminApp) return adminApp;
  if (initError) throw initError;

  if (!ENV.FIREBASE_PROJECT_ID || !ENV.FIREBASE_CLIENT_EMAIL || !ENV.FIREBASE_PRIVATE_KEY) {
    initError = new Error('Firebase auth is not configured on this server');
    throw initError;
  }

  try {
    // Dynamic import — keeps firebase-admin out of the boot path entirely when
    // the feature is off, and out of the dependency graph of every test that
    // doesn't touch this file.
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');

    // getApps() guards against double-init under hot reload / multiple imports.
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: cert({
            projectId:   ENV.FIREBASE_PROJECT_ID,
            clientEmail: ENV.FIREBASE_CLIENT_EMAIL,
            // Railway/dotenv store the PEM with literal "\n" sequences; the SDK
            // needs real newlines or the signature check fails with an opaque error.
            privateKey:  ENV.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
          projectId: ENV.FIREBASE_PROJECT_ID,
        });

    adminApp = getAuth(app);
    logger.info('[FirebaseAuth] initialised for project %s', ENV.FIREBASE_PROJECT_ID);
    return adminApp;
  } catch (err) {
    // Cache the failure. A bad service account will not fix itself on retry, and
    // re-attempting init on every login request would add latency to a guaranteed
    // failure. A restart clears it.
    initError = new Error(`Firebase auth init failed: ${err.message}`);
    logger.error({ err }, '[FirebaseAuth] init failed');
    throw initError;
  }
}

/**
 * Verify a Firebase ID token and extract the phone number it proves ownership of.
 *
 * Returns { phone } — a canonical 10-digit Indian mobile, the same shape
 * verify-otp produces, so downstream code cannot tell the two paths apart.
 *
 * Throws on: unconfigured server, invalid/expired/revoked token, a token with no
 * phone_number claim, or a phone number that isn't a valid Indian mobile.
 */
export async function verifyFirebaseIdToken(idToken) {
  const auth = await getFirebaseAuth();

  // checkRevoked: true costs one extra lookup but means a token invalidated by a
  // Firebase-side account disable or revokeRefreshTokens() is rejected here
  // rather than being honoured until natural expiry.
  const decoded = await auth.verifyIdToken(idToken, true);

  // Firebase issues ID tokens for every sign-in provider it supports. Only the
  // phone provider proves control of a phone number — an anonymous or email
  // token carries no phone_number, and we must never fall back to any other
  // claim to guess one.
  const raw = decoded.phone_number;
  if (!raw) {
    throw new Error('Firebase token carries no phone number (wrong sign-in provider)');
  }

  // Firebase returns E.164 ("+919876543210"). Run it through OUR validator rather
  // than trusting the format: this rejects non-Indian numbers (the MSG91 path
  // rejects them too, and the User.phone column stores 10 digits) and produces
  // the exact canonical form the rest of the app expects.
  const phone = normalizeIndianMobile(raw);
  if (!phone) {
    throw new Error(`Firebase token phone number is not a valid Indian mobile: ${raw}`);
  }

  return { phone, firebaseUid: decoded.uid };
}

/**
 * Whether the Firebase login route should accept requests at all.
 * Both the feature flag AND a complete service account are required — a flag
 * flipped on against an unconfigured server should 503 loudly, not half-work.
 */
export function isFirebaseAuthEnabled() {
  return Boolean(
    ENV.FIREBASE_AUTH_ENABLED &&
    ENV.FIREBASE_PROJECT_ID &&
    ENV.FIREBASE_CLIENT_EMAIL &&
    ENV.FIREBASE_PRIVATE_KEY
  );
}
