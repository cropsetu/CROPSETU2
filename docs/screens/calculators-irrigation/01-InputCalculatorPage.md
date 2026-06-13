# Input Calculator

> **Tab:** AI Assistant (`AIAssistant`) · **Stack:** `AINavigator` (AIStack) · **Route name:** `InputCalculator` · **File:** `frontend/src/screens/AI/InputCalculatorScreen.js`

## Purpose
Estimates the per-season cost of growing a crop on a given plot — seed, fertilizer, labour, pesticides and irrigation — broken down by category and item. The farmer picks a crop, enters the area + unit, optionally flips on an organic-farming mode, and taps **Calculate** to get a total cost, cost-per-acre figure, an expected yield range and an itemized cost list. Used by farmers planning the input budget for a crop cycle.

## Where it sits / how you reach it
- **Reached from:** Registered as `InputCalculator` in the AI stack (`AppNavigator.js` → `AINavigator`). The only in-app navigation entry point found is **`FarmDetailScreen`** (`frontend/src/screens/FarmProfile/FarmDetailScreen.js:241`), which calls `navigation.navigate('AIAssistant', { screen: 'InputCalculator' })`. A matching service tile (`aiHome.tools.inputs` — "Input Calculator / Seed, fertilizer & labour cost") exists in i18n, but it is **not** currently rendered in the `QUICK_SERVICES` / `AI_TOOLS` grids of `AIAssistantHome.js`.
- **Navigates to:** Only `navigation.goBack()` (header back chevron). No outbound navigation to other screens.
- **Route params in:** none — the screen reads no `route.params`; all inputs come from local state.

## How it works
- **On mount:** a single `useEffect` calls `getCrops()` and stores the result in `crops` (used only to populate the crop-picker modal). Failures are swallowed silently (`.catch(() => {})`).
- **Key state:** `crop`, `area`, `unit` (default `'acre'`), `organic` (bool), `result`, `loading`, `error`, `crops`, plus two modal visibility flags `cropModal` and `unitModal`.
- **Crop selection:** tapping the crop selector opens a bottom-sheet `Modal` with a `FlatList` of crops; selecting one sets `crop` and closes the modal.
- **Unit selection:** tapping the unit button opens a second `Modal` listing the four units from `UNITS = ['acre','hectare','bigha','guntha']`.
- **Submit (`handleCalculate`):** validates that a crop is selected and that `area` is a positive number; on failure it sets a localized `error` string and returns. On success it sets `loading`, calls `calculateInputs(crop, parseFloat(area), unit, organic)`, stores the response in `result`, and clears `loading` in a `finally`.
- **Results render:** when `result` is set it shows (1) a **summary card** (crop · area · total cost · cost-per-acre · optional yield range), (2) a **cost-breakdown card** with horizontal percentage bars for each of seed/fertilizer/labour/pesticide/irrigation (only keys present in `result.costBreakdown` with a truthy value are rendered, percentage = `val / summary.totalCost * 100`), (3) an **itemized list** of `CostItem` rows, and (4) a `disclaimer` string from the response.
- **Loading & error handling:** the Calculate button shows an `ActivityIndicator` and is disabled while `loading`. Errors surface as a red inline text line above the button, sourced from `err.response.data.error.message` with a `'Calculation failed'` fallback.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back chevron | Header button (`chevron-back`) | `navigation.goBack()` |
| Header title + subtitle | Text | `t('inputCalc.inputCalculator')` / `t('inputCalc.seedFertilizerLabour')` ("Seed · Fertilizer · Labour") |
| Crop selector | Touchable row (leaf icon + chevron-down) | Opens crop-picker modal; shows selected crop or "Select Crop" placeholder |
| Area input | `TextInput` (`decimal-pad`) | Numeric area value; placeholder `t('inputCalc.areaNumber')` |
| Unit button | Touchable (chevron-down) | Shows current `unit`; opens unit-picker modal |
| Organic toggle | Touchable row + checkbox | Flips `organic` boolean; checkmark shown when active |
| Error text | Text (red) | Validation / API error message, conditional |
| Calculate button | Primary button | `handleCalculate`; shows spinner + disabled while `loading`; label `t('inputCalc.calculateCost')` ("Calculate Cost →") |
| Summary card | Card | Crop · area · **total cost** (₹), cost-per-acre, optional yield range (min–max + unit) |
| Cost breakdown card | Card with bars | Per-category rows (Seed/Fertilizer/Labour/Pesticides/Irrigation) each with label, colored percentage bar and ₹ value |
| Itemized details list | List of `CostItem` cards | One card per `result.items[i]`: category icon, category label, item name, optional quantity/unit/unitPrice, optional note, and cost (`₹…` or "Market" when `cost == null`) |
| Disclaimer | Text | `result.disclaimer` |
| Crop-picker modal | Bottom-sheet `Modal` + `FlatList` | Lists crops (`item.name` + optional `item.nameHi`); Cancel button closes |
| Unit-picker modal | Bottom-sheet `Modal` | Lists the 4 units; selected unit highlighted; Cancel button closes |

`CostItem` resolves its icon/color via `getCategoryConfig`, matching the item's category against `CATEGORY_ICONS` (Seed=ellipse, Fertilizer=flask, Labour=people, Pesticides=bug, Irrigation=water), falling back to a generic `cube` icon.

## Services, APIs & data
- **API endpoints:**
  - `POST /inputs/calculate` via `calculateInputs(crop, area, unit, organic)` in `services/aiApi.js` — body `{ crop, area, unit, organic }`; returns `{ crop, areaAcres, summary: { totalCost, costPerAcre, yieldRange }, costBreakdown, items[], disclaimer }`.
  - `GET /crops` via `getCrops()` in `services/aiApi.js` — populates the crop-picker list.
  - Both go through the shared `api` axios instance (`services/api.js`, base `API_BASE_URL`) with auth-token injection via interceptors.
- **Backend route/service:** `backend/src/routes/inputs.routes.js` (fertilizer/seed/labour cost math) and `backend/src/routes/crops.routes.js`. The cost computation is **server-side** — this screen does no local math beyond computing the breakdown-bar percentages from the returned values.
- **State / context:** `useLanguage()` (for `t`); all other state is local `useState`. No AuthContext, writeQueue, or socket usage on this screen.
- **Local / static data:** `UNITS` (acre/hectare/bigha/guntha), `CATEGORY_ICONS` icon+color map. `COLORS` from `constants/colors`. Wrapped in `AnimatedScreen` (`components/ui/AnimatedScreen`) for entry animation.

## Languages / i18n
Uses the `inputCalc.*` i18n namespace via `useLanguage().t` (e.g. `inputCalc.inputCalculator`, `inputCalc.selectCrop`, `inputCalc.calculateCost`, `inputCalc.costBreakdown`, `inputCalc.itemizedDetails`, `inputCalc.seed/fertilizer/labour/pesticides/irrigation`, `inputCalc.yield`, `inputCalc.cancel`, validation strings `selectACrop`/`enterAValidArea`). The namespace is defined across all language blocks in `frontend/src/i18n/translations.js`, so the screen is multi-language. Crop names additionally show a Hindi sub-label (`item.nameHi`) when present. The breakdown-bar `result.disclaimer` text is returned by the backend, not localized client-side.

## Notes, edge cases & gaps
- **Validation:** blocks calculation if no crop is selected or area is non-numeric / ≤ 0.
- **Empty/loading states:** no dedicated empty state before first calculation — results simply don't render until `result` is set. Crop modal has no loading/empty handling (relies on `getCrops` having resolved; a failed fetch leaves an empty list with no message).
- **Cost display:** items with `cost == null` render the literal "Market" instead of a price; breakdown rows for categories absent/zero are skipped.
- **Yield range** only renders when `result.summary.yieldRange` is an object (defensive `typeof === 'object'` check); unit defaults to `q/acre`.
- **Offline:** no offline fallback — a failed API call shows the inline error and nothing is cached.
- No image picker, voice, search bar, or socket on this screen — purely a form + results view.
