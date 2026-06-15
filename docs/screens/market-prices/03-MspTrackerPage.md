# MSP Tracker

> **Tab:** AI Assistant (FarmMind) · **Stack:** `AINavigator` (AIStack) · **Route name:** `MSPTracker` · **File:** `frontend/src/screens/AI/MSPTrackerScreen.js`

## Purpose
Shows official Minimum Support Price (MSP) rates set by CACP / Government of India, switchable between Kharif and Rabi seasons. From any crop's rate card the farmer can drill into an MSP-vs-Mandi comparison that pulls the latest mandi modal price for the crop in their state and renders a sell-signal (Above / At / Below MSP) with the price gap.

## Where it sits / how you reach it
- **Reached from:** The screen is registered in `AINavigator` as `MSPTracker` (`frontend/src/navigation/AppNavigator.js:350`), **but no UI element navigates to it.** A repo-wide search finds no `navigate('MSPTracker')` / `screen: 'MSPTracker'` call — it is currently an unreachable (orphaned) route within the AI stack.
- **Navigates to:** No outbound `navigation.navigate`. The header back button is context-aware: if a comparison is open it calls `setComparing(null)` (returns to the rate list); otherwise `navigation.goBack()`.
- **Route params in:** none — comparison state (`user.state`) comes from `useAuth()`.

## How it works
- Top-level state: `rates`, `loading`, `season` (`'kharif'` | `'rabi'`, default `'kharif'`), and `comparing` (the crop item being compared, or `null`).
- On mount and whenever `season` changes, it sets `loading` and calls `getMSPRates(null, season)`, storing `d.rates` (or the array directly). Failures set `rates` to `[]`.
- The screen has two modes inside one component:
  - **Rate list** (when `comparing` is null): a season segmented control + a `FlatList` of `MSPRateCard`s with an informational header.
  - **Comparison view** (`ComparisonView`, when `comparing` is set): on mount it calls `getMSPComparison(item.commodity, state)` and renders the MSP vs mandi result; on failure `data` is null and a "comparison not available" message shows.
- `MSPRateCard` exposes a "Compare with Mandi" button that calls `onCompare(item)` → `setComparing(item)`.
- The comparison signal maps the backend `signal` (`ABOVE_MSP` / `AT_MSP` / `BELOW_MSP`) to `SIGNAL_CONFIG` (color, icon, label).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back chevron | TouchableOpacity (Ionicons `chevron-back`) | Closes comparison if open, else `navigation.goBack()` |
| Title + subtitle | Text | `t('mspTracker.mspTracker')` and `t('mspTracker.cacpGoi202526')` |
| Season tabs | Two TouchableOpacities (segmented) | Kharif / Rabi (`t('mspTracker.kharif')` / `t('mspTracker.rabi')`); sets `season`, refetches; hidden while comparing |
| Info header | Text | `t('mspTracker.mspInfo')` above the rate list |
| MSP rate list | FlatList | One `MSPRateCard` per crop |
| Loading state | ActivityIndicator + text | `t('mspTracker.loading')` |
| Empty state | Text | `t('mspTracker.noMspRatesFound')` |
| MSPRateCard | Card | Commodity name (+ Hindi `commodityHi` if present), MSP price `₹.../quintal`, season badge, year, optional hike badge (`↑ <increasePercent>%`), and a "Compare with Mandi" button |
| Comparison back link | TouchableOpacity | `t('mspTracker.back')` → `setComparing(null)` |
| Comparison title | Text | "<commodity> — MSP vs Mandi" |
| Signal card | Conditional card | Trend icon + label (Above/At/Below MSP) + suggestion text (`signalHi`/`suggestion`) |
| Compare grid | Two boxes | Govt MSP (`t('mspTracker.govtMsp')`) and Mandi Price (`t('mspTracker.mandiPrice')`), each `₹.../quintal` |
| Mandi detail row | Conditional row | Market name + district + modal price + a mini signal chip |
| Price-diff line | Text | "+₹<diff> from MSP (±<pct>%)" when `priceDiffFromMSP` is present |
| Comparison-unavailable | Text | `t('mspTracker.comparisonNotAvailable')` when `data` is null |

## Services, APIs & data
- **API endpoints (via `frontend/src/services/aiApi.js`):**
  - `GET /msp/rates` (`year`, `season` params) via `getMSPRates()` — the rate list.
  - `GET /msp/compare/:commodity` (`state`, optional `district`) via `getMSPComparison()` — the comparison view.
  - (`getMSPRateForCommodity` exists in `aiApi.js` but is not used by this screen.)
- **Backend route/service:** `backend/src/routes/msp.routes.js`:
  - `GET /api/v1/msp/rates` reads `prisma.mSPRate` filtered by season/year (defaults via `currentSeasonYear()`); 404 if none.
  - `GET /api/v1/msp/compare/:commodity` joins the current MSP (`mSPRate`) with the latest `mandiPrice` (last 7 days) for the commodity+state and computes `signal` / `signalHi` / `priceDiffFromMSP` / `priceDiffPercent`. Both routes are gated by the `msp_tracker` feature flag. (Mandi figures originate from `mandiPrice.service.js` / data.gov.in.)
- **State / context:** `useAuth()` (for `user.state` passed to the comparison), `useLanguage()` (`t`, `language`), local `useState`. `AnimatedScreen` wrapper.
- **Local / static data:** `SIGNAL_CONFIG` (signal → color/bg/icon/label map).

## Languages / i18n
Uses the `mspTracker.*` namespace throughout (`mspTracker`, `cacpGoi202526`, `kharif`, `rabi`, `mspInfo`, `loading`, `noMspRatesFound`, `compareWithMandi`, `loadingComparison`, `back`, `govtMsp`, `mandiPrice`, `fromMsp`, `comparisonNotAvailable`). These keys are present across multiple language files under `frontend/src/i18n/lang/` (gu, kn, te, …), so multi-language support is in place.

## Notes, edge cases & gaps
- **Orphaned route:** registered but unreachable — no in-app entry point navigates to `MSPTracker`.
- **Bug — broken `t()` references in child components:** `MSPRateCard` (line ~53) and `ComparisonView` call `t(...)` (e.g. `t('mspTracker.compareWithMandi')`, `t('mspTracker.back')`, `t('mspTracker.govtMsp')`) but **never receive `t` as a prop and don't call `useLanguage()`**, so `t` is undefined inside them. As written these would throw `ReferenceError: t is not defined` at render. A `{/* TODO: needs t() from parent */}` comment on line 53 flags this. Only the top-level `MSPTrackerScreen` component has `t` in scope.
- Header uses a fixed `paddingTop: 52` instead of safe-area insets.
- Comparison gracefully degrades: if the mandi price is missing it shows "—" and omits the diff line; if the whole comparison fails it shows the unavailable message.
- Season default is hard-coded to `'kharif'` on the client even though the backend computes the current season/year if none is passed.
