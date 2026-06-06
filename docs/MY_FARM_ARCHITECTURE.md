# CropSetu — "My Farm" Tab Architecture

End-to-end architecture of the **My Farm** tab (the `FarmProfile` module), covering the React Native client, the Node.js/Express gateway, PostgreSQL (Prisma), and the points where it touches the FastAPI AI service. Written as a reference for future work — every section points at exact source files and lines.

> **TL;DR:** "My Farm" is a farm-record-keeping + agronomy hub. The mobile app (8 screens + a self-contained "cosmic" design system) talks only to Express at `/api/v1/farms*`, `/api/v1/cycles*`, and `/api/v1/irrigation*`. Express owns auth, validation, and all persistence via Prisma/PostgreSQL. The core domain is **Farm → CropCycle → (activity logs + harvest + sale + financials)**. Irrigation advice is computed server-side with a Hargreaves ET₀ model.

> **⚠ This doc describes the original (v1) baseline. A production-grade upgrade has since shipped — see [§13 v2 upgrade](#13-v2-upgrade-shipped) for what changed (charts, AI-context enrichment, full activity logging, resilient writes, mandi prices, voice, real insights).**

---

## Table of contents

1. [Topology](#1-topology)
2. [Navigation & screen map](#2-navigation--screen-map)
3. [Frontend state & contexts](#3-frontend-state--contexts)
4. [Frontend → backend API contract](#4-frontend--backend-api-contract)
5. [Backend data model (Prisma)](#5-backend-data-model-prisma)
6. [Backend business logic](#6-backend-business-logic)
7. [AI insights & FastAPI involvement](#7-ai-insights--fastapi-involvement)
8. [Design system — the "cosmic" UI](#8-design-system--the-cosmic-ui)
9. [Offline & sync reality](#9-offline--sync-reality)
10. [Internationalization](#10-internationalization)
11. [Known gaps, inconsistencies & TODOs](#11-known-gaps-inconsistencies--todos)
12. [File map](#12-file-map)

---

## 1. Topology

```
┌──────────────────────────┐   HTTPS / JSON      ┌──────────────────────────┐                ┌─────────────────────┐
│  FRONTEND (RN / Expo)     │   Bearer JWT        │  NODE.JS / EXPRESS        │   Prisma       │  PostgreSQL         │
│  FarmProfile module       │ ──────────────────► │  :3001/api/v1             │ ─────────────► │  farms              │
│                           │                     │  - authenticate (JWT)     │                │  farm_crop_cycles   │
│  MyFarmHome / FarmList /   │ ◄────────────────── │  - express-validator      │ ◄───────────── │  irrigation_logs    │
│  FarmDetail / AddEdit /    │   JSON data         │  - farm/cycle/irrigation  │                │  farmer_predictions │
│  CropCycleCreate/Detail /  │                     │    services               │                │  farm_soil_reports  │
│  ActivityPicker / IrrigLog │                     │                           │                │  farm_weather_*     │
│                           │                     │                           │                │  crop_master        │
│  farmApi.js → api.js       │                     │                           │                └─────────────────────┘
└──────────────────────────┘                     └──────────────────────────┘
        state via                                          │  ▲
   MultiFarmContext (server farms)                         │  │ Open-Meteo (weather for ET₀)
   FarmContext (local AI profile)                          ▼  │
                                                    ┌──────────────────────┐   HMAC-signed
                                                    │  FastAPI (Python)     │ ◄── only /ai/alerts today
                                                    │  :8001  AI brain      │     (NOT yet wired into
                                                    └──────────────────────┘      My Farm screens)
```

**Three load-bearing facts**

| Fact | Detail |
| --- | --- |
| App talks only to Express | No My Farm screen calls FastAPI directly. All reads/writes go through [frontend/src/services/farmApi.js](frontend/src/services/farmApi.js), which uses the shared axios instance in [frontend/src/services/api.js](frontend/src/services/api.js). |
| Activity logs are JSON columns, not tables | Fertilizer / pesticide / irrigation / event logs live as JSON arrays **inside** the `FarmCropCycle` row, not in separate tables. Each write does a read-modify-write of the whole array. |
| AI insights are scaffolded but inert | `getFarmInsights` reads the `FarmerPrediction` table, which nothing in the codebase ever populates → always `[]`. `FarmDetailScreen` falls back to client-side heuristics. |

---

## 2. Navigation & screen map

The tab is registered in [frontend/src/navigation/AppNavigator.js](frontend/src/navigation/AppNavigator.js#L398-L413) as `MyFarmNavigator` (a `createStackNavigator`), tab label `t('myFarm.tabLabel')`, leaf icon. **Every screen renders its own header** (the stack header is hidden globally — `headerShown: false`), because the screens draw a dark/"cosmic" canvas and use the custom `CosmicHeader`.

> Note: the same `FarmProfile` screens are **also** registered inside `AINavigator` ([AppNavigator.js:356-362](frontend/src/navigation/AppNavigator.js#L356-L362)) and `ProfileNavigator` ([AppNavigator.js:448-454](frontend/src/navigation/AppNavigator.js#L448-L454)) so they're reachable from the AI tab and the Account tab too. The components are shared; only the navigator hosting them differs.

### Screens (all under `frontend/src/screens/FarmProfile/`)

| Route | File | Role |
| --- | --- | --- |
| `MyFarmHome` | [MyFarmHomeScreen.js](frontend/src/screens/FarmProfile/MyFarmHomeScreen.js) (901 L) | Hub dashboard: greeting, active-farm hero + streak, quick-log chip rail, recent activity feed, active crop cycles, AI insights. |
| `FarmList` | [FarmListScreen.js](frontend/src/screens/FarmProfile/FarmListScreen.js) (304 L) | All farms as cards (soil-stripe accent); long-press → set active / edit / delete; orange FAB to add. |
| `FarmDetail` | [FarmDetailScreen.js](frontend/src/screens/FarmProfile/FarmDetailScreen.js) (600 L) | One farm: stats hero, **client-side** insights, cycles, soil badges, 4-card AI action grid. |
| `FarmAddEdit` | [FarmAddEditScreen.js](frontend/src/screens/FarmProfile/FarmAddEditScreen.js) (548 L) | Add/edit farm form: identity, cascading location pickers + GPS, soil swatches, irrigation tiles. |
| `CropCycleCreate` | [CropCycleCreateScreen.js](frontend/src/screens/FarmProfile/CropCycleCreateScreen.js) (507 L) | Start a cycle: searchable crop grid (with regional synonyms), season picker, area, seed info. |
| `CropCycleDetail` | [CropCycleDetailScreen.js](frontend/src/screens/FarmProfile/CropCycleDetailScreen.js) (1011 L) | One cycle: hero + stage timeline, P&L, quick-log rail, unified activity feed, inline log modals, complete/delete. |
| `ActivityTypePicker` | [ActivityTypePickerScreen.js](frontend/src/screens/FarmProfile/ActivityTypePickerScreen.js) (154 L) | 12-tile grid of activity types; routes to a typed logger or prefills a CropCycleDetail modal. |
| `ActivityIrrigationLog` | [logging/IrrigationLogScreen.js](frontend/src/screens/FarmProfile/logging/IrrigationLogScreen.js) (519 L) | Dedicated irrigation logger: method, duration/volume toggle, water source, soil-moisture stoplight, fertigation, notes. |

### Navigation flow

```
MyFarmHome ─┬─► FarmList ─┬─► FarmDetail ─┬─► FarmAddEdit (edit)
            │             │               ├─► CropCycleCreate ─► (back)
            │             └─► FarmAddEdit  ├─► CropCycleDetail
            │                 (add)        └─► AIAssistant.* (AIChat / InputCalculator / SoilHealth / Market)
            ├─► FarmAddEdit (add/edit active farm)
            ├─► CropCycleCreate {farmId}
            ├─► CropCycleDetail {cycleId}        (inline modals: fertilizer/spray/irrigation/harvest/sale)
            ├─► ActivityTypePicker {farmId,cycleId} ─┬─► ActivityIrrigationLog {farmId,cycleId}
            │                                        └─► CropCycleDetail {cycleId, prefillActivity}
            └─► ActivityIrrigationLog {farmId,cycleId}   (direct from quick-log)
```

Key params: `FarmDetail{farmId}`, `CropCycleCreate{farmId}`, `CropCycleDetail{cycleId, prefillActivity?}`, `ActivityTypePicker{farmId?, cycleId?, plotId?}`, `ActivityIrrigationLog{farmId?, cycleId}`.

---

## 3. Frontend state & contexts

There is **no Redux**; state is context + screen-local `useState`. Two distinct farm contexts coexist (a known source of confusion — see [§11](#11-known-gaps-inconsistencies--todos)):

| Context | File | Purpose | Storage |
| --- | --- | --- | --- |
| `MultiFarmContext` → `useMultiFarm()` | [frontend/src/context/MultiFarmContext.js](frontend/src/context/MultiFarmContext.js) | **The one the FarmProfile screens use.** Server-synced list of farms; active farm; CRUD that calls `farmApi`. | AsyncStorage cache key `fe_farms_v1` (stale-while-revalidate). |
| `FarmContext` → `useFarm()` | [frontend/src/context/FarmContext.js](frontend/src/context/FarmContext.js) | Older single local "farmer profile" used to seed AI calls (`getAIContext()`). | AsyncStorage key `farmeasy_farm_profile_v2`. |
| `LanguageContext` → `useLanguage()` | [frontend/src/context/LanguageContext.js](frontend/src/context/LanguageContext.js) | `t()` translator; separate UI `language` vs chat `chatLanguage` (`auto`). | — |
| `AuthContext` → `useAuth()` | (auth module) | `user`, login state; gates data loads (`if (!user?.id) return`). | secure-store tokens. |

`useMultiFarm()` exposes: `farms`, `activeFarm`, `activeFarmId`, `loading`, `syncing`, `refresh()`, `switchActiveFarm()`, `addFarm()`, `editFarm()`, `removeFarm()`. On mount it renders the cached list immediately, then calls `listFarms()` in the background; `syncing` drives the header `SyncBadge`.

There are **no farm-specific hooks** in `frontend/src/hooks/` (only a generic `useScrollHeader`). Screens compose data via the contexts + direct `farmApi` calls.

---

## 4. Frontend → backend API contract

**Client:** [frontend/src/services/farmApi.js](frontend/src/services/farmApi.js) (thin wrappers over the shared axios instance).
**Base URL:** resolved in [frontend/src/constants/config.js](frontend/src/constants/config.js) — `EXPO_PUBLIC_API_BASE_URL` → dev `http://<host>:3001/api/v1` → prod Railway URL.
**Auth:** [frontend/src/services/api.js](frontend/src/services/api.js) request interceptor adds `Authorization: Bearer <token>`; a response interceptor auto-refreshes on 401 (`POST /auth/refresh`) with a shared single-flight queue, then retries.

### Endpoint reference

Mounts (from [backend/src/app.js:230-239](backend/src/app.js#L230-L239)): `/api/v1/irrigation` → irrigation routes; `/api/v1/farms` → farm routes; `/api/v1` → crop-cycle routes (so `/farms/:id/cycles` and `/cycles/:id`). All `/farms/*` and `/cycles/*` paths require the `authenticate` middleware and are scoped to `req.user.id`.

| `farmApi` fn | Method & path | Backend |
| --- | --- | --- |
| `listFarms()` | `GET /farms` | [farm.routes.js](backend/src/routes/farm.routes.js) → `farm.service.listFarms` |
| `createFarm(d)` | `POST /farms` | `farm.service.createFarm` |
| `getFarm(id)` | `GET /farms/:farmId` | returns farm + active cycles + soil reports + weather |
| `updateFarm(id,f)` | `PATCH /farms/:farmId` | partial update |
| `deleteFarm(id)` | `DELETE /farms/:farmId` | **soft delete** (`isActive=false`) |
| `setActiveFarm(id)` | `POST /farms/active` `{farmId}` | sets `User.activeFarmId` |
| `getFarmInsights(id,{limit,type})` | `GET /farms/:farmId/insights` | reads `FarmerPrediction` (⚠ always empty) |
| `getFarmFinancialSummary(id,{season,year})` | `GET /farms/:farmId/financial-summary` | aggregates cycles |
| `listCropCycles(id,{season,year,status})` | `GET /farms/:farmId/cycles` | [farmCropCycle.routes.js](backend/src/routes/farmCropCycle.routes.js) |
| `createCropCycle(id,d)` | `POST /farms/:farmId/cycles` | validates `area ≤ farm.landSizeAcres` |
| `getCropCycle(id)` | `GET /cycles/:cycleId` | cycle + farm + last 5 predictions |
| `deleteCropCycle(id)` | `DELETE /cycles/:cycleId` | |
| `addFertilizer(id,e)` | `POST /cycles/:cycleId/fertilizer` | appends to `fertilizersUsed[]` |
| `addPesticide(id,e)` | `POST /cycles/:cycleId/pesticide` | appends to `pesticidesUsed[]` |
| `addIrrigationLog(id,e)` | `POST /cycles/:cycleId/irrigation` | appends to `irrigationLogs[]` |
| `recordHarvest(id,d)` | `POST /cycles/:cycleId/harvest` | sets harvest fields + stage `HARVESTED` |
| `recordSale(id,d)` | `POST /cycles/:cycleId/sale` | sets sale fields + revenue |
| `completeCycle(id)` | `POST /cycles/:cycleId/complete` | `status=COMPLETED` + recompute financials |
| `getCycleFinancials(id)` | `GET /cycles/:cycleId/financials` | cost breakdown for charts |
| (not in farmApi) | `GET /cycles/:cycleId/stage`, `POST /cycles/:cycleId/event` | stage update / observed event |

**Irrigation advisory (separate router, [backend/src/routes/irrigation.routes.js](backend/src/routes/irrigation.routes.js)):**

| Method & path | Purpose |
| --- | --- |
| `GET /irrigation/today?crop&lat&lon&sowingDate&fieldName` | ET₀-based "should I irrigate today?" recommendation; persists an `IrrigationLog`. |
| `GET /irrigation/weekly?crop&lat&lon&sowingDate` | 7-day forecast strip. |
| `POST /irrigation/log {logId, farmerAction}` | farmer marks `irrigated` / `skipped`. |
| `GET /irrigation/history?crop&days` | recent logs (≤60). |

> ⚠ Note the **two different "irrigation log" concepts**: (a) the per-cycle JSON entries under `FarmCropCycle.irrigationLogs` written by `addIrrigationLog` / the `IrrigationLogScreen`; and (b) the standalone `irrigation_logs` table written by the ET₀ advisory endpoints. They are unrelated stores. The `IrrigationLogScreen` in the My Farm tab writes to (a) and **requires a `cycleId`**.

Standard response envelope: `sendSuccess`/`sendCreated`/`sendError`/`sendNotFound` from `utils/response.js`.

---

## 5. Backend data model (Prisma)

**Store:** PostgreSQL via Prisma — [backend/prisma/schema.prisma](backend/prisma/schema.prisma). Services import `prisma` from `../config/db.js`. Relevant models and their line anchors:

- `model Farm` — [schema.prisma:1542](backend/prisma/schema.prisma#L1542)
- `model FarmCropCycle` — [schema.prisma:1335](backend/prisma/schema.prisma#L1335)
- `model IrrigationLog` — [schema.prisma:1221](backend/prisma/schema.prisma#L1221)
- `model FarmerPrediction` — [schema.prisma:1512](backend/prisma/schema.prisma#L1512)
- `model FarmSoilReport` — [schema.prisma:1418](backend/prisma/schema.prisma#L1418)
- `model FarmWeatherHistory` — [schema.prisma:1482](backend/prisma/schema.prisma#L1482)
- `model CropMaster` — [schema.prisma:991](backend/prisma/schema.prisma#L991)

### Relationships

```
User (farmerId, activeFarmId?)
  └─< Farm  (isActive soft-delete; farmNumber auto-incremented per farmer)
        ├─< FarmCropCycle  (season/year, growthStage, status)
        │       ├─ fertilizersUsed[]   (JSON)
        │       ├─ pesticidesUsed[]    (JSON)
        │       ├─ irrigationLogs[]    (JSON)   ← per-cycle, not the irrigation_logs table
        │       ├─ observedEvents[]    (JSON)
        │       ├─ harvest* / sale* / financial* (scalar columns)
        │       └─< FarmerPrediction (cropCycleId?)
        ├─< FarmSoilReport   (latest pinned via Farm.latestSoilReportId)
        ├─ FarmWeatherHistory (1:1)
        └─< FarmerPrediction  (farmId)

User └─< IrrigationLog   (standalone ET₀ advisory log; links to CropMaster by crop name)
```

### Farm — key fields

Identity/location (`farmName`, `farmNameMr/Hi`, `farmNumber`, `village/taluka/district/state/pincode`, `latitude/longitude`); land (`landSizeAcres` **required**, derived `landSizeHectares`=×0.4047 and `landSizeGunta`=×40, `landOwnership` enum); soil (`soilType` enum: BLACK_COTTON/RED/ALLUVIAL/SANDY/LATERITE/CLAY_LOAM/SANDY_LOAM/UNKNOWN, `latestSoilReportId`); water (`irrigationSystem` enum: DRIP/SPRINKLER/FLOOD/FURROW/RAINFED/MIXED, `waterSources[]`, `borewellDepthFt`); infrastructure booleans (greenhouse, cold storage, farm pond, solar pump…); sync (`lastWeatherSyncAt`, `lastPredictionAt`); `isActive` (soft delete).

### FarmCropCycle — key fields

Crop identity (`cropName` + `cropNameMr/Hi`, `cropCategory` enum, `variety`, `isHybrid`, `isOrganic`); allocation (`areaAllocatedAcres`, validated ≤ farm size); timeline (`sowingDate`, `expectedHarvestDate`, `actualHarvestDate`); growth (`growthStage` enum: PLANNING → LAND_PREP → SOWING → VEGETATIVE → FLOWERING → FRUITING → MATURITY → HARVESTED); seed cost block; the four **JSON activity arrays**; harvest block (`harvestYieldKg`, derived quintal & per-acre, grade, moisture); sale block (`saleSoldQuantityKg`, `salePricePerKgInr`, derived `saleTotalRevenueInr`, buyer info); financials (`totalInputCostInr`, labor/machinery/other, `grossIncomeInr`, `netProfitInr`, `profitPerAcreInr`); `status` enum (ACTIVE/COMPLETED/ABANDONED).

### IrrigationLog (standalone ET₀ store) — key fields

`crop`, `fieldName`, `date`; recommendation (`shouldIrrigate`, `reason`/`reasonHi`, `waterAmount`, `bestTime`); weather snapshot (`temp`, `humidity`, `rainfall`, `rainForecast`, `windSpeed`); ET data (`cropStage`, `et0Value`, `etcValue`, `kcValue`); `farmerAction` (irrigated/skipped/pending).

### FarmerPrediction (AI insights store) — key fields

`predictionType` enum (SEED_QUANTITY / CROP_SUGGESTION / INCOME_FORECAST / YIELD_FORECAST / PEST_RISK / FERTILIZER_PLAN / IRRIGATION_PLAN), `inputSnapshot` (JSON), `output` (JSON), `explanationEn/Mr/Hi`, `actionItems[]`, `confidence`, `validUntil`, `isStale`. **No code path writes this table** (see [§7](#7-ai-insights--fastapi-involvement)).

### CropMaster (agronomy reference) — key fields

Per-crop constants used by the irrigation model: `maturityDays`, `seasons`, `kcInitial/kcMid/kcLate` (crop coefficients), plus pest/disease/fertilizer reference data and price-linking codes.

---

## 6. Backend business logic

Services: [farm.service.js](backend/src/services/farm.service.js), [cropCycle.service.js](backend/src/services/cropCycle.service.js), [irrigation.service.js](backend/src/services/irrigation.service.js).

### Farm lifecycle (`farm.service.js`)
- **Create:** `farmNumber = max(existing)+1` per farmer; auto-derive hectares/guntas; if farmer has no active farm, set this one active; sync `User.totalFarms` / `User.totalLandAcres`. Uses `prisma.$transaction` for the multi-step write.
- **Delete:** soft (`isActive=false`); if the deleted farm was active, promote the next available farm to active.
- **Ownership:** every query is scoped `{ id, farmerId: req.user.id }`.

### Crop-cycle activity logging (`cropCycle.service.js`)
Each `add*`/`record*` endpoint loads the cycle, **appends a new object to the relevant JSON array** (or sets harvest/sale scalar fields), and writes the row back. Harvest sets `growthStage=HARVESTED`; sale computes `saleTotalRevenueInr = qty × pricePerKg`.

### Financials
- **Per cycle** (`computeFinancials`): `totalInputCostInr = seedCost + Σ fertilizer.costInr + Σ pesticide.costInr + labor + machinery + other`; `netProfitInr = grossIncomeInr − totalInputCostInr`; `profitPerAcreInr = net / area`. Recomputed on `completeCycle`.
- **Cost breakdown** (`getCycleFinancials`): array of `{label, value, color}` (Seed/Fertilizer/Pesticide/Labour/Machinery/Other, >0 only) for pie charts.
- **Per farm** (`getFarmFinancialSummary`): aggregates cycles filtered by `season`/`year` → `{ totals: {grossIncomeInr, totalCostInr, netProfitInr, profitPerAcreInr, totalAreaAcres, cycleCount}, byCycle: [...] }`.

### Irrigation advisory — Hargreaves ET₀ (`irrigation.service.js`)
1. Look up `CropMaster` by crop name (case-insensitive); compute days-since-sowing.
2. Fetch 7-day weather from **Open-Meteo** (`api.open-meteo.com/v1/forecast`, `Asia/Kolkata`).
3. **ET₀ (Hargreaves):** `ET0 = 0.0023 × (Tmean + 17.8) × √(Tmax − Tmin) × Ra`, where `Ra` = extraterrestrial radiation from latitude + day-of-year.
4. **Kc** by growth phase (initial/development/mid/late, interpolated) → **ETc = ET0 × Kc**.
5. Effective rain = rainfall × 0.8; **net need = ETc − effective rain**.
6. **Decision:** skip if today's rain >10 mm, or 3-day rain >15 mm with low need, or net need <3 mm, or crop past ~85% maturity; otherwise **irrigate**.
7. Persist an `IrrigationLog`; return the recommendation + 7-day strip. Gated behind a feature flag (`isEnabled('irrigation')`, else HTTP 503).

---

## 7. AI insights & FastAPI involvement

There are **three distinct "AI" surfaces** touching My Farm, and only understanding all three avoids confusion:

1. **`MyFarmHome` / "AI Insights" panel** → `farmApi.getFarmInsights` → `GET /farms/:id/insights` → `farm.service.getFarmInsights` → reads the **`FarmerPrediction`** table. ⚠ **Nothing in the repo ever inserts into `FarmerPrediction`**, so this returns `[]` in practice. The DB schema + read path are scaffolding awaiting a generator. ([AIInsightsPanel.js](frontend/src/screens/FarmProfile/components/AIInsightsPanel.js) is purely presentational.)

2. **`FarmDetail` insights** → **client-side heuristics**, not the network. `computeInsights(farm, soil, cycles)` in [FarmDetailScreen.js](frontend/src/screens/FarmProfile/FarmDetailScreen.js) generates tips from rules (low N → suggest Urea/FYM, acidic pH, rainfed warning, missing soil report, no crops). These are local placeholders.

3. **Smart alerts** → **FastAPI, live, but not shown in My Farm.** `POST /api/v1/ai/alerts` ([backend/src/routes/ai.routes.js](backend/src/routes/ai.routes.js)) builds a farm-context object and calls `callFastAPI('/ai/alerts', …)` → `fastapi/routes/alerts.py` → `generate_smart_alerts` (Groq→Gemini) returning 4-6 alerts (weather/disease/market/irrigation/fertilizer/harvest). This is wired and cached server-side, but **no FarmProfile screen currently renders these alerts** — it's consumed elsewhere (AI tab).

**Bottom line:** My Farm depends on FastAPI only *indirectly and not yet in the UI*. The "real" intended AI integration (populate `FarmerPrediction` from model output, surface via `getFarmInsights`) is **unimplemented**. Disease scanning (`/ai/scan`) is a separate flow, not part of this tab.

For the full AI-chat/agentic pipeline see the sibling doc [docs/AI_CHAT_ARCHITECTURE.md](docs/AI_CHAT_ARCHITECTURE.md).

---

## 8. Design system — the "cosmic" UI

The module ships a **self-contained design system** (it does *not* use the app-wide `constants/colors.js` for its core widgets — though the four higher-level glance cards in `components/` do). Despite the name "cosmic", the current tokens are a **light, minimal** theme aligned with the main app.

**Tokens — [theme/cosmicTheme.js](frontend/src/screens/FarmProfile/theme/cosmicTheme.js):**
- `COSMIC` colors: canvas (`BG #F4F8F1`, `SURFACE #FFF`, `SURFACE_HI/LO`), borders, brand (`PRIMARY #176B43` forest green, `ACCENT #E65100` orange, each with `_SOFT` tints), 12 activity-type colors, status (DANGER/WARN/INFO/SUCCESS + `_SOFT`), severity scale, text ramp (`TEXT`→`TEXT_2`→`TEXT_3`→`MUTED`→`INVERSE`), overlay/scrim.
- `GRADIENT` (primary, accent, danger, soil, water, glass…), `GLOW` (soft-black shadow presets), `CR` (corner radii xs→pill), `CS` (8-pt spacing), `CT` (Inter typography ramp labelXS→hero + ready-made `CT.styles`), `TAP` (48dp min targets), `MOTION` (spring/timing).
- `ACTIVITY_TYPES` / `ACTIVITY_TYPE_MAP` / `activityMeta(key)`: the 12 activity types (LAND_PREP, SOWING, IRRIGATION, FERTILIZER, SPRAY, SCOUT, WEEDING, PRUNING, HARVEST, SALE, EXPENSE, INCOME), each `{key, color, icon, i18n}`. ⚠ Their `i18n` keys point at `myFarm.v2.activity.*` which **don't exist** in translations (see [§11](#11-known-gaps-inconsistencies--todos)).

**UI primitives — [ui/](frontend/src/screens/FarmProfile/ui/):**
`CosmicScreen` (page wrapper: background, safe-area, optional scroll + pull-to-refresh) · `CosmicHeader` (+`.IconButton`) · `CosmicBackground` · `GlassCard` (4 variants + glow) · `GlowButton` (5 variants, 3 sizes, gradient+glow) · `CosmicPicker` (searchable bottom-sheet) · `ActivityChip` (+`.Tile` for the picker grid) · `ActivityFeedItem` (row with photo/voice/offline affordances) · `StageTimelineBar` (8-stage phenology) · `StreakBadge` (gamified daily-logging streak) · `CelebrationSheet` (post-log celebration) · `SyncBadge` (synced/syncing/offline/error) · `WhyThisButton` (explainability chip).

**Higher-level cards — [components/](frontend/src/screens/FarmProfile/components/):** `AIInsightsPanel`, `FinancialSummaryCard` (season tabs), `SoilGlanceCard` (pH/N/P/K with rating colors), `WeatherGlanceCard` (current + 3-day). These use the app-wide `COLORS`/`TYPE`/`RADIUS`/`SHADOWS`, not `cosmicTheme` — a stylistic split worth knowing.

**Engagement patterns:**
- **Gamification:** `StreakBadge` shows day-streak tiers ("Building a habit", "Sincere farmer 🔥", "Master farmer 🏆") and a non-shaming "rest day 🌿" state; `CelebrationSheet` fires after a successful log with haptics + auto-dismiss. Streaks are computed client-side from logged-activity dates (`computeStreak` in `MyFarmHomeScreen`).
- **Explainability:** `WhyThisButton` ("Why this?") attaches to advisory cards to navigate to a reasoning view — a trust pattern for AI suggestions.

---

## 9. Offline & sync reality

Despite the `SyncBadge` and `offline` affordances, **there is no offline write queue today.** Concretely:
- **Reads** are cached: `MultiFarmContext` renders the AsyncStorage-cached farm list (`fe_farms_v1`) instantly, then revalidates from `/farms`.
- **Writes** (create/edit/delete farm, all activity logs) go straight to the API and **fail immediately when offline** — surfaced via `Alert`, no retry/queue.
- `SyncBadge` is **cosmetic**: it reflects the in-flight `/farms` refresh (`syncing`) and a synced/offline label, but is not backed by a real sync engine. `ActivityFeedItem`'s `offline` prop is a UI hint only.
- Tokens are stored via `expo-secure-store` on native; web keeps tokens in memory (refresh token in an httpOnly cookie).

If true offline-first is a goal, it is **greenfield** — the schema (idempotency, server timestamps) and a client mutation queue would both be new work.

---

## 10. Internationalization

`t()` from `LanguageContext`; strings in [frontend/src/i18n/translations.js](frontend/src/i18n/translations.js). 10 languages (en, hi, mr, ta, kn, ml, te, bn, gu, pa).

The **`myFarm` namespace** ([translations.js:1094](frontend/src/i18n/translations.js#L1094)) covers the dashboard scaffold: `tabLabel`, `dashboardTitle`, empty states, quick actions (`qaAddFarm`/`qaLogIrrigation`/`qaRecordHarvest`/`qaScanCrop`), plus nested `weather`, `soil`, `activeCrops`, `insights`, `financials` (with `season.*`), and `errors`.

⚠ **Gap:** `cosmicTheme.ACTIVITY_TYPES` references `myFarm.v2.activity.*` keys, but `translations.js` contains **zero** `v2` entries — so activity labels fall back to whatever `t()` returns for a missing key. Either add the `myFarm.v2.activity.*` block or change the `i18n` references in `cosmicTheme.js`. Many in-screen strings in the FarmProfile module are also still hard-coded English (e.g. heuristic insight text, several section labels), so the tab is **not fully localized** yet.

---

## 11. Known gaps, inconsistencies & TODOs

| # | Issue | Evidence | Suggested direction |
| --- | --- | --- | --- |
| 1 | **AI insights never populated.** `FarmerPrediction` is read but never written. | [farm.service.js](backend/src/services/farm.service.js) `getFarmInsights`; no `prisma.farmerPrediction.create` anywhere. | Add a generator (Node job or FastAPI prediction endpoint) that writes `FarmerPrediction` rows. |
| 2 | **Missing i18n keys** `myFarm.v2.activity.*`. | [cosmicTheme.js:169-186](frontend/src/screens/FarmProfile/theme/cosmicTheme.js#L169-L186) vs. 0 `v2` keys in translations. | Add the block or repoint to existing keys. |
| 3 | **Two farm contexts** (`MultiFarmContext` vs `FarmContext`) with overlapping concepts. | [context/](frontend/src/context/) | Consolidate; document which is source of truth (FarmProfile screens use `MultiFarmContext`). |
| 4 | **No offline write queue** despite sync/offline UI. | [§9](#9-offline--sync-reality) | Build a mutation queue + idempotency if offline-first matters. |
| 5 | **Two unrelated "irrigation log" stores** (per-cycle JSON vs `irrigation_logs` table). | [§4](#4-frontend--backend-api-contract) note. | Keep the naming distinction explicit; consider unifying. |
| 6 | **FarmDetail insights are client-side heuristics**, not the same source as MyFarmHome. | `computeInsights` in [FarmDetailScreen.js](frontend/src/screens/FarmProfile/FarmDetailScreen.js). | Once #1 lands, switch both to `getFarmInsights`. |
| 7 | **Partial localization** — hard-coded English strings in several FarmProfile screens. | grep for literal strings in the module. | Extract to `myFarm.*`. |
| 8 | **FastAPI `/ai/alerts` not surfaced** in My Farm even though it's farm-context-aware. | [ai.routes.js](backend/src/routes/ai.routes.js) `/alerts`. | Consider rendering alerts on `MyFarmHome`. |

---

## 12. File map

**Frontend — screens** (`frontend/src/screens/FarmProfile/`)
- `MyFarmHomeScreen.js` · `FarmListScreen.js` · `FarmDetailScreen.js` · `FarmAddEditScreen.js`
- `CropCycleCreateScreen.js` · `CropCycleDetailScreen.js` · `ActivityTypePickerScreen.js`
- `logging/IrrigationLogScreen.js`

**Frontend — UI / theme / components**
- `ui/{CosmicScreen,CosmicHeader,CosmicPicker,GlassCard,GlowButton,ActivityChip,ActivityFeedItem,StageTimelineBar,StreakBadge,CelebrationSheet,SyncBadge,WhyThisButton}.js`
- `theme/{cosmicTheme,CosmicBackground}.js`
- `components/{AIInsightsPanel,FinancialSummaryCard,SoilGlanceCard,WeatherGlanceCard}.js`

**Frontend — plumbing**
- `frontend/src/navigation/AppNavigator.js` (MyFarmNavigator: L398-413; also AI/Profile stacks)
- `frontend/src/services/farmApi.js` · `frontend/src/services/api.js` · `frontend/src/constants/config.js`
- `frontend/src/context/{MultiFarmContext,FarmContext,LanguageContext}.js`
- `frontend/src/i18n/translations.js` (`myFarm`: L1094)

**Backend**
- `backend/src/routes/{farm.routes,farmCropCycle.routes,irrigation.routes}.js`
- `backend/src/services/{farm.service,cropCycle.service,irrigation.service}.js`
- `backend/src/app.js` (mounts: L230, L238-239)
- `backend/prisma/schema.prisma` (Farm L1542 · FarmCropCycle L1335 · IrrigationLog L1221 · FarmerPrediction L1512 · FarmSoilReport L1418 · FarmWeatherHistory L1482 · CropMaster L991)

**FastAPI (adjacent, not yet wired into My Farm UI)**
- `fastapi/routes/alerts.py` · `fastapi/services/alert_service.py` (via Node `POST /api/v1/ai/alerts`)

---

*Generated from a full read of the FarmProfile module, the farm/crop-cycle/irrigation backend, the Prisma schema, and the i18n layer. Line anchors reflect the repo at the time of writing; re-verify before relying on a specific line.*

---

## 13. v2 upgrade (shipped)

A production-grade upgrade was implemented on top of the v1 baseline above. Summary of what changed, by pillar:

### A. Cosmic UI + hand-crafted SVG charts
- New chart library `frontend/src/components/charts/` (no new deps — uses `react-native-svg`): `DonutChart`, `RadialGauge`, `Sparkline`, `MiniBars`, `GrowthRing` + `_svgMath.js` (geometry + `useReveal`/`useDraw` animations).
- Wired in: `CropCycleDetailScreen` (cost-split donut in P&L + animated `GrowthRing`), `components/SoilGlanceCard` & `FarmDetailScreen` soil (RadialGauges by N/P/K/pH rating), `components/FinancialSummaryCard` (donut + per-cycle MiniBars).
- Added the missing `myFarm.v2.activity.*` i18n keys (en/hi/mr); picker labels now use `t(a.i18n, fallback)`.

### B. AI-context enrichment (chat + diagnosis)
- `backend/src/utils/farmHistory.server.js` (server mirror of the frontend summarizers + `summarizeCostSplit`, `buildPriorIssues`, `buildHistory`).
- `chatContext.service.js` now sends itemised per-cycle inputs/costs, 4 recent completed cycles, and a `history` aggregate (yield/profit/inputCost trends + priorIssues). `ai.routes.js buildEnrichedProfile` forwards them; FastAPI `chat_service._compute_profile` renders per-crop fertilizer/spray/irrigation/cost-split + "Multi-year trend" + "Recurring issues" into the FARMER PROFILE block (flows to writer/enhancer/**vision** diagnosis).

### C. Complete activity logging + itemised P&L
- **Migration:** `FarmCropCycle` += `activities`, `laborLogs`, `expenseLogs`, `incomeLogs` (`Json @default("[]")`).
- `cropCycle.service`: `addActivity` / `addLaborLog` / `addExpenseLog` / `addIncomeLog`; `computeFinancials` sums log arrays (falls back to scalar columns); `getCycleFinancials` adds `perAcre` + `roiPct`. New routes `POST /cycles/:id/{activity,labor,expense,income}`; `farmApi` wrappers + `addObservedEvent`/`advanceStage`.
- 7 new logger screens in `screens/FarmProfile/logging/` (LandPrep, Sowing, Scout, Weeding, Pruning, Expense, Income) built on a shared `_loggerKit.js`; `ActivityTypePickerScreen` routes the 7 types to them; registered in MyFarm/AI/Profile navigators. CropCycleDetail P&L now shows per-acre + ROI and the feed ingests the new logs.

### D. Resilient writes + India features
- `frontend/src/services/writeQueue.js` (retry + backoff + subscribable sync status + `useSyncStatus`); `MultiFarmContext` create/edit/delete are optimistic with rollback; `MyFarmHomeScreen` SyncBadge shows real status. `api.js` attaches a stable `Idempotency-Key` to farm/cycle mutations (survives the 401-replay); backend applies `idempotency('farm_write'|'cycle_write')` to all mutating farm/cycle routes.
- **Mandi:** `services/mandiApi.js` + `components/MandiGlanceCard.js` (live Agmarknet price + 30-day `Sparkline` + nearby markets + sale-vs-mandi comparison) on CropCycleDetail.
- **Voice readout:** `expo-speech` + `utils/speak.js` + `ui/SpeakerButton.js` (offline multilingual TTS) on P&L + mandi card.

### E. Real AI insights
- `backend/src/services/farmPrediction.service.js` — pure `buildCyclePredictions` (YIELD/INCOME/PEST_RISK from prior-cycle history, multilingual explanations + actionItems) + `generateForCycle` (writes `FarmerPrediction`, marks old stale, throttled via `Farm.lastPredictionAt`). Triggered fire-and-forget from `recordSale` / `completeCycle` / high-severity `addObservedEvent`. `getFarmInsights` (already read by `AIInsightsPanel`/MyFarmHome) now returns real rows.

### Tests
`backend/src/__tests__/`: `farmHistory.server.test.js`, `cropCycleFinancials.test.js`, `farmPrediction.test.js` (11 unit tests, all green via `node --test`).

### Deferred (not in this upgrade)
- Full offline-first (local SQLite/WatermelonDB + durable mutation queue) — only optimistic UI + retry + idempotency shipped.
- Scheme-nudge card (`/schemes/eligible`) and multi-plot UI (`Farm.plots` / `FarmCropCycle.plotId`) — backend exists; surfacing deferred.
- Photo/voice **upload** for loggers (capture fields exist; Cloudinary pipeline reuse later); cron-driven prediction generation.

### Migrations to apply
`cd backend && npx prisma migrate dev` (adds the 4 JSON columns on `farm_crop_cycles`). `npx prisma generate` already run. `expo-speech` installed in `frontend`.
