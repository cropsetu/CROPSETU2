# Crop Plan (Start Crop Cycle)

> **Tab:** My Farm · **Stack:** `MyFarmStack` (also re-registered in `AIStack` + `ProfileStack` for deep-linking) · **Route name:** `CropCycleCreate` · **File:** [CropCycleCreateScreen.js](../../../frontend/src/screens/FarmProfile/CropCycleCreateScreen.js)

## Purpose
The guided **pre-seeding "Crop Plan"** — the one and only way a crop cycle is created. It is a **single-scroll guided form** (not a multi-step wizard) that runs *before the crop is in the ground* and captures the process Indian farmers actually go through before sowing: which crop and season, how much land, the variety and whether it is hybrid or desi, **how the plot was cultivated before (previous crop / crop rotation)**, the **field / seed-bed preparation** intent, the **water source**, and **seed selection** (brand, source, seed rate, treatment + product, cost). It ends with a live plan-summary card, creates the cycle in the `PLANNING` stage of the 8-stage timeline, and drops the farmer straight onto the new cycle's detail screen.

This fills the long-standing gap: the app previously jumped straight to a crop "in progress" with no record of the before-seeding decisions. The Crop Plan now captures that "before seeding" story so the farmer's real-time crop cycle is complete from day zero, and so later costing, PMFBY claims, and AI advice have the rotation/seed context they need.

A crop cycle is the unit of work — one crop, one plot, one season — and it moves through eight stages in fixed order (the canonical order lives in [StageTimelineBar.js](../../../frontend/src/screens/FarmProfile/ui/StageTimelineBar.js)):

```
PLANNING → LAND_PREP → SOWING → VEGETATIVE → FLOWERING → FRUITING → MATURITY → HARVESTED
```

The Crop Plan creates the cycle in `PLANNING`: the structured pre-seeding inputs (previous crop, field-prep plan, water source) are composed into the cycle's `notes`, the seed selection into the seed columns. It does **not** set `sowingDate` itself — the cycle stays a `PLANNING` draft until the farmer logs land-prep and sowing, and it is [SowingLogScreen.js](../../../frontend/src/screens/FarmProfile/SowingLogScreen.js) (via `advanceStage('SOWING')`) that stamps `sowingDate` and **starts the DAS (Days After Sowing) clock** that drives the dashboard, detail screen, and Growth Story.

> **Agronomy note — `FRUITING` is horticulture language.** The middle enum reads cleanly for veg/fruit crops, but for the cereals/pulses/oilseeds most of `CROP_KEYS` covers it should be *read* per crop category: **"Grain filling"** for cereals (wheat/rice/maize/jowar/bajra), **"Pod development"** for pulses/oilseeds (soybean/groundnut/sunflower/tur–gram), **"Boll development"** for cotton, and **"Fruit set/development"** for vegetables and fruit (tomato/brinjal/okra/chilli/banana/mango/pomegranate/grape). The stored enum is unchanged; this is a display-label nuance the detail screen and Growth Story should honour.

## Where it sits / how you reach it
- **Reached from:**
  - [FarmDetailScreen.js](../../../frontend/src/screens/FarmProfile/FarmDetailScreen.js) — the "Start crop cycle" CTA on a farm/plot → `navigation.navigate('CropCycleCreate', { farmId })`.
  - [MyFarmHomeScreen.js](../../../frontend/src/screens/FarmProfile/MyFarmHomeScreen.js) — the empty-state / "Add a crop" entry when no active cycle exists (resolves a `farmId` first).
  - Deep-linked from the AI Assistant tab via the `AIStack` re-registration of `CropCycleCreate` (see [AppNavigator.js](../../../frontend/src/navigation/AppNavigator.js) line 368).
- **Navigates to:** on success `navigation.replace('CropCycleDetail', { cycleId })` — it lands the farmer straight on the new cycle's detail screen, and **`replace` (not `navigate`) so the Back button does not reopen the create form**. (It only falls back to `navigation.goBack()` if the create response is missing an `id`.) From there [CropCycleDetailScreen.js](../../../frontend/src/screens/FarmProfile/CropCycleDetailScreen.js) and the activity loggers take over.
- **Route params in:** `{ farmId }` (required) — the plot the cycle belongs to; passed straight to `createCropCycle(farmId, data)`.

## How it works
**As built today — a KhetAI single-scroll guided "Crop Plan."** The screen is **not** a multi-step wizard. It is one `ScrollView` of eight numbered sections, themed to the Login / KhetAI design system: a `sparkles` **accent pill** ("Plan before you sow"), a big **Fraunces serif hero title with an italic coloured second line** ("Let's plan this\n*season's crop.*"), a one-line sub-paragraph, a **progress bar**, and the sections — each fronted by a `SectionHeader` (coloured numbered square + title, with an "Optional" tag on the non-required ones). The footer is a single gradient `GlowButton` ("Start crop cycle" / "Starting…").

The **progress bar is purely `requiredDone / 3`** — the count of the three required fields (crop, season, area) that are filled — driving a `GRADIENT.primary` fill and a "{n}/3 basics" label. It is *not* a "Step N of M" wizard indicator; nothing is gated step-by-step and the whole form is visible and scrollable at once.

| # | Section | Required? | Captured into | Notes |
|---|---|---|---|---|
| 1 | **Which crop?** | Required | `cropName` (Title-cased) | Fuzzy-searchable illustrated picker — 21 crops via `CropIcon`. |
| 2 | **Season** | Required | `season` enum `KHARIF` / `RABI` / `ZAID` | 3 tiles with month hints (also sets `year` = current year on submit). |
| 3 | **Area allocated** | Required | `areaAllocatedAcres` | Big number input + "ACRES" pill (acres only). |
| 4 | **Variety & type** | Optional | `variety` + `seedName` (mirrors `variety`), `isHybrid` (Hybrid/Bt chip), `isOrganic` (Organic chip) | Hybrid/Desi is one-of; Organic is an independent toggle. |
| 5 | **How was this field cultivated before?** | Optional | → composed `notes` (`Previous crop: …`) | `PREV_CROPS` chips + "Fallow / first time" + free-text fallback. |
| 6 | **Field preparation** | Optional | → composed `notes` (`Field prep: …`) | Multi-select: ploughing, harrowing, levelling, FYM/compost, bunds/ridges, summer plough. |
| 7 | **Water source** | Optional | → composed `notes` (`Water: …`) | Single chip: canal, borewell, open well, rainfed, drip, farm pond. |
| 8 | **Seed details** | Optional | `seedBrand`, `seedSource` (label of chip), `seedQuantityKg` (from "seed rate kg"), `seedTotalCostInr` (from "seed cost ₹"), `seedTreatment` (`treated`/`untreated`), `seedTreatmentProduct` | Brand text · source chips · seed-rate / seed-cost row · Treated/Not-treated + product chips + free-text. |

Then a live **plan-summary card** (shown once a crop is picked) echoes `{crop} · {variety}` and `{season} · {area} ac · after {prevCrop}`.

Mechanics:
- **Hybrid/Desi** and **Organic** are accent-pill `Chip` toggles (selected → tint at `+'18'` fill / tint border, bold label), not checkboxes. Hybrid maps to `isHybrid = seedType === 'hybrid'`; Organic maps to `isOrganic`.
- **Sections 5–7 are not separate columns** — previous crop, field-prep multi-select, and water source are **composed into a single `notes` string** on submit: `"Previous crop: … · Field prep: ploughing, harrowing · Water: Borewell"`. The backend persists that `notes` line verbatim.
- **Seed treatment** reveals the product chips only when "Treated" is chosen; `seedTreatmentProduct` is sent only in that case. Product chips: `Trichoderma`, `Carbendazim`, `Imidacloprid`, `Rhizobium / PSB`, `Thiram`, plus a free-text fallback.
- On submit, `handleCreate` validates crop + season + area (else an Alert), fires haptics, and calls `createCropCycle(farmId, {...})` with the exact payload below. It prefers the server's real error message (`e.response?.data?.error?.message`, e.g. "Area 2.5 exceeds farm size 2 acres") over axios's opaque 400, then on success does `navigation.replace('CropCycleDetail', { cycleId })`.

**Exact `createCropCycle` payload (shipped):**
```js
createCropCycle(farmId, {
  cropName,                 // Title-cased crop key
  variety: variety || null,
  season,                   // KHARIF | RABI | ZAID
  year: new Date().getFullYear(),
  areaAllocatedAcres: parseFloat(area),
  isHybrid: seedType === 'hybrid',
  isOrganic: !!organic,
  seedName: variety || null,            // mirrors variety
  seedBrand: seedBrand || null,
  seedSource: <chip label> || null,
  seedQuantityKg: parseFloat(seedRate) || null,
  seedTotalCostInr: parseFloat(seedCost) || null,
  seedTreatment: treated || null,       // 'treated' | 'untreated'
  seedTreatmentProduct: treated === 'treated' ? (treatProduct || null) : null,
  notes,                                // "Previous crop: … · Field prep: … · Water: …"
})
```
The backend [cropCycle.service.js](../../../backend/src/services/cropCycle.service.js) `createCropCycle` persists all of these (it now also writes `seedTreatment`, `seedTreatmentProduct`, `seedPurchaseDate` and `notes`; the columns pre-existed, no migration). It does **not** receive or set `growthStage` or `sowingDate`, so the row starts at the schema default `PLANNING`.

> **Agronomy — seed treatment.** When the farmer marks "Treated", the product chips deliberately span the real Indian dressing kit, and the correct **order is fungicide → insecticide → bio-agent / biofertilizer applied LAST, only after the chemical dressings have dried** (a contact fungicide like Thiram/Carbendazim will kill a live `Rhizobium / PSB` inoculant if mixed wet). For pulses, oilseeds and groundnut, **`Rhizobium / PSB` inoculation is a near-universal step** (it is why that chip exists rather than a generic "bio" label) — name it explicitly to the farmer rather than lumping it with chemical dressings.

> **Agronomy — Zaid & units.** The Zaid (summer) tile should carry the caveat that **a Zaid crop needs assured irrigation** (it is grown on residual moisture only with a reliable water source — borewell/canal/drip), so for a `rainfed` water source Zaid is rarely viable. **Area is acres-only**; regional units (bigha, guntha) are flagged "coming soon" — and bigha is region-variable (state-aware conversion needed before it can be added).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Cosmic header | Header (`CosmicHeader`) | Back arrow, title `nav.newCropCycle` ("Plan a crop cycle"), subtitle that updates to "{crop} · {area} ac" as choices are made (else "Set up before you sow"). |
| Accent pill | Pill | `sparkles` Ionicon + "Plan before you sow", `PRIMARY_SOFT` fill, green border. |
| Hero title | Text (Fraunces) | Serif display title "Let's plan this" + italic coloured 2nd line "season's crop." (`CT.family.display` + `displayItalic`, `COSMIC.PRIMARY`). |
| Progress bar | Gradient bar | `requiredDone / 3` fill (`GRADIENT.primary`) + "{n}/3 basics" label — **not** a step indicator. |
| Section header | Numbered square + title | Each of the 8 sections; coloured `secNum` square with the section number, title, and an "Optional" tag on sections 4–8. |
| Crop search box | TextInput | Fuzzy search by name/synonym/localized label ("Search: bhendi, kapas, soya…"); clear (×) button; empty state "No crops match …". |
| Illustrated crop grid | Single-select card grid | 21 crops, each a `CropIcon` illustration + label; selected card gets primary border, soft fill, and a check badge. Required. |
| Season tiles | Single-select 3-tile chooser | Kharif (`rainy`, "Jun–Oct · monsoon"), Rabi (`snow`, "Nov–Mar · winter"), Zaid (`sunny`, "Mar–Jun · summer"); selected tile tints to the season colour. Required. Writes `season` enum `KHARIF`/`RABI`/`ZAID`. |
| Area input | TextInput (`decimal-pad`) | Large centred number + "ACRES" unit pill; note "Regional units (bigha, guntha) coming soon." Required → `areaAllocatedAcres`. |
| Variety field | TextInput | Optional; placeholder "e.g. Rasi 659 Bt, JS-335". Writes `variety` (and mirrors into `seedName`). |
| Hybrid/Desi + Organic chips | Accent-pill `Chip` toggles | "Hybrid / Bt" and "Desi / local" (one-of) → `isHybrid`; "Organic" (independent) → `isOrganic`. |
| Previous-crop chips | Single-select chips + free text | `PREV_CROPS` (Soybean, Cotton, Wheat, Rice, Maize, Onion, Tur/Gram, Sugarcane) + "Fallow / first time" + typed fallback → composed into `notes`. |
| Field-prep chips | Multi-select chips | Ploughing, Harrowing, Levelling, FYM/compost, Bunds/ridges, Summer plough → composed into `notes`. |
| Water-source chips | Single-select chips | Canal, Borewell, Open well, Rainfed, Drip, Farm pond → composed into `notes`. |
| Seed brand | TextInput | Optional → `seedBrand`. |
| Seed source chips | Single-select chips | Dealer/agro-shop, Own/saved seed, Coop/FPO, Govt/KVK → `seedSource` (chip label). |
| Seed rate / Seed cost | Two TextInputs (`decimal-pad`/`numeric`) | "Seed rate (kg)" → `seedQuantityKg`; "Seed cost (₹)" → `seedTotalCostInr`. |
| Seed treatment | Treated/Not + product chips | "Treated"/"Not treated" → `seedTreatment`; when Treated, product chips (Trichoderma, Carbendazim, Imidacloprid, Rhizobium/PSB, Thiram) + free text → `seedTreatmentProduct`. |
| Plan-summary card | Card | Appears once a crop is picked; echoes `{crop} · {variety}` and `{season} · {area} ac · after {prevCrop}`. |
| Footer CTA | `GlowButton` (primary) | "Start crop cycle" → `createCropCycle`; shows "Starting…" and disables while `saving`. |

## Services, APIs & data
- **API endpoint:** `createCropCycle(farmId, data)` (line ~77 of [farmApi.js](../../../frontend/src/services/farmApi.js)) → `POST /api/v1/farms/:farmId/cycles`. This is the sole write.
- **Backend route/service:** [cropCycle.service.js](../../../backend/src/services/cropCycle.service.js) `createCropCycle` creates the `FarmCropCycle` row, validates `areaAllocatedAcres` against the farm size (throws the "Area … exceeds farm size … acres" message), and persists `seedTreatment` / `seedTreatmentProduct` / `seedPurchaseDate` / `notes` alongside the rest. Financials (cost of cultivation, ₹/acre, B:C ratio) are later computed by `computeFinancials()` once logs accrue.
- **Data model:** `FarmCropCycle` in [schema.prisma](../../../backend/prisma/schema.prisma) (line ~1411) — `season`/`year`/`cropName(Mr/Hi)`/`cropCategory`/`variety`/`isHybrid`/`isOrganic`/`areaAllocatedAcres`, the full seed block (`seedName`, `seedBrand`, `seedSource`, `seedQuantityKg`, `seedCostPerKgInr`, `seedTotalCostInr`, `seedTreatment`, `seedTreatmentProduct`, `seedPurchaseDate`, `seedReceiptUrl`), `notes`, `sowingDate`/`expectedHarvestDate`, the `growthStage` enum, and the JSON arrays (`activities[]`, `irrigationLogs[]`, `fertilizersUsed[]`, …) the later loggers append to.
- **State / context:** `useLanguage()` (`t`); local `useState` for crop, query, season, area, variety, `seedType`, `organic`, `prevCrop`, `fieldPrep[]`, `waterSource`, `seedBrand`, `seedSource`, `seedRate`, `treated`, `treatProduct`, `seedCost`, and `saving`. `filteredCrops` is a `useMemo` over the search query + synonym map; `requiredDone` derives the progress bar. Haptics via `utils/haptics`.
- **Local / static data:** `CROP_KEYS` (21 crops), `CROP_SYNONYMS` (fuzzy synonyms incl. Marathi/Hindi transliterations), `SEASONS` (3 tiles), `SEED_TYPES`, `PREV_CROPS`, `FIELD_PREP`, `WATER_SOURCES`, `SEED_SOURCES`, `TREATMENT_PRODUCTS`; illustrations via [CropIcons.js](../../../frontend/src/components/CropIcons.js). Theme tokens from [cosmicTheme.js](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js) — token values are remapped to KhetAI (PRIMARY `#005F21`, gold ACCENT `#E0AF3B`, forest-tinted text, green GLOW) and `CT.family` is Plus Jakarta Sans (body) + Fraunces (display); reference [khetTheme.js](../../../frontend/src/constants/khetTheme.js) and [LoginScreen.js](../../../frontend/src/screens/Auth/LoginScreen.js).

## Languages / i18n
Crop names are localized via `t('crops.'+key)` (and the search matches the localized label too, so a Hindi/Marathi farmer can type in their own script). Field strings draw from the `farmProfile.*` / `nav.*` / `login.*` namespaces with English fallbacks — `nav.newCropCycle`, `farmProfile.varietyPlaceholder`, `farmProfile.seedBrandPlaceholder`, `farmProfile.startCropCycle`, `farmProfile.requiredTitle`, `farmProfile.cropCycleRequiredMsg`, `farmProfile.saveFailed`, `login.error`. The section titles, chip labels (Hybrid/Bt, field-prep, water-source, seed-source, treatment products) and the hero/sub copy are **currently hard-coded English literals** in the screen, not yet pulled through `t()`.

## Notes, edge cases & gaps
- **Stage on creation.** `createCropCycle` does not pass `growthStage` or `sowingDate`, so the cycle starts at the schema default (`PLANNING`) with **no DAS clock**. The DAS clock only starts later, in [SowingLogScreen.js](../../../frontend/src/screens/FarmProfile/SowingLogScreen.js), which stamps `sowingDate` right after `advanceStage('SOWING')` — until then the cycle sits as a `PLANNING` draft and DAS is null.
- **Structured pre-seeding inputs collapse into `notes`.** Previous crop, field-prep multi-select and water source are **not** stored as discrete fields — they are joined into one `notes` string. The detail screen's "Plan & seed" card reads them back from `cycle.notes` + the seed columns (see [08-ActivityLoggers.md](./08-ActivityLoggers.md) and the detail page). A future schema could promote them to typed columns, but today they are free-text in `notes`.
- **Genuine schema-only / unwired fields.** The create call does **not** write `seedReceiptUrl` (no bill/receipt photo capture anywhere), `expectedHarvestDate`, `cropCategory`, `cropNameMr` / `cropNameHi`, `seedCostPerKgInr` (only the total `seedTotalCostInr` is captured — there is no per-kg field), or `seedPurchaseDate` (the column exists and the backend would persist it, but no screen sends it). These remain schema columns with no UI. There is also **no nursery step** for transplanted crops (tomato/onion/chilli) and **no on-credit/udhaar toggle**.
- **`seedName` mirrors `variety`.** The screen sets `seedName = variety` rather than capturing a distinct seed/lot name.
- **Crop list is fixed at 21.** A crop outside `CROP_KEYS` cannot be picked; the empty state asks the farmer to "tell FarmMind and we'll add it." There is no free-text crop entry.
- **Area unit is acres-only.** The "ACRES" pill is the only unit; bigha/guntha/kanal/hectare conversion is flagged "coming soon" (and bigha is region-variable, so it needs a state-aware conversion before it can be added).
- **Relationship to the standalone loggers.** This Crop Plan captures the *intent* (field-prep plan, water source, seed) but logs no activity itself; the *actual* land-prep, sowing and every later operation are appended via the activity loggers from the detail screen — see [08-ActivityLoggers.md](./08-ActivityLoggers.md).
- **Per-screen layout chrome still pending.** Theme token values already render forest-green/gold + Plus Jakarta everywhere (no more blue/amber/Inter), and this screen already uses the Fraunces serif hero title; the broader Login layout polish (gradient 56px icon-square section headers) is applied per-screen and not uniform across every FarmProfile screen yet.
- **Server-side area guard.** Creation can fail if `areaAllocatedAcres` exceeds the farm's remaining size; the screen surfaces the backend's exact message rather than a generic 400.
