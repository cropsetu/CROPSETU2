/**
 * Firebase Phone Auth — thin client wrapper.
 *
 * WHY THIS EXISTS: SMS to Indian numbers needs a DLT-registered sender, so MSG91
 * cannot deliver an OTP until KrushiSarva's DLT registration is approved.
 * Firebase works today because Google is the registered sender.
 *
 * WHAT IT IS NOT: a replacement for the MSG91 flow. AuthContext keeps both and
 * picks one via FIREBASE_AUTH_ENABLED. The backend keeps both routes.
 *
 * API NOTE — @react-native-firebase v26 is MODULAR ONLY. There is no default
 * export and no `auth()` namespace helper any more; the old
 * `auth().signInWithPhoneNumber(...)` style throws "auth is not a function".
 * Everything below uses the named modular functions:
 *   getAuth(), signInWithPhoneNumber(auth, n), signOut(auth), getIdToken(user)
 *
 * NATIVE MODULE: this is a native dependency. It does NOT exist in Expo Go — the
 * app needs a dev-client / EAS build with google-services.json (Android) and
 * GoogleService-Info.plist (iOS). Everything here is behind a lazy require so a
 * build WITHOUT the module still runs: the import never executes unless the
 * feature flag is on, and a failure surfaces a clear message rather than a red
 * screen at startup.
 */

let mod = null;
let loadError = null;

/**
 * Lazily load the native module. Kept out of this file's import graph so the
 * bundle still resolves when Firebase isn't installed in a given build.
 */
function fb() {
  if (mod) return mod;
  if (loadError) throw loadError;
  try {
    // eslint-disable-next-line global-require
    const m = require('@react-native-firebase/auth');
    if (typeof m.getAuth !== 'function') {
      throw new Error('unexpected module shape — getAuth missing');
    }
    mod = m;
    return mod;
  } catch (err) {
    loadError = new Error(
      'Firebase Phone Auth is not available in this build. It needs a dev-client ' +
      `or EAS build with @react-native-firebase/auth (${err.message}).`
    );
    throw loadError;
  }
}

/**
 * Send an OTP via Firebase.
 *
 * @param {string} phone 10-digit Indian mobile (as the login screen collects it)
 * @returns {Promise<object>} the Firebase confirmation handle — pass it to
 *   confirmFirebaseOtp(). Holds the verificationId; there is no way to re-derive
 *   it, so losing it means the user must request a new code.
 */
export async function sendFirebaseOtp(phone) {
  const { getAuth, signInWithPhoneNumber } = fb();
  // Firebase requires E.164. The rest of the app stores/handles the 10-digit
  // national form, and the backend re-normalizes whatever comes back, so +91 is
  // added only at this boundary.
  return signInWithPhoneNumber(getAuth(), `+91${phone}`);
}

/**
 * Confirm the code the user typed and return a Firebase ID token.
 *
 * The token — not the OTP — is what the backend verifies. It is a Google-signed
 * JWT proving control of the phone number; the 6-digit code never leaves the
 * device/Google round trip.
 *
 * @param {object} confirmation handle from sendFirebaseOtp()
 * @param {string} code 6-digit OTP the user entered
 * @returns {Promise<string>} Firebase ID token
 */
export async function confirmFirebaseOtp(confirmation, code) {
  if (!confirmation) {
    throw new Error('No verification in progress. Please request a new code.');
  }
  const credential = await confirmation.confirm(code);
  const user = credential?.user;
  if (!user) throw new Error('Firebase returned no user for that code.');

  // User.getIdToken() still exists as an instance method in v26; getIdToken(user)
  // is the modular equivalent. Prefer the method, fall back to the function.
  const idToken = typeof user.getIdToken === 'function'
    ? await user.getIdToken()
    : await fb().getIdToken(user);

  if (!idToken) throw new Error('Firebase did not return an ID token.');
  return idToken;
}

/**
 * Sign the user out of Firebase.
 *
 * Called on app logout. The Firebase session is separate from ours and serves no
 * purpose once we hold our own tokens — leaving it signed in would let a later
 * getIdToken() mint a fresh proof for an account the user just left.
 * Best-effort: never throws, because failing to clear Firebase must not block
 * clearing OUR session, which is the one that actually grants access.
 */
export async function signOutFirebase() {
  try {
    const { getAuth, signOut } = fb();
    const auth = getAuth();
    if (auth.currentUser) await signOut(auth);
  } catch {
    /* module absent or already signed out — nothing to clean up */
  }
}

/**
 * Turn a Firebase error into something a farmer can act on.
 * Firebase codes are stable strings; the raw messages are developer-facing.
 */
export function firebaseErrorMessage(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'That phone number is not valid.';
    case 'auth/invalid-verification-code':
      return 'Invalid or expired code.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'That code has expired. Please request a new one.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'auth/quota-exceeded':
      return 'SMS is temporarily unavailable. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and try again.';
    case 'auth/missing-client-identifier':
      // Almost always a console misconfiguration (missing SHA-1 / Play Integrity).
      return 'Phone sign-in is not configured for this app build.';
    case 'auth/app-not-authorized':
      // SHA-1 in the build does not match any fingerprint registered in Firebase.
      return 'This app build is not authorised for phone sign-in.';
    default:
      return err?.message || 'Could not verify your phone number. Please try again.';
  }
}
