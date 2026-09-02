# Firebase Phone Auth — interim login while DLT is pending

## Why this exists

SMS to Indian numbers requires the sender to be registered on the telecom operators'
**DLT** platform (TRAI TCCCPR 2018). Until KrushiSarva's own DLT registration is
approved, **MSG91 cannot deliver a single OTP** — the API returns `success`, the
operator silently drops the message, and the farmer sees "OTP sent" and receives
nothing.

Firebase Phone Auth works today because **Google** is the DLT-registered sender.

This is a **parallel path, not a migration**. `otp.service.js` is untouched. When DLT
approval lands, set `FIREBASE_AUTH_ENABLED=false` and the MSG91 flow is exactly as
it was.

| | MSG91 path | Firebase path |
|---|---|---|
| Who generates the OTP | We do (`crypto.randomInt`) | Google |
| Who sends the SMS | MSG91 (needs DLT) | Google (already DLT-registered) |
| Who verifies the code | We do (bcrypt vs `OtpSession`) | Google |
| What our server checks | the 6-digit code | a Google-signed ID token |
| Endpoint | `POST /auth/verify-otp` | `POST /auth/firebase-login` |
| Brute-force lockout | `otpLockout.service.js` | Firebase's own abuse limits |

## What you give up

`otpLockout.service.js` and the OTP send/verify rate limiters **do not apply** to the
Firebase path — Google owns the code, so it owns the abuse protection. The new route
keeps an IP limiter on token verification, but that is not the same control.

This is the deliberate trade for shipping before DLT approval. Reverting is a
one-line env change.

---

## Setup

### 1. Firebase console (only you can do this)

1. Create a project at <https://console.firebase.google.com>
2. **Authentication → Sign-in method → Phone → Enable**
3. **Project settings → Your apps → Add app → Android**
   - Package name must match `android.package` in `frontend/app.json`
   - Add your **SHA-1 and SHA-256** fingerprints (debug *and* the EAS release keystore —
     phone auth fails with `auth/missing-client-identifier` without them)
   - Download `google-services.json` → save to `frontend/google-services.json`
4. **Project settings → Service accounts → Generate new private key** → downloads a JSON file

Get the EAS release fingerprints with:

```bash
cd frontend && npx eas credentials
```

### 2. Backend env

From the service-account JSON, copy three fields into `backend/.env`:

```
FIREBASE_AUTH_ENABLED=true
FIREBASE_PROJECT_ID=<project_id>
FIREBASE_CLIENT_EMAIL=<client_email>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Keep the literal `\n` sequences and the surrounding quotes — the service converts them
to real newlines. Restart the backend.

### 3. app.json — one line, after `google-services.json` exists

`npx expo install` already appended `@react-native-firebase/app` and
`@react-native-firebase/auth` to the `plugins` array. `expo config --type prebuild`
resolves cleanly with them, so your current build is not broken.

One line still missing — add it once step 1 has produced the file:

```jsonc
// frontend/app.json → expo.android
"android": {
  "package": "com.cropsetu.app",
  "googleServicesFile": "./google-services.json"   // add this line
}
```

Your Android package is `com.cropsetu.app` — the Firebase console app must use
**exactly** that string or phone auth fails at runtime.

Without `google-services.json` the Gradle build fails at the google-services step,
not at prebuild — so do step 1 first.

iOS additionally needs `GoogleService-Info.plist`, `ios.googleServicesFile`, and
`expo-build-properties` with `useFrameworks: "static"`. Skip it unless you ship iOS.

### 4. App env + rebuild

`frontend/.env`:

```
EXPO_PUBLIC_FIREBASE_AUTH=true
```

Then rebuild the dev client. **This will not work in Expo Go** — `@react-native-firebase/auth`
is a native module:

```bash
cd frontend
npx expo prebuild --clean
npx expo run:android
```

### 5. Test

Enter a real Indian mobile on the login screen. A real SMS should arrive within seconds.

To test without burning SMS quota, add a test number under
**Firebase console → Authentication → Sign-in method → Phone → Test phone numbers**.
Those pairs verify without sending anything.

---

## Files

| File | Change |
|---|---|
| `backend/src/services/firebaseAuth.service.js` | **new** — ID-token verification, lazy admin SDK init |
| `backend/src/services/authSession.service.js` | **new** — session issuance + fraud stack for a proven phone |
| `backend/src/routes/auth.routes.js` | **added** `POST /firebase-login` (existing routes untouched) |
| `backend/src/middleware/csrf.js` | `/auth/firebase-login` added to `PRE_AUTH_PATHS` |
| `backend/src/config/env.js` | `FIREBASE_*` keys (additive) |
| `shared/services/firebasePhoneAuth.js` | **new** — client wrapper, lazy native require |
| `shared/context/AuthContext.js` | `sendOtp`/`verifyOtp` branch on the flag; Firebase sign-out on logout |
| `shared/constants/config.js` | `FIREBASE_AUTH_ENABLED` flag |
| `backend/tests/backend/unit/firebaseAuth.test.js` | **new** — 9 tests |

`shared/screens/LoginScreen.js` needed **no changes** — the branch lives in
`AuthContext`, so the UI, resend timer and error handling are identical on both paths.

## Known duplication

`authSession.service.js` is a faithful copy of the post-verification block still
inlined in `/verify-otp`. It was not extracted because the MSG91 login path was
required to stay byte-for-byte unchanged. **A security fix applied to one must be
applied to the other.** Collapse them once the Firebase path has proven itself:
point `/verify-otp` at `issueSessionForVerifiedPhone()` and delete its inline copy.

## Not done

- `seller-app/` does not have the native module installed. The lazy require means it
  is safe as long as `EXPO_PUBLIC_FIREBASE_AUTH` stays unset there; installing it is
  the same two commands if seller login needs the Firebase path too.
- The `devOtp` leak in `otp.service.js` (returned whenever `MSG91_AUTH_KEY` is empty,
  including under `NODE_ENV=production`) is **unchanged** — out of scope here, but it
  must be gated before any public deploy.
