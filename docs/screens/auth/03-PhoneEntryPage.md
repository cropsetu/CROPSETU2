# Phone Entry

> **Tab:** Auth/Onboarding · **Stack:** None (rendered as a step inside `LoginFlow`, not a React Navigation route) · **Route name:** `PHONE` (internal `LoginFlow` step, not a navigator screen) · **File:** `frontend/src/screens/Auth/PhoneLogin/PhoneEntryScreen.js`

## Purpose
Step 1 of the KhetAI design-system phone-login flow: collect a valid 10-digit Indian mobile number and trigger sending an OTP. It owns only the transient UI for the phone value — format validation, the CTA loading state, and friendly inline errors. The actual send is delegated to an injected async `onSendOtp(phone)` prop, so this screen never knows how OTPs are sent.

> **Wiring note:** This belongs to the standalone `LoginFlow` bundle (`src/screens/Auth/PhoneLogin/`), which is **not** the auth UI wired into the app — `App.js` renders `src/screens/Auth/LoginScreen.js` instead. `PhoneEntryScreen` is rendered only by `LoginFlow.js` as its `PHONE` step. It also imports a missing component, `./components/AuthTopControls` and `./components/Shimmer`, plus the missing `../../../utils/authSound`, so it would currently fail to import as-is.

## Where it sits / how you reach it
- **Reached from:** `LoginFlow.js` when `step === STEP.PHONE`. Entered from the Landing screen's **Get started** (`onGetStarted` → `setStep(STEP.PHONE)`) or by tapping **Edit number** / back on the OTP screen.
- **Navigates to:** On a successful `onSendOtp(phone)` resolve, `LoginFlow.goToOtp` advances to `STEP.OTP` (the OTP Verification screen). The shared `LegalFooter` exposes `onTerms`, `onPrivacy`, and `onGuest`; the top-right slot exposes `onToggleLanguage`.
- **Route params in:** none — props only: `phone`, `onChangePhone`, `onSendOtp` (required async), `onGuest`, `onToggleLanguage`, `languageCode='EN'`, `onTerms`, `onPrivacy`.

## How it works
The parent (`LoginFlow`) owns the raw `phone` digits; this screen owns presentation. `valid = isValidPhone(phone)`. When the number flips to valid, a one-time "ready" pulse animates the CTA (`withSequence` spring to 1.02 and back) with a selection haptic and a quiet confirm sound (gated by `useReducedMotion`). `handleChange` forgivingly clears any error as the user edits and forwards digits to `onChangePhone`.

`submit` (called by the CTA and the keyboard "done"): if invalid, sets `t('auth.errInvalidPhone')`; otherwise sets `loading`, awaits `onSendOtp(phone)`. On success it plays a "whoosh" (the component then unmounts as the flow transitions, so no `setState`). On rejection, `toFriendlyError` maps the thrown error to localized copy — `NETWORK`/`Network Error` → `errNetwork`, `RATE_LIMIT`/429 → `errTooMany`, else `errSendFailed` — and clears `loading` (guarded by a `mounted` ref). The screen is built on `AuthScreenLayout` (step=1, hero, 2-step progress dots, keyboard handling).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Screen scaffold | `AuthScreenLayout` (`step={1}`) | Hero gradient backdrop, frosted logo badge, wordmark, tagline, 2-step progress dots, keyboard-avoiding scroll |
| Top-right control slot | `AuthTopControls` | Language switch (`languageCode`, `onToggleLanguage`) — **missing component** |
| Header icon | `Smartphone` (lucide) | Card header glyph |
| Title / subtitle | `Text` | `t('auth.phoneTitle')` / `t('auth.phoneSubtitle')` |
| Phone input | `PhoneInput` | Fixed `🇮🇳 +91` chip + grouped 10-digit field ("XXXXX XXXXX"), animated focus ring, `autoFocus`, `onSubmitEditing` → submit |
| Phone inline error | error row inside `PhoneInput` (`CircleAlert` + text, shake + haptic) | Plain-language validation/send error |
| Get OTP button | `PrimaryButton` (`label=t('auth.getOtp')`, `loadingLabel=t('auth.sending')`, `ArrowRight`, `testID="get-otp"`) | Disabled until `valid`; → `submit`; ready-pulse on validity flip |
| Trust line | `ShieldCheck` icon + `Text` (`t('auth.trustLine')`) | Reassurance microcopy |
| Loading sheen | `Shimmer` (`active={loading}`) | Faint "working" overlay while sending — **missing component** |
| Legal + guest footer | `LegalFooter` | Terms / Privacy links + optional "Continue as guest" (`onGuest`) |
| Back affordance | `AuthScreenLayout` back button | Only renders if `onBack` is passed (not passed here — no back on this step) |

## Services, APIs & data
- **API endpoints:** none directly — the send is delegated to the injected `onSendOtp(phone)` prop. In `LoginFlow`, that defaults to a latency stub (`await wait(1200)`); the `// TODO:` marks `api.post('/auth/otp/send', { phone })` as the intended real call. The actual app's auth uses `POST /api/v1/auth/send-otp` (via `AuthContext.sendOtp`), but that is wired through `LoginScreen.js`, not this screen.
- **Backend route/service:** intended target `backend/src/routes/auth.routes.js` → `POST /api/v1/auth/send-otp`.
- **State / context:** Local `useState` (`loading`, `error`), `useRef` (`mounted`, `prevValid`), reanimated shared value for the CTA pulse. Auth-local providers via `useAuthTheme()` / `useT()`. No `AuthContext`/`socket`/`writeQueue`.
- **Local / static data:** `isValidPhone` (utils/validators), `Haptics`, `SFX` (authSound — missing), `SPRINGS`, responsive `s`/`vs`.

## Languages / i18n
Uses auth-local `useT()` (`../PhoneLogin/strings`). Keys: `auth.phoneTitle`, `auth.phoneSubtitle`, `auth.getOtp`, `auth.sending`, `auth.trustLine`, and error keys `auth.errInvalidPhone`, `auth.errNetwork`, `auth.errTooMany`, `auth.errSendFailed`. `strings.js` ships `en` + `hi` (Devanagari) tables; `languageCode` shown in the top control. `PhoneInput` adds `auth.phoneLabel`, `auth.phonePlaceholder`, `auth.a11yPhoneField`.

## Notes, edge cases & gaps
- **Not wired into the app** and **has missing imports** (`AuthTopControls`, `Shimmer`, `utils/authSound`) — would currently fail to import. The live phone-entry UI is `PhoneView` inside `LoginScreen.js`.
- Errors are friendly/localized only (never a raw code) and cleared as the user edits.
- `mounted` ref guards against `setState` after unmount (the component unmounts when the flow advances on success).
- The CTA disables on invalid input; the keyboard "done" path also routes through `submit` and surfaces `errInvalidPhone` if invalid.
- Animations and sounds self-gate on `useReducedMotion()` + global mute.
