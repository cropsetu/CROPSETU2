# Mandi Bhav (Market Prices)

> **Tab:** AI Assistant (FarmMind) · **Stack:** `AINavigator` (AIStack) · **Route name:** `Market` · **File:** `frontend/src/screens/AI/MarketScreen.js`

## Purpose
The primary live market-price screen for farmers. It shows real Agmarknet / data.gov.in mandi prices for a chosen crop, filtered by state and district, sorted highest-modal-price first. It auto-detects the user's location via GPS, surfaces a price-summary hero (top / average / lowest / mandi count), and offers a shortcut to ask the FarmMind AI chat about the best time to sell. Despite the file name "Market", the on-screen title is "Mandi Bhav".

## Where it sits / how you reach it
- **Reached from:**
  - **AIAssistantHome** (`frontend/src/screens/AI/AIAssistantHome.js`) — the Quick Services 4-col tile `markets` (label key `aiHome.tools.mandi.label`) and the AI Tools 2-col card `mandi`, both with `screen: 'Market'`.
  - **FarmDetailScreen** (`frontend/src/screens/FarmProfile/FarmDetailScreen.js:248`) via `navigation.navigate('AIAssistant', { screen: 'Market' })`.
- **Navigates to:**
  - `navigation.goBack()` from the header back chevron.
  - `AIChat` route with `{ initialMessage: "What's the best time to sell my <crop> in <state>?" }` via the "Ask FarmMind about <crop>" button (only rendered when there are prices).
- **Route params in:** none — all state is internal; it reads GPS from `LocationContext`.

## How it works
- On mount (and whenever `gpsCoords` from `useLocation()` changes), it sets `locationDetecting`, reverse-geocodes the GPS coords with `Location.reverseGeocodeAsync`, maps the returned region through `STATE_GPS_MAP`, strips administrative suffixes (Division/District/Taluka/Tehsil/Mandal) from the subregion, matches it against the static district list, and sets `selectedState` / `selectedDistrict` / `detectedCity`. It then calls `loadMandiPrices(DEFAULT_CROP='Tomato', state, district)`. If GPS/geocoding fails it falls back to `Maharashtra` with no district.
- Whenever `selectedState` changes it refreshes the district list (`getDistricts(state)`) and clears `selectedDistrict`.
- `loadMandiPrices` calls `getMandiPrices(crop, state, district || null)` from `services/aiApi`, normalizes the result to an array, sorts descending by `modalPrice`, and stores `mandiStale` and `mandiUpdatedAt` from the response. A `contentAnim` fade-in plays on success.
- Error handling: a `404` is treated as "no data" (empty state, no error banner); any other error sets `mandiError` and shows a retry banner.
- Derived stats: `topPrice` (first row), `lowestPrice` (last row), `avgModal` (mean of modal prices), and the mandi count.
- Changing the crop via the modal calls `handleSelectCrop`, which reloads prices. The state/district dropdowns reload prices on selection; the blue analytics "search" button re-runs `loadMandiPrices` with current filters.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back chevron | Pressable (Ionicons `chevron-back`) | `navigation.goBack()` |
| "Mandi Bhav" title + subtitle | Text | Subtitle shows "Detecting location…", "Near <city>" with a location pin, or "Real data · data.gov.in" |
| LIVE pill | Badge + `LiveDot` | Pulsing dot + "LIVE" text (decorative) |
| Selected-crop selector | Pressable card | Shows `CropIcon` + crop name + "Tap to change"; opens the Crop Picker modal |
| State button | Pressable | Toggles the state dropdown; shows current `selectedState` |
| District button | Pressable | Toggles the district dropdown; shows `selectedDistrict` or "All Districts"; has an inline close-circle to clear the district (reloads prices) |
| Analytics / search button | Pressable (Ionicons `analytics-outline`, blue) | Closes menus and re-runs `loadMandiPrices` with current filters |
| State dropdown | Conditional overlay + ScrollView | Lists `INDIA_STATES_LIST`; selecting sets state, clears district, reloads |
| District dropdown | Conditional overlay + ScrollView | "All Districts" option + districts for the state; empty-message fallback "No districts found for <state>." |
| Crop Picker modal | Bottom-sheet `Modal` (`CropPickerModal`) | Animated slide-up sheet with handle, title, close button |
| — Crop search input | TextInput | "Search crops…" filter with clear (close-circle) button |
| — Category chips | Horizontal ScrollView of Pressables | All / Vegetables / Fruits / Cereals / Pulses / Oilseeds / Cash Crops / Spices |
| — Results count | Text | "<n> crops" |
| — Crop grid | FlatList (3 cols) | `CropIcon` tiles; selected tile gets a checkmark; empty state "No crops found" |
| Loading state | ActivityIndicator + text | "Fetching live mandi prices for <crop>…" + "Source: data.gov.in" |
| Error state | Icon + text + retry | "Failed to load mandi prices…" with `cloud-offline-outline` + "Try Again" button |
| Stale-data bar | Conditional banner | "Showing cached data (data.gov.in unavailable). Last updated: <date>" |
| Price hero (gradient) | `AnimCard` + `LinearGradient` | Crop badge, "Real Data" badge, top modal price + range across N mandis + average |
| Stat pills | `StatPill` row | HIGHEST / AVERAGE / LOWEST / MANDIS |
| "Live Mandi Prices" section | Section header + `data.gov.in` source badge | |
| Mandi price rows | List of rows | Market name (top row gets a "Highest" badge), district/state, relative date label ("Yesterday", "N days ago"), modal price, and min–max range |
| No-data empty state | Icon + text + Refresh | `storefront-outline`, "No mandi data found", "Try a different state or district." + Refresh button |
| Ask FarmMind button | Pressable + `LinearGradient` | "Ask FarmMind about <crop>" → `AIChat` with a prefilled sell-timing question |

## Services, APIs & data
- **API endpoints:** `GET /mandi/prices` (with `commodity`, `state`, optional `district` params) via `getMandiPrices()` in `frontend/src/services/aiApi.js`. (Note: the dedicated `frontend/src/services/mandiApi.js` exists with its own `getMandiPrices`/`getMandiTrend`, but this screen imports from `aiApi.js`.)
- **Backend route/service:** `backend/src/routes/mandi.routes.js` → `GET /api/v1/mandi/prices`, backed by `getMandiPrices()` in `backend/src/services/mandiPrice.service.js` (data.gov.in / Agmarknet with DB caching; gated by the `mandi_bhav` feature flag). Returns 404 when no rows match.
- **State / context:** `useLocation()` (LocationContext) for GPS coords; `useLanguage()` for `t`/`language` (imported but the screen renders hardcoded English strings); extensive local `useState` for crop/state/district filters, dropdown visibility, prices, loading/error/stale flags, and `Animated` values.
- **Local / static data:** `CROP_CATEGORIES` / `ALL_CROPS` (in-file crop taxonomy), `MANDI_COORDS` (hard-coded mandi lat/lon for distance math — `addDistances`/`distanceKm`), `PERIODS` (defined but unused here), and `INDIA_STATES_LIST` / `INDIA_DISTRICTS` / `STATE_GPS_MAP` / `getDistricts` from `frontend/src/constants/indiaLocations.js`. `CropIcon` from `frontend/src/components/CropIcons.js`. `AnimatedScreen` wrapper.

## Languages / i18n
`useLanguage()` is imported and `t`/`language` destructured, but the JSX uses hardcoded English literals (e.g. "Mandi Bhav", "Selected Crop", "Live Mandi Prices") — this screen is **not** actually localized despite the context being available. (Contrast with `MandiBhavScreen.js`, which does use `t('mandiBhav.*')` keys present across language files.)

## Notes, edge cases & gaps
- **Loading:** spinner with crop-specific copy; prices cleared before each fetch.
- **Empty vs error:** a 404 from the backend is intentionally shown as the "No mandi data found" empty state (with a Refresh button), not as an error; other failures show the error banner with "Try Again".
- **Stale data:** the `mandiStale` flag drives a cached-data warning bar and per-row "Yesterday / N days ago" date labels (rows ≥1 day old are dimmed/italicized).
- **GPS/permissions:** location detection is best-effort — failures silently fall back to Maharashtra; no permission prompt is requested here (it relies on the global `LocationContext`).
- **`PERIODS`, `SparkLine`, and many `agri*`/predict styles are defined but not rendered** in the current screen body — leftover from a prior trend/prediction layout.
- Distance (`dist`) is computed by `addDistances` but is not displayed in the current row layout.
