# Mandi Bhav (Commodity Price List)

> **Tab:** AI Assistant (FarmMind) — see note · **Stack:** AIStack (not currently registered) · **Route name:** _unregistered_ (component `MandiBhavScreen`) · **File:** `frontend/src/screens/AI/MandiBhavScreen.js`

## Purpose
A lighter, fully-localized mandi-price browser: pick a commodity from a chip row, set a state and (optional) district, and see real data.gov.in modal prices as cards sorted highest-first. Each card shows the min / modal / max spread with a fill bar and arrival date. It supports pull-to-refresh and is built entirely on `t()` translation keys.

## Where it sits / how you reach it
- **Reached from:** **Nothing currently.** `MandiBhavScreen` is **not** registered in `frontend/src/navigation/AppNavigator.js` (or any other navigator) and nothing imports it outside its own file. It is effectively dead/unwired code; the live market screen that ships in the AI stack is `MarketScreen` (route `Market`). If it were wired, it would naturally live in `AINavigator` (AIStack) like the other AI service screens.
- **Navigates to:** `navigation.goBack()` from the header back chevron. No outbound navigation otherwise.
- **Route params in:** none — initial `state`/`district` come from the authenticated `user` (`user.state`, `user.district`).

## How it works
- State: `commodity` (default `'Tomato'`), `state` (defaults to `user?.state || 'Maharashtra'`), `district` (defaults to `user?.district || ''`), `prices`, `loading`, `refreshing`, `error`, and `showStateMenu`.
- `fetchPrices(isRefresh)` is a `useCallback` keyed on `[commodity, state, district]`. It toggles `refreshing` vs `loading`, calls `getMandiPrices(commodity, state, district || null)`, sorts the returned rows descending by `modalPrice`, and stores them. Errors set `error` from `err.response.data.error.message` or a fallback "Failed to load prices".
- `useEffect(() => { fetchPrices(); }, [fetchPrices])` auto-fetches on mount and whenever the commodity/state/district change.
- The district `TextInput` triggers a fetch on `onSubmitEditing`; the search button and chip/state-menu selections also re-fetch (chips/state changes re-fetch via the `fetchPrices` dependency).
- Pull-to-refresh on the list calls `fetchPrices(true)`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back chevron | TouchableOpacity (Ionicons `chevron-back`) | `navigation.goBack()` |
| Title + subtitle | Text | `t('mandiBhav.mandiBhav')` and `t('mandiBhav.liveDatagovin')` |
| LIVE pill | Badge + dot | Static "LIVE" indicator |
| Commodity chips | Horizontal ScrollView of TouchableOpacities | Tomato, Onion, Potato, Wheat, Rice, Soybean, Cotton, Maize, Gram, Tur, Sugarcane, Grapes, Pomegranate; active chip highlighted; selecting sets `commodity` (re-fetches) |
| State button | TouchableOpacity | Toggles the state dropdown; shows current `state` |
| District input | TextInput | `t('mandiBhav.districtOptional')` placeholder; `onSubmitEditing` → fetch |
| Search button | TouchableOpacity (Ionicons `search`) | Calls `fetchPrices()` |
| State dropdown | Conditional list | Maharashtra, Punjab, Madhya Pradesh, Uttar Pradesh, Karnataka, Andhra Pradesh, Rajasthan; selecting sets `state`, closes menu |
| Loading state | ActivityIndicator + text | `t('mandiBhav.loadingPrices')` |
| Error state | Icon + text + retry | `cloud-offline-outline`, error message, `t('mandiBhav.retry')` button |
| Price list | FlatList | Renders `PriceCard` per row; pull-to-refresh via `RefreshControl` |
| List header | Text | "<count> <t('mandiBhav.mandis')> • <commodity>" (only when prices exist) |
| Empty state | Icon + text | `storefront-outline`, `t('mandiBhav.noPricesFound')`, `t('mandiBhav.tryADifferentDistrictOrState')` |
| PriceCard | Card component | Market name + "district, state"; modal-price badge (`₹.../q`); Min / Modal / Max columns; a price-position fill bar (`pct` of the min–max range); "Arrival: <date>" when present |

## Services, APIs & data
- **API endpoints:** `GET /mandi/prices` (`commodity`, `state`, optional `district`) via `getMandiPrices()` in `frontend/src/services/aiApi.js`. Also imports `getNearbyMandis` from `aiApi.js` but does **not** use it in the current code.
- **Backend route/service:** `backend/src/routes/mandi.routes.js` → `GET /api/v1/mandi/prices`, served by `getMandiPrices()` in `backend/src/services/mandiPrice.service.js` (Agmarknet / data.gov.in with DB caching; `mandi_bhav` feature flag).
- **State / context:** `useAuth()` for the default `user.state` / `user.district`; `useLanguage()` for `t` / `language`; local `useState` for the rest. `AnimatedScreen` wrapper.
- **Local / static data:** in-file `COMMODITIES` (13 chips) and `STATES` (7 states) constants.

## Languages / i18n
Fully localized via the `mandiBhav.*` namespace (e.g. `mandiBhav.mandiBhav`, `liveDatagovin`, `districtOptional`, `loadingPrices`, `retry`, `noPricesFound`, `tryADifferentDistrictOrState`, `mandis`). These keys exist across multiple language files under `frontend/src/i18n/lang/` (en/hi plus gu, kn, te, …) — multi-language support is in place.

## Notes, edge cases & gaps
- **Dead screen:** the biggest gap — it is not reachable in the app because it is not added to any navigator. Functionally it overlaps with `MarketScreen` (route `Market`), which is the one wired into the AI tab.
- Header uses a fixed `paddingTop: 52` rather than safe-area insets.
- Loading and error are mutually exclusive full-screen states; the empty list is handled by `ListEmptyComponent`.
- The imported `getNearbyMandis` is unused (no "nearby mandis" UI here).
- `PriceCard`'s `pct` fill assumes valid min/max; it guards divide-by-zero with `|| 1` and defaults to 50% when data is missing.
