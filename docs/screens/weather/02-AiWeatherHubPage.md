# AI / Weather Hub

> **Tab:** AI Assistant · **Stack:** AIStack (component) · **Route name:** `AIWeatherHub` (not registered as a stack route — see notes) · **File:** `frontend/src/screens/AI/AIWeatherHub.js`

## Purpose
A container screen that unifies the AI Assistant and the Weather dashboard behind a single animated pill switcher, so the farmer can flip between "AI" and "Weather" without leaving the page. It renders both child screens (`AIAssistantHome` and `WeatherHome`) embedded, toggling visibility instead of unmounting, which keeps each tab's scroll position and loaded data alive.

## Where it sits / how you reach it
- **Reached from:** It is the hub wrapper for the AI tab. It imports and embeds `AIAssistantHome` and `WeatherHome`, passing them `embeddedInHub` so they hide their own standalone headers. (Note: in the current `AppNavigator.js`, the AI tab registers `AIAssistantHome` and `Weather`/`WeatherHome` as separate routes directly; `AIWeatherHub` is the combined-view component rather than a registered stack route — see gaps.)
- **Navigates to:** Passes `navigation` down to both children, so any navigation (chat, scan, crop calendar, etc.) is triggered from within the embedded screens, not from the hub chrome itself. The hub's only interaction is the AI/Weather tab switch.
- **Route params in:** none (receives `navigation` prop).

## How it works
- Local state `tab` (`'ai'` | `'weather'`) controls which embedded screen is visible. `switchTab` ignores re-taps of the active tab, sets `tab`, and runs an `Animated.spring` on `slideAnim` (0 for AI, 1 for Weather).
- `slideAnim` interpolates into `pillTranslate` (`0 → PILL_W`) to slide the highlight pill under the active tab. The pill background and the accent underline color animate between green (`COLORS.primary`, AI) and blue (`COLORS.blue`, Weather).
- Both children are always mounted inside `S.content`; visibility is toggled with `display: 'flex' | 'none'` (`isAI` / `isWeather`). This preserves state across switches (no refetch on toggle).
- Pure presentational container — no data fetching, loading, or error handling of its own; those live in the embedded `AIAssistantHome` and `WeatherHome`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Brand row | Header label | Centered brand text (`aiHub.brand`) flanked by two dots. |
| Pill switcher track | Segmented control | Rounded track containing the sliding highlight pill + two tab buttons. |
| Sliding pill | Animated highlight | Slides under the active tab; color = green (AI) / blue (Weather). |
| AI tab button | Tab button | Sparkles icon + `aiHub.tabAI`; `switchTab('ai')`. |
| Weather tab button | Tab button | Partly-sunny icon + `aiHub.tabWeather`; `switchTab('weather')`. |
| Accent underline | Animated bar | Short underline whose color tracks the active tab. |
| AI content pane | Embedded screen | `AIAssistantHome` (embedded), visible when `tab === 'ai'`. |
| Weather content pane | Embedded screen | `WeatherHome` (embedded), visible when `tab === 'weather'`. |

## Services, APIs & data
- **API endpoints:** none directly. Data/API work is delegated to the embedded children — `WeatherHome` calls `GET /weather` via `services/weatherApi.js`; `AIAssistantHome` uses the AI services.
- **Backend route/service:** indirectly `backend/src/routes/weather.routes.js` (via `WeatherHome`).
- **State / context:** `useLanguage()` for `t()`; `useSafeAreaInsets()` for top padding; local `useState` (`tab`) and an `Animated` ref (`slideAnim`).
- **Local / static data:** `COLORS` from `constants/colors`; layout constants (`W`, `TRACK_INNER_PAD`, derived `PILL_W`). Both child components are imported directly: `AIAssistantHome`, `WeatherHome`.

## Languages / i18n
Uses `useLanguage().t()` with the `aiHub.*` namespace: `aiHub.brand`, `aiHub.tabAI`, `aiHub.tabWeather`. The embedded screens carry their own namespaces (`weatherHome.*`, AI namespaces). App language from LanguageContext (en/hi/mr/ta/kn/ml/te/bn/gu/pa).

## Notes, edge cases & gaps
- The advisory/forecast "cards" surfaced in the Weather pill are entirely those of the embedded `WeatherHome` (hero, advisories, hourly/daily forecast, alerts, soil dashboard, atmosphere grid, GDD, sunshine, rain breakdown) — the hub itself adds no weather cards, only the switcher chrome.
- Because both children stay mounted (`display` toggling), switching tabs is instant and preserves scroll/state, at the cost of both screens loading on first render.
- `embeddedInHub` is passed to both children so they suppress their standalone headers; `WeatherHome` explicitly checks this to hide its back/refresh header.
- The component is not wired into `AppNavigator.js` as a route in the current code (the AI stack registers `AIAssistantHome` and `Weather` separately); treat `AIWeatherHub` as an available combined-view wrapper. Status bar is set to dark content with a transparent translucent background.
