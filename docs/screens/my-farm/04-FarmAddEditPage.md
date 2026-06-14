# Add / Edit Farm (Plot Header)

> **Tab:** My Farm · **Stack:** `MyFarmStack` (also re-registered in `AIStack` and `ProfileStack` for deep-linking) · **Route name:** `FarmAddEdit` · **File:** [FarmAddEditScreen.js](../../../frontend/src/screens/FarmProfile/FarmAddEditScreen.js)

## Purpose
The form that creates a new **farm** (a plot) or edits an existing one. It captures the plot header that every crop cycle hangs off — a nickname, the location (state / district / taluka / village / pincode + an optional GPS pin), total land size in acres, the soil type, and the irrigation/water source. In the re-themed "My Farm" mental model this is **Stage 0 of a crop cycle**: a farm must exist before a crop cycle (the guided [Crop Plan wizard](05-CropCyclePlanPage.md)) can be started against it. Day-1 the screen only forces the five critical fields; everything else is optional, and the same header fields are echoed as Step 1 ("Plot & season") of the Crop Plan.

## Where it sits / how you reach it
- **Reached from:**
  - [FarmListScreen.js](../../../frontend/src/screens/FarmProfile/FarmListScreen.js) — the "Add farm" button (`navigation.navigate('FarmAddEdit')`) and per-row "Edit" (`navigation.navigate('FarmAddEdit', { farm })`).
  - [FarmDetailScreen.js](../../../frontend/src/screens/FarmProfile/FarmDetailScreen.js) — the header "Edit" action (`navigation.navigate('FarmAddEdit', { farm })`).
  - [MyFarmHomeScreen.js](../../../frontend/src/screens/FarmProfile/MyFarmHomeScreen.js) — the "Add farm" CTA and the no-active-farm fallback both `navigation.navigate('FarmAddEdit')` with no params (create mode).
  - From the Profile stack ("My farms" management) and from `AIStack` deep-links, since the route is registered in all three stacks in [AppNavigator.js](../../../frontend/src/navigation/AppNavigator.js).
- **Navigates to:** Back only — on a successful save it calls `navigation.goBack()`, returning to whichever list/detail screen launched it. There is no forward navigation from this screen.
- **Route params in:** `{ farm }` (optional). When present, the screen is in **edit mode** (`isEdit = true`): every field is seeded from `route.params.farm`, the header reads "Edit farm", and the footer CTA becomes "Update farm". When absent it is **create mode** ("Add farm" / "Save farm").

## How it works
- All fields live in a single `form` `useState` object seeded from `existing` (the `farm` route param) or sensible defaults — `state` defaults to `Maharashtra`, `soilType` to `UNKNOWN`, `irrigationSystem` to `RAINFED`. A small `u(key, value)` setter patches one field at a time.
- The screen is a `KeyboardAvoidingView` + `ScrollView` wrapped in `CosmicScreen`/`CosmicHeader`, organised into four `SectionCard`s: **Farm identity → Location → Land & soil → Water source**.
- **Location cascade:** selecting a state resets `district` and `taluka`; selecting a district resets `taluka`. Districts come from `getDistrictsForState(state)` and talukas from `getTalukas(district)` ([locations.js](../../../frontend/src/constants/locations.js)). The taluka **picker** is only used for Maharashtra (where a curated taluka list exists); for every other state the taluka becomes a free **text input**.
- **GPS pin (`captureGPS`):** requests foreground location permission via `expo-location`, reads a high-accuracy fix, and stores `latitude`/`longitude`. The dashed "Drop a GPS pin" button flips to a solid "Pin set · lat, lng" state with a checkmark once captured. Permission-denied and read errors surface as `Alert`s. GPS is optional and never blocks save.
- **Soil** is a horizontal rail of seven gradient swatch tiles keyed to the Prisma `SoilType` enum (Black cotton, Red, Alluvial, Sandy, Clay loam, Laterite, Not sure); **water** is a 2×2 grid of four irrigation tiles (Drip, Sprinkler, Flood, Rainfed). Both are single-select with a check badge on the chosen tile and haptic feedback on tap.
- **Save (`handleSave`):** the only hard validation is **land size > 0** (a missing/zero acreage triggers an error haptic + `Alert` and aborts). On pass it calls `editFarm(existing.id, form)` (edit) or `addFarm(form)` (create) from [MultiFarmContext.js](../../../frontend/src/context/MultiFarmContext.js), fires a success haptic, and pops back. Failures show an `Alert` with the server message.
- **Offline-first writes:** `addFarm`/`editFarm` are **optimistic** — the new/edited farm appears immediately, the underlying create/update is wrapped in `withWrite(...)` ([writeQueue](../../../frontend/src/services/writeQueue.js)) so it retries when connectivity returns, and the UI rolls back if the write ultimately fails. Farms are cached to encrypted secure storage (`fe_farms_v1`) so the list survives offline.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header (`CosmicHeader`) | Header | Back arrow; title "Add farm" / "Edit farm"; subtitle "Takes under 3 minutes" (create) or "Update farm details" (edit). |
| Farm identity card | `SectionCard` (leaf icon) | Wraps the nickname field. |
| Farm nickname | Text input | Free text, word-cased; placeholder "e.g. Gavran shet, Road-side plot". Optional. |
| Location card | `SectionCard` (location icon) | Wraps the address fields + GPS. |
| State | `CosmicPicker` | Picks from `STATE_LIST`; resets district + taluka on change. |
| District | `CosmicPicker` | Items from `getDistrictsForState(state)`; disabled until a state is chosen; resets taluka. |
| Taluka | `CosmicPicker` **or** text input | Picker (`getTalukas`) for Maharashtra; free text for all other states. |
| Village | Text input | Word-cased; optional. |
| Pincode | Text input | `numeric`, max 6 digits; optional. |
| GPS pin button | Toggle button | `captureGPS`; dashed "Drop a GPS pin" → solid "Pin set · lat, lng" with checkmark once set. Optional. |
| Land & soil card | `SectionCard` (layers icon) | Wraps acreage + soil. |
| Total land size (acres) | Text input | `decimal-pad`, centred, bold; **required, must be > 0** (only validated field). |
| Soil type | Horizontal swatch rail | 7 gradient tiles → Prisma `SoilType` enum; single-select with check badge. |
| Water source card | `SectionCard` (water icon) | Wraps the irrigation grid. |
| Irrigation system | 2×2 tile grid | Drip / Sprinkler / Flood / Rainfed → Prisma `IrrigationType`; single-select with check badge. |
| Save footer | `GlowButton` (full-width, anchored) | "Save farm" / "Update farm" / "Saving…"; gradient + glow, spinner + disabled while `saving`. |

## Services, APIs & data
- **Context / state:** [MultiFarmContext.js](../../../frontend/src/context/MultiFarmContext.js) (`addFarm`, `editFarm`) and [LanguageContext](../../../frontend/src/context/LanguageContext.js) (`t`); local `useState` for `form` + `saving`.
- **API endpoints (via [farmApi.js](../../../frontend/src/services/farmApi.js)):** `createFarm(farmData)` → `POST /farms`; `updateFarm(farmId, fields)` → `PATCH /farms/:id`. Both are funnelled through `withWrite` for offline retry. (The list is hydrated by `listFarms()` → `GET /farms` and cached.)
- **Backend route/service:** `backend/src/routes/farm.routes.js`; the `Farm` model in [schema.prisma](../../../backend/prisma/schema.prisma) (`farmName`, `state/district/taluka/village/pincode`, `latitude/longitude`, `landSizeAcres`, `soilType` `SoilType` enum, `irrigationSystem` `IrrigationType` enum). A `Farm` owns many `FarmCropCycle` rows — this header is the parent record those cycles attach to.
- **Local / static data:** `STATE_LIST`, `getDistrictsForState`, `getTalukas` from [locations.js](../../../frontend/src/constants/locations.js); the local `SOILS` and `IRRS` tables map enum keys to gradients/icons; `SoilIcon`/`IrrigationIcon` components; theme tokens (`COSMIC`, `CR`, `CS`, `CT`, `GLOW`, `GRADIENT`) from [cosmicTheme.js](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js); `Haptics` util.

## Languages / i18n
Strings resolve through `useLanguage().t(...)` against the `farmProfile.*` namespace (field labels, placeholders, picker titles, GPS prompts, validation alerts, "Save/Update farm") plus a few `nav.*` and `login.error` keys; every `t()` call carries an English fallback. The soil/water tile labels and the section titles ("Farm identity", "Location", "Land & soil", "Water source") are currently **hardcoded English** literals (see [FarmAddEditScreen.js](../../../frontend/src/screens/FarmProfile/FarmAddEditScreen.js) `SOILS`/`IRRS` and the `SectionCard` titles). The re-theme moves all My Farm copy under the `myFarm.v2.*` namespace and adds the in-header glass language-toggle pill and voice-to-text on text fields — neither is in this screen yet (see gaps).

## Notes, edge cases & gaps
- **Only land size is validated.** Name, location, GPS, soil, and irrigation are all optional/defaulted, so a farm can be saved with just an acreage. This matches the "Day-1 asks the critical fields, extras optional" design intent.
- **KhetAI re-theme — token VALUES already ship; LAYOUT chrome is the remaining gap.** `cosmicTheme.js` has already been re-pointed to the Login KhetAI system: `COSMIC.PRIMARY` is forest green `#005F21`, `COSMIC.ACCENT` is gold `#E0AF3B` (was orange), text is forest-tinted, surfaces are KhetAI white/green-white, `GLOW` is a soft green shadow (KSHADOW), and `CT.family` is Plus Jakarta Sans for body with Fraunces serif for display (`CT.family.display/displaySemi/displayItalic`). Every `Inter_*` literal in this file was swapped 1:1 to `PlusJakartaSans_*`, so the screen **already renders forest-green/gold + Plus Jakarta** — not the old blue/amber/Inter look. What is **not yet applied here** is the per-screen Login *layout chrome*: a 56px `GRADIENT.primary` icon-square in the header and a big Fraunces serif title with an italic forest-green second line (e.g. "Where are you / *farming?*"). The header still uses `CosmicHeader`'s plain title rather than the serif hero treatment that MyFarmHome/CosmicHeader/CropCycleDetail already carry. The exported symbol names (`COSMIC`, `GRADIENT`, `GLOW`, `CR`, `CS`, `CT`) are unchanged; only the values were remapped.
- **Area units — acres-only; regional units need *state-aware* conversion (gap).** Land size is captured only in acres today: the field is `landSizeAcres` (a `decimal-pad` text input), the value is stored verbatim, and the source header still flags "room for bigha/guntha in v2". A redesigned Stage-0 header should offer a unit `[select]` — acre / guntha / bigha / kanal / hectare — but the conversion **cannot use a single fixed factor**. Critically, **bigha is region-variable**: 1 bigha is roughly 0.62 acre in parts of UP/Uttarakhand, ~0.40 acre (a "kachha"/pucca split) in Rajasthan/MP, ~0.33 acre in West Bengal, ~0.40 acre in Gujarat, etc., so any acre↔bigha (and to a lesser degree guntha/kanal) conversion **must be keyed off the farm's `state` (ideally district)** — the location cascade already on this screen is the right anchor for that lookup. Acre, hectare (1 ha = 2.471 acre) and guntha (1 acre = 40 guntha, mostly Maharashtra/Karnataka) are fixed; bigha/kanal are not. Whatever the user enters, the canonical persisted value should stay `landSizeAcres` so crop-cycle area math (acre-based) is consistent. A GPS-boundary capture that auto-computes area from a walked polygon is also redesign-only. None of this unit machinery is in code yet — see "Future work".
- **Redesign — extra Stage-0 fields.** The Crop Plan blueprint adds **season** (KHARIF/RABI/ZAID), **crop year**, and **land tenure** (Owned / Leased / Sharecropped) to the plot header. These live on `FarmCropCycle` (season, year, areaAllocatedAcres), not on the `Farm` row, and are captured in Step 1 of the [Crop Plan wizard](05-CropCyclePlanPage.md) — this Add/Edit screen captures only the durable plot attributes. Writers should keep the two separate: editing the farm header never touches an in-flight cycle.
- **GPS** is a single point pin, not a boundary polygon; no reverse-geocode fills the address from the pin, and vice-versa. The "auto-area from boundary" affordance is redesign-only.
- **Optimistic + offline:** because writes go through `withWrite`, a save can succeed in the UI (and `goBack()`) before the server confirms; a later failure rolls the farm back in the list. The redesigned screen should surface this with a `SyncBadge` / "Saved offline, will sync" notice — not present today.
- **No delete here.** Removing a farm (`removeFarm`) lives on the list/detail screens, not in this form.
- **Taluka asymmetry:** only Maharashtra has a curated taluka picker; other states fall back to free text, so taluka data quality varies by state.
