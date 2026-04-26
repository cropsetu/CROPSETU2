# Production-Readiness Review — Cropsetu Mobile App (React Native)

Scope: `Cropsetu/frontend/` only — Expo SDK 54 + React Native 0.81
+ React 19, JavaScript, Hermes default. The shared review at
[shared.md](shared.md) covers cross-cutting concerns; the two
backends are reviewed in [backend-express.md](backend-express.md)
and [fastapi.md](fastapi.md). The master prompt's web-frontend
section (CSRF, CSP, `dangerouslySetInnerHTML`, localStorage) is
mostly inapplicable to RN and has been replaced here with mobile-
specific concerns.

## Verdict

**DO NOT SHIP.** The single most important reason: there is no
top-level `ErrorBoundary` in `App.js`. Any uncaught render error
in any of the ~100 screens white-screens the entire app — the
user sees a black or blank screen until they kill and reopen the
app. Combined with no global crash reporting (Sentry RN is not
wired), every production crash is invisible to you and
irrecoverable to the user.

## Top 5 risks at 100 concurrent users

1. **Single render bug white-screens 100 % of users.** No
   ErrorBoundary at `App.js:65`. The one that exists is scoped
   only to the onboarding navigator
   (`src/navigation/OnboardingNavigator.js:17`).
2. **Production OTP can be auto-filled from a server response.**
   `src/screens/Auth/LoginScreen.js:43-44` reads `result?.data?.devOtp`
   with no `__DEV__` guard. If the backend's `MSG91_AUTH_KEY`
   ever becomes empty in production (the backend deliberately
   returns `devOtp` in that branch — `otp.service.js:43-46`),
   the production app accepts the OTP without an SMS being sent.
3. **No request cancellation on screen unmount.** The axios
   instance at `src/services/api.js:49` does not propagate
   `AbortController` signals from screens. A user who taps
   "back" while a 120-second AI scan is in flight leaves the
   request alive; the response handler then attempts to
   `setState` on an unmounted component.
4. **OTA updates are not code-signed.** `app.json` has no
   `updates.codeSigning` block; `eas.json` has channels but no
   signing keys. Anyone with EAS account credentials can push a
   malicious JS bundle to every production install.
5. **No global crash reporting.** `App.js:1-85` does not import
   Sentry / Bugsnag / @sentry/react-native, and there is no
   `expo-error-recovery` handler. A bug that escapes the (absent)
   error boundary is invisible to you in production.

---

## Findings

### 🔴 BLOCKERS — must fix before any production traffic

**[M-01] No ErrorBoundary at the app root** —
`Cropsetu/frontend/App.js:65-84`

- Problem: the provider tree wraps `<RootNavigator />` directly:

```jsx
return (
  <SafeAreaProvider>
    <LanguageProvider>
      <AuthProvider>
        <FarmProvider>
          <MultiFarmProvider>
            <LocationProvider>
              <LocationSync />
              <StatusBar style="light" />
              <RootNavigator />              {/* ← any thrown error here white-screens the app */}
            </LocationProvider>
          ...
```

The only ErrorBoundary in the codebase is at
`src/navigation/OnboardingNavigator.js:17`, which catches errors
inside the onboarding flow only. Any other screen — login, home,
chat, scan, market — propagates render errors up to the React
root, and React unmounts the entire tree.
- Impact at 100 users: a single bug merged on Friday white-
  screens everybody until you can ship a fix. There is no in-app
  recovery path: even "force close and reopen" hits the same
  bug if it's in initialization (e.g., a corrupt SecureStore
  value).
- Fix: a top-level boundary that re-renders into a fallback and
  ships the error to your tracker.

```jsx
// new file: src/components/RootErrorBoundary.js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
// import * as Sentry from '@sentry/react-native';   // see [M-06]

export default class RootErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    // Sentry.captureException(error, { extra: { stack: info.componentStack } });
    console.error('[RootErrorBoundary]', error, info.componentStack);
  }
  reload = async () => {
    try { await Updates.reloadAsync(); }
    catch { /* dev: just clear state */ this.setState({ error: null }); }
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={s.root}>
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.body}>The app hit an unexpected error. Please reload.</Text>
        <TouchableOpacity style={s.btn} onPress={this.reload}>
          <Text style={s.btnTxt}>Reload</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
const s = StyleSheet.create({
  root:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#1B4332' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  body:  { fontSize: 14, color: '#cfe7d8', marginBottom: 24, textAlign: 'center' },
  btn:   { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  btnTxt:{ color: '#1B4332', fontWeight: '700' },
});
```

```jsx
// App.js
import RootErrorBoundary from './src/components/RootErrorBoundary';
return (
  <RootErrorBoundary>
    <SafeAreaProvider>
      ...
    </SafeAreaProvider>
  </RootErrorBoundary>
);
```

`Updates.reloadAsync()` reloads the JS bundle without
re-installing the native shell — a clean recovery on most bugs.

---

**[M-02] Production OTP can be auto-filled from server response** —
`Cropsetu/frontend/src/screens/Auth/LoginScreen.js:42-44`,
`Cropsetu/backend/src/services/otp.service.js:37-46`

- Problem:

```js
// LoginScreen.js:42-44
const devOtp = result?.data?.devOtp ?? result?.devOtp;
if (devOtp) setOtp(devOtp);
```

Pairs with the backend at `otp.service.js`:

```js
// backend — sendOtp()
if (ENV.MSG91_AUTH_KEY) {
  await sendViaMSG91(phone, otp);
  return { sessionId: session.id };
}
console.log(`[OTP DEV] Phone: ${phone} | OTP: ${otp}`);
return { sessionId: session.id, devOtp: otp };   // ← returned to client
```

If `MSG91_AUTH_KEY` is unset on Railway (a configuration drop, an
admin who forgot to copy it, a temporary outage during which
someone "unset" it), the production app receives the OTP in the
HTTP response and auto-fills it. The phone never receives an SMS,
so anyone with a phone number can log in as that user — phone
ownership is no longer verified.
- Impact at 100 users: account takeover at scale, gated only by
  the existence of one env var on the prod deployment.
- Fix: defence in depth — gate the auto-fill on `__DEV__` in
  the client, and gate the dev-mode response on `NODE_ENV !==
  'production'` in the server.

```js
// LoginScreen.js — never trust devOtp in a production build
if (__DEV__ && devOtp) setOtp(devOtp);
```

```js
// otp.service.js:37 — also fix on the server side
if (ENV.MSG91_AUTH_KEY) {
  await sendViaMSG91(phone, otp);
  return { sessionId: session.id };
}
if (!ENV.IS_DEV) {
  // Refuse to issue an OTP we can't deliver in prod
  throw new Error('OTP service not configured');
}
console.log(`[OTP DEV] ...`);
return { sessionId: session.id, devOtp: otp };
```

This is a backend finding too; record it in
`backend-express.md` as part of a follow-up pass.

---

**[M-03] No request cancellation on screen unmount** —
`Cropsetu/frontend/src/services/api.js:49-83` (axios setup)

- Problem: the global axios instance has no AbortController
  plumbing exposed to screens. The handful of `AbortController`
  references in the workspace (`src/routes/*`, `src/services/weatherApi.js`)
  belong to the orphaned backend files duplicated inside the
  frontend repo (see [M-10]); they are dead code in this app.

  Real screens (e.g., `src/screens/AI/DiagnosisResultScreen.js`,
  any list screen) call `await api.get(...)` and let it run until
  it returns or times out at 120 s (`api.js:51`). If the user
  navigates away in the meantime:
  1. The promise resolves into a setState on an unmounted
     component (RN logs "Can't perform a React state update on
     an unmounted component" in dev; in prod, leaks state).
  2. A retry interceptor for 401 (api.js:94-148) may issue a
     refresh after the user has logged out from another tab.
- Impact at 100 users: memory leaks accumulate, perceived UI lag
  ("the back button is stuck"), spurious 401-refresh loops.
- Fix: expose `signal` on the wrapper and offer a hook that
  cancels on unmount.

```js
// src/hooks/useAbortable.js
import { useEffect, useRef } from 'react';

export function useAbortable() {
  const ctrl = useRef(null);
  useEffect(() => {
    ctrl.current = new AbortController();
    return () => ctrl.current?.abort();
  }, []);
  return () => ctrl.current?.signal;
}

// In a screen:
const getSignal = useAbortable();
useEffect(() => {
  api.get('/users/me', { signal: getSignal() })
     .then(({ data }) => setUser(data.data))
     .catch((e) => { if (e.name !== 'CanceledError') setError(e); });
}, []);
```

Axios 1.x respects `AbortSignal` natively (`signal` config
field). For long-running scans, also reduce the global timeout
(see [M-05]) and let `signal` handle the cancel path.

---

### 🟠 HIGH — fix within first week

**[M-04] OTA updates are not code-signed** —
`Cropsetu/frontend/app.json` (no `updates.codeSigning`),
`Cropsetu/frontend/eas.json` (no `codeSigning`)

- Problem: `expo-updates` is in `package.json:37`, channels are
  defined in `eas.json` for development / preview / production,
  but neither file configures code-signing. Per Expo's docs,
  code-signing is opt-in; without it, EAS Update accepts any
  bundle pushed by anyone with EAS account credentials.

  Threat model: leaked EAS token in a CI log, social-engineered
  team member, or a stolen laptop. The attacker pushes a
  bundle that exfiltrates SecureStore tokens via a hidden
  network call. Every install on the channel pulls the new
  bundle on next launch — silently.
- Fix:

```bash
# Generate a key pair, register the public half with EAS:
npx expo-updates codesigning:configure
# This writes the cert into app.json under expo.updates.codeSigning.
# Commit only the public certificate; keep the private key in EAS_SECRETS.
```

After this, EAS Update will sign every bundle with the private
key during `eas update`, and the running app refuses any bundle
that does not verify against the embedded public cert. A leaked
EAS token is no longer enough on its own — the attacker also
needs the signing key.

---

**[M-05] 120 s axios timeout holds the UI on every hung request** —
`Cropsetu/frontend/src/services/api.js:51`

- Problem: `timeout: 120000` was raised from the 15-second
  default to accommodate AI scan calls. But the same instance is
  used for every API call — `/users/me`, `/onboarding/complete`,
  `/agristore/*`. A backend hiccup means the user spinner shows
  for 2 minutes on a chat refresh.
- Fix: split into a default fast instance and a long-running
  instance.

```js
// api.js
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,        // default: snappy
  ...
});

const aiApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120_000,       // AI scan only
  ...
});
// share interceptors
[ api, aiApi ].forEach(inst => {
  inst.interceptors.request.use(...);
  inst.interceptors.response.use(...);
});

export default api;
export { aiApi };
```

Then in scan screens:

```js
import { aiApi } from '../../services/api';
const { data } = await aiApi.post('/ai/scan', formData, { signal: getSignal() });
```

---

**[M-06] No global crash reporting** —
`Cropsetu/frontend/App.js`, no Sentry / Bugsnag / Crashlytics
imports anywhere in `src/`

- Problem: `grep -rn 'Sentry\|@sentry\|Bugsnag\|crashlytics'`
  returns nothing. A production crash is invisible to you. The
  ErrorBoundary fix in [M-01] needs somewhere to send the
  exceptions.
- Fix:

```bash
npm i @sentry/react-native
npx @sentry/wizard@latest -i reactNative
# This adds setup to App.js, eas.json, and creates a sentry.properties file.
```

Then in `App.js` (top of file, before any other import):

```js
import * as Sentry from '@sentry/react-native';
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !__DEV__,                                  // dev errors stay local
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Strip PII — phone, OTP, tokens
    const v = JSON.stringify(event);
    if (/Authorization|otp|phone/i.test(v)) {
      // mask matched values (sample logic — tighten per your fields)
    }
    return event;
  },
});

export default Sentry.wrap(App);                      // wrap default export
```

Wire `Sentry.captureException` into `RootErrorBoundary.componentDidCatch`
and into the axios response interceptor for non-401, non-429
failures.

---

**[M-07] Refresh interceptor still sends `userId`** —
`Cropsetu/frontend/src/services/api.js:115-129`

- Problem:

```js
const [refreshToken, userId] = await Promise.all([
  getRefreshToken(),
  getUserId(),
]);
if (!refreshToken || !userId) throw new Error('No refresh token');
const { data } = await axios.post(
  `${API_BASE_URL}/auth/refresh`,
  { userId, refreshToken },
);
```

Mirrors the broken backend contract at
`backend/src/routes/auth.routes.js:115-118`. After
[backend-express.md E-04, E-11] are fixed (refresh by hashed
token alone, no userId in body), this client must drop the
`userId` field — leaving it triggers a Pydantic / express-
validator error against the new contract.
- Fix: bundle this with the backend rotation rewrite. Plan a
  paired deploy. Until then, leave as-is.

---

**[M-08] `safeErrorMessage` is defined but never enforced** —
`Cropsetu/frontend/src/services/api.js:35-46`

- Problem: a helpful sanitizer exists but every screen that I
  read accesses `err.response?.data?.error?.message` directly
  (e.g., `LoginScreen.js:46, 67`). Any backend changes that leak
  raw error strings — and right now both backends do, see
  [F-02] and the lack of [E-20] in Express — surface verbatim to
  the end user.
- Fix: install the helper as the response-interceptor's reject
  side, returning a normalized error.

```js
// api.js
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    err.userMessage = safeErrorMessage(err);
    return Promise.reject(err);
  }
);

// in screens:
} catch (err) {
  Alert.alert(t('login.error'), err.userMessage);
}
```

This way, even if a backend regresses, the user sees a localised
generic message rather than a SQL trace.

---

**[M-09] Android permissions declared, never requested at first
use** — `Cropsetu/frontend/app.json:30-39`

- Problem:

```json
"permissions": [
  "CAMERA",
  "READ_MEDIA_IMAGES",
  "ACCESS_FINE_LOCATION",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION"
]
```

Listed permissions appear in the Play Store listing as required.
Users who only want to use the chat feature still see "this app
wants your camera, microphone, location" before installing.
Conversion drops; reviewers reject.

Android 13+ also requires runtime requests (`Permissions.request*`
or `expo-camera.requestCameraPermissionsAsync()`) for dangerous
permissions. The declarations alone do not grant them.
- Fix: keep the declarations (Android needs them in the manifest)
  but ensure each feature requests at first use:

```js
// before opening camera in scan/voice flows:
import { useCameraPermissions } from 'expo-camera';
const [permission, requestPermission] = useCameraPermissions();
if (!permission?.granted) await requestPermission();
```

Same for `expo-location`, `expo-image-picker`, `expo-av` (audio).
Drop `READ_MEDIA_IMAGES` if image-picker handles it; drop
`ACCESS_COARSE_LOCATION` if you only need fine.

The duplicate `CAMERA` / `android.permission.CAMERA` (lines 32
and 35) is also a bug — pick one.

---

### 🟡 MEDIUM — fix within first month

**[M-10] Backend code duplicated inside `frontend/src/`** —
`Cropsetu/frontend/src/app.js`, `server.js`, `routes/`,
`middleware/`, plus several backend-style services

- Problem: `frontend/src/` contains `app.js` (10 KB), `server.js`
  (9 KB), `routes/` (entire express router tree),
  `middleware/auth.js`, `middleware/validate.js`, and backend
  service files like `services/sarvam.service.js` that
  `import { ENV } from '../config/env.js'` — a Node-only env
  loader. None of this code runs in the React Native bundle (it
  would crash on import), but it's tracked by git and pulled by
  Metro during dev. Slow file-watching, IDE confusion, accidental
  edits of the wrong file.
- Fix: delete after confirming no RN file imports any of them.
  Same dead-code situation as the leftover RN files inside
  `backend/` — see [shared.md].

```bash
cd frontend
git rm -r src/app.js src/server.js src/routes/ src/middleware/ \
         src/services/sarvam.service.js \
         src/services/api.js  # NO — keep this; it's the RN client
# Inspect each src/services/* file: keep RN-relevant ones, drop the rest.
git commit -m "chore: remove backend code accidentally tracked in frontend repo"
```

**Caveat**: be sure `src/services/api.js` (the RN axios client) is
preserved. The other services need a per-file decision —
`ai.predict.service.js`, `weather.advisory.service.js` etc. may
also be backend-only.

---

**[M-11] `console.log/warn/error` in service / screen paths** —
multiple

- Problem: `grep -cE 'console\.(log|warn|error)' src/services/`
  found at least 7 services with 1-11 calls each (`aiApi.js: 7`,
  `ai.chat.service.js: 11`, `ai.predict.service.js: 3`, plus
  several screens with 1 each in Seller/). Metro forwards these
  to the device's debug log, which is visible to:
  - Anyone with a USB cable + ADB on Android.
  - Frida / objection on a jailbroken iOS device.
  - Sentry breadcrumbs (if/when you wire it).
- Fix: replace with a wrapped `logger.js` that no-ops in
  production and breadcrumbs to Sentry in non-error paths.

```js
// src/utils/logger.js
const isDev = __DEV__;
export const logger = {
  debug: (...a) => { if (isDev) console.log(...a); },
  warn:  (...a) => { if (isDev) console.warn(...a); /* Sentry.addBreadcrumb */ },
  error: (...a) => {
    if (isDev) console.error(...a);
    // Sentry.captureMessage(a.map(String).join(' '), 'error');
  },
};
```

Then a global codemod (`grep -rl 'console.log' src/ | xargs sed -i ...`)
to swap. Tighten `console.log` to `logger.debug` and let it
disappear from production bundles via Hermes dead-code elim
(`if (__DEV__)` is constant-folded).

---

**[M-12] 14 separate API service files vs. one centralized
client** — `Cropsetu/frontend/src/services/`

- Problem: a single `api.js` exists with the auth interceptors
  and refresh logic, but `aiApi.js`, `farmApi.js`, `weatherApi.js`
  are separate axios instances or `fetch`-based wrappers that
  almost certainly bypass the auth interceptor and the safe-error
  helper. (I did not read all 14 files; this is from the
  directory listing and the import patterns I saw.)
- Fix: collapse to one axios instance plus a long-running
  variant per [M-05]. Every API call must go through one of
  the two; nothing else.

---

**[M-13] No certificate pinning** —
`Cropsetu/frontend/src/services/api.js`

- Problem: the app talks to
  `https://cropsetu-backend-production.up.railway.app` over
  default RN networking — Apple ATS / Android NSC enforce TLS
  but trust the device's installed CA store. A user with a
  compromised device or a corporate MITM proxy can read traffic.
  For an agriculture app this is acceptable; once the app
  handles bank-account / payment flows (the Razorpay support is
  scaffolded — see backend `.env.example:88-91`), pinning is
  required for PCI-DSS-adjacent compliance.
- Fix: add `react-native-ssl-pinning` (Expo dev client
  required) once payment flows are live. Pin the leaf cert's
  SPKI hash (rotate every certificate renewal).

---

**[M-14] Bundle ID is `com.farmeasy.app` despite branding to
CropSetu** — `Cropsetu/frontend/app.json:18, 30`

- Problem: changing the bundle ID after Play Store / App Store
  publication is impossible — you have to publish a new app.
  Better to fix this before first publication.
- Fix: change to `com.cropsetu.app` (or whatever the canonical
  domain is), bump `version` to clear cached metadata, and
  re-build EAS production builds from scratch.

```json
"ios":     { "bundleIdentifier": "com.cropsetu.app", ... },
"android": { "package":          "com.cropsetu.app", ... }
```

---

### 🟢 LOW — technical debt

**[L-01] `isTokenStale` defined but never called** —
`Cropsetu/frontend/src/utils/storage.js:40-44`

- Stale-token detection happens reactively via the 401 +
  refresh interceptor in `api.js:94-148`. The helper was
  presumably planned for a proactive check on app foreground;
  either wire it up or delete.

**[L-02] `__DEV__` API base URL hardcoded for LAN IP** —
`src/constants/config.js:13` (`DEV_LAN_IP = '192.168.1.2'`)

- Forces every developer to either share that IP or edit the
  file. Move to `EXPO_PUBLIC_API_BASE_URL` env in `eas.json`'s
  `development` profile.

**[L-03] `processQueue` mutates a module-level array** —
`api.js:87`

- Fine on RN's single-threaded JS, but the variable could be
  scoped inside a closure to make the contract explicit.

**[L-04] AsyncStorage used for non-sensitive farm context** —
`src/context/FarmContext.js`, `src/context/MultiFarmContext.js`,
`src/services/weatherApi.js`, `src/screens/Weather/WeatherHome.js`,
`src/screens/AnimalTrade/VerificationModal.js`

- Acceptable: these store cached read-only data, not credentials.
  Document this rule explicitly in the storage util so future
  contributors don't store tokens here by mistake.

---

## Dead code & redundancy to delete

- `frontend/src/app.js`, `frontend/src/server.js`,
  `frontend/src/routes/`, `frontend/src/middleware/auth.js`,
  `frontend/src/middleware/validate.js`, and several backend-
  flavoured services in `frontend/src/services/` (the ones that
  `import ... from '../config/env.js'`). See [M-10].
- `frontend/prisma/` — Prisma is a backend ORM; the schema and
  seed files have no place in a React Native app. Delete after
  confirming `diff -r backend/prisma frontend/prisma` shows
  they are duplicates.
- `frontend/AI_CROP_DISESE_DETECTION/` (currently `D` in
  `git status`) — finalise the deletion only after
  [shared.md S-01] is resolved.
- `frontend/src/utils/storage.js:40` `isTokenStale` if not
  wired up.

## Currently missing entirely (must add)

- [ ] `RootErrorBoundary` in `App.js` (per [M-01]).
- [ ] `__DEV__` guard on dev-OTP auto-fill (per [M-02]).
- [ ] `useAbortable` hook + `signal` on every API call
      (per [M-03]).
- [ ] `expo-updates` code-signing configured (per [M-04]).
- [ ] Sentry React Native (per [M-06]).
- [ ] `aiApi` (long-timeout) split from `api` (15-s timeout)
      (per [M-05]).
- [ ] `safeErrorMessage` enforced via response interceptor
      (per [M-08]).
- [ ] Runtime permission requests at first use (per [M-09]).
- [ ] `logger` wrapper replacing `console.*`
      (per [M-11]).
- [ ] Bundle ID renamed to `com.cropsetu.app`
      (per [M-14]).
- [ ] An offline / poor-network UX state — when `/readyz`
      starts returning 503 (post-fix backend), surface a
      "Service unavailable" banner instead of the existing
      "Server error" alert.

## Mobile-specific concerns the master prompt did not enumerate

- **Hermes**: enabled by default in RN 0.81. Confirm with
  `npx react-native config | grep hermes`.
- **New Architecture**: `app.json:7 newArchEnabled: true`.
  Reanimated v4 + worklets require it; verify after every
  reanimated upgrade.
- **Storage location**: `expo-secure-store` keys are wiped on
  app uninstall on iOS (Keychain rules) and on Android (when
  the user clears app data). Document this so support knows
  the user must re-login.
- **Background**: the daily / monthly cron logic lives on the
  server (Express). The mobile app never runs background tasks
  — confirm there is no plan to add `expo-background-fetch`
  before pre-launch, since that introduces battery / store-
  policy review surface.
- **In-app purchases**: not present today. If credits ([backend
  `aiCredit.service.js`]) ever monetise, App Store / Play Store
  policies require IAP for digital goods — Razorpay-only is
  rejected.

## 100-user load math (mobile-side)

This is a thin-client app — most heavy lifting is on the server.
Mobile-side throughput limits:

- One device opens at most 1 Socket.IO connection +
  short-lived HTTP requests. 100 users = 100 sockets → backend
  side, not client side.
- One user can fire at most ~10 simultaneous in-flight requests
  via tab/screen interactions before UI freezes; axios queues
  beyond that. The 120-s timeout (post-[M-05] split: 15 s
  default) bounds worst-case retry latency.
- Image upload bandwidth: with `react-native-compressor` (in
  deps) compressing scan photos to ~500 KB before upload, a
  single 4G connection (~1 MB/s upload) sends one in 0.5 s.
  Backend [E-03] moving to multipart (vs. base64) cuts this
  further.
- Memory: RN apps on low-end Android (1 GB RAM, the realistic
  target for Indian-farmer demographics) have ~300-400 MB
  available. Heavy screens (image-rich AgriStore catalogue,
  long chat history) need `FlatList` with `getItemLayout` and
  small `windowSize`. Confirm in the deeper FlatList review
  ([L-05] follow-up).

## Pre-launch checklist (mobile)

- [ ] All BLOCKERS [M-01]…[M-03] resolved.
- [ ] HIGH [M-04]…[M-09] resolved.
- [ ] `npm audit` reports 0 high/critical vulnerabilities.
- [ ] `npx expo-doctor` reports clean.
- [ ] EAS production build (`eas build -p all --profile
      production`) installed on a low-end Android (1 GB RAM)
      and an old iPhone (iOS 16) — both reach login → home →
      scan flow without crashes.
- [ ] Forced-airplane-mode test: every screen shows a graceful
      offline UX, no infinite spinners.
- [ ] Forced backend-503 test: by killing the staging backend,
      every screen surfaces the Sentry breadcrumb and shows a
      retry-able error state.
- [ ] Forced ErrorBoundary test: throw inside a screen on
      mount; the fallback renders; Sentry receives the event;
      `Updates.reloadAsync()` recovers.
- [ ] OTA update push test: `eas update --channel preview`
      replaces the JS bundle on next launch; signing rejects
      an unsigned bundle pushed via a stolen token.
- [ ] App Store / Play Store metadata: bundle id, name, icons,
      privacy policy URL (currently `https://farmeasy.app/...`
      — must be a Cropsetu URL before publication), app
      category set.
