# Crop Calendar

> **Tab:** AI Assistant · **Stack:** AIStack · **Route name:** `CropCalendar` · **File:** `frontend/src/screens/Weather/CropCalendar.js`

## Purpose
A national crop sowing/harvest calendar that lets farmers browse common Indian crops, see each crop's season, sowing month, growth duration and harvest month at a glance, and tap through to a detailed growth-stage timeline. It also surfaces a quick seasonal guide (Kharif / Rabi / Zaid). Aimed at any farmer planning what and when to plant.

## Where it sits / how you reach it
- **Reached from:** Registered in `AINavigator` (AIStack) as `CropCalendar` with a header title `t('cropCalendar.bannerTitle')`. Navigated to from elsewhere in the AI tab via `navigation.navigate('CropCalendar')` (this stack header is shown, unlike most AI screens).
- **Navigates to:** `CropDetail` — each `CropCard` calls `navigation.navigate('CropDetail', { crop, cropName: crop.name })`.
- **Route params in:** none.

## How it works
- On mount, `useEffect` fetches `api.get('/weather/crops')` and sets `crops` to the returned `data.data` array; on empty response or any error it falls back to the local `CROP_FALLBACK` list (10 crops). `loading` is cleared in `finally`.
- Search: a controlled `searchQuery` state filters `crops` client-side by English `name` (lowercased) or Hindi `nameHi` (substring match on the raw query) — though note there is no visible search input rendered in the current JSX (see gaps).
- Rendering uses a performance-tuned `FlatList` (`windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`) with a `ListHeaderComponent` containing the banner + seasonal guide + section title, and `CropCard` rows separated by 14px spacers.
- Loading state renders a centered `ActivityIndicator` inside a `SafeAreaView`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header (stack) | Navigation header | Title from `cropCalendar.bannerTitle` (provided by AIStack `screenOptions`). |
| Banner | Header block | Leaf icon + `bannerTitle` + `bannerSub` intro text. |
| Seasonal guide | 3 season cards | Kharif (🌧️), Rabi (☀️), Zaid (🌸) cards, each with name, months and example crops (static, i18n). |
| "Select your crop" | Section title | Heading above the crop list. |
| Crop card | List item (`CropCard`) | Tappable; shows emoji icon, English + Hindi name, season chip, and a footer with Sowing / Duration / Harvest values. Press → `CropDetail`. |
| Crop arrow | Icon | Chevron in a pale circle indicating the card is tappable. |
| Loading spinner | Spinner | Shown full-screen while crops load. |
| `searchQuery` filter | State (no rendered input) | Filtering logic exists; no on-screen search bar is rendered in JSX. |

## Services, APIs & data
- **API endpoints:** `GET /weather/crops` via `services/api.js` (`api.get('/weather/crops')`). Returns `{ data: [...] }` of crop objects.
- **Backend route/service:** `backend/src/routes/weather.routes.js` → `router.get('/crops', ...)` which returns the static `CROP_CALENDAR` dataset via `sendSuccess`.
- **State / context:** `useLanguage()` for `t()`; local `useState` for `searchQuery`, `crops`, `loading`.
- **Local / static data:** `CROP_FALLBACK` (10 crops: Tomato, Wheat, Rice, Cotton, Onion, Soybean, Potato, Sugarcane, Maize, Groundnut) used when the API returns nothing or fails. `COLORS`, `SHADOWS` from `constants/colors`.

## Languages / i18n
Bilingual crop names are built into the data (`name` English + `nameHi` Hindi). UI strings use the `cropCalendar.*` namespace: `bannerTitle`, `bannerSub`, `currentSeasonGuide`, `kharif`/`rabi`/`zaid` (+ `*Months`, `*Crops`), `selectYourCrop`, `sowing`, `duration`, `harvest`. App language comes from LanguageContext (en/hi/mr/ta/kn/ml/te/bn/gu/pa supported app-wide).

## Notes, edge cases & gaps
- Offline/error resilience: API failure or empty list silently falls back to the 10-crop `CROP_FALLBACK`, so the list is never empty.
- There is no empty state for the search filter (and no visible search input is rendered), so filtering by `searchQuery` is currently unreachable from the UI even though the logic is present — a gap.
- `keyExtractor` uses `item.id`; fallback crops use numeric ids and backend crops are expected to carry `id`.
- Crop cards from the backend may carry `stages` for the detail screen; fallback crops have no `stages`, so tapping a fallback crop shows `CropDetail` without the timeline.
