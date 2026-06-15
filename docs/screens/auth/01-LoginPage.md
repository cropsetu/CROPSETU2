# Login (KhetAI — Welcome · Phone · OTP)

> **Tab:** Auth/Onboarding · **Stack:** None — rendered directly by `App.js` (`RootNavigator`) when `!isLoggedIn`, outside any React Navigation navigator · **Route name:** none (top-level gate; internal steps `welcome` / `phone` / `otp`) · **File:** `frontend/src/screens/Auth/LoginScreen.js`

## Purpose
The **live, production auth screen** of the app. It is a single self-contained component implementing the full KhetAI three-step phone-OTP login: WELCOME (pre-login hero) → PHONE (10-digit mobile entry) → OTP (6-digit verify). It performs the real OTP backend round-trip (`sendOtp` / `verifyOtp` from `AuthContext`) and, on successful verification, lets `RootNavigator` route the user into onboarding or the main app. Used by every unauthenticated user on app open.

## Where it sits / how you reach it
- **Reached from:** `App.js` → `RootNavigator`: `if (!isLoggedIn) return <LoginScreen />;` (`App.js:51`). It is the default screen for any logged-out session (after the loading spinner resolves).
- **Navigates to:** No React Navigation calls. On `verifyOtp` success, `AuthContext` sets `isLoggedIn = true`; `RootNavigator` then re-renders into `OnboardingNavigator` (new users, `onboardingStep === 'BASIC'` and no farms) or `AppNavigator` (main tabs). Internal step transitions: WELCOME → PHONE (`Get started`), PHONE → OTP (after `Send OTP` succeeds), OTP → back to PHONE (`Change` / back arrow).
- **Route params in:** none (rendered without props).

## How it works
Internal step state machine via `useState` (`step` ∈ `welcome | phone | otp`, default `welcome`). Three sub-views (`WelcomeView`, `PhoneView`, `OtpView`) are rendered conditionally.

Phone is **uncontrolled** — held in `phoneValueRef` (with `phoneReady` boolean + `phoneDisplay` snapshot) to avoid an Android New-Architecture caret-reset bug. `handlePhoneChange` strips to ≤10 digits and toggles `phoneReady` at length 10.

`handleSendOtp({isResend})`: validates via `isValidPhone`, sets `loading`, calls `sendOtp(phone)` from `AuthContext`. On success: snapshots `phoneDisplay`, advances to OTP (unless resend), starts a 30s resend countdown (`RESEND_SECONDS`), resets the 6 OTP boxes. **Demo mode:** if the server returns `devOtp` (SMS not configured), it auto-fills the 6 boxes and shows an "Auto-filled from SMS" banner (`autoFilled`). It deliberately does **not** auto-verify (would flash past the OTP screen). On error it reads `retry-after` header to seed the countdown and surfaces `err.userMessage` / `err.response.data.error.message`.

OTP is six single-char `TextInput` boxes (`otpDigits` array). `handleOtpChange` keeps last digit, auto-advances focus; `handleOtpKey` backspaces to the previous box. When all 6 land (`otpComplete`), the keyboard is dismissed to reveal the Verify button. `handleVerify` validates with `isValidOtp`, calls `verifyOtp(phoneDisplay, code)`; on failure it clears the boxes, drops `autoFilled`, and refocuses box 0. Resend countdown runs via a 1s `setInterval`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| **WELCOME — hero image** | `Image` (welcome-hero.jpg) + `LinearGradient` overlay | Full-bleed background + green hero gradient |
| WELCOME — KhetAI brand pill | Glass pill (`leaf` icon + "KhetAI") | Brand badge, top-left |
| WELCOME — language pill | Glass pill (`language` icon + "हिन्दी / EN") | Static language indicator (no handler) |
| WELCOME — AI badge pill | Pill (`sparkles`) | "Powered by on-device AI · 2,00,000+ farmers" |
| WELCOME — hero title / desc | `Text` | "Your farm, smarter every season." + description |
| WELCOME — language chips row | Chips from `LANGS` (7) + "+3 more" | Shows supported languages (हिन्दी, English, मराठी, தமிழ், తెలుగు, ಕನ್ನಡ, বাংলা) |
| WELCOME — Get started button | `GradientButton` (`label="Get started"`, sublabel "/ शुरू करें", `arrow-forward`) | → `onStart` → step = PHONE |
| WELCOME — terms row | `shield-checkmark` icon + `Text` | "By continuing you agree to our Terms & Privacy" |
| **PHONE — back button** | `TouchableOpacity` (`arrow-back` in circle) | → step = WELCOME |
| PHONE — brand row | `leaf` icon + "KhetAI" | Header brand |
| PHONE — accent pill | `sparkles` + "Secure AI verification" | Trust badge |
| PHONE — progress row | Two bars + "Step 1 of 2" | Step indicator |
| PHONE — title | `Text` | "What's your mobile number?" |
| PHONE — country-code chip | `🇮🇳` + "+91" | Fixed dial code |
| PHONE — phone input | `TextInput` (`number-pad`, `maxLength=10`, uncontrolled `defaultValue`, `autoFocus`) | Enters 10-digit number; `onSubmitEditing` → send |
| PHONE — privacy box | `shield-checkmark` + `Text` | "Your number stays private…" (shown when no error) |
| PHONE — error box | `alert-circle` + `Text` | Inline error (replaces privacy box) |
| PHONE — Send OTP button | `GradientButton` ("Send OTP / OTP भेजें", spinner when loading, disabled until `phoneReady`) | → `handleSendOtp()` |
| PHONE — footer terms | `Text` (Terms / Privacy bold) | Legal microcopy |
| **OTP — back button** | `TouchableOpacity` (`arrow-back`) | → `backToPhone` |
| OTP — online pill | `wifi` + "Online" | Connectivity badge (static) |
| OTP — progress row | Two filled bars + "Step 2 of 2" | Step indicator |
| OTP — title + masked number | `Text` | "Enter the 6-digit code", "Sent to +91  XXXXX XXXXX" + **Change** link → back |
| OTP — 6 OTP boxes | 6 × `TextInput` (`maxLength=1`, `number-pad`, `oneTimeCode`/`sms-otp` on box 0) | Single-char digit boxes with auto-advance/backspace |
| OTP — auto-fill banner | `LinearGradient` (`sparkles` + "Auto-filled from SMS") | Shown when `autoFilled` (devOtp) |
| OTP — error box | `alert-circle` + `Text` | Invalid/expired code message |
| OTP — verifying box | `ActivityIndicator` + "Verifying code…" | Shown while `loading` |
| OTP — resend countdown / link | `Text` "Resend OTP in m:ss" → `TouchableOpacity` "Resend OTP / दोबारा भेजें" | Countdown then resend (`handleSendOtp({isResend:true})`) |
| OTP — Verify button | `GradientButton` ("Verify OTP", spinner, disabled until complete) | → `handleVerify` |
| OTP — footer hint | `Text` | "Didn't get the code? Check your SMS inbox…" |
| Decorative blobs | `Blobs` (two soft circles) | Background décor on PHONE/OTP |
| Status bar | `StatusBar` (`light` on welcome, `dark` on phone/otp) | Themed status bar |

## Services, APIs & data
- **API endpoints:**
  - `POST /auth/send-otp` via `AuthContext.sendOtp` → `api.post('/auth/send-otp', { phone })` (with transparent 428 proof-of-work retry, sending `x-otp-pow` header).
  - `POST /auth/verify-otp` via `AuthContext.verifyOtp` → `api.post('/auth/verify-otp', { phone, otp })`, which stores `accessToken`/`refreshToken`/`userId` and sets the user.
  - (Base URL prefix `/api/v1` is applied by `services/api.js`.)
- **Backend route/service:** `backend/src/routes/auth.routes.js` — `POST /api/v1/auth/send-otp` (rate-limited per-IP & per-phone, proof-of-work gate) and `POST /api/v1/auth/verify-otp` (returns tokens + `user`, `isNewUser`, optional `stepUp`).
- **State / context:** `useAuth()` (`AuthContext`) for `sendOtp`/`verifyOtp`; local `useState`/`useRef` for step, loading, errors, phone (uncontrolled ref), OTP digits, resend countdown, autofill. `useSafeAreaInsets()` for padding.
- **Local / static data:** `STEPS`, `LANGS` (7 languages), `OTP_LEN=6`, `RESEND_SECONDS=30`, `HERO` image require, `KHET`/`KFONT`/`KSHADOW` from `constants/khetTheme`. Validators `isValidPhone`, `isValidOtp` from `utils/validators`.

## Languages / i18n
This screen does **not** use the app's `LanguageContext`/`t()` — all copy is hardcoded bilingual English+Hindi inline (e.g. "Send OTP / OTP भेजें", "Resend OTP / दोबारा भेजें", "आपका मोबाइल नंबर क्या है?"). The `LANGS` array advertises 7 Indian languages as static chips on the welcome view, but the screen itself is fixed bilingual EN/HI text.

## Notes, edge cases & gaps
- **This is the wired auth screen** (App.js gate). The parallel `LoginFlow`/`Landing`/`PhoneEntry`/`OtpVerification` design-system set is not used by the app.
- **Demo/dev OTP:** if the backend returns `devOtp` (SMS unconfigured), the OTP boxes auto-fill and an "Auto-filled from SMS" banner appears; the user still taps Verify (no auto-verify by design).
- **Rate limiting:** on a `send-otp` error with a `retry-after` header, the resend countdown is seeded from it (clamped to ≤300s). Backend enforces per-IP and per-phone OTP limits (429) plus a proof-of-work 428 challenge under suspicion (handled transparently in `AuthContext`).
- **Phone field is uncontrolled** (ref-based `defaultValue`) specifically to dodge an Android New-Architecture caret-reset bug; OTP boxes hold ≤1 char each to avoid the same.
- Keyboard auto-dismisses once 6 OTP digits are present so the Verify button is revealed.
- New users are routed to onboarding by `RootNavigator` based on `user.onboardingStep === 'BASIC'` && `!user.totalFarms`.
- Errors are surfaced from `err.userMessage` or `err.response.data.error.message` with plain-language fallbacks; no offline-specific UI beyond the generic error copy.
