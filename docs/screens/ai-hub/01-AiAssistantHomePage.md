# AI Assistant Home (FarmMind AI Hub)

> **Tab:** AI Assistant (`AIAssistant` bottom tab) · **Stack:** `AINavigator` (AIStack) · **Route name:** `AIAssistantHome` · **File:** `frontend/src/screens/AI/AIAssistantHome.js`

## Purpose
This is the launcher / hub for the AI tab — the FarmMind AI home. It greets the farmer, exposes a single "Ask FarmMind" entry into AI chat, and acts as a directory of every AI-powered tool in the app (crop scan, chat, voice, market/mandi prices, soil health, my farms). It also surfaces at-a-glance widgets: the farmer's farm profile, live weather, and the AI credit balance. Used by every farmer who opens the AI tab.

## Where it sits / how you reach it
- **Reached from:** The **AI Assistant** bottom tab (`Tab.Screen name="AIAssistant"` → `AINavigator`); `AIAssistantHome` is the first/initial screen of the AI stack (`AppNavigator.js:339`).
- **Navigates to:** Many destinations, all within the same AIStack via `navigation.navigate(...)`:
  - **Ask input** → `AIChat`
  - **Quick Services row (4 icons):** Crop Scan → `CropScan`; AI Chat → `AIChat`; Market Price → `Market`; Weather → `Weather`
  - **AI Tools grid (6 cards):** Crop Disease Detection → `CropScan`; AI Chat Support → `AIChat`; Voice Chat → `VoiceChat`; My Farms → `FarmList`; Soil Health → `SoilHealth`; Mandi Bhav → `Market`
  - **Farm Profile banner edit (pencil)** → `MyFarm`
  - **History chips:** Chat history → `AIChat` (param `showHistory: true`); Voice history → `VoiceHistory`; Scan history → `ScanHistory`
  - **AI Credits card** → `AICredits`
  - **Quick Weather card** → `Weather`
- **Route params in:** none (also accepts an `embeddedInHub` prop that only adds top padding to the header when the screen is rendered inside a hub wrapper).

## How it works
On mount (`useEffect`):
1. Runs a header entrance animation (`headerAnim` timing).
2. Loads weather via `fetchWeatherForCurrentLocation({ lang: language, onCacheHit })` (cache-first so it paints instantly, then refreshes) and stores it in `wxData`. Failures are swallowed (`.catch(() => {})`).
3. Loads AI credits via `getAICredits()` into `creditInfo`; failures are swallowed.

The whole screen is a single vertical `ScrollView` wrapped in `AnimatedScreen`. Two static config arrays drive the grids: `QUICK_SERVICES` (4-col icon row) and `AI_TOOLS` (2-col card grid); labels/descriptions are resolved at render time through `t(item.labelKey)` / `t(tool.descKey)`. Tapping a service calls `handleService(item)` → `navigation.navigate(item.screen, item.params || {})`; tool cards navigate directly to `tool.screen`.

The **AI Credits card only renders when `creditInfo` is truthy** (i.e. after the credits call resolves). It shows `creditInfo.balance` (turns red when `balance <= 10`) and a usage progress bar computed as `lifetimeSpent / lifetimeEarned`. The **Quick Weather card** reads nested fields off `wxData` (temperature, condition, humidity, wind, UV, rain/storm flags) and falls back to `—` / i18n labels when data is missing. No explicit loading spinner or error UI — missing data simply renders placeholder dashes.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header (chip icon + title + subtitle) | Animated header row | `hardware-chip` icon, title `aiHome.title` ("FarmMind AI"), subtitle `aiHome.subtitle`. Slides/fades in. |
| Ask FarmMind input | Button (faux search input) | Sparkles icon + placeholder `aiHome.askPlaceholder` + mic chip. Tapping anywhere → `navigation.navigate('AIChat')`. |
| Farm Profile banner | `FarmProfileBanner` component | Horizontal scroll of farm chips (crop+age, soil, irrigation, location, land size) with a floating pencil edit button → `MyFarm`. Shows "Set your farm profile…" empty CTA when no data. |
| Quick Services grid | 4-column icon button row | `ServiceBtn` items with press-scale animation: Crop Scan→`CropScan`, AI Chat→`AIChat`, Market Price→`Market`, Weather→`Weather`. |
| "AI Tools" section header | Section title + dot + NEW badge | Title `aiHome.aiTools`; badge text `aiHome.newBadge` ("{count} New", count hard-coded `'1'`). |
| AI Tool cards | 2-column card grid (`AIToolCard`) | 6 cards, staggered fade/translate entrance + press-scale. Each: colored icon, title, description, chevron, optional corner badge. See AI_TOOLS list below. |
| Tool badge | Badge on card | "AI" (Crop Disease), "LIVE" (AI Chat Support), "NEW" (Voice Chat). NEW renders in `COLORS.cta`, others in `COLORS.greenDeep`. |
| Chat history chip | Button | `chatbubbles-outline`, label `aiHome.history.chat` → `AIChat` with `{ showHistory: true }`. |
| Voice history chip | Button | `mic-outline`, label `aiHome.history.voice` → `VoiceHistory`. |
| Scan history chip | Button | `leaf-outline`, label `aiHome.history.scan` → `ScanHistory`. |
| AI Credits card | Conditional card button | Flash icon, title `aiHome.aiCreditsTitle`, subtitle `aiHome.aiCreditsSub` (tier + today's spend), big balance number (red if ≤10), "remaining" label, and a usage bar. Tap → `AICredits`. Only shown when credits loaded. |
| Quick Weather card | Gradient card button | Location, big temperature, condition icon + label, and 4 stat pills (humidity, wind km/h, UV index, and a rain/storm/"good for sowing" status pill). Tap → `Weather`. |

**AI_TOOLS cards (in order):**

| Card | Label key | Desc key | Badge | Navigates to |
|---|---|---|---|---|
| Crop Disease Detection | `aiHome.tools.disease.label` | `aiHome.tools.disease.desc` | AI | `CropScan` |
| AI Chat Support | `aiHome.tools.chatSupport.label` | `aiHome.tools.chatSupport.desc` | LIVE | `AIChat` |
| Voice Chat | `aiHome.tools.voiceChat.label` | `aiHome.tools.voiceChat.desc` | NEW | `VoiceChat` |
| My Farms | `aiHome.tools.farms.label` | `aiHome.tools.farms.desc` | — | `FarmList` |
| Soil Health | `aiHome.tools.soil.label` | `aiHome.tools.soil.desc` | — | `SoilHealth` |
| Mandi Bhav | `aiHome.tools.mandi.label` | `aiHome.tools.mandi.desc` | — | `Market` |

> Note: the `aiHome.tools` i18n namespace also defines many more tool labels (weather, advisory, schemes_ai, voice, history, predict, msp, pest, loan, calendar, irrigation, inputs, price) — those routes (`Scheme`, `MSPTracker`, `DailyPlanner`, `FarmCalendar`, `Irrigation`, `InputCalculator`, etc.) exist in the AIStack but are **not** rendered as tiles by this screen's current `AI_TOOLS`/`QUICK_SERVICES` arrays. The hub only links to the 6 tools + 4 quick services listed above (plus history chips, credits, and weather).

## Services, APIs & data
- **API endpoints:**
  - `GET /api/v1/ai/credits` via `getAICredits()` in `services/aiApi.js` (returns `{ balance, tierLabel, monthlyAllowance, lifetimeEarned, lifetimeSpent, todaySpent, recentTransactions, costs, packs }`).
  - Weather via `fetchWeatherForCurrentLocation({ lang, onCacheHit })` in `services/weatherApi.js` (cache-first device-location forecast).
- **Backend route/service:** `backend/src/routes/ai.routes.js` (`GET /credits`) → `getCreditSummary()` in `backend/src/services/aiCredit.service.js`.
- **State / context:** `useAuth()` (AuthContext — `user` for fallback district/city in weather card), `useLanguage()` (`t`, `language`), `useFarm()` (indirectly, inside `FarmProfileBanner`). Local `useState`: `wxData`, `creditInfo`. Animated refs: `headerAnim` (header), per-item `sc`/`anim` for press + entrance animations.
- **Local / static data:** `QUICK_SERVICES` and `AI_TOOLS` config arrays (icons, colors, label/desc keys, target screens); `COLORS`/`TYPE`/`RADIUS`/`SHADOWS` from `constants/colors`.

## Languages / i18n
Uses `useLanguage()` → `t()`. Primary namespace `aiHome.*` (title, subtitle, askPlaceholder, aiTools, newBadge, quickServices.*, tools.*, pills.*, aiCreditsTitle, aiCreditsSub, remaining, storm, rain, partlyCloudy, goodForSowing, history.chat/voice/scan). The `language` value is also passed to the weather fetch so the forecast is localized. Translations are defined for English and all supported languages (`hi`/`mr` in `translations.js`, plus `bn, gu, kn, ml, pa, ta, te` in `i18n/lang/*.js`). Several `t()` calls pass an English default string (e.g. `t('aiHome.history.chat', 'Chat history')`) as a fallback.

## Notes, edge cases & gaps
- **No pull-to-refresh and no manual reload** — weather and credits load once on mount; navigating away and back does not re-fetch (the AI Credits screen itself does support refresh).
- **AI Credits card is hidden until the credits call resolves**; if `getAICredits()` fails the card never appears (failure is silently caught).
- **Weather card degrades gracefully** to `—` placeholders and falls back to `user?.district || user?.city || '—'` for location and i18n labels for condition/status when `wxData` is absent.
- The greeting/pill styles (`greetCard`, `pill`, etc.) exist in the stylesheet but a greeting card is no longer rendered in the current JSX — only the header, ask input, banner, grids, history, credits, and weather are shown.
- `newBadge` count is hard-coded to `'1'` rather than derived from the number of NEW tools.
- All navigation is intra-stack; because Market/Weather/Soil/FarmList are all registered inside `AINavigator`, tapping these tiles keeps the user on the AI tab rather than switching tabs.
