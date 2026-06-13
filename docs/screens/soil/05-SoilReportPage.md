# Soil Report

> **Tab:** AI Assistant · **Stack:** `AINavigator` (AIStack) · **Route name:** `SoilReport` · **File:** `frontend/src/screens/AI/SoilReportScreen.js`

## Purpose
Shows a soil report — either the fresh one passed from the form or the farmer's most recent saved report — with a health score, per-parameter ratings, a crop-driven fertilizer plan, general advice, and a "Past tests" strip to switch between reports. An "Ask Soil AI Advisor" button deep-links into chat with the report as context.

## Where it sits / how you reach it
- **Reached from:**
  - `SoilFormScreen` after submit → `navigation.replace('SoilReport', { report: result })`.
  - `SoilHubScreen` "My reports" tile → `navigate('SoilReport')`, and its summary card "View report" → `navigate('SoilReport', { report })`.
- **Navigates to:**
  - `AIChat` via `askSoilAdvisor(navigation, report, language, t)` ("Ask Soil AI Advisor" button).
  - `SoilForm` via the empty-state "Start a test" button.
  - Header back → `goBack()`.
- **Route params in:** `report` (optional) — a soil report object. When absent, the screen loads the most recent saved report.

## How it works
Initial `report` state comes from `route.params.report` or `null`. On mount it fetches `getCrops()` and `getSoilReports()`; the report list populates the history strip, and if no `report` param was passed it loads the detail of the first (most recent) via `getSoilReportDetail(list[0].id)` (falling back to the list item on error). `computeHealthScore` returns `report.healthScore` if present, else the % of ratings whose value is in `GOOD = ['optimal','high','sufficient','low_ec']`; `scoreColor` thresholds at 70/45. Selecting a crop in the modal sets `targetCrop` and calls `loadRecommendation(crop)`, which fetches `getSoilRecommendation(report.id, crop, 1, 'acre')` and stores `fertilizers` + `generalAdvice` (shown as `recAdvice` rows). `switchReport` swaps the active report (loading its detail) and clears the recommendation state. Errors map through `soilHumanError`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Cosmic header | Header (`CosmicHeader`) | Back arrow, FlaskConical icon, title "Soil report", subtitle "ICAR Soil Health Card norms" |
| Empty state | View | FileText icon + "No soil test yet" + "Start a test" button (→ `SoilForm`) when `report` is null |
| Score card | Card | Field name, test/created date, "scanned card" tag when `inputMethod === 'ocr'`, and a score bubble ("{n}% health") colored by score |
| "Ask Soil AI Advisor" | Primary button (Sparkles) | `askSoilAdvisor(...)` → `AIChat` with seed message |
| Parameter ratings | Section + `HealthBar` cards | One per filled param: localized label, value+unit, uppercased rating badge, colored fill bar (`ratingFillPct`), advice text |
| "FERTILIZER PLAN" crop select | Touchable (opens modal) | Leaf icon + chosen crop or "Select your crop"; opens crop picker |
| Loading indicator | ActivityIndicator | While `loadingRec` |
| General advice rows | Cards (amber) | Lines from `generalAdvice` (e.g. low pH / low organic carbon warnings) |
| Fertilizer cards | List items (Beaker) | Name, `qty unit`, optional `adjustment` |
| Error text | Text | Recommendation error (red) |
| Disclaimer | Text (italic) | "Guidance based on ICAR Soil Health Card norms…" |
| "PAST TESTS" strip | List | Shown when `history.length > 1`; rows with field name, date, pH; active row highlighted + dot; tap → `switchReport` |
| Crop picker modal | Bottom-sheet Modal | `FlatList` of crops with `CropIcon`; tapping sets crop, closes, and loads recommendation; "Cancel" closes |

## Services, APIs & data
- **API endpoints (all `services/aiApi.js`):**
  - `GET /soil/reports` via `getSoilReports()` — history + most-recent fallback.
  - `GET /soil/reports/:id` via `getSoilReportDetail(id)` — full report detail.
  - `GET /soil/recommendation` via `getSoilRecommendation(soilId, crop, area, unit)` — fertilizer plan + general advice.
  - `GET /crops` via `getCrops()` — crop picker options.
- **Backend route/service:** `backend/src/routes/soil.routes.js` (`/reports`, `/reports/:id`, `/recommendation`). Recommendation engine `generateFertilizerRec()` adjusts base crop fertilizer doses ±25% by N/P/K rating and adds micro-nutrient/lime/FYM entries; `generalAdvice` and `disclaimer` are returned (partly in Hindi from the backend).
- **State / context:** `useLanguage()` (`t`, `language`); local `useState` for `report`, `history`, `crops`, `cropModal`, `targetCrop`, `fertilizers`, `recAdvice`, `loadingRec`, `error`. No writeQueue/socket.
- **Local / static data:** `GOOD` ratings constant + `computeHealthScore` (local); `PARAM_FIELDS`, `fieldLabel`, `ratingColor`, `ratingFillPct`, `soilHumanError`, `CosmicHeader`, theme tokens from `./components/soilShared`; `askSoilAdvisor` from `./components/soilAdvisor`; `CropIcon` from `components/CropIcons`.

## Languages / i18n
Uses the `soilHub.report.*` namespace (e.g. `soilHub.report.title`, `soilHub.report.askAdvisor`, `soilHub.report.ratings`, `soilHub.report.fertilizer`, `soilHub.report.selectCrop`, `soilHub.report.disclaimer`, `soilHub.report.past`, `soilHub.report.empty`, `soilHub.report.scanned`) plus shared `soilHub.summary.myField`. `HealthBar` shows the Hindi rating (`rating.ratingHi`) when `language === 'hi'`; field labels via `fieldLabel`. Backend `generalAdvice`/`disclaimer` strings arrive in Hindi.

## Notes, edge cases & gaps
- A bare `getSoilReports()` list item (from `/reports`) carries only a subset of fields (`id, fieldName, testDate, ph, nitrogen, organicCarbon, ratings, inputMethod, createdAt`); the screen upgrades to the full record via `getSoilReportDetail` when switching/loading.
- `HealthBar` renders only when a param has a rating or a non-null value, so partial reports show fewer bars.
- Recommendation/detail fetch failures are caught: history/crops load best-effort, recommendation errors surface via `soilHumanError`.
- The "Past tests" strip only appears with more than one report.
- The advisor seed message is built from the report's measured values + ratings; farm context (soil type, crops, location) is injected server-side, not here.
