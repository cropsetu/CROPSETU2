# My Farm v2 — Production-Grade Upgrade (Changelog / Work Log)

Branch: `feat/myfarm-v2-production-grade`
Full design + topology: [MY_FARM_ARCHITECTURE.md](MY_FARM_ARCHITECTURE.md) (see **§13 v2 upgrade**).

Upgrades the **My Farm** tab from a basic record-keeper into an India-first crop-management system: graphically rich, history-aware AI, complete activity logging, resilient writes, live mandi prices, and voice. Delivered in 5 phases.

---

## Phase 1 — Cosmic UI + hand-crafted SVG charts (no new deps)
- **New:** `frontend/src/components/charts/` — `DonutChart`, `RadialGauge`, `Sparkline`, `MiniBars`, `GrowthRing`, `_svgMath` (geometry + reveal/draw animations), `index.js`.
- **Wired in:** `CropCycleDetailScreen` (cost-split donut + animated growth ring + per-acre/ROI strip), `SoilGlanceCard` & `FarmDetailScreen` (NPK/pH radial gauges by rating), `FinancialSummaryCard` (donut + per-cycle bars).
- Added `myFarm.v2.activity.*` i18n keys (en/hi/mr); activity picker labels now localized.

## Phase 2 — AI-context enrichment (chat + crop-disease diagnosis)
- **New:** `backend/src/utils/farmHistory.server.js` (summarizers + `summarizeCostSplit`, `buildPriorIssues`, `buildHistory`).
- `chatContext.service.js` now sends itemised inputs/costs, 4 recent cycles, and a multi-year `history` aggregate; `ai.routes.js buildEnrichedProfile` forwards it; FastAPI `chat_service._compute_profile` renders per-crop inputs/cost-split + "Multi-year trend" + "Recurring issues" into the FARMER PROFILE block — reaching **chat and photo-diagnosis**.
- `frontend/src/utils/farmHistory.js` += `summarizeCostSplit`, `buildPriorIssues`.

## Phase 3 — Complete activity logging + itemised P&L
- **Migration:** `FarmCropCycle` += `activities`, `laborLogs`, `expenseLogs`, `incomeLogs` (`Json @default("[]")`) — `backend/prisma/migrations/20260606201013_test/`.
- `cropCycle.service.js`: `addActivity`/`addLaborLog`/`addExpenseLog`/`addIncomeLog`; `computeFinancials` sums log arrays with scalar-column fallback; `getCycleFinancials` += `perAcre` + `roiPct`. New routes `POST /cycles/:id/{activity,labor,expense,income}`; `farmApi` wrappers + `addObservedEvent`/`advanceStage`.
- **New:** 7 logger screens in `screens/FarmProfile/logging/` (LandPrep, Sowing, Scout, Weeding, Pruning, Expense, Income) on a shared `_loggerKit.js`. `ActivityTypePickerScreen` routes them; registered in MyFarm/AI/Profile navigators. Unified activity feed ingests the new logs.

## Phase 4 — Resilient writes + India features
- **New:** `frontend/src/services/writeQueue.js` (retry + backoff + subscribable sync status + `useSyncStatus`). `MultiFarmContext` create/edit/delete are optimistic with rollback; `MyFarmHomeScreen` SyncBadge shows real state. `api.js` attaches a stable `Idempotency-Key` to farm/cycle mutations; backend applies `idempotency('farm_write'|'cycle_write')` to all mutating routes (reuses `middleware/idempotency.js`).
- **New:** `services/mandiApi.js` + `components/MandiGlanceCard.js` — live Agmarknet price + 30-day sparkline + nearby markets + sale-vs-mandi comparison on CropCycleDetail.
- **New:** voice readout — `expo-speech` + `utils/speak.js` (guarded via `requireOptionalNativeModule`, degrades silently until a native rebuild) + `ui/SpeakerButton.js`.

## Phase 5 — Real AI insights
- **New:** `backend/src/services/farmPrediction.service.js` — `buildCyclePredictions` (YIELD/INCOME/PEST_RISK, multilingual + actionItems) + `generateForCycle` (writes `FarmerPrediction`, retires stale rows, throttled via `Farm.lastPredictionAt`). Triggered fire-and-forget on `recordSale`/`completeCycle`/high-severity scout. `getFarmInsights` now returns real rows (previously always empty).

---

## Tests (all green — `node --test`)
- `backend/src/__tests__/farmHistory.server.test.js`
- `backend/src/__tests__/cropCycleFinancials.test.js`
- `backend/src/__tests__/farmPrediction.test.js`
> 11 unit tests covering summarizers/trends, P&L array-vs-scalar fallback + income, and the prediction rule engine.

## Run / verify locally
```bash
# backend
cd backend && npx prisma migrate dev   # applies the 4 JSON columns
node --test src/__tests__/farmHistory.server.test.js src/__tests__/cropCycleFinancials.test.js src/__tests__/farmPrediction.test.js

# frontend
cd frontend && npx expo start -c        # -c clears Metro cache
#   Voice readout needs the native module → rebuild the dev client to enable:
#   npx expo run:android
```
Then in-app: **My Farm → a farm → a crop cycle** → donut P&L, growth ring, per-acre/ROI, mandi card, 7 activity loggers.

## Deferred (next milestones)
- Full offline-first (local SQLite/WatermelonDB + durable mutation queue) — this round ships optimistic UI + retry + idempotency only.
- Scheme-nudge card (`/schemes/eligible`) and multi-plot UI (`Farm.plots`/`FarmCropCycle.plotId`) — backend exists, surfacing deferred.
- Photo/voice **upload** for loggers; cron-driven prediction generation.

> Note: this branch also carries in-flight Soil Hub redesign + AI-screen work present in the working tree at branch time (`SoilHubScreen`, `SoilForm/Scan/Report/Guide`, `soil_ocr`, AI screen tweaks). Those are separate from the My Farm v2 feature above.
