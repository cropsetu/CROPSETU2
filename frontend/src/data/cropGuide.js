// cropGuide.js
// Crop-guide directory for CropSetu. Keyed by each entry's normalized `key`.
// Exposes CROP_GUIDE (the directory) and getCropGuide(name) — a tolerant lookup
// helper that normalizes crop names and resolves common aliases/synonyms.

export const CROP_GUIDE = {
  "rice": {
    "key": "rice",
    "title": "Rice (Paddy)",
    "emoji": "🌾",
    "about": "Rice is India's staple food cereal and the leading kharif crop, grown on over 44 million hectares mainly in West Bengal, UP, Punjab, Andhra Pradesh, Telangana, Odisha, Bihar and Tamil Nadu. It is the backbone of food security and the main income crop for millions of smallholders in irrigated and rainfed lowlands.",
    "uses": "Milled rice for consumption, parboiled and basmati exports, rice bran oil, broken rice for starch/feed, straw for cattle fodder and mushroom beds.",
    "soil": "Clay to clay-loam soils with good water-holding capacity; tolerates pH 5.5–7.5 and even mild salinity/alkalinity. Heavy soils that hold standing water are ideal.",
    "climate": "Warm humid crop; 20–37°C with optimum 25–30°C. Needs 1000–1500 mm water; high humidity favours growth but excess late rain delays harvest.",
    "season": "Mainly Kharif (June–July sowing, Oct–Nov harvest); Rabi/summer rice (Dec–Jan transplant) in irrigated south and east India.",
    "duration": "110–150 days (short-duration 110–120, medium 120–135, long-duration/basmati 135–150 days)",
    "seedRate": "Transplanting: 8–12 kg/acre (nursery); direct seeding (DSR): 8–12 kg/acre; SRI: 2 kg/acre",
    "spacing": "20 × 15 cm normal transplanting (1–2 seedlings/hill); SRI 25 × 25 cm single seedling; DSR rows 20 cm apart",
    "sowingMethod": "Wet-bed nursery then transplant 21–25 day seedlings into puddled field; or direct seeded rice (DSR) with drum seeder; SRI for water saving. Seed treatment: Carbendazim 2 g/kg or Trichoderma 4 g/kg; soak-sprout seed before nursery sowing.",
    "varieties": [
      "MTU-1010 (Cotton Dora)",
      "Swarna (MTU-7029)",
      "BPT-5204 (Samba Mahsuri)",
      "Pusa Basmati 1121",
      "Pusa Basmati 1509",
      "IR-64",
      "Sahbhagi Dhan (drought-tolerant)",
      "Pusa 44"
    ],
    "nutrients": {
      "basal": "DAP 45 kg + MOP 13 kg + ZnSO4 10 kg per acre at last puddling; apply 4 t FYM/acre. (Total recommendation ~40:20:20 kg NPK/acre)",
      "topDress": [
        "Urea 20 kg/acre at active tillering (20–25 DAT)",
        "Urea 20 kg/acre at panicle initiation (40–45 DAT)",
        "Spray 1% urea or ZnSO4 0.5% if zinc/N deficiency (yellowing) seen"
      ]
    },
    "irrigation": "Maintain 2–5 cm standing water through vegetative stage. Moisture-critical stages: active tillering, panicle initiation, flowering and grain filling — never let these stages dry out. Drain field 7–10 days before harvest. AWD (alternate wetting and drying) saves 25–30% water.",
    "weed": "Pre-emergence Pretilachlor or Butachlor within 3 DAT; or Bispyribac-sodium 25–30 DAT for post-emergence (Echinochloa, sedges). One hand weeding at 30–40 DAT in DSR. Keep thin water film to suppress weeds.",
    "pests": [
      {
        "name": "Yellow stem borer",
        "symptom": "Dead hearts in vegetative stage, white ears (whiteheads) at panicle stage",
        "control": "Cartap hydrochloride 4G @ 8 kg/acre or Chlorantraniliprole 0.4G; install pheromone traps; remove egg masses"
      },
      {
        "name": "Brown plant hopper (BPH)",
        "symptom": "Hopper burn — circular patches of dried plants, sooty mould at base",
        "control": "Drain water; spray Pymetrozine 50 WG or Imidacloprid; avoid excess nitrogen; use resistant varieties"
      },
      {
        "name": "Leaf folder",
        "symptom": "Leaves folded longitudinally, scraped white papery streaks",
        "control": "Spray Flubendiamide or Cartap; avoid dense planting and excess N"
      },
      {
        "name": "Gundhi bug (rice ear bug)",
        "symptom": "Empty/chaffy grains, foul smell at milky stage",
        "control": "Spray Malathion 50 EC at flowering; field sanitation"
      }
    ],
    "diseases": [
      {
        "name": "Blast (leaf & neck blast)",
        "symptom": "Spindle-shaped spots with grey centre on leaves; blackened neck breaks panicle",
        "control": "Spray Tricyclazole 75 WP @ 120 g/acre at boot and heading; use resistant varieties; avoid excess N"
      },
      {
        "name": "Bacterial leaf blight (BLB)",
        "symptom": "Yellow wavy margins drying from leaf tip, milky ooze",
        "control": "Drain field; spray Copper oxychloride + Streptocycline; avoid excess N; use resistant varieties"
      },
      {
        "name": "Sheath blight",
        "symptom": "Greenish-grey oval lesions on sheath near water line, snake-skin pattern",
        "control": "Spray Validamycin or Hexaconazole; wider spacing; balanced N"
      },
      {
        "name": "False smut",
        "symptom": "Velvety yellow-green spore balls replacing grains",
        "control": "Spray Propiconazole at booting; avoid late high N; use clean seed"
      }
    ],
    "harvest": "Harvest when 80–85% grains turn golden-yellow and lower grains harden; grain moisture ~20–22%. Cut with sickle or combine, thresh, dry to 14%. Yield 20–30 quintal/acre irrigated, 35+ for high-yielding hybrids.",
    "yield": "20–30 quintal/acre (irrigated HYVs); 8–15 quintal/acre rainfed",
    "postHarvest": "Dry paddy to 12–14% moisture in 2–3 days; store in clean gunny/jute bags or metal bins away from moisture. Parboiling improves milling recovery. Avoid heap drying that causes grain cracking.",
    "marketTips": "Sell at FCI/state procurement under MSP (Common paddy MSP ₹2300/qtl, Grade-A ₹2320/qtl for 2024-25). Basmati fetches premium in private mandi — get good grain length grading. Value-add via parboiling, rice bran oil and branded packaging. Register on eNAM for better price discovery.",
    "dosDonts": [
      "Do level and puddle the field well for uniform water and weed control",
      "Do transplant young 21–25 day seedlings; SRI single seedling boosts tillering",
      "Don't apply all nitrogen as basal — split it to cut lodging and BPH",
      "Don't keep deep standing water continuously; use AWD to save water and roots",
      "Do treat seed and use certified disease-resistant varieties"
    ]
  },
  "wheat": {
    "key": "wheat",
    "title": "Wheat",
    "emoji": "🌾",
    "about": "Wheat is India's principal rabi cereal and second staple after rice, grown on ~31 million hectares mainly in UP, Punjab, Haryana, MP, Rajasthan and Bihar. It is central to the Green Revolution belt and to national food security and PDS supply.",
    "uses": "Atta/maida for chapati, bread, biscuits; semolina (suji/rava), dalia; straw (bhusa) as valuable cattle fodder.",
    "soil": "Well-drained loam to clay-loam with good organic matter; pH 6.0–7.5. Avoid waterlogged or highly saline soils.",
    "climate": "Cool-season crop; needs 10–15°C at sowing/tillering and 20–25°C at grain filling. Bright sunny days and cool nights give best yields; >30°C during grain fill causes shrivelling.",
    "season": "Rabi — timely sowing 1st–20th November; late sowing up to mid-December reduces yield. Harvest March–April.",
    "duration": "120–145 days (timely-sown), 100–110 days for late-sown short varieties",
    "seedRate": "40 kg/acre (timely sown); 50 kg/acre for late sowing and bold-seeded varieties",
    "spacing": "Rows 20–22.5 cm apart (seed-drill); 18 cm for late sowing to compensate plant population",
    "sowingMethod": "Line sowing with seed-cum-fertilizer drill at 5–6 cm depth; Zero-till drill after rice saves time and moisture; Happy Seeder manages residue. Seed treatment: Carboxin/Carbendazim 2 g/kg against loose smut, or Tebuconazole.",
    "varieties": [
      "HD-2967",
      "HD-3086",
      "HD-3226 (Pusa Yashasvi)",
      "PBW-343",
      "PBW-725",
      "DBW-187 (Karan Vandana)",
      "DBW-222",
      "GW-322 (MP)"
    ],
    "nutrients": {
      "basal": "DAP 55 kg + MOP 20 kg + ZnSO4 10 kg per acre at sowing with drill; add 4 t FYM. (Total ~48:24:16 kg NPK/acre)",
      "topDress": [
        "Urea 35 kg/acre at first irrigation/crown root stage (20–25 DAS)",
        "Urea 30 kg/acre at second irrigation/tillering (40–45 DAS)",
        "Spray 2% urea at grain-filling if pale; foliar 0.5% ZnSO4 if zinc deficient"
      ]
    },
    "irrigation": "5–6 irrigations needed. Most critical stage is crown root initiation (CRI, 20–25 DAS) — never miss it. Other critical stages: tillering (40–45 DAS), jointing, flowering and milk/dough (grain filling). Light frequent irrigation; ensure drainage to avoid waterlogging.",
    "weed": "Broadleaf (Bathua, wild safflower) — spray 2,4-D or Metsulfuron 30–35 DAS. Grassy weed Phalaris minor — spray Clodinafop, Sulfosulfuron or Pinoxaden at 30–35 DAS; rotate herbicide groups to avoid resistance.",
    "pests": [
      {
        "name": "Aphids",
        "symptom": "Clustering on leaves/earheads, honeydew and sooty mould, sap sucking",
        "control": "Spray Imidacloprid 17.8 SL or Thiamethoxam; conserve ladybird beetles"
      },
      {
        "name": "Termites",
        "symptom": "Wilting/drying of seedlings, plants easily pulled out with eaten roots",
        "control": "Seed treatment with Chlorpyriphos/Fipronil; apply Chlorpyriphos with irrigation water in affected patches"
      },
      {
        "name": "Pink stem borer",
        "symptom": "Dead hearts in early crop, especially after paddy residue",
        "control": "Avoid loose paddy residue; spray Chlorantraniliprole; deep summer ploughing"
      },
      {
        "name": "Army worm",
        "symptom": "Defoliation, cut earheads in patches at night",
        "control": "Spray Quinalphos or Chlorpyriphos in the evening; flood field if possible"
      }
    ],
    "diseases": [
      {
        "name": "Yellow (stripe) rust",
        "symptom": "Yellow powdery stripes in rows along leaf veins, rubs off yellow on hand",
        "control": "Spray Propiconazole 25 EC @ 200 ml/acre on first appearance; grow resistant varieties (DBW-187, HD-3086)"
      },
      {
        "name": "Brown/leaf rust",
        "symptom": "Orange-brown scattered pustules on leaf surface",
        "control": "Spray Propiconazole or Tebuconazole; timely sowing; resistant varieties"
      },
      {
        "name": "Loose smut",
        "symptom": "Earheads converted to black powdery mass at heading",
        "control": "Seed treat with Carboxin or Tebuconazole; use certified disease-free seed"
      },
      {
        "name": "Karnal bunt",
        "symptom": "Partially blackened grains with fishy smell",
        "control": "Seed treatment, resistant varieties, avoid high humidity at flowering; spray Propiconazole at ear emergence"
      }
    ],
    "harvest": "Harvest when crop turns golden-yellow, grains hard and straw dry (~20% moisture); plants rustle. Combine harvest or sickle + thresher. Avoid shattering by not over-delaying. Yield 18–24 quintal/acre in irrigated belt.",
    "yield": "18–24 quintal/acre (irrigated); 10–14 quintal/acre rainfed",
    "postHarvest": "Dry grain to 10–12% moisture; clean and store in jute bags/metal bins with Malathion-treated surface or Aluminium phosphide fumigation in airtight stores against weevils. Keep store dry and rodent-proof.",
    "marketTips": "Sell under MSP via state mandis/FCI (Wheat MSP ₹2425/qtl for 2025-26 / RMS). Ensure proper drying and low moisture for fair fair-average-quality (FAQ) grading. Sharbati/MP wheat fetches premium. Value-add via atta milling, dalia, branded flour. Use eNAM for price comparison.",
    "dosDonts": [
      "Do sow timely (first fortnight Nov) — each day's delay after mid-Nov cuts yield",
      "Do never miss CRI irrigation at 20–25 DAS",
      "Don't broadcast seed — line sowing gives uniform stand and easy weeding",
      "Don't ignore Phalaris minor; rotate herbicides to prevent resistance",
      "Do choose rust-resistant varieties suited to your zone"
    ]
  },
  "maize": {
    "key": "maize",
    "title": "Maize",
    "emoji": "🌽",
    "about": "Maize is India's third most important cereal and the fastest-growing, grown on ~10 million hectares in Karnataka, MP, Bihar, Tamil Nadu, Telangana, Maharashtra and Rajasthan. It is a versatile food-feed-industrial crop and a key cash crop for smallholders in both kharif and rabi.",
    "uses": "Poultry and cattle feed (largest use), human food (roti, sweet corn, popcorn), starch, glucose, ethanol, corn oil and processed snacks.",
    "soil": "Well-drained fertile loam to silty-loam rich in organic matter; pH 5.5–7.5. Cannot tolerate waterlogging — good drainage essential.",
    "climate": "Warm crop; 21–30°C optimum, needs warm days and cool nights. Requires 500–800 mm well-distributed moisture; sensitive to water stress and waterlogging.",
    "season": "Kharif (June–July), Rabi (Oct–Nov, high-yielding irrigated) and Spring/Zaid (Jan–Feb). Rabi maize gives the highest yields.",
    "duration": "85–110 days (kharif), 110–130 days (rabi/winter)",
    "seedRate": "8 kg/acre (hybrid grain); 6–7 kg for sweet corn; 16 kg for fodder maize",
    "spacing": "60–75 cm between rows × 20–25 cm between plants (~26,000–30,000 plants/acre)",
    "sowingMethod": "Dibbling or seed drill on ridges/flat beds at 4–5 cm depth, single seed per hill. Ridge-furrow helps drainage in kharif. Seed treatment: Imidacloprid/Thiamethoxam against shoot fly + Trichoderma/Metalaxyl against downy mildew.",
    "varieties": [
      "DHM-117",
      "Pioneer 30V92",
      "NK-6240 (Syngenta)",
      "Bio-9637",
      "HQPM-1 (quality protein maize)",
      "Pusa HQPM-5 Improved",
      "Ganga-5",
      "DKC-9108"
    ],
    "nutrients": {
      "basal": "DAP 50 kg + MOP 25 kg + ZnSO4 10 kg per acre + 4 t FYM at sowing. (Total ~48:24:24 kg NPK/acre; hybrids need higher N)",
      "topDress": [
        "Urea 30 kg/acre at knee-high stage (25–30 DAS)",
        "Urea 30 kg/acre at tasseling/pre-flowering (45–50 DAS)",
        "Foliar 0.5% ZnSO4 + 2% urea if white-banded leaves (Zn deficiency)"
      ]
    },
    "irrigation": "Critical moisture stages: knee-high, tasseling, silking and grain-filling — silking is the most sensitive; stress here causes poor grain set. Avoid waterlogging at all stages. Rabi maize needs 5–7 irrigations; kharif supplemental in dry spells.",
    "weed": "Pre-emergence Atrazine @ 200–250 g/acre within 2 DAS (do not use Atrazine where pulses are intercropped). One hand weeding/inter-cultivation at 25–30 DAS; earthing-up controls weeds and lodging.",
    "pests": [
      {
        "name": "Fall armyworm (FAW)",
        "symptom": "Ragged windowpane feeding and moist sawdust-like frass in whorl",
        "control": "Spray Emamectin benzoate 5 SG or Spinetoram into whorl; pheromone traps; first-window app at 3–4 leaf stage"
      },
      {
        "name": "Stem borer",
        "symptom": "Shot holes on leaves, dead hearts, tunnelled stem",
        "control": "Apply Cartap 4G in whorl; spray Chlorantraniliprole; remove affected plants"
      },
      {
        "name": "Shoot fly",
        "symptom": "Dead heart in young seedlings (kharif/late sown)",
        "control": "Seed treatment Thiamethoxam/Imidacloprid; early uniform sowing"
      },
      {
        "name": "Pink stem borer",
        "symptom": "Tunnelling and dead hearts, mainly rabi maize",
        "control": "Spray Chlorantraniliprole; destroy stubble after harvest"
      }
    ],
    "diseases": [
      {
        "name": "Turcicum leaf blight (TLB)",
        "symptom": "Long boat-shaped grey-green to tan lesions on leaves",
        "control": "Spray Mancozeb 75 WP @ 400 g/acre or Propiconazole; resistant hybrids; crop rotation"
      },
      {
        "name": "Downy mildew (sorghum/maydis)",
        "symptom": "Chlorotic stripes, white downy growth on leaf underside, stunting",
        "control": "Seed treat Metalaxyl 4 g/kg; rogue infected plants; spray Metalaxyl+Mancozeb"
      },
      {
        "name": "Banded leaf & sheath blight",
        "symptom": "Banded discoloured lesions on sheath and leaves near ground",
        "control": "Spray Validamycin or Hexaconazole; wider spacing; remove lower diseased leaves"
      },
      {
        "name": "Charcoal rot/stalk rot",
        "symptom": "Soft shredded stalk pith, lodging, premature drying (water stress)",
        "control": "Balanced K, avoid moisture stress at grain fill, resistant hybrids, crop rotation"
      }
    ],
    "harvest": "Harvest when husks turn dry/brown and grains hard with black layer at base (grain moisture ~20–25%). Dehusk, dry cobs, then shell. Yield 25–35 quintal/acre rabi hybrids, 18–25 kharif.",
    "yield": "25–35 quintal/acre (rabi irrigated hybrids); 15–22 quintal/acre kharif",
    "postHarvest": "Dry shelled grain to 12–14% moisture to prevent Aspergillus/aflatoxin; store in dry ventilated bins. Never store damp maize — aflatoxin makes feed unsafe. Cobs can be dried on racks before shelling.",
    "marketTips": "Maize MSP ₹2225/qtl (2024-25); much sold to poultry/starch industry and private traders, often above MSP in deficit years. Low-moisture, aflatoxin-free grain grades best. Value-add via sweet corn, popcorn, poultry-feed tie-ups and ethanol-grade contracts. Track demand on eNAM.",
    "dosDonts": [
      "Do ensure good drainage — maize hates waterlogging",
      "Do scout for fall armyworm from seedling stage and treat in the whorl early",
      "Don't skip irrigation at tasseling-silking; it directly cuts grain set",
      "Don't store damp maize — aflatoxin risk; dry to 12–14%",
      "Do use single-cross hybrids and balanced NPK + Zn for top yields"
    ]
  },
  "jowar": {
    "key": "jowar",
    "title": "Jowar (Sorghum)",
    "emoji": "🌾",
    "about": "Jowar (sorghum) is a hardy, drought-tolerant millet-cereal grown on ~4 million hectares mainly in Maharashtra, Karnataka, Rajasthan, MP and Telangana. It is a vital food and fodder crop for dryland smallholders and a climate-resilient, nutritious 'Shree Anna' (millet) gaining renewed demand.",
    "uses": "Jowar roti/bhakri staple in Maharashtra-Karnataka, fodder (kadbi) for cattle, malt, poultry feed, and now health foods, flakes and gluten-free flour.",
    "soil": "Wide adaptability — black cotton (vertisol) to red loams; pH 6.0–8.5, tolerates moderate alkalinity and drought. Needs decent drainage.",
    "climate": "Warm-season; 25–32°C optimum, germinates at 15°C+. Drought-hardy, grows on 400–600 mm rainfall; rabi jowar thrives on residual soil moisture.",
    "season": "Kharif (June–July) for grain+fodder; Rabi (Sept–Oct) on residual moisture in deep black soils of Maharashtra/Karnataka, which gives premium grain.",
    "duration": "100–120 days (kharif), 115–130 days (rabi)",
    "seedRate": "3–4 kg/acre (grain); 16–20 kg/acre for fodder sorghum",
    "spacing": "45 cm between rows × 12–15 cm between plants",
    "sowingMethod": "Line sowing with seed drill or bullock-drawn ferti-seed drill at 3–4 cm depth; thinning at 15–20 DAS to one plant. Seed treatment: Thiram/Carbendazim 3 g/kg + Imidacloprid against shoot fly; avoid HCN risk in young fodder.",
    "varieties": [
      "CSH-16 (hybrid)",
      "CSH-25",
      "CSV-15",
      "M-35-1 (Maldandi, rabi)",
      "Phule Vasudha",
      "Phule Revati (rabi)",
      "CSV-22",
      "Parbhani Moti"
    ],
    "nutrients": {
      "basal": "DAP 35 kg + MOP 13 kg per acre + 2–3 t FYM at sowing. (Total ~32:16:16 kg NPK/acre; rabi rainfed lower dose)",
      "topDress": [
        "Urea 18 kg/acre at 30–35 DAS (knee-high/tillering) with adequate moisture",
        "Urea 15 kg/acre at 45–50 DAS (boot stage) for irrigated/assured-moisture crop",
        "Foliar 2% urea if pale under moisture stress"
      ]
    },
    "irrigation": "Mostly rainfed. Where irrigation available, critical stages are boot/flag-leaf, flowering and grain-filling — protect these in dry spells. Rabi jowar relies on stored soil moisture; one protective irrigation at booting boosts grain set markedly.",
    "weed": "Pre-emergence Atrazine @ 200 g/acre within 2 DAS; one hand weeding/hoeing at 25–30 DAS. Inter-cultivation conserves moisture and controls weeds in wide rows.",
    "pests": [
      {
        "name": "Shoot fly",
        "symptom": "Dead heart in seedlings (1–4 weeks), maggot cuts growing point",
        "control": "Early uniform sowing; seed treat Imidacloprid/Thiamethoxam; higher seed rate to compensate"
      },
      {
        "name": "Stem borer",
        "symptom": "Shot holes, dead hearts, stem tunnelling",
        "control": "Apply Carbofuran/Cartap 4G in whorl; remove stubble; spray Chlorantraniliprole"
      },
      {
        "name": "Midge",
        "symptom": "Chaffy empty grains, tiny orange maggots in florets at flowering",
        "control": "Synchronous sowing; spray Malathion/Lambda-cyhalothrin at flowering"
      },
      {
        "name": "Aphids/shoot bug",
        "symptom": "Sticky honeydew, sooty mould, leaf yellowing",
        "control": "Spray Dimethoate or Imidacloprid; conserve natural enemies"
      }
    ],
    "diseases": [
      {
        "name": "Grain mould",
        "symptom": "Discoloured, pink/black fungal-coloured grains at maturity (humid kharif)",
        "control": "Grow rabi or mould-tolerant varieties; spray Mancozeb+Carbendazim at flowering; timely harvest"
      },
      {
        "name": "Downy mildew",
        "symptom": "Chlorotic leaf stripes, white downy underside growth, sterility",
        "control": "Seed treat Metalaxyl 4 g/kg; rogue infected plants; resistant varieties; crop rotation"
      },
      {
        "name": "Anthracnose",
        "symptom": "Red-brown leaf spots with dark margins, stalk/midrib rot",
        "control": "Spray Mancozeb or Propiconazole; resistant varieties; field sanitation"
      },
      {
        "name": "Charcoal rot",
        "symptom": "Shredded stalk pith, lodging under terminal drought",
        "control": "Avoid moisture stress at grain fill, balanced K, tolerant varieties, crop rotation"
      }
    ],
    "harvest": "Harvest when grains harden and earheads turn brown with black-layer; grain moisture ~20–25%. Cut earheads, dry and thresh; fodder cut after grain harvest. Yield 10–16 quintal/acre grain plus valuable fodder.",
    "yield": "10–16 quintal/acre (grain); 8–12 quintal/acre rainfed rabi + 40–60 q fodder",
    "postHarvest": "Dry grain to 12% moisture; store in dry bins/bags — clean grain resists storage pests. Maldandi rabi grain (white, lustrous) commands premium. Process into flour, flakes and millet health products.",
    "marketTips": "Jowar MSP (hybrid) ₹3371 and Maldandi ₹3421/qtl (2024-25). Lustrous bold white rabi grain fetches premium in mandis. Millet mission and 'Shree Anna' branding boost demand — sell as value-added flour, multigrain atta, jowar flakes. Sell through eNAM/FPO for better rates.",
    "dosDonts": [
      "Do sow early and uniformly to escape shoot fly",
      "Do prefer rabi jowar on deep black soil for premium grain",
      "Don't graze/feed young drought-stressed sorghum fodder — HCN poisoning risk",
      "Don't delay harvest in humid weather — grain mould lowers grade",
      "Do use seed treatment and tolerant varieties for shoot fly and downy mildew"
    ]
  },
  "bajra": {
    "key": "bajra",
    "title": "Bajra (Pearl Millet)",
    "emoji": "🌾",
    "about": "Bajra (pearl millet) is India's most drought- and heat-tolerant cereal, grown on ~7 million hectares in the harshest dryland tracts of Rajasthan, Gujarat, Haryana, UP and Maharashtra. It is the staple of arid-zone smallholders and a highly nutritious iron-rich 'Shree Anna' millet.",
    "uses": "Bajra roti/khichdi staple food, cattle and poultry feed, green and dry fodder, malt, and health foods (bajra flour, biscuits, energy bars).",
    "soil": "Light sandy to sandy-loam soils; tolerates poor, low-fertility and slightly saline/alkaline soils (pH 6.5–8.5). Excellent on light desert soils where other crops fail.",
    "climate": "Hot dry crop; 25–35°C optimum, tolerant of 42°C+ and drought. Grows on as little as 350–500 mm rainfall; very low water requirement.",
    "season": "Mainly Kharif (June–July with monsoon onset); summer bajra (Jan–Feb) under irrigation in Gujarat/Rajasthan for high yields.",
    "duration": "75–90 days (early hybrids), up to 100 days",
    "seedRate": "1.5–2 kg/acre (hybrid grain); 4–5 kg/acre for fodder",
    "spacing": "45 cm between rows × 10–15 cm between plants",
    "sowingMethod": "Line sowing with seed drill at 2.5–3 cm depth (shallow, light soils); thin to one plant at 15 DAS. Seed treatment: Thiram/Carbendazim 2 g/kg + Metalaxyl 6 g/kg against downy mildew (ergot/smut prone).",
    "varieties": [
      "HHB-67 Improved (early)",
      "GHB-558",
      "RHB-177",
      "Pusa Composite 383",
      "HHB-299 (high-iron)",
      "AHB-1200 (biofortified iron)",
      "MPMH-17",
      "Raj 171"
    ],
    "nutrients": {
      "basal": "DAP 30 kg + MOP 10 kg per acre + 2 t FYM at sowing. (Total ~24:12:8 kg NPK/acre; raise N for irrigated/summer)",
      "topDress": [
        "Urea 18 kg/acre at 25–30 DAS (tillering) after a good rain/irrigation",
        "Urea 12 kg/acre at 40–45 DAS (boot stage) for irrigated crop",
        "Skip second dose under severe drought to avoid scorching"
      ]
    },
    "irrigation": "Largely rainfed and drought-hardy. If irrigation possible, critical stages are tillering, flowering (anthesis) and grain-filling — one or two protective irrigations at these stages greatly raise yield. Summer bajra needs 4–5 irrigations.",
    "weed": "Pre-emergence Atrazine @ 200 g/acre within 2 DAS; one hoeing/hand weeding at 20–25 DAS. Inter-cultivation conserves the scarce soil moisture in dry zones.",
    "pests": [
      {
        "name": "Shoot fly",
        "symptom": "Dead heart in young seedlings",
        "control": "Early uniform sowing with first rains; seed treat Imidacloprid; higher seed rate"
      },
      {
        "name": "White grub",
        "symptom": "Wilting/drying plants, grubs feed on roots (sandy soils, after first rains)",
        "control": "Seed treat/soil application Chlorpyriphos; light traps for adult beetles at dusk; deep summer ploughing"
      },
      {
        "name": "Stem borer",
        "symptom": "Dead hearts, tunnelled stems",
        "control": "Apply Carbofuran 4G in whorl; remove stubble; spray Chlorantraniliprole"
      },
      {
        "name": "Grey weevil/blister beetle",
        "symptom": "Leaf/flower feeding, defoliation at flowering",
        "control": "Spray Malathion or Quinalphos; hand-collect beetles in small fields"
      }
    ],
    "diseases": [
      {
        "name": "Downy mildew (green ear)",
        "symptom": "Chlorotic leaves, white downy underside, leafy 'green ear' replacing grain",
        "control": "Seed treat Metalaxyl 6 g/kg; rogue infected plants; resistant hybrids (HHB-67 Improved); rotation"
      },
      {
        "name": "Ergot",
        "symptom": "Sticky pink honeydew then dark sclerotia on earheads",
        "control": "Use clean seed, resistant varieties, avoid late sowing; spray Mancozeb at flowering; remove sclerotia"
      },
      {
        "name": "Smut",
        "symptom": "Larger green-black sori (smut sacs) on earhead replacing grains",
        "control": "Seed treatment Carbendazim; resistant varieties; rogue smutted earheads early"
      },
      {
        "name": "Rust",
        "symptom": "Reddish-brown pustules on leaves late in season",
        "control": "Spray Mancozeb/Propiconazole if severe; resistant varieties; timely sowing"
      }
    ],
    "harvest": "Harvest when earheads turn brown and grains harden (grain dent gone, moisture ~20%); birds also signal maturity. Cut earheads, sun-dry and thresh. Yield 8–14 quintal/acre rainfed, higher under irrigation, plus fodder.",
    "yield": "8–14 quintal/acre (rainfed); 18–22 quintal/acre summer irrigated + fodder",
    "postHarvest": "Dry grain to 12% moisture quickly — bajra grain can go rancid/musty if damp. Store clean in dry bins. Mill fresh as flour spoils faster than wheat; biofortified high-iron grain has nutrition premium.",
    "marketTips": "Bajra MSP ₹2625/qtl (2024-25). Demand rising under Millet Mission and 'Shree Anna' health branding. Iron-biofortified bajra (HHB-299, AHB-1200) attracts premium and government nutrition programs. Value-add via bajra flour, multigrain atta, snacks. Sell via FPO/eNAM.",
    "dosDonts": [
      "Do sow promptly with first monsoon rains and treat seed against downy mildew",
      "Do choose early short-duration hybrids to escape terminal drought",
      "Don't sow deep in light soils — keep 2.5–3 cm for good emergence",
      "Don't over-irrigate; bajra is a low-water crop and waterlogging harms it",
      "Do remove downy-mildew 'green ear' and ergot/smut heads early to cut spread"
    ]
  },
  "ragi": {
    "key": "ragi",
    "title": "Ragi (Finger Millet)",
    "emoji": "🌾",
    "about": "Ragi (finger millet) is a highly nutritious, calcium-rich small millet grown on ~1 million hectares, mainly in Karnataka (the largest producer), Tamil Nadu, Uttarakhand, Andhra Pradesh and Odisha. It is the food-security backbone of hill and dryland tribal smallholders and a star 'Shree Anna' crop.",
    "uses": "Ragi mudde (balls), roti, porridge, malt and weaning foods; very high calcium and iron; straw is good cattle fodder; value-added health foods and baby foods.",
    "soil": "Red loam to sandy-loam and laterite soils with good drainage; pH 5.0–8.2, tolerates poor and shallow hill soils. Responds well to organic matter.",
    "climate": "Warm humid to semi-arid; 20–30°C optimum, grows from sea level to 2000 m hills. Needs 500–900 mm rainfall; fairly drought-tolerant once established.",
    "season": "Mainly Kharif (June–July transplant/sow); summer/rabi ragi under irrigation in southern states (Dec–Jan).",
    "duration": "100–130 days (early 100–110, medium-late 120–130)",
    "seedRate": "Transplanting: 2 kg/acre (nursery); direct line sowing: 4 kg/acre; broadcast 5 kg/acre",
    "spacing": "Transplanting 22.5 × 10 cm (3–4 week seedlings); line sowing rows 22.5–30 cm apart",
    "sowingMethod": "Raise nursery and transplant 3–4 week seedlings, or line-sow with drill at 2 cm depth. Guli/transplanted ragi gives best yields. Seed treatment: Carbendazim 2 g/kg or Trichoderma against blast/seedling diseases.",
    "varieties": [
      "GPU-28",
      "GPU-67",
      "ML-365",
      "Indaf-9",
      "KMR-301",
      "VL Mandua 324 (hills)",
      "Dapoli-1",
      "MR-6"
    ],
    "nutrients": {
      "basal": "DAP 22 kg + MOP 10 kg per acre + 3 t FYM/compost at transplanting. (Total ~16:12:10 kg NPK/acre; responds strongly to FYM)",
      "topDress": [
        "Urea 18 kg/acre split: half at 20–25 DAT (active tillering)",
        "Remaining urea 18 kg at 40–45 DAT (panicle initiation)",
        "Foliar 2% urea + micronutrient spray if leaves pale on poor hill soils"
      ]
    },
    "irrigation": "Mostly rainfed/upland. Where irrigated, critical stages are tillering, flowering and grain-filling — protect from dry spells then. Transplanted lowland ragi needs light irrigation at establishment and these critical stages; avoid water stagnation.",
    "weed": "Heavy early weed pressure — pre-emergence Oxyfluorfen or Butachlor in transplanted crop; 1–2 hand weedings at 20 and 40 DAT. Line sowing eases inter-cultivation. Keep field weed-free in first 40 days.",
    "pests": [
      {
        "name": "Pink stem borer",
        "symptom": "Dead hearts, white ears, tunnelled stems",
        "control": "Apply Carbofuran 4G or Cartap in whorl; remove stubble; spray Chlorantraniliprole"
      },
      {
        "name": "Ragi aphid/leaf aphid",
        "symptom": "Curling, yellowing leaves, honeydew",
        "control": "Spray Dimethoate or Imidacloprid; conserve ladybird beetles"
      },
      {
        "name": "Cutworm",
        "symptom": "Seedlings cut at base near soil, especially nursery",
        "control": "Poison bait with Carbaryl + bran; flood nursery; hand-collect at night"
      },
      {
        "name": "Earhead caterpillar/armyworm",
        "symptom": "Feeding on developing grains/earheads",
        "control": "Spray Quinalphos or Emamectin benzoate at earhead emergence"
      }
    ],
    "diseases": [
      {
        "name": "Blast (leaf, neck & finger blast)",
        "symptom": "Spindle spots on leaves; black neck rot bending earhead; shrivelled fingers",
        "control": "Spray Tricyclazole or Carbendazim at boot and flowering; resistant varieties (GPU-28, GPU-67); avoid excess N"
      },
      {
        "name": "Brown spot/leaf spot",
        "symptom": "Brown oval spots on leaves reducing photosynthesis",
        "control": "Spray Mancozeb; balanced nutrition; clean seed"
      },
      {
        "name": "Foot rot/seedling rot",
        "symptom": "Damping-off and rotting in nursery/young plants",
        "control": "Seed treat Trichoderma/Carbendazim; good nursery drainage; avoid overcrowding"
      },
      {
        "name": "Cercospora/grey leaf spot",
        "symptom": "Grey-brown lesions on leaves in humid weather",
        "control": "Spray Mancozeb or Propiconazole; field sanitation; rotation"
      }
    ],
    "harvest": "Harvest when earheads turn brown and grains hard (moisture ~18–20%); fingers dry and turn dark. Cut earheads first (they mature unevenly), dry, then thresh; cut straw later. Yield 12–16 quintal/acre transplanted.",
    "yield": "12–16 quintal/acre (transplanted irrigated); 6–10 quintal/acre rainfed",
    "postHarvest": "Dry grain to 12% moisture; ragi stores exceptionally well (4–5 years) in dry bins without much pest damage — a key famine-reserve grain. Mill into flour fresh; malt by sprouting for high-value malted/baby foods.",
    "marketTips": "Ragi MSP ₹4290/qtl (2024-25) — highest among millets. Strong demand from health-food and ICDS/mid-day-meal programs; Karnataka procures actively. Value-add via ragi flour, malt, ragi cookies, baby food and instant mixes for big premium. Sell via FPO/eNAM and millet outlets.",
    "dosDonts": [
      "Do transplant healthy 3–4 week seedlings for highest yields",
      "Do keep field weed-free for the first 40 days — ragi is a poor early competitor",
      "Don't ignore neck blast; spray fungicide at boot/flowering in humid weather",
      "Don't let water stagnate; ensure good drainage on flats and hill terraces",
      "Do exploit ragi's excellent storability and rising health-food premium for value addition"
    ]
  },
  "cotton": {
    "key": "cotton",
    "title": "Cotton",
    "emoji": "🌸",
    "about": "Cotton (Gossypium spp.) is India's most important fibre crop and a major cash crop, grown on ~120 lakh hectares. Key states are Gujarat, Maharashtra, Telangana, Andhra Pradesh, Karnataka, Punjab and Haryana. Over 95% area is under Bt hybrids; it supports the textile industry and millions of smallholder livelihoods.",
    "uses": "Lint for textile/yarn, cottonseed oil (edible), seed cake/khal for cattle feed, and linters for surgical cotton and paper.",
    "soil": "Deep, well-drained black cotton soils (vertisols) and medium-deep alluvial soils; pH 6.0–8.0. Avoid waterlogged/saline-alkaline land.",
    "climate": "Warm 21–30°C, frost-free; needs 600–800 mm well-distributed rainfall; clear bright weather at boll bursting. Excess humidity/rain at boll opening reduces quality.",
    "season": "Kharif — sowing May–June (irrigated) to June–July (rainfed) with monsoon onset; crop matures Nov–Jan.",
    "duration": "150–180 days (Bt hybrids 160–200 days with multiple pickings)",
    "seedRate": "Bt hybrids ~450 g/acre (one 450 g packet/acre); desi/straight varieties 4–6 kg/acre; HDPS (high-density) up to 1.2–1.5 kg/acre.",
    "spacing": "Hybrids 90–120 cm x 45–60 cm; desi varieties 60 x 30 cm; HDPS 60 x 10 cm.",
    "sowingMethod": "Dibbling 2 seeds/hill on ridges or flat land after pre-monsoon rain; thin to one healthy plant. Bt seed comes pre-treated; for non-Bt treat seed with Imidacloprid 70 WS @ 5 g/kg + Carbendazim @ 2 g/kg against sucking pests and seedling rot.",
    "varieties": [
      "Rasi RCH-659 BG-II",
      "Ankur 3028 BG-II",
      "Nuziveedu Bunny BG-II",
      "Mahyco MRC-7361",
      "Suraj (desi/straight)",
      "NHH-44 (hybrid)",
      "Bikaneri Nerma"
    ],
    "nutrients": {
      "basal": "Per acre: DAP 50 kg + MOP 25 kg + ZnSO4 10 kg, plus 4 t FYM. Apply full P, K and Zn basally in furrows at sowing.",
      "topDress": [
        "1st split (30–35 DAS, square initiation): Urea 35 kg/acre",
        "2nd split (60–65 DAS, flowering): Urea 35 kg/acre",
        "3rd split (90 DAS, boll development): Urea 20 kg/acre; spray 2% DAP + 1% MOP at peak flowering for boll filling"
      ]
    },
    "irrigation": "Largely rainfed in black soils; under irrigation give 6–8 irrigations. Moisture-critical stages: flowering, boll formation and boll development. Avoid water stress at flowering (causes flower/square shedding) and avoid excess water early. Stop irrigation 2 weeks before final picking.",
    "weed": "Keep weed-free first 60 days. Pre-emergence Pendimethalin 30 EC @ 1.3 L/acre within 2 DAS; 2–3 hand weedings/intercultivation at 20, 40, 60 DAS. Post-emergence directed spray of Quizalofop-ethyl for grasses.",
    "pests": [
      {
        "name": "Pink bollworm",
        "symptom": "Rosette flowers, bored bolls with damaged lint and stained seeds (most serious in Bt cotton).",
        "control": "Install pheromone (Gossyplure) traps @ 5/acre for monitoring & mass trapping; spray Profenophos 50 EC @ 400 ml/acre or Thiodicarb; destroy crop residue and avoid extended/late crop."
      },
      {
        "name": "Sucking pests (jassids, aphids, whitefly, thrips)",
        "symptom": "Leaf curling, yellowing, cupping, sooty mould and stunting in early stage.",
        "control": "Seed treatment Imidacloprid; foliar Acetamiprid 20 SP @ 40 g/acre or Flonicamid 50 WG @ 60 g/acre; yellow sticky traps for whitefly."
      },
      {
        "name": "American bollworm (Helicoverpa)",
        "symptom": "Circular bore holes on bolls, larvae feeding inside.",
        "control": "Bt protection plus Emamectin benzoate 5 SG @ 80 g/acre or Chlorantraniliprole if breach; HaNPV @ 250 LE/acre."
      }
    ],
    "diseases": [
      {
        "name": "Bacterial blight (angular leaf spot)",
        "symptom": "Angular water-soaked spots, black-arm on stem, boll rot.",
        "control": "Treat seed with Streptocycline + Carbendazim; spray Copper oxychloride 50 WP @ 600 g/acre + Streptocycline 1 g/10 L; use resistant varieties."
      },
      {
        "name": "Fusarium/Verticillium wilt",
        "symptom": "Yellowing, vascular browning, sudden wilting and drying of plants.",
        "control": "Grow resistant hybrids; soil application of Trichoderma viride; crop rotation; drench Carbendazim @ 1 g/L at collar."
      },
      {
        "name": "Alternaria leaf spot / grey mildew",
        "symptom": "Brown concentric leaf spots; white powdery angular patches (grey mildew) on lower leaves.",
        "control": "Spray Mancozeb 75 WP @ 600 g/acre or Hexaconazole @ 200 ml/acre at first appearance."
      }
    ],
    "harvest": "Picking starts ~150 DAS when bolls fully burst and lint fluffs out. Maturity signs: bolls open, leaves shed, brown calyx. Do 3–4 hand pickings at 15–20 day intervals on dry sunny mornings. Yield: rainfed 6–10 quintal/acre, irrigated Bt 12–18 quintal/acre (seed cotton/kapas).",
    "yield": "Seed cotton (kapas): 8–18 quintal/acre",
    "postHarvest": "Dry kapas to 8–10% moisture; pick clean cotton free of trash, leaf and immature locks. Store in dry ventilated area away from moisture. Ginning gives ~34–36% lint. Keep different grades/varieties separate.",
    "marketTips": "Sold as kapas at APMC mandis and CCI procurement at MSP (medium staple ₹7,121/quintal, long staple ₹7,521/quintal for 2024-25). Grade by staple length, trash %, moisture and colour; sell at low moisture for higher price. Avoid distress sale — store and sell when prices peak post-Dec.",
    "dosDonts": [
      "Do install pheromone traps early and monitor pink bollworm weekly",
      "Do follow refuge (non-Bt) planting around Bt field as per packet",
      "Don't grow extended/ratoon cotton beyond Dec — it harbours pink bollworm",
      "Don't overdose nitrogen — causes excessive vegetative growth and boll shedding",
      "Do pick on dry mornings and keep kapas clean and trash-free"
    ]
  },
  "sugarcane": {
    "key": "sugarcane",
    "title": "Sugarcane",
    "emoji": "🎋",
    "about": "Sugarcane (Saccharum officinarum) is India's main sugar and ethanol crop, grown on ~50 lakh hectares mainly in UP, Maharashtra, Karnataka, Tamil Nadu and Bihar. India is the world's largest producer; it underpins the sugar, jaggery (gur) and ethanol industries.",
    "uses": "Sugar (sucrose), jaggery/gur and khandsari, ethanol/molasses for distilleries and fuel blending, bagasse for paper and co-generation, press mud as manure.",
    "soil": "Deep, well-drained loam to clay-loam rich in organic matter; pH 6.5–7.5. Tolerates wide soils but avoids waterlogged/highly saline land.",
    "climate": "Hot, humid tropical; 20–35°C, 750–1200 mm rainfall. Warm humid growth phase and cool dry ripening phase boost sugar recovery. Frost and prolonged drought reduce yield.",
    "season": "Three planting times: Autumn (Oct–Nov, best for UP/north), Spring (Feb–Mar, most common), and Adsali (July–Aug, 18-month crop in Maharashtra). Largely a 10–18 month crop; also ratooned.",
    "duration": "Spring crop 11–12 months; Adsali 16–18 months; ratoon ~10 months",
    "seedRate": "~3.0–3.5 t/acre of healthy 3-budded setts (about 12,000–16,000 setts/acre).",
    "spacing": "Row spacing 90–120 cm (paired-row/wide row 120–150 cm for trash mulching); place setts end-to-end in furrows.",
    "sowingMethod": "Plant 2–3 budded setts from 8–10 month old disease-free seed cane in furrows, end-to-end, covered 3–5 cm. Treat setts in Carbendazim 0.1% + Imidacloprid (or hot-water 52°C/30 min) against sett rot and borers. Use single-bud chip/seedling trays for seed economy.",
    "varieties": [
      "Co-0238 (Karan-4)",
      "Co-86032",
      "CoM-0265",
      "Co-0118",
      "CoLk-94184",
      "Co-99004",
      "CoC-671 (early)"
    ],
    "nutrients": {
      "basal": "Per acre: DAP 75 kg + MOP 40 kg + ZnSO4 10 kg + FeSO4 10 kg, plus 8–10 t FYM/press mud in furrow at planting. Apply full P, K, Zn basally.",
      "topDress": [
        "1st split (30–45 DAS, tillering): Urea 50 kg/acre + earthing-up",
        "2nd split (90 DAS, grand growth): Urea 50 kg/acre",
        "3rd split (120–135 DAS, before earthing-up): Urea 30 kg/acre then heavy earthing-up; total N ~120 kg/acre over splits"
      ]
    },
    "irrigation": "Needs 25–40 irrigations (drip strongly recommended, saves 40% water). Moisture-critical stages: germination, tillering and grand growth phase (most critical). Reduce water at ripening to raise sugar. Avoid waterlogging; provide drainage in monsoon.",
    "weed": "Keep clean first 100–120 days. Pre-emergence Atrazine 50 WP @ 800 g/acre within 3 DAP; 2–3 intercultivations and trash mulching between rows suppress weeds and conserve moisture.",
    "pests": [
      {
        "name": "Early shoot borer / internode borer",
        "symptom": "Dead-heart in young shoots; bored internodes with reddened tunnels in older cane.",
        "control": "Sett treatment + Chlorantraniliprole 18.5 SC @ 60 ml/acre or Cartap hydrochloride; trash mulching; release Trichogramma parasitoid cards; remove dead-hearts."
      },
      {
        "name": "Pyrilla (leaf hopper)",
        "symptom": "Yellowing, sooty mould, honeydew on leaves reducing sugar.",
        "control": "Conserve Epiricania parasitoid; spray Imidacloprid or Malathion in severe outbreaks; avoid excess N."
      },
      {
        "name": "Termites & white grub",
        "symptom": "Setts hollowed/non-germinating; roots eaten causing wilting and lodging.",
        "control": "Soil/sett application of Fipronil or Chlorpyriphos; apply well-decomposed FYM only; light traps for adult beetles."
      }
    ],
    "diseases": [
      {
        "name": "Red rot",
        "symptom": "Drying of crown, red internal pith with crosswise white patches and alcoholic smell.",
        "control": "Grow resistant varieties (Co-0238 susceptible in some zones); use disease-free seed; sett treatment Carbendazim; rogue and burn affected clumps."
      },
      {
        "name": "Smut",
        "symptom": "Black whip-like sorus from the growing point; thin grassy tillers.",
        "control": "Hot-water sett treatment; remove and destroy whips before they burst; resistant varieties; rotate."
      },
      {
        "name": "Wilt / grassy shoot (GSD)",
        "symptom": "Profuse thin chlorotic grassy tillers (GSD-phytoplasma); vascular reddening & wilting.",
        "control": "Use tissue-cultured/aphid-free seed; rogue infected clumps; manage aphid vectors; moist-hot-air treatment of seed."
      }
    ],
    "harvest": "Harvest at full maturity (10–12 months) when brix is high. Maturity signs: dull yellow cane, dried lower leaves, metallic ringing sound on tapping, hand-refractometer brix >18–20. Cut close to ground with sharp knife; crush within 24 hrs. Yield: 30–45 t/acre (plant), 25–35 t/acre (ratoon).",
    "yield": "300–450 quintal/acre (30–45 tonnes/acre)",
    "postHarvest": "Crush within 24 hours to avoid sucrose inversion and weight loss; keep cut cane shaded/moist. Detrash and remove tops. For jaggery, juice extracted and boiled fresh. Retain stubble for ratoon and immediately irrigate + fertilize ratoon.",
    "marketTips": "Sold to sugar mills at FRP (Fair & Remunerative Price, ₹340/quintal at 10.25% recovery for 2024-25; higher recovery gets premium). Gur/jaggery fetches better margins in local mandis. Maintain high recovery via timely harvest; value-add through organic jaggery/ethanol tie-ups.",
    "dosDonts": [
      "Do use disease-free, 8–10 month old seed cane and treat setts before planting",
      "Do adopt drip + trash mulching to save water and suppress weeds",
      "Don't delay crushing beyond 24 hrs after cutting — sugar loss",
      "Don't ratoon red-rot/wilt affected fields; rotate with legume/paddy",
      "Do earth-up properly to prevent lodging and support tillers"
    ]
  },
  "soybean": {
    "key": "soybean",
    "title": "Soybean",
    "emoji": "🫘",
    "about": "Soybean (Glycine max) is India's leading kharif oilseed-cum-pulse legume, grown on ~120 lakh hectares mainly in Madhya Pradesh, Maharashtra and Rajasthan. It fixes atmospheric nitrogen, enriching soil, and is a key source of edible oil and protein-rich meal.",
    "uses": "Edible oil, high-protein soy meal/cake for poultry & cattle feed, soy flour, tofu, soy milk and nadu/textured protein; green manure value.",
    "soil": "Well-drained black cotton (vertisol) and medium loam soils; pH 6.0–7.5. Avoid acidic, saline and waterlogged soils; needs good drainage.",
    "climate": "Warm humid 25–32°C; 600–850 mm well-distributed rainfall. Sensitive to waterlogging and to drought at flowering/pod-fill.",
    "season": "Kharif — sow with onset of monsoon, late June to mid-July (sow after 75–100 mm rain). Avoid sowing after mid-July.",
    "duration": "90–110 days",
    "seedRate": "28–32 kg/acre (medium-bold seed); for bold-seeded varieties up to 35 kg/acre.",
    "spacing": "30–45 cm between rows x 5–10 cm between plants; aim ~4.5 lakh plants/acre.",
    "sowingMethod": "Seed-drill or behind plough on broad-bed-furrow (BBF) at 3–4 cm depth. Treat seed with Carbendazim+Thiram (2:1) @ 3 g/kg or Trichoderma, then Rhizobium japonicum + PSB culture @ 5 g/kg (inoculate last, sow within 24 hrs). Don't mix fungicide and culture together at high dose.",
    "varieties": [
      "JS-335",
      "JS-9560",
      "JS-2034",
      "JS-2069",
      "NRC-37 (Ahilya-4)",
      "MAUS-71",
      "MACS-1188",
      "Phule Sangam (KDS-726)"
    ],
    "nutrients": {
      "basal": "Per acre: DAP 50 kg (or SSP 100 kg + Urea 8 kg) + MOP 13 kg + ZnSO4 8 kg + Sulphur 8 kg, plus 2 t FYM. Apply full dose basally — being a legume, soybean needs only a starter N dose.",
      "topDress": [
        "Generally no nitrogen top-dressing needed due to biological N fixation by Rhizobium",
        "If yellowing/poor nodulation, give a light Urea 10 kg/acre at branching; spray 2% DAP + 0.5% ZnSO4 at flowering and pod-fill for higher yield"
      ]
    },
    "irrigation": "Mostly rainfed. If dry spell, irrigate at the two moisture-critical stages: flowering and pod-filling (seed development). One protective irrigation at each can raise yield 20–30%. Ensure drainage during heavy rain — soybean hates waterlogging.",
    "weed": "Critical period 20–45 DAS. Pre-emergence Pendimethalin 30 EC @ 1.3 L/acre within 3 DAS; post-emergence (15–20 DAS) Imazethapyr 10 SL @ 400 ml/acre or Quizalofop for grasses; 1–2 hand weedings.",
    "pests": [
      {
        "name": "Girdle beetle",
        "symptom": "Two ring-cuts (girdles) on stem/petiole; portion above wilts and dries.",
        "control": "Spray Thiamethoxam+Lambda-cyhalothrin or Triazophos 40 EC @ 320 ml/acre at 30–35 DAS; clip and destroy affected shoots; avoid late sowing."
      },
      {
        "name": "Defoliators (Spodoptera/tobacco caterpillar, Bihar hairy caterpillar, semilooper)",
        "symptom": "Skeletonised leaves, heavy defoliation in patches.",
        "control": "Spray Emamectin benzoate 5 SG @ 80 g/acre or Chlorantraniliprole 18.5 SC @ 60 ml/acre; pheromone traps; collect & destroy egg masses."
      },
      {
        "name": "Stem fly",
        "symptom": "Tunnelling in stem/petiole, wilting of seedlings, reduced vigour.",
        "control": "Seed treatment Thiamethoxam 30 FS @ 10 ml/kg; foliar Triazophos at early stage."
      }
    ],
    "diseases": [
      {
        "name": "Yellow Mosaic Virus (YMV)",
        "symptom": "Bright yellow mottling/mosaic of leaves, stunting, poor pods (whitefly-transmitted).",
        "control": "Grow resistant varieties (JS-2034, NRC-37); control whitefly vector with Thiamethoxam 25 WG @ 40 g/acre; rogue infected plants."
      },
      {
        "name": "Rhizoctonia aerial blight / collar rot",
        "symptom": "Brown water-soaked lesions on leaves/stem, seedling collar rot in humid weather.",
        "control": "Seed treatment Carbendazim+Thiram; spray Hexaconazole or Propiconazole @ 200 ml/acre; ensure drainage."
      },
      {
        "name": "Charcoal rot / Anthracnose & pod blight",
        "symptom": "Greyish stem with microsclerotia, pre-mature drying; dark pod lesions and seed staining.",
        "control": "Seed treatment Trichoderma; spray Mancozeb/Carbendazim at pod stage; avoid moisture stress and crop rotation."
      }
    ],
    "harvest": "Harvest when 90–95% pods turn brown and leaves shed; seed moisture ~15%. Maturity signs: yellow-brown dry pods, rattling seeds. Cut/uproot and dry, then thresh gently to avoid seed cracking. Yield: 6–10 quintal/acre (good crop 10–12).",
    "yield": "6–12 quintal/acre",
    "postHarvest": "Dry seed to 10–12% moisture before threshing; thresh at low drum speed to prevent splitting (affects germination & oil). Store clean dry seed in moisture-proof bags. Grade for bold, undamaged seed.",
    "marketTips": "Sold at APMC mandis and NAFED procurement at MSP ₹4,892/quintal (2024-25). Grade by moisture, foreign matter and damaged/green grain. Value-add via soy oil/meal, soy flour; sell certified seed at premium. Avoid moisture-related discounts by drying well.",
    "dosDonts": [
      "Do inoculate seed with Rhizobium + PSB for free nitrogen and better yield",
      "Do sow on broad-bed-furrow (BBF) for drainage and moisture conservation",
      "Don't sow after mid-July or in waterlogged fields",
      "Don't apply heavy nitrogen — it suppresses nodulation",
      "Do harvest at right maturity and thresh gently to protect seed quality"
    ]
  },
  "groundnut": {
    "key": "groundnut",
    "title": "Groundnut",
    "emoji": "🥜",
    "about": "Groundnut/peanut (Arachis hypogaea) is a major oilseed and legume grown on ~50 lakh hectares, chiefly in Gujarat, Rajasthan, Andhra Pradesh, Tamil Nadu and Karnataka. As a nitrogen-fixing legume it improves soil fertility and is a key edible-oil and protein source.",
    "uses": "Groundnut oil (edible/cooking), roasted/table nuts, confectionery, groundnut cake for cattle/poultry feed, and haulms as fodder.",
    "soil": "Light, well-drained sandy-loam to loam with good calcium; pH 6.0–7.5. Loose soil is essential for easy pegging and pod development; avoid heavy clay and waterlogging.",
    "climate": "Warm 25–35°C; 500–750 mm well-distributed rainfall. Needs dry sunny weather at maturity. Sensitive to frost and to moisture stress at flowering/pegging.",
    "season": "Mainly Kharif (June–July with monsoon); also Rabi/summer (Nov–Jan) under irrigation in south India and Zaid in some regions.",
    "duration": "100–130 days (bunch types 100–110, spreading 120–135)",
    "seedRate": "Bunch types 40–45 kg/acre (kernels); spreading types 30–35 kg/acre. Use bold, undamaged kernels.",
    "spacing": "Bunch types 30 x 10 cm; spreading/semi-spreading 45 x 15 cm.",
    "sowingMethod": "Sow shelled kernels 4–5 cm deep with seed-drill/dibbling on ridges or flat. Treat seed with Tebuconazole/Carbendazim+Thiram @ 3 g/kg + Imidacloprid, then Rhizobium + PSB culture before sowing. Handle kernels gently to avoid splitting.",
    "varieties": [
      "TG-37A",
      "GG-20",
      "Kadiri-6 (K-6)",
      "TMV-2",
      "JL-24",
      "GJG-31",
      "Dharani (ICGV)",
      "TAG-24"
    ],
    "nutrients": {
      "basal": "Per acre: SSP 100 kg (supplies P + sulphur + calcium) + MOP 15 kg + Gypsum 80–100 kg (apply half basal) + ZnSO4 8 kg + Urea 8 kg, plus 2 t FYM. Boron @ 2 kg/acre if deficient.",
      "topDress": [
        "At pegging/early-flowering (30–35 DAS): apply remaining Gypsum 80 kg/acre near root zone for pod/kernel filling (calcium critical)",
        "Foliar spray 2% DAP and 0.5% ZnSO4 + chelated boron at flowering & pegging; little/no urea — legume fixes N"
      ]
    },
    "irrigation": "Rainfed in kharif; irrigate in rabi/summer (8–10 irrigations). Moisture-critical stages: flowering, pegging and pod-development. Avoid stress at pegging (pegs must enter moist soil) and excess water near maturity. Stop irrigation 10 days before harvest.",
    "weed": "Critical period 20–45 DAS; keep weed-free during pegging. Pre-emergence Pendimethalin 30 EC @ 1.3 L/acre; post-emergence Imazethapyr 10 SL @ 400 ml/acre at 15–20 DAS; 1–2 light hand weedings (avoid disturbing pegs after flowering).",
    "pests": [
      {
        "name": "Leaf miner",
        "symptom": "Brown blister mines, leaves roll, dry and curl giving 'burnt' look.",
        "control": "Spray Chlorantraniliprole 18.5 SC @ 60 ml/acre or Emamectin benzoate 5 SG @ 80 g/acre; pheromone traps; avoid moisture stress."
      },
      {
        "name": "White grub",
        "symptom": "Plants wilt and die in patches; roots and developing pods eaten in soil.",
        "control": "Seed treatment Imidacloprid/Chlorpyriphos; light traps for adult beetles at first rains; soil application of Chlorpyriphos 20 EC; apply only decomposed FYM."
      },
      {
        "name": "Thrips & jassids (sucking pests)",
        "symptom": "Silvery/yellow streaks, leaf curling, stunting; vector of bud necrosis virus.",
        "control": "Seed treatment Imidacloprid; foliar Acetamiprid 20 SP @ 40 g/acre or Fipronil at early stage."
      }
    ],
    "diseases": [
      {
        "name": "Tikka leaf spot (early & late)",
        "symptom": "Brown circular spots with yellow halo (early) and dark spots without halo (late) on leaves; heavy defoliation.",
        "control": "Spray Chlorothalonil/Mancozeb 75 WP @ 600 g/acre or Tebuconazole/Hexaconazole @ 200 ml/acre at 30 & 45 DAS; resistant varieties; crop rotation."
      },
      {
        "name": "Rust",
        "symptom": "Reddish-brown pustules on lower leaf surface, premature drying.",
        "control": "Spray Hexaconazole 5 EC @ 400 ml/acre or Mancozeb; grow tolerant varieties; combine with tikka management."
      },
      {
        "name": "Stem rot / collar rot (Sclerotium/Aspergillus)",
        "symptom": "White fungal mat near collar, wilting, sclerotia; seedling rot at germination.",
        "control": "Seed treatment Trichoderma viride/Carbendazim; soil application of Trichoderma + FYM; avoid deep sowing and waterlogging."
      }
    ],
    "harvest": "Harvest when leaves yellow and inner pod shell shows dark veins/blackish inner walls and kernels develop colour. Maturity signs: 70–80% mature pods, dry foliage. Dig/pull plants, strip pods, sun-dry. Yield: 8–12 quintal/acre (pods) irrigated, 5–8 rainfed.",
    "yield": "6–14 quintal/acre (dry pods)",
    "postHarvest": "Dry pods to 8–9% moisture (kernels ~7%) to prevent Aspergillus/aflatoxin. Avoid heaping wet pods. Store dry, well-cured pods in ventilated bags. Strict drying is essential to meet aflatoxin export limits.",
    "marketTips": "Sold at APMC and NAFED at MSP ₹6,783/quintal (2024-25, in-shell). Grade by pod fill, moisture, and damaged/discoloured kernels; aflatoxin-free lots fetch premium and export demand. Value-add via oil, roasted/table nuts. Sell haulms as fodder for extra income.",
    "dosDonts": [
      "Do apply gypsum at pegging — calcium is critical for kernel filling",
      "Do dry pods thoroughly to avoid aflatoxin and price cuts",
      "Don't disturb soil/pegs with weeding after flowering",
      "Don't grow in heavy clay or waterlogged fields",
      "Do treat seed with fungicide + Rhizobium for healthy nodulating crop"
    ]
  },
  "mustard": {
    "key": "mustard",
    "title": "Mustard",
    "emoji": "🌼",
    "about": "Indian mustard/rapeseed (Brassica juncea) is the major rabi oilseed, grown on ~70–90 lakh hectares mainly in Rajasthan, Haryana, UP, MP and West Bengal. It is the second most important edible-oil crop after groundnut and thrives in cool dry winters.",
    "uses": "Mustard oil (cooking), rai/sarson seed as spice & pickle, mustard cake/khal for cattle feed and manure, and greens (sarson saag).",
    "soil": "Light to heavy loam and well-drained sandy-loam; pH 6.0–7.5, tolerates mild salinity/alkalinity. Avoid waterlogged soils.",
    "climate": "Cool dry season 10–25°C; 25–40 cm rainfall/irrigation. Needs clear cool weather for flowering & seed-fill; frost at flowering and warm humid weather harm yield.",
    "season": "Rabi — sow mid-Oct to mid-Nov (timely); late sowing to early Dec reduces yield. Harvest Feb–Mar.",
    "duration": "110–140 days",
    "seedRate": "1.5–2 kg/acre (fine seed); line sowing preferred.",
    "spacing": "30–45 cm between rows x 10–15 cm between plants (thin at 15–20 DAS).",
    "sowingMethod": "Line sow with seed-drill at 2–3 cm depth in fine moist seedbed; mix seed with sand for even spread. Treat seed with Thiram/Carbendazim @ 2.5 g/kg + Imidacloprid 70 WS @ 5 g/kg against damping-off and aphids/painted bug.",
    "varieties": [
      "Pusa Bold",
      "RH-30",
      "Varuna (T-59)",
      "Pusa Mustard-26 (NPJ-113)",
      "Giriraj",
      "NRCHB-101",
      "RGN-73",
      "Kranti"
    ],
    "nutrients": {
      "basal": "Per acre: DAP 40 kg + MOP 15 kg + Gypsum/Sulphur 100 kg gypsum (or 8 kg S) — mustard is highly sulphur-responsive — + ZnSO4 8 kg, plus 2 t FYM. Apply full P, K, S, Zn basally.",
      "topDress": [
        "1st split (basal): Urea 20 kg/acre",
        "2nd split (30–35 DAS, after first irrigation, rosette/branching): Urea 25 kg/acre; total N ~36 kg/acre. Foliar spray of 0.5% ZnSO4 + sulphur if deficiency seen at flowering"
      ]
    },
    "irrigation": "Needs 2 irrigations under assured conditions. Moisture-critical stages: pre-flowering/branching (30–35 DAS) and siliqua (pod) development/seed-fill (70–80 DAS). First irrigation is most critical; light irrigation avoids lodging. Avoid waterlogging.",
    "weed": "Critical first 30–40 days. Pre-emergence Pendimethalin 30 EC @ 1.3 L/acre within 2 DAS; one hand weeding/hoeing at 20–25 DAS along with thinning to maintain plant population.",
    "pests": [
      {
        "name": "Mustard aphid",
        "symptom": "Greenish colonies on shoots, flowers & pods; curling, stunting, honeydew & sooty mould — most damaging pest.",
        "control": "Spray Imidacloprid 17.8 SL @ 60 ml/acre or Dimethoate 30 EC @ 250 ml/acre at first appearance (ETL); install yellow sticky traps; conserve ladybird beetles."
      },
      {
        "name": "Painted bug",
        "symptom": "Bugs suck sap at seedling and maturity stage, causing seedling death and shrivelled seed.",
        "control": "Seed treatment Imidacloprid; spray Malathion 50 EC @ 400 ml/acre; timely sowing to escape; harvest promptly."
      },
      {
        "name": "Sawfly",
        "symptom": "Black larvae defoliate leaves from margins, leaving only midrib at seedling stage.",
        "control": "Spray Quinalphos 25 EC or Malathion; hand-collect larvae in small fields; avoid very early sowing."
      }
    ],
    "diseases": [
      {
        "name": "White rust",
        "symptom": "White raised pustules on leaf underside; swollen distorted 'stag-head' inflorescence.",
        "control": "Spray Metalaxyl+Mancozeb (Ridomil MZ) @ 400 g/acre or Mancozeb 75 WP @ 600 g/acre; resistant varieties; crop rotation."
      },
      {
        "name": "Alternaria blight",
        "symptom": "Dark concentric brown spots on leaves, stem and pods; shrivelled seed.",
        "control": "Seed treatment Iprodione+Carbendazim; spray Mancozeb @ 600 g/acre or Difenoconazole at flowering & podding; remove debris."
      },
      {
        "name": "Downy mildew / Sclerotinia stem rot",
        "symptom": "Greyish growth on leaf underside (downy mildew); water-soaked rotting stem with white cottony growth & black sclerotia (Sclerotinia).",
        "control": "Spray Metalaxyl-Mancozeb; for Sclerotinia spray Carbendazim @ 1 g/L at 50% flowering; avoid dense crop & excess irrigation; rotate."
      }
    ],
    "harvest": "Harvest when pods turn yellow-brown and lower leaves shed, seeds firm and brown (~75–80% pods mature, moisture ~20%). Cut early morning to reduce shattering, stack to dry, then thresh. Yield: 6–9 quintal/acre (irrigated 8–12).",
    "yield": "6–12 quintal/acre",
    "postHarvest": "Dry seed to 8% moisture before storage to prevent rancidity and pests. Thresh and clean; store in dry, airtight containers. Avoid delayed harvest (pod shattering loss). Oil content rises with proper maturity and sulphur nutrition.",
    "marketTips": "Sold at APMC and NAFED at MSP ₹5,950/quintal (2024-25). Grade by oil content, moisture and foreign matter; bold high-oil seed fetches premium. Value-add via cold-pressed kachi ghani oil and cake sale. Hold for better post-harvest prices if storage is dry.",
    "dosDonts": [
      "Do sow timely (mid-Oct–mid-Nov) to escape aphids and frost",
      "Do apply sulphur (gypsum) — it raises oil content significantly",
      "Don't delay first irrigation past branching stage",
      "Don't harvest over-mature crop in heat — pods shatter",
      "Do scout for aphids weekly and spray at ETL, protecting pollinators"
    ]
  },
  "sunflower": {
    "key": "sunflower",
    "title": "Sunflower",
    "emoji": "🌻",
    "about": "Sunflower (Helianthus annuus) is a short-duration, photo-insensitive oilseed grown across seasons mainly in Karnataka, Maharashtra, Andhra Pradesh, Telangana and Bihar. Its hybrids yield high-quality edible oil and it fits well in multiple cropping systems.",
    "uses": "Edible sunflower oil (high in linoleic acid, heart-healthy), confectionery/snack seeds, oilcake for feed, and ornamental/cut-flower use; good bee-forage honey crop.",
    "soil": "Well-drained loam to clay-loam with good fertility; pH 6.5–8.0. Tolerates a range of soils but not waterlogging or strong acidity.",
    "climate": "Warm 20–28°C, photo-insensitive (grown all seasons); 400–600 mm water. Cloudy weather and rain at flowering hampers pollination/seed-set. Sensitive to moisture stress at flowering & seed-fill.",
    "season": "Three seasons: Kharif (June–July), Rabi (Oct–Nov, main season in S. India), and Zaid/summer (Jan–Feb under irrigation).",
    "duration": "85–110 days",
    "seedRate": "2.5–3 kg/acre (hybrids); ensure good germination, gap-fill early.",
    "spacing": "45 x 30 cm or 60 x 30 cm; aim ~22,000–25,000 plants/acre.",
    "sowingMethod": "Dibble 2 seeds/hill 4–5 cm deep, thin to one at 10–12 DAS. Treat seed with Thiram/Carbendazim @ 3 g/kg + Imidacloprid against seedling rot and sucking pests. Soak seed 6–8 hrs and shade-dry for quick germination.",
    "varieties": [
      "KBSH-44",
      "KBSH-53",
      "DRSH-1",
      "Phule Raviraj",
      "LSFH-171",
      "Morden (OPV)",
      "Sungene-85",
      "PAC-1091"
    ],
    "nutrients": {
      "basal": "Per acre: DAP 50 kg + MOP 20 kg + ZnSO4 8 kg + Sulphur 8 kg (boron @ 2 kg if deficient), plus 2 t FYM. Apply full P, K, S, Zn and half N basally.",
      "topDress": [
        "1st split (basal): Urea 18 kg/acre",
        "2nd split (30–35 DAS, before button/star stage): Urea 18 kg/acre + earthing-up; foliar spray of 0.2% Boron (borax) at ray-floret/star-bud stage greatly improves seed-set and filling"
      ]
    },
    "irrigation": "Irrigate at 5–7 day intervals in summer. Moisture-critical stages: button/bud initiation, flowering and seed-filling (most sensitive). Avoid stress at flowering — causes poor seed-set and hollow seeds. Provide drainage to prevent waterlogging.",
    "weed": "Keep weed-free first 45 days. Pre-emergence Pendimethalin 30 EC @ 1.3 L/acre within 2 DAS; 1–2 hand weedings/intercultivation at 20 & 40 DAS along with earthing-up for support against lodging.",
    "pests": [
      {
        "name": "Head borer / Helicoverpa (capitulum borer)",
        "symptom": "Larvae bore into flower head and developing seeds, frass and damaged kernels.",
        "control": "Spray Emamectin benzoate 5 SG @ 80 g/acre or Chlorantraniliprole 18.5 SC @ 60 ml/acre at flowering; pheromone traps; HaNPV."
      },
      {
        "name": "Tobacco caterpillar (Spodoptera)",
        "symptom": "Defoliation, skeletonised leaves, scraping by young larvae in patches.",
        "control": "Spray Emamectin benzoate or Spinosad; pheromone traps; collect & destroy egg masses; bird perches."
      },
      {
        "name": "Leaf hopper / thrips / whitefly (sucking pests)",
        "symptom": "Leaf yellowing, curling, hopper-burn and vector of necrosis virus.",
        "control": "Seed treatment Imidacloprid; foliar Acetamiprid 20 SP @ 40 g/acre or Thiamethoxam at early stage."
      }
    ],
    "diseases": [
      {
        "name": "Alternaria leaf spot / blight",
        "symptom": "Dark brown concentric spots on leaves, stem and back of head; defoliation.",
        "control": "Seed treatment; spray Mancozeb 75 WP @ 600 g/acre or Hexaconazole @ 200 ml/acre at first appearance & repeat at 15 days; rotate crop."
      },
      {
        "name": "Downy mildew",
        "symptom": "Stunting, chlorotic mottling, white downy growth on leaf underside, distorted heads.",
        "control": "Seed treatment Metalaxyl (Apron) @ 6 g/kg; resistant hybrids; rogue infected plants; avoid waterlogging."
      },
      {
        "name": "Sunflower necrosis virus (SNV) / rust",
        "symptom": "Necrotic ringspots and crinkling, stunting (SNV, thrips-vectored); reddish pustules on leaves (rust).",
        "control": "Control thrips vector with systemic insecticide; rogue infected plants; for rust spray Hexaconazole/Mancozeb; use tolerant hybrids."
      }
    ],
    "harvest": "Harvest when back of head turns lemon-yellow to brown, lower leaves dry, bracts brown and seeds hard with black/striped colour. Cut heads, sun-dry, then thresh/rub out seeds. Yield: 6–9 quintal/acre (hybrids 8–10 irrigated).",
    "yield": "5–10 quintal/acre",
    "postHarvest": "Dry seed to 8–9% moisture to prevent mould and free-fatty-acid rise. Clean and grade; store in cool dry place. Avoid heaping moist heads (heating/spoilage). Confectionery-grade bold seed stored separately.",
    "marketTips": "Sold at APMC and NAFED at MSP ₹7,280/quintal (2024-25). Grade by oil content, moisture, and seed boldness; high-oil bold seed fetches premium. Confectionery-grade large seed sells higher than oil-grade. Value-add via oil extraction; sell oilcake as feed.",
    "dosDonts": [
      "Do spray boron at star-bud/flowering to ensure good seed-set",
      "Do encourage bee activity / hand-pollinate heads for better filling",
      "Don't grow sunflower repeatedly on same land — rotate to avoid downy mildew & wilt",
      "Don't let crop face moisture stress at flowering and seed-fill",
      "Do earth-up and support plants to prevent lodging of heavy heads"
    ]
  },
  "onion": {
    "key": "onion",
    "title": "Onion",
    "emoji": "🧅",
    "about": "Onion (Allium cepa) is India's most important bulb crop and a major foreign-exchange earner. Maharashtra (Nashik), Karnataka, Madhya Pradesh, Gujarat and Bihar are leading states; Nashik's Lasalgaon hosts Asia's largest onion mandi. India is the world's second-largest producer.",
    "uses": "Fresh kitchen vegetable, dehydrated flakes/powder, paste, pickles, and export. Also used in pharma/oleoresin and as a salad/garnish staple.",
    "soil": "Deep, friable, well-drained sandy-loam to medium-black loam rich in organic matter; ideal pH 6.0–7.5. Avoid waterlogged, saline or heavy clay soils which cause bolting and thick necks.",
    "climate": "Cool season crop; 13–24°C for vegetative growth, 20–30°C for bulb development. Annual rainfall 650–750 mm; long days/high temp at maturity aid bulbing. Frost and heavy rain at bulbing damage crop.",
    "season": "Kharif (Jun–Jul, harvest Oct–Dec), Late Kharif/Rangda (Aug–Sep, harvest Jan–Feb) and Rabi (Oct–Nov nursery, transplant Dec–Jan, harvest Apr–May). Rabi gives best storage bulbs.",
    "duration": "120–150 days from transplanting (about 35–45 days nursery + 90–110 days field).",
    "seedRate": "3–4 kg/acre for transplanted crop (nursery raised); 4–5 kg/acre if direct/drill sown. Hybrids 2.5–3 kg/acre.",
    "spacing": "10–15 cm between rows × 7.5–10 cm between plants on raised beds/flat beds; about 1.3–1.5 lakh plants per acre.",
    "sowingMethod": "Raise nursery on raised beds; transplant 6–8 week seedlings (pencil-thick) by dibbling. Seed treatment: Thiram or Carbendazim @ 2–3 g/kg seed; dip seedling roots in Carbendazim 0.1% + Imidacloprid before transplant to check damping-off and thrips.",
    "varieties": [
      "Agrifound Light Red",
      "Agrifound Dark Red",
      "N-2-4-1 (Nashik Red)",
      "Bhima Super",
      "Bhima Red",
      "Bhima Shakti",
      "Bhima Kiran",
      "Arka Niketan"
    ],
    "nutrients": {
      "basal": "FYM 8–10 t/acre + DAP 50 kg + MOP 40 kg + SSP 50 kg + ZnSO4 8 kg + Borax 4 kg per acre worked into beds before transplanting.",
      "topDress": [
        "Urea 35 kg/acre at 25–30 DAT (after first weeding)",
        "Urea 35 kg/acre at 45–50 DAT during bulb initiation",
        "Stop all N after 60 DAT to avoid thick necks; spray 19:19:19 + micronutrients at 60 DAT for bulb sizing"
      ]
    },
    "irrigation": "Light, frequent irrigation; drip is ideal. Critical stages: establishment (first 10–15 days), active growth, and bulb development/enlargement. Irrigate at 7–10 day intervals; stop irrigation 10–15 days before harvest to firm necks and improve storage.",
    "weed": "Keep weed-free for first 45–60 days. Pre-emergence Pendimethalin 30% EC @ 1.3 L/acre within 3 days of transplanting; 2 hand weedings at 25 and 45 DAT. Oxyfluorfen 23.5% EC @ 100 ml/acre is effective pre-emergence.",
    "pests": [
      {
        "name": "Onion thrips (Thrips tabaci)",
        "symptom": "Silvery streaks/white blotches on leaves, curling and drying of leaf tips; major yield reducer.",
        "control": "Spray Fipronil 5% SC @ 80 ml or Spinosad 45% SC @ 60 ml or Lambda-cyhalothrin per acre; rotate molecules, add sticker; use blue sticky traps."
      },
      {
        "name": "Onion maggot/fly",
        "symptom": "Larvae bore into bulb base causing rotting and wilting of young plants.",
        "control": "Soil application of Chlorpyriphos; remove infested plants; avoid raw FYM."
      },
      {
        "name": "Eriophyid mite",
        "symptom": "Curling, twisting and yellow streaking of leaves.",
        "control": "Spray Dicofol or Propargite; maintain field sanitation."
      }
    ],
    "diseases": [
      {
        "name": "Purple blotch (Alternaria porri)",
        "symptom": "Small water-soaked lesions turning purplish with concentric rings; leaves dry from tip.",
        "control": "Spray Mancozeb 75% WP @ 600 g/acre or Difenoconazole 25% EC @ 100 ml; add sticker; repeat at 10–12 day intervals."
      },
      {
        "name": "Stemphylium blight",
        "symptom": "Yellow-orange spots on leaf tips spreading downward, blighting.",
        "control": "Mancozeb + Tebuconazole sprays; avoid leaf wetness."
      },
      {
        "name": "Basal rot / Fusarium",
        "symptom": "Yellowing, wilting, rotting of basal plate and bulb.",
        "control": "Seed/seedling treatment with Trichoderma + Carbendazim; well-drained soil; crop rotation."
      }
    ],
    "harvest": "Maturity when 50–70% of tops fall over (neck-fall) and leaves yellow; bulbs firm with tight necks. Stop irrigation, lift bulbs, windrow-cure in field for 3–5 days then shade-cure 10–15 days. Yield: 100–150 quintal/acre (good crop 130–160 q/acre).",
    "yield": "100–150 quintal/acre; well-managed Rabi crop up to 160 quintal/acre.",
    "postHarvest": "Cure thoroughly, cut tops leaving 2–2.5 cm neck, grade by size. Store in well-ventilated bottom-and-side ventilated structures in single/double rows; ideal storage Rabi red onions last 4–6 months. Avoid moisture and direct sun to prevent rotting and sprouting.",
    "marketTips": "No central MSP; price fluctuates sharply — store Rabi bulbs and sell in lean months (Aug–Oct) for best rates. Grade A (≥50 mm), B, C bulbs separately; dark-red firm bulbs fetch premium and export demand. Lasalgaon/Nashik, Pimpalgaon mandis set benchmark prices; consider FPO aggregation and dehydration units for value addition.",
    "dosDonts": [
      "Do stop nitrogen and irrigation before harvest for firm, storable bulbs",
      "Do cure bulbs properly in shade before storage",
      "Don't apply fresh/raw FYM — invites maggots and basal rot",
      "Don't over-irrigate or let water stagnate — causes rot and bolting",
      "Don't transplant over-aged or too-young seedlings — increases bolting/doubles"
    ]
  },
  "potato": {
    "key": "potato",
    "title": "Potato",
    "emoji": "🥔",
    "about": "Potato (Solanum tuberosum) is India's most important vegetable crop and a key food-security tuber. Uttar Pradesh, West Bengal, Bihar, Punjab and Gujarat dominate production; the Indo-Gangetic plains are the main belt. India ranks second in world production after China.",
    "uses": "Fresh table vegetable, chips/wafers, French fries, dehydrated flakes, starch, and seed tubers. Processing varieties feed a large chips/fries industry.",
    "soil": "Well-drained, loose, friable sandy-loam to loam rich in organic matter; pH 5.5–6.5 ideal. Avoid alkaline, saline and waterlogged soils; loose soil aids tuber bulking.",
    "climate": "Cool-season crop; 18–24°C for tuberization, below 30°C overall. Tuber set fails above 30°C. Mainly grown as Rabi in plains and summer crop in hills. Frost damages haulm.",
    "season": "Rabi in plains: planting mid-Oct to mid-Nov (North), Sep–Nov elsewhere; harvest Jan–Mar. Hills: spring/summer (Feb–Apr). Short-day, cool nights favor good yields.",
    "duration": "90–120 days (early varieties 75–90 days; main-season 100–120 days).",
    "seedRate": "8–12 quintal/acre of seed tubers (whole or cut, 30–40 g each well-sprouted). Smaller spacing/seed size needs higher rate.",
    "spacing": "Rows 50–60 cm × plant 15–20 cm; ridge-and-furrow planting; about 22,000–25,000 plants/acre.",
    "sowingMethod": "Plant cold-stored, well-sprouted certified seed tubers on ridges, eyes upward, then earth up. Seed treatment: dip in Mancozeb + Imidacloprid or treat with 3% boric acid for 30 min against scab/black scurf; use whole seed of 30–40 g for best stand.",
    "varieties": [
      "Kufri Jyoti",
      "Kufri Bahar",
      "Kufri Pukhraj",
      "Kufri Chipsona-1/3 (processing)",
      "Kufri Sindhuri",
      "Kufri Chandramukhi",
      "Kufri Surya",
      "Kufri Mohan"
    ],
    "nutrients": {
      "basal": "FYM 8–10 t/acre + DAP 65 kg + MOP 40 kg + SSP 50 kg + ZnSO4 8 kg per acre at planting; full P, K and half N as basal in furrow.",
      "topDress": [
        "Urea 35 kg/acre at earthing-up (about 25–30 DAP at 15–20 cm height)",
        "Urea 25 kg/acre at second earthing/tuber initiation (40–45 DAP)",
        "Spray potassium nitrate / 13:0:45 at tuber bulking for size and dry matter"
      ]
    },
    "irrigation": "Light, frequent irrigation keeping ridges moist but not waterlogged. Critical stages: stolon formation, tuber initiation (most critical) and tuber bulking. First irrigation light just after planting; thereafter every 7–10 days; stop 10–12 days before harvest. Drip/sprinkler conserves water and reduces blight.",
    "weed": "Pre-emergence Metribuzin 70% WP @ 200 g/acre or Pendimethalin within 3 days of planting; earthing-up itself controls weeds. Keep field clean for first 30–40 days.",
    "pests": [
      {
        "name": "Potato tuber moth",
        "symptom": "Larvae mine leaves and bore into tubers in field and store, leaving frass-filled tunnels.",
        "control": "Deep earthing to cover tubers; spray Spinosad or Quinalphos; in store use neem/sand layering and pheromone traps."
      },
      {
        "name": "Aphids (Myzus persicae)",
        "symptom": "Suck sap, curl leaves and transmit leaf-roll/mosaic viruses — critical for seed crop.",
        "control": "Spray Imidacloprid 17.8% SL @ 60 ml or Thiamethoxam; rogue virus plants; dehaulm seed crop early."
      },
      {
        "name": "White grub / cutworm",
        "symptom": "Grubs feed on tubers and roots; cutworms cut young stems at night.",
        "control": "Soil application of Chlorpyriphos/Phorate at planting; flood irrigation; light traps for adults."
      }
    ],
    "diseases": [
      {
        "name": "Late blight (Phytophthora infestans)",
        "symptom": "Water-soaked dark-brown patches on leaves with white fungal growth on lower surface; rapid blighting in cool moist weather.",
        "control": "Protective spray Mancozeb 75% WP @ 600 g/acre before onset; on appearance use Cymoxanil+Mancozeb or Dimethomorph or Metalaxyl-M+Mancozeb at 7-day intervals."
      },
      {
        "name": "Early blight (Alternaria)",
        "symptom": "Concentric-ring brown spots on older leaves.",
        "control": "Spray Mancozeb or Chlorothalonil; balanced nutrition."
      },
      {
        "name": "Black scurf (Rhizoctonia)",
        "symptom": "Black hard sclerotia on tuber surface, poor sprouting, stem cankers.",
        "control": "Use treated certified seed; tuber dip in Pencycuron or Mancozeb; crop rotation."
      }
    ],
    "harvest": "Maturity when haulm yellows and dies; dehaulm (cut/remove tops) 10–15 days before digging to set skin. Harvest in dry weather, avoid bruising. Yield: 100–150 quintal/acre (good crop 140–160 q/acre).",
    "yield": "100–150 quintal/acre; high-input crop 150–180 quintal/acre.",
    "postHarvest": "Cure tubers in shade 10–15 days to harden skin; grade by size, remove cut/diseased/green tubers. Store table potatoes in cold store at 2–4°C (3–4°C with sprout suppressant) and processing potatoes at 10–12°C to limit reducing sugars. Avoid light exposure (greening/solanine).",
    "marketTips": "No MSP; prices volatile — use cold storage and stagger sales to lean season. Processing-grade (Chipsona) tubers fetch contract premiums from chip companies; grade and bag uniformly. Agra, Hooghly, Farrukhabad belts and FPO tie-ups with processors improve realization; export potential for fresh and seed.",
    "dosDonts": [
      "Do use certified disease-free seed and treat tubers before planting",
      "Do spray prophylactic Mancozeb ahead of late-blight weather",
      "Don't plant when soil/air temps exceed 30°C — tuberization fails",
      "Don't let tubers stay exposed to sun/light — causes greening",
      "Don't over-irrigate or leave standing water — triggers blight and rot"
    ]
  },
  "tomato": {
    "key": "tomato",
    "title": "Tomato",
    "emoji": "🍅",
    "about": "Tomato (Solanum lycopersicum) is among India's most widely grown vegetables, cultivated almost year-round across the country. Andhra Pradesh, Madhya Pradesh, Karnataka, Maharashtra and Odisha lead production. It is a high-value cash crop for smallholders.",
    "uses": "Fresh salad/cooking vegetable, puree/paste, ketchup, sauce, juice and canned/processed products. Determinate types suit processing; indeterminate types for fresh market.",
    "soil": "Well-drained sandy-loam to clay-loam rich in organic matter; pH 6.0–7.0. Avoid waterlogging; raised beds improve drainage and reduce wilt.",
    "climate": "Warm-season crop; 20–27°C optimum. Fruit set poor below 13°C or above 35°C. Sensitive to frost and heavy rain; humid weather favors blight. Grown in all three seasons in different regions.",
    "season": "Kharif (Jun–Jul), Rabi (Oct–Nov) and Spring-summer (Jan–Feb) nursery; transplanting 25–30 days later. Rabi crop generally gives best quality and yield in plains.",
    "duration": "120–150 days from transplanting; first harvest 60–70 days after transplant, picking continues 6–10 weeks.",
    "seedRate": "100–150 g/acre for open-pollinated; 60–100 g/acre for hybrids (nursery raised).",
    "spacing": "Rows 60–75 cm × plant 45–60 cm; staked/indeterminate hybrids 90 × 45 cm; about 8,000–10,000 plants/acre.",
    "sowingMethod": "Raise nursery on raised beds or pro-trays; transplant 25–30 day, 4–5 leaf seedlings on ridges. Seed treatment: Thiram/Carbendazim @ 2–3 g/kg or Trichoderma; dip seedling roots in Imidacloprid + Carbendazim against damping-off, leaf curl vector and wilt.",
    "varieties": [
      "Arka Rakshak (F1)",
      "Arka Samrat (F1)",
      "Arka Abha",
      "Pusa Ruby",
      "Pusa Rohini",
      "Namdhari NS-501",
      "Syngenta Saaho",
      "Abhinav (hybrid)"
    ],
    "nutrients": {
      "basal": "FYM 8–10 t/acre + DAP 50 kg + MOP 40 kg + SSP 50 kg + ZnSO4 8 kg + Borax 4 kg per acre incorporated before transplanting.",
      "topDress": [
        "Urea 30 kg/acre at 20–25 DAT",
        "Urea 30 kg/acre at flowering (40–45 DAT) + MOP 20 kg",
        "Spray 0.5% calcium nitrate + boron at fruit set to prevent blossom-end rot; 13:0:45 during fruit development"
      ]
    },
    "irrigation": "Drip ideal; keep soil evenly moist. Critical stages: transplant establishment, flowering, fruit set and fruit development. Irrigate every 5–7 days; uneven moisture causes fruit cracking and blossom-end rot. Avoid wetting foliage to reduce blight.",
    "weed": "Pre-emergence Pendimethalin 30% EC @ 1.3 L/acre after transplanting; 2 hand weedings/intercultivation at 25 and 45 DAT. Mulching (plastic/straw) suppresses weeds and conserves moisture.",
    "pests": [
      {
        "name": "Fruit borer (Helicoverpa armigera)",
        "symptom": "Larvae bore circular holes into fruits, causing rotting and unmarketable produce.",
        "control": "Pheromone traps @ 8/acre; spray Spinosad 45% SC @ 60 ml or Chlorantraniliprole 18.5% SC @ 60 ml or Emamectin benzoate; release Trichogramma."
      },
      {
        "name": "Whitefly (leaf-curl virus vector)",
        "symptom": "Yellowing, upward leaf curling, stunting from tomato leaf curl virus.",
        "control": "Spray Imidacloprid 17.8% SL @ 60 ml or Diafenthiuron; use yellow sticky traps and barrier/border crops; rogue infected plants early."
      },
      {
        "name": "Leaf miner / Tuta absoluta",
        "symptom": "Serpentine mines and blotches on leaves; Tuta larvae mine leaves and bore fruit.",
        "control": "Pheromone traps for Tuta; spray Cyantraniliprole or Spinetoram; remove affected leaves."
      }
    ],
    "diseases": [
      {
        "name": "Early blight (Alternaria solani)",
        "symptom": "Concentric brown target-spots on lower leaves, defoliation.",
        "control": "Spray Mancozeb 75% WP @ 600 g/acre or Difenoconazole; remove lower infected leaves; staking improves airflow."
      },
      {
        "name": "Late blight (Phytophthora)",
        "symptom": "Water-soaked dark lesions on leaves/stems with white growth in cool humid weather.",
        "control": "Cymoxanil+Mancozeb or Dimethomorph or Metalaxyl-M+Mancozeb sprays at 7-day intervals."
      },
      {
        "name": "Bacterial wilt / Fusarium wilt",
        "symptom": "Sudden wilting of green plants, vascular browning.",
        "control": "Use resistant hybrids (Arka Rakshak/Samrat), grafted seedlings, soil drench with bleaching powder/Trichoderma, crop rotation, raised beds."
      }
    ],
    "harvest": "Pick at mature-green to breaker stage for distant markets, table-ripe (red) for local/processing. Multiple pickings at 3–4 day intervals. Yield: 120–200 quintal/acre for hybrids (up to 250 q/acre under drip+staking).",
    "yield": "120–200 quintal/acre; high-yielding staked hybrids 200–250 quintal/acre.",
    "postHarvest": "Harvest in cool hours, grade by size/color, avoid bruising. Pre-cool and store/transport at 10–13°C; ripe fruit shelf-life is short. Excess produce can be processed into puree/paste/ketchup to avoid distress sale.",
    "marketTips": "No MSP; prices highly volatile — stagger plantings and pick at right stage for target market. Grade and pack in ventilated CFB crates; firm, uniform, blemish-free fruit fetches premium. Tie up with processors/retail chains via FPOs; value-addition (puree, sun-dried, paste) cushions glut-price crashes.",
    "dosDonts": [
      "Do stake/trellis hybrids and mulch to cut disease and improve fruit quality",
      "Do use leaf-curl-tolerant hybrids and control whitefly early",
      "Don't irrigate unevenly — causes cracking and blossom-end rot",
      "Don't pick over-ripe fruit for distant markets — leads to transit losses",
      "Don't grow tomato after tomato/potato/brinjal — rotate to break wilt and blight"
    ]
  },
  "chilli": {
    "key": "chilli",
    "title": "Chilli",
    "emoji": "🌶️",
    "about": "Chilli (Capsicum annuum) is India's most important spice and a major export crop; India is the world's largest producer and exporter. Andhra Pradesh (Guntur), Telangana, Karnataka, Madhya Pradesh and Maharashtra lead production. Guntur is the world's biggest dry-chilli market.",
    "uses": "Green chilli vegetable, dry red chilli spice, chilli powder, oleoresin, pickles and export. Color (ASTA) and pungency (capsaicin) determine value.",
    "soil": "Well-drained black cotton soil, sandy-loam or red loam rich in organic matter; pH 6.0–7.0. Good drainage essential — waterlogging causes wilt and damping-off.",
    "climate": "Warm humid for growth, dry weather for fruit ripening/drying; 20–30°C optimum. Excess rain/humidity favors anthracnose and viruses; frost-sensitive. Needs 600–1250 mm or assured irrigation.",
    "season": "Kharif (Jun–Jul nursery, transplant Jul–Aug; rainfed) and Rabi/irrigated (Sep–Oct nursery, transplant Oct–Nov). Summer crop in some areas under irrigation.",
    "duration": "150–180 days; green chilli picking from 60–70 DAT, dry red harvest 120–180 days; multiple pickings over 2–3 months.",
    "seedRate": "80–100 g/acre for hybrids; 200–400 g/acre for open-pollinated (nursery raised).",
    "spacing": "Rows 60–75 cm × plant 45–60 cm; about 12,000–15,000 plants/acre.",
    "sowingMethod": "Raise nursery on raised beds; transplant 35–40 day seedlings. Seed treatment: Thiram/Carbendazim @ 2–3 g/kg + Imidacloprid seed treatment or Trichoderma; root-dip seedlings in Imidacloprid + Carbendazim against thrips/mites, damping-off and viruses.",
    "varieties": [
      "Guntur Sannam (S4)",
      "Byadgi (Dabbi/Kaddi)",
      "Teja (hybrid)",
      "LCA-334",
      "Pusa Jwala",
      "Arka Lohit",
      "Arka Meghana (F1)",
      "US-341 (hybrid)"
    ],
    "nutrients": {
      "basal": "FYM 8–10 t/acre + DAP 50 kg + MOP 40 kg + SSP 50 kg + ZnSO4 10 kg + Borax 4 kg per acre before transplanting.",
      "topDress": [
        "Urea 30 kg/acre at 25–30 DAT",
        "Urea 30 kg/acre + MOP 20 kg at flowering (50–60 DAT)",
        "Urea 20 kg/acre at peak fruiting (75–80 DAT); foliar 13:0:45 + micronutrients during fruiting for color and size"
      ]
    },
    "irrigation": "Drip ideal; avoid water stress at flowering and fruiting (leaf curl and flower drop result). Critical stages: establishment, flowering, fruit set and fruit development. Irrigate every 7–10 days; reduce/stop water during ripening for red dry chilli to aid drying and color.",
    "weed": "Pre-emergence Pendimethalin 30% EC @ 1.3 L/acre after transplanting; 2–3 hand weedings/intercultivation at 25, 45 and 65 DAT. Mulching reduces weeds and thrips.",
    "pests": [
      {
        "name": "Thrips (Scirtothrips dorsalis)",
        "symptom": "Curling of leaves (upward), silvering, and the 'leaf curl/murda' complex; severe yield loss.",
        "control": "Spray Fipronil 5% SC @ 80 ml or Spinosad 45% SC @ 60 ml or Cyantraniliprole; blue sticky traps; rotate molecules."
      },
      {
        "name": "Yellow/broad mite",
        "symptom": "Downward curling and crinkling of leaves, brittle leaves, 'leaf curl' symptom.",
        "control": "Spray Spiromesifen 22.9% SC @ 60 ml or Propargite or Abamectin; treat early."
      },
      {
        "name": "Fruit borer (Helicoverpa/Spodoptera)",
        "symptom": "Larvae bore fruits causing rotting and color loss.",
        "control": "Pheromone traps @ 8/acre; spray Emamectin benzoate 5% SG @ 40 g or Chlorantraniliprole 18.5% SC @ 60 ml."
      }
    ],
    "diseases": [
      {
        "name": "Anthracnose / fruit rot & die-back (Colletotrichum)",
        "symptom": "Sunken circular dark spots on fruits with concentric rings; twig die-back from tip; major loss in red chilli.",
        "control": "Spray Mancozeb + Carbendazim (Saaf) @ 500 g/acre or Azoxystrobin+Difenoconazole; remove infected fruits; treat seed."
      },
      {
        "name": "Leaf curl complex (virus + thrips/mites)",
        "symptom": "Severe leaf curling, crinkling, stunting (murda disease).",
        "control": "Control thrips and mites rigorously (Fipronil/Spiromesifen), rogue infected plants, use tolerant hybrids, border crops."
      },
      {
        "name": "Damping-off / wilt",
        "symptom": "Seedling collapse in nursery; wilting and rotting of established plants.",
        "control": "Nursery drench with Copper oxychloride/Metalaxyl; Trichoderma; raised beds; avoid overwatering."
      }
    ],
    "harvest": "Green chilli: pick mature green fruits at 3–5 day intervals. Dry red: harvest fully red, firm, ripe fruits; allow to dry. Yield: green 60–100 quintal/acre; dry red 8–12 quintal/acre (hybrids higher).",
    "yield": "Green chilli 60–100 quintal/acre; dry red chilli 8–12 quintal/acre.",
    "postHarvest": "Sun-dry red chillies on clean tarpaulin/cement floor 10–15 days to 8–10% moisture; avoid contact with soil (aflatoxin/dust). Grade by color, length and brokenness; store in dry, ventilated godowns in gunny bags. Cold storage extends color retention for export lots.",
    "marketTips": "No MSP; Guntur (Andhra), Byadgi (Karnataka) and Khammam are benchmark markets. High ASTA color (Byadgi) and pungency (Teja) fetch export premium and oleoresin demand. Grade strictly, keep aflatoxin low for export, use cold storage to hold for better prices; FPO aggregation aids bulk buyers.",
    "dosDonts": [
      "Do control thrips and mites early to prevent the leaf-curl/murda complex",
      "Do dry red chilli on tarpaulin, never bare soil, to avoid aflatoxin",
      "Don't let water stress occur at flowering — causes heavy flower drop",
      "Don't apply excess nitrogen — promotes vegetative growth and pest buildup",
      "Don't store damp chillies — invites fungal/aflatoxin contamination and rejection"
    ]
  },
  "garlic": {
    "key": "garlic",
    "title": "Garlic",
    "emoji": "🧄",
    "about": "Garlic (Allium sativum) is a major bulb spice crop grown chiefly in Madhya Pradesh (largest producer), Rajasthan, Uttar Pradesh, Gujarat and Punjab. India is the world's second-largest producer. It is valued for culinary and medicinal use.",
    "uses": "Kitchen spice, paste, dehydrated flakes/powder, oil/oleoresin, and Ayurvedic/medicinal preparations. Export demand for quality bulbs.",
    "soil": "Well-drained fertile sandy-loam to clay-loam rich in organic matter; pH 6.0–7.0. Avoid heavy clay and waterlogged soils which deform bulbs and cause rot.",
    "climate": "Cool season crop; needs cool moist period during vegetative growth (12–24°C) and warm dry period at maturity. Long days/high temp aid bulbing; frost and excess heat at maturity reduce bulb size.",
    "season": "Rabi: planting Oct–Nov, harvest Mar–Apr (main season in plains). Hills plant in spring/summer. Short-day types suit South India.",
    "duration": "150–180 days to maturity.",
    "seedRate": "200–250 kg/acre of healthy cloves (about 1.5–2 quintal cloves per acre).",
    "spacing": "Rows 15 cm × clove 7.5–10 cm; plant cloves 4–5 cm deep, pointed end up; about 4–5 lakh cloves per acre.",
    "sowingMethod": "Plant healthy, bold, disease-free cloves (8–10 mm) by dibbling on flat or raised beds. Clove treatment: dip in Carbendazim 0.2% + Imidacloprid or Mancozeb 30 min before planting to control rot and thrips; do not plant the central small clove.",
    "varieties": [
      "G-282 (Yamuna Safed-3)",
      "Yamuna Safed (G-1)",
      "Yamuna Safed-2 (G-50)",
      "Agrifound Parvati (G-313)",
      "Agrifound White (G-41)",
      "Bhima Omkar",
      "Bhima Purple",
      "GG-4"
    ],
    "nutrients": {
      "basal": "FYM 8–10 t/acre + DAP 50 kg + MOP 40 kg + SSP 50 kg + ZnSO4 8 kg + Borax 4 kg per acre before planting.",
      "topDress": [
        "Urea 30 kg/acre at 30 DAS (after first weeding)",
        "Urea 30 kg/acre at 45–50 DAS during bulb initiation",
        "Stop N after 60 DAS; spray Sulphur/13:0:45 + boron at bulbing for size and pungency"
      ]
    },
    "irrigation": "Light frequent irrigation; drip suited. Critical stages: germination/establishment, vegetative growth and bulb development. Irrigate at 7–10 day intervals; stop irrigation 10–15 days before harvest to firm bulbs and improve storage.",
    "weed": "Keep weed-free first 60 days. Pre-emergence Pendimethalin 30% EC @ 1.3 L/acre within 3 days of planting; Oxyfluorfen alternative; 2 hand weedings at 30 and 50 DAS.",
    "pests": [
      {
        "name": "Thrips (Thrips tabaci)",
        "symptom": "Silvery streaks and curling of leaves, reduced bulb size.",
        "control": "Spray Fipronil 5% SC @ 80 ml or Spinosad 45% SC @ 60 ml or Lambda-cyhalothrin; blue sticky traps."
      },
      {
        "name": "Eriophyid mite",
        "symptom": "Twisting, curling and yellow streaking of leaves; carried on cloves.",
        "control": "Treat cloves; spray Dicofol/Propargite; use clean planting material."
      },
      {
        "name": "Onion/garlic maggot",
        "symptom": "Larvae rot the basal plate causing wilting.",
        "control": "Avoid raw FYM; soil application of Chlorpyriphos; remove infested plants."
      }
    ],
    "diseases": [
      {
        "name": "Purple blotch (Alternaria porri)",
        "symptom": "Purplish concentric-ring lesions on leaves, tip die-back.",
        "control": "Spray Mancozeb 75% WP @ 600 g/acre or Difenoconazole with sticker at 10–12 day intervals."
      },
      {
        "name": "Stemphylium blight",
        "symptom": "Yellow-orange leaf-tip spots leading to blighting.",
        "control": "Mancozeb + Tebuconazole sprays; avoid prolonged leaf wetness."
      },
      {
        "name": "Basal rot / white rot (Fusarium/Sclerotium)",
        "symptom": "Yellowing, wilting and rotting of basal plate and bulb.",
        "control": "Treat cloves with Carbendazim + Trichoderma; well-drained soil; long crop rotation."
      }
    ],
    "harvest": "Maturity when tops yellow and bend over and bulbs are firm with well-formed cloves; stop irrigation, lift bulbs, cure in shade. Yield: 50–80 quintal/acre (good crop 70–90 q/acre).",
    "yield": "50–80 quintal/acre; well-managed crop up to 90 quintal/acre.",
    "postHarvest": "Cure bulbs in shade with tops 8–10 days, then cut tops leaving 2–3 cm neck, grade by size. Store in cool, dry, ventilated rooms; properly cured bulbs store 5–7 months. Avoid moisture to prevent sprouting and rot.",
    "marketTips": "No MSP; Madhya Pradesh (Neemuch, Mandsaur, Indore) mandis are major markets. Bold, white, tight bulbs fetch premium; grade by size (≥40 mm best). Hold cured stock for off-season higher prices; value-add via dehydration/paste; export-grade white bulbs command better rates through FPOs.",
    "dosDonts": [
      "Do plant bold, healthy, treated cloves — discard central small clove",
      "Do cure and dry bulbs in shade before storage",
      "Don't apply nitrogen or irrigate near maturity — softens bulbs",
      "Don't use raw FYM or waterlogged soil — invites maggots and basal rot",
      "Don't store damp or undersized bulbs — they sprout and rot quickly"
    ]
  },
  "ginger": {
    "key": "ginger",
    "title": "Ginger",
    "emoji": "🫚",
    "about": "Ginger (Zingiber officinale) is a high-value rhizome spice grown mainly in the North-East (Meghalaya, Mizoram, Assam, Arunachal), Karnataka, Kerala, Odisha and Himachal Pradesh. India is the world's largest producer. It is grown both as a sole crop and under partial shade.",
    "uses": "Fresh ginger, dry ginger (sonth), ginger powder, oil/oleoresin, candy/preserve, and medicinal/Ayurvedic use. Strong domestic and export demand.",
    "soil": "Well-drained, friable sandy-loam to clay-loam or red lateritic soil rich in organic matter; pH 5.5–6.5. Good drainage essential — waterlogging causes rhizome rot. Suited to shaded/sloping land.",
    "climate": "Warm humid tropical/subtropical; 25–30°C with 1500–3000 mm well-distributed rainfall or assured irrigation. Partial shade benefits; needs warm moist growing period and dry spell at maturity.",
    "season": "Plant Apr–May (with pre-monsoon showers/irrigation), harvest Dec–Feb (8–9 months later). In high-rainfall NE zones planted with onset of monsoon.",
    "duration": "210–270 days (about 8–9 months) to maturity for dry ginger; green ginger from 5–6 months.",
    "seedRate": "600–800 kg/acre of seed rhizomes (healthy 20–25 g bits with 1–2 buds each).",
    "spacing": "Rows 25–30 cm × plant 20–25 cm; plant seed bits 4–5 cm deep on raised beds; mulch heavily.",
    "sowingMethod": "Plant treated seed rhizome bits (20–25 g, 1–2 sound buds) on raised beds/ridges, then mulch with green leaves 2–3 t/acre. Rhizome treatment: dip in Mancozeb 0.3% + Quinalphos (or Carbendazim + Trichoderma) for 30 min, shade-dry before planting against soft rot and rhizome scale.",
    "varieties": [
      "Varada",
      "Mahima",
      "Rejatha",
      "Suprabha",
      "Suruchi",
      "Suravi",
      "Nadia",
      "IISR Varada"
    ],
    "nutrients": {
      "basal": "FYM/compost 10–12 t/acre + neem cake 800 kg + DAP 50 kg + MOP 40 kg + SSP 60 kg per acre at planting in furrows.",
      "topDress": [
        "Urea 30 kg/acre + MOP 20 kg at 45 DAP (with first earthing-up and mulching)",
        "Urea 30 kg/acre + MOP 20 kg at 90 DAP (second earthing-up)",
        "Foliar 19:19:19 + micronutrients during rhizome bulking"
      ]
    },
    "irrigation": "Mostly rainfed in NE/Western Ghats; under irrigation maintain even moisture, never waterlogged. Critical stages: germination/sprouting, rhizome initiation and rhizome development/bulking. Irrigate 5–10 day intervals in dry spells; ensure drainage in heavy rain to prevent rot.",
    "weed": "Mulching suppresses most weeds; 2–3 hand weedings with earthing-up at 45, 90 and 120 DAP. Pre-emergence Atrazine/Pendimethalin can be used at planting; re-mulch after each earthing-up.",
    "pests": [
      {
        "name": "Shoot borer (Conogethes punctiferalis)",
        "symptom": "Larvae bore into pseudostems causing central shoot to wither (dead-heart) and yellowing.",
        "control": "Spray Malathion or Quinalphos at monthly intervals during Jul–Oct; remove and destroy bored shoots."
      },
      {
        "name": "Rhizome scale",
        "symptom": "Scales encrust rhizomes in field and storage, shrivelling seed material.",
        "control": "Treat seed rhizomes with Quinalphos dip before storage/planting; discard heavily infested rhizomes."
      },
      {
        "name": "Root-knot nematode",
        "symptom": "Galls on roots, stunting, yellowing, poor rhizome development.",
        "control": "Soil application of neem cake; apply Carbofuran/bio-nematicide (Pochonia); use healthy seed and rotation."
      }
    ],
    "diseases": [
      {
        "name": "Soft rot / rhizome rot (Pythium)",
        "symptom": "Water-soaked yellowing from leaf tip downward, collar rot, soft watery rotting of rhizomes; most destructive disease.",
        "control": "Use treated seed, raised beds with drainage; soil drench Metalaxyl-M + Mancozeb or Copper oxychloride; remove and destroy affected clumps."
      },
      {
        "name": "Bacterial wilt (Ralstonia)",
        "symptom": "Sudden wilting, water-soaked collar, milky ooze from cut pseudostem.",
        "control": "Use disease-free seed from healthy fields, soil drench Streptocycline + Copper oxychloride, strict drainage and rotation; rogue infected clumps."
      },
      {
        "name": "Leaf spot (Phyllosticta)",
        "symptom": "Oval spots with white centre and dark margin on leaves, reducing photosynthesis.",
        "control": "Spray Mancozeb or Carbendazim; balanced nutrition; partial shade management."
      }
    ],
    "harvest": "Green ginger from 5–6 months; mature dry ginger at 8–9 months when leaves yellow and dry and pseudostems fall. Dig rhizomes carefully, wash. Yield: 60–100 quintal/acre fresh (dry ginger recovery about 20%).",
    "yield": "60–100 quintal/acre fresh rhizome; high-input crop up to 120 quintal/acre.",
    "postHarvest": "For dry ginger, soak/clean, peel/scrape, sun-dry 7–10 days to 8–10% moisture (yields ~20% dry). Store seed rhizomes in pits with sand/sawdust layers in shade. Grade by size and bleaching; clean, well-dried, fibre-free ginger fetches premium.",
    "marketTips": "No MSP; Cochin, Kerala and NE markets are major hubs. Dry ginger (sonth), oil and oleoresin add value and export demand. Grade fresh ginger by size/cleanliness; bold, plump, low-fibre rhizomes get premium. Organic/GI ginger (e.g. NE produce) commands higher rates; FPO aggregation and processing into powder/oil improve realization.",
    "dosDonts": [
      "Do plant on well-drained raised beds and mulch heavily after planting",
      "Do treat seed rhizomes against soft rot and scale before planting",
      "Don't allow waterlogging — soft rot can wipe out the crop",
      "Don't replant ginger on same land continuously — rotate to break rot/nematodes",
      "Don't use untreated or infected seed rhizomes — main source of disease spread"
    ]
  },
  "gram": {
    "key": "gram",
    "title": "Gram (Chickpea)",
    "emoji": "🫛",
    "about": "Gram (chana/chickpea) is India's most important rabi pulse, grown mainly in Madhya Pradesh, Rajasthan, Maharashtra, Karnataka, UP and Andhra Pradesh. It is a key protein source (dal, besan) and a soil-enriching legume that fixes atmospheric nitrogen. India is the world's largest producer and consumer.",
    "uses": "Dal (split chana), besan (flour) for snacks, whole roasted/boiled chana, green pods (chholia) as vegetable, fodder from haulm. Kabuli types for chole and export.",
    "soil": "Well-drained sandy-loam to medium black/clay loam, pH 6.0-8.0. Avoid waterlogged, saline or acidic soils. Deep soils with good moisture retention give best rabi crops.",
    "climate": "Cool, dry rabi crop. Optimal 20-25°C (day) and 10-15°C (night); tolerates 5-30°C. Needs 400-600 mm. Frost at flowering/podding is damaging; high humidity/rain favours blight and pod borer.",
    "season": "Rabi — sow mid-October to mid-November (after monsoon recedes); harvest February-March. Delayed sowing reduces yield and raises wilt/borer risk.",
    "duration": "95-120 days (desi); 120-150 days (kabuli)",
    "seedRate": "Desi 25-30 kg/acre (bold seed up to 35 kg); Kabuli 35-45 kg/acre due to larger seed size.",
    "spacing": "30 cm between rows x 10 cm plant-to-plant (desi); 45 x 10 cm for kabuli/bold types. Aim ~1.0-1.3 lakh plants/acre.",
    "sowingMethod": "Line sowing by seed drill or behind plough at 5-7 cm depth. Seed treatment: Carbendazim+Thiram (2 g/kg) or Trichoderma viride (4 g/kg) against wilt, then Rhizobium + PSB culture (each 5 g/kg) just before sowing. Sow into adequate residual moisture.",
    "varieties": [
      "JG-11 (desi, wilt-tolerant)",
      "JAKI-9218 (desi)",
      "Vijay (JG-315)",
      "JG-130",
      "Vishal",
      "Pusa-372",
      "RVG-202",
      "KAK-2 (kabuli)",
      "Vihar (kabuli)",
      "Phule G-12"
    ],
    "nutrients": {
      "basal": "Apply full dose as basal at sowing: DAP 35-40 kg/acre + MOP 13-15 kg/acre (or SSP 100 kg + Urea 18 kg for P+S). Add ZnSO4 8-10 kg/acre in deficient soils. Being a legume, gram needs little N once Rhizobium nodulates.",
      "topDress": [
        "No nitrogen top-dressing needed if well nodulated",
        "If nodulation poor/yellowing at 30-35 DAS, give a light dose of Urea 10 kg/acre",
        "Foliar 2% urea + 0.5% boron at flowering boosts pod set",
        "Foliar KNO3 (1%) at pod-fill improves grain weight"
      ]
    },
    "irrigation": "Largely rainfed on residual moisture. Where irrigated, the critical stages are pre-flowering (40-45 DAS) and pod-development/grain-filling (70-75 DAS). One light irrigation at each is ideal; avoid heavy/frequent watering which causes excess vegetative growth and wilt. Stop irrigation near maturity.",
    "weed": "Keep weed-free first 30-45 days. One hand-weeding/hoeing at 25-30 DAS plus a second at 45 DAS. Pre-emergence Pendimethalin 1.0-1.3 L/acre within 2-3 days of sowing, or post-emergence Imazethapyr 100 ml/acre at 20-25 DAS for grassy/broadleaf weeds.",
    "pests": [
      {
        "name": "Gram pod borer (Helicoverpa armigera)",
        "symptom": "Larvae bore into pods and eat developing grains; characteristic body-half-inside-pod feeding; major yield robber.",
        "control": "Install 4-5 pheromone traps/acre and bird perches; ETL 1-2 larvae/m. Spray HaNPV 100 LE/acre or Emamectin benzoate 5% SG 8 g/acre or Chlorantraniliprole 18.5% SC 6 ml/acre, or Spinosad 45% 6-7 ml/acre."
      },
      {
        "name": "Cutworm (Agrotis)",
        "symptom": "Cuts young seedlings at base at night; gaps in stand.",
        "control": "Flood/irrigate to expose larvae; Chlorpyriphos 20% EC drenching or poison bait (rice bran + jaggery + Chlorpyriphos)."
      },
      {
        "name": "Termites",
        "symptom": "Attack roots/stem in light soils, plants wilt and dry in patches.",
        "control": "Soil treatment with Chlorpyriphos 20% EC; treat seed with Imidacloprid before sowing."
      }
    ],
    "diseases": [
      {
        "name": "Fusarium wilt",
        "symptom": "Sudden drooping and drying of plants in patches; brown vascular discolouration on splitting the stem; commonest cause of stand loss.",
        "control": "Grow wilt-resistant varieties (JG-11, JAKI-9218); seed treat with Carbendazim+Thiram or Trichoderma viride; follow 3-4 year rotation; deep summer ploughing."
      },
      {
        "name": "Ascochyta blight / Botrytis grey mould",
        "symptom": "Brown lesions with concentric rings on stem, leaves and pods (Ascochyta); greyish fungal mat on flowers/pods in humid weather (Botrytis); both worsen with rain.",
        "control": "Use clean seed; spray Mancozeb 0.25% or Carbendazim 0.1% at first symptoms; avoid dense planting and over-irrigation."
      },
      {
        "name": "Dry root rot",
        "symptom": "Plants dry up at flowering/podding under moisture stress; shredded root bark with black sclerotia.",
        "control": "Seed treatment with Trichoderma; avoid moisture stress at podding; maintain organic matter."
      }
    ],
    "harvest": "Mature when plants turn yellow-brown, leaves shed and pods rattle (grain moisture ~15%). Harvest by pulling/sickle in early morning to reduce shattering, dry on threshing floor 4-5 days, then thresh. Yield: rainfed 5-7 quintal/acre; irrigated/improved 8-12 quintal/acre.",
    "yield": "6-12 quintal/acre (avg ~7-8 q/acre)",
    "postHarvest": "Dry grain to 9-10% moisture before storage. Clean and grade; store in dry godown with neem leaves or treat with deltamethrin dust against bruchid (dhora) weevil. Bruchid is the main storage pest—fumigate with aluminium phosphide in sealed storage if infested.",
    "marketTips": "Sell at APMC mandi or to NAFED/state agencies under MSP — Chana MSP for 2025-26 season is around ₹5,650/quintal. Bold, uniform, lustrous grain fetches premium; kabuli (40-42 count) earns export premium. Value-add: besan milling, dal making, chholia (green) sells fresh at high price. Register on eNAM for better price discovery.",
    "dosDonts": [
      "DO inoculate seed with Rhizobium + PSB for free nitrogen",
      "DO grow wilt-resistant variety and rotate 3-4 years to break wilt cycle",
      "DO install pheromone traps and scout for pod borer from flowering",
      "DON'T over-irrigate — it triggers excess growth and wilt",
      "DON'T sow late beyond mid-November — yield drops and borer/wilt rise"
    ]
  },
  "tur": {
    "key": "tur",
    "title": "Tur / Arhar (Pigeon Pea)",
    "emoji": "🫛",
    "about": "Tur (arhar/red gram/pigeon pea) is a major kharif pulse grown widely in Maharashtra, Karnataka, MP, UP, Gujarat and Telangana. A deep-rooted, drought-hardy legume, it improves soil fertility and is the main source of toor dal — a staple protein across India.",
    "uses": "Toor/arhar dal (dehusked split), whole grain, green peas as vegetable, dry stalks (tur kadi) for fuel and basketry, and leaves/pods as nutritious fodder.",
    "soil": "Well-drained medium to deep black or loamy soils, pH 6.5-7.5. Very sensitive to waterlogging — avoid heavy ill-drained or saline soils. Deep soils suit its long tap root.",
    "climate": "Warm, semi-arid kharif crop. Optimal 26-30°C; tolerates 18-35°C. Needs 600-1000 mm well-distributed rainfall. Cool weather and adequate moisture at flowering/podding boost yield; frost-sensitive.",
    "season": "Kharif — sow mid-June to mid-July with monsoon onset. Short-duration types mature Nov-Dec; long-duration medium/late types harvested Dec-Feb. Also grown as intercrop with cotton, soybean, jowar.",
    "duration": "Short 120-150 days; Medium 150-180 days; Long-duration 200-270 days",
    "seedRate": "Sole crop 6-8 kg/acre (early bushy types up to 10 kg). Intercrop/long-duration 3-5 kg/acre.",
    "spacing": "Early types 45-60 x 10-15 cm; medium/late types 60-90 x 20-30 cm. Wider spacing for spreading long-duration varieties.",
    "sowingMethod": "Line sowing by drill/plough at 4-5 cm depth on ridges or flat with drainage furrows. Seed treatment: Trichoderma viride 4 g/kg or Carbendazim+Thiram 2 g/kg against wilt, then Rhizobium + PSB 5 g/kg each before sowing. Commonly intercropped (2 cotton/soybean : 1 tur).",
    "varieties": [
      "BSMR-736 (wilt/sterility-mosaic resistant)",
      "BSMR-853",
      "ICPL-87 (Pragati, early)",
      "BDN-711",
      "BDN-716",
      "Asha (ICPL-87119)",
      "Maruti (ICP-8863)",
      "Vipula",
      "GT-101",
      "TJT-501"
    ],
    "nutrients": {
      "basal": "Apply full P, K and a starter N as basal: DAP 35 kg/acre + MOP 13 kg/acre (or SSP 100 kg + Urea 18 kg). Add ZnSO4 8 kg/acre and Sulphur via SSP/gypsum in deficient black soils. Being a legume it fixes most of its N.",
      "topDress": [
        "No major N top-dressing if nodulation is good",
        "If plants yellow at 30 DAS, apply Urea 10 kg/acre",
        "Spray 2% urea + 0.5% boron at flower initiation to reduce flower drop",
        "Foliar 1% KNO3 or 0.5% DAP spray at podding improves grain fill"
      ]
    },
    "irrigation": "Mostly rainfed. Critical moisture stages are flowering and pod-development. In long dry spells give one protective irrigation at flowering and one at podding. Ensure drainage during heavy monsoon — waterlogging even briefly causes severe wilting and yield loss.",
    "weed": "Critical period 20-45 DAS. Two hand-weedings/hoeings at 25 and 45 DAS. Pre-emergence Pendimethalin 1.0-1.3 L/acre within 2 days of sowing; in intercrops use intercultivation. Earthing-up at 40-45 DAS improves anchorage.",
    "pests": [
      {
        "name": "Pod borer complex (Helicoverpa armigera, Maruca, pod fly)",
        "symptom": "Helicoverpa bores pods eating grains; Maruca webs flowers and pods; pod fly maggots feed inside causing shrivelled grain — together the biggest yield loss in tur.",
        "control": "Pheromone traps 4-5/acre and bird perches; spray at flowering with Emamectin benzoate 5% SG 8 g/acre or Chlorantraniliprole 18.5% SC 6 ml/acre or Flubendiamide 39.35% 4 ml/acre; rotate with HaNPV 100 LE/acre and Indoxacarb 14.5% 8 ml/acre."
      },
      {
        "name": "Plume moth / blister beetle",
        "symptom": "Plume moth larvae bore pods; blister beetles eat flowers reducing pod set.",
        "control": "Spray Quinalphos 25% EC 400 ml/acre or Lambda-cyhalothrin at flowering; hand-collect blister beetles in early morning."
      },
      {
        "name": "Pod sucking bugs",
        "symptom": "Bugs suck developing grains causing shrivelled, discoloured seed.",
        "control": "Spray Lambda-cyhalothrin 5% EC or Profenophos 50% EC at podding stage."
      }
    ],
    "diseases": [
      {
        "name": "Fusarium wilt",
        "symptom": "Partial or full wilting of plants at any stage; brown/black band of vascular browning visible when stem is split lengthwise; appears in patches.",
        "control": "Grow resistant varieties (BSMR-736, Maruti, Asha); seed treat with Trichoderma/Carbendazim; 3-4 year rotation; mix-cropping with sorghum reduces incidence."
      },
      {
        "name": "Sterility Mosaic Disease (SMD)",
        "symptom": "Bushy, pale mosaic foliage with excessive vegetative growth and no/very few pods ('green plague'); spread by eriophyid mite.",
        "control": "Use SMD-resistant varieties (BSMR-736/853); rogue infected plants early; control mite vector with sulphur/dicofol; avoid ratooning infected fields."
      },
      {
        "name": "Phytophthora blight",
        "symptom": "Stem girdling lesions and collar rot in waterlogged low spots; plants collapse.",
        "control": "Provide good drainage and ridge planting; seed/soil treat with Metalaxyl+Mancozeb; avoid low-lying waterlogged patches."
      }
    ],
    "harvest": "Mature when ~75-80% pods turn brown and dry and grain hardens. Cut plants with sickle, sun-dry on threshing floor, then thresh by beating or thresher. Pick green pods earlier if selling as vegetable. Yield: rainfed 5-8 quintal/acre; improved/irrigated 8-12 quintal/acre.",
    "yield": "6-12 quintal/acre (avg ~6-8 q/acre)",
    "postHarvest": "Dry grain to 9-10% moisture. Clean, grade by size and colour. Store in dry conditions with protection against bruchid (pulse beetle) using neem/ deltamethrin dust; fumigate with aluminium phosphide if infested. Dal milling (toor dal) adds significant value.",
    "marketTips": "Sell at APMC or to NAFED/state procurement under MSP — Tur (Arhar) MSP for 2025-26 is around ₹8,000/quintal. Bold, lustrous, uniform red grain fetches premium. Value-add by dal milling and selling toor dal directly; green tur (vegetable) sells at high seasonal prices. Use eNAM for transparent pricing.",
    "dosDonts": [
      "DO ensure drainage and ridge-sowing — tur cannot tolerate waterlogging",
      "DO grow wilt + SMD-resistant varieties like BSMR-736",
      "DO scout flowers/pods and spray pod-borer complex at flowering",
      "DON'T grow tur after tur — rotate to avoid wilt build-up",
      "DON'T delay sowing past mid-July; early sowing escapes terminal borer pressure"
    ]
  },
  "moong": {
    "key": "moong",
    "title": "Moong (Green Gram)",
    "emoji": "🫛",
    "about": "Moong (green gram) is a short-duration, drought-tolerant pulse grown across India in kharif, summer (zaid) and rabi (south). Major states are Rajasthan, Maharashtra, Karnataka, MP, AP and Bihar. Its 60-70 day cycle makes it ideal for catch-cropping and improving soil nitrogen.",
    "uses": "Whole moong, moong dal (split), sprouts, besan, sweets (moong dal halwa), and green manure. Haulm is good fodder; widely used in dal and health foods.",
    "soil": "Well-drained sandy-loam to loam, pH 6.5-7.5. Avoid waterlogged, saline and very heavy clay soils. Tolerates light, marginal soils better than most pulses.",
    "climate": "Warm crop; optimal 25-35°C. Needs 350-500 mm. Summer/zaid crop tolerates heat well; sensitive to waterlogging and to rain at maturity (causes pod sprouting and discolouration). Frost-sensitive.",
    "season": "Kharif (Jun-Jul, harvest Sep), Zaid/summer (Mar-Apr after wheat/potato, harvest May-Jun), and Rabi in south India. Short duration allows it to fit between two main crops.",
    "duration": "60-75 days",
    "seedRate": "8-10 kg/acre (kharif); summer/zaid slightly higher 10-12 kg/acre for thicker stand.",
    "spacing": "30 x 10 cm (kharif); 22-25 x 10 cm closer spacing in summer crop. Target ~1.6-2.0 lakh plants/acre.",
    "sowingMethod": "Line sowing by drill/plough at 4-5 cm depth. Seed treatment: Carbendazim+Thiram 2 g/kg or Trichoderma 4 g/kg, then Rhizobium + PSB 5 g/kg before sowing. Summer crop needs pre-sowing irrigation (palewa) for good germination.",
    "varieties": [
      "IPM-02-3",
      "IPM-02-14",
      "Pusa Vishal",
      "Pusa-9531",
      "SML-668",
      "MH-421",
      "Samrat (PDM-139)",
      "Pant Moong-5",
      "TM-96-2",
      "Pusa Baisakhi"
    ],
    "nutrients": {
      "basal": "Apply all as basal at sowing: DAP 35 kg/acre + MOP 8-10 kg/acre (or SSP 75 kg + Urea 18 kg). Add ZnSO4 8 kg/acre in deficient soils. Low N requirement as it is a self-fixing legume.",
      "topDress": [
        "No N top-dressing normally needed",
        "If yellowing at 25-30 DAS, apply Urea 8-10 kg/acre",
        "Foliar 2% urea at flowering improves pod set in summer crop",
        "Spray 1% KNO3 or 0.5% DAP at pod-fill to boost yield"
      ]
    },
    "irrigation": "Kharif crop is largely rainfed. Summer/zaid crop needs 3-5 irrigations at 10-12 day intervals. Critical moisture stages are flowering (30-35 DAS) and pod-filling (45-50 DAS). Stop irrigation 10 days before harvest; avoid waterlogging and rain at maturity.",
    "weed": "Critical first 30 days. One hand-weeding at 20-25 DAS, second if needed at 40 DAS. Pre-emergence Pendimethalin 1.0 L/acre within 2 days of sowing; post-emergence Imazethapyr 100 ml/acre at 15-20 DAS controls mixed weeds.",
    "pests": [
      {
        "name": "Whitefly (vector of Yellow Mosaic Virus)",
        "symptom": "Tiny white flies on leaf undersides; sooty mould; and crucially they transmit Yellow Mosaic — the No.1 threat to moong.",
        "control": "Use YMV-resistant varieties; install yellow sticky traps; spray Imidacloprid 17.8% SL 40 ml/acre or Thiamethoxam 25% WG 20 g/acre early; rogue infected plants."
      },
      {
        "name": "Thrips & jassids",
        "symptom": "Leaf curling, silvering, cupping and stunting; reduced vigour.",
        "control": "Spray Imidacloprid or Acetamiprid 20% SP 20 g/acre; maintain field hygiene."
      },
      {
        "name": "Pod borer / spotted pod borer (Maruca)",
        "symptom": "Larvae web and bore flowers and pods, feeding on grains.",
        "control": "Pheromone traps; spray Emamectin benzoate 5% SG 8 g/acre or Chlorantraniliprole 18.5% SC 6 ml/acre at flowering/podding."
      }
    ],
    "diseases": [
      {
        "name": "Yellow Mosaic Virus (YMV)",
        "symptom": "Bright yellow mottling/mosaic on leaves spreading to whole plant; stunting and few deformed pods — most damaging disease, spread by whitefly.",
        "control": "Grow resistant varieties (IPM-02-3, Samrat, SML-668); control whitefly vector with Imidacloprid/Thiamethoxam; rogue infected plants; avoid late sowing."
      },
      {
        "name": "Cercospora leaf spot",
        "symptom": "Brown circular spots with reddish margins on leaves; premature defoliation in humid weather.",
        "control": "Spray Mancozeb 0.25% or Carbendazim 0.1% at first symptoms; use clean seed."
      },
      {
        "name": "Powdery mildew",
        "symptom": "White powdery patches on leaves/pods, common in summer crop near maturity.",
        "control": "Spray wettable Sulphur 0.2% or Hexaconazole 5% EC 1 ml/L at first appearance."
      }
    ],
    "harvest": "Pods mature unevenly; harvest when 80% pods turn black/brown and dry. Do 2-3 hand pickings of mature pods, or single cutting when most pods mature. Sun-dry and thresh. Yield: rainfed 3-5 quintal/acre; summer/irrigated 5-7 quintal/acre.",
    "yield": "3-7 quintal/acre (avg ~4-5 q/acre)",
    "postHarvest": "Dry grain to 8-9% moisture. Clean and grade by size/colour (bright green, bold grain preferred). Protect against bruchid (pulse beetle) with neem/deltamethrin dust; fumigate sealed stock with aluminium phosphide if infested. Plough back haulm or feed as fodder.",
    "marketTips": "Sell at APMC or to NAFED under MSP — Moong MSP for 2025-26 is around ₹8,768/quintal (highest among pulses). Bright, bold, shiny green grain commands premium. Value-add as moong dal and sprouts. Timely picking before rains prevents discolouration that lowers grade.",
    "dosDonts": [
      "DO grow a YMV-resistant variety and control whitefly early",
      "DO use moong as a short catch crop to fix N before/after main crop",
      "DO pick pods promptly and dry well to keep grain bright green",
      "DON'T let rain hit mature pods — causes sprouting and grade loss",
      "DON'T over-fertilize with N — it delays maturity and reduces nodulation"
    ]
  },
  "turmeric": {
    "key": "turmeric",
    "title": "Turmeric",
    "emoji": "🟡",
    "about": "Turmeric (haldi) is a tropical rhizome spice and India's signature crop — India grows ~75-80% of world turmeric, led by Telangana, Maharashtra, Karnataka, Tamil Nadu, Andhra Pradesh and Odisha. Valued for curcumin content, it is used in food, medicine, cosmetics and rituals.",
    "uses": "Dried polished rhizome powder (spice/colour), curcumin extraction for pharma/nutraceuticals, cosmetics, dyeing, religious use; fresh rhizome for pickles and Ayurveda.",
    "soil": "Well-drained sandy-loam to clay-loam or red loam rich in organic matter, pH 5.5-7.5. Needs deep, friable soil; avoid waterlogging and heavy clods. Sensitive to stagnant water.",
    "climate": "Warm, humid tropical crop. Optimal 20-35°C; needs 1500-2250 mm rainfall or assured irrigation. Grows from sea level to ~1200 m. Long warm growing period with moderate shade tolerance suits it.",
    "season": "Plant April-June (with pre-monsoon showers/irrigation); harvest January-March after 8-9 months. A long-duration crop occupying the field nearly the whole year.",
    "duration": "210-270 days (7-9 months)",
    "seedRate": "800-1000 kg/acre of healthy seed rhizomes (mother + finger rhizomes, 25-35 g each, 2-3 viable buds).",
    "spacing": "Ridges/beds 30 x 25 cm or 45 x 15-20 cm; on raised beds plant in rows. About 25,000-30,000 plants/acre.",
    "sowingMethod": "Plant on ridges or raised beds in shallow pits/furrows, 4-5 cm deep, covered with soil and mulch (green leaves/straw 2 t/acre). Treat seed rhizomes with Carbendazim+Mancozeb (2.5 g/L) + Quinalphos dip 30 min and shade-dry before planting to prevent rot.",
    "varieties": [
      "Salem (Tamil Nadu local, high curcumin)",
      "Rajapuri",
      "Sangli",
      "Prabha (IISR)",
      "Prathibha (IISR)",
      "Pragati",
      "Roma",
      "Suguna",
      "Sudarshana",
      "Krishna (Duggirala)"
    ],
    "nutrients": {
      "basal": "Apply 8-10 t/acre FYM/compost + DAP 50 kg + MOP 33 kg/acre as basal at planting. Add ZnSO4 8 kg and Borax 4 kg/acre in deficient soils. Heavy organic manuring is key to rhizome bulking.",
      "topDress": [
        "Urea 30 kg/acre at 45 DAP (1st top-dress) with earthing-up",
        "Urea 30 kg/acre + MOP 17 kg/acre at 90 DAP (2nd top-dress) with 2nd earthing-up",
        "Apply remaining MOP 33 kg/acre at 120 DAP during rhizome bulking",
        "Foliar micronutrient (Zn+B) spray at 90-120 DAP improves rhizome size"
      ]
    },
    "irrigation": "Needs assured moisture. Under drip 4-5 day interval; surface irrigation every 7-10 days (15-25 irrigations total). Critical moisture stages are germination/establishment, tillering (60-90 DAP) and rhizome bulking (120-180 DAP). Stop irrigation ~3-4 weeks before harvest to aid curing. Maintain mulch to conserve moisture.",
    "weed": "Keep weed-free with mulch + 2-3 hand-weedings at 45, 90 and 120 DAP, combined with earthing-up. Mulching with green leaves/straw suppresses weeds and conserves moisture. Pre-emergence Pendimethalin can be used at planting in large fields.",
    "pests": [
      {
        "name": "Rhizome scale",
        "symptom": "Whitish-brown scales on rhizomes in field and storage; shrivelling and poor sprouting of seed rhizomes.",
        "control": "Dip seed rhizomes in Quinalphos 0.075% before storage/planting; discard heavily infested seed; treat storage."
      },
      {
        "name": "Shoot borer (Conogethes punctiferalis)",
        "symptom": "Larvae bore into pseudostem; central shoot yellows and dries ('dead heart'), bore-hole with frass visible.",
        "control": "Spray Malathion 50% EC or Quinalphos 25% EC 400 ml/acre at monthly intervals from July-October when fresh leaves emerge; remove and destroy affected shoots."
      },
      {
        "name": "Leaf-feeding beetles / leaf roller",
        "symptom": "Leaves rolled, skeletonised or holed reducing photosynthesis.",
        "control": "Spray Quinalphos or Malathion; hand-pick larvae in small plots."
      }
    ],
    "diseases": [
      {
        "name": "Rhizome rot (Pythium/Fusarium)",
        "symptom": "Pseudostem base softens and rots, leaves yellow and droop, rhizomes turn soft, watery and foul-smelling — most serious disease, worse in waterlogged soil.",
        "control": "Use disease-free seed and treat with Mancozeb+Carbendazim; ensure drainage and raised beds; drench Metalaxyl-Mancozeb 0.25% or Copper oxychloride 0.3% at first symptoms; soil application of Trichoderma with FYM."
      },
      {
        "name": "Leaf spot (Colletotrichum/Taphrina)",
        "symptom": "Brown/grey angular spots and blotches on leaves; severe in wet humid weather causing drying.",
        "control": "Spray Mancozeb 0.25% or Carbendazim 0.1% at 2-3 week intervals during rains; avoid overhead wetting."
      },
      {
        "name": "Bacterial wilt",
        "symptom": "Sudden wilting with rotting rhizome and ooze; patchy collapse.",
        "control": "Use clean seed, rotate crops, avoid waterlogging; drench with Copper oxychloride; rogue affected clumps."
      }
    ],
    "harvest": "Mature when leaves and pseudostems turn yellow and dry (8-9 months). Dig rhizomes carefully, separate from tops, wash and clean. Fresh yield: 80-120 quintal/acre (good crops 150+ q). After curing (boiling + drying) cured dry turmeric is ~18-25% of fresh weight.",
    "yield": "Fresh 80-150 quintal/acre; cured/dry 18-30 quintal/acre",
    "postHarvest": "Cure: boil cleaned rhizomes 45-60 min until soft and froth appears, then sun-dry 10-15 days to ~8-10% moisture; polish in drums to remove rough skin for bright colour. Grade by size, colour and curcumin %. Store cured polished rhizome in dry, ventilated rooms.",
    "marketTips": "No MSP; sold at spice mandis (Nizamabad, Sangli, Erode, Duggirala). Price driven by curcumin content, colour and polish — high-curcumin (Salem/Rajapuri) and bright bulbs fetch premium. Value-add by powdering, polishing, and curcumin extraction. Sell on eNAM/spice board channels; organic and GI-tagged (Sangli/Erode) command higher rates.",
    "dosDonts": [
      "DO use disease-free, treated seed rhizomes and raised beds to avoid rhizome rot",
      "DO mulch heavily and earth-up to boost rhizome bulking",
      "DO cure (boil+dry+polish) properly for bright colour and grade",
      "DON'T allow waterlogging — it triggers rhizome rot",
      "DON'T harvest before leaves dry or skip curing — lowers colour and curcumin recovery"
    ]
  },
  "cumin": {
    "key": "cumin",
    "title": "Cumin (Jeera)",
    "emoji": "🌿",
    "about": "Cumin (jeera) is a rabi seed-spice and India is the largest producer and exporter, grown almost entirely in Gujarat (Unjha is the global hub) and Rajasthan in arid/semi-arid zones. It is a low-water, high-value crop critical to spice markets and exports.",
    "uses": "Whole seed and powder as spice, tempering (tadka), cumin oil and oleoresin, Ayurvedic/digestive uses, and large-scale export to the Middle East and globally.",
    "soil": "Well-drained sandy-loam to loamy soils, pH 6.8-8.0. Tolerates mild salinity. Avoid heavy clay and waterlogged soils which cause root rot and blight.",
    "climate": "Cool, dry rabi crop needing clear sunny days. Optimal 20-30°C; sensitive to frost and to cloudy/humid weather which triggers blight and wilt. Needs minimal rainfall (300-400 mm) — dry climate at flowering/seeding is essential.",
    "season": "Rabi — sow first fortnight of November (Oct-end to mid-Nov); harvest February-March. Timely sowing is vital; late sowing increases blight and reduces yield.",
    "duration": "100-120 days",
    "seedRate": "5-6 kg/acre (broadcast slightly higher). Use certified, treated seed for uniform stand.",
    "spacing": "Rows 25-30 cm apart, plants thinned to 8-10 cm; or broadcast on flat beds. Aim for a moderately dense, even stand.",
    "sowingMethod": "Sow in flat beds or rows at 1.5-2 cm shallow depth (small seed) and give light irrigation. Seed treatment: Carbendazim+Thiram 2-3 g/kg or Trichoderma 4 g/kg against wilt/blight before sowing. Avoid deep sowing — poor emergence results.",
    "varieties": [
      "GC-4 (Gujarat Cumin-4)",
      "GC-3",
      "GC-2",
      "GC-1",
      "RZ-19 (Rajasthan)",
      "RZ-209",
      "RZ-223",
      "Pant Jeera"
    ],
    "nutrients": {
      "basal": "Apply DAP 35 kg/acre + Urea 13 kg/acre as basal at sowing (light feeder). Add 4-5 t/acre FYM during land prep. Avoid excess nitrogen which delays maturity and worsens blight.",
      "topDress": [
        "Urea 13 kg/acre at 30-35 DAS (after first weeding/irrigation)",
        "Urea 13 kg/acre at 50-55 DAS at branching/flowering",
        "Foliar spray of 0.5% urea + micronutrients at flowering aids seed set",
        "Avoid late N — encourages lush growth prone to blight"
      ]
    },
    "irrigation": "Needs light, frequent irrigation. First just after sowing, second at 8-10 days for germination, then at 18-20 day intervals (4-6 total). Critical moisture stages are branching, flowering and seed-development. Avoid evening/sprinkler irrigation in humid spells (promotes blight). Stop irrigation as seeds mature.",
    "weed": "Slow early growth makes weeding crucial. Two hand-weedings at 30 and 50 DAS. Pre-emergence Pendimethalin 1.0 L/acre (or Oxadiargyl) within 2 days of sowing greatly reduces weed pressure in this poor competitor.",
    "pests": [
      {
        "name": "Aphids",
        "symptom": "Colonies on tender shoots/flowers sucking sap, causing curling, honeydew and sooty mould; reduce seed set and can transmit virus.",
        "control": "Spray Imidacloprid 17.8% SL 40 ml/acre or Dimethoate 30% EC 250 ml/acre at first appearance; install yellow sticky traps."
      },
      {
        "name": "Thrips",
        "symptom": "Silvering and distortion of flowers/young pods reducing seed fill.",
        "control": "Spray Imidacloprid or Spinosad; avoid water stress that aggravates thrips."
      },
      {
        "name": "Termites & cutworm",
        "symptom": "Attack roots/seedlings in light sandy soils causing patchy stand loss.",
        "control": "Soil treatment / seed treatment with Chlorpyriphos; flood irrigation to expose cutworms."
      }
    ],
    "diseases": [
      {
        "name": "Cumin blight (Alternaria burnsii)",
        "symptom": "Brown to black lesions on leaves, stems and umbels; spreads fast in cloudy/humid weather and can destroy the crop at flowering — the most feared cumin disease.",
        "control": "Spray Mancozeb 0.25% prophylactically and at first symptoms, repeat at 10-12 day intervals; in severe pressure use Difenoconazole or Hexaconazole; avoid dense stand and evening irrigation."
      },
      {
        "name": "Fusarium wilt",
        "symptom": "Sudden wilting and drying of plants in patches at any stage; brown vascular browning in stem; survives in soil.",
        "control": "Grow tolerant varieties (GC-4); seed treat with Carbendazim/Trichoderma; long rotation (avoid cumin after cumin); deep summer ploughing."
      },
      {
        "name": "Powdery mildew",
        "symptom": "White powdery growth on leaves/stems late in season reducing seed quality.",
        "control": "Dust wettable Sulphur or spray Hexaconazole 5% EC at first appearance."
      }
    ],
    "harvest": "Mature when plants turn yellowish-brown and seeds harden (90-110 days). Cut plants with sickle in the morning, dry on threshing floor 4-6 days, then thresh and winnow. Yield: 2.5-4 quintal/acre (good crops up to 5 q); blight outbreaks can sharply cut yield.",
    "yield": "2.5-5 quintal/acre (avg ~3 q/acre)",
    "postHarvest": "Dry seed to 8-9% moisture; clean and grade by colour and purity (bright, uniform, dust-free seed preferred). Store in moisture-proof bags in dry godown; protect from storage pests. Bright, well-graded jeera meeting low-pesticide-residue norms is essential for export.",
    "marketTips": "No MSP; price set at spice mandis, chiefly Unjha (Gujarat) — Asia's largest jeera market — and NCDEX futures. Quality (oil %, colour, cleanliness, residue limits) drives price; export-grade clean seed earns premium. Value-add by cleaning, grading, powdering and oil extraction. Watch NCDEX trends and sell in lots to average price.",
    "dosDonts": [
      "DO sow on time (early-mid November) and treat seed against wilt/blight",
      "DO spray Mancozeb prophylactically — blight can wipe out the crop in cloudy weather",
      "DO keep stand moderate and irrigate light/frequent, never in the evening during humidity",
      "DON'T grow cumin after cumin — rotate to escape soil-borne wilt",
      "DON'T over-apply nitrogen — lush growth invites blight and delays maturity"
    ]
  },
  "jute": {
    "key": "jute",
    "title": "Jute",
    "emoji": "🧵",
    "about": "Jute is India's premier bast-fibre cash crop ('golden fibre'), grown mainly in West Bengal, Bihar, Assam, Odisha and eastern UP in the humid Gangetic-Brahmaputra belt. India is the world's largest jute producer; it supports a huge rural and industrial (sacking, hessian) economy.",
    "uses": "Sacking and hessian (gunny bags), ropes, twine, geo-textiles, carpet backing, jute bags and handicrafts, paper pulp; tender leaves eaten as vegetable and stalks used as fuel/fencing.",
    "soil": "Fertile, well-drained alluvial sandy-loam to clay-loam of river basins, pH 6.0-7.5. New alluvium (deltaic) soils with good moisture retention are best. Tolerates temporary flooding once established.",
    "climate": "Warm, humid crop. Optimal 24-37°C with 70-90% humidity; needs 1500-2500 mm well-distributed rain. Pre-monsoon showers aid sowing; abundant water for retting at harvest. Frost-free, high-rainfall regions suit it.",
    "season": "Capsularis sown March-April (tolerates early flooding); Olitorius sown April-May. Harvest July-September (90-130 days) coinciding with monsoon for retting.",
    "duration": "100-130 days (harvested at small-pod/early-flowering for best fibre)",
    "seedRate": "Line sowing 1.5-2 kg/acre; broadcast 3-3.5 kg/acre. Capsularis needs slightly higher rate.",
    "spacing": "Rows 25-30 cm apart, plants thinned to 5-7 cm within row. Dense stand gives long, fine, unbranched fibre.",
    "sowingMethod": "Broadcast or line sowing in well-prepared, fine, moist seedbed at ~2 cm depth; line sowing preferred for easy weeding/thinning. Mix small seed with sand/ash for even spread. Thin at 20-25 DAS to maintain spacing.",
    "varieties": [
      "JRC-321 (Capsularis)",
      "JRC-212 (Sonali)",
      "JRC-517",
      "JRO-524 (Navin, Olitorius)",
      "JRO-878",
      "JRO-204 (Suren)",
      "JRO-632",
      "Bidhan Pat (JRO-8432)"
    ],
    "nutrients": {
      "basal": "Apply DAP 35 kg/acre + MOP 17 kg/acre + part Urea 22 kg/acre as basal at/just after sowing, with 4 t/acre FYM. Jute responds well to nitrogen for fibre length and yield.",
      "topDress": [
        "Urea 22 kg/acre at 20-25 DAS after first weeding/thinning",
        "Urea 22 kg/acre at 40-45 DAS before canopy closes",
        "Avoid N after 50-55 DAS — late N delays maturity and lowers fibre quality",
        "ZnSO4 8 kg/acre basal in deficient soils improves growth"
      ]
    },
    "irrigation": "Mostly monsoon-fed. Early stage (first 6-8 weeks) needs adequate moisture but not standing water; give 1-2 irrigations in dry pre-monsoon spells, especially around 25-50 DAS (active growth) which is the critical stage. Crucially, abundant clean water is needed at harvest for retting.",
    "weed": "Critical first 40-45 days — weeds severely cut fibre yield. Two hand-weedings/thinnings at 20-25 and 40 DAS. Pre-emergence herbicides (e.g., Butachlor/Trifluralin) can be used; line sowing eases mechanical weeding.",
    "pests": [
      {
        "name": "Jute semilooper (Anomis sabulifera)",
        "symptom": "Green looping caterpillars defoliate leaves and bore growing tips, stunting plants and reducing fibre.",
        "control": "Spray Quinalphos 25% EC 400 ml/acre or Emamectin benzoate 5% SG; hand-collect in light infestation."
      },
      {
        "name": "Jute hairy caterpillar (Spilarctia/Diacrisia)",
        "symptom": "Gregarious hairy larvae skeletonise leaves in patches, defoliating young crop.",
        "control": "Collect and destroy egg masses/larval colonies; spray Quinalphos or Chlorpyriphos on hotspots."
      },
      {
        "name": "Yellow mite (Polyphagotarsonemus latus)",
        "symptom": "Top leaves crinkle, curl downward, bronze and harden ('leaf-curl'); stunts plant top and fibre.",
        "control": "Spray wettable Sulphur 0.2% or Dicofol/Spiromesifen; spray early as top leaves curl."
      },
      {
        "name": "Apion weevil (Stem weevil)",
        "symptom": "Grubs bore into stem causing galls/knots; weakens and lowers fibre quality.",
        "control": "Field sanitation, destroy stubble; spray Quinalphos at early infestation."
      }
    ],
    "diseases": [
      {
        "name": "Stem rot / soft rot (Macrophomina phaseolina)",
        "symptom": "Brown-black lesions girdling the stem, plant breaks/lodges; black sclerotia on affected tissue — most damaging jute disease.",
        "control": "Use clean treated seed (Carbendazim 2 g/kg); maintain drainage; spray Carbendazim 0.1% or Copper oxychloride 0.3%; avoid dense waterlogged stands."
      },
      {
        "name": "Anthracnose",
        "symptom": "Sunken brown spots on stem and leaves causing weak, spotted fibre.",
        "control": "Seed treatment and foliar Mancozeb 0.25%/Carbendazim; use resistant varieties; field sanitation."
      },
      {
        "name": "Black band (Botryodiplodia)",
        "symptom": "Black girdling band on upper stem; portion above dies and fibre breaks.",
        "control": "Spray Copper oxychloride/Carbendazim; remove and destroy affected plants; avoid mechanical injury."
      }
    ],
    "harvest": "Harvest at small-pod to early-flowering stage (100-120 days) for the best balance of yield and fibre fineness. Cut stems at base, bundle, defoliate, then ret (steep bundles in slow clean water 10-20 days until fibre separates). Strip fibre by hand, wash and dry. Fibre yield: 10-15 quintal/acre (good crops up to 18 q).",
    "yield": "10-18 quintal/acre dry fibre (avg ~11-12 q/acre)",
    "postHarvest": "Proper retting is key — use clean, slow-moving water, sufficient depth, and weight bundles evenly; under/over-retting ruins fibre. After stripping, wash to remove gummy matter, sun-dry to ~12-15% moisture, then grade by colour (silvery/golden), strength, lustre and length. Store dry, baled, away from moisture.",
    "marketTips": "Jute has an MSP — Raw Jute (TD-3 grade) MSP for 2025-26 season is around ₹5,650/quintal; procured via Jute Corporation of India (JCI). Bright golden, lustrous, strong, well-retted long fibre fetches top grades (TD-1/2). Sell at regulated jute markets; value-add via diversified jute products (bags, geo-textiles). Avoid poor retting which downgrades fibre and price.",
    "dosDonts": [
      "DO ret in clean slow-moving water and harvest at small-pod stage for fine, strong fibre",
      "DO sow in lines and thin early for long unbranched fibre",
      "DO control semilooper and yellow mite early to protect the canopy",
      "DON'T under- or over-ret — it ruins fibre colour and strength",
      "DON'T apply nitrogen late (after 50 DAS) — it delays maturity and weakens fibre"
    ]
  },
  "banana": {
    "key": "banana",
    "title": "Banana",
    "emoji": "🍌",
    "about": "Banana (Musa spp.) is India's most important fruit crop by volume and a year-round source of income for smallholders. Major states are Maharashtra, Tamil Nadu, Andhra Pradesh, Gujarat, Karnataka and Madhya Pradesh, with Jalgaon (Maharashtra) being the banana hub. India is the world's largest banana producer.",
    "uses": "Fresh dessert/cooking fruit, ripe and raw; banana chips, puree, flour, fibre, and leaves for serving. Plantain types used as vegetable.",
    "soil": "Deep, well-drained rich loamy to clay-loam soil, pH 6.5–7.5, high in organic matter; avoid waterlogged or saline/sodic soils.",
    "climate": "Warm humid tropics, 26–32°C ideal; growth stops below 12°C; rainfall 1000–2000 mm; sensitive to frost and strong winds (>60 km/hr causes lodging).",
    "season": "Perennial (plant + ratoon); main planting Kharif (Jun–Jul) and Rabi/Mrig bahar; in Maharashtra Kanda bahar (Oct–Nov) and Mrig bahar (Jun–Jul).",
    "duration": "330–365 days from planting to first harvest (12–14 months); ratoon crops thereafter.",
    "seedRate": "Tissue-culture plants or sword suckers: ~1200–1500 plants/acre (spacing dependent); 1 sucker/pit.",
    "spacing": "1.5 m × 1.5 m (paired-row 1.2×1.2×2 m for high density); pit size 45×45×45 cm.",
    "sowingMethod": "Plant healthy tissue-culture seedlings or 1.5–2 kg sword suckers in pits filled with FYM + soil; treat suckers/dip TC plants in Carbendazim 0.1% + Chlorpyriphos to control rhizome weevil and fungus.",
    "varieties": [
      "Grand Naine (G-9)",
      "Dwarf Cavendish (Basrai)",
      "Robusta",
      "Rasthali",
      "Poovan",
      "Nendran",
      "Red Banana",
      "Ney Poovan"
    ],
    "nutrients": {
      "basal": "Per plant: 10 kg FYM + 100 g DAP + 100 g MOP at planting; ~50 kg DAP + 60 kg MOP per acre as basal.",
      "topDress": [
        "Urea ~90 g/plant per split in 5 splits at 30, 75, 120, 165, 210 DAP (~430 g urea/plant; ~550 kg urea/acre total at ~1300 plants)",
        "MOP 200 g/plant split at 75 & 165 DAP for bunch filling",
        "Apply ZnSO4 + FeSO4 foliar spray at 4th & 6th month; micronutrient mix as needed"
      ]
    },
    "irrigation": "Drip irrigation recommended (saves 40% water); 4–6 mm/day. Critical stages: early establishment, flowering/shooting (8–9 months) and bunch development. Never let soil dry at bunch filling; avoid waterlogging.",
    "weed": "Keep basin weed-free first 4 months; 2–3 hand weedings, intercrop or mulch with crop residue/black polythene. Glyphosate only as directed inter-row spray, never on plant.",
    "pests": [
      {
        "name": "Banana stem/pseudostem weevil",
        "symptom": "Wilting, tunnels in pseudostem with gummy ooze",
        "control": "Inject Chlorpyriphos 0.1% in stem; remove affected plants; pseudostem traps"
      },
      {
        "name": "Rhizome weevil",
        "symptom": "Bored rhizome, poor growth, plant topples",
        "control": "Sucker treatment with Chlorpyriphos dip; soil drench Carbofuran 3G"
      },
      {
        "name": "Aphids (vector of Bunchy Top virus)",
        "symptom": "Curled leaves, sticky honeydew",
        "control": "Spray Imidacloprid 17.8 SL 0.5 ml/L; rogue virus-infected plants"
      },
      {
        "name": "Nematodes",
        "symptom": "Root lesions, toppling, reduced yield",
        "control": "Use TC plants; apply Carbofuran 3G 40 g/plant; FYM + Pseudomonas"
      }
    ],
    "diseases": [
      {
        "name": "Panama wilt (Fusarium)",
        "symptom": "Yellowing leaf margins, splitting pseudostem, reddish vascular strands",
        "control": "Plant resistant varieties; Carbendazim drench 2 g/L; avoid infected fields"
      },
      {
        "name": "Sigatoka leaf spot",
        "symptom": "Brown/black streaks and spots on leaves, premature drying",
        "control": "Spray Propiconazole 1 ml/L or Mancozeb 2.5 g/L + mineral oil; remove infected leaves"
      },
      {
        "name": "Bunchy Top Virus",
        "symptom": "Stunted bunched leaves, dark green streaks on veins",
        "control": "Use virus-free TC plants; control aphid vector; uproot and destroy infected plants"
      },
      {
        "name": "Anthracnose (post-harvest)",
        "symptom": "Black sunken spots on ripening fruit",
        "control": "Pre-harvest Carbendazim spray; hot-water/fungicide dip of bunches"
      }
    ],
    "harvest": "Harvest at 75–80% maturity when fingers are plump, angles rounded and light green (3/4 round); 11–14 months. Bunch yield 25–30 kg. Yield 25–35 tonnes/acre.",
    "yield": "250–350 quintal/acre (25–35 tonnes); high-density TC Grand Naine can reach 40 t/acre.",
    "postHarvest": "Dehand, wash, grade; ripen with ethylene (100 ppm) in ripening chambers, NOT calcium carbide. Store 13–14°C. Process culls into chips, powder, puree.",
    "marketTips": "No MSP; sell graded bunches to local mandi, contractors or direct to chip units. Value-add via banana chips, fibre and powder fetches premium; tie up with FPOs/exporters for Cavendish.",
    "dosDonts": [
      "Do use disease-free tissue-culture plants",
      "Do install drip + fertigation for best yields",
      "Do prop/stake bunches against wind lodging",
      "Don't ripen with banned calcium carbide",
      "Don't let basins waterlog — invites Panama wilt"
    ]
  },
  "mango": {
    "key": "mango",
    "title": "Mango",
    "emoji": "🥭",
    "about": "Mango (Mangifera indica) is the 'King of Fruits' and India's most widely grown fruit, dominant in Uttar Pradesh, Andhra Pradesh, Karnataka, Bihar, Gujarat and Maharashtra (Alphonso/Kesar belt). India is the world's largest producer and a major exporter of fresh and processed mango.",
    "uses": "Fresh dessert fruit; raw mango for pickle, amchur, panna, chutney; ripe pulp for juice, squash, aamras, leather, jam.",
    "soil": "Deep, well-drained loamy soil, pH 5.5–7.5; tolerates a range but avoids waterlogged, saline or shallow rocky soils.",
    "climate": "Tropical/subtropical, 24–30°C; needs dry weather at flowering (rain/fog causes flower drop & disease); hardy adult trees tolerate 4–45°C but frost kills young plants.",
    "season": "Perennial; planting in monsoon (Jun–Aug) or Feb–Mar in irrigated areas; flowering Dec–Feb, harvest Apr–Jul.",
    "duration": "First commercial fruiting in 4–5 years (grafts); tree productive 40+ years; ~100–150 days from flowering to harvest.",
    "seedRate": "Grafted plants only: ~16 trees/acre at 10×10 m (conventional); ~70 trees/acre at 5×5 m (high-density); up to ~270/acre at 3×2 m (ultra-high density).",
    "spacing": "10 m × 10 m conventional; 5 m × 5 m high-density; 3 m × 2 m ultra-high-density (Amrapali type).",
    "sowingMethod": "Plant 1-year grafted saplings (softwood/veneer graft) in 1×1×1 m pits filled with FYM + soil + 1 kg SSP; stake graft union; protect from frost first 2 winters.",
    "varieties": [
      "Alphonso (Hapus)",
      "Kesar",
      "Dashehari",
      "Langra",
      "Chausa",
      "Banganapalli",
      "Totapuri",
      "Amrapali"
    ],
    "nutrients": {
      "basal": "Per bearing tree/year: 50 kg FYM + 1 kg SSP + 1 kg MOP applied Sept–Oct in basin; young trees scaled by age.",
      "topDress": [
        "Urea ~1.5 kg/bearing tree split — half after harvest (Jun–Jul), half before flowering (Sept–Oct)",
        "Apply MOP & SSP once after harvest",
        "Foliar spray of ZnSO4 0.5% + Borax 0.1% before flowering to reduce malformation/drop; KNO3 1% spray to induce flowering"
      ]
    },
    "irrigation": "Young plants need regular irrigation. Bearing trees: critical stages are fruit-set and fruit development (Mar–May) — irrigate every 10–15 days then. Withhold irrigation 2–3 months before flowering to induce bloom; avoid irrigation at full bloom.",
    "weed": "Keep basins weed-free; mulch with dry grass/leaves to conserve moisture; clean cultivation or cover crop in inter-space; herbicide Glyphosate only in alleys.",
    "pests": [
      {
        "name": "Mango hopper",
        "symptom": "Nymphs suck sap from flowers, honeydew + sooty mould, flower/fruit drop",
        "control": "Spray Imidacloprid 0.3 ml/L or Thiamethoxam at panicle emergence and fruit-set"
      },
      {
        "name": "Fruit fly",
        "symptom": "Maggots in fruit, premature drop, rotting",
        "control": "Methyl eugenol pheromone traps; bait spray; bag fruits; field sanitation"
      },
      {
        "name": "Mealy bug",
        "symptom": "Clusters on panicles/shoots, sap sucking",
        "control": "Band trunks with sticky polythene + grease in Dec; spray Buprofezin; Chlorpyriphos band"
      },
      {
        "name": "Stem borer",
        "symptom": "Bore holes with frass, wilting branches",
        "control": "Clean and inject Dichlorvos/Kerosene in holes, plug with mud; prune dead wood"
      }
    ],
    "diseases": [
      {
        "name": "Powdery mildew",
        "symptom": "White powder on panicles/young fruit, flower drop",
        "control": "Spray wettable Sulphur 2 g/L or Hexaconazole at panicle stage, repeat at 15 days"
      },
      {
        "name": "Anthracnose",
        "symptom": "Black spots on leaves, flowers, blossom blight, fruit rot",
        "control": "Carbendazim 1 g/L or Copper oxychloride 3 g/L sprays; post-harvest hot-water dip"
      },
      {
        "name": "Mango malformation",
        "symptom": "Bunchy, compact malformed panicles/shoots, no fruit",
        "control": "Prune & burn affected parts; NAA 200 ppm spray in Oct; ZnSO4 spray"
      },
      {
        "name": "Sooty mould",
        "symptom": "Black coating on leaves over hopper/mealybug honeydew",
        "control": "Control sucking pests; spray starch solution; wash foliage"
      }
    ],
    "harvest": "Mature when shoulders fill, colour breaks (green to yellowish), specific gravity >1.0 (sinks in water); harvest with 5–10 cm stalk to avoid latex burn. April–July.",
    "yield": "Bearing orchard 4–6 tonnes/acre (40–60 quintal); 10–15 yr trees give 1000–3000 fruits/tree depending on variety.",
    "postHarvest": "De-sap inverted, wash, grade by size; ripen with ethylene (NOT carbide) at 20–22°C. Store 12–13°C. Pulp processing for Alphonso/Totapuri; raw fruit to pickle/amchur.",
    "marketTips": "No MSP; sell graded fruit to mandi, exporters (Alphonso/Kesar fetch premium with GI tag) or pulp factories (Totapuri). Grading by size/colour and good ripening fetch best price; APEDA export tie-ups for EU/Gulf.",
    "dosDonts": [
      "Do plant grafted saplings, not seedlings",
      "Do spray at panicle emergence & fruit-set for hopper/mildew",
      "Do harvest at right maturity with stalk to avoid latex burn",
      "Don't irrigate during flower induction or full bloom",
      "Don't use calcium carbide for ripening — illegal & unsafe"
    ]
  },
  "grapes": {
    "key": "grapes",
    "title": "Grapes",
    "emoji": "🍇",
    "about": "Grape (Vitis vinifera) is a high-value commercial fruit grown mainly in Maharashtra (Nashik, Sangli — the grape capital), Karnataka, Andhra Pradesh, Tamil Nadu and Punjab. India is a leading exporter of fresh table grapes and Nashik is the wine hub.",
    "uses": "Table grapes (fresh), raisins (kishmish/sultana), wine, juice; export of seedless Thompson types.",
    "soil": "Well-drained sandy-loam to medium-black soil, pH 6.5–7.5; deep with good drainage; avoid saline/waterlogged soils.",
    "climate": "Hot dry climate ideal; 15–40°C; needs dry weather at flowering and ripening (rain causes cracking & disease); low humidity reduces fungal load.",
    "season": "Perennial vine; planting Jan–Feb or Jun–Jul; April pruning (foundation) and Oct pruning (fruit) double-pruning system; harvest Feb–Apr.",
    "duration": "First crop in 2nd–3rd year; ~120–150 days from fruit (October) pruning to harvest.",
    "seedRate": "Rooted cuttings/grafts: ~450–680 vines/acre depending on spacing; 1 vine/pit.",
    "spacing": "3 m × 1.5 m or 3 m × 2 m on Bower/Y-trellis system; pit 60×60×60 cm.",
    "sowingMethod": "Plant rooted cuttings or Dogridge-grafted vines (for saline/nematode soils) in pits; train on bower/trellis; double-prune (April foundation + October fruit pruning).",
    "varieties": [
      "Thompson Seedless",
      "Tas-A-Ganesh",
      "Sonaka",
      "Sharad Seedless",
      "Manik Chaman",
      "Anab-e-Shahi",
      "Bangalore Blue",
      "Flame Seedless"
    ],
    "nutrients": {
      "basal": "Per acre at back-pruning: 8–10 t FYM + 100 kg SSP + 80 kg MOP; apply DAP 50 kg basal.",
      "topDress": [
        "Urea ~130 kg/acre split — at bud break, 30 & 45 days after October pruning",
        "MOP additional dose at berry development for sugar/colour",
        "Foliar GA3 (gibberellic acid) sprays for berry size + KNO3/micronutrient (ZnSO4, Borax) sprays at flowering"
      ]
    },
    "irrigation": "Drip essential; high need at berry growth. Critical stages: bud break, flowering, berry set and berry growth. STOP/reduce irrigation at ripening to raise sugar (TSS) and prevent cracking. Avoid water stress at berry development.",
    "weed": "Drip + mulch (polythene/organic) controls weeds; manual weeding in vine row; herbicide Glyphosate/Paraquat in inter-rows away from green tissue.",
    "pests": [
      {
        "name": "Thrips",
        "symptom": "Silvery scarring, corky russet on berries, scarred leaves",
        "control": "Spray Spinosad or Fipronil at flowering/berry set; blue sticky traps"
      },
      {
        "name": "Mealy bug",
        "symptom": "White cottony clusters on bunches/stem, sooty mould",
        "control": "Buprofezin/Chlorpyriphos spray; release Cryptolaemus predator; trunk banding"
      },
      {
        "name": "Grape flea beetle (Scelodonta strigicollis)",
        "symptom": "Adults feed on and hollow out sprouting buds after pruning; grubs feed on roots",
        "control": "Spray Carbaryl/Imidacloprid right after pruning at bud swell"
      },
      {
        "name": "Mites",
        "symptom": "Bronzing/yellow speckling on leaves, webbing",
        "control": "Spray Dicofol or Fenazaquin; wettable sulphur dusting"
      }
    ],
    "diseases": [
      {
        "name": "Downy mildew",
        "symptom": "Oily yellow spots upper leaf, white downy growth below, bunch rot",
        "control": "Spray Mancozeb prophylactic + systemic Metalaxyl/Fosetyl-Al in cloudy/rainy weather"
      },
      {
        "name": "Powdery mildew",
        "symptom": "White powder on leaves, shoots, berries; cracking",
        "control": "Wettable Sulphur or Hexaconazole/Myclobutanil sprays from flowering"
      },
      {
        "name": "Anthracnose (bird's eye spot)",
        "symptom": "Sunken dark spots with grey centre on berries/shoots",
        "control": "Carbendazim or Copper oxychloride; dormant Bordeaux paste after pruning"
      },
      {
        "name": "Bacterial leaf spot",
        "symptom": "Dark angular spots, blight in humid weather",
        "control": "Streptocycline + Copper oxychloride spray; sanitation"
      }
    ],
    "harvest": "Harvest at full TSS (16–18° Brix), uniform colour and sweet taste; berries firm, table grapes do not ripen after picking. Cut bunches in cool morning. Feb–April.",
    "yield": "8–12 tonnes/acre (80–120 quintal) for table grapes under good management.",
    "postHarvest": "Pre-cool to 4°C, dip in SO2 pads, pack in CFB boxes; cold store/transport at 0–2°C. Raisins made by dipping + shade drying. Export-grade requires residue (MRL) compliance.",
    "marketTips": "No MSP; export Thompson/Sharad seedless via APEDA-registered exporters (premium, residue-tested) or sell to wineries (Nashik) and raisin units (Sangli). Grading, SO2 packing and cold chain critical for export price.",
    "dosDonts": [
      "Do follow double-pruning (April + October) schedule",
      "Do use GA3 and proper canopy management for berry size",
      "Do test residues (MRL) before export harvest",
      "Don't irrigate at ripening — causes cracking & low sugar",
      "Don't ignore downy/powdery mildew sprays in cloudy weather"
    ]
  },
  "pomegranate": {
    "key": "pomegranate",
    "title": "Pomegranate",
    "emoji": "🔴",
    "about": "Pomegranate (Punica granatum) is a hardy, drought-tolerant high-value fruit, with Maharashtra (Solapur, Sangli, Nashik), Karnataka, Gujarat, Andhra Pradesh and Rajasthan as major producers. India leads world production and exports Bhagwa to the Gulf and Europe.",
    "uses": "Fresh fruit (arils), juice, anardana (dried seeds), squash; rich in antioxidants, strong export demand.",
    "soil": "Well-drained deep loamy to medium-black soil, pH 6.5–7.5; tolerates light/marginal and slightly saline soils; avoid waterlogging.",
    "climate": "Hot dry semi-arid; 25–35°C; needs dry hot weather for fruit development/quality; tolerates drought; high humidity worsens bacterial blight.",
    "season": "Perennial; bahar treatment regulates cropping — Mrig bahar (Jun–Jul flowering), Hasta bahar (Sep–Oct), Ambe bahar (Jan–Feb). Plant Jun–Aug or Feb.",
    "duration": "First crop in 2nd–3rd year; ~120–150 days from flowering (bahar) to harvest.",
    "seedRate": "Rooted cuttings/air-layers: ~440–530 plants/acre; 1 plant/pit.",
    "spacing": "4.5 m × 3 m or 3 m × 2 m (high-density up to 5×2 m); pit 60×60×60 cm.",
    "sowingMethod": "Plant rooted hardwood cuttings or air-layered/TC plants in pits with FYM + 1 kg SSP; train single/multi-stem; give bahar (rest + stress + pruning) to time flowering.",
    "varieties": [
      "Bhagwa (Kesar)",
      "Ganesh",
      "Arakta",
      "Mridula",
      "Ruby",
      "G-137",
      "Phule Arakta",
      "Solapur Lal"
    ],
    "nutrients": {
      "basal": "Per bearing tree at bahar: 10 kg FYM + 250 g DAP + 250 g MOP; ~50 kg DAP + 50 kg MOP per acre.",
      "topDress": [
        "Urea ~150 g/tree split at bud break, fruit-set and fruit development (3 splits)",
        "Extra MOP at fruit development for colour/quality",
        "Foliar Ca (Calcium nitrate) + Boron sprays to reduce fruit cracking; ZnSO4 0.5% spray"
      ]
    },
    "irrigation": "Drip essential. Critical stages: flowering, fruit-set and fruit development. Maintain UNIFORM moisture during fruit growth — fluctuation causes fruit cracking. Stress applied deliberately during bahar rest period only.",
    "weed": "Drip + mulching; basin weed-free; 2–3 hand weedings/year; Glyphosate in inter-row alleys only.",
    "pests": [
      {
        "name": "Fruit borer (anar butterfly)",
        "symptom": "Larva bores fruit, entry hole with excreta, fruit rots",
        "control": "Bag fruits; spray Cypermethrin/Spinosad at fruit-set; remove infested fruits; pheromone traps"
      },
      {
        "name": "Sucking pests (thrips/whitefly/aphid)",
        "symptom": "Leaf curl, scarred fruit surface, honeydew",
        "control": "Imidacloprid/Spinosad sprays; yellow & blue sticky traps"
      },
      {
        "name": "Mealy bug",
        "symptom": "White waxy clusters on shoots & fruit calyx",
        "control": "Buprofezin/Chlorpyriphos; trunk banding; release Cryptolaemus"
      },
      {
        "name": "Stem borer",
        "symptom": "Bore holes with frass, drying branches",
        "control": "Inject Dichlorvos in holes, plug with mud; prune & burn affected wood"
      }
    ],
    "diseases": [
      {
        "name": "Bacterial blight (Telya/oily spot)",
        "symptom": "Oily dark water-soaked spots on leaves/fruit, cracking, fruit drop",
        "control": "Streptocycline 0.5 g + Copper oxychloride 2.5 g/L; remove & burn infected parts; sanitation, avoid overhead water"
      },
      {
        "name": "Wilt (Ceratocystis/Fusarium)",
        "symptom": "Yellowing, wilting of one side, whole plant death",
        "control": "Drench Carbendazim + Trichoderma; uproot & destroy; avoid waterlogging"
      },
      {
        "name": "Anthracnose / fruit spot",
        "symptom": "Brown sunken spots on fruit and leaves",
        "control": "Mancozeb/Carbendazim sprays; field sanitation"
      },
      {
        "name": "Cercospora fruit/leaf spot",
        "symptom": "Black spots on fruit rind, leaf spotting",
        "control": "Mancozeb or Hexaconazole sprays during fruit development"
      }
    ],
    "harvest": "Harvest when rind turns deep red/glossy, calyx closes, aril red and sweet (TSS 15–16°Brix), tapping gives metallic sound; ~120–150 days after flowering.",
    "yield": "4–6 tonnes/acre (40–60 quintal); well-managed Bhagwa orchards give 25–30 kg/tree.",
    "postHarvest": "Wash, grade by size/colour, pack in foam-net + CFB boxes; cold store at 5°C, 90% RH (up to 2 months). Process culls into juice/anardana.",
    "marketTips": "No MSP; Bhagwa exported (APEDA) to Gulf/EU at premium — needs residue compliance & grading. Sell to mandi, exporters or juice/anardana processors; uniform large red fruit fetches top price.",
    "dosDonts": [
      "Do manage bahar (rest + stress) to time the crop and avoid blight season",
      "Do maintain uniform drip moisture to prevent cracking",
      "Do spray Streptocycline+Copper at first sign of Telya",
      "Don't plant in waterlogged soil — invites wilt",
      "Don't let fruit borer go unchecked — bag fruits early"
    ]
  },
  "apple": {
    "key": "apple",
    "title": "Apple",
    "emoji": "🍎",
    "about": "Apple (Malus domestica) is the premier temperate fruit of India, grown in Jammu & Kashmir, Himachal Pradesh (Shimla/Kinnaur) and Uttarakhand at 1500–2700 m. It is the economic backbone of hill farmers and India's most valuable temperate fruit crop.",
    "uses": "Fresh dessert fruit; juice, cider, jam, dried rings; culls to processing.",
    "soil": "Deep, well-drained loamy soil rich in organic matter, pH 5.5–6.5; good drainage on slopes essential; avoid heavy clay/waterlogged soils.",
    "climate": "Temperate; needs 1000–1500 chilling hours below 7°C for proper bud break; ideal 21–24°C in growing season; rainfall 1000–1250 mm; hail and spring frost are major risks.",
    "season": "Perennial; planting in dormant season (Dec–Feb / Jan–Mar); flowering Apr, harvest Aug–Oct.",
    "duration": "First fruiting 3–4 years (spur/dwarf) to 6–8 years (seedling stock); ~130–150 days flowering to harvest.",
    "seedRate": "Grafted plants: ~110 trees/acre conventional (6×6 m); high-density dwarf (M9/MM106) up to 500–1300 trees/acre.",
    "spacing": "6 m × 6 m on seedling rootstock; high-density 3 m × 1 m or 3.5 m × 1.5 m on dwarfing rootstock with trellis.",
    "sowingMethod": "Plant 1-year grafted saplings (on M9/MM106/seedling rootstock) in 1×1×1 m pits with FYM; stake/trellis high-density; whitewash trunks; provide pollinizer rows (e.g., Golden Delicious) + bee hives.",
    "varieties": [
      "Royal Delicious",
      "Red Delicious",
      "Golden Delicious",
      "Rich-a-Red",
      "Granny Smith",
      "Gala (Royal Gala)",
      "Ambri (Kashmir)",
      "Tydeman's Early"
    ],
    "nutrients": {
      "basal": "Per bearing tree/year: 30–40 kg FYM + 1 kg SSP + 0.7 kg MOP applied Dec–Jan in basin; scaled by tree age (~70 g N/MOP/SSP per year of age).",
      "topDress": [
        "Urea split — half before bud break (Feb–Mar), half after fruit-set (Apr–May), ~0.7 kg/bearing tree",
        "Foliar ZnSO4 0.5%, Borax, and Calcium nitrate sprays to control deficiencies, bitter pit and improve set",
        "Apply MOP/SSP once in dormancy"
      ]
    },
    "irrigation": "Drip/basin; critical stages: bud break, fruit-set and fruit development (Apr–Aug). Irrigate every 7–10 days in dry spells; avoid stress during cell division (first 6 weeks after set) and pre-harvest sizing. Reduce near harvest for colour.",
    "weed": "Clean basin (1 m); cover crop/sod in alleys; mulch to conserve moisture & suppress weeds; Glyphosate strip-spray in tree row away from trunk.",
    "pests": [
      {
        "name": "Codling moth / Apple scab insect complex",
        "symptom": "Larva bores fruit, frass at entry, internal damage",
        "control": "Pheromone traps; spray Chlorpyriphos/Spinosad at petal fall & cover sprays"
      },
      {
        "name": "San Jose scale",
        "symptom": "Red-grey scales on bark/fruit, bark cracking, decline",
        "control": "Dormant oil spray; Chlorpyriphos/Buprofezin in growing season"
      },
      {
        "name": "Woolly apple aphid",
        "symptom": "White cottony masses on roots/shoots, galls",
        "control": "Use resistant MM rootstock; spray Chlorpyriphos; release Aphelinus parasite"
      },
      {
        "name": "Mites (European red mite)",
        "symptom": "Bronzing, stippling of leaves, defoliation",
        "control": "Dormant oil; spray Dicofol/Fenazaquin in season"
      }
    ],
    "diseases": [
      {
        "name": "Apple scab",
        "symptom": "Olive-green velvety spots on leaves & fruit, cracking, scabby fruit",
        "control": "Spray Mancozeb/Dodine at green-tip & pink bud; Carbendazim/Hexaconazole curative; sanitation of fallen leaves"
      },
      {
        "name": "Premature leaf fall (Marssonina)",
        "symptom": "Brown spots, yellowing, heavy monsoon defoliation",
        "control": "Mancozeb/Dodine sprays through monsoon; Carbendazim; collect & destroy fallen leaves"
      },
      {
        "name": "Powdery mildew",
        "symptom": "White powder on shoots, leaves, blossoms, stunting",
        "control": "Wettable Sulphur/Hexaconazole; prune & remove infected shoots in dormancy"
      },
      {
        "name": "Collar/root rot & canker",
        "symptom": "Bark cankers, collar rot, gummosis, dieback",
        "control": "Bordeaux paste on wounds; Copper oxychloride drench; improve drainage; prune cankers"
      }
    ],
    "harvest": "Harvest at proper maturity: ground colour change, starch-iodine index, easy stalk separation, characteristic colour; Aug–Oct depending on variety. Pick gently by hand with stalk.",
    "yield": "4–6 tonnes/acre (40–60 quintal) conventional; high-density orchards 10–14 t/acre.",
    "postHarvest": "Grade by size/colour (AA, A, B, C), pack in CFB telescopic boxes with trays; pre-cool and store in CA/cold store at 0–1°C, 90% RH (3–6 months) to sell off-season at higher price.",
    "marketTips": "No MSP; market through APMC mandis (Delhi Azadpur), HPMC, or direct to retail/cold-chain buyers. CA storage lets farmers sell off-season at premium; grading and packing strongly determine price. Bee pollination + colour decide grade.",
    "dosDonts": [
      "Do plant pollinizer varieties + provide bee hives for fruit-set",
      "Do follow scab spray schedule from green-tip stage",
      "Do grade and use CA/cold storage to sell off-season",
      "Don't plant in low-chilling sites — poor bud break",
      "Don't harvest immature — low colour & poor storage"
    ]
  },
  "papaya": {
    "key": "papaya",
    "title": "Papaya",
    "emoji": "🍈",
    "about": "Papaya (Carica papaya) is a fast-growing, high-return fruit crop grown across India — Andhra Pradesh, Gujarat, Maharashtra, Karnataka, West Bengal and Madhya Pradesh. It gives fruit within a year and is also a key source of papain (latex enzyme). India is the world's largest papaya producer.",
    "uses": "Fresh ripe fruit (rich in vitamin A/C); raw fruit as vegetable; papain extraction from latex (pharma, food, tenderiser); juice, tutti-frutti.",
    "soil": "Well-drained light loamy/sandy-loam soil, pH 6.0–7.0, rich in organic matter; very sensitive to waterlogging — never plant in low-lying spots.",
    "climate": "Warm humid; 22–32°C ideal; growth stops below 10°C, frost is fatal; sensitive to strong wind (lodging) and waterlogging; rainfall 1000–1500 mm with good drainage.",
    "season": "Planted year-round in frost-free areas; main planting Jun–Jul (Kharif), Sep–Oct and Feb–Mar; harvest begins ~8–10 months after planting.",
    "duration": "Fruiting starts 8–10 months from transplanting; economic crop 24–30 months (2–2.5 years).",
    "seedRate": "Hybrids ~100–125 g/acre (raise nursery seedlings); ~1000–1200 plants/acre transplanted.",
    "spacing": "1.8 m × 1.8 m or 2 m × 2 m; high-density 1.5 m × 1.5 m; pit 45×45×45 cm.",
    "sowingMethod": "Raise seedlings in pro-trays/polybags (treat seed with Captan/Thiram + hot-water); transplant 30–45 day, 15–20 cm seedlings (2–3/pit, retain 1 after sexing in dioecious types); gynodioecious hybrids need only 1.",
    "varieties": [
      "Pusa Delicious",
      "Pusa Dwarf",
      "Pusa Nanha",
      "Coorg Honey Dew (Madhu Bindu)",
      "Red Lady (Taiwan 786)",
      "Sunrise Solo",
      "Washington",
      "CO-7"
    ],
    "nutrients": {
      "basal": "Per plant: 10 kg FYM + 100 g DAP + 100 g MOP at planting; ~50 kg DAP + 50 kg MOP per acre as basal.",
      "topDress": [
        "Urea ~250 g/plant split bi-monthly (every 2 months) from establishment through bearing (~6 splits)",
        "MOP additional dose at flowering/fruiting for quality",
        "Foliar ZnSO4 0.5% + Borax 0.1% sprays to correct deficiency and improve fruit set"
      ]
    },
    "irrigation": "Drip ideal (also keeps collar dry, reduces foot rot). Critical stages: establishment, flowering and fruit development. Irrigate every 4–6 days summer, 10–12 days winter; ensure NO waterlogging — water near collar causes foot rot.",
    "weed": "Keep basin weed-free; shallow weeding (avoid root damage); mulch with organic matter/polythene; intercrop short-duration legumes early.",
    "pests": [
      {
        "name": "Aphids (virus vectors)",
        "symptom": "Leaf curl, sticky honeydew; spread mosaic/ringspot virus",
        "control": "Spray Imidacloprid 0.3 ml/L; yellow sticky traps; rogue virus-infected plants promptly"
      },
      {
        "name": "Whitefly / mealybug",
        "symptom": "Yellowing, honeydew, sooty mould, virus spread",
        "control": "Spray Thiamethoxam/Buprofezin; sticky traps; field sanitation"
      },
      {
        "name": "Red spider mite",
        "symptom": "Yellow speckling, bronzing of leaves in dry weather",
        "control": "Spray Dicofol/wettable Sulphur; maintain humidity"
      },
      {
        "name": "Fruit fly",
        "symptom": "Maggots in ripening fruit, rotting",
        "control": "Methyl eugenol traps; bag fruits; collect & destroy fallen fruit"
      }
    ],
    "diseases": [
      {
        "name": "Papaya Ring Spot Virus (PRSV)",
        "symptom": "Mosaic, leaf distortion, oily rings on fruit, stunting",
        "control": "Use tolerant varieties; rogue infected plants; control aphid vector; avoid old papaya nearby"
      },
      {
        "name": "Foot rot / collar rot (Phytophthora)",
        "symptom": "Water-soaked rot at collar, plant wilts and topples",
        "control": "Drip + good drainage; drench Metalaxyl/Copper oxychloride at collar; avoid water near stem"
      },
      {
        "name": "Powdery mildew",
        "symptom": "White powder on leaves & young fruit",
        "control": "Wettable Sulphur 2 g/L or Hexaconazole sprays"
      },
      {
        "name": "Anthracnose (post-harvest)",
        "symptom": "Sunken dark spots on ripening fruit",
        "control": "Pre-harvest Carbendazim spray; hot-water dip; careful handling"
      }
    ],
    "harvest": "Harvest at colour-break stage — green fruit showing yellow streaks at apex and latex turning watery; firm for transport, ripens off-tree. Continuous picking over months; ~9–10 months onward.",
    "yield": "30–40 tonnes/acre over the crop (300–400 quintal); ~40–60 kg/plant lifetime.",
    "postHarvest": "Harvest at right stage, wash, grade by size; ripen at 20–25°C; store 10–13°C. For papain, tap green fruit latex, dry/spray-dry and sell to processors. Handle gently — bruises rot fast.",
    "marketTips": "No MSP; sell graded ripe fruit to local/distant mandi and retail chains; papain extraction adds high value (pharma demand). Colour-break harvesting + careful handling extends shelf life and price; tie up with FPOs for bulk.",
    "dosDonts": [
      "Do plant on raised beds/ridges with drip to avoid foot rot",
      "Do rogue out virus-infected plants immediately",
      "Do use gynodioecious hybrids (Red Lady) for high fruit set",
      "Don't allow waterlogging near the collar",
      "Don't harvest fully ripe for distant markets — pick at colour-break"
    ]
  },
  "coconut": {
    "key": "coconut",
    "title": "Coconut",
    "emoji": "🥥",
    "about": "Coconut (Cocos nucifera), the 'Kalpavriksha', is a perennial palm grown on about 21 lakh hectares in India, mainly Kerala, Tamil Nadu, Karnataka, Andhra Pradesh, Odisha, Goa and the islands. India is the world's largest producer. It supports millions of coastal smallholders for copra, oil, coir, tender nut and neera.",
    "uses": "Tender coconut water, copra and coconut oil, desiccated coconut, coir fibre, neera/sugar, virgin coconut oil (VCO), shell charcoal and activated carbon.",
    "soil": "Wide range from laterite, alluvial, red sandy loam to reclaimed coastal sands; deep (minimum 1 m), well-drained soils with good water table; pH 5.2-8.0. Avoid waterlogged or shallow rocky soils.",
    "climate": "Humid tropical, 27-32°C optimum (tolerates 20-37°C); annual rainfall 1300-2300 mm well distributed; below 600 m altitude; humidity 80-90%. Sensitive to prolonged drought and frost.",
    "season": "Perennial (60-80 yr life). Plant at onset of monsoon (May-June) in rainfed areas; Sept-Oct also suitable in assured-irrigation/well-drained areas.",
    "duration": "Tall varieties bear in 6-8 years, dwarfs/hybrids in 4-5 years; economic life 60+ years; nuts mature 11-12 months after pollination.",
    "seedRate": "70-75 seedlings per acre at 7.5 m x 7.5 m square (175 palms/ha). Use 9-12 month old quality seedlings with 6+ leaves and early splitting.",
    "spacing": "7.5 m x 7.5 m (square) for talls/hybrids; 7.5-9 m for high-density; triangular/single-hedge layouts also used. Pit size 1 m x 1 m x 1 m.",
    "sowingMethod": "Plant 9-12 month seedlings in pits filled with topsoil + 2 baskets compost/FYM + 1 kg neem cake; place ball above water table, keep collar at ground level. In laterite add 2 kg common salt per pit. Mulch basin and stake.",
    "varieties": [
      "West Coast Tall (WCT)",
      "East Coast Tall (ECT)",
      "Chowghat Orange Dwarf (COD)",
      "Kalpa Sankara (hybrid)",
      "Kera Sankara (hybrid)",
      "Chandra Sankara (hybrid)",
      "Kalpatharu",
      "Kalpa Pratibha"
    ],
    "nutrients": {
      "basal": "Per adult palm/year: 20-25 kg FYM/compost or green leaf; 1.3 kg urea, 2 kg SSP (or 1 kg rock phosphate) and 3.5 kg MOP. Apply in 2 splits (June-July & Sept-Oct) in basin 1.8 m radius, 10-15 cm deep. Add 0.5 kg ZnSO4 and borax if deficient; 1 kg MgSO4 for yellowing.",
      "topDress": [
        "First split with onset of SW monsoon (June-July): half N, full P, half K",
        "Second split post NE monsoon (Sept-Oct): remaining half N and half K",
        "Seedlings: 1/10th dose first year, increase yearly to full dose by 5th year",
        "Apply 50 kg green leaf/coir-pith compost per palm yearly to build moisture-holding"
      ]
    },
    "irrigation": "Critical in summer (Feb-May) and for young palms. Drip 25-40 L/palm/day (basin irrigation 200 L once in 4-7 days). Moisture-critical: establishment of seedlings, flowering and nut-set; water stress causes button shedding and immature nut fall. Coir-pith mulch and husk burial in basin conserve moisture.",
    "weed": "Keep 1.8 m basin weed-free by manual weeding/slashing. Grow cover crops (Pueraria, Calopogonium, Mimosa) or intercrops (banana, pineapple, cocoa, pepper on trunk) to smother weeds and add income. Glyphosate spot-spray for stubborn perennial grasses avoiding the trunk.",
    "pests": [
      {
        "name": "Rhinoceros beetle (Oryctes rhinoceros)",
        "symptom": "Adult bores into crown cutting unopened fronds giving V-shaped/fan cuts; damages spindle",
        "control": "Hook out beetles; fill leaf axils with neem cake+sand or place naphthalene balls; set up pheromone traps; treat breeding manure heaps with Metarhizium fungus"
      },
      {
        "name": "Red palm weevil (Rhynchophorus ferrugineus)",
        "symptom": "Wilting inner leaves, gnawing sound, oozing brown fluid and chewed fibre from holes in trunk; crown collapse",
        "control": "Avoid trunk injuries; plug holes and inject Imidacloprid/leaf-axil fill; install food-bait+pheromone traps; remove and burn dead palms"
      },
      {
        "name": "Coconut eriophyid mite (Aceria guerreronis)",
        "symptom": "Triangular pale-yellow patches under perianth, brown gummy patches, distorted undersized nuts and nut drop",
        "control": "Root-feed/spray neem oil 2% + garlic, or spray micronised wettable sulphur/Spiromesifen; maintain palm vigour with adequate K and irrigation"
      },
      {
        "name": "Black-headed caterpillar (Opisina arenosella)",
        "symptom": "Galleries of silk and frass on under-surface of leaflets; drying of fronds giving scorched look",
        "control": "Release parasitoids Goniozus/Bracon; remove affected fronds; spray Bacillus thuringiensis or need-based Malathion only on severe outbreaks"
      }
    ],
    "diseases": [
      {
        "name": "Bud rot (Phytophthora palmivora)",
        "symptom": "Yellowing and rotting of spindle leaf with foul smell; spindle pulls out easily; toppling of crown, mainly in monsoon",
        "control": "Remove rotten tissue and dress wound with Bordeaux paste; prophylactic 1% Bordeaux mixture in leaf axils before monsoon; drench crown with Mancozeb/Metalaxyl"
      },
      {
        "name": "Root (wilt) disease",
        "symptom": "Flaccidity and ribbing/flaccid drooping of leaflets, marginal necrosis, reduced yield; phytoplasma spread, severe in Kerala",
        "control": "No cure; use tolerant cultivars (Chandra Laksha, Kalparaksha), remove disease-advanced palms, balanced fertilisation and good drainage to extend life"
      },
      {
        "name": "Stem bleeding (Thielaviopsis paradoxa)",
        "symptom": "Reddish-brown liquid oozing from cracks on trunk, tissue decay underneath, gradual decline",
        "control": "Chisel out affected tissue, paint with Bordeaux paste/Tridemorph; improve drainage and avoid trunk injury; apply neem cake to roots"
      },
      {
        "name": "Leaf rot (complex fungi)",
        "symptom": "Rotting and blackening of distal portions of spindle/young leaves, often following root-wilt",
        "control": "Remove rotted portions, spray fungicide mixture (Hexaconazole/Mancozeb) on spindle 3 times a year; nutrition management"
      }
    ],
    "harvest": "Mature nuts harvested every 30-45 days (8-12 harvests/yr); maturity signs: dried brown husk, sloshing water on shake for seed nuts, 11-12 months age. Tender nuts for water at 6-7 months. Climbing or mechanical climbers/poles used. Yield: 60-120 nuts/palm/yr (good gardens 100-150); ~4,000-12,000 nuts/acre.",
    "yield": "Talls 60-80 nuts/palm/yr; hybrids/dwarfs 100-150 nuts/palm/yr. Copra ~1-1.5 quintal/acre potential; well-managed irrigated hybrid gardens give 8,000-12,000 nuts/acre.",
    "postHarvest": "De-husk and split nuts; sun-dry/kiln-dry kernel to copra (6% moisture, ~7 days sun-drying) for oil milling; tender nuts sold within 3-5 days. Store copra in moisture-proof bags to avoid aflatoxin. Husk retted for coir; shells for charcoal. VCO from fresh kernel fetches premium.",
    "marketTips": "No central MSP, but state procurement of copra at MSP via NAFED/Kerafed (milling & ball copra). Sell graded tender nuts directly to urban vendors for best margin. Value-add through VCO, neem-cake, coir, neera/coconut sugar and FPOs. Register with Coconut Development Board for subsidies and Neera tapping licence.",
    "dosDonts": [
      "Do plant certified disease-free seedlings with early leaf-splitting and 6+ leaves",
      "Do bury husk/coir-pith in basin and mulch to survive summer drought",
      "Do apply full recommended K (MOP) — coconut is a heavy potash feeder",
      "Don't let basins waterlog; ensure drainage to prevent bud rot and root wilt",
      "Don't leave dead/bleeding palms standing — they harbour red weevil and rhinoceros beetle"
    ]
  },
  "cashew": {
    "key": "cashew",
    "title": "Cashew",
    "emoji": "🌰",
    "about": "Cashew (Anacardium occidentale) is a hardy evergreen tree grown on ~11 lakh hectares across India's coastal and laterite belts — Maharashtra (Konkan), Goa, Karnataka, Kerala, Tamil Nadu, Andhra Pradesh, Odisha and the North-East. India is a leading producer, processor and exporter of cashew kernels and a major employer of rural women in processing.",
    "uses": "Raw cashew nut (RCN) for kernels; cashew apple for feni/juice/jam; Cashew Nut Shell Liquid (CNSL) for paints, brake linings and resins; kernel grades (W180-W320) for snacks and confectionery.",
    "soil": "Best on red sandy loam and well-drained laterite soils; tolerates poor, gravelly wasteland and coastal sands; pH 5.0-6.5. Avoid heavy clay, saline, alkaline and waterlogged soils.",
    "climate": "Tropical, 24-30°C optimum (tolerates up to 40°C); annual rainfall 800-2000 mm; needs a dry spell during flowering/fruiting (Nov-Mar). Up to 700 m altitude. Frost and heavy rain at flowering are harmful.",
    "season": "Perennial (30-40 yr life). Plant grafts at start of monsoon (June-July); July-Aug in heavy-rain Konkan/Goa. Flowering Nov-Feb, harvest Feb-May.",
    "duration": "Grafts bear from 3rd year, full bearing by 7-8 years; economic life 30-40 years; nuts mature ~2 months after flowering.",
    "seedRate": "70-75 grafts/acre at 7-8 m spacing (low density); high-density planting up to 200-250 grafts/acre at 4 m x 4 m with later thinning. Use soft-wood grafts of recommended clones.",
    "spacing": "7.5 m x 7.5 m or 8 m x 8 m normal; high-density 4 m x 4 m / 5 m x 5 m with progressive thinning. Pit 0.6 m x 0.6 m x 0.6 m (1 m in hard laterite).",
    "sowingMethod": "Plant 3-5 month soft-wood grafts in pits filled with topsoil + 10 kg FYM + 200 g rock phosphate + neem cake; keep graft union above soil, stake against wind, remove rootstock sprouts, and provide partial shade in first summer.",
    "varieties": [
      "Vengurla-4",
      "Vengurla-7",
      "Bhaskara",
      "Ullal-3",
      "VRI-3",
      "Dhana",
      "Kanaka",
      "BPP-8"
    ],
    "nutrients": {
      "basal": "Per adult tree/year: 10-15 kg FYM; 0.5 kg urea, 1.25 kg SSP and 0.5 kg MOP (i.e., ~500 g N, 125 g P2O5, 125 g K2O). Apply in 1.5 m radius basin, 10-15 cm deep. Apply ZnSO4/borax foliar if deficient.",
      "topDress": [
        "Split fertiliser in 2 doses — pre-monsoon (May-June) and post-monsoon (Sept-Oct) in rainfed gardens",
        "Young plants: 1/5th dose first year, step up yearly to full dose by 5th year",
        "Foliar spray of 2% urea + micronutrients at flushing improves nut set"
      ]
    },
    "irrigation": "Mostly rainfed. Where water available, life-saving/supplemental irrigation (200 L/tree once in 15 days) during flowering and nut development (Dec-Mar) raises yield 2-3 fold. Moisture-critical: panicle emergence, flowering and nut-filling. Mulch basins to conserve moisture; avoid irrigation during peak flowering rain to reduce tea-mosquito and dieback.",
    "weed": "Two ring-weedings per year (pre- and post-monsoon) of the basin. Slash inter-row growth; grow cover/legume crops or intercrop pineapple, pulses, tubers in early years. Spot-spray Glyphosate on hardy weeds avoiding foliage.",
    "pests": [
      {
        "name": "Tea mosquito bug (Helopeltis antonii)",
        "symptom": "Black necrotic lesions on tender shoots, panicles and young nuts; shoot dieback and blossom blight — the most damaging cashew pest",
        "control": "Three need-based sprays at flushing, flowering and fruit-set: Profenophos / Lambda-cyhalothrin / Imidacloprid in rotation; prune and burn affected shoots; avoid dense canopy"
      },
      {
        "name": "Cashew stem and root borer (Plocaederus ferrugineus)",
        "symptom": "Frass/gum extrusion at collar, yellowing and wilting of canopy, bark tunnelling; tree death if untreated",
        "control": "Inspect collar regularly; remove grubs mechanically, swab trunk base with Chlorpyriphos paste; apply neem cake; uproot and burn dead trees"
      },
      {
        "name": "Leaf and blossom webber (Lamida/Macalla spp.)",
        "symptom": "Webbed leaves and inflorescences with frass, drying of panicles",
        "control": "Prune and destroy webbed shoots; spray Quinalphos/Lambda-cyhalothrin at flushing/flowering"
      },
      {
        "name": "Thrips",
        "symptom": "Silvery curling and bronzing of leaves and panicle drying",
        "control": "Spray Imidacloprid or Spinosad at flushing; maintain tree vigour"
      }
    ],
    "diseases": [
      {
        "name": "Powdery mildew (Oidium anacardii)",
        "symptom": "White powdery growth on panicles and young nuts, blackening and shedding of flowers/nuts in cool humid weather",
        "control": "Dust wettable sulphur or spray Hexaconazole/Tridemorph at flowering; repeat at 15-day interval if humid"
      },
      {
        "name": "Dieback / pink disease (Corticium salmonicolor)",
        "symptom": "Pinkish encrustation on branches, drying back of twigs from tip",
        "control": "Prune affected branches 10 cm below symptom, paint cut ends and apply Bordeaux paste/Carbendazim"
      },
      {
        "name": "Anthracnose (Colletotrichum)",
        "symptom": "Water-soaked dark lesions on leaves, shoots and nuts during wet spells",
        "control": "Spray Mancozeb/Copper oxychloride; improve canopy aeration by pruning"
      },
      {
        "name": "Inflorescence blight",
        "symptom": "Browning and drying of flowering panicles reducing nut set",
        "control": "Prophylactic Mancozeb at panicle emergence; manage tea-mosquito which predisposes to blight"
      }
    ],
    "harvest": "Nuts ripen Feb-May; harvest when cashew apple turns yellow/red and nut falls naturally — collect fallen nuts (do not pluck immature). Separate nut from apple, sun-dry RCN to 8-9% moisture. Yield: 1.5-3 kg nut/tree (young) rising to 8-10 kg/tree in good clones; ~3-5 quintal RCN/acre.",
    "yield": "2.5-5 quintal raw nut/acre in well-managed grafted orchards (good clones with irrigation 6-8 q/acre); plus cashew apple ~10x nut weight for value-add.",
    "postHarvest": "Sun-dry RCN to 8-9% moisture and store in jute bags in a dry place (stores 6-12 months). Process via roasting/steaming, shelling, peeling and grading into white wholes (W180-W320), splits and pieces. Cashew apple processed within hours into feni/juice. CNSL extracted as by-product.",
    "marketTips": "No MSP; RCN sold to processors/cooperatives by grade and out-turn (kernel recovery). Kernel grade (W180 fetches highest) and moisture decide price. Value-add by on-farm processing and selling graded kernels directly; utilise cashew apple for feni/juice. Join FPOs; avail subsidies from Directorate of Cashew & Cocoa Development (DCCD).",
    "dosDonts": [
      "Do plant high-yielding soft-wood grafts of regional clones (e.g., Vengurla/Ullal/VRI series)",
      "Do give 3 protective sprays against tea-mosquito at flushing, flowering and fruit-set",
      "Do collect only naturally fallen mature nuts and dry to 8-9% moisture",
      "Don't plant in waterlogged or heavy clay soils — causes root rot and poor growth",
      "Don't pluck immature nuts or store damp RCN — lowers kernel recovery and invites mould"
    ]
  },
  "tea": {
    "key": "tea",
    "title": "Tea",
    "emoji": "🍃",
    "about": "Tea (Camellia sinensis) is an evergreen perennial shrub grown on ~6 lakh hectares, mainly Assam and West Bengal (Dooars/Terai) for CTC, and the Nilgiris, Munnar and Darjeeling for orthodox/speciality teas. India is the second-largest producer and a major exporter; tea is a key plantation employer in the North-East and South.",
    "uses": "Black (CTC and orthodox), green, white and speciality teas; tea extracts, instant tea, and value-added flavoured/herbal blends.",
    "soil": "Deep, well-drained, friable acidic soils rich in organic matter; pH 4.5-5.5 (acid-loving). Good aeration and 1 m+ rooting depth essential; intolerant of lime and waterlogging.",
    "climate": "Cool humid; 18-30°C optimum; well-distributed rainfall 1500-3000 mm with high humidity; altitude from plains (Assam) to 2000 m (Darjeeling/Nilgiris). Needs partial shade in plains; sensitive to drought and frost.",
    "season": "Perennial (60-100 yr bushes). Plant cuttings/seedlings in monsoon (June-Sept). Plucking season Mar-Nov in N. India (dormant winter); near year-round in S. India.",
    "duration": "Bushes brought into plucking by 3-4 years after planting; economic life 50-70 years; plucking rounds every 7-14 days during flush.",
    "seedRate": "About 4,500-5,500 plants/acre (10,000-15,000/ha) using single-node VP cuttings raised in nursery sleeves; clonal material preferred over seed.",
    "spacing": "Single hedge ~1.2 m x 0.75 m or double hedge for higher density; contour planting on slopes with terraces. Raise in poly-sleeve nursery for 9-12 months before field planting.",
    "sowingMethod": "Plant rooted VP (vegetatively propagated) clonal cuttings in pits along contour; provide temporary and permanent shade trees (Albizia/Derris); after establishment do formative pruning and frame-building, then bring to a plucking table.",
    "varieties": [
      "TV-1 to TV-30 (Tocklai clones, NE India)",
      "Tocklai Vegetative TV-23",
      "UPASI-9",
      "UPASI-17 (Athrey)",
      "TRF/B series",
      "Darjeeling China hybrids (AV-2, P-312)",
      "TTL-1",
      "CR-6017"
    ],
    "nutrients": {
      "basal": "Young tea: NPK 2:1:2 ratio. Mature plucking tea ~per acre/yr: ~50-60 kg N (110-130 kg urea), 12-15 kg P2O5 (75-95 kg SSP) and 50-60 kg K2O (85-100 kg MOP), split into 3-4 applications. Add ZnSO4 foliar (Zn deficiency common) and Magnesium (Kieserite) where yellowing occurs.",
      "topDress": [
        "Split N into 3-4 doses through the plucking season (Apr/May, Jun/Jul, Aug, Sep) to match flush",
        "Apply ZnSO4 foliar 0.5% twice a year for banjhi/leaf-size",
        "Apply MgSO4/dolomite-free Mg source for interveinal yellowing",
        "Maintain soil pH 4.5-5.5; avoid liming"
      ]
    },
    "irrigation": "Mostly rain-fed; sprinkler/drip irrigation in dry months (Feb-Apr in S. India, lean periods in plains) boosts early-season crop and survives drought. Moisture-critical: bud-break/first flush and post-pruning recovery. Mulching with prunings conserves moisture and adds organic matter; good drainage equally critical in monsoon.",
    "weed": "Critical in young tea before canopy closes. Slash/hand-weed; ground cover legumes (Mimosa invisa) suppress weeds and fix N. Selective herbicides (Glyphosate/Paraquat as directed) used in inter-rows with shielded spraying; avoid contact with tea foliage. Mulch with prunings.",
    "pests": [
      {
        "name": "Tea mosquito bug (Helopeltis theivora)",
        "symptom": "Brown necrotic spots on young leaves and shoots that dry and curl; major yield loss",
        "control": "Monitor and spray Thiamethoxam/Thiacloprid or neem-based; maintain shade and prune to break breeding; use approved plant protection codes for export MRLs"
      },
      {
        "name": "Red spider mite (Oligonychus coffeae)",
        "symptom": "Reddish bronzing along midrib and upper leaf surface in dry weather, leaf fall",
        "control": "Spray approved acaricide (Fenpyroximate/Propargite) or neem oil; conserve predatory mites; irrigate to reduce dry-weather build-up"
      },
      {
        "name": "Thrips (Scirtothrips dorsalis)",
        "symptom": "Silvery scarring and curling along leaf margins of tender shoots",
        "control": "Spray Spinosad/neem; maintain plucking rounds to remove infested flush"
      },
      {
        "name": "Looper / bunch caterpillar",
        "symptom": "Defoliation of maintenance and plucking leaves",
        "control": "Hand-pick in light cases; spray Bacillus thuringiensis or recommended insecticide; encourage parasitoids"
      }
    ],
    "diseases": [
      {
        "name": "Blister blight (Exobasidium vexans)",
        "symptom": "Translucent spots becoming convex blisters with white spore-bearing under-surface on young leaves; severe in monsoon, especially high ranges",
        "control": "Prophylactic sprays of Copper oxychloride alternated with Hexaconazole/Validamycin during wet season; adjust plucking rounds; ensure light penetration"
      },
      {
        "name": "Grey blight (Pestalotiopsis)",
        "symptom": "Grey concentric leaf spots with dark margins on maintenance foliage, often on weak bushes",
        "control": "Spray Copper fungicide/Carbendazim; improve bush vigour with balanced nutrition and good drainage"
      },
      {
        "name": "Black rot (Corticium)",
        "symptom": "Black thread-like fungal growth, leaf rotting in shaded humid sections",
        "control": "Open up canopy/regulate shade, improve aeration, spray copper fungicide"
      },
      {
        "name": "Root rots (Charcoal/Red root)",
        "symptom": "Wilting, yellowing and death of bushes in patches; rotten roots",
        "control": "Uproot and burn affected bushes, rest/sanitise patch, improve drainage and soil pH; replant after fallow with disease-free clones"
      }
    ],
    "harvest": "Plucking of two leaves and a bud at 7-14 day rounds during flush; fine plucking gives better quality. Pruning every 3-5 years to rejuvenate frame. Yield (made tea): 6-10 quintal/acre in good CTC estates (Assam 800-1200 kg/ha avg), lower for premium Darjeeling/orthodox where quality outweighs volume.",
    "yield": "Made tea 600-1000 kg/acre (1500-2500 kg/ha) for well-managed CTC; speciality/Darjeeling lower (300-500 kg/ha) but high value.",
    "postHarvest": "Process green leaf within hours: withering, then CTC (cut-tear-curl) or orthodox rolling, fermentation/oxidation, drying and sorting/grading into BOP, PD, Dust grades. Green tea is steamed/pan-fired (no fermentation). Store made tea airtight, moisture-free; sell through auctions or direct.",
    "marketTips": "No MSP; sold via Tea Board auctions (Guwahati, Kolkata, Coonoor) and private sales; price driven by grade, liquor quality and origin (Darjeeling/Assam/Nilgiri GI tags fetch premium). Small growers sell green leaf to Bought Leaf Factories — negotiate via SHG/FPO and use the Tea Board price-sharing formula. Value-add via packeted/branded and organic teas.",
    "dosDonts": [
      "Do keep soil acidic (pH 4.5-5.5) and never lime — tea is acid-loving",
      "Do maintain proper shade trees and good drainage to balance humidity and aeration",
      "Do practise fine plucking (two leaves + a bud) on 7-10 day rounds for quality and price",
      "Don't overuse pesticides — exceeding MRLs blocks export markets",
      "Don't neglect timely pruning and post-prune nutrition — leggy bushes lose yield"
    ]
  },
  "coffee": {
    "key": "coffee",
    "title": "Coffee",
    "emoji": "☕",
    "about": "Coffee (Coffea arabica and C. canephora/Robusta) is a shade-grown evergreen perennial on ~4.5 lakh hectares in the Western Ghats — Karnataka (Kodagu, Chikmagalur, Hassan) which dominates, Kerala (Wayanad) and Tamil Nadu (Nilgiris, Pulneys). Indian coffee is uniquely grown under two-tier shade and is largely export-oriented.",
    "uses": "Roasted and ground coffee, instant/soluble coffee, espresso blends; Robusta for blends and instant, Arabica for premium filter and speciality; cascara/by-products and chicory blends.",
    "soil": "Deep, well-drained, friable forest loam rich in humus; pH 6.0-6.5 (slightly acidic). Good organic matter and rooting depth; avoid heavy clay, shallow and waterlogged soils.",
    "climate": "Arabica: cool 15-25°C at 1000-1500 m; Robusta: warmer 20-30°C at 500-1000 m. Rainfall 1500-2500 mm with a distinct blossom shower (Feb-Mar) and backing shower. Needs shade; intolerant of frost and high temperatures.",
    "season": "Perennial (40-50 yr). Plant during monsoon (June-July). Blossom showers Feb-Mar trigger flowering; harvest Nov-Feb (Arabica) and Dec-Feb/Mar (Robusta).",
    "duration": "Bears from 3rd-4th year, full bearing by 6-7 years; economic life 40+ years; berries mature ~7-8 months (Arabica) to 9-11 months (Robusta) after flowering.",
    "seedRate": "Arabica ~1,300-1,800 plants/acre (1.8 m x 1.8 m); Robusta ~700-1,000 plants/acre (2.5-3 m spacing). Raise seedlings 12-15 months in nursery before field planting.",
    "spacing": "Arabica 1.8-2.1 m x 1.8-2.1 m; Robusta 2.5-3 m x 2.5-3 m. Plant under regulated two-tier shade (Dadap/Silver oak overstorey). Pit 45 x 45 x 45 cm.",
    "sowingMethod": "Plant 12-15 month nursery seedlings or clonal Robusta at pit (filled with topsoil + 10 kg FYM + 100 g rock phosphate) at onset of monsoon; provide shade, stake, mulch and handle/centre-prune (single/double stem) for frame building. Robusta needs cross-pollinating clones nearby.",
    "varieties": [
      "S.795 (Arabica)",
      "Sln.9 / Chandragiri (Arabica)",
      "Sln.6 / Cauvery (Catimor, Arabica)",
      "Sln.5B / San Ramon",
      "CxR (Robusta)",
      "Sln.1R / Peridenia (Robusta)",
      "Sln.3 (Robusta)",
      "BR-19 / Sln.274 (Robusta)"
    ],
    "nutrients": {
      "basal": "Per acre/yr (bearing Arabica): ~40-50 kg N, 30-40 kg P2O5, 40-50 kg K2O via Urea/SSP/MOP in 3-4 splits, plus 5-8 t FYM and 10-12 kg ZnSO4 foliar. Robusta needs slightly higher N and K. Apply within drip-circle, lightly forked in.",
      "topDress": [
        "Pre-blossom (Jan-Feb) dose to support flowering",
        "Post-blossom/backing shower (Apr-May) main dose for berry set",
        "Monsoon dose (Jun-Jul) and post-monsoon (Sep-Oct) for berry-fill and bush recovery",
        "Foliar ZnSO4 + lime + micronutrients 2-3 times/year for hot-and-cold/die-back"
      ]
    },
    "irrigation": "Largely rain-fed but blossom and backing showers are decisive. Where rains delay, sprinkler 'blossom irrigation' (Feb-Mar) is critical to trigger uniform flowering, followed by backing irrigation 2-3 weeks later for berry set. Moisture-critical: blossom, berry-set and bean expansion. Mulch and shade conserve moisture and reduce die-back.",
    "weed": "Two to three weedings/year in the drip circle; cover crops/leguminous ground cover in inter-rows reduce erosion on slopes. Mulch with shade-tree leaf litter and prunings. Selective herbicide (Glyphosate) spot-spray on hardy weeds avoiding the coffee bush.",
    "pests": [
      {
        "name": "White stem borer (Xylotrechus quadripes)",
        "symptom": "Grub tunnels in main stem of Arabica; ridges/swelling on bark, yellowing, wilting and death of bush — the most serious Arabica pest",
        "control": "Trace and uproot/burn infested bushes (Oct-Nov & Mar-Apr); scrub loose bark; maintain optimum shade; swab/spray Chlorpyriphos on main stem during egg-laying flights; pheromone traps"
      },
      {
        "name": "Coffee berry borer (Hypothenemus hampei)",
        "symptom": "Tiny hole at tip of berry, internal damage to beans, especially Robusta; reduces out-turn",
        "control": "Strict field sanitation — strip/collect all leftover berries; broca (red-cup) traps with alcohol-methanol lure; spray Spinosad/Chlorpyriphos at early infestation; timely harvest"
      },
      {
        "name": "Shot-hole borer (Robusta)",
        "symptom": "Tiny holes and tunnels in primaries/secondaries, twig die-back",
        "control": "Prune and burn affected wood, maintain bush vigour and shade; spray as advised on heavy infestation"
      },
      {
        "name": "Mealybugs / green scale",
        "symptom": "Honeydew, sooty mould, debilitated berries and shoots",
        "control": "Release/encourage natural enemies; spray Buprofezin/neem oil; manage ants that tend them"
      }
    ],
    "diseases": [
      {
        "name": "Coffee leaf rust (Hemileia vastatrix)",
        "symptom": "Orange-yellow powdery spore patches on under-surface of Arabica leaves, premature defoliation, dieback",
        "control": "Pre- and post-monsoon sprays of Bordeaux mixture 0.5%/Copper oxychloride or Hexaconazole; grow resistant selections (Sln.9 Chandragiri, Cauvery)"
      },
      {
        "name": "Black rot / koleroga (Pellicularia/Koleroga)",
        "symptom": "Black rotting of leaves and berries that stick together with fungal threads in heavy monsoon, especially in over-shaded blocks",
        "control": "Regulate shade for light/air, prune, and spray Bordeaux mixture before and during monsoon"
      },
      {
        "name": "Brown eye spot (Cercospora coffeicola)",
        "symptom": "Brown spots with grey centre and yellow halo on leaves and berries, common in stressed/under-nourished plants",
        "control": "Improve nutrition and shade, spray Copper oxychloride/Carbendazim; avoid moisture stress"
      },
      {
        "name": "Root diseases (Black/Brown root rot)",
        "symptom": "Wilting, yellowing and patch death of bushes; rotted roots with rhizomorphs",
        "control": "Uproot and burn affected bushes, isolate patch by trenching, improve drainage, replant after rest with healthy stock"
      }
    ],
    "harvest": "Selective hand-picking of ripe red cherries Nov-Feb (Arabica) and Dec-Mar (Robusta); avoid green/over-ripe. Process by dry (cherry/natural) or wet (washed parchment, premium) method. Yield: Arabica 3-5 quintal clean coffee/acre, Robusta 4-6 quintal/acre (clean) in well-managed estates.",
    "yield": "Clean coffee ~3-6 quintal/acre (Arabica 600-900 kg/ha, Robusta 1000-1500 kg/ha) in good estates; speciality washed Arabica lower volume, premium price.",
    "postHarvest": "Wet method: pulp ripe cherry, ferment, wash, dry parchment to 10-11% moisture for premium washed coffee; dry method: sun-dry whole cherry to ~11% for cherry coffee. Hull, grade and store in jute bags in dry godowns. Cup quality determined by careful processing and drying.",
    "marketTips": "No MSP; sold through curing works, exporters, and Coffee Board auctions/e-platform; price by Arabica/Robusta, parchment vs cherry, grade and cup quality. GI-tagged origins (Coorg, Chikmagalur, Wayanad, Araku, Monsooned Malabar) and speciality/organic lots fetch premiums. Register with Coffee Board, use FPOs and direct exports/roasting for value-add.",
    "dosDonts": [
      "Do maintain regulated two-tier shade — it controls temperature, rust and white-stem-borer",
      "Do give blossom and backing irrigation/showers for uniform flowering and berry set",
      "Do trace and destroy white-stem-borer affected Arabica bushes twice a year",
      "Don't pick green/unripe cherries — it ruins cup quality and price",
      "Don't leave leftover berries on bush/ground — they harbour berry borer for next season"
    ]
  },
  "blackpepper": {
    "key": "blackpepper",
    "title": "Black Pepper",
    "emoji": "⚫",
    "about": "Black pepper (Piper nigrum), the 'King of Spices', is a perennial climbing vine grown on ~1.3 lakh hectares mainly in Kerala, Karnataka and Tamil Nadu (Western Ghats), and increasingly in the North-East. India is a major producer and the world's spice trade leader; pepper is a key smallholder cash crop, often intercropped in coffee and arecanut gardens.",
    "uses": "Black pepper (dried mature green berries), white pepper (retted ripe berries), green pepper (brined/dehydrated), pepper oil and oleoresin for food, pharma and flavourings.",
    "soil": "Deep, well-drained virgin forest/laterite loam rich in humus; pH 5.5-6.5. Good drainage essential — pepper cannot tolerate waterlogging, which triggers root rot.",
    "climate": "Hot humid tropical; 20-30°C; rainfall 2000-3000 mm well distributed with a short dry spell; high humidity; up to 1500 m altitude with shade. Sensitive to drought, frost and water stagnation.",
    "season": "Perennial (20-30 yr). Plant rooted cuttings at start of monsoon (May-June). Spikes emerge May-June (with monsoon), berries mature Nov-Feb; harvest Dec-Mar.",
    "duration": "Begins bearing from 3rd year, full bearing by 7-8 years; economic life 20-30 years; berries mature ~6-8 months after spiking.",
    "seedRate": "About 450-550 standards/acre, each carrying a vine, at 3 m x 3 m on live/dead standards. Use 2-3 node rooted cuttings of runner/top shoots of elite vines.",
    "spacing": "3 m x 3 m on live standards (Erythrina/Dadap/Silver oak/Garuga) or dead standards; trail the vine and tie at each node as it climbs. Pit 50 x 50 x 50 cm on north side of standard.",
    "sowingMethod": "Plant 2-3 rooted cuttings per pit at base (north side) of an established live standard or coconut/arecanut trunk; fill pit with topsoil + 5 kg FYM + 0.5 kg neem cake + Trichoderma; tie growing vine to standard, regulate shade and provide drainage channel.",
    "varieties": [
      "Panniyur-1",
      "Panniyur-5",
      "Subhakara",
      "Sreekara",
      "Panchami",
      "Pournami",
      "IISR Thevam",
      "Karimunda (local elite)"
    ],
    "nutrients": {
      "basal": "Per adult vine/year: 10 kg FYM/compost; ~140 g urea (~50 g N), ~310 g SSP (~50 g P2O5) and ~250 g MOP (~150 g K2O), applied 30 cm away in 2 splits. Add 250 g lime/dolomite pre-monsoon to correct acidity; ZnSO4/MgSO4 foliar for deficiency.",
      "topDress": [
        "First split at onset of SW monsoon (May-June)",
        "Second split end of monsoon (Aug-Sept)",
        "Apply lime 250-500 g/vine before fertiliser in April-May to raise pH",
        "Young vines: 1/3rd dose first year, full dose by 3rd year; mulch basin heavily"
      ]
    },
    "irrigation": "Mostly rain-fed under monsoon. Summer irrigation (drip/pot) post-harvest (Mar-May) helps berry/runner development and survival. Moisture-critical: spike initiation/flowering (with monsoon onset) and berry development; but avoid water stagnation. Mulch the basin to conserve moisture and maintain even soil moisture; ensure surface drainage in monsoon.",
    "weed": "Slash/hand-weed the basin and surrounding area before each fertiliser application; mulch heavily with leaf litter to suppress weeds and conserve moisture. Avoid herbicide contact with vine roots; spot-spray only in inter-spaces.",
    "pests": [
      {
        "name": "Pollu beetle (Longitarsus nigripennis)",
        "symptom": "Adults and grubs feed on tender leaves and berries; berries turn hollow black 'pollu' (chaffy) and shed — major in shaded gardens",
        "control": "Regulate shade for light penetration; spray Quinalphos/Lambda-cyhalothrin at spike emergence and berry formation; neem-based sprays in IPM"
      },
      {
        "name": "Top shoot borer (Cydia hemidoxa)",
        "symptom": "Larva bores into tender terminal shoots which wilt and dry, checking vine growth especially in nurseries/young vines",
        "control": "Clip and destroy affected shoots; spray Quinalphos during new flush (monsoon); maintain vine vigour"
      },
      {
        "name": "Scale insects / mealybugs",
        "symptom": "Encrustations on stems and roots, debilitated vines, sooty mould",
        "control": "Prune and destroy infested parts; spray Dimethoate/neem oil; drench for root mealybug; control ants"
      },
      {
        "name": "Marginal gall thrips",
        "symptom": "Curling/galling of leaf margins, crinkled distorted leaves",
        "control": "Spray Dimethoate/Imidacloprid on new flush; remove and burn affected leaves"
      }
    ],
    "diseases": [
      {
        "name": "Foot rot / quick wilt (Phytophthora capsici)",
        "symptom": "Rapid yellowing, wilting and collapse of whole vine in monsoon; blackening of collar and feeder roots, black leaf lesions with fimbriate margin — the deadliest pepper disease",
        "control": "Ensure drainage; apply Trichoderma + neem cake to soil; drench and foliar-spray 1% Bordeaux mixture/Potassium phosphonate/Metalaxyl-Mancozeb before and during monsoon; remove and burn dead vines"
      },
      {
        "name": "Slow decline / slow wilt (nematode + Fusarium)",
        "symptom": "Gradual yellowing, defoliation, dieback and reduced spiking over seasons; root galls and rotting",
        "control": "Apply Pochonia/Trichoderma bio-agents and neem cake; soil application of Carbofuran where permitted; use healthy nematode-free planting material; improve nutrition and drainage"
      },
      {
        "name": "Anthracnose / pollu disease (Colletotrichum)",
        "symptom": "Brown angular leaf spots with chlorotic halo and cracked/dark berries",
        "control": "Spray Bordeaux mixture/Carbendazim; regulate shade and aeration"
      },
      {
        "name": "Stunt / phyllody (virus)",
        "symptom": "Stunted growth, small malformed leaves, poor spiking",
        "control": "Use virus-free cuttings, rogue out infected vines, control vector insects"
      }
    ],
    "harvest": "Harvest spikes when one or two berries turn red/orange (full maturity, Dec-Mar); for black pepper pick mature green berries. Thresh, blanch (dip 1 min hot water) and sun-dry 4-5 days to 10% moisture (berries turn black, wrinkled). Yield: dry pepper 1.5-3 q/acre (good gardens 4-5 q/acre); ~2-3 kg dry/vine.",
    "yield": "Dry black pepper 1.5-3 quintal/acre (well-managed irrigated Panniyur gardens up to 4-5 q/acre); white pepper recovery ~25% lower in weight but higher value.",
    "postHarvest": "Black pepper: blanch berries, sun-dry on clean mats/concrete to 10% moisture, garble (remove stalks/light berries) and grade by bulk density (Garbled/Ungarbled, MG-1). White pepper: ret ripe berries 7-10 days, remove skin, wash and dry. Store in moisture-proof gunny in dry godowns to avoid mould/aflatoxin.",
    "marketTips": "No MSP; sold via spice markets, Spices Board auctions and exporters; price by grade (bulk density g/L, Garbled MG-1 best), berry size and cleanliness. GI (Malabar/Wayanad pepper) and organic/clean lots fetch premiums. Value-add via white/green pepper, oil and oleoresin; register with Spices Board and sell through FPOs for better realisation.",
    "dosDonts": [
      "Do ensure perfect drainage — waterlogging causes lethal Phytophthora foot rot",
      "Do apply Trichoderma + neem cake and prophylactic Bordeaux/phosphonate before monsoon",
      "Do mulch basins and give summer irrigation post-harvest for good spiking",
      "Don't plant cuttings from foot-rot/slow-wilt affected vines — use certified healthy material",
      "Don't over-shade — dense shade promotes pollu beetle and poor berry set"
    ]
  },
  "castor": {
    "key": "castor",
    "title": "Castor",
    "emoji": "🌱",
    "about": "Castor (Ricinus communis) is a hardy, drought-tolerant oilseed grown on ~9 lakh hectares, with Gujarat dominating (Banaskantha, Mehsana) followed by Rajasthan, Andhra Pradesh and Telangana. India is the world's largest producer and exporter of castor oil, which is almost entirely industrial and export-oriented.",
    "uses": "Castor oil for lubricants, biodiesel, paints, cosmetics, soaps, pharmaceuticals (ricinoleic acid derivatives); castor cake as organic manure/nematicide; an important industrial non-edible oilseed.",
    "soil": "Well-drained red sandy loam to deep alluvial and medium black soils; pH 6.0-8.0. Tolerates marginal and slightly saline soils; avoid waterlogging and heavy ill-drained clays.",
    "climate": "Warm tropical/sub-tropical; 20-35°C (germination needs ~20°C+); rainfall 500-750 mm or under irrigation; needs warm dry weather at maturity. Drought-tolerant; frost-sensitive; below 1000 m.",
    "season": "Mainly Kharif/late-Kharif (sown June-Aug in Gujarat); also a Rabi crop in southern states under irrigation (Sept-Oct). Long-duration crop yielding over several pickings.",
    "duration": "150-210 days depending on hybrid/variety; primary spike matures ~90-120 days after sowing, with successive secondary/tertiary spikes picked over 2-4 months.",
    "seedRate": "Hybrids 2-3 kg/acre; varieties 4-5 kg/acre. Treat seed before sowing.",
    "spacing": "90 cm x 60 cm (rainfed) to 90 cm x 45 cm; wider 120 x 60 cm for long-duration hybrids under irrigation. Sow 1-2 seeds/hill 4-5 cm deep, thin to one.",
    "sowingMethod": "Dibble treated seed on ridges/flat at onset of monsoon or under irrigation; seed treatment with Carbendazim/Thiram 3 g/kg (wilt) + Imidacloprid for early sucking pests, and Azospirillum/PSB biofertiliser. Thin to one healthy plant per hill at 15-20 DAS.",
    "varieties": [
      "GCH-7 (hybrid)",
      "GCH-4",
      "GCH-5",
      "GCH-9",
      "DCH-519",
      "DCH-177",
      "Jwala (48-1)",
      "Kranti"
    ],
    "nutrients": {
      "basal": "Per acre: 4-6 t FYM; basal 16-20 kg N + 16 kg P2O5 + 8-10 kg K2O via ~35 kg DAP + 15 kg urea + 15 kg MOP at sowing; 8-10 kg ZnSO4 in deficient soils. Apply castor cake where available.",
      "topDress": [
        "First top-dress ~16-20 kg N (~35-40 kg urea) at 30-35 DAS (vegetative)",
        "Second top-dress ~16-20 kg N (~35-40 kg urea) at 55-60 DAS (primary spike initiation)",
        "Under irrigated long-duration hybrids, a third N dose after first picking sustains secondary spikes",
        "Foliar 2% urea/micronutrients if growth is poor"
      ]
    },
    "irrigation": "Rainfed in Kharif; under irrigation give 5-7 irrigations. Moisture-critical stages: primary spike initiation/flowering and capsule (seed) development on primary and secondary spikes — stress here cuts yield sharply. Avoid waterlogging; one irrigation after each major dry spell and at each spike's filling stage. Light irrigation post-sowing ensures stand.",
    "weed": "Critical first 45-60 days. Two hand-weedings/intercultivations at 20-25 and 40-45 DAS; pre-emergence Pendimethalin 1 L/acre at sowing controls early weeds. Earthing-up at second weeding supports the tall plant.",
    "pests": [
      {
        "name": "Castor semilooper (Achaea janata)",
        "symptom": "Voracious larvae defoliate plants, can skeletonise leaves rapidly during vegetative stage",
        "control": "Hand-pick/light traps in early stage; spray Quinalphos/Chlorantraniliprole or Bacillus thuringiensis at ETL; conserve natural enemies"
      },
      {
        "name": "Castor capsule borer / shoot & capsule borer (Conogethes/Dichocrocis)",
        "symptom": "Larva webs and bores into spikes and capsules, frass-filled galleries, hollow seeds and yield loss",
        "control": "Remove and destroy webbed spikes; spray Emamectin benzoate/Chlorantraniliprole at spike/capsule formation; pheromone monitoring"
      },
      {
        "name": "Castor whitefly / leafhopper",
        "symptom": "Yellowing, sooty mould (whitefly) and hopper-burn/marginal yellowing of leaves; vectors of disease",
        "control": "Seed treatment with Imidacloprid; need-based spray of Imidacloprid/Acetamiprid; yellow sticky traps"
      },
      {
        "name": "Castor butterfly (Ergolis merione) / hairy caterpillar",
        "symptom": "Defoliation by larvae",
        "control": "Hand-collect gregarious larvae early; spray Quinalphos if severe; encourage parasitoids"
      }
    ],
    "diseases": [
      {
        "name": "Castor wilt (Fusarium oxysporum f.sp. ricini)",
        "symptom": "Sudden yellowing, drooping and wilting of plants in patches; vascular browning of stem; major soil-borne disease",
        "control": "Grow resistant hybrids (GCH-7), seed treatment with Carbendazim + Trichoderma, crop rotation (avoid castor-after-castor), and soil application of Trichoderma + FYM"
      },
      {
        "name": "Grey mould / botrytis of spike (Botrytis ricini)",
        "symptom": "Greyish fungal rotting of inflorescence and capsules in humid/cloudy weather, capsule shedding",
        "control": "Spray Carbendazim/Mancozeb at spike emergence in cloudy weather; avoid dense planting; remove affected spikes"
      },
      {
        "name": "Cercospora / Alternaria leaf spot",
        "symptom": "Concentric brown spots on leaves, premature defoliation",
        "control": "Spray Mancozeb/Copper oxychloride; balanced nutrition for vigour"
      },
      {
        "name": "Seedling root rot / damping off",
        "symptom": "Rotting and collapse of seedlings, poor stand",
        "control": "Seed treatment with Thiram/Carbendazim + Trichoderma; ensure good drainage; avoid over-irrigation at germination"
      }
    ],
    "harvest": "Pick spikes when capsules turn from green to brown/dry and begin to dehisce; primary spike harvested ~90-120 DAS, then 2-3 more pickings of secondary/tertiary spikes at 25-30 day intervals. Dry spikes in sun, thresh and clean. Yield: rainfed 6-10 q/acre, irrigated hybrids 12-18 q/acre.",
    "yield": "Seed 6-10 quintal/acre rainfed; 12-18 quintal/acre under irrigated hybrids (GCH-7) with good management; oil content ~46-48%.",
    "postHarvest": "Sun-dry harvested spikes, thresh (manual/decorticator) to separate seed, winnow and dry seed to 8-9% moisture; store in dry gunny bags safe from moisture and rodents. Seed sold to oil mills for solvent/expeller extraction; castor cake used as manure/biopesticide.",
    "marketTips": "No central MSP, but castor is traded actively (futures on NCDEX, Deesa/Patan/Mehsana mandis in Gujarat are price benchmarks). Price tracks oil percentage, moisture and global castor-oil demand. Sell clean, well-dried seed; avoid distress sale at harvest glut. Value-add via FPO aggregation and linkage to castor-oil processors/exporters.",
    "dosDonts": [
      "Do treat seed with Carbendazim + Trichoderma and grow wilt-resistant hybrids like GCH-7",
      "Do split nitrogen to match vegetative and spike-initiation stages for multiple pickings",
      "Do ensure good drainage — castor is highly sensitive to waterlogging",
      "Don't grow castor continuously in the same field — rotate to break wilt build-up",
      "Don't delay picking dehiscing spikes — dry capsules shatter and shed seed, causing loss"
    ]
  },
};

const ALIASES = {
  paddy:'rice', 'basmatirice':'rice', 'hillrice':'rice', 'blackrice':'rice',
  btcotton:'cotton', chickpea:'gram', fingermillet:'ragi', pearlmillet:'bajra',
  sorghum:'jowar', seedpotato:'potato', greengram:'moong', pigeonpea:'tur', arhar:'tur',
  pepper:'blackpepper', assamtea:'tea', darjeelingtea:'tea',
};
function norm(name) {
  return String(name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '').trim();
}
export function getCropGuide(name) {
  const n = norm(name);
  if (!n) return null;
  if (CROP_GUIDE[n]) return CROP_GUIDE[n];
  if (ALIASES[n] && CROP_GUIDE[ALIASES[n]]) return CROP_GUIDE[ALIASES[n]];
  // last resort: startsWith match (e.g. "ricepokkali" -> rice)
  const hit = Object.keys(CROP_GUIDE).find((k) => n.startsWith(k) || k.startsWith(n));
  return hit ? CROP_GUIDE[hit] : null;
}
export default CROP_GUIDE;
