# Farm List

> **Tab:** My Farm · **Stack:** `MyFarmStack` (also re-registered in `AIStack` for deep-linking) · **Route name:** `FarmList` · **File:** [FarmListScreen.js](../../../frontend/src/screens/FarmProfile/FarmListScreen.js)

## Purpose
Shows every **farm (plot)** the user owns as a compact list of white cards. From here a farmer can open a plot's detail, **switch which plot is "active"** (the one the rest of My Farm and the AI advisory tune to), **edit** or **delete** a plot, and **add a new farm**. In CropSetu a "farm" is a single land parcel with its own location, size, soil and irrigation — a farmer with three scattered plots keeps three farms here and flips the active one as the season moves between them. This screen is the roster; the season work happens inside each plot's [Farm Detail](03-FarmDetailPage.md) and its crop cycles.

## Where it sits / how you reach it
- **Reached from:**
  - [My Farm Home](01-MyFarmHomePage.md) dashboard → "Manage farms" / farm switcher (`navigation.navigate('FarmList')`).
  - The My Farm tab's stack header / drill-downs that need the full plot roster.
- **Navigates to:**
  - Card tap → `FarmDetail` with `{ farmId: farm.id }` (`goDetail`).
  - Long-press menu "Edit" → `FarmAddEdit` with `{ farm }` (`goEdit`) — see [Farm Add / Edit](04-FarmAddEditPage.md).
  - FAB (+) and empty-state "Add a farm" → `FarmAddEdit` with no params (`goAdd`) — create flow.
- **Route params in:** none.

## How it works
The screen is a thin view over **`MultiFarmContext`** ([MultiFarmContext.js](../../../frontend/src/context/MultiFarmContext.js)) — it reads `farms`, `activeFarmId`, `syncing` and the actions `switchActiveFarm`, `refresh`, `removeFarm` via `useMultiFarm()`. There is no local list state; the context owns the roster, caches it to **encrypted secure storage** (Keychain/Keystore, never plaintext) for offline, and reconciles with the server on `refresh()`.

A `FlatList` renders one `GlassCard` per farm. Each card shows:
- a **soil-colour stripe** down the left edge (mapped from `farm.soilType` via the local `SOIL_COLORS` table — black cotton, red, alluvial, sandy, clay loam, sandy loam, laterite, unknown);
- the **name** (`farmName` → `farmAlias` → `Farm {farmNumber}` fallback);
- an **"Active" star badge** when `farm.id === activeFarmId`, which also switches the card to the `bordered` `GlassCard` variant;
- a **location line** (`village, taluka, district`, filtering blanks) when any is present;
- **tag pills**: land size in acres, soil type (humanised, capitalised), irrigation system, and a crop-count pill (`farm._count.cropCycles`, "1 crop" / "N crops") when > 0;
- a forward chevron.

**Switching the active farm** is a **long-press** affordance, not a tap. Long-press fires `Haptics.medium()` and opens an `Alert.alert` action sheet titled with the farm name, offering **Set active** (→ `switchActiveFarm(farm.id)` + success haptic), **Edit** (→ `goEdit`), **Delete** (destructive), and **Cancel**. Choosing Delete opens a **second confirmation Alert** ("Delete farm? / This cannot be undone.") before calling `removeFarm(farm.id)`. The header subtitle hints this ("long-press to edit").

`switchActiveFarm` updates `activeFarmId` **optimistically in local state first**, then persists the choice server-side via `farmApi.setActiveFarm(id)` (failure is swallowed — the local switch still stands). `removeFarm` removes the row optimistically, re-points the active farm to the next plot if the deleted one was active, and **rolls back** on server failure; the write goes through the offline `writeQueue` so a delete made offline retries on reconnect.

**Pull-to-refresh** is wired to the context: `onRefresh={refresh}` and `refreshing={syncing}`, so the spinner reflects the real sync state. When `farms` is empty, `ListEmptyComponent` shows a leaf bubble, "No farms yet" copy, and a `GlowButton` "Add a farm". A circular gradient **FAB** sits bottom-right (offset by safe-area inset) and also routes to `FarmAddEdit`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header | `CosmicHeader` | Title "My farms"; subtitle "{N} farm(s) · long-press to edit" when any exist |
| Farm list | `FlatList` | One card per `farm`; `keyExtractor` = `farm.id`; pull-to-refresh |
| Farm card | `Pressable` + `GlassCard` | Tap → `FarmDetail`; long-press → action menu; `bordered` variant when active |
| Soil stripe | `View` | 4px left stripe coloured by `SOIL_COLORS[farm.soilType]` (fallback grey "UNKNOWN") |
| Farm name | `Text` | `farmName` → `farmAlias` → `Farm {farmNumber}`, single line |
| Active badge | `View` + star icon | "Active" pill shown when `farm.id === activeFarmId` |
| Location line | `Text` | `village, taluka, district` (blanks filtered), single line |
| Size tag | `Tag` pill | `{landSizeAcres} ac` when > 0 |
| Soil tag | `Tag` pill | Humanised soil type, capitalised, stripe colour |
| Irrigation tag | `Tag` pill | `irrigationSystem` lowercased, INFO blue |
| Crop-count tag | `Tag` pill | `{N} crop(s)` from `farm._count.cropCycles` when > 0 |
| Chevron | `Ionicons` | Forward affordance |
| Long-press menu | `Alert.alert` | Set active / Edit / Delete / Cancel |
| Delete confirm | `Alert.alert` | Second "Delete farm? — cannot be undone" gate → `removeFarm` |
| Empty state | `View` | Leaf bubble + "No farms yet" + `GlowButton` "Add a farm" |
| Add FAB (+) | `Pressable` + `LinearGradient` | Gradient floating button (safe-area offset); medium haptic; → `FarmAddEdit` |
| Pull-to-refresh | `RefreshControl` (via `FlatList`) | `onRefresh=refresh`, `refreshing=syncing` |

## Services, APIs & data
- **State / context:** `useMultiFarm()` from [MultiFarmContext.js](../../../frontend/src/context/MultiFarmContext.js) — exposes `farms`, `activeFarmId`, `switchActiveFarm`, `refresh`, `syncing`, `removeFarm`. The context caches farms to encrypted secure storage (`fe_farms_v1`) and routes writes through `services/writeQueue` (`withWrite`) for offline retry.
- **API (via the context, not called directly here):**
  - `farmApi.listFarms()` — roster fetch on `refresh()`.
  - `farmApi.setActiveFarm(id)` — persists the active-plot choice (`switchActiveFarm`).
  - `farmApi.deleteFarm(id)` — plot delete (`removeFarm`).
  - Source: [farmApi.js](../../../frontend/src/services/farmApi.js); backend model `FarmCropCycle`/farm rows in [schema.prisma](../../../backend/prisma/schema.prisma).
- **Farm fields read per card:** `id`, `farmName`/`farmAlias`/`farmNumber`, `village`/`taluka`/`district`, `landSizeAcres`, `soilType`, `irrigationSystem`, `_count.cropCycles`.
- **Theme / kit:** `CosmicScreen`, `CosmicHeader`, `GlassCard`, `GlowButton` from `FarmProfile/ui/`; tokens `COSMIC`, `CR`, `CS`, `GLOW`, `GRADIENT` from [cosmicTheme.js](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js); `Haptics` from `utils/haptics`.

## Languages / i18n
- Translated via `useLanguage().t` ([LanguageContext](../../../frontend/src/context/LanguageContext.js)). Keys used: `farmProfile.myFarms`, `farmProfile.setActive`, `farmProfile.deleteTitle`, `farmProfile.deleteConfirm`, and the shared keys `edit`, `delete`, `cancel`. Each has an inline English fallback (e.g. `t('farmProfile.setActive') || 'Set active'`).
- **Not yet localised (hard-coded English):** the header subtitle (`"{N} farms · long-press to edit"`), the per-card tags ("ac", "crop"/"crops"), the "Active" badge, and the entire empty state ("No farms yet", the FarmMind copy, "Add a farm"). Per the redesign these should move under the **`myFarm.v2.*`** namespace alongside the other My Farm strings.

## Notes, edge cases & gaps
- **"Active farm" is a global, persisted singleton.** Switching here re-points the dashboard, crop cycles and AI advisory for the whole tab. The switch is local-first and best-effort server-side, so it works offline and never blocks on the network.
- **Switch is discoverable only via long-press** + Alert action sheet — there is no inline "Set active" button on the card. On the active card, "Set active" is still offered (a no-op re-select). Consider surfacing an inline toggle in the redesign.
- **Delete is double-gated** (action sheet → confirm Alert) and optimistic with rollback; if the deleted plot was active, the context auto-promotes the first remaining plot to active.
- **Empty state vs. loading:** the `FlatList` shows the empty state immediately while the cached roster is hydrating; there is no skeleton/spinner for the initial cached read (the context's `loading` flag is not consumed here). A brief flash of "No farms yet" is possible before the cache resolves.
- **No search / sort / grouping.** Farms render in server order; there is no filter by season, district or active-cycle status — fine for a handful of plots, weak for a farmer with many parcels.
- **KhetAI re-theme — tokens already remapped; per-screen chrome still pending.** The `cosmicTheme.js` token **values** are already on the KhetAI system (`PRIMARY` forest-green `#005F21`, `ACCENT` gold `#E0AF3B`, forest-tinted text, white KhetAI surfaces, soft green `GLOW`, Plus Jakarta Sans body via `PlusJakartaSans_*`), so this screen already renders forest-green/gold + Plus Jakarta — **not** the old blue/amber/Inter look. What remains is per-screen **layout chrome**: the header is still the plain `CosmicHeader` (no Login-style big **Fraunces** serif title with an italic coloured second line over `CosmicScreen`'s `GRADIENT.surface`, no 56px gradient icon-square), and the active card is still a `bordered` `GlassCard` rather than a hero (crop photo + `heroOverlay`).
- **GAP — FAB should move off gold onto `GRADIENT.primary`.** The Add FAB is built with the **gold** accent gradient (`GRADIENT.accent` + `GLOW.gold`); per the design system **gold is reserved for highlights/big numbers, never a primary CTA**, so the FAB should adopt the forest-green `GRADIENT.primary` (gradPrimary) with a green glow instead. The empty-state CTA already uses the shared `GlowButton` ("Add a farm") and could gain the bilingual "/ फार्म जोड़ें" sublabel + circular arrow chip to match Login.
- **Crop Plan & Growth Story are reached one level deeper.** This roster only links to `FarmDetail`; the guided pre-seeding **Crop Plan** ([Crop Plan](05-CropCyclePlanPage.md) — a single guided `ScrollView`, not a multi-step wizard) and the **Growth Story** ([Growth Story](09-GrowthStoryPage.md)) are started from inside a farm/cycle, not from this list. A future enhancement could badge plots that have **no active crop cycle** with a "Start crop cycle" call-to-action so an idle plot nudges the farmer into the Crop Plan before sowing.
- **`_count.cropCycles` may be absent** on optimistically-added (`_pending`) farms created offline; the crop-count pill simply hides (count defaults to 0) until the server row reconciles.
