# State Crops

> **Tab:** AI Assistant · **Stack:** AIStack · **Route name:** `StateCrops` · **File:** `frontend/src/screens/Weather/StateCropsScreen.js`

## Purpose
Lets a farmer browse the major crops and farming types of any Indian state, with a per-state overview (climate, specialty, soil types, water sources). It auto-detects the user's state from device GPS on first open and lets them switch states via a search modal or quick-switch chips. Each crop card links into the shared `CropDetail` timeline.

## Where it sits / how you reach it
- **Reached from:** Registered in `AINavigator` (AIStack) as `StateCrops` with `headerShown: false` (the screen draws its own green header). Reachable via `navigation.navigate('StateCrops', { state })` from elsewhere in the AI tab (e.g. weather/region entry points).
- **Navigates to:** `CropDetail` — `openCropDetail` calls `navigation.navigate('CropDetail', { crop, cropName: crop.name })`. Back arrow → `navigation.goBack()`.
- **Route params in:** `state` (optional) — a pre-selected state key. When present, auto-detection is skipped.

## How it works
- Initial state: `selectedState` = `route.params?.state` or `'Maharashtra'`. `stateData = STATE_CROPS[selectedState]`.
- Auto-detect (`detectLocation`): on first mount, only when no `state` param was passed, it reads GPS `coords` from `LocationContext`, reverse-geocodes via `Location.reverseGeocodeAsync`, builds a region/subregion/city string, and runs `detectStateFromLocation(locStr)`; a match calls `switchState`. Failures keep the current state silently. A header `ActivityIndicator` shows while `detecting`.
- `switchState` runs a quick fade-out/fade-in Animated sequence on the scroll content and updates `selectedState`. Used by the picker, the location button, and the quick-switch chips.
- The state picker is a slide-up `Modal` (`StatePicker`) with its own search box (`SearchInput`) filtering `STATE_LIST` by split name or Hindi name; selecting a state calls `onSelect` + closes.
- No backend call — all state/crop data is local (`data/stateCrops.js`). If `STATE_CROPS[selectedState]` is missing, a "no data" message renders instead of the body.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header | Custom green header | Back arrow (`goBack`), title + subtitle, location button. |
| Detecting spinner | Inline spinner | Shown in header while `detecting` GPS/state. |
| Location button | Icon button | Re-runs `detectLocation()` to auto-detect state from GPS. |
| State selector bar | Tappable bar | Shows current state icon, name (+Hindi) and a "Change" pill; opens the state picker modal. |
| State overview card | Info card | Climate + specialty items; soil types and water sources chip rows. |
| Farming types | Chip row | `FarmingTypeChip`s (icon + colored label) per state. |
| Key crops list | Section + cards | "<N> key crops" heading; `CropCard`s for the state. |
| Crop card | List item (`CropCard`) | Season badge, emoji, English/Hindi name, description, Sow/Duration/Harvest row, chevron. Press → `CropDetail`. |
| Other states | Horizontal chip scroll | Quick-switch chips for all other states; tap → `switchState`. |
| State picker modal | Bottom sheet `Modal` | Drag handle, title, close (X), search input, scrollable state list with icon/name/Hindi and checkmark on the selected state. |
| Search input (modal) | Text input | Filters the state list by name / Hindi name. |
| No-data state | Fallback text | Centered message when `STATE_CROPS[selectedState]` is missing. |

## Services, APIs & data
- **API endpoints:** none — no calls to `services/*`. Uses device GPS only.
- **Backend route/service:** none. (Unrelated to `weather.routes.js`; crop/state content is bundled in the app.)
- **State / context:** `useLanguage()` for `t()`; `useLocation()` (LocationContext) for `coords`; `expo-location`'s `reverseGeocodeAsync`; local `useState` (`selectedState`, `pickerVisible`, `detecting`) and an `Animated` fade ref.
- **Local / static data:** `STATE_CROPS`, `STATE_LIST`, `detectStateFromLocation` from `data/stateCrops.js`; `COLORS`, `SHADOWS` from `constants/colors`. Season-badge palette is computed inline per crop season (Kharif/Rabi/Perennial/other).

## Languages / i18n
Bilingual crop and state names come from the data (`name`/`nameHi`, state `nameHi`). UI strings use `stateCrops.*` (`title`, `subTitle`, `change`, `selectState`, `searchPlaceholder`, `climate`, `specialty`, `soilLabel`, `waterLabel`, `farmingTypes`, `keyCrops`, `otherStates`, `noData`, `sow`) plus shared `cropCalendar.duration` / `cropCalendar.harvest`. App language from LanguageContext (10 languages supported).

## Notes, edge cases & gaps
- GPS reverse-geocode failures are swallowed and the current/default state (`Maharashtra`) is kept — no error toast.
- Auto-detect only runs once and only when no `state` param was supplied; passing a `state` deep-links straight to that state.
- Requires the `coords` from `LocationContext` to be available; if `gpsCoords` is null, `detectLocation` returns early without detecting.
- Picker search clears its query after a selection. State keys are camel-case (e.g. `WestBengal`) and displayed via `stateSplitName` which inserts spaces before capitals.
