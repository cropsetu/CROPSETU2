# Govt Schemes

> **Tab:** AI Assistant · **Stack:** `AINavigator` (AIStack) · **Route name:** `Scheme` · **File:** `frontend/src/screens/AI/SchemeScreen.js`

## Purpose
A browseable directory of government farmer-welfare schemes (PM-KISAN, PMFBY, KCC, Soil Health Card, PKVY). Each scheme card shows the benefit, eligibility status, and — when expanded — full eligibility criteria, how-to-apply steps, deadline and an "Apply Now" call-to-action. It lets a farmer quickly see which central schemes apply to them and read the key details without leaving the app. An "Ask AI about my eligibility" button hands off to the AI chat for a personalised eligibility check.

## Where it sits / how you reach it
- **Reached from:**
  - `ProfileScreen.js` — a card calls `navigation.navigate('AIAssistant', { screen: 'Scheme' })` (jumps from the Account tab into the AI stack's `Scheme` route).
  - Registered in `AppNavigator.js` as `<AIStack.Screen name="Scheme" component={SchemeScreen} />` with `headerShown: false`.
- **Navigates to:**
  - **AI Chat** — the "Ask AI" button at the bottom of the list runs `navigation.navigate('AIChat', { initialMessage: 'Which government schemes am I eligible for?' })`.
  - **Back** — the header back chevron calls `navigation.goBack()`.
  - (The per-card "Apply Now" button is a styled `TouchableOpacity` with no `onPress` handler — it is currently inert / a visual placeholder.)
- **Route params in:** none.

## How it works
- The screen renders entirely from a **hard-coded local `SCHEMES` array** (5 schemes). There is no network fetch on mount; nothing loads asynchronously.
- Local state: `expanded` (the id of the currently expanded scheme card, or `null`) and `search` (the search query string).
- `filtered` recomputes on every render by matching the search text (case-insensitive) against each scheme's `name`, `fullName`, or `benefitType`.
- `eligible` counts how many of the *filtered* schemes have `status === 'eligible'` and is shown in the header badge. The summary chips instead count over the full `SCHEMES` array (not the filtered set).
- Tapping a card toggles `expanded`; the `SchemeCard` component animates an `Animated.Value` (`heightAnim`, 300ms) on expand/collapse and swaps the chevron between up/down. Expanded body shows description, eligibility bullet list, apply instructions, deadline row, and the Apply Now button.
- No loading or error states exist because there is no async work — the only empty path is "no search matches".

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back button | `TouchableOpacity` + `chevron-back` icon | Top-left; `navigation.goBack()`. |
| Header title + subtitle | Text (`scheme.title`, `scheme.subtitle`) | Screen heading. |
| Eligible count badge | Text block (top-right) | Shows count of filtered eligible schemes + `scheme.eligible` label. |
| Search bar | `TextInput` with `search-outline` icon | Placeholder `scheme.searchPlaceholder`; filters by name / full name / benefit type. |
| Summary row | Card with 3 chips + dividers | Eligible count, "₹59,000" max annual benefit (hard-coded), total scheme count. |
| Scheme card | `TouchableOpacity` (`SchemeCard`) | Tap toggles expand/collapse. |
| Scheme icon | `Ionicons` in tinted circle | Per-scheme icon/color. |
| Status badge | Badge with icon + label | `eligible` / `check` / `applied` via `STATUS_CONFIG` (label keys `scheme.statusEligible`, `scheme.statusCheck`, `scheme.statusApplied`). |
| Benefit pill | Text block | Benefit value + benefit type. |
| Expand chevron | `Ionicons` (`chevron-up`/`chevron-down`) | Reflects expanded state. |
| Expanded description | Text | Scheme `desc`. |
| Eligibility list | Bullet rows | `scheme.eligibilitySection` header + list of eligibility strings. |
| How-to-apply block | Text | `scheme.howToApply` header + apply text. |
| Deadline row | Icon + text | `calendar-outline` + deadline string. |
| Apply Now button | `TouchableOpacity` (`scheme.applyNow`) | Visual only — no `onPress` wired. |
| Empty state | View (`search` icon + text) | Shown when `filtered.length === 0`; message `scheme.noSchemesFound` with the current search interpolated. |
| Ask AI button | `TouchableOpacity` (`sparkles-outline`) | Footer CTA; navigates to `AIChat` with a prefilled eligibility question (`scheme.askAI`). |

## Services, APIs & data
- **API endpoints:** none — the screen is fully static/local. It imports no service module; all scheme content lives in the in-file `SCHEMES` constant.
- **Backend route/service:** Not called by this screen. A backend `backend/src/routes/schemes.routes.js` does exist (with `GET /`, `GET /eligible`, `GET /:id`, `POST /ask` — the `/ask` handler calls `callClaude` from `claude.service.js`, which is Gemini-backed) but **this screen does not use it**. The only AI hand-off is via the chat screen the "Ask AI" button opens.
- **State / context:** `useLanguage()` for `t()`; local `useState` for `expanded` and `search`; `useSafeAreaInsets()` for top padding. No AuthContext, writeQueue, or socket usage.
- **Local / static data:** `SCHEMES` array (5 schemes), `STATUS_CONFIG` map, `COLORS` from `../../constants/colors`.

## Languages / i18n
- Uses the `scheme.*` namespace via `t()` from `LanguageContext`. Keys seen: `title`, `subtitle`, `eligible`, `searchPlaceholder`, `maxAnnualBenefit`, `totalSchemes`, `statusEligible`, `statusCheck`, `statusApplied`, `eligibilitySection`, `howToApply`, `applyNow`, `noSchemesFound` (interpolates `{ search }`), `askAI`.
- The `scheme` namespace is defined in `src/i18n/translations.js` for English, Hindi and Marathi, plus the per-language files (`bn, gu, kn, ml, pa, ta, te`), so the UI chrome is translatable.
- **Note:** the scheme *content itself* (names, descriptions, eligibility, benefits in the `SCHEMES` array) is hard-coded in English and is **not** translated.

## Notes, edge cases & gaps
- **No backend / live eligibility:** all data is static; "eligible" statuses are baked in, not computed from the user's profile.
- **"Apply Now" is inert** — styled button with no handler; tapping it does nothing.
- **Summary chips vs header badge mismatch:** header eligible count uses the filtered list while the summary chips and "₹59,000" figure are computed from the full list and a hard-coded string, so numbers can diverge while searching.
- Empty state only appears for no-match searches; there is no loading or error UI (nothing async).
- The "Ask AI" CTA is the single dynamic path — it defers the real eligibility Q&A to the AI chat pipeline.
