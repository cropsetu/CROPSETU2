# Login Flow (Auth orchestrator)

> **Tab:** Auth/Onboarding · **Stack:** None — a self-contained orchestrator component, not a React Navigation screen · **Route name:** none (owns internal steps `LANDING` / `PHONE` / `OTP`) · **File:** `frontend/src/screens/Auth/PhoneLogin/LoginFlow.js`

## Purpose
The orchestrator that assembles the three KhetAI design-system auth screens (Landing → Phone Entry → OTP Verification) into one flow, owning the shared `step` + `phone` state and wiring the screen-to-screen transitions. It is delivered as a self-contained, runnable demo: it ships default handler **stubs** (simulated latency, no real network) for `onSendOtp` / `onVerifyOtp` / `onResendOtp`, and accepts real implementations as props to plug into the actual auth backend.

> **Wiring note:** `LoginFlow` is the default export of `src/screens/Auth/PhoneLogin/index.js`, but it is **not** imported by `App.js` or any navigator — the app's wired auth screen is `src/screens/Auth/LoginScreen.js`. `LoginFlow` (and the screens it renders) also reference several files that do not exist in the repo (`AuthTopControls`, `Shimmer`, `ConfettiBurst`, `Landing/components/FieldScene`, `Landing/components/ValuePropCarousel`, `utils/authSound`, `assets/cropsetu-logo.png`), so it would currently fail to import as-is. Treat it as an unwired design reference / future swap-in (see `PhoneLogin/README.md`).

## Where it sits / how you reach it
- **Reached from:** Nowhere in the running app — not referenced by `App.js`, `AppNavigator.js`, or `OnboardingNavigator.js`. Intended usage (per README) is to render `<LoginFlow onComplete={...} onGuest={...} />` from the host in place of the current `LoginScreen`.
- **Navigates to:** Internally swaps between its three steps. `LANDING → PHONE` (`onGetStarted`), `PHONE → OTP` (`goToOtp`, only after `sendOtp` resolves), `OTP → PHONE` (`onEditNumber`). On verified login, `verified()` fires the optional `onComplete` prop (the host then routes onward). `onGuest` is passed through to Landing/Phone.
- **Route params in:** none — props only: `onSendOtp`, `onVerifyOtp`, `onResendOtp`, `onComplete`, `onGuest`, `forceScheme` (`'light'|'dark'`), `t` (inject the app's translator).

## How it works
Holds `step` (`STEP.LANDING` default), `phone`, and a stub-only `lang` toggle. It defines three memoized handlers:
- `sendOtp(num)` → uses injected `onSendOtp` if provided, else stub `await wait(1200)` (TODO: `api.post('/auth/otp/send', { phone })`).
- `verifyOtp(otp)` → injected `onVerifyOtp(phone, otp)` else stub `await wait(1100)`; the stub only accepts `"123456"` and otherwise throws an error with `code='WRONG_OTP'` (so the error/shake path is reachable in the demo).
- `resendOtp()` → injected `onResendOtp(phone)` else stub `await wait(900)`.

`goToOtp(num)` awaits `sendOtp(num)` (a rejection bubbles up so Phone Entry surfaces the error) and only advances to `STEP.OTP` on success. `verified()` calls `onComplete?.()`. The language toggle (`onToggleLanguage`) is only exposed when no real `t` is injected. A `useMemo` selects the current screen component (`OtpVerificationScreen` / `PhoneEntryScreen` / `LandingScreen`) with the right props, all wrapped in `AuthThemeProvider` (`scheme={forceScheme || null}`) and `AuthStringsProvider` (`t={injectedT} lang={lang}`).

## UI elements
LoginFlow renders no UI of its own — it renders exactly one child screen per step and provides the theme + strings context. The visible elements live in the child screens.

| Element | Type | Description / action |
|---|---|---|
| `AuthThemeProvider` | Context provider | Supplies the auth theme (`forceScheme` or OS) to all child screens |
| `AuthStringsProvider` | Context provider | Supplies `t()` — injected app translator or bundled `en`/`hi` stub at `lang` |
| `LandingScreen` (step LANDING) | Child screen | Welcome/hero; **Get started** → `setStep(PHONE)` |
| `PhoneEntryScreen` (step PHONE) | Child screen | Phone input + **Get OTP**; `onSendOtp=goToOtp`, `onChangePhone=setPhone` |
| `OtpVerificationScreen` (step OTP) | Child screen | OTP boxes + **Verify**; `onVerifyOtp`, `onResendOtp`, `onEditNumber`, `onVerified=verified`, `resendCooldown={30}` |

## Services, APIs & data
- **API endpoints:** none wired — the default handlers are latency stubs. The `// TODO:` comments name the intended real calls: `api.post('/auth/otp/send', { phone })`, `api.post('/auth/otp/verify', { phone, otp })` (→ store token), `api.post('/auth/otp/resend', { phone })`. These map to the backend's `POST /api/v1/auth/send-otp` and `POST /api/v1/auth/verify-otp`. No `services/` import exists in this file.
- **Backend route/service:** intended target `backend/src/routes/auth.routes.js` (`/api/v1/auth/send-otp`, `/api/v1/auth/verify-otp`) once real handlers are injected.
- **State / context:** Local `useState` (`step`, `phone`, `lang`) + memoized handlers. Provides `AuthThemeProvider` / `AuthStringsProvider` context to children. Does **not** consume the app's `AuthContext` (a host would bridge `onSendOtp`/`onVerifyOtp` to `AuthContext.sendOtp`/`verifyOtp`). No `socket`/`writeQueue`.
- **Local / static data:** `STEP` map, `wait(ms)` latency helper, demo-only accepted OTP `"123456"`, default `resendCooldown=30`.

## Languages / i18n
i18n is supplied via `AuthStringsProvider`. If a `t` prop is injected, the app's translator drives all copy; otherwise the bundled stub (`strings.js`, `en`/`hi`) is used at the local `lang` (toggled EN↔HI only in stub mode). Children read copy via `useT()`.

## Notes, edge cases & gaps
- **Not wired into the app** and **depends on missing files** — would currently fail to import. It is a demo/reference orchestrator intended to be swapped in for `LoginScreen.js` later (per `PhoneLogin/README.md`).
- Demo verify stub accepts only `"123456"`; everything else throws `WRONG_OTP` to exercise the error/shake UI.
- `goToOtp` advances **only** on a successful send — a rejected `sendOtp` keeps the user on Phone Entry with the surfaced error.
- The language toggle is intentionally hidden when the host injects a real `t` (so the app, not the stub, owns i18n).
- To go live, replace the three stub bodies with real API calls (and persist the token), then render `<LoginFlow>` where `LoginScreen` is currently rendered.
