# Crop Detail

> **Tab:** AI Assistant · **Stack:** AIStack · **Route name:** `CropDetail` · **File:** `frontend/src/screens/Weather/CropDetail.js`

## Purpose
A detail view for a single crop showing its key agronomic facts (best sowing time, total duration, harvest time, water need, ideal temperature, best soil) and an interactive growth-stage timeline. Farmers use it to understand the full crop cycle stage-by-stage, with day offsets, durations and per-stage tips.

## Where it sits / how you reach it
- **Reached from:** `CropCalendar` (`navigation.navigate('CropDetail', { crop, cropName })`) and `StateCropsScreen` (`openCropDetail` → same navigate call). Registered in `AINavigator` (AIStack) with a dynamic header title: `route.params?.cropName || t('nav.cropDetails')`.
- **Navigates to:** none (leaf screen; back via the stack header).
- **Route params in:** `crop` (the full crop object, required — read as `route.params.crop`) and `cropName` (used only for the header title).

## How it works
- Reads `crop` from `route.params`. Local state `activeStageIndex` defaults to `1` (the second stage) and drives the highlighted stage detail and the active styling in the timeline.
- `hasStages` checks `Array.isArray(crop.stages) && length > 0`; the entire timeline section is rendered only when stages exist. `totalDays` is computed from the last stage's `day + duration`.
- Interaction: the horizontal stage-selector chips set `activeStageIndex`; the "active stage detail" panel and each `StageCard`'s active border react to it. `StageCard` colors cycle through `STAGE_COLORS` and draw a per-stage progress bar based on `(index+1)/total`.
- No data fetching, loading or error states — it is a pure presentational screen driven entirely by the passed `crop` object inside a `ScrollView`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header (stack) | Navigation header | Title = `cropName` param (or `nav.cropDetails`). |
| Crop header | Hero block | Big emoji icon, English + Hindi name, season badge with calendar icon. |
| Summary grid | 6 info cards | Best sowing time, total duration, harvest time, water needed, ideal temperature, best soil — each an icon + value + label. |
| Growth timeline title | Section title + subtitle | `cropGrowthTimeline` + `stagesSummary` (stage count + total days). Only if `hasStages`. |
| Stage selector | Horizontal chip scroll | One chip per stage ("1. <first word>"); tapping sets `activeStageIndex`; active chip highlighted. |
| Active stage detail | Highlighted panel | Shows selected stage name (+ Hindi), "starts day", duration in days, and a tip box with bulb icon. |
| Full timeline | Vertical timeline list | `StageCard`s with numbered timeline dots + connector lines; active stage gets a colored 2px border and enlarged dot. |
| Stage card | Timeline item | Stage name (+Hindi), day badge, duration row, tip row, progress bar + "% crop cycle" label. |

## Services, APIs & data
- **API endpoints:** none — fully static/local, rendered from the `crop` route param.
- **Backend route/service:** none directly. Crop data originates upstream from `GET /weather/crops` (`backend/src/routes/weather.routes.js`) via `CropCalendar`, or from local `data/stateCrops.js` via `StateCropsScreen`.
- **State / context:** `useLanguage()` for `t()`; local `useState` for `activeStageIndex`.
- **Local / static data:** `STAGE_COLORS` palette; `COLORS`, `SHADOWS` from `constants/colors`. All crop facts and stages come from the passed object.

## Languages / i18n
Crop name is bilingual from the data (`name` + `nameHi`), as are stage names (`stage.name` + `stage.nameHi`). UI labels use the `cropDetail.*` namespace: `bestSowingTime`, `totalDuration`, `harvestTime`, `waterNeeded`, `idealTemperature`, `bestSoil`, `varies`, `cropGrowthTimeline`, `stagesSummary`, `startsDay`, `dayLabel`, `daysDuration`, `percentCropCycle`. Header fallback uses `nav.cropDetails`.

## Notes, edge cases & gaps
- No stages → the timeline section is entirely hidden; only the header + summary grid render (this is the case for `CROP_FALLBACK` crops from CropCalendar, which lack a `stages` array).
- `activeStageIndex` starts at `1`; if a crop has only one stage this index is out of range for the "active stage detail" panel (`crop.stages[1]` would be undefined). In practice crops shown here have multiple stages, but it is a latent edge case.
- Some summary values are defensive: `waterNeeded` is split on `(` and falls back to `varies`; `numberOfLines={2}` clamps long soil/water strings.
- No loading/error/empty UI because there is no async work.
