# Enter Soil Test (Soil Form)

> **Tab:** AI Assistant · **Stack:** `AINavigator` (AIStack) · **Route name:** `SoilForm` · **File:** `frontend/src/screens/AI/SoilFormScreen.js`

## Purpose
The manual-entry form for soil test values — and the verification step for OCR scans. When opened plainly, the farmer types their 12 Soil Health Card values. When opened with `route.params.prefill` (handed off from `SoilScan`), the fields come pre-filled with AI-read values and a "please verify" banner appears. Nothing is ever saved without the farmer's explicit tap.

## Where it sits / how you reach it
- **Reached from:**
  - `SoilHubScreen` "Enter values" tile → `navigation.navigate('SoilForm')`.
  - `SoilScanScreen` after a successful OCR read → `navigation.replace('SoilForm', { prefill, inputMethod: 'ocr', notes })`.
  - `SoilScanScreen` manual fallback / `SoilReportScreen` empty state / `SoilGuideScreen` "Enter values" → `navigate('SoilForm')`.
- **Navigates to:** `SoilReport` via `navigation.replace('SoilReport', { report: result })` after a successful submit. Header back → `goBack()`.
- **Route params in:** `prefill` (object of `{key: number|null}` from OCR), `inputMethod` (`'ocr'` when handed off from scan), `notes` (OCR notes string). All optional.

## How it works
Initial `formData` is built lazily from `prefillToForm(prefill)`, which copies only non-empty values for the 12 `PARAM_FIELDS` keys and stringifies them. `fromOcr` is true when `inputMethod === 'ocr'` and controls the title ("Review values" vs "Enter soil test") and the verify banner. `handleSubmit` loops `REQUIRED_KEYS` (the 4 starred fields: pH, N, P, K) and sets an inline error naming the first missing field. On pass, it builds a payload with `fieldName` (or a localized default), all `formData`, and `inputMethod: 'ocr'` when from OCR, then POSTs via `submitSoilReport(payload)` and `replace`s to `SoilReport`. Errors are mapped through `soilHumanError(err, t)`. A spinner shows on the submit button while `loading`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Cosmic header | Header (`CosmicHeader`) | Back arrow, ClipboardList icon, title "Review values"/"Enter soil test", subtitle "ICAR Soil Health Card norms" |
| OCR verify banner | Banner (AlertTriangle) | Only when `fromOcr`; shows OCR `notes` or default "AI-read values — please verify" copy |
| Field name input | TextInput | Optional field name placeholder |
| Section label + required note | Text | "SOIL PARAMETERS" + "* required" |
| 12 parameter rows | TextInput (decimal-pad) per row | pH, N, P, K (starred/required), Organic Carbon, EC, Sulphur, Zinc, Iron, Manganese, Copper, Boron — each with localized label, "normal: {hint} {unit}" sub-line, and unit suffix |
| Info note | Text (Info icon) | "You can fill only what you have. The 4 starred fields are needed for a score." |
| Error text | Text | Inline validation / submit error (red) |
| "Analyze my soil" | Primary button | `handleSubmit`; `ActivityIndicator` while loading |

## Services, APIs & data
- **API endpoints:** `POST /soil/manual` via `submitSoilReport(payload)` (`services/aiApi.js`). Payload carries the 12 named fields plus optional `fieldName` and `inputMethod`.
- **Backend route/service:** `backend/src/routes/soil.routes.js` → `POST /api/v1/soil/manual` (validates each numeric field's range, builds `ratings` via `rateSoilParam`, computes `healthScore`, persists `inputMethod`, gated by `soil_health` feature flag).
- **State / context:** `useLanguage()` (`t`, `language`); local `useState` for `formData`, `fieldName`, `loading`, `error`. No writeQueue/socket.
- **Local / static data:** `PARAM_FIELDS`, `REQUIRED_KEYS`, `fieldLabel`, `soilHumanError`, theme tokens, and `CosmicHeader` all from `./components/soilShared`. The local `prefillToForm` helper maps the OCR object into editable strings.

## Languages / i18n
Uses the `soilHub.form.*` namespace (e.g. `soilHub.form.title`, `soilHub.form.reviewTitle`, `soilHub.form.ocrBannerTitle`, `soilHub.form.required`, `soilHub.form.normal`, `soilHub.form.partialOk`, `soilHub.form.analyze`, `soilHub.form.requiredField`). Parameter labels are localized via `fieldLabel(f, language)` (Hindi when `language === 'hi'`). Errors localized via `soilHumanError`. All `t()` calls carry English fallbacks.

## Notes, edge cases & gaps
- The 12 fields and their `required` flags come from the single shared `PARAM_FIELDS` in `soilShared.js`, keeping the form, OCR handoff, and report in sync with the backend `/soil/manual` contract.
- `navigation.replace` (not `navigate`) is used both inbound from scan and outbound to report, so the OCR/form step doesn't linger in the back stack.
- Only the 4 starred fields are enforced; partial submissions (any subset including the required four) are allowed — backend also requires at least one parameter.
- `soilHumanError` maps HTTP 402 (out of credits), 429 (rate limit), 413 (too large), 504/503/500/502, and network errors to friendly localized lines.
