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
    initError.serverFault = true;
    throw initError;
  }

  // firebase-admin honours FIREBASE_AUTH_EMULATOR_HOST by switching verifyIdToken
  // to the emulator verifier, which accepts alg:'none' — i.e. ANY unsigned JWT
  // naming any phone number. aud/iss are still checked but both are public
  // strings, so one stray env var turns this into a total auth bypass. Refuse to
  // start outside dev, mirroring how config/env.js hard-forces the OTP dev bypass
  // off in production.
  if (!ENV.IS_DEV && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    initError = new Error('FIREBASE_AUTH_EMULATOR_HOST is set outside development — refusing to verify tokens');
    initError.serverFault = true;
    logger.error('[FirebaseAuth] %s', initError.message);
    throw initError;
  }

  try {
    // Dynamic import — keeps firebase-admin out of the boot path entirely when
    // the feature is off, and out of the dependency graph of every test that
    // doesn't touch this file.
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');

    // Use a NAMED app, not getApps()[0]. The project id is the only thing binding
    // an incoming token to us — verifyIdToken requires payload.aud === projectId —
    // so grabbing whatever app happens to be first would silently verify tokens
    // against someone else's project if anything else in the process ever
    // initialises firebase-admin. Looking the app up by our own name keeps this
    // double-init-safe without that risk.
    const APP_NAME = 'krushisarva-auth';
    const existing = getApps().find((a) => a.name === APP_NAME);
    const app = existing
      || initializeApp({
          credential: cert({
            projectId:   ENV.FIREBASE_PROJECT_ID,
            clientEmail: ENV.FIREBASE_CLIENT_EMAIL,
            // Railway/dotenv store the PEM with literal "\n" sequences; the SDK
            // needs real newlines or the signature check fails with an opaque error.
            privateKey:  ENV.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
          projectId: ENV.FIREBASE_PROJECT_ID,
        }, APP_NAME);

    adminApp = getAuth(app);
    logger.info('[FirebaseAuth] initialised for project %s', ENV.FIREBASE_PROJECT_ID);
    return adminApp;
  } catch (err) {
    // DO NOT cache this one. A malformed service account will not fix itself, but
    // the same catch also sees transient faults — a DNS blip or a slow network
    // while the SDK fetches Google's public keys. Caching those wedged the whole
    // login path until someone restarted the process, turning a two-second outage
    // into an indefinite one. The permanent misconfigurations (missing creds,
    // emulator host) are already cached above, where they are provably permanent.
    const wrapped = new Error(`Firebase auth init failed: ${err.message}`);
    wrapped.serverFault = true;
    logger.error({ err }, '[FirebaseAuth] init failed');
    throw wrapped;
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

  // phone_number is an attribute of the Firebase USER RECORD, not of the sign-in
  // event — it is stamped into every ID token minted for that user, whatever
  // provider produced it. So its presence does NOT prove SMS possession. Assert
  // the provider explicitly, or the security of this login becomes the security
  // of every provider ever enabled in the Firebase project. 'custom' is rejected
  // by the same check: a custom token is minted by whoever holds a service
  // account, which is not possession of the handset.
  const provider = decoded.firebase && decoded.firebase.sign_in_provider;
  if (provider !== 'phone') {
    throw new Error(`Firebase token was not issued by the phone provider (got: ${provider || 'unknown'})`);
  }

  const raw = decoded.phone_number;
  if (!raw) {
    throw new Error('Firebase token carries no phone number');
  }

  // GATE ON +91 BEFORE NORMALIZING — do not remove.
  //
  // normalizeIndianMobile() was written for numbers WE chose (the MSG91 path only
  // ever hands it an Indian number it is about to SMS as `91${phone}`). This is the
  // first caller that feeds it an E.164 string the CALLER controls, and it is not
  // safe for that: its foreign-number guard is `if (parsed.country && parsed.country
  // !== 'IN')`, which is skipped entirely when libphonenumber returns no country —
  // exactly what happens for non-geographic ranges. Verified: '+8816123456789'
  // (satellite) normalizes to '6123456789', a perfectly valid Indian mobile. An
  // attacker holding such a number could take over the account owning those digits.
  // A digit-stripping fallback inside phone.js widens this further.
  //
  // The gate is what makes the rest safe: after it, the string genuinely is an
  // Indian E.164 and normalizeIndianMobile is being used as designed.
  if (!/^\+91\d{10}$/.test(raw)) {
    throw new Error('Firebase token phone number is not an Indian mobile');
  }

  // Now canonicalise to the 10-digit national form the User.phone column stores —
  // the same shape verify-otp produces, so downstream code cannot tell the paths apart.
  const phone = normalizeIndianMobile(raw);
  if (!phone) {
    // Reachable for a +91-prefixed number in an unallocated series.
    throw new Error('Firebase token phone number is not a valid Indian mobile');
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
