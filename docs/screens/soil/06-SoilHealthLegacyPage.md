# Soil Health (legacy manual-entry screen)

> **Tab:** AI Assistant (not currently routed) · **Stack:** intended `AINavigator` (AIStack) · **Route name:** _not registered_ (orphaned) · **File:** `frontend/src/screens/AI/SoilHealthScreen.js`

## Purpose
A single-screen, tabbed soil tool (New Test / Report / History) for manually entering soil parameters and getting ICAR-based fertilizer recommendations. It pre-dates the "cosmic" Soil Hub redesign. The values it captures, ratings it shows, and recommendation flow it drives are essentially the union of what the newer `SoilForm`, `SoilReport`, and history screens now do separately.

## Where it sits / how you reach it
- **Reached from:** Nothing in the current build. In `AppNavigator.js` the `SoilHealth` (and `SoilHub`) route name is bound to `SoilHubScreen`, NOT to this file — so `SoilHealthScreen` is imported by no navigator and is effectively dead code retained for reference.
- **Navigates to:** Only `navigation.goBack()` (header back). All other navigation is internal tab switching (`form` / `report` / `history`) within the same screen; the crop picker is a modal.
- **Route params in:** none (reads no `route.params`).

## How it works
On mount it loads the crop list via `getCrops()`. When the `history` tab is selected it loads `getSoilReports()`. The form keeps all 9 parameter values in a single `formData` object plus `fieldName` and `targetCrop`. `handleSubmit` validates that the four required keys (`ph`, `nitrogen`, `phosphorus`, `potassium`) are present, then POSTs via `submitSoilReport(payload)`. On success it stores the returned `report`, and if a `targetCrop` is set it fetches `GET /soil/recommendation` (params `soilId`, `crop`, `area: 1`, `unit: 'acre'`) and stores `fertilizers`, then switches to the `report` tab. The report tab renders a health-score card, per-parameter `HealthBar`s (color + fill driven by the rating group), and either a "select a crop" prompt or the fertilizer list. The history tab is a `FlatList`; tapping a row loads it into the report tab. Errors set an inline `error` string; loading shows an `ActivityIndicator` on the submit button.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header + back | Header | `chevron-back` → `goBack()`; title `soilHealth.soilHealth`, subtitle "ICAR Soil Health Card Norms" |
| Tab row | Segmented tabs | `New Test` / `Report` / `History` — sets `tab` state |
| Field name input | TextInput | Optional field name (`soilHealth.fieldNameOptional`) |
| 9 parameter rows | TextInput (decimal-pad) | pH, N, P, K (required, starred), Organic Carbon, EC, Zinc, Boron, Sulphur (optional); each with hint + unit |
| "Target crop" selector | Touchable (opens modal) | Leaf icon + chosen crop or "Select crop"; opens crop picker modal |
| Error text | Text | Inline validation / submission error |
| "Analyze Soil" | Primary button | `handleSubmit`; spinner while `loading` |
| Empty report state | View | Flask icon + "submit a soil test first" + "Start test" button (→ form tab) |
| Report title | Text | `report.fieldName` |
| Health score card | Card | `report.healthScore` % colored green/amber |
| `HealthBar` (per param) | Card with bar | Rating badge (uppercased), colored progress bar (80/50/25% by rating group), advice text |
| Recommendation prompt card | Card | Crop selector + "Get Recommendations" button when no fertilizers loaded |
| Fertilizer cards | List items | Flask icon, name, `qty unit`, optional `adjustment` |
| History list | FlatList | Per-row field name, date, pH; tap → loads into report tab |
| History empty state | View | Document icon + "No records yet" |
| Crop picker modal | Bottom-sheet Modal | `FlatList` of crops with `CropIcon`, name + Hindi name; "Cancel" closes |

## Services, APIs & data
- **API endpoints:**
  - `POST /soil/manual` via `submitSoilReport()` (`services/aiApi.js`).
  - `GET /soil/reports` via `getSoilReports()`.
  - `GET /soil/recommendation` called directly via `api.get('/soil/recommendation', { params: { soilId, crop, area, unit } })` (uses raw `services/api.js`, not the `getSoilRecommendation` wrapper).
  - `GET /crops` via `getCrops()`.
- **Backend route/service:** `backend/src/routes/soil.routes.js` (`/manual`, `/reports`, `/recommendation`); recommendation engine `generateFertilizerRec()` + `rateSoilParam()` there.
- **State / context:** `useLanguage()`; local `useState` for `tab`, `formData`, `fieldName`, `targetCrop`, `loading`, `report`, `fertilizers`, `history`, `crops`, `cropModal`, `error`. Wrapped in `AnimatedScreen`.
- **Local / static data:** `PARAM_FIELDS` (9 fields, defined inline here — note this differs from the 12-field list in `soilShared.js`), `RATING_COLORS` map, uses `COLORS` from `constants/colors` and `CropIcon` from `components/CropIcons`.

## Languages / i18n
Uses the `soilHealth.*` namespace (e.g. `soilHealth.newTest`, `soilHealth.enterSoilParameters`, `soilHealth.analyzeSoil`, `soilHealth.getRecommendations`). Parameter labels have inline Hindi (`hi`) variants selected via `language === 'hi'`. The `soilHealth` namespace exists in both English and Hindi in `i18n/translations.js`.

## Notes, edge cases & gaps
- **Orphaned screen:** not reachable in the running app; the live Soil experience is the `SoilHubScreen` + form/report/scan/guide set. Documented for completeness.
- Uses the light-theme `COLORS` palette and `AnimatedScreen`, unlike the dark cosmic Soil Hub screens.
- Defines its own 9-field `PARAM_FIELDS` (no iron/manganese/copper) that drifted from the shared 12-field definition in `soilShared.js`.
- The Hindi-label selection logic (`f[language] || f.hi && language === 'hi' ? f.hi : f.label`) is fragile operator-precedence code but falls back to the English label in practice.
- Recommendation fetch failures are silently swallowed (empty `catch {}`).
