# Landing (Welcome)

> **Tab:** Auth/Onboarding · **Stack:** None (rendered as a step inside `LoginFlow`, not a React Navigation route) · **Route name:** `LANDING` (internal `LoginFlow` step, not a navigator screen) · **File:** `frontend/src/screens/Auth/Landing/LandingScreen.js`

## Purpose
The warm, "alive" first impression for unauthenticated users. It presents the CropSetu / KhetAI brand (frosted logo badge, wordmark, tagline) over a deep field-green hero with motion graphics (breathing sun, parallax hills, drifting seeds), a value-prop carousel, and a single primary CTA that advances into the phone-login flow. Designed as the first beat of the ported KhetAI auth design system.

> **Important wiring note:** This screen is part of the standalone `LoginFlow` design-system bundle (`src/screens/Auth/PhoneLogin/`), which is **not** the auth UI currently wired into the app. `App.js` renders the self-contained `frontend/src/screens/Auth/LoginScreen.js` when `!isLoggedIn` (see `App.js:36,51`). `LandingScreen` is rendered only by `LoginFlow.js` as its `LANDING` step. Additionally, several of its imports are missing from the repo (`./components/FieldScene`, `./components/ValuePropCarousel`, `../PhoneLogin/components/AuthTopControls`, `../../../utils/authSound`, and the `assets/cropsetu-logo.png` asset), so this screen would currently fail to import as-is.

## Where it sits / how you reach it
- **Reached from:** Rendered by `LoginFlow.js` when its `step === STEP.LANDING` (the initial step). It is the entry beat of `LoginFlow`.
- **Navigates to:** Calls `onGetStarted()` (wired in `LoginFlow` to `setStep(STEP.PHONE)`) → the Phone Entry screen, via the harvest-gold **Get started** `PrimaryButton`. Also exposes `onGuest`, `onTerms`, `onPrivacy` callbacks through the shared `LegalFooter`, and `onToggleLanguage` via the top-right language control.
- **Route params in:** none (it is a function component driven entirely by props: `onGetStarted`, `onGuest`, `onToggleLanguage`, `languageCode='EN'`, `onTerms`, `onPrivacy`).

## How it works
On mount it warms the audio session (`SFX.preloadAll()`) and plays a one-time, once-per-app-session welcome chime (module-scoped `welcomePlayed` flag so it never replays on remount). Foreground content enters in a staggered choreography via `FadeInUp` (each element ~80ms after the prior); a one-shot diagonal gradient shimmer (`HeroSweep`) sweeps the hero, and the `BrandZone` logo badge springs in with a subtle ±3px idle float. The decorative `FieldScene` fades in behind the content (`pointerEvents="none"`). All motion is gated by `useReducedMotion()` and the global mute (audio self-gates inside `SFX.play`); with either on, the screen is a calm static frame with identical layout. The CTA handler `handleGetStarted` plays a light tap sound and calls `onGetStarted?.()`. There is no network activity, loading, or error handling on this screen — it is purely presentational.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Hero gradient backdrop | `LinearGradient` (`theme.heroGradient`) | Deep field-green full-screen brand surface |
| Field scene illustration | Decorative `FieldScene` (Animated, pointerEvents none) | Parallax sun / hills / seeds behind content (motion-gated) |
| Hero shimmer sweep | `HeroSweep` (Animated `LinearGradient` band) | One-shot diagonal light sweep on mount; null under reduce-motion |
| Top-right language/sound control | `AuthTopControls` (top bar) | Language chip (`languageCode`) + sound toggle; calls `onToggleLanguage` |
| Logo badge | `BlurView` + `Image` (cropsetu-logo.png) | Frosted spring-in badge with idle float |
| Eyebrow text | `Animated.Text` | `t('auth.welcomeBack')`, uppercase, letter-spaced |
| Wordmark | `Animated.Text` (`accessibilityRole="header"`) | `t('auth.appName')` ("CropSetu") |
| Tagline | `Animated.Text` | `t('auth.tagline')` |
| Value-prop carousel | `ValuePropCarousel` | Rotating value propositions below the brand zone |
| Get started button | `PrimaryButton` (gold, `ArrowRight` icon, `testID="landing-get-started"`) | Primary CTA → `onGetStarted` (advance to Phone step) |
| Legal + guest footer | `LegalFooter` | Consent line with **Terms of Use** / **Privacy Policy** links + optional "Continue as guest" link (`onGuest`) |
| Status bar | `StatusBar` (`theme.statusBar`) | Themed status bar style |

## Services, APIs & data
- **API endpoints:** none — static/local. No `services/` imports.
- **Backend route/service:** none directly. (The flow it leads into ultimately hits `backend/src/routes/auth.routes.js`.)
- **State / context:** Local only. `useAuthTheme()` (auth theme provider), `useT()` (auth strings provider), `useReducedMotion()`, `useMemo` for styles, shared values via `react-native-reanimated`. No `AuthContext`/`writeQueue`/`socket`.
- **Local / static data:** `LOGO` asset require, module-scoped `welcomePlayed` flag, `SFX` sound util, `SPRINGS` motion presets, responsive helpers (`s`, `vs`, `ms`, `SCREEN`).

## Languages / i18n
Uses the auth-local i18n via `useT()` from `../PhoneLogin/strings`. Keys used: `auth.welcomeBack` (note: not defined in `strings.js`, so it falls back to the key string), `auth.appName`, `auth.tagline`, `auth.getStarted` (also not in `strings.js` → falls back to key). The bundled `strings.js` ships `en` and `hi` (Devanagari) tables; `languageCode` (default `'EN'`) is shown in the top control and toggled via `onToggleLanguage`.

## Notes, edge cases & gaps
- **Not wired into the app** and **has missing imports** (`FieldScene`, `ValuePropCarousel`, `AuthTopControls`, `utils/authSound`, `assets/cropsetu-logo.png`) — would currently fail to import. The live welcome screen is the `WelcomeView` inside `LoginScreen.js`.
- Welcome chime plays only once per app session (module-scoped guard), even across remounts.
- All animation and sound self-gate on `useReducedMotion()` + global mute, preserving an identical static layout for accessibility.
- `auth.welcomeBack` and `auth.getStarted` keys are absent from `strings.js`; `createT` falls back to returning the raw key, so those would render literally as `auth.welcomeBack` / `auth.getStarted` until added.
- No loading/error/offline states — purely presentational.
