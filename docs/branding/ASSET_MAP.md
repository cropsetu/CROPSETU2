# KrushiSarva — Asset Map

Every generated asset, where it renders, and whether it is wired.
Generated from the batch manifests + a grep of `frontend/src` and `shared`.

| Set | N | Files | Renders at | Tier-3 fallback | Ships | Wired |
|---|---:|---|---|---|---|---|
| `SYMPTOM` | 12 | 24 | CropScanScreen.js:1154 symptom chips (34dp) | Ionicons leaf-outline | bundle | ✅ |
| `SOIL` | 8 | 16 | CropScanScreen.js:1054 soil picker (fill) · OnboardingProfile · FarmAddEdit · SoilHub | SoilIcon | bundle | ✅ |
| `IRR` | 6 | 12 | CropScanScreen.js:1088 irrigation picker (52dp) · OnboardingProfile · IrrigationLog | IrrigationIcon | bundle | ✅ |
| `PLACEHOLDER` | 2 | 4 | ProfileScreen.js:562 avatar · AgriStoreHome:254/314 · ProductDetail · CartScreen | initials / MockImagePlaceholder | bundle | ✅ |
| `ACT` | 13 | 26 | ActivityChip.js:82 (48dp) · ActivityTypePicker · MyFarmHome feed · DailyPlanner | ActivityIcon | bundle | ✅ |
| `SOW` | 4 | 8 | SowingLogScreen.js:17 method tiles (22dp — NEEDS ENLARGING) | Ionicons | bundle | ❌ |
| `OPS` | 4 | 8 | LandPrepLogScreen OPERATIONS tiles (22dp — NEEDS ENLARGING) | Ionicons | bundle | ❌ |
| `IMP` | 4 | 8 | LandPrepLogScreen IMPLEMENTS tiles (22dp — NEEDS ENLARGING) | Ionicons/MachineryIcon | bundle | ❌ |
| `SCOUT` | 5 | 10 | ScoutLogScreen.js:81 TileGrid photoSet="scout" (48dp) | Ionicons | bundle | ❌ |
| `SEV` | 4 | 8 | DiagnosisResultScreen SEV_CONFIG badges (24dp — NEEDS ENLARGING) | coloured badge | bundle | ❌ |
| `SCENE` | 8 | 8 | GrowthStoryScreen.js:226 StageScene backdrop | LinearGradient + CropIcon | bundle | ❌ |
| `CAT` | 22 | 44 | AgriStoreHome.js:204 category pills · CategoryDrawer:54 (NO ICON TODAY) | StoreCategoryIcon | CDN | ✅ |
| `MACH` | 10 | 20 | RentHome.js:202 chips (28dp) · :352 card · MachineryDetail:158 hero | MachineryIcon (all/other missing) | CDN | ✅ |
| `WX` | 9 | 18 | WeatherHome.js:504 hero (56dp) · AIAssistantHome weather tile | WeatherIcon | bundle | ✅ |
| `AI` | 2 | 4 | AIChatScreen.js:501 panelAvatar · :525 empty state | LinearGradient circle | bundle | ❌ |
| `SVC` | 11 | 22 | AIAssistantHome.js:59 QUICK_SERVICES · :67 AI_TOOLS (48-56dp) | Ionicons/TabIcon | bundle | ✅ |
| `CROP` | 66 | 132 | MarketScreen.js:172 (60dp) · CropScan step1 · OnboardingProfile · CropCalendar/StateCrops (replaces 104 emoji) | CropIcon (66) | CDN | ✅ |
| `ANIMAL` | 16 | 32 | AnimalTradeHome.js:111 pills (50dp) · :169 card · AnimalDetail:87 hero (140dp) | AnimalIcon (16) | CDN | ✅ |
| `IMG` | 1 | — | app.json icon/adaptiveIcon/monochrome/notification/splash/favicon + Play + admin (9 files) | — | bundle | ❌ |
| `SCHEME` | 9 | 18 | SchemeScreen.js:12 — BLOCKED: hardcoded array, no API call, no image column | Ionicons | CDN | ✅ |
| `ORDER` | 6 | 12 | seller OrdersScreen badges (16dp) — image only for 72dp empty state | Ionicons | CDN | ❌ |
| `NOTIF` | 8 | 16 | BLOCKED: no notification screen exists in the farmer app | — | CDN | ✅ |
| `AUTH` | 1 | — | LoginScreen.js:31/:280 welcome hero | — | bundle | ❌ |
| `STATE` | 5 | 10 | RootErrorBoundary · 7 offline sites · 5 text-only empties · CelebrationSheet | Ionicons | bundle | ✅ |
| `ONBOARD` | 3 | 6 | first-run carousel — SCREEN DOES NOT EXIST YET | — | bundle | ❌ |

**197 of 239 assets wired.**

