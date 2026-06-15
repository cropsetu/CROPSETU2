# Weather Home (Field Monitor)

> **Tab:** AI Assistant · **Stack:** AIStack · **Route name:** `Weather` · **File:** `frontend/src/screens/Weather/WeatherHome.js`

## Purpose
A hyperlocal, agriculture-focused weather dashboard ("CropSetu Field Monitor") that turns Open-Meteo + IMD data into farmer-actionable insight. It shows the current conditions, hourly and 7-day forecasts, soil temperature/moisture, evapotranspiration, atmospheric and crop-maturity metrics, plus generated farming advisories and severe-weather alerts. Farmers use it to plan irrigation, sowing, spraying and harvest around the weather. The same component is reused inside `AIWeatherHub` via the `embeddedInHub` prop, where its standalone header is hidden.

## Where it sits / how you reach it
- **Reached from:** The AI Assistant home (`AIAssistantHome.js`) via a weather card — `onPress={() => navigation.navigate('Weather')}`. Also rendered embedded inside `AIWeatherHub` (the "Weather" pill tab) where it receives `embeddedInHub` and hides its own header.
- **Navigates to:** No outward navigation. As a standalone screen the header back arrow calls `navigation?.goBack()`; the refresh icon re-runs `load()`. (Crop calendar / state-crops are reached from the AI home, not from here.)
- **Route params in:** none (uses `navigation` and the optional `embeddedInHub` prop). Location is resolved from device GPS, not from params.

## How it works
- On mount (`useEffect` → `load()`), it calls `fetchWeatherForCurrentLocation({ lang, onCacheHit: applyData })` from `weatherApi.js`. The `onCacheHit` callback renders cached AsyncStorage data immediately (offline-first), then the resolved fresh result overwrites it.
- Key state: `weather` (the full payload), `loading`, `stale` + `cachedAt` (drives the "X min ago" stale badge via `formatLastUpdated`), `error`, and `dismissed` (hides the IMD alert banner). A `fadeAnim` Animated value fades the content in over 400 ms.
- Loading state shows a centered `ActivityIndicator` with "fetching field data" text (only when there is no cached weather yet). Error state (no cache) shows an alert icon, message, "connect internet" subtext and a Retry button that calls `load()`. If a network call fails but cache exists, the cached data is shown with a stale badge and no error.
- The hero gradient/background image are chosen dynamically by WMO weather code + current hour (`heroGradient`, `getWeatherImage`). The screen derives severe-weather alerts client-side from the 7-day `daily` data plus backend IMD alerts (`generateWeatherAlerts`, capped at 3): thunderstorm, heavy rain, rain-likely, strong wind, high UV, and passthrough IMD warnings. Several sections render conditionally only when their data exists.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back arrow | Icon button (header) | `navigation.goBack()`. Only when not `embeddedInHub`. |
| "Field Monitor" title + location pin | Header label | Static center title with location icon. Hidden when embedded. |
| Refresh icon | Icon button (header) | Re-runs `load()` to re-fetch weather. Hidden when embedded. |
| Hero card | ImageBackground + gradient | Field photo selected by weather code/hour, dark overlay, location name (or lat/lon), big temp `°C`, condition text. |
| Stale badge | Inline text | "· X min ago" shown in hero when serving stale cache. |
| Hero stats row | Inline stats | Feels-like, humidity %, wind km/h + compass, UV index (UV shown only if > 0). |
| Today H/L | Inline text | Today's max/min temperature. |
| IMD alert banner | Dismissable banner | Top severity IMD alert (title + 2-line description); close (X) sets `dismissed`. Only if alerts exist. |
| Farming advisories | Horizontal scroll of cards | Colored advisory cards (green/orange/red) with icon, title, description. |
| Hourly forecast | Horizontal scroll card | Up to 24 `HourlyItem`s: time/"Now", condition icon, temp, rain % (highlighted for current hour). |
| 7-day forecast | Vertical list card | `DailyRow`s: day label, condition icon, min/max with temperature bar, rain % badge (today highlighted). |
| Weather alerts | Section with badge + cards | Count badge; either an "All clear" card or up to 3 alert cards with severity badge (HIGH/MED/LOW), day, description. |
| Soil dashboard | Card | Soil temperature rows (surface/6cm/18cm), `MoistureBar`s (surface/1-3cm/3-9cm with dry/low/good/wet color + state), evapotranspiration & reference ET (FAO-56) rows. |
| Sunrise/Sunset arc | Card (`SunArc`) | 40-dot semicircle with glowing sun at current progress, sunrise/sunset times, daylight duration, daylight progress bar. |
| Atmosphere grid | Card | 8 metric tiles: visibility, dew point, wind gusts, leaf wetness, VPD, CAPE, solar radiation, pressure (some color-coded to risk thresholds). |
| Crop maturity tracker (GDD) | Card | Per-day Growing Degree Days bars (shown if any day has GDD). |
| Sunshine & solar | Card | Per-day sunshine hours bar + solar radiation sum (shown if available). |
| Rain breakdown | Table card | Per-day steady rain / showers / precipitation hours columns. |
| Source note | Footnote | "combined forecast" note when `meta.imdAvailable`. |
| Loading indicator | Spinner | Full-screen spinner + text while first load with no cache. |
| Error view + Retry | Empty state + button | Alert icon, message, Retry button re-runs `load()`. |

## Services, APIs & data
- **API endpoints:** `GET {API_BASE_URL}/weather?lat=&lon=&lang=&city=` via `services/weatherApi.js` → `fetchWeatherForCurrentLocation()` / `fetchFromBackend()`. Response envelope `{ success, data }` is unwrapped.
- **Backend route/service:** `backend/src/routes/weather.routes.js` (`GET /` handler) → `services/openMeteo.service.js` (`fetchOpenMeteo`, `reverseGeocode`), `services/weather.advisory.service.js` (`generateAdvisories`), `services/imd.scraper.service.js` (`scrapeIMD`, non-blocking IMD alerts). 3-layer cache: in-process memory → Prisma `weatherCache` (PostgreSQL) → Open-Meteo.
- **State / context:** `useLanguage()` (LanguageContext) for `language` + `t()`. Local `useState`/`useRef`/`Animated`. Offline cache is handled inside `weatherApi.js` (AsyncStorage `fe_wx_*` for payloads, encrypted `fe_loc` for GPS coords; in-memory L0 map).
- **Local / static data:** `WEATHER_IMAGES` (require'd assets in `assets/weather/`), `heroGradient`/`getWeatherImage` selectors, `ADVISORY_COLORS`, `ALERT_COLORS`, `SEVERITY_BG`, `COLORS` from `constants/colors`. Alert generation logic is client-side (`generateWeatherAlerts`).

## Languages / i18n
Uses `useLanguage().t()` with the `weatherHome.*` namespace extensively (e.g. `weatherHome.fieldMonitor`, `farmingAdvisories`, `hourlyForecast`, `7dayForecast`, `weatherAlerts`, `allClear`, `soilDashboard`, `soilTemperature`, `soilMoisture`, `moistureDry/Low/Good/Wet`, `evapotranspirationEt`, `referenceEtFao56`, `sunriseSunset`, `atmosphere`, `cropMaturityTracker`, `sunshineSolar`, `rainBreakdown`, plus alert titles/descriptions). The backend is sent `lang` and supports en, hi, mr, ta, kn, ml, te, bn, gu, pa; `fetchWeatherForCurrentLocation` validates `lang` against that set (falls back to `en`).

## Notes, edge cases & gaps
- Offline-first: cached weather renders in ~100ms; GPS coords cached 15 min, weather cached 1 hour. Stale data is flagged but still shown rather than erroring.
- Requires foreground location permission; if denied and no cache, the error/Retry view appears ("Location permission denied").
- Most sections are conditionally rendered, so a thin payload (e.g. no agriculture/GDD/sunshine data) simply omits those cards.
- The IMD alert banner can be dismissed for the session (`dismissed` resets on each `load()`); the separate "Weather alerts" section is always recomputed from `daily` + IMD and is independent of the dismiss state.
- Temperature is Celsius throughout (Indian standard). Two sections are both labeled "7" in code comments (soil + sun arc) — purely a comment numbering quirk, no functional impact.
