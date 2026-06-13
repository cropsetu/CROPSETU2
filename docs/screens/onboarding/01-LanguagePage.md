# Choose Your Language

> **Tab:** Auth/Onboarding · **Stack:** `OnboardingNavigator` (own `NavigationContainer`, shown when onboarding is incomplete) · **Route name:** `OnboardingLanguage` · **File:** `frontend/src/screens/Onboarding/OnboardingLanguageScreen.js`

## Purpose
Screen 1 of 2 in the post-login onboarding flow. It lets a brand-new user pick the app's interface language from 10 Indian languages before they fill in their farm profile. The choice is applied app-wide immediately (not deferred to submit) so the rest of onboarding and the app render in the chosen language.

## Where it sits / how you reach it
- **Reached from:** Rendered automatically by `OnboardingNavigator` as its initial route. `App.js` mounts `OnboardingNavigator` instead of the main app when `needsOnboarding` is true (`user?.onboardingStep === 'BASIC' && !user?.totalFarms`) — i.e. right after a new user finishes OTP login.
- **Navigates to:** `OnboardingProfile` (screen 2) via the bottom CTA button ("Next") — `navigation.navigate("OnboardingProfile")`. There is no back navigation (this is the first screen; gestures are disabled on the stack).
- **Route params in:** none.

## How it works
- On mount, local state `selected` is initialised from the current `language` from `LanguageContext` (defaulting to `"en"`).
- Tapping a language card calls `handleSelect(code)` which sets local `selected` **and** immediately calls `setLanguage(code)` from `LanguageContext` — the whole UI switches language live.
- The "Next" button (`handleNext`) re-asserts the language (`await setLanguage(selected)`) and then navigates to `OnboardingProfile`.
- The 10 languages are a hard-coded local constant `LANGS` (code, name, native script, emoji flag, region label). The currently-selected language's flag/native/English name is echoed in a pill at the bottom.
- Entrance animation: each `LangCard` fades/translates in with a staggered delay (`index * 60ms`); cards press-scale on touch. No network calls, no loading/error states on this screen.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Forest-green gradient surface | Background (`LinearGradient`, `KHET.gradSurface`) | Themed onboarding backdrop with two soft ambient "blobs". |
| Hero header | Icon + headline block | Gradient "language" icon plus serif headline "Choose your **language**" and bilingual subtitle ("अपनी भाषा चुनें · तुमची भाषा निवडा"). |
| Language list | Scrollable list of 10 cards | One `LangCard` per entry in `LANGS` (English, Hindi, Marathi, Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Punjabi). |
| Language card | Selectable row (`TouchableOpacity`) | Flag chip + native script name + region label + radio/check indicator. Tapping selects that language (single-select). |
| Selection indicator (check vs radio) | Trailing control on each card | Selected card shows a gradient circle with a checkmark; others show an empty radio circle. |
| Selected-language pill | Badge (bottom bar) | Rounded pill showing the chosen flag, native name and English name. |
| Next button | Primary CTA (gradient `TouchableOpacity`) | Labelled with `t("next")` + forward-arrow chip. Advances to `OnboardingProfile`. |

## Services, APIs & data
- **API endpoints:** none — this screen performs no backend calls. Language selection is persisted locally via `LanguageContext.setLanguage`.
- **Backend route/service:** none.
- **State / context:** `useLanguage()` (`LanguageContext`) for `language`, `setLanguage`, `t`; local `useState` for `selected`; `useSafeAreaInsets` and `useWindowDimensions` for layout.
- **Local / static data:** `LANGS` constant (10 languages with code/name/native/flag/region) defined in-file.

## Languages / i18n
- Drives the app's language globally via `setLanguage`. Only one i18n key is consumed for copy here: `t("next")`. All other strings (headline, subtitle, region labels, native names) are hard-coded literals in `LANGS` / JSX.
- The 10 supported languages: `en, hi, mr, ta, te, kn, ml, bn, gu, pa`.

## Notes, edge cases & gaps
- No empty/loading/error states — purely local, instantaneous selection.
- Selecting a language takes effect immediately (even before pressing Next), so backing out is not possible here (first screen; `gestureEnabled: false` on the stack).
- Web-specific height handling (`Platform.OS === "web"`) is applied so the fixed bottom bar sits correctly.
- The headline and bilingual subtitle are not localised (English/Hindi/Marathi literals baked in).
