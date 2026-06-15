# Profile Setup Wizard (4-Step)

> **Tab:** Auth/Onboarding · **Stack:** none (self-contained component module — **not** registered in `OnboardingNavigator` or `AppNavigator`) · **Route name:** _none_ (default-exported component `ProfileSetupFlow`) · **File:** `frontend/src/screens/Onboarding/ProfileSetup/ProfileSetupFlow.js`

## Purpose
A polished, self-contained multi-step onboarding wizard (Identity → Language → Location → Farm → Success) intended to run once right after OTP for a new user. It owns all wizard state across Back/Next, validates only the name, and delegates every side-effect (photo upload, geocoding, profile/farm save) to injectable handler **stubs** that default to simulated (demo) implementations. It is a reusable, theme/i18n-bundled module (`ProfileSetup/index.js` re-exports it and its parts).

## Where it sits / how you reach it
- **Reached from:** **Currently nothing.** Grep shows `ProfileSetupFlow` / the `ProfileSetup` index are not imported by any navigator or screen outside the `ProfileSetup/` folder. The live onboarding flow is the 2-screen `OnboardingNavigator` (`OnboardingLanguage` + `OnboardingProfile`); this wizard is a parallel redesign that is not yet wired in. Its header comment says it is "Shown once, right after OTP (isNewUser)".
- **Navigates to:** No React Navigation. Step transitions are internal `useState` (`step` 0→3); completion renders `StepSuccess`, whose CTA calls the injected `onComplete` prop. Skip calls `onSkip ?? onComplete`.
- **Route params in:** none — configured entirely via component props: `onUploadPhoto`, `onDetectLocation`, `onSaveProfile`, `onSaveFarm`, `onSkip`, `onComplete`, `forceScheme`, `t` (inject the app translator).

## How it works
- **State (preserved across steps):** `step`, `direction` (1 forward / -1 back, drives slide animation), `done`, plus `photo {uri,uploading,progress,error}`, `name` + `nameError`, `language`, `location {village,district,state,pincode}`, `farm {landAcres,cropTypes,soilType,irrigationType}`, and `saving` + `saveError`.
- **Translator:** uses injected `t` if provided; otherwise the bundled `createT` stub. With no real `t`, choosing Hindi in Step 2 flips the demo strings live (only `en`/`hi` are bundled).
- **Validation:** only the name is required (`nameIsValid` = trimmed length ≥ 2). Trying to advance from Step 0 with an invalid name sets `nameError` (`onb.nameRequired` / `onb.nameTooShort`). All other steps are optional.
- **Navigation logic (`handleNext`):** blocks on invalid name at step 0; on the last step calls `finish()`; otherwise `goNext()`.
- **Finish (`finish`)** sets `saving`, awaits `onSaveProfile({ name, photoUrl, language })` then `onSaveFarm({ ...location, ...farm })`, and on success sets `done` (renders `StepSuccess`). On failure sets `saveError` (`onb.errNetwork` for code `NETWORK`, else `onb.errSave`) and surfaces it in the footer; the Next label becomes "Try again".
- **Skip** is offered from step ≥ 1 (name step can't be skipped); it calls `onSkip || onComplete`.
- **Default stubs (simulated):** `defaultUploadPhoto` fakes upload progress and resolves the local uri; `defaultDetectLocation` waits ~1.2s and returns a hard-coded Nashik address; `defaultSave` just waits ~1.1s. Each has a `// TODO:` marking where the real Cloudinary/PATCH/POST call should go.
- **Chrome:** `OnboardingLayout` provides the gradient header, Back/Skip controls, "Step X of N" + animated progress bar, scrollable content sheet, and a fixed footer `PrimaryButton` (shared from the Auth `PhoneLogin` components). Reduce-motion is honoured throughout.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| **Layout chrome** (`OnboardingLayout`) | Wizard scaffold | Deep-green gradient header, rounded content sheet, fixed footer CTA. |
| Back button | Header icon (`ChevronLeft`) | Shown from step 1+; `goBack()` with selection haptic. |
| Step progress | "Step X of N" text + animated bar | Fills to `(stepIndex+1)/stepCount`; `accessibilityRole="progressbar"`. |
| Skip for now | Header text button | Shown from step 1+; `handleSkip`. |
| Next / Finish / Try again | Footer `PrimaryButton` | Label varies by step; shows `nextLoadingLabel` ("Saving…") while saving; disabled when name invalid or saving. |
| Footer error | Inline alert row (`TriangleAlert`) | On last step, shows `saveError`. |
| **Step 1 · Identity** (`StepIdentity`) | Section | Title "Let's set up your profile". |
| Avatar picker | `AvatarPicker` (circular, dashed placeholder) | Tap opens a source modal (Take photo / Choose gallery / Remove); real pick via `expo-image-picker`, upload delegated to parent; animated SVG progress ring + percent while uploading; error caption with retry. |
| Photo source sheet | `Modal` bottom sheet | Camera (hidden on web) / Gallery / Remove rows. |
| Full name input | `TextInput` (required) | Focus/error states; inline error row with `TriangleAlert`; `autoCapitalize="words"`. |
| **Step 2 · Language** (`StepLanguage` → `LanguageSelect`) | Section | Title "Choose your language". |
| Language rows | Radiogroup of full-width rows | Each shows flag + native script name + "name · region"; selected = colour + border + check; scale + selection haptic. Driven by `LANGUAGES` from the app i18n table. |
| **Step 3 · Location** (`StepLocation` → `LocationFields`) | Section | Title "Where is your farm?". |
| Use my current location | Prominent detect button (`LocateFixed`) | Requests `expo-location` permission, calls `onDetect(coords)`; spinner while detecting; denial → graceful manual-entry note; error note on failure. |
| Auto-filled badge | `BadgeCheck` pill | Marks fields filled by detection; clears when the field is manually edited. |
| Village / District inputs | `TextInput` × 2 | Manual address fields with focus/error styling. |
| State select | `Pressable` + searchable modal | Opens `StatePicker` modal: search bar (`Search`) + scrollable radio list of `STATES` (Indian states + UTs) with check on selection. |
| Pincode input | `TextInput` (number-pad, maxLength 6) | Strips non-digits; inline error if invalid 6-digit PIN (`isValidPincode`). |
| **Step 4 · Farm** (`StepFarm`) | Section | Title "Tell us about your farm" (all optional). |
| Land size stepper | `StepperInput` (± buttons + field) | ±48dp buttons + direct numeric entry, clamped to `LAND` bounds (0–200, step 0.5), unit "acres", selection haptic per step. |
| Crops select | `ChipSelect` mode="multi", 3 cols | Multi-select grid of `CROPS` (12 crops) with `OptionIcon` art; live "{{count}} selected" line; check + colour on selected. |
| Soil type select | `ChipSelect` mode="single", 3 cols | Single-select of `SOILS` (7 incl. "Not sure"); tap-again clears. |
| Water source select | `ChipSelect` mode="single", 3 cols | Single-select of `IRRIGATIONS` (6: Canal, Borewell, Drip, Sprinkler, Rainfed, Flood). |
| **Completion** (`StepSuccess`) | Full-screen celebration | Gradient hero, animated check badge + expanding ring (reduce-motion aware), success haptic, title/subtitle, and a `PrimaryButton` ("Start exploring") → `onComplete`. |

## Services, APIs & data
- **API endpoints:** **none called directly.** Persistence is delegated to props (`onUploadPhoto`, `onDetectLocation`, `onSaveProfile`, `onSaveFarm`) whose defaults are simulated stubs with `// TODO:` markers (intended targets per comments: Cloudinary upload for the photo, reverse-geocode for location, `PATCH /me` for profile + `POST /farm` for the farm). Nothing in this module imports `services/`.
- **Backend route/service:** none wired. (Were it connected, it would map to `backend/src/routes/onboarding.routes.js` / `user.routes.js` like the live `OnboardingProfileScreen`.)
- **State / context:** entirely local `useState`/`useCallback`/`useMemo` in `ProfileSetupFlow`; theming via `AuthThemeProvider`/`useOnbTheme` (`theme.js`); strings via `OnbStringsProvider`/`useT` (`strings.js`). Uses `expo-image-picker` (AvatarPicker) and `expo-location` (LocationFields) directly for device access; `Haptics` and `react-native-reanimated` for motion.
- **Local / static data:** `options.js` — `LANGUAGES` (re-exported from `i18n/translations`), `CROPS` (12), `SOILS` (7), `IRRIGATIONS` (6), `STATES` (Indian states + UTs), `LAND` bounds. Option `value`s are stable backend enums; `labelKey`s resolve via `t()`.

## Languages / i18n
- Self-contained `onb.*` string bundle in `strings.js` with full **English + Hindi** translations (Hindi included to pressure-test Devanagari layout). `createT(lang)` supports dot-notation keys + `{{var}}` interpolation with English fallback.
- The app's real translator can be injected via the `t` prop (`OnbStringsProvider t={appT}`); otherwise the bundled stub is used and the Step-2 language choice (en/hi) flips the demo UI live.

## Notes, edge cases & gaps
- **Not wired into the app** — this is a redesigned wizard that supersedes (in intent) the live single-screen `OnboardingProfileScreen`, but no navigator imports it. The live onboarding remains `OnboardingNavigator` (Language + Profile).
- All persistence is **simulated** by default — the photo upload, geocoding, and save handlers are stubs (`// TODO:`) until real implementations are passed as props.
- Forgiving UX: name error clears as you type; single-select chips tap-again to clear; location permission denial degrades to manual entry (user never trapped).
- Accessibility is thorough (progressbar/radiogroup/radio/checkbox roles, live regions, reduce-motion fallbacks, large tap targets).
- Only `en` and `hi` are bundled in `strings.js`; other languages resolve only if a real app `t` is injected.
