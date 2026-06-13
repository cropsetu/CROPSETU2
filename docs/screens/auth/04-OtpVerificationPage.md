# OTP Verification

> **Tab:** Auth/Onboarding · **Stack:** None (rendered as a step inside `LoginFlow`, not a React Navigation route) · **Route name:** `OTP` (internal `LoginFlow` step, not a navigator screen) · **File:** `frontend/src/screens/Auth/PhoneLogin/OtpVerificationScreen.js`

## Purpose
Step 2 of the KhetAI design-system phone-login flow: verify the 6-digit OTP sent to the user's number. It drives an idle → verifying → success / error state machine around injected async stubs `onVerifyOtp(otp)` and `onResendOtp()`, auto-verifying the moment all 6 digits land (one less tap for the farmer) while also exposing an explicit Verify button.

> **Wiring note:** Part of the standalone `LoginFlow` bundle, which is **not** the app's wired auth UI (`App.js` renders `src/screens/Auth/LoginScreen.js`). `OtpVerificationScreen` is rendered only by `LoginFlow.js` as its `OTP` step. It imports a missing component, `./components/AuthTopControls`, and `OtpInput` pulls in the missing `./components/Shimmer`, `./components/ConfettiBurst`, and `../../../../utils/authSound`, so it would currently fail to import as-is.

## Where it sits / how you reach it
- **Reached from:** `LoginFlow.js` when `step === STEP.OTP`, after Phone Entry's `onSendOtp` resolves (`goToOtp` → `setStep(STEP.OTP)`).
- **Navigates to:** On success, after a ~1s celebration hold (`SUCCESS_HOLD_MS`), calls `onVerified()` → `LoginFlow.verified` → `onComplete?.()` (host app routes into the app/onboarding). `onEditNumber` (the back arrow, the **Change** link in the subtitle, and the **Edit number** accessory) returns to `STEP.PHONE`.
- **Route params in:** none — props only: `phone`, `onVerifyOtp` (async, rejects on bad code), `onResendOtp` (async), `onEditNumber`, `onVerified`, `resendCooldown=30`.

## How it works
Local state: `otp` string, `status` (`idle | verifying | success | error`), `error`, `secondsLeft` (resend countdown, init `resendCooldown`), `resending`. A 1s `setInterval` decrements the countdown; when it unlocks (reaches 0) an "attention" shimmer pulses the Resend link ~3 times (reduce-motion gated).

`verify(code)`: ignores re-entry while verifying/success; if `!isValidOtp(code)` sets `errInvalidOtp`; else `status='verifying'`, awaits `onVerifyOtp(code)`. On success → `status='success'`, then `setTimeout(onVerified, SUCCESS_HOLD_MS)`. On error → `status='error'`, maps via `toFriendlyError` (`WRONG_OTP`/401 → `errWrongOtp`, `NETWORK`/`Network Error` → `errNetwork`, else `errSendFailed`), then after the shake (`SHAKE_MS=480`) clears the field, returns to `idle`, and refocuses. `handleChange` forgivingly clears stale errors. Auto-verify fires via `OtpInput`'s `onComplete` when 6 digits are entered; the Verify button also calls `verify(otp)`. `resend()`: only when unlocked, fires a haptic + tick, clears the field, awaits `onResendOtp()`, then resets the countdown and refocuses. A `mounted` ref guards all async `setState`. The phone subtitle is masked (`maskPhone` shows only the last 4 digits: `+91 •••• ` grouped).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Screen scaffold | `AuthScreenLayout` (`step={2}`, `onBack={onEditNumber}`) | Hero gradient, logo badge, wordmark, 2-step progress (both dots active), back affordance |
| Top-right control slot | `AuthTopControls` | Language/controls slot — **missing component** |
| Header icon | `KeyRound` (lucide) | Card header glyph |
| Title | `Text` (`t('auth.otpTitle')`) | "Enter the 6-digit code" |
| Subtitle (masked phone) | `Text` (`t('auth.otpSentTo', { phone: maskPhone(phone) })`) | "Sent to +91 •••• …" |
| Edit-number accessory | `Pressable` (`Pencil` icon + `t('auth.editNumber')`) | → `onEditNumber` (back to phone step); disabled while locked |
| OTP input | `OtpInput` (6 boxes over one hidden `TextInput`, `autoFocus`) | Paste / SMS-autofill / backspace-to-prev / auto-advance; `onComplete` → `verify` |
| OTP status line | inline rows in `OtpInput` | "Verifying…" / "Verified!" (check) / error (`CircleAlert` + message), with shake + halo + haptics |
| Verifying progress bar | `Shimmer mode="bar"` inside `OtpInput` | Indeterminate bar while `status==='verifying'` — **missing component** |
| Success check badge + confetti | `Check` badge + `ConfettiBurst` in `OtpInput` | Pops on success — **ConfettiBurst missing** |
| Verify button | `PrimaryButton` (`label` = `t('auth.verify')` or `t('auth.verified')`, `loadingLabel=t('auth.verifying')`, `testID="verify-otp"`) | Disabled until 6 digits & not locked; → `verify(otp)`; shows `CircleCheckBig` on success |
| Resend countdown | `Text` (`t('auth.resendIn', { time })`, live region) | "Resend code in m:ss" while `secondsLeft > 0` |
| Resend link | `Pressable` + `Animated.View` (`t('auth.resend')` / `t('auth.resending')`) | Active after countdown; attention-pulses on unlock; → `resend` |

## Services, APIs & data
- **API endpoints:** none directly — verification/resend are delegated to injected `onVerifyOtp(otp)` / `onResendOtp()` props. In `LoginFlow` these default to latency stubs (`await wait(1100)` / `await wait(900)`; the stub only accepts `"123456"`). The `// TODO:` markers name `api.post('/auth/otp/verify', { phone, otp })` and `api.post('/auth/otp/resend', { phone })` as the intended real calls. The app's real auth (`POST /api/v1/auth/verify-otp`) is wired through `LoginScreen.js`, not this screen.
- **Backend route/service:** intended target `backend/src/routes/auth.routes.js` → `POST /api/v1/auth/verify-otp` (returns tokens + `user`, `isNewUser`); resend re-hits `POST /api/v1/auth/send-otp`.
- **State / context:** Local `useState` (otp, status, error, secondsLeft, resending), `useRef` (`otpRef`, `mounted`, `prevSeconds`), reanimated attention shared value. Auth-local `useAuthTheme()`/`useT()`. No `AuthContext`/`socket`/`writeQueue`.
- **Local / static data:** `OTP_LENGTH=6`, `SHAKE_MS=480`, `SUCCESS_HOLD_MS=1000`, `isValidOtp` (utils/validators), `Haptics`, `SFX`, responsive `s`/`vs`.

## Languages / i18n
Uses auth-local `useT()`. Keys: `auth.otpTitle`, `auth.otpSentTo` (`{{phone}}` interpolation), `auth.editNumber`, `auth.verify`, `auth.verified`, `auth.verifying`, `auth.resendIn` (`{{time}}`), `auth.resend`, `auth.resending`, and errors `auth.errInvalidOtp`, `auth.errWrongOtp`, `auth.errNetwork`, `auth.errSendFailed`. `OtpInput` adds `auth.otpLabel`, `auth.a11yOtpField`. `strings.js` ships `en` + `hi` (Devanagari).

## Notes, edge cases & gaps
- **Not wired into the app** and **has missing imports** (`AuthTopControls`, and via `OtpInput`: `Shimmer`, `ConfettiBurst`, `utils/authSound`) — would currently fail to import. The live OTP UI is `OtpView` inside `LoginScreen.js`.
- **Auto-verify on completion** is a deliberate difference from the wired `LoginScreen` (which intentionally does *not* auto-verify so the dev auto-fill doesn't skip the screen).
- Error path shakes, announces (a11y live region), clears, and refocuses after `SHAKE_MS` for immediate retry; success holds ~1s before handing back.
- `mounted` ref prevents `setState`-after-unmount across all async paths.
- All animation/haptics/sound self-gate on `useReducedMotion()` + global mute; the verifying progress slot reserves height so showing/hiding never shifts layout.
