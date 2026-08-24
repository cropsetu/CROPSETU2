# KrushiSarva — Image Process

> **Companion to [`IMAGE_ASSETS.md`](./IMAGE_ASSETS.md), and a deliberate widening of it.**
> That document minimised generation to 25 images. This one covers **every image slot in the app**,
> because the goal changed: from *"give the app a brand"* to **"make the app navigable without
> reading"**.
> **Status:** PLAN · nothing generated yet · line numbers approximate, confirm before editing.

---

## 0. What changed, and why

`IMAGE_ASSETS.md` §2 said *do not generate art for crops, animals, categories, weather or soil* —
because a hand-drawn SVG kit already covers them, tintable and free.

That reasoning was correct **about cost** and incomplete **about users**. This repo's own
[`../ICON_UPGRADE_GUIDE.md`](../ICON_UPGRADE_GUIDE.md) opens with the counter-argument:

> *"Our farmers often cannot read fluently. They navigate by **shape + colour**, not text.
> For a low-literacy user, a grey `leaf-outline` and a grey `flask-outline` look almost the same."*

That guide's answer was *colourful SVG icons*, and much of it shipped. This document goes one step
further where it genuinely helps: **for things a farmer identifies in the real world — a crop, an
animal, a machine, a diseased leaf — a picture that looks like the real thing beats any icon.**

**This document does not delete the SVG kit.** It layers on top of it (§4). Every generated image has
the existing SVG component as its instant, offline, zero-byte fallback. Nothing regresses.

### The example that drove this

`SYMPTOM_KEYS` in [`CropScanScreen.js:85-98`](../../frontend/src/screens/AI/CropScanScreen.js) — the
twelve symptoms a farmer picks from before an AI scan — are **emoji**:

| symptom | today | what the farmer sees |
|---|---|---|
| `yellow_leaves` | 🍂 | a brown autumn maple leaf — wrong colour, wrong plant, wrong season |
| `brown_spots` | 🟤 | a plain brown circle |
| `white_powder` | 🤍 | a white heart |
| `wilting` | 🥀 | a wilted **rose** |
| `curling_leaves` | 🌀 | a spiral / cyclone symbol |
| `root_rot` | 💀 | **a human skull** |
| `pale_color` | 🫥 | a dotted-outline face |
| `stunted` | 📉 | a stock-market chart going down |
| `stem_rot` | 🪵 | a cut log |
| `holes` | 🕳️ | a black hole |
| `insects` | 🐛 | a caterpillar |
| `fruit_damage` | 🍅 | a healthy tomato |

A farmer with a yellowing cotton leaf is being asked to recognise their problem in a **brown maple
leaf**. One with curled leaves is shown a **cyclone**. Seven of the twelve are actively misleading, and
they render differently on every Android version — exactly the failure `ICON_UPGRADE_GUIDE` §2 warns
about.

This is the single highest-value image set in the application, and it is `Batch 1` here.

---

## 1. The principle

Every decision below follows from one sentence:

> **A farmer who cannot read the label must be able to make the right choice from the picture alone,
> in under two seconds, on a cheap phone, in sunlight, possibly offline.**

Consequences, in priority order:

1. **Depict the thing, not a metaphor.** Yellowing leaf → a yellowing leaf. Not a warning triangle,
   not a colour swatch, not an emoji that happens to be yellow.
2. **Depict the *distinguishing* feature at tile size.** Two images in the same picker must be
   tellable apart at 64 dp while walking. This is a composition constraint, and it is why every
   template below fixes framing rather than leaving it to the model.
3. **Never a blank box.** Offline, mid-load, or on a generation that was never made, the existing SVG
   renders instead. (§4)
4. **Never slower.** An image-heavy UI that stutters on a ₹7,000 phone is worse than icons. Hence the
   bundle/CDN split (§4) and the hard byte caps (§8).
5. **Culturally literal.** Indian crop varieties, Indian livestock breeds, Indian implements, Deccan
   soil. A farmer must recognise *their* jowar, not a stock-photo wheat field.

---

## 2. The size rule — when a photo beats an SVG

This is the one place I am pushing back on "replace every image", and it is a user-experience point,
not a cost one. `ICON_UPGRADE_GUIDE` §2 already established it:

> *"below ~20px a detailed colour icon turns to mud"*

A photograph degrades **faster** than an illustration, because it has no controlled silhouette.

| Rendered size | What ships | Why |
|---|---|---|
| **≥ 96 dp** — hero, detail fallback, empty state, full-bleed | **Generated image** | detail is legible; realism is the whole point |
| **48–96 dp** — grid tiles, picker cards, category browse | **Generated image**, composed for this size | the decision-making surface; this is where most of this document lands |
| **24–48 dp** — list rows, chips, section headers | **Existing SVG** | a controlled silhouette survives; a photo does not |
| **< 24 dp** — inline badges, status ticks, meta | **Flat Ionicon** | anything else is mud |
| any size, needs tinting/state | **Existing SVG** | a raster cannot be tinted per state |

**So: generated imagery targets the ≥48 dp decision surfaces.** Every set below names the exact
surface and size it is composed for. Where a set is used at both sizes — crops appear at 60 dp in the
market picker and 28 dp in a chip — the photo serves the large one and the SVG keeps the small one.

---

## 3. Four style lanes

278 images only read as one product if the style is assigned by **function**, not by taste. Three
lanes, and the assignment rule is mechanical:

| Lane | Style | Used for | Rule of thumb |
|---|---|---|---|
| **P** — Photographic | documentary photo, natural light, true colour | crops · animals · disease symptoms · machinery | things a farmer **identifies in the real world** |
| **R** — Soft 3D render | rounded matte 3D, single soft key light, gentle contact shadow | farm activities · soil types · irrigation · store categories · weather · schemes · statuses | things that are **concepts or actions**, with no single real-world referent |
| **C** — Field-guide illustration | bold outlines, cel-shaded fills, **symptom exaggerated** | crop-scan symptoms · scout issue types (**under evaluation vs P** — see §12) | things a farmer **describes**, where clarity beats fidelity |
| **V** — Flat vector | semi-flat vector, long shadows | brand · launcher · auth · onboarding · empty/error/success | **UI feedback**, where the app is speaking, not the world |

This is the "3D illustration" direction requested — placed where depth actually helps (a spray nozzle,
a soil clod, a water droplet read far better with volume) and kept away from where it hurts (a real
diseased leaf must look real, not like a toy).

**Lane R is what makes the app feel premium rather than ordinary.** It is also the lane that supports
the motion layer in §7 — fogging, spraying, water — because a rendered object can ship with a
separate translucent effect layer that Reanimated drives.

---

## 4. Delivery architecture — how 278 images stay affordable

278 images bundled at ~25 KB each is **~7.0 MB of APK**. That is unacceptable against the
100k-user / low-end-Android constraints in [`../../CLAUDE.md`](../../CLAUDE.md) §40.

The answer is a three-tier stack, per image slot:

```
       ┌──────────────────────────────────────────────┐
       │  1. CDN photo   (Cloudinary, f_auto/q_auto)  │  ← best, needs network
       └───────────────────┬──────────────────────────┘
                           │ not cached / offline / never generated
       ┌───────────────────▼──────────────────────────┐
       │  2. Bundled image   (WebP in the APK)        │  ← for offline-critical sets
       └───────────────────┬──────────────────────────┘
                           │ absent
       ┌───────────────────▼──────────────────────────┐
       │  3. Existing SVG component                   │  ← ALWAYS present, 0 bytes, instant
       └──────────────────────────────────────────────┘
```

**Tier 3 is never removed.** It renders immediately while tier 1 loads, and it is what the farmer sees
in a field with no signal. This is what makes the whole plan safe to ship incrementally: every set can
go live one image at a time, and a missing image is simply the current app.

### What goes where

| Tier | Sets | Count | Why |
|---|---|---:|---|
| **Bundled** | identity · auth · onboarding · UI states · **symptoms** · soil · irrigation · activities · sowing/landprep/scout · growth stages · weather · language badges · severity · motion layers · AI identity · service tiles · content placeholders | **137** | on the offline path (crop scan and MyFarm logging must work in a field), or on first run before any network trust exists |
| **CDN** | crops (66) · animals (16) · store categories (22) · machinery (10) · schemes (9) · order & notification statuses (14) · promo banner plates (4) | **141** | browse surfaces that already require network to show listings at all. Served through the existing `imageVariant(url, width)` helper in [`imageVariants.js`](../../backend/src/utils/imageVariants.js) — `f_auto,q_auto:eco,w_N,c_limit` — under `krushisarva/ui/<set>/<key>` |
| **SVG only** | everything rendered < 48 dp | — | §2 |

Bundled budget: ~137 images × ≤12 KB WebP ≈ **1.7 MB**, against the **3.5 MB** `IMAGE_ASSETS.md` §7
already removes. **Net APK change: still negative.**

CDN images are fetched with the width the surface actually needs (`w_128` for a 64 dp tile at @2x),
cached by the OS image cache, and cost nothing when unused.

---

## 5. Complete inventory

Every set the app selects from. `IMG-<SET>-<key>` is the ID; the key is the code's own key, so the
manifest maps 1:1 onto the enums and constants that already exist.

| § | Set | Count | Lane | Ships | Renders at | Batch |
|---|---|---:|---|---|---|---|
| 5.1 | Crop-scan symptoms | 12 | P | bundle | `CropScanScreen.js:1139` | **B1** |
| 5.2 | Soil types | 8 | R | bundle | `SoilIcons.js` · `OnboardingProfileScreen.js` · `CropScanScreen.js` | B1 |
| 5.3 | Irrigation systems | 6 | R | bundle | `IrrigationIcons.js` · onboarding · CropScan | B1 |
| 5.4 | Farm activities | 13 | R | bundle | `ActivityIcons.js` · `ActivityTypePickerScreen.js` | B2 |
| 5.5 | Growth stages | 8 | R | bundle | `GrowthStoryScreen.js:226` | B2 |
| 5.6 | Sowing methods | 4 | R | bundle | `SowingLogScreen.js:17` | B2 |
| 5.7 | Land-prep operations | 4 | R | bundle | `LandPrepLogScreen.js` | B2 |
| 5.8 | Land-prep implements | 4 | R | bundle | `LandPrepLogScreen.js` | B2 |
| 5.9 | Scout issue types | 5 | P | bundle | `ScoutLogScreen.js` | B2 |
| 5.10 | Severity levels | 4 | R | bundle | `DiagnosisResultScreen.js` `SEV_CONFIG` | B2 |
| 5.11 | Weather conditions | 9 | R | bundle | `WeatherIcons.js:427` | B3 |
| 5.12 | Languages | 10 | R | bundle | `OnboardingLanguageScreen.js:27` | B3 |
| 5.13 | Crops | 66 | P | **cdn** | `CropIcons.js` consumers | B4 |
| 5.14 | Animals | 16 | P | **cdn** | `AnimalIcons.js:768` consumers | B4 |
| 5.15 | Store categories | 22 | R | **cdn** | `AgriStoreHome.js:204` · `categories.js` | B5 |
| 5.16 | Rental machinery | 10 | P | **cdn** | `RentHome.js:202` `MACH_CATS` | B5 |
| 5.17 | Government schemes | 9 | R | **cdn** | `SchemeScreen.js:12` · `seed-schemes.js` | B6 |
| 5.18 | Order statuses | 6 | R | **cdn** | `OrderStatus` enum · seller `OrdersScreen.js` | B6 |
| 5.19 | Notification types | 8 | R | **cdn** | `NotificationType` enum | B6 |
| 5.20 | Identity · auth · onboarding · states | 25 | V/P | bundle | see `IMAGE_ASSETS.md` §3 | B0 |
| 5.21 | Motion layers | 10 | R | bundle | §7 | B7 |
| 5.22 | AI identity | 2 | R | bundle | `AIChatScreen.js:501` · `:525` | B3 |
| 5.23 | Service tiles | 11 | R | bundle | `AIAssistantHome.js:59` + `:67` | B3 |
| 5.24 | Content placeholders | 2 | R | bundle | `ProfileScreen.js:562` · `MockImagePlaceholder.js` | B1 |
| 5.25 | Promo banner plates | 4 | R | **cdn** | home / AI hub banner slots | B7 |
| | **total** | **278** | | | | |

---

### 5.1 Crop-scan symptoms — 12 · Lane P · **the priority set**

**Renders at** [`CropScanScreen.js:1139`](../../frontend/src/screens/AI/CropScanScreen.js) (step-2
chip grid) and `:1352` (the review summary). Currently emoji (§0). Compose for **72 dp tiles**.

Every image is **the same cotton leaf, on the same neutral background, at the same angle** — so the
only thing that differs between two tiles is the symptom itself. That is the whole design: the farmer
is comparing symptoms, not photographs.

| ID key | Label | Subject line (`{{SUBJECT}}`) |
|---|---|---|
| `yellow_leaves` | Yellowing leaves | a single cotton leaf whose blade has turned uniform lemon-to-mustard yellow while the veins stay distinctly green, the classic interveinal yellowing of nutrient chlorosis |
| `brown_spots` | Brown spots | a single green cotton leaf carrying eight to twelve irregular dark-brown necrotic spots two to eight millimetres across, each ringed by a narrow pale-yellow halo |
| `white_powder` | White powdery coating | a single green cotton leaf dusted with a chalky white powdery bloom that is dense along the midrib and thins toward the leaf margin, like fine flour scattered on the surface |
| `wilting` | Wilting | a single cotton leaf drooping limply downward from a soft bent petiole, its blade slack and folded along the midrib from loss of turgor, still green with no spots |
| `insects` | Insects present | a single green cotton leaf with a cluster of small pale-green soft-bodied aphids gathered densely along the underside of the midrib, plus two or three on the upper blade |
| `holes` | Holes in leaves | a single green cotton leaf perforated by six to ten ragged chewed holes of varying size, some at the margin leaving bitten notches, the edges of each hole slightly browned |
| `stunted` | Stunted growth | two young cotton plants side by side in soil, the left one normal height and the right one visibly half its size with smaller crowded leaves and shortened internodes |
| `fruit_damage` | Damaged fruit | a single cotton boll on its stem with a dark sunken rotted patch on one side and a small round bore hole, the fibre inside discoloured brown |
| `stem_rot` | Stem rot | a cotton stem at soil level with a dark water-soaked brown-black lesion girdling it, the tissue above sunken and shrivelled, the surrounding soil visible |
| `curling_leaves` | Curling leaves | a single cotton leaf whose margins have rolled tightly upward and inward into a cupped curl, the blade puckered and crinkled between the veins, still green |
| `root_rot` | Root rot | a young cotton plant lifted from the soil and laid on its side, its root system dark brown, soft and stringy with the outer tissue sloughing away from the core |
| `pale_color` | Pale colour | a single cotton leaf of a washed-out pale whitish-green, uniformly faded and low in pigment across the entire blade including the veins, beside no other leaf for contrast |

**Shared clauses** — every symptom prompt appends:

```text
Setting: the leaf is held against a plain, evenly lit, out-of-focus neutral warm-grey
background. No hand, no fingers, no soil, no other leaves, no scale reference.

Composition: the leaf fills 80 percent of a square frame, seen flat-on from directly
above, tip pointing to the upper right, lit evenly with no harsh cast shadow across
the blade. The symptom must be the single most visible thing in the frame and must
remain unmistakable when the image is viewed at 72 by 72 pixels.

Canvas: square 1:1. Background: full-bleed, no transparency.
```

> **A boundary that does not move.** These are **input affordances** — pictures a farmer taps to
> describe what they are seeing. They are stylised, generic, and never presented as a diagnosis.
> Generated imagery must **not** be used as *diagnostic reference* beside a real AI result in
> `DiagnosisResultScreen.js` — a farmer matching a hallucinated lesion could spray the wrong chemical
> on a real field. That set stays refused (`IMAGE_ASSETS.md` §2.3, `IMG-DIS-*`). Reference imagery,
> if ever wanted, must be licensed photography curated by an agronomist.
> Every symptom image carries a `role: "input-affordance"` field in the manifest so this cannot drift.

---

### 5.2 Soil types — 6 · Lane R

**Renders at** `SoilIcons.js` `SOIL_ICON_MAP:157` consumers — `OnboardingProfileScreen.js` soil grid,
`CropScanScreen.js` soil picker (`SOIL_TILE_BG:56`, used at `:1040`), `SoilHubScreen.js`. Compose for **64 dp**.
Prisma `SoilType` has 8 values; the icon map has 6 — `SANDY_LOAM` and `UNKNOWN` fall through.

| key | Prisma | Subject line |
|---|---|---|
| `black` | `BLACK_COTTON` | a rounded handful-sized clod of dark grey-black Deccan cotton soil, dense and slightly cracked, with fine shrinkage fissures across its surface |
| `red` | `RED` | a rounded clod of iron-red lateritic-red soil, granular and crumbly, a few coarser grains breaking free at the base |
| `alluvial` | `ALLUVIAL` | a rounded clod of pale fawn-brown river alluvial soil, smooth-textured and fine, faintly layered |
| `sandy` | `SANDY` | a low conical heap of loose pale-tan sand, individual grains catching the light, the heap slumping at its edges |
| `clay` | `CLAY_LOAM` | a smooth, plastic, greyish-brown clay clod, dense and slightly glossy where it has been pressed, holding a clean thumb impression |
| `laterite` | `LATERITE` | a chunk of hard porous rust-orange laterite, pitted with irregular cavities, its surface rough and iron-stained |
| *(add)* | `SANDY_LOAM` | a rounded clod of mid-brown sandy loam, visibly mixed — fine dark particles bound with pale sand grains, crumbling at one edge |
| *(add)* | `UNKNOWN` | three small soil clods of clearly different colours — dark grey, red-brown and pale tan — grouped together on neutral ground, none dominant |

**Shared clauses:** `plain neutral warm-grey background, single soft key light from the upper left,
one gentle contact shadow, the clod centred and filling 70 percent of a square frame, matte
non-glossy surface, no hand, no tool, no container, no scale reference.`

> Two additions here that the SVG kit never covered: `SANDY_LOAM` and `UNKNOWN` are real
> `SoilType` enum values with no icon today. **8 images, not 6.**

---

### 5.3 Irrigation systems — 5 · Lane R

**Renders at** `IrrigationIcons.js` `IRRIGATION_ICON_MAP:145` consumers. Compose for **64 dp**.
Prisma `IrrigationSystem` has 6 values (`DRIP SPRINKLER FLOOD FURROW RAINFED MIXED`); the icon map
has 5 and uses `canal` where Prisma says `FURROW`. **Reconcile to the Prisma enum — 6 images.**

| key | Subject line |
|---|---|
| `drip` | a short length of black drip lateral pipe lying on dark soil with two inline emitters, a single water droplet suspended below each, a small dark wet patch spreading under them |
| `sprinkler` | a low impact sprinkler head on a short riser, throwing a fine radial fan of water droplets outward and upward in a shallow arc |
| `flood` | a bunded field plot filled with a shallow sheet of standing water, the soil bund visible along the near edge, the water surface calm and reflective |
| `furrow` | two parallel open soil furrows running toward the viewer with water flowing along the bottom of each, the ridges between them dry |
| `rainfed` | a single soft rain cloud above dry cracked field soil, with a few falling droplets and two small dark impact marks where drops have landed |
| `mixed` | a drip lateral with one emitter on the left and a sprinkler head on the right, sharing one patch of soil, both delivering water |

**Shared clauses:** as §5.2, plus `no crop plants, no people, no machinery, water rendered as clean
translucent blue-white, not stylised droplet symbols.`

---

### 5.4 Farm activities — 13 · Lane R

**Renders at** `ActivityIcons.js` `ICONS:406` consumers — `ActivityTypePickerScreen.js` (the picker
grid), `MyFarmHomeScreen.js` activity feed, `logging/_loggerKit.js` `SectionHeader` (shared by 9 log
screens), `DailyPlannerScreen.js`, `InputCalculatorScreen.js`. Compose for **56 dp**.
**This is the set that carries the motion layer (§7).**

| key | Subject line |
|---|---|
| `LAND_PREP` | a small compact tractor-drawn plough turning a ribbon of dark soil, seen three-quarter from the front, soil curling off the mouldboard |
| `SOWING` | an open cupped hand releasing a scatter of pale seeds toward prepared soil, several seeds caught mid-fall |
| `IRRIGATION` | a drip emitter and a small arc of water meeting dark soil, one wet patch spreading outward |
| `FERTILIZER` | an open sack tipped forward spilling pale granular fertiliser prills onto soil, a few prills scattered ahead of the heap |
| `SPRAY` | a knapsack sprayer nozzle at the end of a lance, emitting a wide translucent cone of fine mist toward the lower right |
| `SCOUT` | a hand-held magnifier over a single green leaf, the leaf enlarged and sharpened inside the lens |
| `WEEDING` | a khurpi hand hoe blade lifting a small clump of weeds clear of the soil, roots and loose earth attached |
| `PRUNING` | a pair of secateurs closing on a green stem, one cut sprig falling away below |
| `HARVEST` | a shallow woven cane basket heaped with freshly cut green crop, one stalk resting across the rim |
| `SALE` | a filled jute produce sack, tied at the neck, with a small stack of Indian coins resting beside its base |
| `EXPENSE` | an open palm passing two Indian coins outward and away from the viewer |
| `INCOME` | an open palm receiving a small stack of Indian coins, angled toward the viewer |
| `OTHER` | a simple wooden-handled farm hand tool resting on soil, generic and unspecific |

**Shared clauses:** `plain neutral warm-grey background, single soft key light from the upper left,
one gentle contact shadow beneath the subject, matte surfaces, the subject centred and filling 70
percent of a square frame, no people beyond hands and forearms, no faces, no text, no brand marks,
no number plates.`

---

### 5.5 Growth stages — 8 · Lane R

Specified in `IMAGE_ASSETS.md` §5.6 as `IMG-SCENE-001..008`, composed as **empty field backdrops**
with the central 40 % clear so `<CropIcon>` composites on top at runtime. **Unchanged — use that
spec.** Palette anchors come from `STAGES` at
[`GrowthStoryScreen.js:41-48`](../../frontend/src/screens/FarmProfile/GrowthStoryScreen.js).

---

### 5.6–5.8 Sowing, land prep, implements — 12 · Lane R

**Renders at** `SowingLogScreen.js:17` (`METHODS`) and `LandPrepLogScreen.js` (`OPERATIONS`,
`IMPLEMENTS`) — currently flat Ionicons at 22 dp. Compose for **56 dp**.

| set | key | Subject line |
|---|---|---|
| sowing | `broadcasting` | a hand mid-swing scattering seed in a wide arc over open prepared soil, seeds spread irregularly |
| sowing | `line_sowing` | prepared soil with three straight parallel drill lines of evenly spaced seeds running toward the horizon |
| sowing | `dibbling` | a pointed dibbler making a single hole in soil with one seed being dropped into it, two finished holes beside it |
| sowing | `transplant` | a hand lowering a young seedling with an intact root ball into an open planting hole in wet soil |
| landprep | `ploughing` | a mouldboard plough body turning and inverting a continuous furrow slice of dark soil |
| landprep | `harrowing` | a disc harrow gang breaking cloddy soil into a fine level tilth behind it |
| landprep | `levelling` | a flat levelling blade dragging across soil leaving a smooth even surface behind and a small roll of loose earth ahead |
| landprep | `bund` | a raised soil bund ridge running across a field plot, freshly shaped with a clean trapezoidal profile |
| implement | `tractor` | a small compact Indian farm tractor in three-quarter front view, no brand badges, no number plate |
| implement | `bullock` | a yoked pair of white Indian bullocks harnessed to a wooden plough beam, seen from the side |
| implement | `power_tiller` | a two-wheel walking power tiller with handlebars and a rotary tine assembly, seen three-quarter |
| implement | `manual` | a khurpi and a pickaxe crossed on soil, wooden handles, well-used steel |

---

### 5.9 Scout issue types — 5 · Lane P

**Renders at** `ScoutLogScreen.js` `ISSUE_TYPES` grid at 24 dp today — **promote the grid to 64 dp**
so the images earn their place (§2). Same neutral-background discipline as §5.1.

| key | Subject line |
|---|---|
| `pest` | a single green leaf with three small chewing insects on its surface and visible feeding damage at the margin |
| `disease` | a single green leaf with a spreading brown-black lesion bounded by a yellow halo, no insects present |
| `weed` | a broadleaf weed seedling growing between two rows of a crop, visibly a different plant from the crop around it |
| `deficiency` | a single leaf showing sharp interveinal yellowing with the veins remaining dark green, uniform across the blade, no spots and no insects |
| `healthy` | a single deep-green leaf, unblemished, turgid and evenly coloured, with a faint natural sheen |

---

### 5.10 Severity levels — 4 · Lane R

**Renders at** `DiagnosisResultScreen.js` `SEV_CONFIG` (`low` / `moderate` / `high` / `critical`).
A four-step visual ramp on **one** subject so severity reads as a progression, not four unrelated
pictures: `a single cotton leaf showing {{N}} percent of its blade affected by browning`, with N =
`5` / `25` / `55` / `85`. Colour ramp `#0a7d0a → #e0af3b → #E65100 → #df2225`.

---

### 5.11 Weather conditions — 9 · Lane R

**Renders at** `WeatherIcons.js` `ICONS:427` — `sunny, partly-cloudy, cloudy, rain, drizzle,
thunderstorm, fog, snow, windy`. The 8 **photographic backdrops** already exist and stay (`KEEP`,
`IMAGE_ASSETS.md` §5.7); this set is the 9 **condition marks** at 56 dp hero / 26 dp list.
Per §2 the 26 dp list usage keeps the SVG; only the hero gets the render.
Subjects are literal: `a rendered {{condition}} — {{sun / sun behind cloud / layered cloud / cloud
with falling droplets / cloud with fine drizzle / dark cloud with a gold lightning bolt / low pale
mist bands / cloud with falling snowflakes / a curved wind gust with three trailing streaks}}`,
`palette anchor: gold #e0af3b for sun, #57685a for cloud, translucent blue-white for water.`

---

### 5.12 Languages — 10 · Lane R

**Renders at** [`OnboardingLanguageScreen.js:27-36`](../../frontend/src/screens/Onboarding/OnboardingLanguageScreen.js)
— currently **emoji flags** (🌍 🏛️ 🏰 🛕 💎 🪷 🌴 🐅 🦁 🌾), which are decorative and carry no
language meaning. `en hi mr ta te kn ml bn gu pa`.

> **This set is the one place a generated image must carry script**, because the whole point of a
> language chooser is to show the writing system. **That makes it Lane D — hand-made, not generated**
> (`IMAGE_ASSETS.md` §2.2: models cannot render Devanagari or Tamil reliably). Compose each tile in
> code: the language's own glyph (`अ` `ম` `ਪ` `అ` …) set in a real font over a Lane-R rendered
> circular badge. **10 badge renders generated; the glyph is live text.**
> This also means the tile stays correct if a font changes, and it is the accessible option.

---

### 5.13 Crops — 66 · Lane P · **CDN**

**Renders at** every `<CropIcon>` consumer ≥48 dp: `CropCycleCreateScreen.js:182` (40 dp — keeps SVG),
`MarketScreen.js:172` (**60 dp — gets photo**), `:437` (38 dp — SVG), `CropScanScreen.js` step-1 grid,
`OnboardingProfileScreen.js:51` crop grid, `MSPTrackerScreen.js` (**currently no crop art at all — add**),
`Weather/CropCalendar.js` + `CropDetail.js` + `StateCropsScreen.js` (**currently 104 emoji fields —
this set replaces them**).

Keys are the exact Title-Case keys in [`CropIcons.js`](../../shared/components/CropIcons.js) `ICONS:1289`.

- **Vegetables (22)** — Tomato · Onion · Potato · Brinjal · Cauliflower · Cabbage · Okra · Bitter Gourd · Capsicum · Cucumber · Bottle Gourd · Pumpkin · Carrot · Radish · Spinach · Green Chilli · Garlic · Ginger · Coriander · Fenugreek · Sweet Potato · Peas
- **Fruits (15)** — Mango · Banana · Grapes · Pomegranate · Guava · Papaya · Watermelon · Muskmelon · Orange · Lemon · Apple · Sapota · Pineapple · Litchi · Coconut
- **Cereals (7)** — Wheat · Rice · Maize · Bajra · Jowar · Barley · Ragi
- **Pulses (5)** — Tur Dal · Gram · Moong · Urad · Masoor
- **Oilseeds (6)** — Soybean · Groundnut · Sunflower · Mustard · Sesame · Castor
- **Cash crops (3)** — Cotton · Sugarcane · Jute
- **Spices (8)** — Turmeric · Red Chilli · Cumin · Coriander Seeds · Cardamom · Black Pepper · Ajwain · Fennel

**Subject template** — one line per crop, composed by the manifest:

```text
Subject: a small harvest-ready portion of {{CROP}} of the variety commonly grown in
Maharashtra — {{PART}} — arranged as a single compact group, freshly picked, with one
or two of its own green leaves included for identification.
```

`{{PART}}` is per-crop and is the field that makes the set *useful*: it names **the part a farmer
actually recognises**. Three worked examples, and the rule for the rest:

| Crop | `{{PART}}` |
|---|---|
| Cotton | one open white boll on its dried brown bur, plus one unopened green boll |
| Jowar | one full compact grain panicle head on a short stalk, grains pale cream |
| Turmeric | three unwashed knobbly rhizome fingers with soil still on them, one snapped to show the orange interior |

**Rule:** for a fruit or vegetable, the edible organ plus one leaf. For a cereal or pulse, the **ear,
panicle or pod on the stalk** — never loose grain, because loose grain of five cereals looks
identical at 64 dp. For a spice, the harvested organ **plus** its processed form where they differ.
For a cash crop, the harvested organ.

**Shared clauses:** `plain neutral warm-grey background, soft even daylight, one gentle contact
shadow, filling 75 percent of a square frame, true-to-life colour, no packaging, no hands, no
branding, no text, no market stall, no basket unless the crop is always sold in one.`

---

### 5.14 Animals — 16 · Lane P · **CDN**

**Renders at** `AnimalIcons.js` `ANIMAL_ICON_MAP:768` consumers — `AnimalTradeHome.js:111` filter
pills (50 dp), `:169` card fallback (full card width), `AnimalDetail.js:87` hero (140 dp),
`AddAnimalListing.js` type picker. Compose for **120 dp**.

`All · Cow · Buffalo · Goat · Bullock · Sheep · Poultry · Horse · Camel · Pig · Duck · Rabbit ·
Donkey · Dog · Fish · Honeybee`

**Breed specificity matters here more than anywhere else** — a farmer trading livestock knows breeds.
Use the Indian breed named first in `ANIMAL_MASTER_DATA` in
[`backend/src/constants/animalMaster.js`](../../backend/src/constants/animalMaster.js):

| key | Subject line |
|---|---|
| `Cow` | a Gir cow standing in profile, distinctive domed forehead, long pendulous ears, red-and-white coat |
| `Buffalo` | a Murrah buffalo standing in profile, jet-black coat, tightly curled horns |
| `Bullock` | a single white Khillari bullock in profile, long upswept horns, muscular shoulder hump |
| `Goat` | an Osmanabadi goat standing in profile, black coat, upright stance |
| `Sheep` | a Deccani sheep standing in profile, coarse dark fleece |
| `Poultry` | a single Indian country-fowl hen standing, mottled brown plumage, upright tail |
| `All` | a Gir cow, an Osmanabadi goat and a country hen grouped together, cow largest and centred |

…and so on for the remaining 9. **Shared clauses:** `full body in strict side profile, standing
squarely, plain neutral warm-grey background, soft even daylight, one gentle contact shadow, the
animal filling 80 percent of the frame, healthy well-kept condition, no rope, no halter, no people,
no shed, no branding, no text.`

Profile framing is not a style choice — it is what makes 16 animals distinguishable at 50 dp.

---

### 5.15 Store categories — 22 · Lane R · **CDN**

**Renders at** [`AgriStoreHome.js:204`](../../frontend/src/screens/AgriStore/AgriStoreHome.js)
category pills, and `CategoryDrawer:54` — **the drawer's rows are text + a chevron with no icon at all today** (`:116-117`),
which is the worst accessibility gap in the shop. Compose for **64 dp**.
Exact names from [`shared/constants/categories.js`](../../shared/constants/categories.js); colours
from [`seed-categories.js`](../../backend/prisma/seed-categories.js).

| # | Category | Subject line |
|---|---|---|
| 1 | Seeds & Planting Material | a small open paper seed packet tipped forward with mixed seeds spilling out, two young seedlings beside it |
| 2 | Fertilizers & Soil Nutrition | a part-open fertiliser sack with pale granular prills spilling from its mouth onto soil |
| 3 | Crop Protection | a plastic pesticide bottle with a measuring cap beside it and a green leaf shielded behind it |
| 4 | Organic & Natural Farming | a handful of dark crumbly compost with an earthworm and a green sprout emerging from it |
| 5 | Plant Growth Regulators | a small dropper bottle releasing one drop toward a young shoot that is visibly taller than a second shoot behind it |
| 6 | Irrigation & Water Management | a coil of black drip lateral pipe with two emitters and a brass connector |
| 7 | Farm Machinery & Equipment | a small compact tractor in three-quarter view with a rotavator attached behind |
| 8 | Hand Tools & Small Equipment | a khurpi, a sickle and a hand trowel laid in a fan, wooden handles, well-used steel |
| 9 | Protected Cultivation | a small polyhouse tunnel frame with translucent sheeting over hoops, crop rows visible inside |
| 10 | Micronutrients & Specialty Nutrition | a small labelled-free sachet with fine coloured powder spilling out beside a single vivid green leaf |
| 11 | Seeds Treatment & Additives | a bowl of seeds coated in a pink-orange treatment dust, a few untreated pale seeds beside for contrast |
| 12 | Livestock, Dairy & Poultry | a steel milking pail, a scoop of cattle feed pellets and a single hen's egg grouped together |
| 13 | Fencing & Farm Protection | a short run of barbed wire strung between two wooden fence posts |
| 14 | Storage & Packaging | three stacked filled jute sacks tied at the neck, one plastic crate beside them |
| 15 | Agri Technology & Smart Farming | a small soil-moisture sensor probe pushed into soil with a short antenna, no screen |
| 16 | Solar & Energy | a small solar panel on a frame angled toward the light, with a short cable coiled at its base |
| 17 | Safety & Protective Gear | a pair of rubber gloves, a face mask and clear goggles grouped together |
| 18 | Spraying Equipment | a knapsack sprayer tank with shoulder straps, lance and nozzle resting against it |
| 19 | Harvesting & Post-Harvest | a sickle laid across a bound sheaf of cut cereal stalks |
| 20 | Aquaculture & Fisheries | a folded cast net with two freshwater fish beside it |
| 21 | Horticulture & Nursery | three young saplings in black nursery poly-bags, leaves fresh and green |
| 22 | Agri Inputs for Home & Kitchen Garden | a terracotta pot with a leafy vegetable seedling, a small hand trowel and a seed packet beside it |

**Shared clauses:** as §5.4. **Do not put text on any packaging** — that is where the model will try
to write, and a garbled label on a fertiliser sack is worse than a blank one.

---

### 5.16 Rental machinery — 10 · Lane P · **CDN**

**Renders at** [`RentHome.js:202`](../../frontend/src/screens/Rent/RentHome.js) category chips (28 dp
— **promote to 56 dp**), `:352` card fallback (140 dp), `MachineryDetail.js:158` hero (80 dp).
`MachineryIcons.js` covers only 8 of 10 — **`all` and `other` render nothing today.**

`tractor · harvester · sprayer · rotavator · thresher · transplanter · truck · tempo · all · other`

| key | Subject line |
|---|---|
| `tractor` | a small compact Indian farm tractor, three-quarter front view |
| `harvester` | a self-propelled combine harvester with the cutting header lowered, three-quarter front |
| `sprayer` | a tractor-mounted boom sprayer with the boom folded out and a tank behind the cab |
| `rotavator` | a tractor-mounted rotavator implement on its own, tines visible, three-quarter |
| `thresher` | a stationary crop thresher with feed hopper and outlet chute, belt drive visible |
| `transplanter` | a walk-behind rice transplanter with seedling trays mounted above the float |
| `truck` | a small Indian goods truck with an open flatbed, three-quarter front |
| `tempo` | a three-wheeled goods auto-tempo with an open cargo tray, three-quarter front |
| `all` | a tractor, a rotavator and a small truck grouped together, tractor largest and centred |
| `other` | a generic implement drawbar with a hitch pin and a coiled hydraulic hose, unspecific |

**Shared clauses:** as §5.14, plus **`no brand badges, no manufacturer name, no number plate, no
livery, no operator in the seat`** — machinery is where a model most wants to invent a logo.

---

### 5.17–5.19 Schemes · order status · notification type — 23 · Lane R · **CDN**

| set | keys | Notes |
|---|---|---|
| Schemes (9) | `PMKISAN PMFBY KCC SMAM PMKSY-PDMC NMSA-SHC PM-KMY eNAM AIF` | `GovernmentScheme` has **no image column — add one**. `SchemeScreen.js:12` is a hardcoded 5-item array that never reads the API; **wire it first**. Subjects are benefit-literal: direct-benefit → coins into an open palm; insurance → an umbrella over a green crop row; credit → a card beside a seed sack; pension → an elderly farmer's hands resting on a staff; marketplace → two hands exchanging a sack and coins |
| Order status (6) | `PENDING CONFIRMED SHIPPED DELIVERED CANCELLED REFUNDED` | Renders in seller `OrdersScreen.js` badges at 16–18 dp — **SVG stays there** per §2. The images serve the 72 dp empty-state and order-detail header only |
| Notification type (8) | `ORDER_UPDATE BOOKING_UPDATE NEW_MESSAGE NEW_COMMENT POST_LIKE SYSTEM CROP_REPORT_RECEIVED CROP_REPORT_REPLIED` | **There is no notification list screen in the farmer app.** Build the screen first — otherwise these 8 images have nowhere to render. Deferred to B6 for that reason |

---

### 5.22 AI identity — 2 · Lane R

**The AI has no face.** `Krushi Gyaan`, `Krushi Drishti` and `Krushi Vaani` are named sub-products,
but the only identity mark anywhere is a **32×32 plain gradient circle** at
[`AIChatScreen.js:501`](../../frontend/src/screens/AI/AIChatScreen.js) (`panelAvatar`, styled at
`:1542`). Assistant messages render as bare text bubbles with no avatar at all.

| ID | Renders at | Subject line |
|---|---|---|
| `AI-avatar` | `AIChatScreen.js:501` panel header (32 dp — SVG stays), assistant message bubbles and the AI-hub header at **48 dp** | a rounded matte badge form containing a single young green shoot whose topmost leaf resolves into a soft rounded circuit-node motif, one small warm-gold spark at the growing tip — organic first, technological second |
| `AI-chat-empty` | `AIChatScreen.js:525` — **text-only today** (`"No conversations yet"`) | a rounded matte speech bubble resting on soil with a single green shoot growing up out of its opening, calm and inviting |

**Palette anchor:** `#005f21` and `#31aa40` for the shoot, `#e0af3b` for the spark, on the dark
`#050D08` chat theme as well as on `#f9fdf6`. **Must read on both** — the chat screen is dark and the
hub is light, which is the constraint that kills most candidates.

> §10.7 flagged that after the rename there are three "Krushi"s at three levels. This avatar is the
> mitigation: **the AI is told apart by its mark, not by its name.**

---

### 5.23 Service tiles — 11 · Lane R

**Renders at** [`AIAssistantHome.js:59`](../../frontend/src/screens/AI/AIAssistantHome.js)
(`QUICK_SERVICES`, 4 tiles, rendered at `:234`) and `:67` (`AI_TOOLS`, 7 tiles, rendered at `:250`).
This is the app's real hub — there is no screen called "Home"; the tab bar opens on AgriStore and the
service grid lives on the AI tab.

Four of the eleven already route to SVG (`TabIcon`, `WeatherIcon`, `AIServiceIcon`, `SoilIcon`) and
**seven are still flat Ionicons** — `scan`, `chatbubble-ellipses`, `chatbubbles`, `map`. At 48–56 dp
these clear the §2 size rule, so all eleven get a rendered tile for visual consistency; the SVG stays
as tier-3 fallback.

| id | Subject line |
|---|---|
| `scan` / `disease` | a rounded matte camera aperture ring framing a single green leaf, one gold focus bracket over the leaf |
| `chat` / `chatSupport` | a rounded matte speech bubble with a small green shoot rising from inside it |
| `voiceChat` | a rounded matte microphone with three concentric sound arcs to one side |
| `markets` / `mandi` | a rounded matte market stall canopy over a filled produce basket, a small stack of coins beside it |
| `weather` | a rounded matte sun partly behind a soft cloud |
| `farms` | a rounded matte field of three furrow rows in perspective with a shoot in the centre row |
| `soil` | a rounded matte soil clod cut away to show two colour layers |
| `stateCrops` | a rounded matte simplified India landmass with three small crop shoots on its surface |
| `credits` | a rounded matte coin stack with a small gold spark above the top coin |
| `planner` | a rounded matte calendar block with a green shoot growing through it |
| `soilScan` | a rounded matte document card with a magnifier over one corner |

**Shared clauses:** as §5.4, plus `each tile subject must sit inside the same square footprint and use
the same visual weight, so the eleven read as one set when seen together in a grid.` Review as a
contact sheet (§8.3) — a service grid is the clearest case where individual quality is worthless if
the set is inconsistent.

---

### 5.24 Content placeholders — 2 · Lane R

**Reversing two refusals from `IMAGE_ASSETS.md` §2.3.** I refuted `IMG-FB-001` and `IMG-FB-002` on the
grounds that `MockImagePlaceholder.js` and initials-in-a-gradient already ship. That reasoning holds
for **cost** and fails for **this document's principle** (§1): a farmer who cannot read gets nothing
from a two-letter initial, and `MockImagePlaceholder` is a flat 2-tone shape.

| ID | Renders at | Subject line |
|---|---|---|
| `PLACEHOLDER-profile` | `ProfileScreen.js:562` (the `LinearGradient` + initials fallback), `OnboardingProfileScreen.js:270`, chat peer avatars, `MachineryDetail.js:686` | a rounded matte generic head-and-shoulders silhouette wearing a simple collared shirt with a folded towel over one shoulder, warm and neutral, no facial features, no gender markers, no skin-tone specificity |
| `PLACEHOLDER-product` | `AgriStoreHome.js:254` and `:314`, `ProductDetail.js:363` and `:703`, `CartScreen.js:146`, and the two sites that wrongly use a bare `Ionicons "leaf"` — `CheckoutScreen.js:936`, `OrderConfirmedScreen.js:95` | a rounded matte closed cardboard carton with a small green leaf resting on its lid, plain and unbranded |

**No facial features on the profile placeholder** — that is deliberate. Any generated face carries an
apparent age, gender and caste-coded appearance, and this image stands in for every user of the app.

`MockImagePlaceholder.js` keeps its 11 category themes as tier 3; these two are the ≥64 dp upgrade.

---

### 5.25 Promotional banner plates — 4 · Lane R · **CDN**

Rotating in-app campaign banners — weather alerts, seasonal crop pushes, scheme deadlines. **These
must be CMS-driven**, not bundled, or every campaign needs a Play Store release.

**Generate the plate, not the banner.** Each is an empty artwork background with a defined text-safe
region; the backend supplies the localised copy and the app composites it live. That is the only way
a Marathi campaign line stays correct.

| ID | Use | Subject line |
|---|---|---|
| `BANNER-weather` | rain / heat / storm alerts | soft rain clouds over a field horizon, occupying the RIGHT 35 percent only, left 65 percent open sky |
| `BANNER-crop` | seasonal crop campaigns | a green crop row receding to the lower right, occupying the RIGHT 35 percent only |
| `BANNER-ai` | Krushi Drishti / Vaani feature pushes | a soft gold spark cluster and one leaf in the RIGHT 35 percent, deep green field gradient elsewhere |
| `BANNER-scheme` | government scheme deadlines | a rounded matte document and a coin stack in the RIGHT 35 percent |

**Shared clauses:** `landscape 3:1; the LEFT 65 percent must be a near-flat low-contrast gradient
holding no subject at all, because the app lays two lines of localised text and a chevron there;
absolutely no text anywhere in the plate.`

**Requires backend work:** a `Banner` model (image URL, target screen, i18n copy, active window,
audience) and an endpoint. None of that exists today — this is why the set is **B7**.

---

### 5.20 Identity, auth, onboarding, UI states — 25

**Unchanged.** Fully specified in [`IMAGE_ASSETS.md`](./IMAGE_ASSETS.md) §5.1–5.5 and §5.8–5.10.
That document remains the source of truth for those 25; this one does not restate them.

---

## 6. The prompt system

278 prompts are not written 278 times. Each is **composed** from four parts, so a style fix is one
edit and not 278:

```
  LANE PREAMBLE     per lane (P / R / V)         — fixed, 3 strings total
+ FAMILY TEMPLATE   per set (§5.x shared clauses) — fixed, ~20 strings total
+ SUBJECT LINE      per item (the §5 tables)      — the only per-image writing
+ PALETTE ANCHOR    per item or per set
+ GLOBAL NEGATIVE   one string, plus per-set additions
= the prompt sent to the API
```

`manifest.mjs` performs the concatenation. **The markdown in §5 is the human source of truth; the
manifest is the executable copy. When they disagree, the markdown wins** (same rule as
`IMAGE_ASSETS.md` §6.4).

### 6.1 Lane preambles

**Lane P** — reuse verbatim from [`IMAGE_ASSETS.md`](./IMAGE_ASSETS.md) §4.2.

**Lane V** — reuse verbatim from `IMAGE_ASSETS.md` §4.1.

**Lane R — soft 3D render** (new):

```text
Soft 3D render, rounded matte forms with gently bevelled edges and no sharp corners;
physically plausible materials with a slight surface roughness, never glossy, never
plastic-shiny, never chrome; a single soft key light from the upper left with a wide
soft fill and one gentle contact shadow directly beneath the subject; shallow depth,
subject fully in focus; warm neutral colour balance; the palette drawn from deep
forest green #005f21, leaf green #31aa40, pale green #c9f2c0, warm gold #e0af3b,
muted grey-green #57685a, warm soil brown #7E5A3C and off-white #f9fdf6, with real
material colours where the object demands them. Absolutely NO text, letters,
numbers, words, logos, watermarks or signatures anywhere in the image.
```

### 6.2 The five clauses every prompt still carries

Trimmed from the nine in `IMAGE_ASSETS.md` §4.3, because family templates now absorb setting and
clothing:

1. **Lane preamble** — verbatim.
2. **Subject** — the §5 table line. One subject. Never two.
3. **Composition + safe area** — from the family template; always names the rendered size the image
   must survive at.
4. **Canvas + background** — square 1:1 unless the family says otherwise.
5. **Restated no-text clause, then the negative** — the restatement stays. Image models drop early
   global constraints on long prompts, and every set here is text-free.

### 6.3 Global negative

Reuse `IMAGE_ASSETS.md` §4.4 verbatim, with these **per-lane additions**:

| Lane | Add to negative |
|---|---|
| **P** — crops/animals/machinery | `market stall, packaging, price tag, hand holding the subject, brand badge, number plate, operator in the seat, studio softbox reflection, watermark grid` |
| **P** — symptoms/scout | `human skin, gore, blood, alarming red UI colouring, warning triangle, diagnosis text, confidence percentage, before-and-after split, two panels` |
| **R** — all | `glossy plastic, chrome, mirror reflection, neon rim light, glowing edges, floating in space, isometric grid, pedestal, plinth, glass dome` |

### 6.4 Cultural specificity

`IMAGE_ASSETS.md` §4.6 applies unchanged. Three additions that matter for the new sets:

- **Livestock:** Indian breeds by name (Gir, Sahiwal, Murrah, Khillari, Osmanabadi, Deccani) — never a
  Holstein-Friesian unless the key is `HF Cross`, never a Western beef breed.
- **Implements:** khurpi, sickle, dibbler, bullock plough, knapsack sprayer, walk-behind power tiller.
  Never a garden fork, wheelbarrow, or Western hoe.
- **Containers:** jute sacks, woven cane baskets, steel pails, terracotta pots, black nursery
  poly-bags. Never wicker hampers, burlap with printed stencils, or galvanised Western feed troughs.

---

## 7. Motion layer — fogging, spraying, water

A generated PNG cannot animate. There are three ways to get motion, and the right one here is not the
obvious one.

| Option | Cost | Verdict |
|---|---|---|
| **Lottie** (`lottie-react-native`) | new native dependency, ~1 MB, needs an After Effects author | **No.** Neither app has it today, and there is no motion designer in the loop |
| **Animated WebP / APNG** | no new dependency, but large files and no runtime control | **No.** A 30-frame spray plume is heavier than the still image it decorates |
| **Layered PNG + Reanimated** | **zero new dependencies** — `react-native-reanimated` is already the app's entire motion system | **Yes** |

**Approach:** generate the *effect* as a **separate transparent layer** from the object it belongs to.
The app stacks them and Reanimated drives the layer's `translate`, `scale` and `opacity`.

```
  <View>
    <Image source={spray_base} />        {/* the nozzle — static  */}
    <Animated.Image source={spray_mist}  {/* the plume  — animated */}
                    style={plumeStyle} />
  </View>
```

Ten layers, all Lane R, all transparent, all bundled:

| ID | Layer | Pairs with | Motion |
|---|---|---|---|
| `MOTION-spray-mist` | a wide translucent cone of fine white mist, dense at the narrow end, dissipating at the wide end | `ACTIVITY-SPRAY`, `CAT-18` | translate + fade out along the cone axis, loop 1.4 s |
| `MOTION-fog-bank` | a low horizontal band of soft translucent white fog, wispy at both ends | `WX-fog`, `SCENE-*` | slow horizontal drift, loop 6 s |
| `MOTION-droplet` | a single clean translucent blue-white water droplet with a highlight | `ACTIVITY-IRRIGATION`, `IRR-drip` | translate down + fade, staggered ×3, loop 1.1 s |
| `MOTION-splash-ring` | a shallow translucent ripple ring seen from a low angle | `IRR-flood`, `IRR-furrow` | scale up + fade, loop 1.1 s |
| `MOTION-sprinkle-fan` | a radial fan of fine separated droplets | `IRR-sprinkler` | rotate slowly, loop 3 s |
| `MOTION-rain-streaks` | six thin translucent vertical rain streaks of varying length | `WX-rain`, `WX-drizzle` | translate down, loop 0.9 s |
| `MOTION-sun-rays` | eight soft translucent gold rays radiating from a centre point | `WX-sunny` | slow rotate + gentle opacity pulse, loop 8 s |
| `MOTION-dust-puff` | a low soft translucent puff of pale dust | `ACTIVITY-LAND_PREP`, `MACH-rotavator` | scale + fade, loop 1.6 s |
| `MOTION-seed-fall` | five pale seeds at different sizes, scattered | `ACTIVITY-SOWING`, `SOW-broadcasting` | translate down + slight rotate, loop 1.3 s |
| `MOTION-sparkle` | four small soft gold four-point sparkles at different sizes | `STATE-success`, `CelebrationSheet.js` | scale + fade, staggered, loop 1.2 s |

**Shared clauses:** `the effect only, isolated on a fully transparent background, no object, no
nozzle, no cloud body, no ground, soft translucent edges with no hard outline, rendered so it reads
correctly when composited over both a light #f9fdf6 surface and a white card.`

**Restraint, deliberately:** motion runs **only while a screen is focused**, only on the element the
farmer is choosing or has just chosen, and never more than one loop on screen at once. Ambient motion
on a grid of 22 category tiles would burn battery and make the app feel slower — the opposite of the
goal. `useIsFocused()` gates every loop.

---

## 8. Pipeline

The tooling from [`IMAGE_ASSETS.md`](./IMAGE_ASSETS.md) §6 already exists at
[`scripts/brand-assets/`](../../scripts/brand-assets/) and is tested. This document extends it rather
than replacing it.

### 8.1 What changes in the manifest

```js
'CROP-Cotton': {
  set: 'crops', lane: 'P', ships: 'cdn',
  subject: 'one open white boll on its dried brown bur, plus one unopened green boll',
  cdn: 'krushisarva/ui/crops/Cotton',
  widths: [128, 256],  cap: 18 * KB,
  fallback: "CropIcon crop='Cotton'",     // tier 3, must already exist
},
'SYMPTOM-yellow_leaves': {
  set: 'symptoms', lane: 'P', ships: 'bundle',
  role: 'input-affordance',               // §5.1 — never a diagnostic reference
  subject: '…',
  outputs: [{ path: 'frontend/assets/symptoms/yellow_leaves.webp', fmt:'webp', q:82, cap: 14*KB }],
  density: [144, 288],
  fallback: "Ionicons name='leaf-outline'",
},
```

Three new fields: **`set`** (picks the family template), **`ships`** (`bundle` | `cdn`), and
**`fallback`** (the tier-3 component that must render when the image is absent — asserted present
before the set is allowed to go live).

### 8.2 New script steps

| Step | What |
|---|---|
| `generate.mjs --set symptoms` | generate a whole family in one run, rate-limited, resumable, skipping IDs whose master already exists |
| `postprocess.mjs` | unchanged — crop, resize, WebP, density, byte-cap assert |
| `upload.mjs --set crops` | push `ships: 'cdn'` outputs to Cloudinary under `krushisarva/ui/<set>/<key>`, using the existing account and `f_auto,q_auto:eco` |
| `verify.mjs` | for every entry: master exists · outputs exist · under cap · `fallback` component resolves in the codebase. **Fails the run if a fallback is missing** — that is the guarantee that no surface can end up blank |

### 8.3 Contact sheets

After each family, `contact-sheet.mjs` composites the whole set onto one PNG at the size it will
actually render (64 dp, 3× density). **Review the sheet, not the individual images.** A set of 22
category images is only correct if all 22 are tellable apart *from each other* at tile size — a
property no single image has. This is the review step that decides whether a family ships.

### 8.4 The API key — how to hand it over

**Do not paste the key into this chat.** It would be recorded in the transcript and in session logs.

```bash
# scripts/brand-assets/.env      (gitignored — add it before creating the file)
OPENAI_API_KEY=sk-...
```

Then `node --env-file=.env generate.mjs --set symptoms`. Confirm `.env` is ignored before writing it,
keep the key scoped to images only if your platform account supports scoped keys, and rotate it when
the run is finished.

---

## 9. Batches and cost

Ordered so each batch is independently shippable and the highest-harm gap closes first.

| Batch | Set | Images | Why here |
|---|---|---:|---|
| **B0** | identity · auth · onboarding · UI states | 25 | `IMAGE_ASSETS.md`. The launcher/notification/adaptive-icon bugs are live defects |
| **B1** | **symptoms (12)** · soil (8) · irrigation (6) · content placeholders (2) | **28** | Seven of twelve symptom emoji are actively misleading (§0). Highest harm, smallest set, fully offline |
| **B2** | activities (13) · stages (8) · sowing (4) · landprep (8) · scout (5) · severity (4) | 42 | MyFarm — the daily-use surface, and the set that unlocks the motion layer |
| **B3** | weather (9) · language badges (10) · AI identity (2) · service tiles (11) | 32 | First-run and home surfaces |
| **B4** | crops (66) · animals (16) | 82 | The two big identification sets. First CDN batch — validates the whole remote path |
| **B5** | store categories (22) · machinery (10) | 32 | Commerce. Fixes the icon-less shop drawer and the two empty rent chips |
| **B6** | schemes (9) · order status (6) · notification (8) | 23 | **Blocked on code:** schemes need an image column and a wired screen; notifications need a screen that does not exist |
| **B7** | motion layers (10) · promo banner plates (4) | 14 | Last — it decorates finished art, and it is the easiest thing to overdo |

**Cost.** At `gpt-image-1` `quality: medium`, 1024², **3 candidates each**: roughly **$0.04 per
image** → ~$0.12 per slot → **on the order of $33 for all 278 slots**, plus a few `high`-quality
runs for identity and hero assets. Verify current pricing before the first run; treat this as an
order of magnitude, not a quote.

The expensive resource is **not** the API — it is human review time. Budget roughly one working day
per large family for contact-sheet review and regenerating the rejects. That is why §8.3 exists.

---

## 10. Decisions I made, and the risks

**10.1 — The SVG kit stays, as tier 3.** I did not delete it. Every generated image has its existing
component as an instant, offline, zero-byte fallback (§4). This is what lets a family ship one image
at a time with no risk: a missing image is simply today's app. *Risk:* two visual systems coexist
indefinitely. Mitigated by §2 — they occupy different size bands and never appear at the same size on
the same screen.

**10.2 — Photos do not go below 48 dp.** Chips, list rows and badges keep their SVG (§2). This is the
one place I pushed back on "replace every image": a photograph at 24 dp is mud, and would be a
downgrade from the current icons. *If you want the small sizes changed too, the fix is more SVG
variants, not more photos.*

**10.3 — 141 of 278 images are CDN, not bundled.** Bundling everything is ~7.0 MB of APK against a
low-end-Android target. *Risk:* a farmer with no signal browsing the store sees SVG icons rather than
photos. That is the correct degradation, and it is strictly better than today.

**10.4 — Language tiles are hand-made, not generated.** A language chooser must show real script, and
models cannot render Devanagari or Tamil reliably (§5.12). The badge is generated; the glyph is live
text.

**10.5 — Symptom images are input affordances, never diagnostic references.** The `IMG-DIS-*` refusal
in `IMAGE_ASSETS.md` §2.3 stands. Enforced by the `role` field in the manifest (§8.1). This is the one
item here with a physical-world consequence — a farmer matching a hallucinated lesion beside a real
diagnosis could spray the wrong chemical.

**10.6 — B6 is blocked on code, not art.** Schemes need an image column on `GovernmentScheme` and
`SchemeScreen.js:12` wired to the API instead of its hardcoded 5-item array. Notifications need a list
screen that does not exist in the farmer app. Generating those 23 images before the screens exist
would produce assets with nowhere to render.

**10.7 — Three visual systems is the real risk of this plan.** Photographic, soft-3D and flat-vector
on one screen can look incoherent. The mitigation is the mechanical lane rule in §3 (identify → P,
concept → R, UI feedback → V) and the contact-sheet review in §8.3. **If a screen ever shows two lanes
at the same size, one of them is assigned wrong.**

**10.8 — Motion is gated.** One loop on screen at a time, only while focused (§7). Ambient motion
across a 22-tile grid would make a cheap phone feel slower, which defeats the entire purpose.

**10.9 — Scope honesty.** 278 slots × 3 candidates is ~830 generated images to review. This is weeks
of part-time work, not an afternoon. The batch order is designed so that **stopping after B2 still
leaves the app meaningfully better** than it is today.

---

## 11. Coverage against the standard Android asset checklist

Traced item by item against the conventional "professional Android app" asset list, so nothing is
assumed covered. **✅ covered · ➕ added beyond the checklist · ⚠️ partial, with a reason · ❌ excluded,
with a reason.**

### Group 1 — Core branding (7 of 7 ✅)

| Checklist item | Where in this plan |
|---|---|
| Main logo | ✅ `IMG-BRAND-002` — Lane **D**, hand-typeset in Fraunces 700, *not* generated (`IMAGE_ASSETS.md` §2.2) |
| App launcher icon | ✅ `IMG-LAUNCH-001` |
| Launcher foreground | ✅ `IMG-LAUNCH-002` — **fixes a live bug**: today it is byte-identical to `icon.png`, no alpha, no safe zone |
| Launcher background | ✅ flat `#005f21` via `adaptiveIcon.backgroundColor`. **Deliberately a colour, not an image** — smaller, survives launcher parallax, one less asset to keep in sync |
| Splash screen logo | ✅ `IMG-LAUNCH-005`, reused on both `App.js` load screens |
| Notification icon | ✅ `IMG-LAUNCH-004` — **none exists today**; white-on-transparent, because Android discards its colour |
| Small brand mark | ✅ `IMG-BRAND-001` — the icon-only mark; also the source of all nine derived files |
| — | ➕ `IMG-LAUNCH-003` **Android 13 monochrome icon** — not on the checklist, absent today, required for themed icons |

### Group 2 — In-app screen images

| Checklist item | Status |
|---|---|
| Onboarding illustrations | ✅ `IMG-ONBOARD-001..003`. **Three, not four** — a fourth "everything in one place" slide restates the other three and adds a swipe most users skip |
| Empty-state illustrations | ✅ `IMG-STATE-003`, applied to the 5 text-only states only — see §2.3 of `IMAGE_ASSETS.md` for why not all ~30 |
| Error illustration | ✅ `IMG-STATE-001` |
| Success illustration | ✅ `IMG-STATE-004` |
| Profile placeholder | ✅ `PLACEHOLDER-profile` (§5.24) — **was missing until this revision** |
| Product placeholder | ✅ `PLACEHOLDER-product` (§5.24) — **was missing until this revision** |
| Crop images | ✅ 66 (§5.13) |
| Animal images | ✅ 16 (§5.14) |
| Disease images | ⚠️ **Split deliberately.** 12 symptom images (§5.1) + 5 scout issue types (§5.9) ship as **input affordances**. Generated *diagnostic reference* photos beside a real AI result stay refused — a farmer matching a hallucinated lesion could spray the wrong chemical on a real field (§10.5) |
| Weather illustrations / icons | ✅ 9 condition marks (§5.11) + 8 photographic backdrops already in the repo (`KEEP`) |
| Marketplace category images | ✅ 22 (§5.15) |
| Rental category images | ✅ 10 (§5.16) — including `all` and `other`, which **render nothing at all today** |
| Government scheme banners | ✅ 9 (§5.17) — **blocked on code**: no image column, and `SchemeScreen.js:12` never calls the API |
| News / article thumbnails | ❌ **The feature does not exist.** No news screen, no article model, no route. Nothing to render into |
| AI assistant illustration / avatar | ✅ `AI-avatar` (§5.22) — **was missing until this revision.** The only AI identity today is a 32×32 plain gradient circle |
| Upload camera illustration | ✅ `IMG-SCAN-001` — replaces four lines of text with the one thing text conveys badly: how close to hold the phone |
| Location / map markers | ❌ **No map exists.** `react-native-maps` is not a dependency of either app, and there is no `MapView` anywhere in `frontend/src`. "Nearby" screens are distance-sorted lists, not maps. Marker art would have nowhere to render — **build the map first, then revisit** |
| Banner / promotional images | ✅ `BANNER-*` ×4 (§5.25) — **was missing until this revision.** Spec'd as reusable *plates* with a text-safe region, CDN-served, so a campaign never needs a Play Store release |

### Group 3 — Play Store (3 of 3 ✅)

| Checklist item | Where |
|---|---|
| 512×512 icon | ✅ `IMG-PLAY-001`, derived from the mark. **No wordmark in it** — a symbol, as recommended |
| 1024×500 feature graphic | ✅ `IMG-PLAY-002`. Not a native generation size — produced by over-framing a `1536×1024` and centre-cropping (§6.2 of `IMAGE_ASSETS.md`) |
| 6–8 screenshots | ✅ `IMG-PLAY-003` backdrop + **real screenshots**. The Marathi headline on each is composited from real type, never generated |

### Placeholders and status (checklist §5–§6)

| Item | Status |
|---|---|
| No profile photo | ✅ §5.24 |
| No product photo | ✅ §5.24 |
| No crop image | ✅ 66 crop images, `CropIcon` as tier-3 fallback |
| No animal photo | ✅ 16 animal images, `AnimalIcon` as tier-3 fallback |
| No internet | ✅ `IMG-STATE-002` — one asset, **seven** call sites |
| No search result | ✅ `IMG-STATE-005` |
| No notification | ❌ **No notification screen exists** in the farmer app. §5.19 covers the 8 types once the screen is built |
| No data | ✅ `IMG-STATE-003` |
| Something went wrong | ✅ `IMG-STATE-001` |
| Loading | ❌ **Correctly not an image.** The repo already ships a 9-component shimmer kit at `frontend/src/components/ui/Skeleton.js` |

### Where this plan goes past the checklist

The checklist is a good **branding** list and a thin **product** list. The 278 slots break into three
groups, and the arithmetic is worth seeing:

**A — 101 images for surfaces the checklist never mentions.** Every one is a real selection surface
where a farmer makes a choice:

| Set | Count | Why it matters |
|---|---:|---|
| Soil types | 8 | incl. `SANDY_LOAM` and `UNKNOWN` — real `SoilType` enum values with **no icon at all** |
| Irrigation systems | 6 | reconciled to the Prisma enum; `FURROW` and `MIXED` were unmapped |
| Farm activities | 13 | the daily MyFarm logging surface |
| Growth stages | 8 | the tier-2 slot `GrowthStoryScreen.js:10-13` has documented since it was written |
| Sowing · land prep · implements | 12 | every log screen's method picker |
| Scout issue types | 5 | pest vs disease vs deficiency — four near-identical grey glyphs today |
| Severity levels | 4 | a four-step ramp on one subject, so severity reads as a progression |
| Language badges | 10 | emoji flags today — 🐅 🦁 🪷 carry no language meaning |
| Service tiles | 11 | the app's actual hub; 7 of 11 still flat Ionicons |
| Order · notification status | 14 | blocked on screens that do not exist yet |
| Motion layers | 10 | fogging, spraying, water — zero new dependencies |

**B — 144 images where the checklist names the set but not its real size.** "Crop images: cotton,
soybean, wheat, onion" is four examples; the app has **66 crop keys**. This is where most of the
volume is, and where the CDN tier (§4) earns its place:

| Set | Checklist implies | Actually |
|---|---:|---:|
| Crop images | ~4 | **66** |
| Animal images | ~3 | **16** |
| Marketplace categories | ~3 | **22** |
| Rental categories | ~3 | **10** |
| Scheme banners | ~1 | **9** |
| Weather icons | ~3 | **9** |
| Disease images | ~1 | **12** (as input affordances — §10.5) |

**C — 33 images at roughly the size the checklist implies.** Branding, launcher set, auth, onboarding,
UI states, Play Store, AI identity, content placeholders, banner plates.

`101 + 144 + 33 = 278.`

**Checklist coverage: 20 of 22 items in the "recommended first package" ✅ — the 2 excluded are
excluded because the feature does not exist (news thumbnails, map markers), not because they were
overlooked.**


---

## 12. Generation log

### B1 · crop-scan symptoms — SHIPPED (photographic), cartoon variant under evaluation

**v1 (12 × 3, Lane P)** — rejected as a set. Three faults, two of them mine:

1. **Species drifted.** Some leaves rendered as cotton (palmate), most as cordate. The set's whole
   premise is *"same leaf, only the symptom differs"* — that broke it. Fix: species moved into the
   family clause as explicit geometry (*"palmately lobed with five pointed lobes… NOT cordate"*), with
   `cordate leaf, oval leaf` added to the negative.
2. **`white_powder` was botanically wrong in my prompt.** I wrote *"dense along the midrib, thinning
   toward the margin"*; the model obeyed and produced a **white paint stripe**. Real powdery mildew is
   scattered circular patches. Rewritten.
3. **Three symptoms could not obey their own template.** `stunted`, `stem_rot` and `root_rot` are
   inherently not leaf-only, so the model ignored the *"no soil"* clause and rendered field scenes.
   Fix: split into a second family, `symptoms-plant`, with a shallow soil band on the same backdrop.

Also: the *"neutral warm-grey"* backdrop rendered muddy brown, so every tile was a dark box on the
app's `#f9fdf6` cards. Changed to near-white `#f2f0ec`.

**v2 (12 × 3)** — shipped. 24 WebP files, **152 KB total**, every file under its 16 KB cap.
No extra generation was needed to fix the six weakest: better candidates already existed among the
three per ID. **Reviewing all candidates before regenerating saved a full rerun.**

| Verdict | Symptoms |
|---|---|
| Strong | `yellow_leaves` `brown_spots` `white_powder` `insects` `holes` `stunted` `fruit_damage` `stem_rot` `root_rot` `pale_color` |
| Weak | `wilting` · `curling_leaves` — both read as *"green leaf, slightly deformed"* at 72 px, and are the two most confusable with each other and with a healthy leaf |

**Open question — Lane P vs Lane C for this set.** Photographic imagery is faithful but cannot
exaggerate. For an **input affordance** — the farmer describing what they see, not identifying a
specimen — a field-guide illustration can enlarge and separate the distinguishing feature, which is
exactly what `wilting` and `curling_leaves` need. A 4-symptom Lane C test is running against two
controls (`yellow_leaves`, `white_powder`) and the two weak ones. **Both sets are being kept until
that comparison is decided.**

Cost to date: **$3.04** across 24 calls / 72 candidates.

### Method notes worth carrying to every later batch

- **Review the contact sheet at true render size, never the full-size image.** Half the v1 judgements
  reversed at 72 px.
- **Check the other candidates before regenerating.** Six of six weak picks had a better sibling.
- **A family template that some members cannot obey is a spec bug, not a model failure.**
