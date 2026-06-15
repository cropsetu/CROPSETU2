# Activity Loggers (the per-event capture screens)

> **Tab:** My Farm · **Stack:** `MyFarmStack` (the eight pushed loggers are also re-registered in `AIStack` for deep-linking; the four inline modals live on Crop Cycle Detail) · **Route names:** `ActivityLandPrepLog`, `ActivitySowingLog`, `ActivityIrrigationLog`, `ActivityScoutLog`, `ActivityWeedingLog`, `ActivityPruningLog`, `ActivityExpenseLog`, `ActivityIncomeLog` (+ inline `fertilizer` / `pesticide` / `harvest` / `sale` modals) · **Files:** [logging/](../../../frontend/src/screens/FarmProfile/logging/) · [_loggerKit.js](../../../frontend/src/screens/FarmProfile/logging/_loggerKit.js)

## Purpose
This is the family of small, single-purpose screens that capture **one real-world farm event** and stamp it onto the active crop cycle. After the [Crop Plan](05-CropCyclePlanPage.md) screen has put a crop in the ground, every later operation a farmer does — a tillage pass, a sowing, watering the field, walking the rows looking for pests, weeding, pruning, paying for diesel, selling residue — is recorded here as a **dated log entry** appended to the cycle. Each logger is a focused capture form: pick the operation, type a number or two, optionally add a note, and save. Saving does three jobs depending on the logger: (1) it always writes a row into the cycle's unified **activity feed** (`activities[]`), so the event shows up on the [Crop Cycle Detail](06-CropCycleDetailPage.md) timeline and the [Growth Story](09-GrowthStoryPage.md); (2) some loggers additionally **advance the growth stage** (sowing flips the cycle to `SOWING`); and (3) any rupee figure entered feeds the cycle's **profit-and-loss** via the labour / expense / income ledgers, so the season close-out can compute cost of cultivation and net P/L.

Eight loggers are **pushed full screens** built on a shared [_loggerKit.js](../../../frontend/src/screens/FarmProfile/logging/_loggerKit.js) scaffold (`LoggerScaffold`, `SectionHeader`, `TileGrid`, `ChipRow`, `BigNumberInput`, `LabeledInput`, `NotesField`, `Card`). Four high-frequency operations — **Fertilizer, Spray, Harvest, Sale** — are instead **inline bottom-sheet modals** on Crop Cycle Detail, not separate routes (they reuse the lighter `InputModal` component there).

## Where it sits / how you reach it
- **Reached from:**
  - [ActivityTypePickerScreen](07-ActivityTypePickerPage.md) — the 12-tile grid. Tapping a tile routes to the matching logger via the `ROUTE_BY_TYPE` map in [ActivityTypePickerScreen.js](../../../frontend/src/screens/FarmProfile/ActivityTypePickerScreen.js) (`IRRIGATION → ActivityIrrigationLog`, `LAND_PREP → ActivityLandPrepLog`, `SOWING → ActivitySowingLog`, `SCOUT → ActivityScoutLog`, `WEEDING → ActivityWeedingLog`, `PRUNING → ActivityPruningLog`, `EXPENSE → ActivityExpenseLog`, `INCOME → ActivityIncomeLog`). All carry `{ farmId, cycleId }` as params.
  - The **inline four** are reached without leaving Crop Cycle Detail: the picker's `if (cycleId && ['FERTILIZER','SPRAY','HARVEST','SALE'].includes(type))` branch (and the quick-log chip rail on the detail screen itself — `setModal('fertilizer' | 'pesticide' | 'harvest' | 'sale')`) opens a sheet rather than pushing a screen.
  - The whole picker → logger flow is launched from the "Log today's activity" CTA on [Crop Cycle Detail](06-CropCycleDetailPage.md) and the season hero on [My Farm Home](01-MyFarmHomePage.md).
- **Navigates to:** Back only. On a successful save the logger shows a `CelebrationSheet` (a one-day-streak confetti sheet); its `onCelebrateClose` calls `navigation.goBack()`, dropping the farmer back on the picker / detail screen where the new entry is already in the feed. The inline modals just close (`setModal(null)`) and the detail screen re-fetches.
- **Route params in:** `{ farmId, cycleId }`. `cycleId` is the load-bearing one — **every logger requires it** and aborts with an Alert ("Pick a crop cycle — start a crop cycle first to log against it.") if it is missing, because every entry must hang off a cycle. `farmId` is read by Irrigation only; the others derive the farm header from `useMultiFarm().activeFarm` for the subtitle.

## How it works
- **One shared scaffold.** Seven of the eight pushed loggers render `<LoggerScaffold>` from [_loggerKit.js](../../../frontend/src/screens/FarmProfile/logging/_loggerKit.js): a `CosmicScreen` canvas + `CosmicHeader` (title + farm subtitle) + a scrollable body of `SectionHeader`/`TileGrid`/`ChipRow`/`BigNumberInput`/`LabeledInput`/`NotesField`/`Card` blocks + a **sticky footer `GlowButton`** that is disabled until the one required field is set + a `CelebrationSheet`. **Irrigation is the exception** — it predates the kit and hand-rolls the identical scaffold inline (its own `SectionHeader`, method grid, hours/litres toggle, etc.), which is why it is the largest file.
- **Minimal validation, one required field.** Each logger has exactly one gate in `canSave`: an operation/method/issue/part must be picked, or (for the cash logs) an amount > 0 must be entered. Everything else — implement, labour, machinery, severity, notes — is **optional**. This keeps a log to two or three taps.
- **What a save writes (per logger):**
  - **Land prep, Sowing, Weeding, Pruning, Scout, Expense, Income** → `farmApi.addActivity(cycleId, { type, title, notes, fields })`, which appends to `activities[]`. Their type tokens are `LAND_PREP`, `SOWING`, `WEEDING`, `PRUNING`, `SCOUT`, `EXPENSE`, `INCOME`.
  - **Sowing additionally** calls `farmApi.advanceStage(cycleId, 'SOWING')` **and then `farmApi.updateCropCycle(cycleId, { sowingDate: now })`** (a `PATCH /cycles/:id`) — it is the screen that moves the cycle from `LAND_PREP` to `SOWING` **and stamps `sowingDate`, which is what actually starts the DAS clock** the rest of My Farm (the stage banner, Growth Story "Day N", DAS-band stage derivation) hangs off. Before this stamp landed nothing wrote `sowingDate`, so DAS stayed `null`; sowing day = DAS 0.
  - **Cost side-effects:** any `labour` figure → `farmApi.addLaborLog(cycleId, { task, amountInr })`; any `machinery`/`diesel` figure → `farmApi.addExpenseLog(cycleId, { category:'machinery', amountInr })`. Expense logger writes `addExpenseLog` (+ an `EXPENSE` activity); Income logger writes `addIncomeLog` (+ an `INCOME` activity).
  - **Scout** is special: non-`healthy` findings also call `farmApi.addObservedEvent(cycleId, { type, severity, damageEstimatePct, notes })` so the AI (FarmMind) can factor prior pest/disease pressure into advice; a `healthy` scout writes only the `SCOUT` activity.
  - **Irrigation** calls `farmApi.addIrrigationLog(cycleId, { method, durationHours|volumeLitres, waterSource, soilMoistureBefore, fertigationDone, notes, date })`, written to `irrigationLogs[]`.
  - **Inline modals** call their dedicated endpoints from `submitModal`: `addFertilizer` (→ `fertilizersUsed[]`), `addPesticide` (→ `pesticidesUsed[]`), `recordHarvest` (→ `harvestYieldKg` / `harvestQualityGrade` …), `recordSale` (→ `saleSoldQuantityKg` / `salePricePerKgInr` / `saleBuyerName` …).
- **Haptics + celebration.** Save fires a success haptic and shows the per-logger `CelebrationSheet` ("Land prep logged ✓", "Stage moved to Sowing.", "FarmMind will factor this into advice." …); validation or network failure fires an error haptic + `Alert`.
- **Stage interaction.** Only Sowing advances the stage automatically. The other loggers are **stage-agnostic** — a farmer can log irrigation or scouting at any DAS; the timeline derives which stage band the event falls in for display, but the authoritative `cycle.growthStage` is only moved explicitly (by Sowing here, or by the stage control / harvest close-out on the detail screen). The DAS→stage *bands* used for that display are **crop- and sowing-date-sensitive** (e.g. for generic wheat: tillering/VEGETATIVE ~0–60 DAS, jointing–booting ~60–80, anthesis/FLOWERING ~80–100, grain-fill ~100–125, MATURITY ~125–140 — and late sowing compresses the whole calendar), so the source of truth should be a per-crop band table rather than one hard-coded prose example.

## UI elements

### Shared kit primitives (every pushed logger)

| Element | Type | Description / action |
|---|---|---|
| `LoggerScaffold` | Screen scaffold | `CosmicScreen` + `CosmicHeader` + scroll body + sticky footer `GlowButton` + `CelebrationSheet`; `KeyboardAvoidingView`. |
| `CosmicHeader` | Header | Back arrow; title (e.g. "Log land prep"); subtitle = farm name + " · active cycle". |
| `SectionHeader` | Row | Tinted 26px icon-square + bold title + optional "Optional" pill; one per field group. |
| `TileGrid` | Single-select grid | 2- or 3-column tinted tiles with a 36px icon + check badge; tap toggles (`onChange(null)` deselects). |
| `ChipRow` | Single/multi-select pills | Pill row; `multi=true` makes `value` an array. |
| `BigNumberInput` | Large numeric field | Centred big input + unit pill (`₹`, `KG`, `%`, hours…); `decimal-pad`/`numeric`. |
| `LabeledInput` | Text input | Uppercase label + single-line input (e.g. "Name / target", "Vendor"). |
| `NotesField` | Multiline input | "Notes" — free observation, `textAlignVertical:'top'`. |
| `Card` | `GlassCard` wrapper | Wraps inputs (variant `plain`). |
| Footer | `GlowButton` (full, sticky) | "Log …" / "Saving…"; gradient + glow; **disabled until `canSave`**; spinner while saving. |
| `CelebrationSheet` | Bottom sheet | Confetti + per-logger title/subtitle + `streakDays={1}`; close → `navigation.goBack()`. |

### Per-logger field tables

#### Land prep — `ActivityLandPrepLog` ([LandPrepLogScreen.js](../../../frontend/src/screens/FarmProfile/logging/LandPrepLogScreen.js))

| Field | Type | Values / unit | Required | Persists to |
|---|---|---|---|---|
| Operation | `TileGrid` (2-col) | Ploughing · Harrowing · Levelling · Bund | **Yes** | `activities[].fields.operation` (+ `title`) |
| Implement | `ChipRow` | Tractor · Bullock · Power tiller · Manual | No | `activities[].fields.implement` |
| Labour cost | `BigNumberInput` ₹ | rupees | No | `addLaborLog({ task:'Land prep', amountInr })` → P&L labour |
| Diesel / Machinery cost | `BigNumberInput` ₹ | rupees | No | `addExpenseLog({ category:'machinery', amountInr })` → P&L |
| Notes | `NotesField` | free text | No | `activities[].notes` |

→ `addActivity(type:'LAND_PREP')`. **Does not** advance stage (the cycle is already at/after `LAND_PREP`).

#### Sowing — `ActivitySowingLog` ([SowingLogScreen.js](../../../frontend/src/screens/FarmProfile/logging/SowingLogScreen.js))

| Field | Type | Values / unit | Required | Persists to |
|---|---|---|---|---|
| Method | `TileGrid` (2-col) | Broadcasting · Line sowing · Dibbling · Transplant | **Yes** | `activities[].fields.method` (+ `title`) |
| Seed used | `BigNumberInput` KG | kilograms | No | `activities[].fields.seedKg` |
| Labour cost | `BigNumberInput` ₹ | rupees | No | `addLaborLog({ task:'Sowing', amountInr })` → P&L |
| Notes | `NotesField` | free text | No | `activities[].notes` |

→ `addActivity(type:'SOWING')` **+ `advanceStage('SOWING')` + `updateCropCycle({ sowingDate: now })`**. This is the only logger that moves `growthStage`; the celebration reads "Stage moved to Sowing." **The `sowingDate` PATCH is the load-bearing side-effect — it sets DAS 0**, so every downstream DAS readout (stage banner, Growth Story "Day N", DAS-band → stage mapping) starts ticking from the day you log sowing. Until this was wired, `sowingDate` was never written and DAS was always `null`. Practical note: if a farmer logs sowing a few days late, DAS is offset by that lag — there is no back-date field yet (a known gap; see below).

#### Irrigation — `ActivityIrrigationLog` ([IrrigationLogScreen.js](../../../frontend/src/screens/FarmProfile/logging/IrrigationLogScreen.js))

| Field | Type | Values / unit | Required | Persists to |
|---|---|---|---|---|
| Method | Tile grid | Drip · Sprinkler · Flood · Rain gun | **Yes** | `irrigationLogs[].method` |
| How much (Hours **or** Litres) | Hours/Litres toggle + big input | hours `[decimal]` or litres `[number]` | **Yes** (one of) | `durationHours` **or** `volumeLitres` |
| Water source | Chip row | Borewell · Open well · Canal · Pond · Tanker | No | `waterSource` |
| Soil moisture before | Stoplight tiles | Dry · Moist · Wet | No | `soilMoistureBefore` |
| Fertigation applied | Checkbox | on/off | No | `fertigationDone` |
| Notes | Multiline | free text | No | `notes` |

→ `addIrrigationLog(cycleId, { … , date: now })` to `irrigationLogs[]`. Repeatable per watering; the comment in source notes this is the legacy cycle-scoped call (v2 will accept `plotId`). **Date is auto-stamped to now** — no manual back-date field yet.

#### Scout (field scouting) — `ActivityScoutLog` ([ScoutLogScreen.js](../../../frontend/src/screens/FarmProfile/logging/ScoutLogScreen.js))

| Field | Type | Values / unit | Required | Persists to |
|---|---|---|---|---|
| What did you see? | `TileGrid` (3-col) | Pest · Disease · Weed · Deficiency · **Healthy** | **Yes** | `activities[].fields.issueType` |
| Name / target | `LabeledInput` | e.g. "Aphids", "Leaf curl" | No | `fields.target` (+ used as `title` & observed-event `type`) |
| Severity | `TileGrid` (2-col) | Low · Moderate · High · Critical (default Moderate) | No | `fields.severity` / `observedEvents[].severity` |
| Affected % | `BigNumberInput` % | percent | No | `fields.affectedPct` / `damageEstimatePct` |
| Notes | `NotesField` | free text | No | `activities[].notes` |

→ always `addActivity(type:'SCOUT')`; **if not `healthy`** also `addObservedEvent(cycleId, { type, severity, damageEstimatePct, notes })`. The observed event feeds AI advice and the diagnosis history. A photo for AI ID is a planned field (see gaps).

#### Weeding (interculture) — `ActivityWeedingLog` ([WeedingLogScreen.js](../../../frontend/src/screens/FarmProfile/logging/WeedingLogScreen.js))

| Field | Type | Values / unit | Required | Persists to |
|---|---|---|---|---|
| Method | `TileGrid` (3-col) | Manual · Mechanical · Herbicide | **Yes** | `activities[].fields.method` (+ `title`) |
| Labour cost | `BigNumberInput` ₹ | rupees | No | `addLaborLog({ task:'Weeding', amountInr })` → P&L |
| Notes | `NotesField` | free text | No | `activities[].notes` |

→ `addActivity(type:'WEEDING')`.

#### Pruning (training/staking) — `ActivityPruningLog` ([PruningLogScreen.js](../../../frontend/src/screens/FarmProfile/logging/PruningLogScreen.js))

| Field | Type | Values / unit | Required | Persists to |
|---|---|---|---|---|
| What was pruned? | `TileGrid` (2-col) | Tips · Suckers · Canopy · Deadwood | **Yes** | `activities[].fields.part` (+ `title`) |
| Labour cost | `BigNumberInput` ₹ | rupees | No | `addLaborLog({ task:'Pruning', amountInr })` → P&L |
| Notes | `NotesField` | free text | No | `activities[].notes` |

→ `addActivity(type:'PRUNING')`.

#### Expense (cash-out) — `ActivityExpenseLog` ([ExpenseLogScreen.js](../../../frontend/src/screens/FarmProfile/logging/ExpenseLogScreen.js))

| Field | Type | Values / unit | Required | Persists to |
|---|---|---|---|---|
| Category | `TileGrid` (3-col) | Diesel · Machinery hire · Transport · Electricity · Tools · Other (default Other) | No | `expenseLogs[].category` |
| Amount | `BigNumberInput` ₹ | rupees | **Yes (> 0)** | `expenseLogs[].amountInr` |
| Vendor | `LabeledInput` | e.g. "Krishi Kendra" | No | `expenseLogs[].vendor` |
| Notes | `NotesField` | free text | No | `expenseLogs[].notes` |

→ `addExpenseLog(cycleId, …)` **+** `addActivity(type:'EXPENSE', title:'<category> ₹<amt>')`. The catch-all for any cost not tied to a specific operation; flows straight into cost of cultivation.

#### Income (cash-in) — `ActivityIncomeLog` ([IncomeLogScreen.js](../../../frontend/src/screens/FarmProfile/logging/IncomeLogScreen.js))

| Field | Type | Values / unit | Required | Persists to |
|---|---|---|---|---|
| Source | `TileGrid` (3-col) | Intercrop · Residue · Subsidy · Rental · Other (default Other) | No | `incomeLogs[].source` |
| Amount | `BigNumberInput` ₹ | rupees | **Yes (> 0)** | `incomeLogs[].amountInr` |
| Notes | `NotesField` | free text | No | `incomeLogs[].notes` |

→ `addIncomeLog(cycleId, …)` **+** `addActivity(type:'INCOME', title:'<source> ₹<amt>')`. Captures non-sale revenue (intercrop, crop residue, subsidy receipts, plot rental). The main-crop sale is recorded separately by the Sale modal.

### Inline modals (on [Crop Cycle Detail](06-CropCycleDetailPage.md), not pushed routes)

These four reuse the lighter `InputModal` bottom sheet in [CropCycleDetailScreen.js](../../../frontend/src/screens/FarmProfile/CropCycleDetailScreen.js); `submitModal` dispatches by modal key.

| Modal | Fields (label · keyboard) | Required | API → data |
|---|---|---|---|
| **Fertilizer** (`flask-outline`) | Product * · Quantity (kg) `decimal-pad` · Cost (₹) `numeric` | Product | `addFertilizer` → `fertilizersUsed[]` |
| **Spray** (`color-filter-outline`) | Product * · Active ingredient · Quantity (ml) `decimal-pad` · Cost (₹) `numeric` | Product | `addPesticide` → `pesticidesUsed[]` |
| **Harvest** (`basket-outline`) | Yield (kg) * `decimal-pad` · Quality grade (A/B/C) | Yield | `recordHarvest` → `harvestYieldKg`, `harvestQualityGrade`, … |
| **Sale** (`cash-outline`) | Quantity (kg) * `decimal-pad` · Price per kg (₹) * `decimal-pad` · Buyer / mandi | Qty + Price | `recordSale` → `saleSoldQuantityKg`, `salePricePerKgInr`, `saleBuyerName`, `saleTotalRevenueInr` |

> ⚠ **Sale price unit caveat:** this modal captures **₹/kg** (`pricePerKgInr`), but mandis quote **₹/quintal**. A farmer entering the per-quintal figure overstates revenue **100×**. Default should be ₹/quintal (kg optional); see gaps. Revenue here is also *gross* — net-of-deductions (commission/hamali/cess/moisture cut, ~6–10%) is not captured, so P&L revenue is currently slightly optimistic.

(There is also a fifth lightweight `irrigation` `InputModal` on the detail screen — Method + Duration only — a quick-log shortcut that posts via `addIrrigationLog`, distinct from the full `ActivityIrrigationLog` screen above.)

## Services, APIs & data
- **Frontend API** — all via [farmApi.js](../../../frontend/src/services/farmApi.js): `addActivity(cycleId, {type,title,notes,fields})`, `addLaborLog`, `addExpenseLog`, `addIncomeLog`, `addObservedEvent`, `addIrrigationLog`, `advanceStage(cycleId, stage)` (pushed loggers); `addFertilizer`, `addPesticide`, `recordHarvest`, `recordSale` (inline modals).
- **Context:** `useMultiFarm().activeFarm` (header subtitle), `useLanguage().t` (error/title strings).
- **Data model** — [schema.prisma](../../../backend/prisma/schema.prisma) `FarmCropCycle`: generic events land in `activities[]` (`{id,type,date,title,notes,photoUrl?,voiceUrl?,fields{}}`); typed arrays `irrigationLogs[]`, `fertilizersUsed[]`, `pesticidesUsed[]`, `observedEvents[]`, `laborLogs[]`, `expenseLogs[]`, `incomeLogs[]`; harvest/sale scalar columns (`harvestYieldKg/Quintal/PerAcreKg`, `harvestQualityGrade`, `harvestMoisturePct`, `saleSoldQuantityKg`, `salePricePerKgInr`, `saleTotalRevenueInr`, `saleBuyerType/Name`, `saleDate`, `saleMandiName`); `growthStage` enum (advanced by Sowing).
- **P&L / close-out:** the labour/expense/income rows and harvest/sale columns are summed by `computeFinancials()` in [cropCycle.service.js](../../../backend/src/services/cropCycle.service.js) (surfaced through `getCycleFinancials()`) into cost of cultivation, cost/acre, revenue, net P/L, yield/acre and benefit–cost ratio on [Crop Cycle Detail](06-CropCycleDetailPage.md).
- **Theme:** `COSMIC`/`CR`/`CS` tokens + per-activity tints (`COSMIC.LAND_PREP`, `.SOWING`, `.IRRIGATION`, `.SCOUT`, `.WEEDING`, `.PRUNING`, `.EXPENSE`, `.INCOME`, `.FERTILIZER`, `.SPRAY`, `.HARVEST`, `.SALE`) from [cosmicTheme.js](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js).

## Languages / i18n
The loggers are largely **hardcoded English today** — titles ("Log land prep"), section headers, tile/chip labels, the "Optional" pill, celebration copy and the "Pick a crop cycle" / "Missing info" alerts are literals in each screen and in [_loggerKit.js](../../../frontend/src/screens/FarmProfile/logging/_loggerKit.js). The only `t()` calls are the error-title fallback (`t('login.error')`). The redesign moves all of this under the **`myFarm.v2.*`** namespace (e.g. `myFarm.v2.activity.*` for tile labels, with per-logger field-label keys), adds the in-header glass **language-toggle pill**, and adds **voice-to-text in the local language** on `NotesField` (and a voice-note attachment per event). None of the language toggle / voice plumbing is in these screens yet.

## Notes, edge cases & gaps
- **`cycleId` is mandatory.** With no active cycle every logger aborts with an Alert and saves nothing — you cannot log a stray event against a bare plot. This is by design (every event must belong to a cycle), but it means the loggers are dead-ends until the [Crop Plan](05-CropCyclePlanPage.md) screen has created a cycle.
- **The current loggers are intentionally thin vs. the blueprint.** Each captures one required field + one or two costs + a note. The **redesigned** loggers are meant to capture the full India-specific event detail per operation — the global capture set on *every* event being **date + DAS stamp, area, labour (persons × days or ₹), machine/diesel litres + ₹, input product + qty + ₹, photo, GPS, voice-note, and an on-credit (udhaar) toggle on every cost**, plus a **bill/receipt photo prompt on every purchase** (seed/fertilizer/pesticide) for PMFBY claims, dealer complaints and traceability. Concretely, the not-yet-in-code additions per logger are:
  - **Land prep:** multiple passes (summer/deep plough, rotavator, puddling, ridge-furrow, stubble removal), implement/power detail, passes count, area, hired/own, diesel **litres** (not just ₹), labour count + wage; plus an **amendment-incorporation** block (FYM/vermicompost/gypsum/lime/neem cake … qty + unit + source + transport cost).
  - **Sowing:** seed sourcing (source, class, rate kg/acre, lot/batch, dealer+licence, **bill photo**, MRP-vs-paid), **seed treatment** (product/AI, dose) captured in the **correct field order — fungicide → insecticide → bio-agent/biofertilizer LAST**, applied only after the chemical dressings have *dried* (a contact fungicide mixed wet kills the inoculant). For pulses, oilseeds and groundnut the bio step is near-universal **Rhizobium + PSB** inoculation — name it, not just generic "bio". A **nursery** sub-flow for transplanted crops (age at transplant, seedlings raised), and full sowing geometry (spacing row×plant, depth, soil-moisture *vapsa*, plant-population target, seed-used reconcile). The Crop Plan screen ([05-CropCyclePlanPage.md](05-CropCyclePlanPage.md)) already captures a first-pass `seedTreatment` (Treated/Not) + product chip (Trichoderma/Carbendazim/Imidacloprid/Rhizobium-PSB/Thiram) at plan time; this logger is the place to record the actual at-sowing dressing in dose + order.
  - **Irrigation:** setup-once block (pump type, PMKSY drip subsidy), per-event crop-stage/**criticality flag**, depth, electricity-vs-diesel cost, and a **skipped-no-water** stress toggle. The criticality flag matters because irrigation in India is scheduled around a crop's *critical stages* — for wheat that is CRI (crown-root initiation, ~21 DAS), tillering, jointing, flowering and milk; rice wants standing water from tillering through flowering. A pre-sowing **palewa / rauni** irrigation (wetting the field for tilth before sowing) is a genuine land-prep watering that has no home yet (it precedes the cycle's sowing event, so it currently can't be logged against a DAS). Today date is auto-`now` with no back-date and no manual DAS.
  - **Scout:** crop-specific pest/disease pick-lists (still a genuine gap — the issue type is a generic Pest/Disease/Weed/Deficiency/Healthy grid and the name/target is free text, not a per-crop list), **count/intensity against an ETL (Economic Threshold Level)** so a finding can read "spray-worthy" vs "watch" rather than a bare severity chip, % affected, **photo for AI ID** (to drive diagnosis), and a precise location-in-field selector. Currently target is free text and there is no photo.
  - **Weeding/Pruning:** richer operation list (hoeing, thinning, gap-fill, earthing-up, mulching, staking, training, detopping), tool, area, machine + material cost.
  - **Fertilizer (inline):** dose type (**Basal / Top-dress / Foliar / Fertigation**), crop stage at application, method, after-irrigation toggle, bill photo. The captured `Basal/Top-dress` split is what makes the N-P-K logic legible: **basal = full P + full K + part of the N (DAP/SSP + MOP at sowing), plus ZnSO₄ which is a routine basal in most Indian soils;** the remaining N (as urea) is **top-dressed in 1–2 splits tied to stage** — e.g. wheat: basal DAP + MOP + ZnSO₄ at sowing, urea top-dress at CRI (~21 DAS) and again at jointing. P and K are normally basal-only; N is the nutrient that gets split. The screen does not yet derive these N-P-K quantities from product + crop (a known gap — see below).
  - **Spray (inline):** control type, target, dose per acre + water volume, sprayer type, **PHI (pre-harvest interval) noted**, tank-mix, bill photo.
  - **Harvest/Sale (inline):** per-**pick** number and **cumulative + per-acre yield (auto)** — important because cotton/chilli/most veg are *multi-pick*: each picking adds yield without closing the cycle, and only the final pick + sale flips the stage to `HARVESTED` (the current single-yield modal can't accumulate pickings yet). Plus maturity signs, **moisture %**, drying/storage; and on Sale — channel (APMC/trader/FPO/*adatiya*/contract/MSP/e-NAM/direct), grade, sold-at-MSP toggle, itemised **deductions** (commission/*hamali*/weighing/cess/moisture cut, typically ~6–10% of gross), **net received** (P&L revenue should use NET, not gross), payment mode/received, sale **patti** photo. **Unit fix needed:** mandi prices and MSP in India are quoted **₹ per quintal** (and yield in quintal/acre) — the current Sale modal asks for **"Price per kg (₹)"** (`pricePerKgInr` → `salePricePerKgInr`), so a farmer who types the ₹/quintal figure produces a **100× revenue error**. The default sale-price unit should be **₹/quintal** (kg optional). Area is acres-only today; a *bigha* conversion is region-/state-variable and would need a state-aware factor.
- **Schema columns written by no logger (genuine gaps).** Several columns exist on `FarmCropCycle` but are not populated by any capture screen: `seedReceiptUrl` (the bill/receipt photo prompt is unbuilt), `seedPurchaseDate` (Crop Plan does not capture it; backend would persist it if sent), `seedCostPerKgInr` (only a total seed cost is captured), `expectedHarvestDate`, `cropCategory`, and the localized `cropNameMr` / `cropNameHi`. These remain schema-only / unwired and should keep being flagged. Separately, **N-P-K derivation is not done** — the Fertilizer modal stores the product name + qty but does not convert product (e.g. DAP, urea, MOP) into actual N, P₂O₅ and K₂O applied, so the basal-vs-top-dress split logic above is captured only as free labels, not computed nutrient totals.
- **KhetAI re-theme — token values already remapped; per-screen layout chrome still pending.** The `cosmicTheme` token *values* now resolve to the KhetAI palette: `COSMIC.PRIMARY` forest green `#005F21`, `COSMIC.ACCENT` gold `#E0AF3B` (was orange), forest-tinted `TEXT`/surfaces, soft green `GLOW`/shadow, and `CT.family` = Plus Jakarta Sans body + Fraunces display (`CT.family.display`/`displaySemi`/`displayItalic`). Every `Inter_*` literal in these screens was swapped 1:1 to `PlusJakartaSans_*` (visible throughout `_loggerKit.js` and `IrrigationLogScreen.js` above), so the loggers already render forest-green/gold + Plus Jakarta — **not** the old blue/amber/Inter look. What is **not yet applied per-screen** is the Login-style layout chrome: Fraunces serif titles with an italic green second line, 56px gradient icon-square headers, and the `autofillBanner` AI-nudge strip. The `CosmicHeader` title is already Fraunces; the logger body still uses the plain `SectionHeader` icon-square (26px) and Plus Jakarta titles. Exported `cosmicTheme` symbol names are unchanged; only values were remapped.
- **Irrigation is off-kit.** It hand-rolls the scaffold instead of using `_loggerKit`, so its styling/labels drift from the other seven and must be migrated separately during the re-theme.
- **No offline `SyncBadge` here.** Saves go straight to the API with a blocking spinner + Alert on failure; the offline-first "Saved offline, will sync" affordance the rest of My Farm targets is not wired into the loggers yet.
- **No edit/delete of a logged event from the loggers** — once saved, an entry is corrected only from the Crop Cycle Detail feed (where supported); the loggers are append-only.
- **Stage advancement is manual everywhere except Sowing.** Logging fertilizer/scouting at a later DAS never auto-moves `growthStage`; VEGETATIVE→FLOWERING→FRUITING→MATURITY are advanced from the detail screen's stage control, and `HARVESTED` is set by the harvest close-out (`completeCycle`). Two agronomy notes on the enum: (a) the `FRUITING` label is horticulture wording — for the India staples this app mostly tracks it should *read* per crop category: **"Grain filling" (cereals — wheat/rice/maize), "Pod development" (pulses/oilseeds — gram/soybean/groundnut), "Boll development" (cotton), "Fruit set/development" (veg/fruit)**. This is a display label-mapping nuance, not extra enum values. (b) **`HARVESTED` = season close-out, not the first pick.** For multi-pick crops (cotton, chilli, most veg) the cycle should keep accruing yield/sale across pickings and only flip to `HARVESTED` at the final pick + sale; single-harvest cereals close on the one harvest. The harvest modal currently records a single yield figure, so multi-pick accumulation is not yet modelled (gap below).
