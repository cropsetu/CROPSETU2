# Irrigation (Smart Watering)

> **Tab:** AI Assistant (`AIAssistant`) · **Stack:** `AINavigator` (AIStack) · **Route name:** `Irrigation` · **File:** `frontend/src/screens/AI/IrrigationScreen.js`

## Purpose
A smart-irrigation scheduler driven by the FAO ET₀ (reference evapotranspiration) method and live Open-Meteo weather. The farmer selects a crop and the screen fetches a per-crop, per-location "irrigate today?" recommendation — a yes/no verdict with a reason, recommended water amount, and the ET₀ / Kc / rainfall inputs behind it — plus a 7-day forecast strip. The farmer can log whether they actually irrigated or skipped, feeding back into their irrigation history.

## Where it sits / how you reach it
- **Reached from:** Registered as `Irrigation` in the AI stack (`AppNavigator.js` → `AINavigator`, `headerShown:false`). An `aiHome.tools.irrigation` service tile ("Irrigation / FAO ET₀ smart watering") is defined in i18n but is **not** rendered in the current `QUICK_SERVICES` / `AI_TOOLS` grids of `AIAssistantHome.js`; no other `navigate('Irrigation')` call was found in `src/screens`, so there is no confirmed in-app entry point in the current code (the route is registered and reachable programmatically). Note: a distinct **`ActivityIrrigationLog`** route (`IrrigationLogScreen`) also exists in the farm-profile flow — this is a different screen.
- **Navigates to:** Only `navigation.goBack()` (header back chevron). No outbound navigation.
- **Route params in:** none — reads no `route.params`. It does read `user?.crops?.[0]` (AuthContext) to pre-select a default crop and GPS `coords` from LocationContext.

## How it works
- **Default crop:** `selectedCrop` initializes from `user?.crops?.[0] || ''`. Nothing is fetched on mount automatically — the user must trigger a fetch by selecting/confirming a crop.
- **Crop modal (lazy):** `openCropModal` calls `getCrops()` only the first time (if `crops` is empty) then opens the modal. Selecting a crop (`selectCrop`) sets `selectedCrop`, closes the modal, and calls `fetchRecommendation(name)`.
- **`fetchRecommendation(crop)`:** if no crop, it just opens the modal. Otherwise it resets `today`/`logId`/`loggedAction`, sets `loading`, derives coordinates as `gpsCoords?.latitude ?? 18.52` and `gpsCoords?.longitude ?? 73.85` (Pune fallback), and calls `getIrrigationToday({ crop, lat, lon })`. On success it stores the response in `today`, `result.id` in `logId`, and `result.weeklyForecast` in `weekly`. Errors set a localized `error` string.
- **Hero card:** rendered when `today` is set. A `LinearGradient` (green gradient when `shouldIrrigate`, dark-blue gradient when not) shows a water/checkmark icon, the verdict title (`irrigateToday` vs `noIrrigationNeeded`), the `reason`, an optional water-required chip (`waterAmount`), and a 3-stat grid of ET₀ (1-dp), Kc, and rainfall (each rendered only if non-null).
- **Logging an action:** when `logId` exists and no action has been logged, two buttons ("I Irrigated" / "Skipped") call `markAction(action)` → `logIrrigation({ logId, farmerAction: action })`. Buttons are disabled while `logging`. On success a "Logged as irrigated/skipped" badge replaces the buttons. Errors are swallowed (`catch {}`).
- **7-day forecast strip:** when `weekly.length > 0`, a horizontal scroll of day cards — weekday (`WEEKDAYS[new Date(day.date).getDay()]`), date number, water/checkmark icon, an optional rainfall row (`rainy` icon + mm, only if `rainfall > 0`), and ET₀ (1-dp). Cards needing water get a blue border.
- **Loading & error handling:** loading shows a centered spinner + "Computing…" text. Errors show a cloud-offline icon, the error message, and a **Retry** button that re-calls `fetchRecommendation(selectedCrop)`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back chevron | Header button | `navigation.goBack()` |
| Header title + subtitle | Text | `t('irrigation.title')` / "FAO ET₀ · Open-Meteo" |
| Crop selector | Touchable row (leaf icon + chevron-down) | `openCropModal`; shows `selectedCrop` or `t('irrigation.selectCrop')` |
| Prompt card | Card (water icon) | Empty state shown when no crop selected and not loading; text `t('irrigation.prompt')` |
| Loading block | `ActivityIndicator` + text | Centered spinner + `t('irrigation.computing')` |
| Error block | Icon + text + Retry button | `cloud-offline` icon, error message, Retry button re-runs `fetchRecommendation` |
| Hero card | `LinearGradient` card | Verdict icon + title (Irrigate Today / No Irrigation Needed), reason, water-required chip, ET₀/Kc/rain stat grid |
| Water-required chip | Inline stat (water icon) | `t('irrigation.waterRequired', { amount })`, shown when `today.waterAmount != null` |
| ET₀ / Kc / Rain stat grid | 3 stat tiles | Values from `today.et0` (1-dp), `today.kc`, `today.rainfall`, each conditional |
| "I Irrigated" button | Action button (water icon, blue) | `markAction('irrigated')`; disabled while `logging` |
| "Skipped" button | Action button (close icon, gray) | `markAction('skipped')`; disabled while `logging` |
| Logged badge | Badge (checkmark) | Replaces action buttons after logging; "Logged as irrigated/skipped" |
| 7-day forecast strip | Horizontal `ScrollView` of day cards | Per-day weekday, date, water/checkmark icon, optional rain (mm), ET₀ |
| Info card | Card (info icon) | Static text `t('irrigation.infoNote')` ("Based on FAO ET₀ method and local weather data") |
| Crop-picker modal | Bottom-sheet `Modal` + `FlatList` | Lists crops with `CropIcon` + name + optional `nameHi`; selected crop highlighted; spinner shown while crops load; Cancel button closes |

The crop-picker modal uses the `CropIcon` component (`components/CropIcons`) to render a per-crop icon next to each name.

## Services, APIs & data
- **API endpoints (all via `services/aiApi.js`, shared `api` axios instance, base `API_BASE_URL`, auth via interceptors):**
  - `GET /irrigation/today` via `getIrrigationToday({ crop, lat, lon })` — returns `{ shouldIrrigate, reason, et0, kc, rainfall, waterAmount, weeklyForecast[], id }`.
  - `POST /irrigation/log` via `logIrrigation({ logId, farmerAction })` — updates the existing log row with the farmer's actual action.
  - `GET /crops` via `getCrops()` — populates the crop-picker modal (lazy).
  - (`getIrrigationWeekly` exists in `aiApi.js` but is **not** used here — the weekly strip comes from `today.weeklyForecast`.)
- **Backend route/service:** `backend/src/routes/irrigation.routes.js` + `backend/src/services/irrigation.service.js` (Hargreaves/FAO ET₀ computation against Open-Meteo data). All irrigation math is **server-side**; the screen only formats returned values (e.g. `Number(et0).toFixed(1)`).
- **State / context:** `useAuth()` (default crop from `user.crops[0]`), `useLanguage()` (`t`), `useLocation()` (`coords` → lat/lon, with a Pune `18.52/73.85` fallback). All other state is local `useState`. No writeQueue or socket.
- **Local / static data:** `WEEKDAYS` array for day labels; `COLORS` from `constants/colors`; gradient color pairs from the palette. Wrapped in `AnimatedScreen`.

## Languages / i18n
Uses the `irrigation.*` namespace via `useLanguage().t` (e.g. `irrigation.title`, `selectCrop`, `selectCropTitle`, `computing`, `failedToLoad`, `irrigateToday`, `noIrrigationNeeded`, `waterRequired` (interpolated with `{ amount }`), `iIrrigated`, `skipped`, `loggedIrrigated`, `loggedSkipped`, `sevenDayForecast`, `rainMm`, `prompt`, `infoNote`, `retry`, `cancel`), defined across language blocks in `frontend/src/i18n/translations.js` → multi-language. The `reason` text in the hero card and `day.date` come from the backend response. The header subtitle "FAO ET₀ · Open-Meteo" and forecast weekday labels are hard-coded English.

## Notes, edge cases & gaps
- **Location permission:** relies on `LocationContext` GPS coords; if permission is denied / coords unavailable it silently falls back to Pune (`18.52, 73.85`) rather than prompting — so recommendations may be for the wrong location.
- **Empty state:** when no crop is selected, a prompt card invites the user to pick one; nothing is fetched until a crop is chosen.
- **Logging is best-effort:** a failed `/irrigation/log` call is swallowed (`catch {}`) — the action badge will not appear and no error is shown.
- **Retry:** the error state offers a Retry button; loading replaces all content with a spinner.
- **Conditional rendering:** ET₀/Kc/rain stats, the water chip, the action buttons (only before logging), and rainfall rows all render conditionally on the presence of their data.
- **Offline:** no caching/offline fallback — a failed fetch shows the error state.
- No image picker, voice, search bar, or socket on this screen.
