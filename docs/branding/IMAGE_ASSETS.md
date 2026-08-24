# KrushiSarva — Generated Image Asset Specification

> **Status:** DRAFT · no images generated yet · no code wired yet
> **Scope:** which images to generate, where each one is used, and the exact prompt for each.
> **Model pinned in:** §6.1 (the only place in this document a model is named).
> **Line numbers are approximate** — confirm against the file before editing, same convention as
> [`../ICON_UPGRADE_GUIDE.md`](../ICON_UPGRADE_GUIDE.md).

---

## 0. Scope

### 0.1 What this is

The app name is moving from the placeholder **KrushiSarva** (repo) / **KhetAI** (UI) to **KrushiSarva**.
This document is the single reference for every raster image worth generating with an AI image model,
what it is for, where in this codebase it renders, what size and format it ships as, and the prompt
that produces it.

The starting point was a ~120-item generic asset list. Reading the repository cut it hard, because
**this app is already ~95 % hand-drawn SVG** — 66 crops, 23 store categories, 16 animal marks (15 species + an `All` composite), 13 farm
activities, 9 weather conditions, plus machinery, soil, irrigation, tabs and AI-service marks, all as
`react-native-svg` components. Generating rasters for any of those would ship a heavier, less flexible
copy of art that already exists.

**~120 requested assets → 25 generations → ~70 delivered files.**

### 0.2 What this is *not*

- **Not the rename.** `KrushiSarva` appears ~1,109 times across ~250 files. That is a separate task.
  Two facts from it constrain asset work and are noted where relevant: changing `android.package` /
  `ios.bundleIdentifier` creates a **new Play listing, not an update**; and `JWT_ISSUER`/`JWT_AUDIENCE`
  in [`backend/src/utils/jwt.js:9-10`](../../backend/src/utils/jwt.js) cannot be find-and-replaced —
  it invalidates every live session.
- **Not a design system.** [`shared/constants/khetTheme.js`](../../shared/constants/khetTheme.js) is
  the design system. This document consumes its tokens.
- **Not icon work.** New *icons* belong in the SVG kit — see §2 and [`../ICON_UPGRADE_GUIDE.md`](../ICON_UPGRADE_GUIDE.md).

### 0.3 Status vocabulary

`TODO` → `GEN` (candidates generated) → `PICKED` (one chosen) → `WIRED` (in code **and** config) → `SHIPPED`.
Plus `KEEP` (asset already exists, no generation needed) and `REFUTED` (requested, deliberately not made).

`REFUTED` mirrors the `§Refuted` convention in [`../performance/FINDINGS.md`](../performance/FINDINGS.md):
negative results are recorded, not deleted, so the same request does not get re-litigated every quarter.

---

## 1. The decision rule

> **Generate a raster only when all five are true.**
>
> 1. The artwork is a **fixed composition** — full-bleed or large-format, ≥ ~160 dp on its shortest
>    rendered edge — that does not change with data.
> 2. It is **not selected at runtime by a key** for which an SVG component already exists (crop, animal,
>    machinery, soil, irrigation, weather, store category, farm activity, dashboard stat, tab). If a key
>    picks it, it belongs in `shared/components/*Icons.js`, not in a PNG.
> 3. It needs **no runtime tinting, theming, state or animation**.
> 4. It is **not user or catalogue content** arriving from Postgres/Cloudinary.
> 5. It will **never render below 24 dp**, where a photograph or a shaded illustration turns to mud.
>
> Fail any one test and the answer is one of: extend the SVG kit, use an Ionicon, or leave it to
> Cloudinary. **When in doubt, extend the SVG kit** — it is 66 crops deep already and costs one
> component, not one megabyte.

---

## 2. DO NOT GENERATE

Four lanes. Each has a *tell* that classifies a new request in about ten seconds.

| Lane | The tell | Home | Example |
|---|---|---|---|
| **A** — SVG kit | a data key selects it | [`shared/components/CropIcons.js`](../../shared/components/CropIcons.js) (66) · [`StoreCategoryIcons.js`](../../shared/components/StoreCategoryIcons.js) (23) · [`DashboardStatIcons.js`](../../shared/components/DashboardStatIcons.js) · `frontend/src/components/{Animal,Activity,Machinery,Soil,Irrigation,Weather,AIService,Tab}Icons.js`, `LabourIcon.js`, `LanguageIcon.js` | `<CropIcon crop="Tomato" size={56}/>` |
| **B** — Ionicons / MCI | pure navigation or utility, or renders < 24 dp | `@expo/vector-icons` | chevron, close, share, filter, back |
| **C** — DB / Cloudinary | a human uploaded it, or a farmer will act on it | [`backend/src/config/cloudinary.js`](../../backend/src/config/cloudinary.js), [`backend/src/utils/imageVariants.js`](../../backend/src/utils/imageVariants.js) | product photos, animal listings, machinery galleries, KYC, community posts, diagnosis captures |
| **D** — hand-made | it is typography, or it must be a true vector | vector tool → committed PNG | the KrushiSarva wordmark |

### 2.1 Lane A — the SVG kit already owned

House style, from the [`CropIcons.js`](../../shared/components/CropIcons.js) header: `viewBox="0 0 200 200"`,
radial + linear gradients for 3-D shading, a soft ground-shadow ellipse at `cy≈178`, a top-left highlight,
a realistic palette. **Generated raster art must not compete with this style** — it sits alongside it, at
a much larger size, doing a different job.

### 2.2 Lane D — the wordmark cannot be generated

This is the sharpest single correction in this document.

An image model asked to render the word "KrushiSarva" produces plausible-looking **garbage letterforms** —
near-letters that read as a typo at a glance and as nonsense at full size. There is no prompt that fixes
this reliably.

**The wordmark is typeset by hand in Fraunces 700** — already a bundled font
([`khetTheme.js`](../../shared/constants/khetTheme.js) `KFONT.displayBold`) — locked up beside the
generated mark (`IMG-BRAND-001`) and exported. It replaces
[`frontend/assets/krushisarva-wordmark.png`](../../frontend/assets/krushisarva-wordmark.png) (855×347, used at
exactly one call site: [`AgriStoreHome.js:683`](../../frontend/src/screens/AgriStore/AgriStoreHome.js)).

The same rule kills every "app icon with the name in it" request.

### 2.3 Refuted

| Would-be ID | Request | Killed because |
|---|---|---|
| `IMG-CROP-001..066` | a photo or illustration per crop | [`CropIcons.js`](../../shared/components/CropIcons.js) covers all 66, tintable, ~0 KB of APK. **The real fix is a code change, not an asset:** replace the **104 emoji `icon:` fields** in [`frontend/src/data/stateCrops.js`](../../frontend/src/data/stateCrops.js) — rendered at 40–46 px in `CropCalendar.js:16`, `CropDetail.js:101`, `StateCropsScreen.js:51` — with `<CropIcon>`. Same for the 36 `emoji` fields in [`cropGuide.js`](../../frontend/src/data/cropGuide.js). |
| `IMG-ANIMAL-001..016` | livestock photos | `frontend/src/components/AnimalIcons.js` covers all 15 animal types plus an `All` composite (16 marks), and `AnimalTradeHome.js:169` already falls back to `<AnimalIcon>` at full card width — the best image fallback in the app. |
| `IMG-CAT-001..023` | store category tiles | [`StoreCategoryIcons.js`](../../shared/components/StoreCategoryIcons.js) has 23 variants against 22 canonical categories in [`shared/constants/categories.js`](../../shared/constants/categories.js). |
| `IMG-RENT-001..010` | rental category art | `MachineryIcons.js` covers 8 of 10. **The gap is a component fix:** `all` and `other` return `null`, so those two chips render empty at `RentHome.js:202`. Two SVG variants, not ten PNGs. |
| `IMG-WXICON-*` | weather condition icons | `frontend/src/components/WeatherIcons.js` has 9 animated variants with a ~70-string alias map. The photographic backdrops also already exist — see `IMG-WX-001..008` (`KEEP`). |
| `IMG-TAB-*` | tab-bar icons | `TabIcons.js` exists, **and** tabs need active/inactive tinting → fails test 3. |
| `IMG-FB-001` | per-category product placeholder | [`MockImagePlaceholder.js`](../../frontend/src/components/MockImagePlaceholder.js) has 11 themes. **The real bug:** `CheckoutScreen.js:936` and `OrderConfirmedScreen.js:95` use a bare `Ionicons "leaf"` instead of it, and `MachineryDetail.js:158` falls back to an empty blue `<View>` with no glyph at all. |
| `IMG-FB-002` | illustrated avatar set | initials-in-a-gradient-circle already ships (`ProfileScreen.js:562`); an illustration set is 20 files replacing 0 KB of code. |
| `IMG-DIS-*` | disease / pest reference photos | **Refused on safety grounds.** Generated symptom imagery would sit beside a real diagnosis in `DiagnosisResultScreen.js`. A farmer could match a hallucinated lesion and spray the wrong chemical on a real field. If reference imagery is ever wanted it must be **licensed photography curated by an agronomist**, served from Cloudinary, and visibly labelled as a reference library — never generated. |
| `IMG-FLAG-*` | language flag art | script-bearing and geopolitically loaded; `LanguageIcon.js` already exists. (The 10 emoji flags in `OnboardingLanguageScreen.js:27-36` should route to it — again a code change.) |
| `IMG-SPLASH-FULL` | full-bleed splash artwork | replaced by mark-on-flat-colour via `expo-splash-screen` (§6.6). Deletes 683 KB and the 0.46:1 aspect problem at once. |
| `IMG-*-ANIM` | Lottie / animated splash | no `lottie-react-native` dependency in either app; all motion is `react-native-reanimated`. |
| `IMG-EMPTY-001..030` | one illustration per empty state | There are ~30 distinct empty states. Thirty illustrations at ~30 KB is ~900 KB of APK to say "nothing here yet" thirty slightly different ways. Ship **one** (`IMG-STATE-003`), keep the good existing SVG treatments (`AnimalTradeHome.js:346` rings + `AnimalIcon`, `CartScreen.js:65` bag, `RentHome.js:1068` tractor, `MyOrdersScreen.js:282` `DashboardStatIcon`), and upgrade only the five **text-only** states: `AIChatScreen.js:525`, `MSPTrackerScreen.js:224`, `CosmicPicker.js:103`, `StateCropsScreen.js:216`, `MyFarmHomeScreen.js:251`. |
| `IMG-NEWS-*` | news / article thumbnails | **the feature does not exist.** No news screen, no article model. The nearest thing is the community feed, which exists on the backend and admin but has no farmer-app screen. |
| `IMG-NOTIF-*` | per-type notification artwork | all 8 `NotificationType` enum values are unclaimed, but there is **no notification list screen** in the farmer app and push payloads are text-only. Build the screen first; then decide. |
| `IMG-SCHEME-*` | government scheme banners | `GovernmentScheme` has no image column, and `SchemeScreen.js:12` is a hardcoded 5-item array that does not read the API. Wire the screen to the API first. |
| — | loading spinner artwork | use the existing shimmer kit: `frontend/src/components/ui/Skeleton.js` (`SkeletonGroup/Block/Text/Grid/List/Rail/Detail/Stats/Chips`). |

---

## 3. Asset register

`Lane`: **V** flat vector · **P** photographic · **D** hand-made · **—** refuted.
`Ships`: `bundle` (in the APK) · `store` (Play listing only) · `web` (served by Vite) · `—`.
`Renders at` is always `path:line`; **NEW** means the surface must be created.

| ID | Asset | Lane | Renders at | Delivered | Format | Ships | Batch | Status |
|---|---|---|---|---|---|---|---|---|
| IMG-BRAND-001 | App mark (master) | V | source of all LAUNCH + PLAY + SELLER icons | 1024² | PNG·a | — | B1 | TODO |
| IMG-BRAND-002 | KrushiSarva wordmark lockup | **D** | `AgriStoreHome.js:683` | 900×366 | PNG·a | bundle | B1 | TODO |
| IMG-LAUNCH-001 | App icon | V→ | `frontend/app.json` `icon` | 1024² | PNG | bundle | B1 | TODO |
| IMG-LAUNCH-002 | Adaptive foreground | V→ | `app.json` `android.adaptiveIcon.foregroundImage` | 1024² | PNG·a | bundle | B1 | TODO |
| IMG-LAUNCH-003 | Adaptive monochrome | V→ | `app.json` `android.adaptiveIcon.monochromeImage` **NEW** | 1024² | PNG·a | bundle | B1 | TODO |
| IMG-LAUNCH-004 | Notification icon | V→ | `app.json` `expo-notifications` plugin **NEW** | 96² | PNG·a | bundle | B1 | TODO |
| IMG-LAUNCH-005 | Splash mark | V→ | `expo-splash-screen` **NEW** + `App.js:~44`, `:~110` | 1024² | PNG·a | bundle | B1 | TODO |
| IMG-LAUNCH-006 | Favicon | V→ | `app.json` `web.favicon` | 64² | PNG | bundle | B1 | TODO |
| IMG-AUTH-001 | Welcome hero | P | `shared/screens/LoginScreen.js:31`, `:280` | 1080×1620 | WebP | bundle | B2 | TODO |
| IMG-AUTH-002 | Phone-step illustration | V | `shared/screens/LoginScreen.js:337` **NEW** | 480² ×3 | WebP·a | bundle | B2 | TODO |
| IMG-AUTH-003 | OTP-step illustration | V | `shared/screens/LoginScreen.js:443` **NEW** | 480² ×3 | WebP·a | bundle | B2 | TODO |
| IMG-ONBOARD-001 | Advice & weather | V | first-run carousel **NEW** | 720×540 ×2 | WebP·a | bundle | B2 | TODO |
| IMG-ONBOARD-002 | Krushi Drishti scan | V | first-run carousel **NEW** | 720×540 ×2 | WebP·a | bundle | B2 | TODO |
| IMG-ONBOARD-003 | Buy · sell · rent | V | first-run carousel **NEW** | 720×540 ×2 | WebP·a | bundle | B2 | TODO |
| IMG-STATE-001 | Crash / went wrong | V | `shared/components/RootErrorBoundary.js`, `OnboardingNavigator.js:15` | 480² ×3 | WebP·a | bundle | B3 | TODO |
| IMG-STATE-002 | Offline | V | 7 sites — `AgriStoreHome.js:786`,`:851`, `RentHome.js:1222`, `AnimalTradeHome.js:292`, `ScanHistoryScreen.js:104`, `VoiceHistoryScreen.js:104`, `AICreditsScreen.js:126` | 480² ×3 | WebP·a | bundle | B3 | TODO |
| IMG-STATE-003 | Generic empty | V | 5 text-only states — see §2.3 | 480² ×3 | WebP·a | bundle | B3 | TODO |
| IMG-STATE-004 | Success / celebration | V | `FarmProfile/ui/CelebrationSheet.js` | 480² ×3 | WebP·a | bundle | B3 | TODO |
| IMG-STATE-005 | No search results | V | `AgriStoreHome.js:851` (search branch), `CosmicPicker.js:103`, `SchemeScreen.js:233` | 480² ×3 | WebP·a | bundle | B3 | TODO |
| IMG-SCENE-001 | Stage — Planning | V | `GrowthStoryScreen.js:226` (`STAGES[0]`, `:41`) | 720×480 | WebP | bundle | B4 | TODO |
| IMG-SCENE-002 | Stage — Field prep | V | `GrowthStoryScreen.js:226` (`STAGES[1]`, `:42`) | 720×480 | WebP | bundle | B4 | TODO |
| IMG-SCENE-003 | Stage — Sowing | V | `GrowthStoryScreen.js:226` (`STAGES[2]`, `:43`) | 720×480 | WebP | bundle | B4 | TODO |
| IMG-SCENE-004 | Stage — Growing | V | `GrowthStoryScreen.js:226` (`STAGES[3]`, `:44`) | 720×480 | WebP | bundle | B4 | TODO |
| IMG-SCENE-005 | Stage — Flowering | V | `GrowthStoryScreen.js:226` (`STAGES[4]`, `:45`) | 720×480 | WebP | bundle | B4 | TODO |
| IMG-SCENE-006 | Stage — Fruiting | V | `GrowthStoryScreen.js:226` (`STAGES[5]`, `:46`) | 720×480 | WebP | bundle | B4 | TODO |
| IMG-SCENE-007 | Stage — Maturity | V | `GrowthStoryScreen.js:226` (`STAGES[6]`, `:47`) | 720×480 | WebP | bundle | B4 | TODO |
| IMG-SCENE-008 | Stage — Harvested | V | `GrowthStoryScreen.js:226` (`STAGES[7]`, `:48`) | 720×480 | WebP | bundle | B4 | TODO |
| IMG-SCAN-001 | How to photograph a leaf | V | `AI/CropScanScreen.js:1237` (photo-tips card) | 640×480 ×2 | WebP·a | bundle | B4 | TODO |
| IMG-WX-001..008 | Weather backdrops | P | `frontend/src/utils/weatherBackground.js:10-18` | 720w | WebP | bundle | B3 | **KEEP** |
| IMG-SELLER-001 | Seller app mark | V→ | `seller-app/app.json` (all 4 keys) | 1024² | PNG·a | bundle | B5 | TODO |
| IMG-SELLER-002 | Seller dashboard hero | V | `seller-app/src/screens/DashboardScreen.js` **NEW** | 720×480 ×2 | WebP·a | bundle | B5 | TODO |
| IMG-PLAY-001 | Play Store icon | V→ | Play Console listing | 512² | PNG | store | B5 | TODO |
| IMG-PLAY-002 | Feature graphic | P | Play Console listing | 1024×500 | PNG | store | B5 | TODO |
| IMG-PLAY-003 | Screenshot backdrop | V | behind 6–8 device frames | 1080×1920 | PNG | store | B5 | TODO |
| IMG-PLAY-004 | Social / OG card | P | `admin/index.html` `og:image`, link previews | 1200×630 | PNG | web | B5 | TODO |
| IMG-WEB-001 | Admin favicon | V→ | `admin/index.html` **NEW** + `admin/public/` **NEW** | 64², 180² | PNG | web | B5 | TODO |

`V→` = **derived** from `IMG-BRAND-001` in post-processing; costs no generation.

**Generations: 25.** (1 brand · 6 auth+onboarding · 5 states · 9 scenes+scan · 4 play/seller/web.)
Everything else on this table is either derived, hand-typeset, kept, or refuted.

---

## 4. Prompt conventions

Twenty-five prompts only stay on-style if they share a spine. Every prompt is built the same way.

### 4.1 Lane V preamble — paste verbatim, unedited

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a,
warm soil brown #7E5A3C, off-white #f9fdf6; a single soft light from the upper
left; centred subject with generous margin; flat plain background; no gradient
meshes, no photorealism, no isometric 3D. Absolutely NO text, letters, numbers,
words, logos, watermarks or signatures anywhere in the image.
```

### 4.2 Lane P preamble — paste verbatim, unedited

```text
Photorealistic documentary photograph, natural available light, 35 mm full-frame
at f/4, medium depth of field, true-to-life colour, no HDR, no vignette, no lens
flare, no colour grading. Rural Maharashtra on the Deccan plateau: dark grey-black
cotton soil, neem and babhul trees on the field bunds, low dry hills on the
horizon. People wear everyday Indian working clothes — men in a plain cotton
half-sleeve shirt with a folded cotton towel over one shoulder, women in a cotton
saree worn nauvari style or a salwar-kameez with the dupatta drawn over the head.
Real Indian crop varieties only. Absolutely NO text, letters, numbers, words,
logos, watermarks or signatures anywhere in the image.
```

### 4.3 The nine mandatory clauses, in this order

1. **Lane preamble** — verbatim.
2. **Subject** — one sentence, one concrete subject. Never two.
3. **Setting** — Lane P only.
4. **Clothing** — Lane P always; Lane V whenever a human appears.
5. **Composition + safe area** — where the subject sits **and what the app draws on top of it**. Every
   hero prompt must name the region the UI will occlude. This is the clause that decides whether an
   image is usable or merely pretty.
6. **Canvas + background** — `square 1:1` / `tall portrait 2:3` / `landscape 3:2`, then `fully
   transparent` or `full-bleed scene, no transparency`.
7. **Palette anchor** — restate the 2–4 hexes governing *this* asset. The preamble's eight-colour list
   is too long to bind the model; the anchor is what actually holds.
8. **Restated no-text clause** — yes, a second time, at the end. Image models weight late instructions
   more heavily and quietly drop early global constraints on long prompts. **Since every asset here is
   deliberately text-free (these models mangle Devanagari), this repetition is the single
   highest-value convention in the document.**
9. **Negative** — the global string below, plus asset-specific additions.

### 4.4 Global negative string

```text
Negative: text, typography, captions, letters, Devanagari or Latin script,
numbers, UI chrome, dialog boxes, buttons, cursors, app screenshots, phone or
laptop mockups, logos, brand marks, watermarks, signatures, borders, frames,
container plates, collage, tiling, multiple panels, split screen, extra limbs,
deformed hands, six fingers, stock-photo grin, staged thumbs-up, drone or aerial
view, red barns, silos, picket fences, rolling green pasture, tulips, Caucasian
or East Asian models, glossy 3D render, plastic clay look, skeuomorphic bevels,
HDR halo, teal-and-orange grading, neon colours, purple, magenta, blue-dominant
palette.
```

`purple, magenta, blue-dominant` earns its place: these models drift blue-violet on the phrase "app
illustration", and this brand is green + gold.

### 4.5 Palette card

From [`shared/constants/khetTheme.js`](../../shared/constants/khetTheme.js) — copy-paste:

```text
primary        #005f21     primaryGlow  #31aa40     accent   #c9f2c0
secondary      #e3f5da     muted        #edf5e7     border   #d7e1d5
mutedForeground #57685a    foreground   #06210d     card     #ffffff
background     #f9fdf6     gold         #e0af3b     destructive #df2225
gradPrimary    #005f21 → #008935
gradHero       rgba(0,36,3,0) → rgba(0,36,3,0.55) → rgba(0,24,3,0.96)   @ 0, 0.45, 1
soil browns    #9C7A55  #7E5A3C  #6B4A30  #B79237
seller accent  #E65100 (harvest orange)   parchment #FAF4EC
```

**`#005f21` is the only brand green for generated art.** See §9.2 — this is a decision, not a default.

### 4.6 Cultural specificity

| Do | Don't |
|---|---|
| Deccan plateau, dark grey-black cotton soil | brown loam, prairie topsoil |
| jowar, bajra, cotton, soybean, tur, sugarcane, onion | wheat belt, maize monoculture, sunflower fields |
| bunded plots, stone field boundaries, neem/babhul | open prairie, hedgerows, picket fences |
| compact Mahindra/Swaraj-class tractor, or bullocks | large Western combine harvester |
| plain cotton working clothes, folded towel, nauvari saree | costume "ethnic" dress, jewellery, turbans as decoration |
| flat tin-roofed or tiled farmhouse | red barn, grain silo |
| unposed, working, mid-forties | stock-photo grin, thumbs-up, model casting |

### 4.7 One prompt = one image

Never ask for "a set of 8". Each stage, state and step has its own ID and its own prompt, so a redo is
one line and one API call.

---

## 5. Asset specs

### 5.1 BRAND

#### IMG-BRAND-001 — KrushiSarva app mark (master)

**Lane V · gen 1024×1024 transparent PNG · quality `high` · n=4 · B1 · TODO**

**Renders at:** nothing directly. This is the *source* of `IMG-LAUNCH-001..006`, `IMG-SELLER-001`,
`IMG-PLAY-001` and `IMG-WEB-001` — **one generation, ten shipped files**. It is also the artwork half of
the `IMG-BRAND-002` lockup, whose type is set by hand.

**Params:** `size:1024x1024` `quality:high` `background:transparent` `output_format:png` `n:4`

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, warm gold #e0af3b; a single soft light from the upper left;
centred subject with generous margin; flat plain background; no gradient meshes,
no photorealism, no isometric 3D. Absolutely NO text, letters, numbers, words,
logos, watermarks or signatures anywhere in the image.

Subject: a single app-icon mark — one upright young shoot bearing three leaves
rising out of a cupped open hand simplified to two smooth curved shapes, with a
small warm-gold sun disc tucked behind the topmost leaf. Bold, symmetrical, one
unbroken silhouette.

Composition: perfectly centred; the subject occupies the central 60 percent of the
square with at least 20 percent clear margin on all four sides. The mark must stay
readable as a solid one-colour silhouette at 48 by 48 pixels — no thin lines, no
detail narrower than one thirtieth of the canvas, no element touching any edge,
no separated floating specks.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: shoot and leaves in #005f21 and #31aa40, the cupped hand in
#c9f2c0, the sun disc in #e0af3b. Exactly four flat colours, no intermediate
tints, no shading beyond one soft long shadow.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
wordmark, NO app-store badge, NO circular or rounded-square container plate — the
mark alone on transparency.

Negative: text, typography, letters, script, numbers, UI chrome, buttons, phone
mockups, logos, watermarks, signatures, borders, frames, container plates,
drop-shadow bevels, glossy 3D render, skeuomorphic gradients, clay render, neon
colours, purple, magenta, blue-dominant palette, multiple panels, collage, tiling.
```

**Post-processing:** archive the raw 1024² to `docs/branding/masters/`. All LAUNCH derivations in §6.5.

**Accept when:** legible as a flat black silhouette at 48 px (**run the flatten test before picking**) ·
four colours only · nothing within 20 % of any edge · no container plate · survives an Android 13
monochrome flatten without collapsing into a blob.

**Do not:** accept a candidate with a rounded-square background plate. Android adaptive icons and iOS
both apply their own mask; a baked plate double-frames and looks amateur.

---

#### IMG-BRAND-002 — KrushiSarva wordmark lockup

**Lane D — hand-made, NOT generated · B1 · TODO**

**Renders at:** [`frontend/src/screens/AgriStore/AgriStoreHome.js:683`](../../frontend/src/screens/AgriStore/AgriStoreHome.js),
replacing `require('../../../assets/krushisarva-wordmark.png')`.

**Method:** set `KrushiSarva` in **Fraunces 700** (`KFONT.displayBold`, already bundled) in
`#005f21` on transparent. Cap-height of the type equals the optical height of the `IMG-BRAND-001` mark;
gap between mark and type equals one cap-height. Export at 900×366 and 1800×732.

**Why not generated:** §2.2. Image models cannot render a brand name correctly, and a near-miss
letterform on the store header is worse than no wordmark.

**Accept when:** the word is spelled correctly at 100 % zoom (this is not a joke — it is the whole
reason this asset is Lane D) · baseline of the type aligns optically with the mark's visual centre ·
reads at 120 dp wide.

---

### 5.2 LAUNCH — all derived from `IMG-BRAND-001`, zero generations

| ID | Output | Derivation | Config key |
|---|---|---|---|
| IMG-LAUNCH-001 | `frontend/assets/icon.png` 1024² **opaque** | flatten `BRAND-001` onto flat `#005f21`, mark at 62 % width | `app.json` `icon` |
| IMG-LAUNCH-002 | `frontend/assets/adaptive-icon-foreground.png` 1024² **alpha** | mark at **50 % width**, centred, alpha preserved | `android.adaptiveIcon.foregroundImage` |
| IMG-LAUNCH-003 | `frontend/assets/adaptive-icon-monochrome.png` 1024² **alpha** | flatten to pure white `#ffffff` silhouette, alpha preserved, mark at 50 % width | `android.adaptiveIcon.monochromeImage` |
| IMG-LAUNCH-004 | `frontend/assets/notification-icon.png` 96² **alpha** | pure white silhouette, mark at 75 % width, **simplify: drop the sun disc** | `expo-notifications` plugin `icon` |
| IMG-LAUNCH-005 | `frontend/assets/splash-mark.png` 1024² **alpha** | mark at 100 %, full-colour | `expo-splash-screen` `image` + `App.js` |
| IMG-LAUNCH-006 | `frontend/assets/favicon.png` 64² opaque | as LAUNCH-001, downscaled | `web.favicon` |

Three things that will silently break if ignored:

1. **`adaptive-icon.png` is currently byte-identical to `icon.png`** (verified: both md5 `27f333f4…`,
   1024², **no alpha**). Android applies a circular/squircle mask to the foreground layer and crops to a
   66 % safe zone — so today the launcher is cutting straight through the artwork. `IMG-LAUNCH-002` at
   50 % width is the fix, and it is the **highest-impact single change in this whole document.**
2. **`IMG-LAUNCH-004` is rendered by Android as an alpha mask — all colour is discarded.** A green icon
   ships as a grey blob. It must be a **pure white silhouette on transparency**, legible at 24 dp, which
   is why the sun disc is dropped.
3. **`IMG-LAUNCH-003` is flattened by the launcher too.** Any candidate whose mark collapses into an
   unreadable blob when made single-colour must be rejected at `IMG-BRAND-001`, not patched here.

---

### 5.3 AUTH

#### IMG-AUTH-001 — Welcome hero

**Lane P · gen 1024×1536 opaque · quality `high` · n=4 · B2 · TODO**

**Renders at:** [`shared/screens/LoginScreen.js:31`](../../shared/screens/LoginScreen.js) (`const HERO = require(...)`)
and `:280` (`<Image source={HERO} style={StyleSheet.absoluteFill} resizeMode="cover"/>`), under
`KHET.gradHero` at `locations [0, 0.45, 1]`.

Replaces `shared/assets/khet/welcome-hero.jpg`, which is **1024×1024 square being `cover`-cropped into a
full-screen portrait** — the top and bottom of the intended frame are already being thrown away today.
Generating portrait fixes a live bug, not just the art.

**Params:** `size:1024x1536` `quality:high` `background:opaque` `output_format:png` `n:4`

**Prompt**

```text
Photorealistic documentary photograph, natural available light, 35 mm full-frame
at f/4, medium depth of field, true-to-life colour, no HDR, no vignette, no lens
flare, no colour grading. Rural Maharashtra on the Deccan plateau: dark grey-black
cotton soil, neem and babhul trees on the field bunds, low dry hills on the
horizon. People wear everyday Indian working clothes. Real Indian crop varieties
only. Absolutely NO text, letters, numbers, words, logos, watermarks or
signatures anywhere in the image.

Subject: a Marathi farmer in his late forties standing at the edge of his own
field in the golden hour, framed from the chest up and seen very slightly from
below, looking off-camera to the right with a calm unposed expression, one hand
resting lightly on a healthy green jowar stalk beside him.

Setting: bunded plots of jowar running away behind him, a distant tin-roofed
farmhouse thrown well out of focus, warm low side light from the right.

Clothing: a plain off-white cotton half-sleeve shirt, a folded cotton towel over
one shoulder; no branded clothing, no costume, no jewellery beyond a plain thread.

Composition and safe area: the head and shoulders sit in the UPPER 45 percent of a
tall portrait frame, slightly left of centre. The BOTTOM 50 percent must be
visually quiet, low in contrast and free of detail — soft out-of-focus crop and
soil only — because the app lays a dark gradient, a headline and two buttons over
it. Nothing that matters below the vertical midpoint.

Canvas: tall portrait 2:3. Background: full-bleed photographic scene, no
transparency.

Palette anchor: warm golden-hour light, deep greens reading toward #005f21 in
shadow, gold highlights near #e0af3b. No blue cast.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
signboards or hoardings, NO logos on clothing or machinery, NO watermarks.

Negative: text, signage, hoardings, logos, brand marks, watermarks, red barns,
silos, picket fences, rolling green pasture, tulips, sunflower fields, maize
monoculture, large Western combine harvester, Caucasian or East Asian models,
stock-photo grin, staged thumbs-up, drone or aerial view, tractor centre-frame,
plastic 3D render, HDR halo, teal-and-orange grading, oversaturation, purple sky,
extra limbs, deformed hands, six fingers, motion blur, collage, multiple panels.
```

**Post-processing:** resize to 1080×1620 (lanczos3) · strip EXIF · WebP q=72 →
`shared/assets/khet/welcome-hero.webp`. **Single density** — a full-bleed `cover` image gains nothing
from @2x/@3x. Cap **140 KB**.

**Accept when:** the bottom half survives `gradHero` without losing the subject · hands anatomically
correct at 100 % zoom · no legible text anywhere, including on the distant farmhouse · reads as
Maharashtra, not Punjab and not Iowa.

**Do not:** keep a candidate where the farmer looks straight down the lens — the screen already has a
headline competing for attention.

---

#### IMG-AUTH-002 — Phone-entry step illustration

**Lane V · gen 1024² transparent · quality `medium` · n=3 · B2 · TODO**

**Renders at:** [`shared/screens/LoginScreen.js:337`](../../shared/screens/LoginScreen.js) (`PhoneView`) — **NEW**.
Today the step is a `gradSurface` fill, two blurred `Blob` circles and a 56×56 gradient square holding an
`Ionicons "call"`. Place the illustration above the input card at `width: 180`, `resizeMode:'contain'`,
replacing the icon square.

**Why generated, not SVG:** a one-off decorative illustration at a fixed ~180 dp, never keyed by data,
never tinted. Passes all five tests in §1.

**Params:** `size:1024x1024` `quality:medium` `background:transparent` `output_format:png` `n:3`

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a; a
single soft light from the upper left; centred subject with generous margin; flat
plain background; no gradient meshes, no photorealism, no isometric 3D.
Absolutely NO text, letters, numbers, words, logos, watermarks or signatures
anywhere in the image.

Subject: a friendly welcome motif — two cupped open hands seen from above holding
a small green sprout, with three tiny gold dots rising from the sprout in a gentle
arc, suggesting a message travelling outward. Calm, warm, reassuring.

Composition: one centred subject occupying the central 65 percent of a square
canvas with at least 15 percent clear margin on all sides; one soft flat ellipse
as a ground shadow beneath the hands. No horizon, no landscape, no second element.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: hands in #c9f2c0 with #57685a outlines used sparingly, sprout in
#005f21 and #31aa40, rising dots in #e0af3b. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
phone handset with a screen, NO chat bubble containing characters, NO keypad.

Negative: text, typography, letters, script, numbers, UI chrome, dialog boxes,
buttons, cursors, phone or laptop mockups, screenshots, keypads, SIM cards,
logos, watermarks, borders, frames, drop-shadow bevel, glossy 3D render, clay
render, neon colours, purple, magenta, blue-dominant palette, multiple panels,
collage, tiling.
```

**Post-processing:** resize 240 / 480 / 720 · WebP q=90 → `shared/assets/khet/auth-phone.webp`,
`auth-phone@2x.webp`, `auth-phone@3x.webp`. Cap **25 KB @2x**.

**Accept when:** reads clearly at 180 dp on a 720p screen · no text anywhere · sits on `#f9fdf6` **and**
on `gradSurface` with no visible box edge.

**Do not:** add a phone handset showing a UI — that is Lane B chrome and it dates instantly.

---

#### IMG-AUTH-003 — OTP-verify step illustration

**Lane V · gen 1024² transparent · quality `medium` · n=3 · B2 · TODO**

**Renders at:** [`shared/screens/LoginScreen.js:443`](../../shared/screens/LoginScreen.js) (`OtpView`) — **NEW**.
This step currently has **no image and not even an icon square** — gradient, blobs and six text boxes.
Place at `width: 150` above the OTP boxes.

**Params:** `size:1024x1024` `quality:medium` `background:transparent` `output_format:png` `n:3`

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a; a
single soft light from the upper left; centred subject with generous margin; flat
plain background; no gradient meshes, no photorealism, no isometric 3D.
Absolutely NO text, letters, numbers, words, logos, watermarks or signatures
anywhere in the image.

Subject: a simple security motif — a rounded shield shape with a small keyhole cut
out of its centre, and a single green leaf resting against its lower right edge.
Solid, calm, trustworthy, not technical.

Composition: one centred subject occupying the central 60 percent of a square
canvas with at least 20 percent clear margin on all sides; one soft flat ellipse
as a ground shadow. No second element, no background scene.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: shield body in #005f21 with a #31aa40 inner face, keyhole cut
showing transparency, leaf in #c9f2c0, one thin gold #e0af3b arc as a highlight
along the shield's upper left edge. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
digits inside or beside the shield, NO padlock dial, NO asterisks or dots
standing in for a passcode.

Negative: text, typography, letters, script, numbers, digits, asterisks, PIN
dots, UI chrome, dialog boxes, buttons, phone mockups, screenshots, fingerprint
sensor, face-ID glyph, logos, watermarks, borders, frames, red alarm colouring,
drop-shadow bevel, glossy 3D render, clay render, neon colours, purple, magenta,
blue-dominant palette, multiple panels, collage, tiling.
```

**Post-processing:** resize 240 / 480 / 720 · WebP q=90 → `shared/assets/khet/auth-otp*.webp`.
Cap **20 KB @2x**.

**Accept when:** reads at 150 dp · the keyhole is a true transparent cut, not a filled dark shape ·
no digits anywhere.

---

### 5.4 ONBOARD — the first-run carousel

**There is no onboarding carousel today.** Onboarding is two *form* screens —
`OnboardingLanguageScreen.js` then `OnboardingProfileScreen.js`, gated in `App.js` on
`user.onboardingStep === 'BASIC' && !user.totalFarms`. A brand-new user goes OTP → language picker →
farm form, and is never told what the app does.

These three assets back a new carousel inserted between OTP-verify and `OnboardingLanguage`.
**Three, not four** — a fourth "everything in one place" slide restates the other three and adds a
swipe most users will skip.

All three: **Lane V · gen 1024×1024 transparent · quality `medium` · n=3 · B2 · TODO**, delivered
720×540 @1x/@2x WebP·a to `frontend/assets/illustrations/onboard-N*.webp`, cap **35 KB @2x**.
Caption text is rendered by the app in the user's language — never baked in.

#### IMG-ONBOARD-001 — Advice, weather and prices

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a,
warm soil brown #7E5A3C, off-white #f9fdf6; a single soft light from the upper
left; centred subject with generous margin; flat plain background; no gradient
meshes, no photorealism, no isometric 3D. Absolutely NO text, letters, numbers,
words, logos, watermarks or signatures anywhere in the image.

Subject: an Indian farmer standing in a bunded field of jowar, one hand shading
his eyes as he looks up at a sky holding both a warm gold sun and one soft rain
cloud with three falling droplets.

Clothing: plain cotton half-sleeve shirt, a folded cotton towel over one shoulder,
simple trousers; no costume, no jewellery.

Composition: the farmer stands slightly left of centre in the lower two-thirds of
a landscape frame; the sun and cloud occupy the upper right; a low bunded field
line runs across the lower third. Generous empty sky in the upper left. Leave the
lower 15 percent visually quiet — the carousel lays a caption and page dots there.

Canvas: landscape 3:2. Background: fully transparent.

Palette anchor: field and crop in #31aa40 and #c9f2c0, soil bund in #7E5A3C, sun
in #e0af3b, cloud in #e3f5da, the farmer's shirt in #f9fdf6, his silhouette
accents in #57685a. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
temperature readings, NO price tags, NO charts or graphs, NO phone screen showing
a UI.

Negative: text, typography, letters, script, numbers, charts, graphs, price tags,
currency symbols, UI chrome, dialog boxes, buttons, phone or laptop mockups,
screenshots, logos, watermarks, borders, frames, red barns, silos, picket fences,
tulips, Caucasian or East Asian figures, glossy 3D render, clay render, neon
colours, purple, magenta, blue-dominant palette, multiple panels, collage, tiling.
```

**Accept when:** the farmer reads as Indian and as *working*, not posing · lower 15 % is quiet · sits on
`#f9fdf6` with no box edge.

#### IMG-ONBOARD-002 — Krushi Drishti: photograph a sick leaf

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a,
warm soil brown #7E5A3C, off-white #f9fdf6; a single soft light from the upper
left; centred subject with generous margin; flat plain background; no gradient
meshes, no photorealism, no isometric 3D. Absolutely NO text, letters, numbers,
words, logos, watermarks or signatures anywhere in the image.

Subject: a single large cotton leaf held up close, with a few soft irregular
yellow-brown blotches on its surface, and one simplified hand entering from the
lower right holding a plain rectangular phone body — seen from BEHIND, so its
screen is not visible — pointed at the leaf. A thin gold focus bracket floats over
the affected area of the leaf.

Composition: the leaf fills the centre-left of a landscape frame at large scale;
the hand and phone enter from the lower right, cropped by the frame edge. The
focus bracket sits over the blotched region. Leave the lower 15 percent visually
quiet for the carousel caption.

Canvas: landscape 3:2. Background: fully transparent.

Palette anchor: healthy leaf tissue in #31aa40 with #005f21 veins, diseased
blotches in muted #e0af3b and #7E5A3C, phone body in #57685a, focus bracket in
#e0af3b. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
visible phone screen or camera UI, NO shutter button, NO percentage or confidence
readout, NO magnifying glass.

Negative: text, typography, letters, script, numbers, percentages, UI chrome,
camera viewfinder, shutter button, dialog boxes, buttons, visible phone screen,
screenshots, magnifying glass, microscope, laboratory equipment, insects, logos,
watermarks, borders, frames, gore, alarming red, glossy 3D render, clay render,
neon colours, purple, magenta, blue-dominant palette, multiple panels, collage.
```

**Accept when:** the blotches read as plant disease, not as damage or dirt · the phone shows no screen ·
no numeric confidence readout anywhere.

**Do not:** let the symptom look like any *specific* named disease. This is a wayfinding illustration,
not a diagnostic reference — see the `IMG-DIS-*` refusal in §2.3.

#### IMG-ONBOARD-003 — Buy, sell and rent

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a,
warm soil brown #7E5A3C, off-white #f9fdf6; a single soft light from the upper
left; centred subject with generous margin; flat plain background; no gradient
meshes, no photorealism, no isometric 3D. Absolutely NO text, letters, numbers,
words, logos, watermarks or signatures anywhere in the image.

Subject: a small compact Indian farm tractor in three-quarter view, with a stack
of two seed sacks and a watering-can-sized sprayer resting on the ground beside
its front wheel, and one cow standing calmly behind it.

Composition: the tractor sits centre-right of a landscape frame with the sacks and
sprayer in the lower left and the cow partly behind the tractor at the left edge;
a single flat ground shadow ellipse runs under all of them. Leave the lower 15
percent visually quiet for the carousel caption.

Canvas: landscape 3:2. Background: fully transparent.

Palette anchor: tractor body in #005f21 with #57685a wheels and #e0af3b lamp
accents, seed sacks in #f9fdf6 with #7E5A3C ties, sprayer in #c9f2c0, cow in
#f9fdf6 with #7E5A3C markings. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
price tags, NO currency symbols, NO brand badges on the tractor, NO number plate.

Negative: text, typography, letters, script, numbers, price tags, currency
symbols, rupee signs, shopping-cart glyph, brand badges, number plates, UI chrome,
buttons, phone mockups, logos, watermarks, borders, frames, large Western combine
harvester, red barn, silo, picket fence, glossy 3D render, clay render, neon
colours, purple, magenta, blue-dominant palette, multiple panels, collage, tiling.
```

**Accept when:** the tractor reads as a compact Indian machine, not a large Western one · no brand
badges or number plate · all three objects share one ground shadow.

---

### 5.5 STATE

All five: **Lane V · gen 1024² transparent · quality `medium` · n=3 · B3**, delivered 240/480/720 WebP·a
to `frontend/assets/illustrations/`, cap **20 KB @2x**. Rendered at 120–160 dp.

These five replace flat 15–48 px Ionicons at ~15 call sites. They are the screens that decide whether a
farmer on a weak network trusts the app.

#### IMG-STATE-001 — Something went wrong

**Renders at:** [`shared/components/RootErrorBoundary.js`](../../shared/components/RootErrorBoundary.js)
(app-wide crash screen — currently **text and a button only, zero art**) and
[`frontend/src/navigation/OnboardingNavigator.js:15`](../../frontend/src/navigation/OnboardingNavigator.js)
(a second, cruder boundary showing a raw stack trace on a white screen).

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a,
warm soil brown #7E5A3C; a single soft light from the upper left; centred subject
with generous margin; flat plain background; no gradient meshes, no photorealism,
no isometric 3D. Absolutely NO text, letters, numbers, words, logos, watermarks
or signatures anywhere in the image.

Subject: a small terracotta plant pot that has tipped over onto its side on flat
ground, with a little spilled soil and one intact green seedling lying beside it,
still healthy. The mood is a small recoverable mishap — nothing is broken and
nothing is lost.

Composition: one centred subject occupying the central 65 percent of a square
canvas with at least 15 percent clear margin on all sides; one soft flat ellipse
as a ground shadow. No horizon, no room, no second scene element.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: pot in #7E5A3C, spilled soil in a darker warm brown, seedling in
#005f21 and #31aa40, one small gold #e0af3b highlight on the pot rim. Flat colours
only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO error
codes, NO warning triangle with an exclamation mark, NO sad face, NO broken-glass
crack pattern.

Negative: text, typography, letters, script, numbers, error codes, warning
triangle, exclamation mark, skull, bug, sad face, crying emoji, broken glass,
cracks, UI chrome, dialog boxes, buttons, cursors, phone mockups, screenshots,
logos, watermarks, borders, frames, alarming red, drop-shadow bevel, glossy 3D
render, clay render, neon colours, purple, magenta, blue-dominant palette,
multiple panels, collage, tiling.
```

**Accept when:** reads as recoverable, not alarming · no warning triangle · the seedling is clearly
undamaged · works on the crash screen's solid green background **and** on `#f9fdf6`.

#### IMG-STATE-002 — Offline / no connection

**Renders at:** seven sites, all currently a 15–48 px `cloud-offline-outline` Ionicon —
`AgriStoreHome.js:786` and `:851`, `RentHome.js:1222`, `AnimalTradeHome.js:292`,
`ScanHistoryScreen.js:104`, `VoiceHistoryScreen.js:104`, `AICreditsScreen.js:126`.
**One asset, seven call sites.**

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a; a
single soft light from the upper left; centred subject with generous margin; flat
plain background; no gradient meshes, no photorealism, no isometric 3D.
Absolutely NO text, letters, numbers, words, logos, watermarks or signatures
anywhere in the image.

Subject: a small rural signal scene — one slender mobile tower standing on a low
green mound, its two signal arcs drawn as thin arcs that are visibly broken with a
clear gap in the middle, and one small cloud drifting away to the side. The mood
is calm and reassuring — "we will try again" — not alarming.

Composition: one centred subject occupying the central 65 percent of a square
canvas with at least 15 percent clear margin on all sides; one soft flat ellipse
as a ground shadow beneath the mound. No horizon line, no landscape beyond the
mound, no second scene element.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: mound in #c9f2c0 with #31aa40 grass tufts, tower in #57685a,
broken signal arcs in #e0af3b, cloud in #e3f5da. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO error
codes, NO warning triangle with an exclamation mark, NO wifi glyph lifted from a
UI icon set.

Negative: text, typography, letters, script, numbers, UI chrome, dialog boxes,
buttons, cursors, phone or laptop mockups, screenshots, wifi bars, router, modem,
logos, watermarks, borders, frames, red alarm colouring, skull, sad face, crying
emoji, drop-shadow bevel, glossy 3D render, clay render, neon colours, purple,
magenta, blue-dominant palette, multiple panels, collage, tiling.
```

**Accept when:** the arc break is visible at 120 dp · sits on white cards **and** `#f9fdf6` with no
bounding box · **not mistakable for the cloud family in `WeatherIcons.js`** — a farmer must not read
"offline" as "cloudy".

#### IMG-STATE-003 — Nothing here yet

**Renders at:** the five text-only empty states — `AIChatScreen.js:525`, `MSPTrackerScreen.js:224`,
`CosmicPicker.js:103`, `StateCropsScreen.js:216`, `MyFarmHomeScreen.js:251`.
**Do not** roll this out over the ~25 empty states that already have a good SVG treatment.

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a,
warm soil brown #7E5A3C; a single soft light from the upper left; centred subject
with generous margin; flat plain background; no gradient meshes, no photorealism,
no isometric 3D. Absolutely NO text, letters, numbers, words, logos, watermarks
or signatures anywhere in the image.

Subject: a shallow open woven cane basket resting on flat ground, empty except for
one small green sprout just beginning to grow from the soil directly beside it.
Quiet and inviting — a space waiting to be filled, not a failure.

Composition: one centred subject occupying the central 60 percent of a square
canvas with at least 20 percent clear margin on all sides; one soft flat ellipse
as a ground shadow under the basket. No horizon, no room, no second element.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: basket weave in #7E5A3C with #e0af3b highlights on the rim,
sprout in #005f21 and #31aa40, a small patch of soil in muted brown. Flat colours
only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
magnifying glass, NO question mark, NO empty-box or empty-folder icon, NO dotted
placeholder outline.

Negative: text, typography, letters, script, numbers, question mark, magnifying
glass, empty folder, empty box, dotted outline, dashed placeholder frame, UI
chrome, dialog boxes, buttons, cursors, phone mockups, screenshots, logos,
watermarks, borders, frames, sad face, dust cloud, cobweb, drop-shadow bevel,
glossy 3D render, clay render, neon colours, purple, magenta, blue-dominant
palette, multiple panels, collage, tiling.
```

**Accept when:** reads as *inviting*, not as *broken* · no dotted placeholder outline · distinct at a
glance from `IMG-STATE-005`.

#### IMG-STATE-004 — Success

**Renders at:** [`frontend/src/screens/FarmProfile/ui/CelebrationSheet.js`](../../frontend/src/screens/FarmProfile/ui/CelebrationSheet.js),
alongside or replacing the local inline `<FarmerIllo size={72}>`.

**Leave `OrderConfirmedScreen.js:22` alone** — its `SuccessCheck` is a good inline SVG with breathing
circles, haptics and sound. Do not replace working art.

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a; a
single soft light from the upper left; centred subject with generous margin; flat
plain background; no gradient meshes, no photorealism, no isometric 3D.
Absolutely NO text, letters, numbers, words, logos, watermarks or signatures
anywhere in the image.

Subject: a healthy young plant with four broad leaves growing from a small mound
of soil, with five small warm-gold spark shapes and two thin gold arcs radiating
outward around it in a gentle celebratory burst.

Composition: one centred subject occupying the central 60 percent of a square
canvas with at least 20 percent clear margin on all sides; the gold sparks sit
inside that margin and must not touch any edge; one soft flat ellipse as a ground
shadow. No horizon, no second element.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: leaves in #005f21 and #31aa40, stem in #005f21, soil mound in
#c9f2c0, sparks and arcs in #e0af3b. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
checkmark or tick symbol, NO trophy, NO medal, NO confetti made of rectangles, NO
star ratings.

Negative: text, typography, letters, script, numbers, checkmark, tick, trophy,
medal, ribbon, confetti rectangles, star rating, fireworks, balloons, party
popper, UI chrome, buttons, phone mockups, logos, watermarks, borders, frames,
drop-shadow bevel, glossy 3D render, clay render, neon colours, purple, magenta,
blue-dominant palette, multiple panels, collage, tiling.
```

**Accept when:** celebratory without a tick symbol (the tick is already drawn in code where it is
needed) · sparks stay inside the margin at every density.

#### IMG-STATE-005 — No search results

**Renders at:** `AgriStoreHome.js:851` (the no-search-results branch of its three-way empty state),
`CosmicPicker.js:103` (`No matches for "{query}"`), `SchemeScreen.js:233`.

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a,
warm soil brown #7E5A3C; a single soft light from the upper left; centred subject
with generous margin; flat plain background; no gradient meshes, no photorealism,
no isometric 3D. Absolutely NO text, letters, numbers, words, logos, watermarks
or signatures anywhere in the image.

Subject: three small seedlings of clearly different shapes standing in a row in
soil, with a fourth gap in the row where no seedling grows — just a small empty
depression in the soil. A gentle "the one you wanted is not in this row" idea.

Composition: the row runs horizontally across the centre of a square canvas,
occupying the central 70 percent with at least 15 percent clear margin on all
sides; the empty gap sits third from the left; one continuous soft flat soil band
runs beneath the row as the ground shadow. No horizon, no sky, no second element.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: seedlings in #005f21, #31aa40 and #c9f2c0 so the three read as
different plants, soil band in #7E5A3C, one small gold #e0af3b marker beside the
empty gap. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
magnifying glass, NO question mark, NO crossed-out circle, NO dotted outline in
the empty gap.

Negative: text, typography, letters, script, numbers, magnifying glass, search
glyph, question mark, crossed-out circle, prohibition sign, dotted outline,
dashed frame, UI chrome, search bar, input field, dialog boxes, buttons, cursors,
phone mockups, screenshots, logos, watermarks, borders, frames, sad face,
drop-shadow bevel, glossy 3D render, clay render, neon colours, purple, magenta,
blue-dominant palette, multiple panels, collage, tiling.
```

**Accept when:** the gap in the row is unmistakable at 120 dp · distinct at a glance from
`IMG-STATE-003` · no magnifying glass (that is Lane B).

---

### 5.6 SCENE — the growth-story stages

**This is the one place in the codebase that already asks for AI-generated imagery.**
[`GrowthStoryScreen.js:10-13`](../../frontend/src/screens/FarmProfile/GrowthStoryScreen.js) documents a
three-tier fallback:

```
1. the farmer's OWN field photos logged against the cycle
2. an AI-generated per-crop-per-stage image  (runtime endpoint)   ← never built
3. the crop's bundled illustration (CropIcon) on a themed stage scene
```

**Build tier 2 as eight bundled *stage backdrops*, not as 21 crops × 8 stages = 168 runtime images.**
The reason is in the code: `StageScene` (`:226`) already composites a `<CropIcon>` on top of a themed
background, and `STAGES` (`:41-48`) already carries a `sky` gradient pair, a `soil` colour and an icon
`scale` per stage. Replacing the flat gradient with a real illustrated field backdrop — while keeping the
per-crop `CropIcon` composited on top — gets the visual payoff of tier 2 for **8 assets instead of 168**,
with no runtime generation, no per-crop cost, and no risk of a model inventing a crop that does not
match what the farmer planted.

All eight: **Lane V · gen 1536×1024 transparent · quality `medium` · n=3 · B4**, delivered **720×480
WebP @1x only** (a decorative backdrop upscales harmlessly) to `frontend/assets/scenes/stage-*.webp`,
cap **30 KB**.

**Shared clauses for all eight** — paste the Lane V preamble (§4.1), then:

```text
Composition: a wide empty field backdrop. A low horizon sits at 55 percent height.
The CENTRAL 40 percent of the frame must be visually EMPTY and low in contrast —
the app composites a crop illustration there at runtime. Detail belongs only in
the far left and far right thirds and along the horizon. No single dominant
object, no focal point, no figure.

Canvas: landscape 3:2. Background: fully transparent above the horizon so the
app's own sky gradient shows through; the soil band is opaque.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
signboards, NO markers with writing, NO watermarks.

Negative: text, typography, letters, script, numbers, signboards, field markers,
scarecrow, human figures, animals, buildings, UI chrome, buttons, logos,
watermarks, borders, frames, red barns, silos, picket fences, rolling green
pasture, tulips, large Western combine harvester, centre-frame focal object,
glossy 3D render, clay render, neon colours, purple, magenta, blue-dominant
palette, multiple panels, collage, tiling.
```

Then per stage, substitute the **Subject** and **Palette anchor** below. Each anchor is lifted straight
from `STAGES[n]` so the generated art and the code agree by construction.

| ID | Stage (`STAGES[n]`) | Subject clause | Palette anchor (`sky` → `soil`) |
|---|---|---|---|
| SCENE-001 | `PLANNING` (`:41`) | bare unworked ground with dry stubble and a few scattered stones; a thin line of neem trees along the far bund | soil `#9C7A55`; horizon greens toward `#CFE0C4` |
| SCENE-002 | `LAND_PREP` (`:42`) | freshly ploughed soil in deep parallel furrows running toward the horizon; loose clods, no crop | soil `#7E5A3C`; horizon warms toward `#D8C3A2` |
| SCENE-003 | `SOWING` (`:43`) | flat prepared beds with faint seed lines and a few just-emerged specks of green | soil `#6B4A30`; horizon greens toward `#C7DDAE` |
| SCENE-004 | `VEGETATIVE` (`:44`) | dense low green foliage covering the beds, soil barely visible between rows | soil `#5C7C3A`; horizon `#9CC97E` |
| SCENE-005 | `FLOWERING` (`:45`) | lush green rows dotted with small pale flowers, a few bees implied as tiny gold specks | soil `#4F7A34`; horizon `#86BE6A` |
| SCENE-006 | `FRUITING` (`:46`) | heavy green rows with the plants visibly weighted down, deeper shadow between rows | soil `#4A722F`; horizon `#7FB45F` |
| SCENE-007 | `MATURITY` (`:47`) | the field turned gold and dry, stalks leaning, warm late light | soil `#9C7E2E`; horizon `#D9C36A` |
| SCENE-008 | `HARVESTED` (`:48`) | cut stubble rows, a few stacked bundles at the far left edge only, open cleared ground | soil `#B79237`; horizon `#C9B25A` |

**Accept when (all eight):** the central 40 % is empty enough that a `<CropIcon>` composites cleanly on
top · the eight read as a *progression* when viewed in sequence · no figures, animals or buildings ·
each soil band matches its `STAGES[n].soil` hex within a shade.

**Do not:** draw a specific crop. The crop is `<CropIcon>`, composited at runtime from the farmer's
actual cycle. A generated soybean behind a farmer's cotton icon is worse than the flat gradient it
replaced.

---

#### IMG-SCAN-001 — How to photograph a leaf

**Lane V · gen 1024² transparent · quality `medium` · n=3 · B4 · TODO**

**Renders at:** [`frontend/src/screens/AI/CropScanScreen.js:1237`](../../frontend/src/screens/AI/CropScanScreen.js) —
the amber `photoTipCard` at step 3 of the scan wizard. Today it is a `bulb-outline` Ionicon and four
lines of text (`cropScan.photoTips1..4`), with **no diagram and no example**. Place the illustration
above the tip list at `width: 200`.

The four tips stay as localised text — they say "20–30 cm", "both healthy and diseased parts", "natural
light", "front and back", and numbers plus multilingual copy do not belong in a generated image. The
illustration carries only the one thing text conveys badly: **how close to hold the phone.**

**Params:** `size:1024x1024` `quality:medium` `background:transparent` `output_format:png` `n:3`

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from deep forest green #005f21, leaf green #31aa40,
pale green #c9f2c0, mint #e3f5da, warm gold #e0af3b, muted grey-green #57685a; a
single soft light from the upper left; centred subject with generous margin; flat
plain background; no gradient meshes, no photorealism, no isometric 3D.
Absolutely NO text, letters, numbers, words, logos, watermarks or signatures
anywhere in the image.

Subject: a side-on diagram view of one simplified hand holding a plain rectangular
phone body — seen from behind so no screen is visible — held close to and squarely
facing a single broad leaf on a short stem. A short thin gold double-headed arrow
runs horizontally between the phone and the leaf, indicating a small deliberate
gap. The leaf is lit evenly and flatly with no cast shadow across its face.

Composition: the phone and hand occupy the left third of a square canvas, the leaf
the right third, the gold gap arrow between them at mid-height. At least 15 percent
clear margin on all sides. One soft flat ellipse as a ground shadow under the leaf
stem. Single panel only — this is one scene, not a comparison.

Canvas: square 1:1. Background: fully transparent.

Palette anchor: leaf in #31aa40 with #005f21 veins, hand in #c9f2c0, phone body in
#57685a, gap arrow in #e0af3b. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
measurement figures beside the arrow, NO visible phone screen, NO camera UI, NO
shutter button, NO tick or cross marks, NO second comparison panel.

Negative: text, typography, letters, script, numbers, measurements, dimension
figures, rulers, tick marks, cross marks, checkmark, prohibition sign, side-by-side
comparison, split screen, two panels, before-and-after, UI chrome, camera
viewfinder, shutter button, visible phone screen, screenshots, tripod, ring light,
logos, watermarks, borders, frames, glossy 3D render, clay render, neon colours,
purple, magenta, blue-dominant palette, collage, tiling.
```

**Post-processing:** resize 320 / 640 · WebP q=90 → `frontend/assets/illustrations/scan-howto*.webp`.
Cap **20 KB @2x**.

**Accept when:** the gap between phone and leaf is unmistakable · **one panel only** — reject any
do/don't split, which is the failure mode this prompt fights hardest · no visible screen or camera UI.

---

### 5.7 WX — weather backdrops · `KEEP`

`IMG-WX-001..008` already exist as real photography in `frontend/assets/weather/`, mapped by WMO code +
local hour in [`frontend/src/utils/weatherBackground.js:10-18`](../../frontend/src/utils/weatherBackground.js)
and consumed by `WeatherHome.js:475` and `ProfileScreen.js:542`/`:651`.

**No generation.** They are re-encoded only, as part of B3:

| File | Now | After |
|---|---|---|
| `wx_clear_day.jpg` | 93,964 B | WebP q72 |
| `wx_clear_morning.jpg` | 71,724 B | WebP q72 |
| `wx_clear_night.jpg` | 64,444 B | WebP q72 |
| `wx_cloudy.jpg` | 46,284 B | WebP q72 |
| `wx_rain_day.jpg` | 51,113 B | WebP q72 |
| `wx_rain_night.jpg` | 60,753 B | WebP q72 |
| `wx_sunrise.jpg` | 84,248 B | WebP q72 |
| `wx_thunderstorm.jpg` | 52,570 B | WebP q72 |
| **total** | **525,100 B** | **≈ 250 KB** |

Half the bytes for free. `frontend/assets/weather/compress.sh` is superseded by §6.3 — fold it in or
leave it as the historical record.

The **9 SVG condition icons** in `frontend/src/components/WeatherIcons.js` are Lane A. Do not generate
weather icons.

---

### 5.8 SELLER

The seller app today ships **four byte-identical copies of the farmer app's assets** — same md5 on
`icon.png`, `adaptive-icon.png`, `splash.png`, `favicon.png` — and a splash `backgroundColor` of
`#1B4332` (farmer forest green), despite `seller-app/src/theme/index.js` declaring an entirely different
**harvest-orange `#E65100` on parchment `#FAF4EC`** identity.

#### IMG-SELLER-001 — Seller app mark · derived, 0 generations

Recolour `IMG-BRAND-001` in post: shoot and leaves `#005f21`→ keep, cupped hand `#c9f2c0` →
`#FAF4EC`, sun disc `#e0af3b` → `#E65100`. Same silhouette, so the two apps read as one family on a
home screen while staying distinguishable. Produces the full `IMG-LAUNCH-001..006` set into
`seller-app/assets/`, with `adaptiveIcon.backgroundColor` `#E65100` and the same config keys as §6.6.

#### IMG-SELLER-002 — Seller dashboard hero

**Lane V · gen 1536×1024 transparent · quality `medium` · n=3 · B5 · TODO**

**Renders at:** `seller-app/src/screens/DashboardScreen.js` — **NEW**, as a header backdrop above the
four stat cards.

**Prompt**

```text
Flat vector illustration, semi-flat with soft long shadows and a subtle paper
grain; clean geometric shapes, rounded stroke ends, no outlines on large fills;
limited palette drawn ONLY from harvest orange #E65100, warm parchment #FAF4EC,
deep forest green #005f21, leaf green #31aa40, warm gold #e0af3b, muted
grey-green #57685a, warm soil brown #7E5A3C; a single soft light from the upper
left; flat plain background; no gradient meshes, no photorealism, no isometric 3D.
Absolutely NO text, letters, numbers, words, logos, watermarks or signatures
anywhere in the image.

Subject: the open front of a small Indian agricultural-input shop — a simple
counter with a shallow awning above it, three stacked seed sacks on the left, two
sealed fertilizer bags on the right, and a small hand sprayer standing on the
counter. No shopkeeper, no customer.

Composition: the shop front runs across a landscape frame with the counter along
the lower third; the awning caps the upper edge. Leave the CENTRAL 30 percent
visually quiet and low in contrast — the app lays stat cards over it. One
continuous soft flat ground shadow beneath the whole scene.

Canvas: landscape 3:2. Background: fully transparent.

Palette anchor: awning in #E65100, counter in #7E5A3C, seed sacks in #FAF4EC with
#005f21 ties, fertilizer bags in #31aa40, sprayer in #57685a, one gold #e0af3b
highlight along the awning edge. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO shop
signboard, NO price labels, NO product labels on the sacks or bags, NO brand marks.

Negative: text, typography, letters, script, numbers, signboard, shop sign,
banner, price labels, product labels, barcodes, currency symbols, brand marks,
logos, watermarks, human figures, UI chrome, buttons, phone mockups, borders,
frames, red barn, silo, glossy 3D render, clay render, neon colours, purple,
magenta, blue-dominant palette, multiple panels, collage, tiling.
```

**Post-processing:** resize 720 / 1440 · WebP q=90 → `seller-app/assets/illustrations/dashboard-hero*.webp`.
Cap **35 KB @2x**.

**Accept when:** the central 30 % survives stat cards laid over it · no signboard (that is where a model
will try to write text) · reads as an Indian krushi kendra, not a Western general store.

---

### 5.9 PLAY — store listing, never bundled

`IMG-PLAY-001..003` live in `docs/branding/store/`; `IMG-PLAY-004` is served by Vite from
`admin/public/`. **None of them ever enter an app bundle.**

**English text is permitted on `IMG-PLAY-002` and `IMG-PLAY-003` only**, and even there it is
**composited in post from real type, not generated** — same reason as §2.2.

#### IMG-PLAY-001 — Play Store icon · derived, 0 generations

`IMG-LAUNCH-001` at **512×512, 32-bit PNG, no alpha, no rounded corners** (Play applies its own mask).
Per the request that started this: **do not put the word KrushiSarva in the store icon.** The mark alone.

#### IMG-PLAY-002 — Feature graphic (1024×500)

**Lane P · gen 1536×1024 opaque · quality `high` · n=4 · B5 · TODO**

1024×500 is **not a supported generation size** (§6.1). Generate 3:2 with deliberate over-framing, then
centre-crop to 2.048:1 and resize.

**Prompt** — Lane P preamble (§4.2), then:

```text
Subject: a wide establishing view of Maharashtra farmland in the golden hour — a
sequence of bunded jowar and cotton plots stepping back toward low dry hills, with
one small compact tractor parked far to the right at the field edge and a line of
neem trees along the left bund.

Setting: dark grey-black cotton soil, warm low side light, clear late-afternoon
sky with a little haze on the horizon.

Composition and safe area: eye-level, no aerial view. The horizon sits at 60
percent height. The LEFT 45 percent of the frame must be open sky and quiet
low-contrast field, holding no subject at all — the store graphic composites the
app mark and a headline there. Interest belongs in the right third. Frame with
generous space above and below the horizon so a 1024 by 500 centre band can be
cropped out without losing the composition.

Canvas: landscape 3:2. Background: full-bleed photographic scene, no transparency.

Palette anchor: greens reading toward #005f21 in shadow, warm gold #e0af3b in the
light, dark grey-black soil. No blue cast, no teal grade.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO
signboards or hoardings, NO logos on the tractor, NO number plate, NO watermarks.

Negative: text, signage, hoardings, banners, logos, brand badges, number plates,
watermarks, human figures, red barns, silos, picket fences, rolling green pasture,
tulips, sunflower fields, maize monoculture, large Western combine harvester,
drone or aerial view, tractor centre-frame, HDR halo, teal-and-orange grading,
oversaturation, purple sky, collage, multiple panels, split screen, borders,
frames, vignette.
```

**Post-processing:** centre-crop to 2.048:1 → resize 1024×500 → composite `IMG-BRAND-001` +
`IMG-BRAND-002` (Fraunces 700, white) into the left 45 % → PNG →
`docs/branding/store/feature-graphic.png`.

**Accept when:** the left 45 % genuinely holds the lockup without crowding · nothing important is lost
to the 2.048:1 crop · no text or signage generated anywhere in the plate.

#### IMG-PLAY-003 — Screenshot backdrop

**Lane V · gen 1024×1536 transparent · quality `medium` · n=3 · B5 · TODO**

A single reusable backdrop panel; the **six to eight device frames composited on top are real
screenshots**, and each screenshot's Marathi headline is set in real type in post — never generated.

Suggested screenshot sequence (real captures, in this order): AgriStore home · Krushi Drishti scan
result · Mandi Bhav · Weather home · Rent home · Animal Trade home · Govt Schemes · My Farm growth story.

**Prompt** — Lane V preamble (§4.1), then:

```text
Subject: an abstract decorative backdrop panel — a soft field horizon low in the
frame with two gentle overlapping green hills, three small flat leaf shapes
floating in the upper corners, and one thin gold arc sweeping across the upper
third. No figures, no objects, no focal point.

Composition: the CENTRAL 70 percent of a tall portrait frame must be almost empty
and very low in contrast — a phone screenshot is composited there. All interest
belongs in the top 15 percent and bottom 15 percent only.

Canvas: tall portrait 2:3. Background: fully transparent.

Palette anchor: hills in #005f21 and #31aa40, floating leaves in #c9f2c0, arc in
#e0af3b, everything else transparent. Flat colours only.

Restated: NO text, NO letters, NO Devanagari or Latin script, NO numbers, NO phone
frame, NO device mockup, NO screenshot content, NO app UI of any kind.

Negative: text, typography, letters, script, numbers, phone frame, device mockup,
bezel, screenshot, app UI, dialog boxes, buttons, cursors, logos, watermarks,
borders, frames, centre-frame focal object, human figures, glossy 3D render, clay
render, neon colours, purple, magenta, blue-dominant palette, multiple panels,
collage, tiling.
```

**Post-processing:** flatten onto `#f9fdf6` → resize 1080×1920 → PNG →
`docs/branding/store/screenshot-backdrop.png`.

**Accept when:** a 1080×1920 screenshot at 78 % scale sits on it without colliding with any art.

#### IMG-PLAY-004 — Social / OG card (1200×630)

**Lane P · gen 1536×1024 opaque · quality `high` · n=3 · B5 · TODO**

Same prompt as `IMG-PLAY-002` with the safe area moved: **the left 40 % and the bottom 25 % stay quiet**,
because the lockup sits left and link-preview UI crops the bottom. Crop to 1.905:1, resize 1200×630,
composite the lockup → `admin/public/og-card.png`, referenced from `admin/index.html` as `og:image` and
`twitter:image`.

---

### 5.10 WEB

#### IMG-WEB-001 — Admin favicon · derived, 0 generations

[`admin/index.html`](../../admin/index.html) declares **no icon link at all** today, and
**`admin/public/` does not exist** (verified). Create it — Vite serves `public/` at `/`.

From `IMG-BRAND-001`: `favicon.png` 64² and `apple-touch-icon.png` 180² → `admin/public/`.
Config in §6.6.

The admin sidebar wordmark at `admin/src/components/AppShell.tsx:39` is a lucide `<Sprout>` glyph plus
text, **not an image** — leave it, or swap the glyph for `IMG-BRAND-002` at small size during the rename.

---

## 6. Generation and integration pipeline

### 6.1 Model and parameters

**This is the only section in this document that names a model.** A future swap is a one-line edit here.

Model: **`gpt-image-1`**, via `POST /v1/images/generations`.

| Param | Value | Note |
|---|---|---|
| `model` | `gpt-image-1` | |
| `size` | `1024x1024` · `1536x1024` · `1024x1536` | **the only three.** Never request 1024×500 or 1284×2778 — see §6.2 |
| `quality` | `high` for BRAND / AUTH / PLAY; `medium` for STATE / ONBOARD / SCENE / SCAN | the main cost lever |
| `background` | `transparent` for every Lane V asset; `opaque` for Lane P | transparency requires `output_format` `png` or `webp` |
| `output_format` | `png` always | format conversion happens in post, never at the API |
| `n` | `4` for BRAND / AUTH-001 / PLAY; `3` otherwise | a human picks one; rejects go to `docs/branding/masters/rejects/` |
| response | **base64 (`b64_json`)** | `gpt-image-1` returns base64, not a URL — the script decodes and writes; there is nothing to `curl` |

> **Verify the model id, supported sizes and current pricing against the OpenAI images documentation
> before each run.** Treat the table above as of this document's date.

Budget: order of **tens of dollars** for all 25 at these settings. The expensive resource here is human
picking time, not API spend — which is exactly why §5 carries an `Accept when:` line per asset.

### 6.2 Non-native aspect ratios

**Generate at the nearest supported ratio with deliberate over-framing, then crop down. Never upscale,
never stretch, never ask the model for an unsupported size.**

| Target | Ratio | How |
|---|---|---|
| Feature graphic 1024×500 | 2.048 : 1 | generate `1536x1024`, centre-crop to 2.048:1, resize |
| OG card 1200×630 | 1.905 : 1 | generate `1536x1024`, centre-crop, resize |
| Splash 1284×2778 | 0.462 : 1 | **do not generate.** `expo-splash-screen` + a 1024² mark on flat `#005f21`; the OS composes the canvas. Deletes 683 KB and the extreme-ratio problem together |
| Play screenshots 1080×1920 | — | **real screenshots.** Only the backdrop panel is generated (`IMG-PLAY-003`) |
| Adaptive foreground | 1:1, 66 % safe zone | generate 1024² with ≥ 20 % margin (the `IMG-BRAND-001` composition clause enforces it), then scale the mark to 50 % width so it lands inside the 72 dp safe circle |

### 6.3 Post-processing chain

One `sharp` pass per output:

```
b64_json → decode → PNG (1024² | 1536×1024 | 1024×1536)
  → archive raw to docs/branding/masters/<ID>-<n>.png        (never edited again)
  → extract()          crop to target aspect, explicit gravity
  → resize()           to the largest delivered edge, kernel: lanczos3
  → withMetadata(false)  strip EXIF / ICC
  → emit:
       .webp   q=72 photographic · q=90 flat art     (default runtime asset)
       .png    ONLY where an Expo config key demands PNG
  → density buckets: name.webp / name@2x.webp / name@3x.webp, same folder
       (Metro resolves the suffixes from one require(); no code change needed)
  → assert file size against the per-asset cap; FAIL LOUDLY if over
```

Four rules that are not negotiable:

1. **Every Expo *config* asset stays PNG.** `icon`, `adaptiveIcon.foregroundImage`,
   `adaptiveIcon.monochromeImage`, the `expo-notifications` icon, the `expo-splash-screen` image and
   `web.favicon` are consumed by prebuild and native tooling, not by `<Image>`. WebP there fails the
   build or silently degrades.
2. **Everything loaded by `require()` / `<Image>` is WebP.** Metro's default `assetExts` includes `webp`
   and RN 0.81 decodes static WebP on both platforms — but **verify once on a real low-end Android
   device before converting anything on the launch path** (§9.3).
3. **Full-bleed `resizeMode="cover"` images get one density, not three.** `welcome-hero`, the growth-story
   scenes and the weather backdrops are decorative fills; @2x/@3x triples the APK for no perceptible gain.
4. **The masters are never edited.** Every delivered file is reproducible from
   `docs/branding/masters/` plus this document.

### 6.4 The one-off script

```
scripts/brand-assets/
  package.json        # devDeps: openai, sharp   (ESM, "type": "module")
  manifest.mjs        # export const ASSETS = [{ id, group, lane, prompt, size,
                      #   quality, background, n, crop, outputs: [{path,w,fmt,q,cap}] }]
  generate.mjs        # OPENAI_API_KEY -> images.generate -> masters/   (one ID, or --all)
  postprocess.mjs     # sharp: crop / resize / encode / density / size-assert
  README.md           # how to run, where the key comes from
```

`scripts/` already holds two one-off Node ESM tools (`admin-smoke.mjs`, `render-latest-report.mjs`), so
this matches the repo's existing home for out-of-band tooling. **There is no root `package.json`
(verified), so this directory gets its own.**

- **`sharp` must never land in `frontend/package.json` or `seller-app/package.json`** — it is a native
  module and would be pulled into every app install. It is a build-time dependency of this script only.
- `OPENAI_API_KEY` is read from the environment. Slots already exist at `fastapi/.env.example:84` and
  `backend/.env.example:270`. **No key is committed, and this script is never wired into any server.**
- **Explicitly not a backend route or a FastAPI provider.** Image generation here is a *design act*
  performed a handful of times by a human who then picks a candidate. No product surface needs a raster
  at runtime — including the growth-story tier 2, which §5.6 deliberately solves with 8 bundled
  backdrops instead of a runtime endpoint.

**Source-of-truth rule:** `manifest.mjs` is the executable copy of the prompts; **§5 of this document is
the human copy. When they disagree, the markdown wins and the manifest is corrected.** Do not build a
markdown parser to unify them — brittle, for a small risk, on prompts a human reviews anyway. Logged as
a known risk in §9.4 rather than engineered away.

### 6.5 Output path map

| Group | Path | Format |
|---|---|---|
| archived masters + rejects | `docs/branding/masters/` | PNG (raw from API) |
| farmer config assets | `frontend/assets/` — `icon.png`, `adaptive-icon-foreground.png`, `adaptive-icon-monochrome.png`, `notification-icon.png`, `splash-mark.png`, `favicon.png` | PNG |
| auth art (shared by both apps) | `shared/assets/khet/` | WebP |
| farmer illustrations | `frontend/assets/illustrations/` | WebP |
| growth-story scenes | `frontend/assets/scenes/` | WebP |
| weather backdrops | `frontend/assets/weather/` (existing) | WebP (re-encoded) |
| seller app | `seller-app/assets/` + `seller-app/assets/illustrations/` | PNG config · WebP art |
| admin | `admin/public/` — **must be created** | PNG |
| Play Store | `docs/branding/store/` — never in any bundle | PNG |
| dead stubs | `backend/assets/` — **delete.** Four 137-byte solid-colour placeholders plus a stale weather copy; nothing in `backend/src` references them | — |

### 6.6 Config keys that must change

The fact that decides this whole section: **`frontend/android/` and `frontend/ios/` are gitignored**
(`.gitignore:82-83`, `frontend/.gitignore:18-19`). This is CNG/prebuild output. You **cannot** hand-place
`ic_stat_*.png` in `res/`, and `values/colors.xml` is *generated*. **Every change goes through `app.json`.**

`frontend/app.json` and `seller-app/app.json`:

1. `android.adaptiveIcon.foregroundImage` → `./assets/adaptive-icon-foreground.png`
   — **the highest-impact single fix here.** Today it is byte-identical to `icon.png` with no alpha and
   no safe zone.
2. `android.adaptiveIcon.monochromeImage` → `./assets/adaptive-icon-monochrome.png` — currently absent;
   Android 13+ themed icons fall back to a flat blob.
3. `android.adaptiveIcon.backgroundColor` → `#005f21` (seller: `#E65100`).
   **Do not add `backgroundImage`** — a flat colour is smaller, survives launcher parallax, and avoids a
   second asset to keep in sync.
4. Convert `expo-notifications` from a bare string to a config tuple:
   ```json
   ["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#005f21" }]
   ```
   Today it carries no icon and there is no `notification` block, so **every push shows the default
   Android bell.** Remember the alpha-mask gotcha in §5.2.
5. Replace the deprecated top-level `splash` key with the plugin:
   ```json
   ["expo-splash-screen", {
     "image": "./assets/splash-mark.png", "imageWidth": 200,
     "resizeMode": "contain", "backgroundColor": "#005f21",
     "dark": { "backgroundColor": "#06210d" }
   }]
   ```
   **Requires `npx expo install expo-splash-screen` — verified not installed in either app.** This also
   retires `#1B4332`, which is not a token in any theme file.
6. `icon` → the new 1024² opaque PNG. `web.favicon` → the new 64² PNG.
7. **Out of scope here:** `name`, `slug`, `scheme`, `bundleIdentifier`, `package`, the four iOS usage
   strings and the two plugin permission strings all still say KrushiSarva. That is the rename task — and
   note that changing `package` / `bundleIdentifier` means a **new Play listing, not an update**.

`admin/index.html` — add, and create `admin/public/`:
```html
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:image" content="/og-card.png">
<meta name="twitter:image" content="/og-card.png">
```

`frontend/App.js` — the two `ActivityIndicator`-on-solid-green screens (font-load ~`:110`, `RootNavigator`
auth-load ~`:44`) both get `splash-mark.png` above the spinner. **Zero new generations, reuses
`IMG-LAUNCH-005` — the cheapest identity win in the whole plan.**

### 6.7 Provenance manifest

`docs/branding/masters/generated.json`, one record per generation:

```json
{ "id": "IMG-BRAND-001", "model": "gpt-image-1", "size": "1024x1024",
  "quality": "high", "background": "transparent", "n": 4,
  "prompt_sha256": "…", "generated_at": "…", "picked_index": 2, "operator": "…" }
```

Play Store policy and any future licensing question needs an answer to "where did this image come
from", and the prompt hash makes a regeneration reproducible without storing 25 prompts twice.

### 6.8 Generating through the ChatGPT UI instead of the API

**A ChatGPT Plus/Pro subscription does not include API credits.** `chatgpt.com` and
`platform.openai.com` are billed separately. If you are working from a subscription, you generate in
the browser and paste by hand — which is entirely workable, and changes only three things.

**1 — There is no `background` parameter.** Fold it into the prompt. Replace the
`Canvas / Background` clause (§4.3 clause 6) with:

```text
Canvas: square 1:1. Return a PNG with a fully transparent background.
```

If the result comes back opaque — the UI is less reliable about transparency than the API — regenerate
with a chroma key instead:

```text
Canvas: square 1:1. Background: one flat uniform pure magenta #FF00FF field, edge to
edge, used only as a chroma key — no magenta anywhere in the subject itself.
```

then run `node postprocess.mjs <ID> --key`, which keys the magenta out to alpha with a soft edge band.
Magenta is the right key here precisely because the global negative string (§4.4) already bans magenta
from every subject, so no subject pixel can collide with it.

**2 — There is no `n` parameter.** You get one image per send. Send the same prompt two or three more
times to get the candidates the `n` column in §5 asks for. Do not ask for "4 variations" in one
message — that returns a contact sheet in a single image, which is useless.

**3 — ChatGPT rewrites prompts before handing them to the image tool.** On a long structured prompt it
will often summarise, which quietly drops the safe-area and no-text clauses that make these assets
usable. Prefix every paste with:

```text
Generate an image using exactly the specification below. Do not rewrite, summarise,
shorten or reinterpret it. Follow every clause literally, including the negatives.
```

Everything else is unchanged: same three sizes (§6.1), the same prompts in §5, the same
post-processing (§6.3), the same output paths (§6.5).

**Workflow**

1. Paste the prompt from §5 (with the two edits above) into ChatGPT.
2. Download the image and save it as `docs/branding/masters/<ID>.png` — e.g. `IMG-BRAND-001.png`.
3. `cd scripts/brand-assets && node postprocess.mjs IMG-BRAND-001 --dry` to preview.
4. Drop `--dry` to write. Add `--key` if you used the magenta background. Add `--force` only when you
   intend to overwrite an asset that already exists — `icon.png` and `favicon.png` are real files today,
   so the script skips them by default.

---

## 7. Bundled vs remote

Measured today: the farmer app bundles **4,668,688 bytes** of raster across ten files, of which
**2.99 MB is two byte-identical copies of the same 1024×1024 PNG.**

After this plan: **≈ 1.15 MB across ~30 files.** Twenty-plus new images, and still **−3.5 MB of APK.**

**Rule:** bundle it if it must render with zero network, or before the JS bundle is parsed. Otherwise, if
it is over ~40 KB and not on the offline path, it goes to Cloudinary under `krushisarva/brand/` and is
fetched through the existing `imageVariant(url, width)` helper in
[`backend/src/utils/imageVariants.js`](../../backend/src/utils/imageVariants.js)
(`f_auto,q_auto:eco,w_N,c_limit`).

| Bundle | Why |
|---|---|
| all six LAUNCH files, both apps | consumed by native tooling; remote is not possible |
| `IMG-AUTH-001..003` | pre-auth, often a first launch on a 2G connection |
| `IMG-ONBOARD-001..003` | first run, before the user has any reason to wait |
| `IMG-STATE-001`, `-002` | by definition the network is gone |
| `IMG-STATE-003..005` | tiny flat vectors, ~15 KB each |
| `IMG-SCAN-001` | the scan wizard must work in a field with no signal |
| `IMG-WX-001..008` | already bundled; the JPEG→WebP re-encode halves 525 KB for free |
| `IMG-SCENE-001..008` | @1x only, ~28 KB each; a decorative backdrop upscales harmlessly |

| Remote / not bundled | Why |
|---|---|
| `IMG-PLAY-001..003` | never in an app bundle; `docs/branding/store/` |
| `IMG-PLAY-004`, `IMG-WEB-001` | served by Vite from `admin/public/` |
| future seasonal / festival / campaign banners | must change without a store release — CMS-driven, per the original brief |
| licensed disease reference photography, if ever acquired | large, agronomist-curated, updated independently of releases |

Per-file caps, asserted by `postprocess.mjs` and failing the build if exceeded:

```
launcher PNG          ≤ 120 KB
flat-vector WebP @2x  ≤  25 KB
scene WebP @1x        ≤  30 KB
photographic WebP     ≤ 140 KB
```

**The important "do not bundle" call is the empty states.** There are ~30 of them. Do not commission 30
illustrations — that is ~900 KB of APK to say "nothing here yet" thirty slightly different ways. Ship
one, keep the good SVG treatments, upgrade only the five text-only states. See §2.3.

---

## 8. Batch plan

| Batch | Assets | Gens | What it buys |
|---|---|---:|---|
| **B1 — Identity** | `IMG-BRAND-001` → `LAUNCH-001..006`; `BRAND-002` hand-typeset | **1** | The app *is* KrushiSarva — home screen, launcher, notification shade, splash, both `App.js` load screens, browser tab. One generation, six shipped files, five config edits. Lands the adaptive-icon fix and −2.7 MB. **Do this before anything else.** |
| **B2 — First run** | `AUTH-001..003`, `ONBOARD-001..003` | **6** | Every screen a brand-new user sees before they have an account — including the two genuinely blank auth steps and a carousel that does not exist yet. |
| **B3 — Failure** | `STATE-001..005`; re-encode `WX-001..008` | **5** | Crash boundary, offline (7 call sites), empty, success, no-results. The screens that decide whether a farmer on a weak network trusts the app. Weather is re-encode only. |
| **B4 — Depth** | `SCENE-001..008`, `SCAN-001` | **9** | The eight growth-story stage backdrops — the tier-2 slot the code has been asking for since it was written — plus the scan how-to that replaces four lines of text with the one thing text conveys badly. |
| **B5 — Outside** | `PLAY-001..004`, `SELLER-001..002`, `WEB-001` | **4** | Store listing, the seller app's own identity, admin favicon. |

**25 generations. ~70 delivered files.** That number is the proof §2 did its job.

---

## 9. Risks and forced decisions

**9.1 — Three "Krushi"s at three levels.** After the rename: **KrushiSarva** (product) · **Krushi
Intelligence / Krushi Drishti / Krushi Vaani / Krushi Gyaan** (AI features) · **Krushi Seva Kendra**
(sellers). The word stops carrying any distinction. Consequence for *this* document: the AI sub-brands
can no longer be told apart by name at a glance, so they must be told apart by **icon and colour** —
which raises the stakes on `frontend/src/components/AIServiceIcons.js` (only 4 marks today) and argues
for reserving the gold `#e0af3b` accent for AI surfaces. Flagged here; not solved here.

**9.2 — Three unrelated brand greens ship today.** `#005f21` ([`khetTheme.js`](../../shared/constants/khetTheme.js)),
`#176B43` ([`colors.js`](../../shared/constants/colors.js), still headed *"FarmEasy Design System"* — a
*fourth* historic brand name), `#15803d` (`admin/tailwind.config.js:8`). Plus `#1B4332` in `app.json` and
generated native colours, which is **not a token in any theme file**, and a stale Expo-default `#023c69`
in `values/colors.xml`.

> **Decision forced by this document: all generated art is built against `#005f21`.** That effectively
> makes KHET the brand and orphans the other three. This is a decision being made, not a discovery — if
> you disagree, change it *here, before B1*, because every prompt in §5 quotes it.

**9.3 — WebP on low-end Android.** Metro handles `.webp` and RN 0.81 decodes it, but the target device is
a cheap Android phone. Verify on real hardware before converting anything on the launch path. Config
assets stay PNG regardless (§6.3).

**9.4 — Prompt/manifest drift** between §5 and `manifest.mjs`. Accepted deliberately (§6.4); the markdown
wins.

**9.5 — Model and pricing drift.** §6.1 is the only place a model is named; re-verify before each run.

**9.6 — `expo-splash-screen` is not installed** and the top-level `splash` key is deprecated in SDK 54.
B1 cannot land without adding the dependency and re-running prebuild.

**9.7 — `userInterfaceStyle: "light"` is forced** in both apps, so the `dark` splash variant is currently
dead config. Add it anyway, so the day someone removes that line the splash does not flash white.

**9.8 — Provenance.** Generated imagery in a Play Store listing; keep `generated.json` (§6.7).

**9.9 — Never generate diagnostic imagery.** Restating §2.3 because it is the one item here with a
physical-world consequence: a hallucinated lesion beside a real diagnosis can cause a farmer to spray the
wrong chemical on a real field. Disease and pest reference imagery must be licensed photography curated
by an agronomist, or it must not exist.

---

## Appendix — token reference card

```
KHET (shared/constants/khetTheme.js)
  primary #005f21   primaryGlow #31aa40   accent  #c9f2c0   secondary #e3f5da
  muted   #edf5e7   mutedForeground #57685a   border #d7e1d5
  background #f9fdf6   card #ffffff   foreground #06210d
  gold    #e0af3b   destructive #df2225
  gradPrimary  #005f21 → #008935                      (135°)
  gradSurface  #f8fef4 → #e1f6dc                      (160°)
  gradHero     rgba(0,36,3,0) → rgba(0,36,3,0.55) → rgba(0,24,3,0.96)  @ 0, 0.45, 1

FONTS   display Fraunces (400/400i/600/700) · sans Plus Jakarta Sans (400–800)

SOIL    #9C7A55  #7E5A3C  #6B4A30  #5C7C3A  #4F7A34  #4A722F  #9C7E2E  #B79237
SKY     #CFE0C4  #D8C3A2  #C7DDAE  #9CC97E  #86BE6A  #7FB45F  #D9C36A  #C9B25A
        (GrowthStoryScreen.js:41-48 — SCENE-001..008 in order)

SELLER  #E65100 harvest orange · #FAF4EC parchment  (seller-app/src/theme/index.js)

SVG KIT house style (shared/components/CropIcons.js)
  viewBox "0 0 200 200" · radial + linear gradients · ground shadow ellipse cy≈178
  · top-left shine · realistic palette
```
