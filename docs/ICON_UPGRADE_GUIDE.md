# CropSetu — Colourful & Realistic Icon Upgrade Guide

> **Goal:** Our farmers often cannot read fluently. They navigate by **shape + colour**, not text.
> This document lists **every place** in the app where a flat, one-colour line icon
> should become a **colourful, realistic icon**, what to use, and at **what size**.

---

## 1. The problem in one line

The app currently draws **~825 monochrome Ionicons** (flat single-colour line drawings).
For a low-literacy user, a grey "leaf-outline" and a grey "flask-outline" look almost the
same. Colour + a recognisable real-world shape is what lets a non-reader tap the right thing.

### Good news — we already own a colourful icon kit

These realistic SVG icon sets already exist in `frontend/src/components/` and are **under-used**.
Reuse them everywhere first before drawing anything new:

| Component | Import / usage | Covers |
|---|---|---|
| `CropIcons.js` | `<CropIcon crop="Tomato" size={56} />` | 66 realistic crops (veg, fruit, cereal, pulses, spices…) |
| `AnimalIcons.js` | `<AnimalIcon type="Cow" size={48} />` | cow, buffalo, goat, bullock, sheep, poultry, horse, camel, all |
| `ActivityIcons.js` | `<ActivityIcon type="SOWING" size={56} />` | landprep, sowing, irrigation, fertilizer, spray, scout, weeding, pruning, harvest, sale, expense, income, other |
| `MachineryIcons.js` | `<MachineryIcon type="tractor" size={48} />` | tractor, harvester, sprayer, rotavator, thresher, transplanter, truck, tempo |
| `IrrigationIcons.js` | `<IrrigationIcon type="drip" size={48} />` | drip, sprinkler, flood, rainfed, canal |
| `SoilIcons.js` | `<SoilIcon type="black" size={48} />` | black, red, alluvial, sandy, clay, laterite |

**Style to match when drawing new icons** (from `CropIcons.js`): `viewBox="0 0 200 200"`,
radial + linear gradients for 3D shading, a soft ground-shadow ellipse near `cy≈178`, a
top-left highlight/shine, and a real-world colour palette.

---

## 2. Icon size standard (use these everywhere)

Pick the size from the **role** of the icon, not by guessing:

| Role | Size (px) | Notes |
|---|---|---|
| Hero / empty-state illustration | **64–96** | The big picture a user sees when a screen is empty |
| Home feature tile / category browse tile | **48–64** | Must be tappable + recognisable from arm's length |
| List-item / card thumbnail fallback | **32–48** | Animal/machinery/crop photo missing → show its icon |
| Section header / picker chip | **24–32** | Beside a label |
| Inline meta / status badge | **16–22** | Keep flat if **< 20px** — detail is lost below this |
| Pure utility (chevron, close X, back, search) | any | **Keep flat Ionicons.** Universally understood. |

**Rule:** below ~20px a detailed colour icon turns to mud — keep those as flat Ionicons.
Spend the effort on the big, decision-making icons.

### A note on emoji (🌱🚜) vs SVG
Emoji are tempting and quick, but they **render differently on every Android version** and
can look broken on cheap phones — exactly our audience. **Prefer the SVG components above and
filled `MaterialCommunityIcons` with a brand colour.** Use emoji only as a throwaway prototype.

---

## 3. TOP PRIORITY — the icons every user sees daily

### 3.1 Bottom navigation tabs — `navigation/AppNavigator.js` (lines 61–68)
The **6 most-seen icons in the whole app**. Currently flat Ionicons at ~25px.

| Tab | Current icon | Recommendation | Size |
|---|---|---|---|
| AgriStore | `storefront` | Colourful shop front (red roof, goods in window) — new `ShopIcon` | 26–28 |
| AIAssistant | `hardware-chip` | Glowing chip/spark in KhetAI green→gold — new `AIIcon` | 26–28 |
| AnimalTrade | `paw` | Colour cow/buffalo head — reuse `AnimalIcon type="Cow"` | 26–28 |
| Rent | `construct` | Colour tractor — reuse `MachineryIcon type="tractor"` | 26–28 |
| MyFarm | `leaf` | Colour green sprout/field — new `FarmIcon` or `ActivityIcon` | 26–28 |
| Account | `person-circle` | OK to keep; tint with brand green | 26–28 |

> At minimum, give the **active** tab a full-colour icon and the inactive tab the flat one —
> this alone makes "where am I" obvious to a non-reader.

### 3.2 Weather — `screens/Weather/WeatherHome.js`  ⚠️ biggest single win
There is **no `WeatherIcons.js` yet** — weather is drawn with flat `sunny` / `cloud-outline` /
`water-outline`. Weather is pure colour in real life; flat outlines lose all meaning.

**→ Create `components/WeatherIcons.js`** (`<WeatherIcon condition="rain" size={…} />`):

| Condition | Look | Used at |
|---|---|---|
| sunny / clear | golden sun + glow | hero ~526, hourly ~203, daily ~225 |
| partly cloudy | sun behind grey-white cloud | same |
| cloudy / overcast | layered grey clouds | same |
| rain / showers | blue cloud + droplets | same |
| thunderstorm | dark cloud + yellow bolt | same |
| fog / mist | pale grey bands | same |

Sizes: **hero 56–72**, **hourly tiles 24–28**, **7-day rows 24–28**.
Secondary weather metrics (`thermometer-outline`, `navigate-outline` for wind, `water-outline`
for humidity) — give them a **colour gradient** (red↔blue thermometer, blue droplet) or leave
flat if rendered < 20px.

### 3.3 AI Hub — `screens/AI/AIAssistantHome.js` (the landing screen)
Quick-services row (lines 33–36) + the 6 tool cards (lines 41–47) are all flat Ionicons at 22–26px.

| Tile | Line | Current | Recommendation | Size |
|---|---|---|---|---|
| Crop / disease scan | 33,41 | `scan-circle`/`scan` | `CropIcon` preview or new scan-leaf icon | 48–56 |
| Chat support | 34,42 | `chatbubble-ellipses` | colour chat bubble (keep, tint) | 48–56 |
| Markets / mandi | 35,46 | `trending-up`/`storefront` | colour shop / ₹ basket | 48–56 |
| Weather | 36 | `partly-sunny` | new `WeatherIcon` | 48–56 |
| Voice chat | 43 | `mic` | colour mic (orange) | 48–56 |
| My farms | 44 | `leaf` | `CropIcon`/`ActivityIcon` | 48–56 |
| Soil health | 45 | `flask` | `SoilIcon type="black"` | 48–56 |
| State crops | 47 | `map` | colour India map / crop cluster | 48–56 |

---

## 4. Section-by-section recommendations

### 4.1 AI screens — `screens/AI/`

| Screen | Where | Current | Recommendation | Size |
|---|---|---|---|---|
| CropScanScreen | crop / soil / irrigation pickers | ✅ already `CropIcon`/`SoilIcon`/`IrrigationIcon` | keep | 28–32 |
| CropScanScreen | 12 symptom chips (L65–77) | `leaf/bug/snow-outline`… | small colour symptom set (yellowing leaf, brown spot, insect, wilt, hole) | 22–24 |
| DailyPlannerScreen | task list icons (L26–62) | `flask/cut/water/bug-outline` | **`ActivityIcon`** (spray/pruning/irrigation/scout) — exact match | 24–28 |
| InputCalculatorScreen | cost categories (L20–26) | `ellipse/flask/people/bug/water` | **`ActivityIcon`** (sowing/fertilizer/spray/irrigation) | 24–28 |
| MarketScreen | crop picker modal | ✅ already `CropIcon` | keep | 60 |
| MarketScreen | 7 category chips (L276) | `leaf/nutrition/grid…` | colour category icons (veg/fruit/cereal/pulse/oilseed/spice) | 24–28 |
| MarketScreen | empty state (L300) | `leaf-outline` | `CropIcon` / farm scene | 48 |
| FarmCalendarScreen | empty state (L272,312) | `calendar-outline` | `ActivityIcon` seasonal / colour calendar | 48 |
| DiagnosisResultScreen | severity badges (L41–46) | already coloured | keep; ensure red/amber/green by level | 24–28 |
| IrrigationScreen | empty / hero water | `water-outline` | `IrrigationIcon` / colour droplet | 36–40 |
| SoilHubScreen | tile grid | ✅ already colour (lucide) | keep | 22 |
| SchemeScreen, AICreditsScreen, MSPTracker | status/type icons | already colour-coded | keep | — |

### 4.2 My Farm — `screens/FarmProfile/`
This area is the **best citizen** — quick-log chips, the activity picker, the activity feed,
crop-cycle tiles, the soil/irrigation pickers already use the colour SVG sets. Remaining gaps:

| Screen | Where | Current | Recommendation | Size |
|---|---|---|---|---|
| `logging/_loggerKit.js` `SectionHeader` (L34) | **shared by 9 log screens** | flat `Ionicons name={icon}` | route to matching `ActivityIcon` → colourises every log header at once | 16–20 |
| SowingLogScreen | method tiles | `grid/remove/ellipse-outline` | colour method tiles (broadcast/line/dibble/transplant) | 22 |
| LandPrepLogScreen | operation/implement tiles | `swap/grid/remove` | `MachineryIcon` where it maps; else colour set | 22 |
| ScoutLogScreen | issue type grid | `bug/medkit/leaf/flask` | colour pest/disease/weed/deficiency/healthy set | 24 |
| MyFarmHomeScreen | empty feed (L199,468) | `sparkles`/`leaf` | `CropIcon`/`ActivityIcon` to feel inviting | 18–28 |
| FarmListScreen / FarmDetailScreen | "no farms/cycles" (L131/179) | `leaf` | `CropIcon` / `SoilIcon` | 24–28 |
| GrowthStoryScreen / `ui/StageTimelineBar.js` | stage dots | plain dots | tiny stage `ActivityIcon` (sow→flower→harvest) inside dots | 14–20 |

### 4.3 Store & Seller — `screens/AgriStore/` + `screens/Seller/`

| Screen | Where | Current | Recommendation | Size |
|---|---|---|---|---|
| AgriStoreHome | category pills (L178–255) | flat mapped Ionicons @14px | **new `StoreCategoryIcons.js`** — seed packet, fertilizer sack, sprayer bottle, hand tool, polyhouse; reuse `MachineryIcon`/`AnimalIcon`/`IrrigationIcon` for those categories | 28–32 |
| AgriStoreHome | empty state (L637) | `storefront-outline` | colour shop front | 64–80 |
| CartScreen | empty cart (L99) | `bag-outline` | colour basket/bag | 80–96 |
| CartScreen | free-delivery bar (L239) | `car-outline` | colour delivery truck | 18–20 |
| ProductDetail / Home | image placeholder | `leaf` | category-aware `MockImagePlaceholder` (already exists) | 26–80 |
| DashboardScreen | 4 stat cards (L51–97) | flat prop icons @22px | **new `DashboardStatIcons.js`** — order slip, coin stack, package, gold star | 28–32 |
| DashboardScreen | quick-action buttons (L100–129) | flat prop icons | colour: add(+leaf), orders(slip), reports(chart), settings(gear) | 32–40 |
| OrdersScreen | status badges (L22–39) | `time/checkmark/car/bag-check/close` | colour status set (amber wait, green ✓, blue truck, green box, red ✗) | 16–18 |
| OrdersScreen / MyProductsScreen / ReceivedReportsScreen | empty states | `receipt/storefront/leaf-outline` | colour receipt / shop+plus / clipboard | 64–80 |
| OrderConfirmedScreen | success | flat check | big green animated check / celebration | 80–96 |

### 4.4 Animal Trade — `screens/AnimalTrade/`

| Screen | Where | Current | Recommendation | Size |
|---|---|---|---|---|
| AnimalTradeHome | category filter pills | ✅ already `AnimalIcon` @50 | keep | 50 |
| AnimalDetail | hero photo fallback (L138) | `paw` @90 | **`AnimalIcon type={listing.animalType} size={90}`** | 90 |
| AnimalDetail | milk-yield highlight (L78) | `water-outline` | colour milk bottle/can | 18–22 |
| MyAnimalChatsScreen | empty state (L53) | `paw-outline` @26 | `AnimalIcon type="All" size={48}` | 48 |
| AnimalTradeHome | empty-state paw (L251) | `paw` @40 | drop it / colour badge (AnimalIcons below already show) | 40 |

### 4.5 Rent — `screens/Rent/`

| Screen | Where | Current | Recommendation | Size |
|---|---|---|---|---|
| RentHome | machinery category chips | ✅ already `MachineryIcon` @28 | keep ("all"/"other" stay flat) | 28 |
| RentHome | empty "no machinery" (L998) | `construct-outline` @36 | `MachineryIcon type="tractor" size={56}` | 56 |
| RentHome | "List your equipment" banner (L1102) | `construct` @28 | `MachineryIcon` | 32–40 |
| MachineryDetail | hero photo fallback (L397) | `construct` @80 | `MachineryIcon type={data.category} size={80}` | 80 |
| RentBookingsScreen | machinery booking badge (L156) | `construct-outline` @22 | optional `MachineryIcon` @22 | 22 |
| (gap) | worker/labour empty + "no workers" (L1051) | `people-outline` | **new `LabourIcon`** (worker with tool) — colour | 56 |

### 4.6 Profile, Onboarding, Auth — `screens/Profile/`, `Onboarding/`, `Auth/`

| Screen | Where | Current | Recommendation | Size |
|---|---|---|---|---|
| ProfileScreen | menu rows / stat tiles | `paw/cart/construct-outline` | reuse `AnimalIcon`/`MachineryIcon`; colour order/location icons | 20–24 |
| MyOrdersScreen | empty state (L160) | `cart-outline` @64 | colour empty-bag icon | 64 |
| MyAnimalListingsScreen | empty state (L174) | `paw-outline` @64 | `AnimalIcon` muted | 64 |
| OnboardingLanguageScreen | hero (L129) | `language` | colour globe with regions — `LanguageIcon` | 26–48 |
| OnboardingProfileScreen | "not sure" soil (L373) | `help-circle-outline` | colour "?" soil swatch | 22 |
| OnboardingProfileScreen | "mixed" irrigation (L389) | `options-outline` | colour blended irrigation icon | 22 |
| LoginScreen | submit arrows / language | flat (fine) | keep arrows; colour `LanguageIcon` if shown | — |

### 4.7 Shared components — `components/`
Mostly utility — **keep flat**: `LocationPicker` (chevron/search), `ScrollToTopButton` (arrow up).
`FarmProfileBanner` / `MockImagePlaceholder` should fall back to a **category-aware colour icon**
(crop/animal/machinery) rather than a generic leaf.

---

## 5. New icon components to build (in priority order)

1. **`WeatherIcons.js`** — sunny, partly-cloudy, cloudy, rain, thunderstorm, fog *(highest impact)*
2. **`StoreCategoryIcons.js`** — seed packet, fertilizer sack, pesticide/sprayer, hand tools, polyhouse, irrigation, (reuse machinery/animal)
3. **`DashboardStatIcons.js`** — orders, revenue/coins, products/package, reviews/star
4. **Tab icons** — `ShopIcon`, `AIIcon`, `FarmIcon` (AnimalTrade & Rent reuse existing sets)
5. **`LabourIcon.js`** — worker for the Rent → labour side
6. **`LanguageIcon.js`** — colourful globe for onboarding
7. **Order-status & empty-state set** — coloured badges + friendly empty illustrations

All should follow the `CropIcons.js` recipe (200×200 viewBox, gradients, ground shadow, highlight).

---

## 6. Suggested rollout

| Phase | Effort | What | Why first |
|---|---|---|---|
| **1 — reuse only** | low | Swap flat icons for existing SVG sets: AnimalDetail/MachineryDetail/RentHome fallbacks & empty states, DailyPlanner & InputCalculator (`ActivityIcon`), `_loggerKit` SectionHeader | Zero new art, instant wins |
| **2 — weather + tabs** | medium | Build `WeatherIcons.js`; colourise the 6 bottom tabs (at least active state) | Most-seen surfaces |
| **3 — store + dashboard** | medium | `StoreCategoryIcons.js`, `DashboardStatIcons.js`, order-status set | Commerce clarity, fewer wrong taps |
| **4 — polish** | low | Empty-state illustrations, onboarding `LanguageIcon`, stage-timeline icons | Delight + completeness |

**Always keep the text label next to the icon** (i18n via `useLanguage()` / `t()` is already wired) —
icon + colour + word in the user's language is the most accessible combination.

---

*Generated from a full read-through of `frontend/src` (97 screens, ~825 Ionicon usages).
Line numbers are approximate — confirm against the file before editing.*
