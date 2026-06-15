# AI Crop Advisor (AIRecommendation)

> **Tab:** Shop (file lives under AgriStore) · **Stack:** _not registered in any navigator_ · **Route name:** `AIRecommendation` (intended, but no `Stack.Screen` exists) · **File:** `frontend/src/screens/AgriStore/AIRecommendation.js`

## Purpose
A 4-step "Crop Advisor" wizard: select a crop and field setup → capture/upload crop photos → enter field conditions (live weather + soil type) → view an AI analysis report (photo-based disease detection, diagnosis overview, disease-symptom catalog, soil health, fertilizer plan, pesticide recommendation). It is a self-contained guided diagnosis/advisory flow, heavily animated (orbit spheres, particles, scan sweep).

## Where it sits / how you reach it
- **Reached from:** **Currently nothing.** A repo-wide search for `AIRecommendation` finds no other reference — it is **not** added to `AgriStoreNavigator` (or any other stack) in `frontend/src/navigation/AppNavigator.js`, and no screen navigates to it. It appears to be orphaned / dead code (not reachable in-app at present).
- **Navigates to:** `navigation.goBack()` only (the header back arrow on step 1; deeper steps decrement the internal `step` state rather than navigating). No outbound `navigate()` calls.
- **Route params in:** none (component only uses `{ navigation }`).

## How it works
- Self-managed wizard via local `step` state (1–4); `goBack()` decrements the step or `goBack()`s the navigator at step 1.
- **Step 1 — Crop & Field Setup:** loads crops from `api.get('/agristore/crops')` with a hardcoded `fallbackCrops` list (8 emoji crops) on empty/error. User picks a crop, enters land size (acres), and an optional previous-crop dropdown. "Other crop" shows a "coming soon" Alert.
- **Step 2 — Photo Scan:** scan-type chips (leaf/stem/root/field); `expo-image-picker` camera (`launchCameraAsync`) and gallery (`launchImageLibraryAsync`) capture, up to 4 photos, each tagged with the active scan type; remove/add-more controls. Requests camera + media-library permissions.
- **Step 3 — Field Conditions:** fetches live weather directly from **open-meteo.com** (`fetch` to `https://api.open-meteo.com/v1/forecast`) using `gpsCoords` from `LocationContext` (falls back to Pune 18.52,73.86, then to static values on error). Loads soils from `api.get('/agristore/soils')` with a hardcoded `fallbackSoils` list. User selects a soil type.
- **Analysis:** `proceedToResults` builds a `FormData` (cropId, soilId, landSize, weather JSON, photos + photoTypes) and `POST /agristore/analyze`, storing `data.data.detections`; shows the full-screen `AnalyzingOverlay` (~2.8s progress animation) then advances to step 4. On error, `detections = []`.
- **Step 4 — Results:** renders animated report sections (analysis header w/ stats, download-report button [no handler], photo-scan results from `detections`, diagnosis overview, disease symptoms, soil health bars, fertilizer plan, pesticide recommendation) sourced from `crop.diseases/fertilizer/pesticide` and `detections`. "Start New Analysis" resets all state to step 1.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header | Bar | Back arrow (`goBack`), "AI Crop Advisor" title + crop/step subtitle, leaf avatar |
| Step indicator | 4-step progress | Dots/labels Crop / Photos / Conditions / Results |
| HeroBanner | Animated banner | Orbit-ring sphere + particles (step 1) |
| Crop grid | Selectable cards | API/fallback crops + "Other crop" (Alert) |
| Selected crop pill | Pill | Shows selected crop + critical-disease count |
| Land size input | TextInput | Decimal-pad, "acres" unit |
| Previous crop dropdown | Dropdown menu | Wheat/Rice/Pulses/Mustard/Maize/Sorghum/Fallow |
| AI info box | Info card | "Crop detected" message |
| Next: Photograph | Primary button | Advances to step 2 (disabled until crop selected) |
| ScanModeBanner | Animated banner | Scan-frame box w/ sweep line (step 2) |
| Tips banner | Banner | Photo tips |
| Scan-type chips | Horizontal chips | Leaf / Stem / Root / Field |
| Take Photo / Upload Photo | Capture buttons | `expo-image-picker` camera / gallery |
| Photo count bar | Indicator | n/4 captured |
| Captured photo grid | Thumbnails | Scan-type tag, AI-scan tag, remove (×), add-more |
| Continue / Skip Photos | Primary button | Advances to step 3 |
| Back to crop | Text button | step 2 → 1 |
| Live weather grid | Cards (2×2) | Temp/Humidity/Rainfall/Wind from open-meteo; "LIVE" tag; loading spinner |
| Weather AI insight | Info box | Humidity/rainfall advisory |
| Soil grid | Selectable cards | API/fallback soils |
| Soil matched | Info box | Confirmation message |
| Analyze button | Primary button | `proceedToResults` (disabled until soil selected) |
| Back to photos | Text button | step 3 → 2 |
| AnalyzingOverlay | Full-screen overlay | Orbit sphere + progress bar + step hints |
| Results header | Gradient card | Stats: diseases checked / photos analyzed / acres |
| Download Report | Button | **No handler** (non-functional) |
| Photo scan results | Cards | Per-detection disease + confidence bar |
| Diagnosis / Disease symptoms / Soil health / Fertilizer / Pesticide | Cards | Report sections; pesticide has a "Mixing instructions" button (no handler) |
| Start New Analysis | Text button | `resetAll` → step 1 |

## Services, APIs & data
- **API endpoints attempted (via `services/api.js`):**
  - `GET /agristore/crops` — **does not exist in the backend**; always falls back to hardcoded crops.
  - `GET /agristore/soils` — **does not exist in the backend**; always falls back to hardcoded soils.
  - `POST /agristore/analyze` (multipart FormData) — **does not exist in the backend**; the call will fail and `detections` stays `[]`.
  - Direct `fetch` to `https://api.open-meteo.com/v1/forecast` (third-party, not via the app's services layer).
- **Backend route/service:** none of `/agristore/crops`, `/agristore/soils`, `/agristore/analyze` are defined in `backend/src/routes/agristore.routes.js` (verified). This screen is effectively a UI prototype running on fallback/static data.
- **State / context:** `useLanguage()` (`t`); `useLocation()` (`coords` as `gpsCoords`); extensive local `useState`/`useRef` for wizard state and animations.
- **Local / static data:** `PREV_CROP_KEYS`, `SCAN_TYPES`, `fallbackCrops`, `fallbackSoils`, severity/status color helpers; crop `diseases`/`fertilizer`/`pesticide` are read off the crop object (absent on fallback crops, so those report sections render empty).

## Languages / i18n
Heavily i18n-driven via `t` under the `ai.*` namespace — e.g. `ai.heroTitle`, `ai.whatAreYouGrowing`, `ai.selectCurrentCrop`, `ai.landSize(Placeholder)`, `ai.previousCrop` + `ai.prevCrop*`, `ai.scanLeaf/Stem/Root/Field` (+ hints), `ai.takePhoto`, `ai.uploadPhoto`, `ai.photosCaptured`, `ai.liveWeather`, `ai.cond*`, `ai.yourSoilType`, `ai.analyzing`, `ai.analysisComplete`, `ai.photoScanResults`, `ai.fieldDiagnosis`, `ai.diseaseSymptoms`, `ai.soilHealth`, `ai.fertPlan`, `ai.pesticideRec`, `ai.startNewAnalysis`, `ai.comingSoon(Msg)`. Soil fallback names include Hindi (`nameHi`).

## Notes, edge cases & gaps
- **Dead/orphaned screen:** not registered in any navigator and not referenced anywhere → not reachable in the running app.
- **Backend endpoints missing:** `/agristore/crops`, `/agristore/soils`, `/agristore/analyze` are not implemented, so the screen runs entirely on hardcoded fallbacks and a failed analyze call (detections always empty).
- `bug` reference: Step 3's weather `useEffect` references `gpsCoords` in its dependency array but `gpsCoords` is the parent component's variable (from `useLocation` in `AIRecommendation`), not a prop passed into `Step3` — `Step3` has no `gpsCoords` in scope, so this would throw a ReferenceError if the screen were ever mounted at step 3. (Confirms the screen is unused.)
- "Download Report" and "Mixing instructions" buttons have no handlers.
- Permissions: requests both camera and media-library; denies show an Alert. Max 4 photos enforced with an Alert.
