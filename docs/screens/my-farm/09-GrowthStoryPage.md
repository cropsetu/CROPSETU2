# Growth Story (Crop Filmstrip)

> **Tab:** My Farm · **Stack:** `MyFarmStack` (also registered in `AIStack` for AI deep-linking) · **Route name:** `GrowthStory` · **File:** [GrowthStoryScreen.js](../../../frontend/src/screens/FarmProfile/GrowthStoryScreen.js) · **Status: BUILT — route registered in both `MyFarmStack` and `AIStack`, reachable from the cycle detail screen.**

## Purpose
The **Growth Story** is the farmer's crop told back to them as a simple visual story for one crop cycle. Where the [Crop Cycle Detail](06-CropCycleDetailPage.md) screen is the working dashboard (stats, money, "log activity"), Growth Story is the *picture*: "this is your wheat today, where it is in its season, and the field photos you took along the way." It answers a farmer's emotional and practical question at once — *how has my crop grown* — and turns the dry activity log into something the farmer is proud to scroll back through next season.

What actually ships is three things stacked top-to-bottom: a **hero stage scene** showing the crop "today" (an illustrated sky→soil field scene, or the farmer's latest photo, with a big **"Day N"** caption), a horizontal **"Your field photos"** rail of every photo the farmer has logged on the cycle, and a vertical **8-stage season timeline** (a gradient filmstrip) marking which stages are Done / Now / Upcoming. There is **no per-stage narrative card, no activity feed re-presentation, and no share/export** in the shipped screen — those are Future work (see below).

This screen is built to the **KhetAI / Login** design system: warm green-white canvas, **Fraunces** serif for the "Day N" caption and stage titles, **Plus Jakarta Sans** body, deep forest-green (`#005F21`) primary, gold (`#E0AF3B`) for the "Now" accent. It imports tokens from [cosmicTheme.js](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js), whose values are already remapped to the KhetAI palette, so the screen renders forest-green/gold + Plus Jakarta out of the box.

A crop cycle is the unit of work — one crop, one plot, one season — moving through eight stages in fixed order. The shipped screen hard-codes this order in its local `STAGES` array:

```
PLANNING → LAND_PREP → SOWING → VEGETATIVE → FLOWERING → FRUITING → MATURITY → HARVESTED
```

The story is keyed off **DAS** (Days After Sowing) = `dasFrom(cycle.sowingDate)` = `sowingDate ? max(0, floor((now − sowingDate)/86400000)) : null` — the same spine used on the detail screen ([CropCycleDetailScreen.js](../../../frontend/src/screens/FarmProfile/CropCycleDetailScreen.js) ~line 297). DAS now **begins at sowing**: [SowingLogScreen.js](../../../frontend/src/screens/FarmProfile/SowingLogScreen.js) stamps `sowingDate` (via `farmApi.updateCropCycle(cycleId, { sowingDate: now })`) right after advancing the stage to `SOWING`, so logging the sowing is the moment the story "begins the film." Before sowing, `sowingDate` is null and the hero reads "Not sown yet."

> **Note (stage label nuance).** The local `STAGES` array uses the horticulture label **"Fruiting"** for the `FRUITING` enum. Agronomically this should read per crop category: **Grain filling** for cereals (wheat/rice/maize), **Pod development** for pulses and oilseeds (gram/soybean/groundnut), **Boll development** for cotton, and **Fruit set/development** for vegetable/fruit crops. The shipped screen does not yet do this per-category mapping — see Future work.

## Where it sits / how you reach it
- **Reached from:**
  - [CropCycleDetailScreen.js](../../../frontend/src/screens/FarmProfile/CropCycleDetailScreen.js) — the **only** entry today: a **"Growth story"** button in the cycle dashboard (~line 383) → `navigation.navigate('GrowthStory', { cycleId, cycle })`. It passes the already-loaded `cycle` so the story renders instantly, then re-fetches in the background.
- **Navigates to:**
  - `CropCycleDetail` — the **"Back to cycle"** link at the bottom calls `navigation.goBack()`.
- **Route params in:** `{ cycleId, cycle? }` — `cycleId` (required) keys the fetch; `cycle` (optional) is the already-loaded record used to paint immediately. The screen seeds state from `route.params.cycle` when present, then refreshes via `farmApi.getCropCycle(cycleId)`; if the fetch fails it keeps whatever it already has.
- **Route registration:** `GrowthStory` is registered **twice** in [AppNavigator.js](../../../frontend/src/navigation/AppNavigator.js) — once in `AIStack` (~line 371) and once in `MyFarmStack` (~line 427) — so the same screen is reachable from either tab's navigation stack. (The `AIStack` copy is for future AI deep-linking; no screen links into it yet.)

## How it works
Growth Story loads one cycle and renders three blocks in a single `CosmicScreen` `ScrollView`. There is **no view-mode toggle** — it is one fixed layout.

**Load.** On mount, `load()` calls `farmApi.getCropCycle(cycleId)` and stores the result. If `route.params.cycle` was passed (it always is, from the detail screen), state starts populated and the loading spinner is skipped, then the background fetch refreshes it. On fetch failure the screen keeps the seed cycle. `das`, `photos` and `currentIdx` are derived with `useMemo`.

**Hero stage scene.** The hero is a `StageScene` for the cycle's **current** stage (`STAGE_IDX[cycle.growthStage]`, defaulting to index 0 / PLANNING). `StageScene` renders one of two things:
- if the farmer has any logged photo, the **latest** one (`photos[photos.length - 1]`) fills the frame as a cover image; otherwise
- an **illustrated field scene** — a `LinearGradient` from a stage-specific `sky` pair down to a `soil` band, with the crop's `<CropIcon>` ([CropIcons.js](../../../frontend/src/components/CropIcons.js)) sized by a per-stage `scale` (0.34 at PLANNING → ~0.92 at MATURITY), so the illustration visibly "grows" as the season advances.

Over the hero sits a dark `LinearGradient` overlay carrying a small **stage pill** (`hero.label`), the big **"Day N"** caption in Fraunces (`Fraunces_700Bold`), or **"Not sown yet"** when `sowingDate` is null, and a capitalised subline (`crop · season year`).

**"Your field photos" rail.** `collectPhotos(cycle)` gathers every photo URL the farmer has logged on the cycle, de-duplicated, from three sources in order: `cycle.photos[]`, then `activities[].photoUrl`, then `observedEvents[].photoUrl`. It does **not** read the typed `fertilizersUsed[]` / `pesticidesUsed[]` / `irrigationLogs[]` arrays (those carry no photo field). When the list is empty it shows a friendly prompt card ("Add a photo when you log an activity and it will appear here…"); otherwise a horizontal `ScrollView` of 120×120 thumbnails.

**Season timeline (8-stage gradient filmstrip).** The local `STAGES` array (8 entries, PLANNING…HARVESTED) is rendered as a vertical timeline. Each row has a rail dot/connector and a card holding a small (64×64) `StageScene` thumbnail of that stage. Status is purely positional vs. `currentIdx`:
- `i < currentIdx` → **Done** (filled green dot with a check, green connector),
- `i === currentIdx` → **Now** (larger gold dot, gold-bordered card),
- `i > currentIdx` → **Upcoming** (dimmed at 0.7 opacity).

Each card shows the stage `label`, a `StatusPill` (Done / Now / Upcoming), and an **approximate DAS anchor** ("around day N" from the stage's hard-coded `das`, or "before sowing" for stages with `das: null`); the current stage also appends "· you're on day {das}".

> **Agronomy note — DAS anchors are approximate and crop-/sowing-date-sensitive.** The `das` values in `STAGES` (0 / 18 / 48 / 78 / 110 / 140) are a generic mid-duration crop, used only for a believable visual progression, **not** agronomic precision. Real DAS bands differ by crop and shift with sowing date (late sowing compresses the calendar). For example, **wheat**: tillering/vegetative ~0–60 DAS, jointing–booting ~60–80, flowering/anthesis ~80–100, grain-fill ~100–125, maturity ~125–140 — quite different from the screen's generic anchors. A per-crop band table would be the correct source if these were ever made agronomic; see Future work.

**Image sourcing today (two tiers, no network image).** Per the file header comment the intended chain is farmer photo → AI-generated stage image → illustrated `CropIcon` scene. **Only tiers 1 and 3 ship:** the farmer's own photos (tier 1) and the always-available illustrated `StageScene` (tier 3). There is **no growth-image endpoint and no network image fetch in the screen** — tier 2 is Future work. Because tier 3 always succeeds, the story never renders a broken or empty frame, online or offline.

**Honest note.** A `GlassCard` at the bottom states plainly: "Each scene is illustrated from your crop and stage. As you log activities with photos, your own field pictures take over the story. **Photorealistic AI stage images are on the way.**" — so the UI never promises a generated photo it cannot produce.

**Layout order (top → bottom):** `CosmicHeader` ("Growth story" + crop·variety subtitle) → hero `StageScene` with the "Day N" overlay → "Your field photos" rail (or empty prompt) → "Season timeline" 8-stage filmstrip → honest AI-imagery note → **"Back to cycle"** link.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header | `CosmicHeader` | Title "Growth story" (Fraunces) + subtitle `cropName · variety`. |
| Hero stage scene | `StageScene` (210px) | The crop "today": either the farmer's **latest** logged photo as a cover image, or an illustrated `LinearGradient` sky→soil scene with a scaled `<CropIcon>`. |
| Hero overlay | `LinearGradient` + text | Dark bottom gradient carrying the stage pill, the "Day N" caption, and the `crop · season year` subline. |
| Stage pill | Pill (`heroStagePill`) | The current stage `label` (e.g. "Growing", "Flowering") on a translucent white chip with a dot. |
| "Day N" caption | Text (Fraunces, `Fraunces_700Bold`, white) | The DAS counter; reads **"Not sown yet"** when `sowingDate` is null. |
| "Your field photos" rail | Horizontal `ScrollView` of `Image` | 120×120 thumbnails from `collectPhotos(cycle)` (`cycle.photos[]` + `activities[].photoUrl` + `observedEvents[].photoUrl`, de-duped). |
| Empty-photos prompt | `GlassCard` | Shown when no photos exist: camera bubble + "Add a photo when you log an activity and it will appear here…". |
| Season timeline | Vertical list of 8 rows | One row per `STAGES` entry (PLANNING…HARVESTED) with a rail dot/connector and a stage card. |
| Stage card | Card (`tlCard`) | 64×64 `StageScene` thumbnail + stage `label` (Fraunces `Fraunces_600SemiBold`) + `StatusPill` + DAS-anchor meta ("around day N" / "before sowing", "· you're on day {das}" for Now). |
| Status pill | `StatusPill` | **Done** (green `PRIMARY_SOFT`), **Now** (gold `ACCENT_SOFT`), or **Upcoming** (`SURFACE_HI`), keyed purely off position vs. `currentIdx`. |
| Rail dot / connector | View | Filled green check dot for Done, larger gold dot for Now, hollow for Upcoming; green connector line below Done stages. |
| Honest AI-imagery note | `GlassCard` | Sparkles icon + "…Photorealistic AI stage images are on the way." |
| Back to cycle | `Pressable` link | Bottom link with a back arrow → `navigation.goBack()` → `CropCycleDetail`. |

## Services, APIs & data
- **API endpoints** (via [farmApi.js](../../../frontend/src/services/farmApi.js)):
  - `getCropCycle(cycleId)` → `GET /api/v1/cycles/:id` — the full `FarmCropCycle` (`cropName`, `variety`, `season`, `year`, `growthStage`, `sowingDate`, `photos[]`, `activities[]`, `observedEvents[]`) the story is built from. This is the **only** endpoint the screen calls.
  - `sowingDate` itself is written elsewhere: [SowingLogScreen.js](../../../frontend/src/screens/FarmProfile/SowingLogScreen.js) calls `farmApi.updateCropCycle(cycleId, { sowingDate: now })` (→ `PATCH /cycles/:id`) right after advancing to `SOWING`, which is why DAS now has a start anchor.
- **Crop-cycle data model:** `FarmCropCycle` in [schema.prisma](../../../backend/prisma/schema.prisma) — `cropName`, `variety`, `season`, `year`, `growthStage` (the 8-stage enum — index 0 is the hero stage when present), `sowingDate` (drives DAS), `photos[]`, the generic `activities[]` (each `{id,type,date,title,notes,photoUrl?,voiceUrl?,fields{}}`) and `observedEvents[]`. The screen reads **only** `growthStage`, `sowingDate`, `cropName`, `variety`, `season`, `year`, `photos[]`, `activities[]`, `observedEvents[]`; it does not touch the financial roll-ups, the typed log arrays, or the harvest/sale fields.
- **DAS:** local helper `dasFrom(sowingDate)` = `sowingDate ? max(0, floor((now − sowingDate)/86400000)) : null` — the same formula used on [CropCycleDetailScreen.js](../../../frontend/src/screens/FarmProfile/CropCycleDetailScreen.js) (~line 297).
- **Local data:** `STAGES` (8-entry array: key, label, icon, approximate `das`, illustration `scale`, gradient `sky`/`soil` colours), `STAGE_IDX` (key→index), `dasFrom(sowingDate)`, and `collectPhotos(cycle)` are all defined inline in the screen file — there are **no** shared `growthStory/` modules and no `buildActivityFeed` reuse.
- **Theme / UI kit:** tokens from [cosmicTheme.js](../../../frontend/src/screens/FarmProfile/theme/cosmicTheme.js) (`COSMIC`, `CR`, `CS`, `CT`) — its values are remapped to the KhetAI palette (PRIMARY `#005F21`, ACCENT gold `#E0AF3B`, Plus Jakarta Sans body + Fraunces display). Components used: `CosmicScreen`, `CosmicHeader`, `GlassCard` from [ui/](../../../frontend/src/screens/FarmProfile/ui/), `CropIcon` from [CropIcons.js](../../../frontend/src/components/CropIcons.js), and `LinearGradient` from `expo-linear-gradient`. The design system mirrors [LoginScreen.js](../../../frontend/src/screens/Auth/LoginScreen.js) / [khetTheme.js](../../../frontend/src/constants/khetTheme.js).

## Languages / i18n
- **Strings are currently hard-coded English literals** in the screen ("Growth story", "Your field photos", "Season timeline", stage labels, "Day N", "Not sown yet", "Back to cycle", the AI-imagery note). There is **no `t(...)` / i18n wiring** in this screen yet — Hindi/Marathi localisation is a gap.
- Crop names render from `cycle.cropName` only (used to pick the `<CropIcon>` and to label the hero/subtitle). The localized `cropNameMr` / `cropNameHi` fields are **not** read here (they remain schema-only — see Future work / gaps).
- English, Hindi and Marathi are carried project-wide in [translations.js](../../../frontend/src/i18n/translations.js); wiring this screen onto the same namespace as the rest of the My Farm tab is Future work.

## Notes, edge cases & gaps
- **Screen is BUILT and reachable.** `GrowthStoryScreen.js` ships; the `GrowthStory` route is registered in **both** `MyFarmStack` and `AIStack` ([AppNavigator.js](../../../frontend/src/navigation/AppNavigator.js)); and the detail screen's "Growth story" button (~line 383) navigates to it with `{ cycleId, cycle }`. DAS starts at sowing because [SowingLogScreen.js](../../../frontend/src/screens/FarmProfile/SowingLogScreen.js) stamps `sowingDate`.
- **Image sourcing is two-tier today (be honest with users).** The screen shows the farmer's own photos (tier 1) or an illustrated `StageScene` (tier 3). There is **no AI growth-image endpoint and no network image fetch** — no `growth-image` route, no Imagen pipeline. The on-screen note says so explicitly ("Photorealistic AI stage images are on the way"). The illustrated scene always succeeds, so the screen never shows a broken frame, online or offline.
- **DAS anchors are approximate, `growthStage` is truth.** The per-stage `das` values in `STAGES` are a generic mid-duration crop, shown as "around day N" only. The current/Now stage is driven by the authoritative `cycle.growthStage`, never by a DAS-derived band. Mislabelling an anchor is cosmetic, never a logging error. (See the agronomy note above for correct wheat bands and the crop-/sowing-date sensitivity.)
- **"Fruiting" label is horticulture-only.** The `FRUITING` stage card reads "Fruiting" for every crop; agronomically it should read **Grain filling** (cereals), **Pod development** (pulses/oilseeds), **Boll development** (cotton), or **Fruit set/development** (veg/fruit). Per-category label mapping is not implemented — see Future work.
- **Edge states handled:** pre-sowing (`sowingDate` null) → hero reads "Not sown yet", timeline anchors read "before sowing"; no photos → the "Your field photos" rail is replaced by the friendly empty prompt; cycle not loaded yet → spinner; fetch failure → keeps the seed cycle passed in route params; current stage unknown → defaults to index 0 (PLANNING). The `StageScene` icon is keyed off `cropName` capitalised; an unrecognised crop falls back to whatever `<CropIcon>`'s default is.
- **Genuine remaining gaps (still unwired):** `cropNameMr` / `cropNameHi` are not read here (no in-screen localisation); `seedReceiptUrl`, `expectedHarvestDate`, `cropCategory`, `seedCostPerKgInr`, `seedPurchaseDate` remain schema-only columns not written by any screen; per-screen Login LAYOUT chrome (Fraunces serif section headers, 56px gradient icon-square headers) is applied only on some screens, not this one's section labels; area units are acres-only across My Farm.

## Future work
These were described in the original draft as if shipped; they are **not** in the current screen and are recorded here as intended direction only:
- **AI growth-image tier.** A `GET /api/v1/cycles/:id/growth-image?stage=…&das=…` endpoint returning a per-crop, per-stage photoreal image (best-effort tier 2 between the farmer photo and the illustrated scene). No route, model, or cache exists yet.
- **Stage / Day view toggle.** A segmented pill switching a "stage chapters" view and a denser "one card per active day" diary view. The shipped screen has a single fixed layout (hero + photo rail + timeline).
- **Per-stage chapter cards + activity feed.** Cards that bundle the activities logged inside each stage window, reusing the detail screen's feed builder and threading `photoUrl`/`voiceUrl`. Not built; the screen does not import or re-present the activity feed.
- **"Ask KhetAI about this stage" deep-link.** Round-tripping a stage into FarmMind chat (the reason `GrowthStory` is also registered in `AIStack`). No link wired yet.
- **Share / export.** A native share sheet (image/PDF) for the harvest close-out. Not present.
- **Per-crop DAS band table + per-category `FRUITING` label mapping.** Replace the generic `STAGES.das` anchors and the fixed "Fruiting" label with a crop- and sowing-date-aware table (see agronomy notes above).
- **i18n.** Move the hard-coded English strings onto the My Farm tab's translation namespace and render `cropNameMr` / `cropNameHi`.

> See also: [05-CropCyclePlanPage.md](05-CropCyclePlanPage.md) (where the cycle and seed plan are created) and [08-ActivityLoggers.md](08-ActivityLoggers.md) (the loggers that produce the photos this story collects).
