# 🌾 My Farm — Feature Index

> **Tab:** My Farm · **Stack:** `MyFarmStack` (re-registered in `AIStack` for deep-linking) · **Route name:** `MyFarmHome` (tab home) · **File:** [`frontend/src/screens/FarmProfile/`](../../../frontend/src/screens/FarmProfile/)

This folder documents the **My Farm** tab of CropSetu / KhetAI, one Markdown file per screen, numbered in **user-flow order** (`01-`, `02-`, …) so the folder reads top-to-bottom like the real journey. It mirrors the structure of the master [`../README.md`](../README.md), which links My Farm to this `my-farm/` folder index.

Each screen doc follows the same template:

> **Purpose** · **Where it sits / how you reach it** · **How it works** · **UI elements** (an element-by-element table) · **Services, APIs & data** · **Languages / i18n** · **Notes, edge cases & gaps**

---

## Purpose

**My Farm** is the farm-and-crop-cycle book-keeping hub: it lets an Indian farmer register their plots and then run a **complete, real-time crop cycle** — from before the seed is in the ground (planning, land prep, seed selection, nursery, sowing plan) right through irrigation, fertiliser, sprays, weeding, harvest and sale — capturing every operation as a dated, costed, photo-backed log. The accumulated record drives a per-season **profit-and-loss / cost-of-cultivation** view and a visual **Growth Story** of the crop.

The unit of work is a **crop cycle**: one crop, one plot, one season (`KHARIF` / `RABI` / `ZAID`). A cycle moves through **8 growth stages in fixed order** (see [§ GrowthStage pipeline](#growthstage-pipeline)). Two interaction shapes coexist and the docs keep them separate:

1. **The Crop Plan** — a one-time, guided, pre-seeding capture form (a single `ScrollView`, not a multi-step wizard) that fills the first three stages. The *Days-After-Sowing* clock starts later, when the sowing event is logged (see [§ GrowthStage pipeline](#growthstage-pipeline)).
2. **The ongoing log** — repeatable, dated, event-based entries appended to JSON arrays on the cycle (each irrigation, each fertiliser dose, each spray, etc.) for the rest of the season.

> **Re-theme & new features (June 2026).** My Farm's design **tokens are remapped** to the **KhetAI / Login design system** — the [`cosmicTheme.js`](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js) token *values* (`COSMIC`, `GRADIENT`, `GLOW`, `CT`, …) were re-pointed in place to KhetAI: deep forest-green `#005F21` primary, gold `#E0AF3B` accent (was orange), forest-tinted text, KhetAI warm green-white surfaces, soft-green `GLOW` (the Login `KSHADOW` family), and `CT.family` = **Plus Jakarta Sans** body + **Fraunces** serif display (`CT.family.display` / `displaySemi` / `displayItalic`). Every `Inter_*` font literal was swapped 1:1 to `PlusJakartaSans_*`, so **every screen importing `COSMIC`/`CT` already renders forest-green/gold + Plus Jakarta** — the old blue/amber/Inter look is gone. What remains is **per-screen layout chrome** (Fraunces serif titles, 56px gradient icon-square headers) still being rolled out screen-by-screen; `CosmicHeader` titles, the `MyFarmHome` hero name/greeting, and the `CropCycleDetail` hero name are already Fraunces serif (see [`khetTheme.js`](../../../frontend/src/constants/khetTheme.js) and [`LoginScreen.js`](../../../frontend/src/screens/Auth/LoginScreen.js)). Alongside the re-theme My Farm gains a **guided pre-seeding Crop Plan** (the redesigned `CropCycleCreateScreen`) and a **Growth Story** screen (`GrowthStoryScreen`, now shipped). Where a doc still describes redesigned behaviour, anything not-yet-in-code is flagged under "Notes, edge cases & gaps".

---

## Where it sits / how you reach it

- **Reached from:** the 🌾 **My Farm** bottom tab in [`AppNavigator.js`](../../../frontend/src/navigation/AppNavigator.js) (`MyFarmStack`, home `MyFarmHome`). The deep link `farm` resolves to `MyFarmHome` via [`linking.js`](../../../frontend/src/navigation/linking.js).
- **Navigates to:** the screens below, plus four **inline modals** on the cycle detail screen. The same `FarmList → … → ActivityIncomeLog` set is **re-registered inside `AIStack`** so AI cards (e.g. "log this", "open this cycle") can deep-link into My Farm and back.
- **Route params in:** the tab home takes none; downstream screens thread `farmId`, `plotId`, `cycleId`, and (for the activity loggers) the activity `type`. The cycle detail screen accepts `prefillActivity` to auto-open one of the inline modals.

---

## Screen catalog (flow-ordered)

| # | Doc | Route name | Screen file | Role |
|---|---|---|---|---|
| 01 | [MyFarmHomePage](01-MyFarmHomePage.md) | `MyFarmHome` | [`MyFarmHomeScreen.js`](../../../frontend/src/screens/FarmProfile/MyFarmHomeScreen.js) | Dashboard / season hero for the active cycle |
| 02 | [FarmListPage](02-FarmListPage.md) | `FarmList` | [`FarmListScreen.js`](../../../frontend/src/screens/FarmProfile/FarmListScreen.js) | All farms (plots) the user owns |
| 03 | [FarmDetailPage](03-FarmDetailPage.md) | `FarmDetail` | [`FarmDetailScreen.js`](../../../frontend/src/screens/FarmProfile/FarmDetailScreen.js) | One farm: its plots, soil, and crop cycles |
| 04 | [FarmAddEditPage](04-FarmAddEditPage.md) | `FarmAddEdit` | [`FarmAddEditScreen.js`](../../../frontend/src/screens/FarmProfile/FarmAddEditScreen.js) | Create / edit a farm (plot header — "Stage 0") |
| 05 | [CropCyclePlanPage](05-CropCyclePlanPage.md) | `CropCycleCreate` | [`CropCycleCreateScreen.js`](../../../frontend/src/screens/FarmProfile/CropCycleCreateScreen.js) | **The guided pre-seeding Crop Plan** (single-ScrollView form) |
| 06 | [CropCycleDetailPage](06-CropCycleDetailPage.md) | `CropCycleDetail` | [`CropCycleDetailScreen.js`](../../../frontend/src/screens/FarmProfile/CropCycleDetailScreen.js) | One cycle: stage bar, financials, activity feed + 4 inline modals |
| 07 | [ActivityTypePickerPage](07-ActivityTypePickerPage.md) | `ActivityTypePicker` | [`ActivityTypePickerScreen.js`](../../../frontend/src/screens/FarmProfile/ActivityTypePickerScreen.js) | 12-tile grid → routes to the right logger |
| 08 | [ActivityLoggers](08-ActivityLoggers.md) | (8 routes) | [`logging/`](../../../frontend/src/screens/FarmProfile/logging/) | The 8 pushed-logger screens (one doc, sectioned) |
| 09 | [GrowthStoryPage](09-GrowthStoryPage.md) | `GrowthStory` | [`GrowthStoryScreen.js`](../../../frontend/src/screens/FarmProfile/GrowthStoryScreen.js) | **SHIPPED** — DAS hero scene + photo rail + 8-stage filmstrip; reached from `CropCycleDetail` |
| 10 | [CropCycleProcess](10-CropCycleProcess.md) | *(cross-screen reference)* | [`FarmProfile/`](../../../frontend/src/screens/FarmProfile/) | End-to-end stage-by-stage process map (which screen/`farmApi` call records each step) |

**Inline modals (not routes)** live on `CropCycleDetail` and are documented in **06**: `FERTILIZER`, `SPRAY`, `HARVEST`, `SALE`. The 12-tile picker pushes a dedicated logger for 8 types but routes these four back to `CropCycleDetail` with `prefillActivity` — confirmed by the `['FERTILIZER','SPRAY','HARVEST','SALE']` branch in [`ActivityTypePickerScreen.js`](../../../frontend/src/screens/FarmProfile/ActivityTypePickerScreen.js).

### The 12 activity types

In grid order, from `ACTIVITY_TYPES` in [`cosmicTheme.js`](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js). Eight open a **pushed logger**; four open an **inline modal**. Colour tokens are the post-re-map (KhetAI) values.

| Tile | i18n key | Opens | Colour token |
|---|---|---|---|
| Land prep | `myFarm.v2.activity.landPrep` | `ActivityLandPrepLog` | `LAND_PREP` `#6D4C41` (earth brown) |
| Sowing | `myFarm.v2.activity.sowing` | `ActivitySowingLog` | `SOWING` `#65A30D` (sprout lime) |
| Irrigation | `myFarm.v2.activity.irrigation` | `ActivityIrrigationLog` | `IRRIGATION` `#0288D1` (water blue) |
| Fertilizer | `myFarm.v2.activity.fertilizer` | **inline modal** | `FERTILIZER` `#00897B` (nutrient teal) |
| Spray | `myFarm.v2.activity.spray` | **inline modal** | `SPRAY` `#7B1FA2` (protection purple) |
| Scout | `myFarm.v2.activity.scout` | `ActivityScoutLog` | `SCOUT` `#C77700` (observation amber) |
| Weeding | `myFarm.v2.activity.weeding` | `ActivityWeedingLog` | `WEEDING` `#558B2F` (weed green) |
| Pruning | `myFarm.v2.activity.pruning` | `ActivityPruningLog` | `PRUNING` `#C2185B` (prune magenta) |
| Harvest | `myFarm.v2.activity.harvest` | **inline modal** | `HARVEST` `#E0AF3B` (harvest gold) |
| Sale | `myFarm.v2.activity.sale` | **inline modal** | `SALE` `#005F21` (money green) |
| Expense | `myFarm.v2.activity.expense` | `ActivityExpenseLog` | `EXPENSE` `#C62828` (spend red) |
| Income | `myFarm.v2.activity.income` | `ActivityIncomeLog` | `INCOME` `#005F21` (income green) |

---

## How it works

### MyFarmStack navigation map

`MyFarmStack` in [`AppNavigator.js`](../../../frontend/src/navigation/AppNavigator.js) (`createStackNavigator`, `headerShown: false` throughout):

```
MyFarmHome ──"Manage farms"──▶ FarmList ──▶ FarmDetail ──"Add farm"──▶ FarmAddEdit (plot header)
   │                                            │
   │                                            └─"Start crop cycle"──▶ CropCycleCreate (Crop Plan wizard)
   │                                                                          │ createCropCycle(farmId, data)
   │                                                                          ▼
   └──"active season hero" / cycle card ─────────────────────────────▶ CropCycleDetail
                                                                              │
              ┌───────────────────────────────────────────────────┬─────────┤
              ▼                                                     ▼         ▼
    "Log today's activity" ─▶ ActivityTypePicker ─▶ {8 pushed loggers │ 4 inline modals}
                                                                              │
              "Growth story" button ───────────────────────────────────────▶ GrowthStory
```

Registered routes (both `MyFarmStack` and the `AIStack` re-registration): `MyFarmHome`, `FarmList`, `FarmDetail`, `FarmAddEdit`, `CropCycleCreate`, `CropCycleDetail`, `GrowthStory`, `ActivityTypePicker`, `ActivityLandPrepLog`, `ActivitySowingLog`, `ActivityIrrigationLog`, `ActivityScoutLog`, `ActivityWeedingLog`, `ActivityPruningLog`, `ActivityExpenseLog`, `ActivityIncomeLog`. The **`GrowthStory`** route is registered in both `MyFarmStack` and `AIStack` (imported as `GrowthStoryScreen` in [`AppNavigator.js`](../../../frontend/src/navigation/AppNavigator.js)) and is reachable in-app from the **"Growth story"** button on `CropCycleDetail`, which calls `navigation.navigate('GrowthStory', { cycleId, cycle })`.

### GrowthStage pipeline

The canonical stage order is the 8-step `STAGES` array in [`StageTimelineBar.js`](../../../frontend/src/screens/FarmProfile/ui/StageTimelineBar.js), matching the `GrowthStage` enum in [`schema.prisma`](../../../backend/prisma/schema.prisma):

```
PLANNING → LAND_PREP → SOWING → VEGETATIVE → FLOWERING → FRUITING → MATURITY → HARVESTED
   (Plan)    (Prep)     (Sow)     (Grow)       (Flower)    (Fruit)    (Mature)   (Harvest)
```

- **The Crop Plan fills the first three stages** (`PLANNING` → `LAND_PREP` → `SOWING`), writing the header, seed and sowing fields onto the `FarmCropCycle` record.
- **DAS (Days After Sowing)** = `sowingDate ? max(0, floor((now − sowingDate) / 86400000)) : null`. It is the timeline spine for the dashboard, the cycle detail screen and the Growth Story. Source: [`CropCycleDetailScreen.js`](../../../frontend/src/screens/FarmProfile/CropCycleDetailScreen.js) (~line 290). **DAS now starts at sowing:** `SowingLogScreen` stamps `sowingDate` (`farmApi.updateCropCycle(cycleId, { sowingDate: now })`) immediately after `advanceStage('SOWING')`, so logging the sowing event is what starts the clock. Previously nothing wrote `sowingDate` and DAS stayed `null`.
- **`FRUITING` is a display label, not literal "fruit" for every crop.** The enum value `FRUITING` is horticulture language; the human label should read per crop category — **"Grain filling"** for cereals (wheat/rice/maize), **"Pod development"** for pulses and oilseeds, **"Boll development"** for cotton, **"Fruit set / development"** for vegetables and fruit. Keep the enum stable; map the label at the surface. The same applies to DAS-band labels in the Growth Story and timeline.
- **Authoritative vs. derived stage.** The live stage is always `cycle.growthStage`, set manually via `advanceStage(cycleId, stage)`. DAS→stage bands are used only to *bucket historical events* for display labels (e.g. Growth Story chapters) — never as agronomic truth. The manually-set stage wins for the current/last card.
- **Close-out.** `completeCycle(cycleId)` sets the stage to `HARVESTED`, marks the cycle `COMPLETED`, and stores the financials computed by `computeFinancials()` (cost of cultivation, cost/acre, revenue, net P/L, yield/acre, benefit–cost ratio) in [`cropCycle.service.js`](../../../backend/src/services/cropCycle.service.js).

---

## UI elements

| Element | Type | Description / action |
|---|---|---|
| `MyFarmHome` season hero | Screen / hero card | Active-cycle dashboard: stage timeline, DAS, season stats, quick links. |
| `StageTimelineBar` | Shared component | 8-segment phenology spine; current = forest-green glow dot, past = filled, future = muted border. |
| Crop Plan | Single-ScrollView guided form | Pre-seeding guided capture (`CropCycleCreate`); progress is `requiredDone/3` (crop + season + area), ends in `createCropCycle()` then `navigation.replace('CropCycleDetail', { cycleId })`. (`sowingDate` is stamped later by `SowingLogScreen`, not here.) |
| Activity picker grid | 12-tile grid | `ActivityChip.Tile` per type; 8 push a logger, 4 open an inline modal. |
| Inline modals | Bottom sheets | `FERTILIZER`, `SPRAY`, `HARVEST`, `SALE` on `CropCycleDetail` (opened via `prefillActivity`). |
| `GlowButton` | Primary CTA | Forest-green gradient (`#005F21→#008935`), radius 18, circular arrow chip, elegant shadow; disabled = opacity .65, no shadow. |
| Accent pill / `ActivityChip` | Pill | Accent-green fill `#C9F2C0`, sparkles icon; used for AI suggestions, stage labels, Hybrid/Organic toggles. |
| `SyncBadge` / `StreakBadge` | Status badge | Online/offline sync state; gold streak badge. |
| Growth Story | Screen (shipped) | DAS hero "StageScene" + horizontal field-photo rail + vertical 8-stage gradient filmstrip for one cycle (`GrowthStoryScreen`). |

(Per-screen element tables live in the individual docs **01–09**; **10** is the cross-screen process reference.)

---

## Services, APIs & data

- **Frontend service:** [`farmApi.js`](../../../frontend/src/services/farmApi.js) is the single API layer for My Farm. Farms: `listFarms`, `createFarm`, `getFarm`, `updateFarm`, `deleteFarm`, `setActiveFarm`, `getFarmInsights`, `getFarmFinancialSummary`. Cycles: `listCropCycles(farmId, filters)`, `createCropCycle(farmId, data)`, `getCropCycle`, `updateCropCycle(cycleId, fields)` (→ `PATCH /cycles/:id`; used e.g. by `SowingLogScreen` to stamp `sowingDate`), `deleteCropCycle`, `completeCycle`, `getCycleFinancials`. Stage & specific events: `advanceStage(cycleId, stage)`, `recordHarvest`, `recordSale`, `addFertilizer`, `addPesticide`, `addIrrigationLog`. Generic v2 logs: `addActivity(cycleId,{type,title,notes,fields})`, `addLaborLog`, `addExpenseLog`, `addIncomeLog`, `addObservedEvent`. (Onboarding writes `completeOnboarding` / `skipOnboarding` also live here.)
- **Data model:** Prisma model `FarmCropCycle` in [`schema.prisma`](../../../backend/prisma/schema.prisma) — `season`, `year`, `cropName`/`cropNameMr`/`cropNameHi`, `cropCategory`, `variety`, `isHybrid`, `isOrganic`, `areaAllocatedAcres`, `sowingDate`, `expectedHarvestDate`, `actualHarvestDate`, `growthStage` (the 8-value `GrowthStage` enum); seed fields (`seedName`, `seedBrand`, `seedSource`, `seedQuantityKg`, `seedCostPerKgInr`, `seedTotalCostInr`, `seedTreatment`, `seedTreatmentProduct`, `seedPurchaseDate`, `seedReceiptUrl`); JSON arrays `fertilizersUsed[]`, `pesticidesUsed[]`, `irrigationLogs[]`, `observedEvents[]`, `activities[]` (generic `{id,type,date,title,notes,photoUrl?,voiceUrl?,fields{}}`), `laborLogs[]`, `expenseLogs[]`, `incomeLogs[]`; the cycle-level `photos[]` (`String[]` of image URLs — one of the sources the Growth Story photo rail reads via `collectPhotos`); `notes` (free text — the Crop Plan writes its composed "Previous crop · Field prep · Water" line here); harvest fields (`harvestYieldKg/Quintal/PerAcreKg`, `harvestQualityGrade`, `harvestMoisturePct`); sale fields (`saleSoldQuantityKg`, `salePricePerKgInr`, `saleTotalRevenueInr`, `saleBuyerType/Name`, `saleDate`, `saleMandiName`).
- **Financials:** `computeFinancials(cycle)` in [`cropCycle.service.js`](../../../backend/src/services/cropCycle.service.js) derives cost of cultivation, cost/acre, revenue, net profit, yield/acre and benefit–cost ratio; surfaced to the app via `getCycleFinancials()`.
- **Theme:** [`cosmicTheme.js`](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js) re-points every My Farm token (`COSMIC`, `GRADIENT`, `GLOW`, `CR`, `CS`, `CT`, `TAP`, `MOTION`, `ACTIVITY_TYPES`) to the KhetAI palette — symbol names are preserved, only values changed. Shared UI lives in [`ui/`](../../../frontend/src/screens/FarmProfile/ui/) (`CosmicScreen`, `CosmicHeader`, `GlassCard`, `GlowButton`, `StageTimelineBar`, `ActivityChip`, `CelebrationSheet`, `ActivityFeedItem`, `StreakBadge`, `SyncBadge`, `WhyThisButton`, `SpeakerButton`, `CosmicPicker`) and `theme/CosmicBackground.js`.

---

## Languages / i18n

All My Farm strings live under the **`myFarm.v2.*`** namespace (e.g. `myFarm.v2.activity.*`, `myFarm.v2.pickActivity`), keyed via `useLanguage().t()` / `LanguageContext`. The record has columns for trilingual crop names (`cropName` / `cropNameMr` / `cropNameHi`), but today the Crop Plan only writes `cropName` — `cropNameMr` / `cropNameHi` are schema-only and unpopulated (flagged in the gaps below). Each screen exposes a language toggle (a glass pill in the header) and supports voice-to-text in the local language on note fields; bill/receipt photo capture and the "on credit (udhaar)" toggle on cost fields are India-specific affordances repeated across the loggers.

---

## Notes, edge cases & gaps

- **GrowthStory is shipped.** `GrowthStoryScreen.js` is built and the `GrowthStory` route is registered in both `MyFarmStack` and `AIStack` ([`AppNavigator.js`](../../../frontend/src/navigation/AppNavigator.js)). The shipped screen is a DAS hero "StageScene" (sky→soil gradient + scaling `CropIcon`, or the farmer's latest photo), a horizontal "Your field photos" rail (`collectPhotos` reads `cycle.photos[]` + `activities[].photoUrl` + `observedEvents[].photoUrl`), and a vertical 8-stage gradient filmstrip with Done/Now/Upcoming pills and approximate DAS anchors. It is reachable from the **"Growth story"** button on `CropCycleDetail`. Doc **09** has the detail. *Future work (not built):* a Stage/Day toggle, chapter cards, "Ask KhetAI"/Share, reuse of `buildActivityFeed`, and any growth-image endpoint.
- **Growth Story image fallback.** The shipped screen degrades to `CropIcon` (or the farmer's own logged photo) for the hero. The intended fuller chain is (1) farmer's own logged `photoUrl` → (2) generated per-crop-per-stage image → (3) bundled stock crop photo → (4) `<CropIcon>`. Two tiers are **absent today**: the bundled crop-photo tier (`backend/assets/crops/*.jpeg` / `frontend/src/constants/cropImages.js`) and the image-generation pipeline (no `imagen`/`generateImage` code exists yet) — the screen carries an honest in-app note that "Photorealistic AI stage images are on the way." Detail in doc **09**.
- **Crop Plan capture gaps.** `CropCycleCreateScreen.js` is a single-`ScrollView` guided form (not a multi-step wizard, no nursery step). The following remain **schema-only / unwired** — declared on `FarmCropCycle` but written by no screen: `seedReceiptUrl`, `expectedHarvestDate`, `cropCategory`, `cropNameMr` / `cropNameHi`, `seedCostPerKgInr`, `seedPurchaseDate`. Doc **05** flags these against the actual form fields.
- **Authoritative stage.** Wherever a stage label is shown, reflect that `cycle.growthStage` (set via `advanceStage`) is the truth; DAS→stage bucketing is approximate and display-only. Render the `FRUITING` enum value with the per-crop-category label (Grain filling / Pod development / Boll development / Fruit set) noted in [§ GrowthStage pipeline](#growthstage-pipeline).
- **Per-screen layout chrome mid-migration.** The KhetAI **tokens** (colour, font family) are remapped everywhere, but the Login **layout** chrome — Fraunces serif section titles and the 56px gradient icon-square header — is not yet applied to every screen. `CosmicHeader` titles, the `MyFarmHome` hero name/greeting and the `CropCycleDetail` hero name already use Fraunces; the rest is in progress.
- **Area is acres-only.** All area capture and the financial per-acre derivations use **acres**; guntha/bigha entry (bigha is region-variable and needs a state-aware conversion) is not yet wired.
- **Offline-first.** Logs can be captured offline and synced later; `SyncBadge` reflects state. Every cost field offers photo, GPS, voice-note and an on-credit (udhaar) toggle, and bill/receipt capture is prompted on every purchase (seed, fertiliser, pesticide) for PMFBY claims, dealer complaints and traceability.
