# Soil Health Hub

> **Tab:** AI Assistant · **Stack:** `AINavigator` (AIStack) · **Route name:** `SoilHealth` (and alias `SoilHub`) · **File:** `frontend/src/screens/AI/SoilHubScreen.js`

## Purpose
The cosmic entry point for everything soil. It solves the real farmer problem — most haven't tested their soil and don't know how — by leading with "Get tested" + "Find a lab" guidance, then offering the tools to scan a Soil Health Card, enter values manually, view results/history, and ask the AI advisor. If the farmer already has a saved report, the hub surfaces a one-glance summary of their latest test.

## Where it sits / how you reach it
- **Reached from:**
  - The AI Assistant home grid (`AIAssistantHome.js`) tile with `id: 'soil'` (`icon: 'flask'`) → `navigation.navigate(... screen: 'SoilHealth')`.
  - `FarmProfile/FarmDetailScreen.js` "Soil health" section → "Upload report" action navigates `AIAssistant` → `{ screen: 'SoilHealth' }` when no soil data exists.
  - Both `SoilHealth` and `SoilHub` route names render this same component (per `AppNavigator.js`).
- **Navigates to:** Six tiles plus a summary card:
  - `SoilGuide` — "Get tested" tile and the `NoReportCard`.
  - `SoilScan` — "Scan card" tile.
  - `SoilForm` — "Enter values" tile.
  - `SoilReport` — "My reports" tile, and the summary card's "View report" button (passes `{ report }`).
  - `AIChat` (via `askSoilAdvisor`) — "Ask Soil AI" tile and the summary card's "Ask AI" button.
  - External browser (via `openSoilLabFinder`) — "Find a lab" tile.
- **Route params in:** none.

## How it works
On focus (`useFocusEffect`), it calls `getSoilReports()` and stores the first item (most recent) in `latest`; failures are swallowed silently. An `alive` flag guards against setting state after unmount. If `latest` exists, a `SummaryCard` renders the field name, a pH pill (colored by `ratingColor(ratings.ph?.rating)`), and a deficiency line that counts ratings whose value is in `['low','acidic','alkaline','highly_alkaline']`. If no report exists, a `NoReportCard` prompts the farmer to learn how to get tested. Below is a 2-column tile grid built from the `TILES` array. Each tile's `onPress` either navigates or calls a helper (`askSoilAdvisor`, `openSoilLabFinder`).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Cosmic header | Header (`CosmicHeader`) | Back arrow (`navigation.goBack()`), Sprout icon badge, title "Soil Health", subtitle "Know your soil. Grow more." |
| Hero line | Text | "Healthy soil = better yield + lower fertilizer cost…" |
| Summary card (latest report) | Card | Shown when a report exists; field name + "YOUR LATEST TEST" label |
| pH pill | Badge | pH value colored by its rating; only when `report.ph != null` |
| Deficiency / healthy line | Text + Leaf icon | "{count} nutrient(s) need attention" or "Balanced — looking good" |
| "View report" | Secondary (ghost) button | Navigates `SoilReport` with `{ report }` |
| "Ask AI" | Primary (solid) button | Calls `askSoilAdvisor(navigation, report, language, t)` → `AIChat` |
| No-report prompt card | Tappable card | Shown when no report; navigates `SoilGuide` |
| "Get tested" tile | Grid tile (BookOpen) | Navigates `SoilGuide` |
| "Scan card" tile | Grid tile (ScanLine) | Navigates `SoilScan` |
| "Enter values" tile | Grid tile (ClipboardList) | Navigates `SoilForm` |
| "Ask Soil AI" tile | Grid tile (MessageSquare) | `askSoilAdvisor(navigation, latest || {}, language, t)` |
| "Find a lab" tile | Grid tile (MapPin) | `openSoilLabFinder(t)` → opens GoI lab locator URL |
| "My reports" tile | Grid tile (FlaskConical) | Navigates `SoilReport` |

## Services, APIs & data
- **API endpoints:** `GET /soil/reports` via `getSoilReports()` (`services/aiApi.js`) — list of saved reports, most-recent first.
- **Backend route/service:** `backend/src/routes/soil.routes.js` (`GET /api/v1/soil/reports`, gated by `isEnabled('soil_health')` feature flag).
- **State / context:** `useLanguage()` (`t`, `language`); local `useState` for `latest`; `useFocusEffect` + `useCallback` for the focused fetch. No writeQueue/socket.
- **Local / static data:** `TILES` array defined inline; theme tokens, `CosmicHeader`, and `ratingColor` imported from `./components/soilShared`; advisor/lab helpers from `./components/soilAdvisor` and `./components/soilLab`.

## Languages / i18n
Uses the `soilHub.*` namespace (e.g. `soilHub.title`, `soilHub.subtitle`, `soilHub.hero`, `soilHub.tiles.*`, `soilHub.summary.*`, `soilHub.noReport.*`). Every `t()` call passes an inline English fallback so it degrades gracefully before translations land. `soilHub` namespace exists in both English and Hindi in `i18n/translations.js`.

## Notes, edge cases & gaps
- The latest-report fetch is best-effort: any error is caught and ignored, so the hub falls back to the `NoReportCard` first-time state.
- The "Ask Soil AI" tile works even with no report — it passes `latest || {}`, and `buildSoilSeedMessage` produces a "not tested yet" seed message.
- `SoilHealthScreen.js` (a separate, older manual-entry-and-tabs screen) is NOT wired into `AppNavigator`; the `SoilHealth` route resolves to this hub instead. See `soil-health.md` for that orphaned screen.
- Deficiency count uses a hardcoded list of "bad" ratings and ignores `medium`/`slightly_*` (treated as fine for the summary line).
