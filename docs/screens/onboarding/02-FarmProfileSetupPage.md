# Farm Profile Setup

> **Tab:** Auth/Onboarding · **Stack:** `OnboardingNavigator` · **Route name:** `OnboardingProfile` · **File:** `frontend/src/screens/Onboarding/OnboardingProfileScreen.js`

## Purpose
Screen 2 of 2 in the post-login onboarding flow. A single long-scroll form where a new user enters their name, profile photo, farm location, farm details (land size, soil, irrigation) and crops, then submits everything in one shot to complete onboarding. Only **first name** and **district** are required; everything else is optional and can be skipped.

## Where it sits / how you reach it
- **Reached from:** `OnboardingLanguageScreen` → "Next" button (`navigation.navigate("OnboardingProfile")`). It is the second screen of `OnboardingNavigator`, which `App.js` mounts when `needsOnboarding` (`onboardingStep === 'BASIC' && !totalFarms`).
- **Navigates to:** No `navigation.navigate` forward — completing or skipping calls `updateUser({ onboardingStep: 'COMPLETE', ... })`, which flips `needsOnboarding` to false in `App.js` and tears down `OnboardingNavigator` (the user lands in the main tab app). The header back button (`navigation.goBack()`) returns to `OnboardingLanguage`.
- **Route params in:** none.

## How it works
- All form fields are local `useState` (no params, no prefetch). On mount nothing is loaded from the backend; `state` defaults to `"Maharashtra"`.
- **Submit (`handleComplete`)** is enabled only when `canSubmit` (`firstName` non-empty AND `district` non-empty). It calls `completeOnboarding(...)` (single transactional save of name + location + first farm), then `updateUser({ onboardingStep: 'COMPLETE', totalFarms: 1, ... })`. Defaults applied: `farmName` falls back to `"<firstName>'s Farm"`, `soilType` to `'UNKNOWN'`, `irrigationType` to `'RAINFED'`, `landSizeAcres` parsed from text or null.
- **Skip (`handleSkip`)** calls `skipOnboarding()` then `updateUser({ onboardingStep: 'COMPLETE' })`.
- **Profile photo (`handlePickPhoto`)** is uploaded eagerly (not at submit): requests media-library permission, picks/edits a square image, validates extension/mime (jpg/jpeg/png/webp), compresses via `compressImage`, then `PUT /users/me` as multipart `FormData` and stores the returned avatar URL via `updateUser`.
- **GPS (`captureGPS`)** requests foreground location permission and captures lat/lng with `expo-location`; the values are passed to `completeOnboarding` but the screen does no reverse-geocoding (it only displays the captured coordinates).
- A progress bar at the top reflects how many of 4 logical sections are filled (name, district, land+soil, crops).
- **Loading/error:** `saving` shows a spinner in the submit button; `uploadingPhoto` shows a spinner in the camera badge; `gpsLoading` shows "Getting location...". Failures surface via `Alert` (photo upload, GPS, complete, skip).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Forest-green gradient surface + blob | Background | Themed onboarding backdrop. |
| Back button | Header icon button | `arrow-back` → `navigation.goBack()` (to language screen). |
| Header title + subtitle | Text | `t('onboarding.profileTitle')` / `t('onboarding.nameSub')`. |
| Progress bar | Gradient fill bar | Width = filled-section count / 4 (min 8%). |
| Avatar picker | Image / initial placeholder + camera badge (`TouchableOpacity`) | Tap opens gallery picker; shows uploaded photo or first-letter initial; spinner while `uploadingPhoto`. Hint text "tap to add photo". |
| First name input | `TextInput` (required) | `firstName`, maxLength 50. |
| Last name input | `TextInput` | `lastName`, maxLength 50. |
| State picker | `LocationPicker` (modal dropdown) | `STATE_LIST`; changing state resets district & taluka. |
| District picker | `LocationPicker` (required) | `getDistrictsForState(state)`; disabled until a state is chosen; resets taluka on change. |
| Taluka picker / input | `LocationPicker` (Maharashtra) or `TextInput` (other states) | For Maharashtra uses `getTalukas(district)`; otherwise free-text. |
| Village input | `TextInput` | `village`. |
| Pincode input | `TextInput` (numeric, maxLength 6) | `pincode`. |
| GPS button | Dashed `TouchableOpacity` | "Auto-detect from GPS" → `captureGPS`; shows captured coords / "Getting location..." / checkmark. |
| Farm name input | `TextInput` | `farmName`, placeholder "<name>'s Farm", maxLength 60. |
| Total land input | `TextInput` (decimal-pad, centred) | `landSize` in acres. |
| Soil type grid | 7 gradient square cards (`SoilIcon` art) | Single-select of `SOILS` (Black Cotton, Red, Alluvial, Sandy, Clay Loam, Laterite, Not Sure); selected card shows checkmark. |
| Irrigation chips | 5 chips (`IrrigationIcon` art) | Single-select of `IRRS` (Drip, Sprinkler, Flood, Rainfed, Mixed); selected chip shows check-circle. |
| Crop grid | 24 crop cards (`CropIcon`) + count badge | Multi-select toggle of `CROPS`; selected count shown in a badge. |
| "Other" crop card | Card toggle | Reveals a manual crop-entry row. |
| Custom crop input + add button | `TextInput` + add `TouchableOpacity` | Type a crop name and add it; `autoFocus`, maxLength 30, submit-on-enter. |
| Custom crop chips | Removable pills | Each user-added crop shows as a chip with a close (`close-circle`) to remove. |
| Skip button | Secondary CTA | `t('onboarding.skip')` → `handleSkip`. |
| Complete Setup button | Primary CTA (gradient) | `handleComplete`; disabled until name+district filled; label toggles "Complete Setup" / "Fill name & district"; spinner while `saving`. |

## Services, APIs & data
- **API endpoints:**
  - `POST /api/v1/onboarding/complete` via `services/farmApi.js` → `completeOnboarding(data)` (`api.post('/onboarding/complete', data)`).
  - `POST /api/v1/onboarding/skip` via `services/farmApi.js` → `skipOnboarding()` (`api.post('/onboarding/skip')`).
  - `PUT /api/v1/users/me` via `services/api.js` (`api.put('/users/me', formData)`) — multipart avatar upload.
- **Backend route/service:** `backend/src/routes/onboarding.routes.js` (`POST /complete` single-transaction save of name + location + first farm; `POST /skip`). Avatar upload handled by `backend/src/routes/user.routes.js` (`PUT /me`, `avatarUpload` multer middleware).
- **State / context:** `useAuth()` (`updateUser`); `useLanguage()` (`t`); many local `useState` fields; `scrollRef`. Web scroll helpers `useAbsoluteBarScrollStyle` / `webScreenContainer`.
- **Local / static data:** `SOILS`, `IRRS`, `CROPS` constants in-file; `STATE_LIST`, `getDistrictsForState`, `getTalukas` from `constants/locations`; `compressImage` from `utils/mediaCompressor`; soil/irrigation/crop icon components.

## Languages / i18n
- Uses `useLanguage().t` with the `onboarding.*` and `farmProfile.*` namespaces (e.g. `onboarding.profileTitle`, `onboarding.yourName`, `farmProfile.farmLocation`, `farmProfile.soilType`, `crops.*`). Soil/irrigation/crop labels use `t(key, fallback)` with English fallbacks.
- A few strings are hard-coded English literals (e.g. "Total Land (acres)", "Auto-detect from GPS", "Complete Setup", "Fill name & district").

## Notes, edge cases & gaps
- Photo upload happens immediately on pick (separate `PUT /users/me`), independent of the final submit; if it fails the avatar is reset and an alert shown.
- Validation is minimal: only first name (≥1 char) and district required; soil/irrigation default server-side enums when blank.
- GPS coordinates are captured and sent but not reverse-geocoded into address fields on this screen.
- Taluka behaves differently per state (dropdown only for Maharashtra; free text elsewhere).
- **Legacy / dead code:** The sibling screens `OnboardingNameScreen.js`, `OnboardingLocationScreen.js`, `OnboardingFarmScreen.js` and `OnboardingCropsScreen.js` exist in `frontend/src/screens/Onboarding/` but are **not registered in any navigator** — `OnboardingNavigator` only wires `OnboardingLanguage` + `OnboardingProfile`. Those four screens `navigation.navigate('OnboardingLocation'/'OnboardingFarm'/...)` to route names that no longer exist, so they are an earlier multi-step version superseded by this single-screen `OnboardingProfileScreen`. The `ProfileSetup/` folder (see `profile-setup-flow.md`) is a separate, also-unwired redesigned wizard.
