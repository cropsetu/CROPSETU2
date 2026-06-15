# Dead-Code Audit

Conservative, grep-based audit of unreferenced files, exports, routes, and dependencies across the `frontend/`, `backend/`, `admin/`, and `fastapi/` subsystems. False-positives were filtered out (2 candidates checked and rejected — see caveats).

---

## 1. Summary

### By status

| Status | Meaning | Count (unique items) |
| --- | --- | --- |
| **DEAD** | Unreferenced / unreachable; no live importer or caller | 45 |
| **REDUNDANT** | Live duplicate exists elsewhere (usually a backend/frontend twin) | 9 |
| **SEMI_DEAD** | Wired but unreached — registered route or kept `export` keyword with no external consumer | 14 |
| Rejected (actually used) | False-positives confirmed in-use | 2 |

### By subsystem

| Subsystem | DEAD | REDUNDANT | SEMI_DEAD | Total |
| --- | --- | --- | --- | --- |
| `frontend/` (screens, components, services, utils, constants, config) | 33 | 8 | 6 | 47 |
| `backend/` (misplaced frontend-copy cluster + unused deps) | 11 | 4 | 0 | 15 |
| `fastapi/` (uncalled functions, stub route) | 5 | 0 | 0 | 5 |
| `admin/` (unreached `export` keywords on internal types) | 0 | 0 | 8 | 8 |

> Note: 2 candidates were checked and **rejected as actually-used** — `frontend/src/services/api.js → getRefreshToken` (real internal call in the native token-refresh flow) and `frontend/package.json → react-native-compressor` (an Expo config plugin in `app.json`, injected at prebuild, intentionally never imported in JS). See §5.

---

## 2. Safe to remove (high confidence)

DEAD / REDUNDANT items with **high** confidence, grouped by subsystem. Each: **path** · symbol · why · action.

### 2.1 Frontend — unwired / superseded screens (whole-file deletes)

| Path | Symbol | Why | Action |
| --- | --- | --- | --- |
| `frontend/src/screens/Auth/PhoneLogin/` | whole subtree (LoginFlow, PhoneEntryScreen, OtpVerificationScreen, index.js, strings, theme, components/*, README) | Active auth is `Auth/LoginScreen` rendered directly in `App.js:51`. No live importer of the barrel — only self-references plus the (also-dead) Landing & ProfileSetup trees. `LandingScreen` even imports a non-existent `components/AuthTopControls`. | **Delete the whole directory** — superseded by `Auth/LoginScreen.js` |
| `frontend/src/screens/Auth/Landing/LandingScreen.js` | whole file | Referenced only by the dead PhoneLogin flow (`LoginFlow.js`, `index.js`). Unreachable from any navigator / `App.js`. | Delete (part of the dead PhoneLogin flow) |
| `frontend/src/screens/Onboarding/ProfileSetup/` | whole subtree (index barrel, ProfileSetupFlow, steps/*, components/*, options, strings, theme) | `OnboardingNavigator` wires only `OnboardingLanguageScreen` + `OnboardingProfileScreen`. Zero external importers — only intra-directory barrel re-exports. Members import the also-dead PhoneLogin theme. | **Delete the whole directory** — superseded by `OnboardingProfileScreen.js` |
| `frontend/src/screens/Onboarding/OnboardingNameScreen.js` | whole file | Not registered in `OnboardingNavigator`; 0 external grep hits. | Delete — superseded by `OnboardingProfileScreen` |
| `frontend/src/screens/Onboarding/OnboardingLocationScreen.js` | whole file | Not registered; 0 grep hits. | Delete — superseded by `OnboardingProfileScreen` |
| `frontend/src/screens/Onboarding/OnboardingFarmScreen.js` | whole file | Only hit is a stale comment in `utils/webScrollFix.js:33`. Not registered. | Delete (and drop the stale comment in `webScrollFix.js`) |
| `frontend/src/screens/Onboarding/OnboardingCropsScreen.js` | whole file | Not registered; 0 grep hits. | Delete — superseded by `OnboardingProfileScreen` |
| `frontend/src/screens/AgriStore/AIRecommendation.js` | whole file | `AgriStoreNavigator` registers only Home/ProductDetail/Cart/Checkout/OrderConfirmed. No import, route string, or navigate target. | Delete |
| `frontend/src/screens/AI/SoilHealthScreen.js` | whole file (REDUNDANT) | Route `'SoilHealth'` is mapped to `SoilHubScreen` (the redesign alias). Legacy file never imported. | Delete — superseded by `SoilHubScreen` |
| `frontend/src/screens/AI/LoanCalculatorScreen.js` | whole file | No import, no `LoanCalculator` route registration, no navigate target. | Delete |
| `frontend/src/screens/AI/MandiBhavScreen.js` | whole file (REDUNDANT) | Superseded by `MarketScreen` (route `'Market'`). No import/route/navigate. | Delete |
| `frontend/src/screens/AI/AIWeatherHub.js` | whole file | Route `'Weather'` → `WeatherHome`; `AIAssistantHome` navigates to `'Weather'`. `AIWeatherHub` is never imported/registered (only a stale comment in `WeatherHome.js:479`). | Delete |

### 2.2 Frontend — unused component files

| Path | Symbol | Why | Action |
| --- | --- | --- | --- |
| `frontend/src/screens/FarmProfile/components/SoilGlanceCard.js` | whole file | 0 grep hits. Control: sibling `MandiGlanceCard` *is* found by the same grep, proving the pattern is selectively wired and this one is not. | Delete |
| `frontend/src/screens/FarmProfile/components/WeatherGlanceCard.js` | whole file | 0 grep hits. No barrel indirection. | Delete |
| `frontend/src/screens/FarmProfile/components/AIInsightsPanel.js` | whole file | 0 grep hits. | Delete |
| `frontend/src/screens/FarmProfile/components/FinancialSummaryCard.js` | whole file | 0 grep hits. | Delete |
| `frontend/src/components/ui/brandKit.js` | whole file | `brandKit`/`NeuralLeaf`/`BrandPill`/`BRAND`/etc. never imported (live design system is `constants/khetTheme.js`). | Delete |

### 2.3 Frontend — unused named exports (keep file + default)

| Path | Symbol | Why | Action |
| --- | --- | --- | --- |
| `frontend/src/components/ui/ImmersiveKit.js` | `FloatingParticle`, `TiltCard`, `PulseGlow`, `AnimatedHeader`, `EntryScale` | Only `EntrySlide`/`D` are consumed by the three importers. No namespace/barrel import. (Note: `GlassCard` here is also dead — all `GlassCard` imports resolve to `FarmProfile/ui/GlassCard.js` — but it was not in scope.) | Remove the 5 exports |
| `frontend/src/components/ui/motion.js` | `motionSpring`, `HeartButton` | All importers pull only `SPRINGS/AppPressable/AnimatedCard/isReducedMotion/enterAnimation`. 0 external hits. | Remove the 2 exports |
| `frontend/src/components/AnimalIcons.js` | `ANIMAL_ICON_MAP` | Sole importer uses the **default** export. Named re-export never imported. | Remove export (keep file + default) |
| `frontend/src/components/IrrigationIcons.js` | `IRRIGATION_ICON_MAP` | All 7 importers use the **default**. | Remove export (keep file + default) |
| `frontend/src/components/SoilIcons.js` | `SOIL_ICON_MAP` | All 6 importers use the **default**. | Remove export (keep file + default) |
| `frontend/src/components/MockImagePlaceholder.js` | `getTheme`, `CATEGORY_THEMES` | All 3 importers use the **default**. Neither named export imported. | Remove exports (keep file + default) |
| `frontend/src/services/aiApi.js` | 24 client methods (see note) | `aiApi` consumed only via named imports — no `import * as` — so per-name greps are exhaustive; all 24 have 0 external refs. Forward-looking API surface not wired to any UI. | Remove exports (or wire to UI) |
| `frontend/src/services/farmApi.js` | `getFarmFinancialSummary` | 0 refs despite 14 `import * as farmApi` consumers. | Remove export (or wire to a finance UI) |
| `frontend/src/services/socket.js` | `getSocket` | Live exports are `connectSocket`/`resetSocket`. | Remove export |
| `frontend/src/services/writeQueue.js` | `clearSyncError` | `useSyncStatus` (live) uses other exports; `clearSyncError` never called. | Remove export |
| `frontend/src/utils/farmHistory.js` | `summarizeCostSplit`, `buildPriorIssues` | Not called internally; not among `CropScanScreen`'s named imports. | Remove the 2 exports |
| `frontend/src/utils/languageDetect.js` | `toFullLocale` | Live export is `detectLanguage`. | Remove export |
| `frontend/src/utils/sanitize.js` | `escapeHtml` | `sanitizeUrl/stripHtml/safeOpenURL/sanitizePhone` remain live. | Remove export |
| `frontend/src/utils/storage.js` | `isTokenStale` | `scrubLegacyWebTokenStorage` remains live. | Remove export |
| `frontend/src/utils/secureCache.js` | `removeSecureItem` | `getSecureJSON/setSecureJSON` remain live. | Remove export |
| `frontend/src/i18n/stateMappings.js` | `getLangForState` | Only `getStatesByRegion`+`REGION_ORDER` imported; `INDIAN_STATES` used internally. | Remove export |
| `frontend/src/constants/config.js` | `MAX_MESSAGE_LENGTH`, `MAX_UPLOAD_BYTES`, `ALLOWED_IMAGE_EXTENSIONS`, `OTP_RESEND_COOLDOWN_SEC`, `OTP_MAX_ATTEMPTS` | Each grepped repo-wide returns only its own def. `API_BASE_URL/SOCKET_URL/STORAGE_KEYS` remain live. | Remove the 5 constants (or wire into client-side validation) |
| `frontend/src/constants/locations.js` | `KRUSHI_KENDRA_TYPES` | `STATES/getTalukas/BUSINESS_TYPES` remain live. | Remove export |
| `frontend/src/constants/indiaLocations.js` | `AGRI_STATES` | `INDIA_DISTRICTS/INDIA_STATES_LIST/getDistricts/STATE_GPS_MAP` remain live. | Remove export |
| `frontend/src/data/stateCrops.js` | `getStateDisplayName` | `STATE_CROPS/detectStateFromLocation` remain live. | Remove export |

> `aiApi.js` dead methods: `getVoiceConversationDetail, getScanHistory, getScanSessions, getScanSessionDetail, sendScanFollowUp, getSmartAlerts, getMarketPrices, getMarketPrediction, getExtendedForecast, getMarketCrops, createTask, deleteTask, getAgriPredictStates, getAgriPredictDistricts, getAgriPredictCommodities, getAgriHistoricalPrices, getAgriPrediction, getAgriNearbyComparison, triggerAgriSync, getAgriSyncStatus, getMSPRateForCommodity, getIrrigationWeekly, getInputPriceList, searchCrops`.

### 2.4 Frontend — redundant duplicates of backend utilities (delete frontend copy)

These are server-side files mistakenly bundled in the RN client. The live copy lives under `backend/src/`. The frontend copies are never imported by any `src/` file — their only references are in `frontend/tests/` files that **never run** (jest `testMatch` is `<rootDir>/src/**/__tests__/**/*.test.js`; these tests live outside `src/`).

| Path | Why | Action |
| --- | --- | --- |
| `frontend/src/utils/jwt.js` | Server token functions; `.easignore:32` flags it as "Backend code accidentally bundled". Missing deps (`jsonwebtoken` etc.) — would crash if imported. Live copy `backend/src/utils/jwt.js`. | Delete file (+ orphaned `frontend/tests/auth.test.js`) |
| `frontend/src/utils/encrypt.js` | Only ref is non-running `frontend/tests/mask.test.js`; imports a non-existent `../config/env.js`. Live copy `backend/src/utils/encrypt.js`. | Delete file (+ orphaned `frontend/tests/mask.test.js`) |
| `frontend/src/utils/mask.js` | `maskSensitiveFields` referenced only by the non-running test; imports dead `./encrypt.js`. FE PII masking is inline in `utils/encrypt.js`. Live copy `backend/src/utils/mask.js`. | Delete file |
| `frontend/src/utils/response.js` | Express `res`-based helpers — meaningless in RN. Live copy `backend/src/utils/response.js`. | Delete file |
| `frontend/src/utils/weatherCodes.js` | `WeatherHome.js` computes condition/gradient inline from numeric code ranges. Live copy `backend/src/utils/weatherCodes.js`. | Delete file |
| `frontend/src/utils/cityIds.js` | IMD city-id table consumed only by the backend scraper. Live copy `backend/src/utils/cityIds.js`. | Delete file (frontend copy only) |

### 2.5 Backend — misplaced frontend-copy cluster (self-referencing dead loop)

A closed cluster of RN/Expo files copied into the backend. None reachable from `server.js → app.js`; `backend/package.json` declares no expo/react-native deps, so they would crash if loaded. Delete the whole cluster together.

| Path | Why | Action |
| --- | --- | --- |
| `backend/src/services/api.js` | RN axios client (imports `utils/storage` → `react-native`). Imported only by the dead `aiApi.js`/`aiService.js`/`socket.js`. | Delete (with cluster) |
| `backend/src/services/aiApi.js` | Imports `expo-file-system/legacy`, dead `./api`, dead `mediaCompressor`. 0 backend importers. Live copy `frontend/src/services/aiApi.js`. | Delete |
| `backend/src/services/aiService.js` | Imports dead `./api`. 0 references anywhere (no frontend twin either). | Delete |
| `backend/src/services/socket.js` | socket.io-**client** singleton (dep not in backend). Real backend socket is `socket/chat.socket.js`. | Delete |
| `backend/src/services/weatherApi.js` | Imports `@react-native-async-storage`, `expo-location`. Backend weather is `weather.service.js`/`openMeteo.service.js`. | Delete |
| `backend/src/services/weatherService.js` | Imports `expo-location`. 0 references anywhere. | Delete |
| `backend/src/utils/storage.js` | `react-native` + `expo-secure-store`. Imported only by dead `services/api.js`. | Delete |
| `backend/src/utils/mediaCompressor.js` | Imported only by dead `services/aiApi.js`. Live copy `frontend/src/utils/mediaCompressor.js`. | Delete |
| `backend/src/constants/config.js` | FE runtime config; imported only by the 5 dead-cluster members. Real config is `config/env.js`. | Delete (with cluster) |

### 2.6 Backend — redundant frontend data/token files (REDUNDANT) and orphaned assets (DEAD)

| Path | Status | Why | Action |
| --- | --- | --- | --- |
| `backend/src/constants/colors.js` | REDUNDANT | Design tokens; 0 backend imports. Live copy `frontend/src/constants/colors.js` (75 importers). | Delete |
| `backend/src/constants/locations.js` | REDUNDANT | Maharashtra district/taluka data for RN UI; 0 backend imports. Live copy in frontend. | Delete |
| `backend/src/constants/indiaLocations.js` | REDUNDANT | 0 backend imports. Live copy in frontend (`MarketScreen`). | Delete |
| `backend/src/constants/mockData.js` | REDUNDANT | FE offline mock data; 0 backend imports. Live copy in frontend. | Delete |
| `backend/src/constants/cropImages.js` | DEAD | `CROP_IMAGES/SOIL_IMAGES/IRRIGATION_IMAGES` — 0 hits repo-wide. Its stated generator script does not exist. Fully orphaned. | Delete |
| `backend/src/constants/categories.js` | DEAD | 0 import hits across src/scripts/prisma. `prisma/seed-categories.js` is self-contained and does not import this file. | Delete |

### 2.7 FastAPI — uncalled functions

| Path | Symbol | Why | Action |
| --- | --- | --- | --- |
| `fastapi/agents/router.py` | `dispatch_text` (+ private `_call_one_text`) | 0 code callers (only a doc mention). Its sole helper `_call_one_text` is called only inside `dispatch_text`. All real text calls go through `llm_dispatch.call_llm_text`. `_run_chain` stays live via `dispatch_vision`. | Remove `dispatch_text` + `_call_one_text` (router.py:130-138, 183-198) |
| `fastapi/services/input_normalizer.py` | `clean_farm_context` (+ private `normalize_soil_type`, `normalize_irrigation`, `estimate_growth_stage`) | 0 callers; external importers pull only `normalize_crop_name`/`VALID_CROPS`. The three helpers are called only inside `clean_farm_context`, so the whole subtree is unreachable. | Remove `clean_farm_context` and its private-only helpers |
| `fastapi/agents/registry.py` | `display_name` | Only its own def; every other `display_name` hit is the unrelated live `lang_display_name`. `entry['display']` is read directly. | Remove the `display_name` helper (registry.py:189-191) |
| `fastapi/security/input_sanitize.py` | `delimit` | 0 callers; importers pull only `clean_user_text` (the live sibling). | Remove `delimit()` (input_sanitize.py:52-59) and its docstring bullet |

---

## 3. Probably dead (verify first)

Medium/low-confidence items and **SEMI_DEAD** (wired-but-unreached) items. Verify intent before touching — several are intentional scaffolding or registered routes awaiting an entry point.

### 3.1 Medium confidence — intentional scaffolding (decision required)

| Path | Symbol | Why | Action |
| --- | --- | --- | --- |
| `frontend/src/config/sslPinning.js` | whole file (`SSL_PINS`, `getSSLConfig`, `validateSSLPins`) | Never imported. Header says pins are "inert" until the native layer lands. Deleting loses pre-extracted pin values. | Wire `getSSLConfig()` into native networking, **or** delete if pinning is descoped |
| `frontend/src/services/crashReporter.js` | `registerCrashReporter` | Unused, but `captureException` is live (`RootErrorBoundary`). "Plug your SDK here" scaffolding. | Wire a crash SDK via it, **or** remove the export |

### 3.2 SEMI_DEAD — registered-but-unreachable navigator routes (`frontend/src/navigation/AppNavigator.js`)

Each route is registered but has **no** `navigate(...)` / `{screen:...}` target anywhere. Decide: wire an entry point or drop the registration.

| Route | Component | Evidence | Action |
| --- | --- | --- | --- |
| `SoilHub` | `SoilHubScreen` | Duplicate of the live `SoilHealth` alias (both → `SoilHubScreen`). Only the registration line references `SoilHub`. | Remove the duplicate `<AIStack.Screen name="SoilHub" .../>` (keep `SoilHealth`) — **REDUNDANT** |
| `MSPTracker` | `MSPTrackerScreen` | Only the registration line. No navigate target. (Component file itself may still be valid.) | Wire a `navigate('MSPTracker')` entry, or remove route (and screen if unused) |
| `DailyPlanner` | `DailyPlannerScreen` | Registration + a doc-comment in `FarmProfileBanner.js:8` (not a navigate). | Wire navigation or remove the route |
| `FarmCalendar` | `FarmCalendarScreen` | Only the registration line. | Wire navigation or remove the route |
| `Irrigation` | `IrrigationScreen` | No navigate target; the activity-log path resolves `IRRIGATION` to `ActivityIrrigationLog` via `LOGGER_ROUTE`, **not** this AI route. | Wire navigation, or remove (keep `ActivityIrrigationLog` intact) |
| `CropCalendar` | `CropCalendar` | Registered + imported, but its only logical parent `WeatherHome.js` has zero `navigate()` calls. | Wire navigation (e.g. from `WeatherHome`) or remove the route |
| `StateCrops` | `StateCropsScreen` | Only the registration line; parent `WeatherHome.js` has zero navigate calls. | Wire navigation or remove the route |

### 3.3 SEMI_DEAD — admin: unreached `export` keyword on internal-only types (`admin/src/`)

Each type is **used internally** but its `export` is never consumed (no external import, no barrel re-export). Low-risk cleanup: drop the `export` keyword, keep the local type.

| Path | Symbol | Action |
| --- | --- | --- |
| `admin/src/components/confirm.tsx` | `ConfirmOptions`, `ConfirmResult` | Remove `export` (keep as local types) |
| `admin/src/components/DataTable.tsx` | `DataTableProps` | Remove `export` (keep as local type) |
| `admin/src/components/filters.tsx` | `FilterOption` | Remove `export` (keep as local type) |
| `admin/src/lib/auth.tsx` | `AdminUser` | Remove `export` (keep as local type) |
| `admin/src/lib/useKeyset.ts` | `KeysetResult` | Remove `export` (keep as local type) |
| `admin/src/lib/api.ts` | `Envelope` | Remove `export` (keep as local type). Note `ApiMeta` *is* imported by `useKeyset.ts` — leave it exported. |
| `admin/src/components/ui.tsx` | `cn` | Remove `export` (keep `const cn = clsx` local) or inline `clsx` |

### 3.4 DEAD — non-functional stub (wire or remove)

| Path | Symbol | Why | Action |
| --- | --- | --- | --- |
| `fastapi/routes/agripredict.py` | `predict` handler + `from services.pest_agent_service import predict_pest_risk` | `services/pest_agent_service.py` does not exist, so the `except ImportError` always fires and the only mounted endpoint `/agripredict/predict` permanently returns `503`. The proxy (backend + frontend) also calls `filters/states`, `filters/districts`, `filters/commodities`, `prices/history`, `compare`, `sync/trigger`, `sync/status` — none of which the FastAPI router defines (all 404). | **Wire up or delete**: either add the real `services/pest_agent_service.py` + the missing endpoints, or remove `routes/agripredict.py` and its `include_router` at `main.py:50/246`. The current code can never succeed. |

---

## 4. Unused dependencies

`backend/package.json` — declared but never imported (grep over `backend/src`, scripts, prisma, `server.js`).

| Dependency | Why unused | Action |
| --- | --- | --- |
| `@anthropic-ai/sdk` (`^0.86.1`) | `claude.service.js` imports `OpenAI from 'openai'` (Gemini/OpenAI-compatible), not Anthropic. 0 `anthropic` imports. | Remove from `backend/package.json` |
| `pino` | Backend uses a custom `utils/logger.js`. Only `pino` substring hit is "Spinosad" in `constants/categories.js`. | Remove |
| `pino-pretty` | Companion to unused `pino`; no import anywhere. | Remove |
| `uuid` | IDs come from native `crypto.randomUUID()` and Prisma's internal `@default(uuid())` (not the npm package). | Remove |
| `express-rate-limit` | Replaced by a custom Redis limiter; only mention is an explanatory comment in `middleware/redisRateLimit.js:4`. | Remove |

---

## 5. How this was checked / caveats

- **Method.** Conservative, **grep-based** static analysis: repo-wide word-boundary scans (`grep -rnw` / `\b…\b`) for each symbol over `*.js/ts/tsx/json/py`, excluding `node_modules`, `build`, `dist`, `.git`, `.expo`, `__pycache__`. For files, both `from '…'` import forms and `require('…')` were checked. Findings were cross-checked against the actual navigator/router registrations (`App.js`, `AppNavigator.js`, `OnboardingNavigator.js`, FastAPI `main.py` `include_router`).
- **Dynamic references accounted for.** Each module was confirmed to have **no** `import * as` namespace consumer before trusting per-name greps; for default-vs-named cases (icon maps, `MockImagePlaceholder`) the default export was verified live and only the unused *named* re-export flagged. Control checks were used (e.g. the live sibling `MandiGlanceCard`/`EntrySlide`/`clean_user_text` are found by the same grep, proving the grep would catch a real consumer).
- **Twin files.** "REDUNDANT" means a live duplicate exists elsewhere (almost always a backend/frontend twin) — only the *unused* copy is flagged; the live copy is explicitly named and must be kept.
- **Non-running tests.** Several frontend util files are referenced only by tests under `frontend/tests/`, which never execute (jest `testMatch` is `<rootDir>/src/**/__tests__/**/*.test.js`). Those orphan tests should be deleted alongside their files.
- **False-positives filtered (2).** `frontend/src/services/api.js → getRefreshToken` is **actually used** (real internal call at `api.js:217` in the native token-refresh branch). `frontend/package.json → react-native-compressor` is **not dead** — it is an Expo **config plugin** in `app.json:57`, injected into the native build at prebuild and intentionally never imported in JS. Neither was included above.
- **Caveats before deleting.** This is static analysis. Before removing anything: (1) run the app's **test suite**, (2) run a **build** (RN/Expo bundle, backend start, FastAPI import, admin `tsc`/build), and (3) delete dead *clusters* together (the backend frontend-copy cluster is self-referencing — removing only part will leave broken imports). For the medium-confidence scaffolding (`sslPinning.js`, `crashReporter.registerCrashReporter`) and SEMI_DEAD routes, confirm there is no near-term roadmap intent before deleting; the conservative alternative is to wire the missing entry point instead.
