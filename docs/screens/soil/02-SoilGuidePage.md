# Get Your Soil Tested (Soil Guide)

> **Tab:** AI Assistant · **Stack:** `AINavigator` (AIStack) · **Route name:** `SoilGuide` · **File:** `frontend/src/screens/AI/SoilGuideScreen.js`

## Purpose
The "how to get your soil tested" explainer under the government Soil Health Card scheme. It answers the core farmer problem — they don't know HOW to get tested — with plain-language steps (who to approach, cost, documents, timeline), a correct sample-collection do/avoid guide, and a one-tap "find a lab" CTA. It is purely static informational content (no API calls); all copy is i18n with English fallbacks so it degrades gracefully.

## Where it sits / how you reach it
- **Reached from:**
  - `SoilHubScreen` "Get tested" tile → `navigation.navigate('SoilGuide')`.
  - `SoilHubScreen` `NoReportCard` (first-time prompt) → `navigation.navigate('SoilGuide')`.
- **Navigates to:**
  - External browser via `openSoilLabFinder(t)` — "Find a soil testing lab near me" button and the GoI locator.
  - `SoilScan` via the "I have a card →" button.
  - `SoilForm` via the "Enter values" button.
  - Header back → `goBack()`.
- **Route params in:** none.

## How it works
Stateless apart from the language context. All content is built inline from the `t()` function: a `steps` array (4 numbered steps), a `facts` array (cost / documents / time / re-test), and `dos` / `donts` arrays for sample collection. It renders a scrollable column of static sections. The only behavior is button navigation and opening the external lab locator. No loading, no errors, no network calls.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Cosmic header | Header (`CosmicHeader`) | Back arrow, BookOpen icon, title "Get your soil tested", subtitle "Govt Soil Health Card scheme" |
| "Why" card | Info card (Sprout) | Explains the value of a soil test |
| Quick facts grid | 4 fact cards | Cost (~₹40, often free), Documents (Aadhaar, land record, mobile), Time (~30 days), Re-test (every 2–3 years) |
| "HOW TO GET TESTED" steps | 4 numbered step rows | 1 Reach out, 2 Give a soil sample, 3 Lab testing (12 parameters), 4 Get your card |
| "Find a soil testing lab near me" | Primary button (MapPin) | `openSoilLabFinder(t)` → opens GoI lab locator URL in browser |
| "HOW TO COLLECT A SAMPLE" — Do card | Card (ClipboardList) | 5 do items with Check icons (sampling depth, W pattern, ½ kg, shade-dry, label) |
| Avoid card | Card (X icon) | 3 avoid items (bunds/edges, just-fertilized spots, compost/waterlogged) |
| "I have a card →" | Secondary (ghost) button | `navigation.navigate('SoilScan')` |
| "Enter values" | Primary (solid) button | `navigation.navigate('SoilForm')` |

## Services, APIs & data
- **API endpoints:** none — fully static/local content.
- **Backend route/service:** none. The "find a lab" CTA deep-links to the National Government Services Portal locator (`SOIL_LAB_LOCATOR_URL` = `https://services.india.gov.in/service/detail/locate-soil-testing-laboratory`) via `openSoilLabFinder` in `./components/soilLab` (`Linking.openURL`, with an Alert fallback if it can't open).
- **State / context:** `useLanguage()` (`t`); `useSafeAreaInsets`. No local state, no writeQueue/socket.
- **Local / static data:** `steps`, `facts`, `dos`, `donts` arrays built inline from `t()`; theme tokens + `CosmicHeader` from `./components/soilShared`; `openSoilLabFinder` from `./components/soilLab`.

## Languages / i18n
Uses the `soilHub.guide.*` namespace (e.g. `soilHub.guide.title`, `soilHub.guide.s1t`–`s4d` steps, `soilHub.guide.cost`/`costV` and other facts, `soilHub.guide.do1`–`do5`, `soilHub.guide.dont1`–`dont3`, `soilHub.guide.findLab`, `soilHub.guide.haveCard`, `soilHub.guide.enterValues`), plus `soilHub.lab.*` for the lab-finder Alert fallback. Every `t()` call carries an inline English fallback.

## Notes, edge cases & gaps
- No loading/error/empty states — content is entirely client-side static copy.
- The lab finder has no public API, so it deep-links the authoritative GoI locator; if the device can't open the URL, an Alert directs the farmer to the nearest Block Agriculture Office or KVK.
- Acts as the funnel hub for first-time users: from here they branch to scan a card, enter values, or find a lab.
