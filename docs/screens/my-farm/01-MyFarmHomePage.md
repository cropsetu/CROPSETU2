# My Farm Home (Dashboard)

> **Tab:** My Farm · **Stack:** `MyFarmStack` (also re-registered in `AIStack` for deep-linking) · **Route name:** `MyFarmHome` · **File:** [MyFarmHomeScreen.js](../../../frontend/src/screens/FarmProfile/MyFarmHomeScreen.js)

## Purpose
The home screen of the My Farm tab — the farmer's daily "kheti dashboard." It opens straight onto the **active farm**, greets the farmer by name, and answers the three questions a farmer actually has each morning: *which plot am I looking at*, *what is growing right now and at what stage*, and *what should I do today*. From here the farmer can log the day's work in one tap (irrigation, fertilizer, spray, scouting, harvest), see their most recent activity diary, glance at every active crop cycle on an 8-stage growth timeline, read tailored **FarmMind** AI advisories, and jump across all their farms (plots). It is the launch pad for most of the crop-cycle workflow: the guided pre-seeding **Crop Plan** and the per-activity loggers start here. The **Growth Story** filmstrip is shipped but is reached one level deeper — from the cycle's detail screen, not from this dashboard.

This screen already renders in the **KhetAI / Login** design system: warm green-white canvas, **Fraunces** serif for the farmer's name and the hero farm name, **Plus Jakarta Sans** body, deep forest-green (`#005F21`) primary, and **gold (`#E0AF3B`)** accent. The `cosmicTheme.js` token *values* have been remapped to KhetAI (forest green primary, gold accent, Plus Jakarta + Fraunces families) while keeping the `COSMIC`/`CT`/`GLOW` symbol names, so every MyFarm screen that imports them already looks forest-green/gold — not the old blue/amber/Inter look. The remaining cosmetic work is per-screen *layout chrome* (Login-style serif section headers, 56px gradient icon-square headers) on some screens, not a colour/font swap.

## Where it sits / how you reach it
- **Reached from:**
  - The bottom **My Farm** tab — this is the tab's home (`MyFarmHome` in `MyFarmStack`, registered in [AppNavigator.js](../../../frontend/src/navigation/AppNavigator.js) line 419).
  - Deep link `app://farm` (the `MyFarm.MyFarmHome` entry in [linking.js](../../../frontend/src/navigation/linking.js) line 50).
  - The back-stack of any My Farm sub-screen (`FarmList`, `FarmDetail`, `CropCycleDetail`, the activity loggers, `GrowthStory`).
- **Navigates to:**
  - `FarmList` — via "Switch" pill on the hero (only when >1 farm), the "View all N farms" footer, and the empty/`null`-farm activity tap fallback.
  - `FarmDetail` (`{ farmId: activeFarmId }`) — tapping the hero card, "See all" on Recent activity, and "View all" on Active crops.
  - `FarmAddEdit` — the no-farms empty state ("Add your first farm"), and as the fallback when an activity is tapped with no active farm.
  - `CropCycleCreate` (`{ farmId: activeFarmId }`) — the **Crop Plan** guided wizard, via "Start a crop cycle" in the Active-crops section.
  - `CropCycleDetail` (`{ cycleId }`) — tapping any cycle card or any recent-activity row.
  - `ActivityIrrigationLog` (`{ farmId, cycleId }`) — the Water quick-log chip routes straight to the irrigation logger.
  - `ActivityTypePicker` (`{ farmId, cycleId }`) — every other quick-log chip and the "More" chip open the 12-tile picker.
  - `AIAssistant` → `AIChat` (`{ seed }`) — the "Why this?" button and an insight's action link round-trip into FarmMind chat.
  - `GrowthStory` (`{ cycleId, cycle }`) — **not** reached from this screen. The shipped Growth Story is opened by the "Growth story" button on `CropCycleDetailScreen`, so the home dashboard has no direct entry point to it yet (see Gaps). The `GrowthStory` route is registered in both `MyFarmStack` and `AIStack`.
- **Route params in:** none — the active farm is read from `MultiFarmContext`, not passed in.

## How it works
On every screen **focus** (`useFocusEffect`) the screen calls `loadAll()`, so a cycle created in the Crop Plan or an activity just logged appears without a manual pull-to-refresh. `loadAll()` is guarded: if there is no `user.id` or no `activeFarmId` it clears state and returns (a stale `activeFarmId` during a logout/login transition was firing authenticated `/farms/:id/cycles` calls with no token → 401). Otherwise it runs two requests in parallel with `Promise.allSettled` so one failure never blanks the other:
- `listCropCycles(activeFarmId, { status: 'ACTIVE' })` → the active crop cycles.
- `getFarmInsights(activeFarmId, { limit: 3 })` → the FarmMind advisories.

The **active farm**, the full `farms` list, `syncing`, `hasFarms` and `loading` come from `useMultiFarm()`. The greeting (`greetingFor(hour)`) is time-of-day aware ("Good morning / afternoon / evening / night", and "Still working?" before 5 am). The farmer's display name prefers `preferredName`, then the first word of `fullName`, else "Farmer".

**Recent activity** is derived client-side by `buildRecentActivities(cycles)`: it walks each cycle's JSON log arrays (`irrigationLogs`, `fertilizersUsed`, `pesticidesUsed`, `observedEvents`) taking the last 3 of each, plus harvest (`actualHarvestDate`) and sale (`saleDate`) milestones, builds a normalized `{ type, title, subtitle, occurredAt, cycleId }` row, then sorts newest-first. `pickDate()` tries many timestamp field names and falls back to the cycle's `updatedAt`/`createdAt` so a dateless entry never disappears. **Streak** (`computeStreak`) counts consecutive days (ending today or yesterday) that have at least one activity — shown as a gold `StreakBadge`.

**Sync state** merges two sources: a failed or in-flight offline write (`useSyncStatus()` from the write queue) wins over the background farm-list refresh (`syncing`), collapsing to one of `offline` / `error` / `syncing` / `synced` shown in the `SyncBadge`.

**Empty/branch states:** if the farmer has no farms (`!hasFarms && !syncing && !loading`) the whole body is replaced by the `EmptyState` ("Set up your farm" → Add your first farm). With a farm but no active cycle, the Active-crops section shows a "Start a crop cycle" prompt + `GlowButton`. With no logged work, Recent activity shows the `EmptyFeed` ("Your farm diary starts here"). With no insights yet, AI insights shows a FarmMind nudge.

**Layout order (top → bottom):** greeting row + sync badge → active-farm hero card → "Log today" quick-log chip rail → "Recent activity" feed → "Active crops" cycle cards → "AI insights · FarmMind" → "View all N farms" footer. A `CelebrationSheet` overlay is mounted for milestone moments (e.g. harvest), triggered via `setCelebrate`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Greeting | Text (Fraunces) | Time-of-day greeting + farmer's first name; name in Fraunces serif (`farmer` style). |
| Sync badge | Badge (`SyncBadge`, compact) | Shows synced / syncing / offline / error from the merged write-queue + refresh state. |
| Active-farm hero | Pressable card (`GlassCard`, bordered) | Opens `FarmDetail`. Holds the farm name, location, streak and KPI row. |
| "ACTIVE FARM" label | Caption | Forest-green uppercase tracked label at the top of the hero. |
| Farm name | Text (Fraunces, 24px) | Active farm name (`farmName`/`farmAlias`/`Farm N`); falls back to "Add your farm". |
| Location line | Text + location icon | Village · taluka · district of the active farm (when present). |
| "Switch" pill | Pressable pill | Only when `farms.length > 1` → navigates `FarmList` to change the active farm. |
| Streak badge | Badge (`StreakBadge`, gold) | Consecutive-days-logged streak; hidden when 0. Gold accent. |
| KPI row | 3-stat strip | `acres` (active farm `landSizeAcres`, 2-dp), `crops` (active cycle count), `farms` (total plots), divided by hairlines. Big numbers in bold sans (Fraunces in the redesign). |
| "Log today" section label | Section header | Heading for the quick-log rail. |
| Quick-log chip rail | Horizontal scroll of `ActivityChip` | Five tap-to-log chips: **Water** (IRRIGATION → `ActivityIrrigationLog`), **Fertilize** (FERTILIZER), **Spray** (SPRAY), **Scout** (SCOUT), **Harvest** (HARVEST). Each chip uses its semantic activity color. |
| "More" chip | Pressable chip (grid icon) | Opens the full 12-tile `ActivityTypePicker`. |
| "Recent activity" section label | Section header + action | "See all" → `FarmDetail` (shown only when activity exists). |
| Recent-activity feed | Card list (`ActivityFeedItem`) | Up to 5 newest entries (icon-colored by type, title, subtitle, relative time, thumbnails); each row → `CropCycleDetail` for its cycle. Hairline dividers between rows. |
| Empty feed | Empty state (`EmptyFeed`) | "Your farm diary starts here" + "Pick an activity" `GlowButton` (→ `ActivityTypePicker`). |
| "Active crops" section label | Section header + action | "Start a cycle" (no cycles) → `CropCycleCreate`, or "View all" (has cycles) → `FarmDetail`. |
| Cycle card | Pressable card (`CycleCard`) | Per active cycle: `CropIcon`, crop name + variety, area + season, **`StageTimelineBar`** (8 stages, Day-N-after-sowing), and spent/earned money pills. Up to 3 shown. → `CropCycleDetail`. |
| Stage timeline | Component (`StageTimelineBar`) | 8-segment phenology spine: PLANNING · LAND_PREP · SOWING · VEGETATIVE · FLOWERING · FRUITING · MATURITY · HARVESTED (displayed as Plan · Prep · Sow · Grow · Flower · Fruit · Mature · Harvest); current stage filled+glow; shows "Day N after sowing" (DAS) only when `sowingDate` is set. The `FRUITING` enum label is horticulture wording — for non-fruit crops it reads better per category as "Grain filling" (cereals), "Pod development" (pulses/oilseeds), "Boll development" (cotton) or "Fruit set/development" (veg/fruit); the spine currently shows one generic "Fruit" label for all crops. |
| Money pills | Badges (`MoneyPill`) | "spent" (`totalInputCostInr`, red) and "earned" (`grossIncomeInr`, green), `₹` + `k` formatting; shown only when non-zero. |
| Start-a-cycle prompt | Card + `GlowButton` | Shown when farm exists but no active cycle → "Start a crop cycle" (`CropCycleCreate`). |
| "AI insights · FarmMind" section label | Section header + badge | Forest-green "FarmMind" pill badge. |
| Insight card | Card (`InsightCard`) | Severity dot (low/moderate/high/critical), title, body; footer "Why this?" (`WhyThisButton` → `AIChat` seeded) + optional action link. Up to 3. |
| AI insights empty | Card + AI bubble | Nudge: "Log a few activities and FarmMind will tailor advice…". |
| "View all N farms" footer | Pressable bar | Only when `farms.length > 1` → `FarmList`. |
| Celebration sheet | Modal overlay (`CelebrationSheet`) | Milestone celebration (title/subtitle/streak); *(redesigned)* can deep-link to the Growth Story closing card. |
| Empty state (no farms) | Full-screen (`EmptyState`) | Leaf bubble + "Set up your farm" + "Add your first farm" `GlowButton` (→ `FarmAddEdit`). |
| Pull-to-refresh | `ScrollView` (`CosmicScreen`) | `onRefresh` re-runs `refresh()` + `loadAll()`. |

## Services, APIs & data
- **API endpoints** (via [farmApi.js](../../../frontend/src/services/farmApi.js)):
  - `listCropCycles(farmId, { status: 'ACTIVE' })` → `GET /farms/:id/cycles?status=ACTIVE`.
  - `getFarmInsights(farmId, { limit: 3 })` → `GET /farms/:id/insights?limit=3` — the FarmMind advisories.
- **Crop-cycle data model:** each cycle is a `FarmCropCycle` ([schema.prisma](../../../backend/prisma/schema.prisma)) — `cropName`/`variety`/`season`, `growthStage` (the 8-stage enum), `sowingDate` (drives DAS), JSON log arrays (`irrigationLogs[]`, `fertilizersUsed[]`, `pesticidesUsed[]`, `observedEvents[]`, `activities[]`, …), and financial roll-ups (`totalInputCostInr`, `grossIncomeInr`) computed by `computeFinancials()` in [cropCycle.service.js](../../../backend/src/services/cropCycle.service.js).
- **DAS (Days After Sowing):** `sowingDate ? max(0, floor((now − sowingDate)/86400000)) : null` — the timeline spine reused on the cycle card, the detail screen and Growth Story. `sowingDate` is stamped by `SowingLogScreen` (which calls `farmApi.updateCropCycle(cycleId, { sowingDate: now })` right after advancing to `SOWING`), so DAS is `null` until the farmer logs sowing. DAS-to-stage bands are crop- and sowing-date-sensitive (late sowing compresses the calendar), so stage labels should map off a per-crop DAS table rather than a single hard-coded band. For reference, generic wheat runs roughly: tillering/VEGETATIVE ~0–60 DAS, jointing–booting ~60–80, FLOWERING (anthesis) ~80–100, grain-fill ~100–125, MATURITY ~125–140.
- **State / context:** `useMultiFarm()` (`farms`, `activeFarm`, `activeFarmId`, `refresh`, `syncing`, `hasFarms`, `loading`), `useAuth()` (`user`), `useLanguage()` (`t`), `useSyncStatus()` (write-queue status), `useSafeAreaInsets()`. Local `useState` for `cycles`, `insights`, `loadingDetail`, `celebrate`.
- **Derived client-side (no API):** the recent-activity feed (`buildRecentActivities`), the streak (`computeStreak`), and the sync status merge — all computed from already-loaded cycles.
- **Theme / UI kit:** tokens from [cosmicTheme.js](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js) (`COSMIC`, `GLOW`, `CR`, `CS`, `CT`), components from [ui/](../../../frontend/src/screens/FarmProfile/ui/) — `CosmicScreen`, `GlassCard`, `GlowButton`, `ActivityChip`, `StreakBadge`, `SyncBadge`, `CelebrationSheet`, `ActivityFeedItem`, [StageTimelineBar.js](../../../frontend/src/screens/FarmProfile/ui/StageTimelineBar.js), `WhyThisButton`. The design system mirrors [LoginScreen.js](../../../frontend/src/screens/Auth/LoginScreen.js) / [khetTheme.js](../../../frontend/src/constants/khetTheme.js).

## Languages / i18n
- The My Farm tab's strings live under two namespaces in [translations.js](../../../frontend/src/i18n/translations.js): the legacy `myFarm.*` block (e.g. `myFarm.tabLabel`, `myFarm.activeFarm`, `myFarm.switchFarm`, `myFarm.activeCrops.*`, `myFarm.soil.*`, `myFarm.weather.*`) and the **redesign `myFarm.v2.*`** namespace used by the re-themed activity meta (`myFarm.v2.activity.irrigation`, `.fertilizer`, `.spray`, `.scout`, `.harvest`, … per [cosmicTheme.js](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js)).
- English, Hindi (हिन्दी) and Marathi (मराठी) all carry a `myFarm` block in `translations.js`.
- The cycle record has localized crop-name columns (`cropNameMr`/`cropNameHi`) in the schema, but no screen currently writes or reads them — this dashboard shows the raw `cropName` regardless of UI language.

## Notes, edge cases & gaps
- **Quick-log shortcut for irrigation only.** Of the five quick-log chips, only **Water** deep-links straight to its logger (`ActivityIrrigationLog`); Fertilize / Spray / Scout / Harvest all open the 12-tile `ActivityTypePicker` first, even though Fertilizer/Spray/Harvest ultimately resolve to **inline modals** on `CropCycleDetail` (not pushed screens — see `08-ActivityLoggers.md`). Tapping a quick-log with no active farm falls back to `FarmAddEdit`.
- **`activeCycleId` is just `cycles[0].id`.** The quick-log chips always attach the first active cycle. With multiple active cycles on one plot, the farmer cannot pick *which* cycle a quick log applies to from this screen — they must go via the cycle card → `CropCycleDetail`.
- **Recent activity is reconstructed, not a real feed.** It only takes the last 3 of each log array per cycle, so older history and some activity types (land prep, weeding, pruning, expense/income/labour) are not surfaced on the dashboard; the canonical, complete feed lives on `CropCycleDetail`, and the photo timeline lives on the shipped **Growth Story** (`09-GrowthStoryPage.md`).
- **Streak is local & date-string based** (`toDateString()`), so it follows the device clock/timezone, not a server-authoritative streak.
- **Stale header comment only.** The in-file doc comment at the top of the screen still calls this a "minimalist light theme … 15px body" — that comment is out of date. The screen itself already ships the KhetAI look: the greeting name and hero farm name use `Fraunces_700Bold`, body text uses `PlusJakartaSans_*`, and every colour comes from the remapped `COSMIC` tokens (forest-green primary, gold accent). Only the comment string is wrong, not the rendered styling.
- **No home entry point to Growth Story.** `GrowthStoryScreen` is built and the `GrowthStory` route is registered in both `MyFarmStack` and `AIStack`, but this dashboard never navigates to it. The only shipped way in is the "Growth story" button on `CropCycleDetailScreen` (`navigation.navigate('GrowthStory', { cycleId, cycle })`). A direct CTA from the hero or each cycle card — and the `CelebrationSheet → Growth Story` deep-link — would still be net-new work.
- **Guided pre-seeding Crop Plan is wired.** "Start a crop cycle" pushes `CropCycleCreate`, which is the redesigned single-ScrollView "Crop Plan" form (crop picker, season, area, variety + Hybrid/Desi + Organic, previous-crop/rotation, field-prep multi-select, water source, seed brand/source/rate/treatment/cost). On submit it `navigation.replace('CropCycleDetail', { cycleId })`. See `05-CropCyclePlanPage.md`.
- **Quick-log rail is intentionally a 5-chip shortlist.** The home rail (`QUICK_LOG_TYPES`) shows 5 chips + a "More" chip on purpose; the full 12-tile set lives behind `ActivityTypePicker` (and on `CropCycleDetail`). This is the shipped design, not a gap.
- **FarmMind dependency:** if `GET /farms/:id/insights` is unimplemented or returns empty, the AI insights section silently degrades to the "log a few activities" nudge (`Promise.allSettled` swallows the rejection).
- **Schema-only fields not captured here.** Several `FarmCropCycle` columns are never written by any screen and so never surface on this dashboard: `seedReceiptUrl`, `expectedHarvestDate`, `cropCategory`, `cropNameMr`/`cropNameHi`, `seedCostPerKgInr`, `seedPurchaseDate`. Area is acres-only (no bigha/hectare entry; bigha is region-variable and would need a state-aware conversion).
