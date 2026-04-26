/**
 * Indian State-wise Farming Data
 * Covers all 28 states + key UTs.
 * Each state has: overview, farmingTypes, crops[], soilTypes, waterSources, climate
 */

// ── Crop detail helper ─────────────────────────────────────────────────────────
// Each crop: id, name, nameHi, icon, season, sowingMonth, harvestMonth, duration,
//            waterNeeded, idealTemp, soilType, description, stages[]
// stages[]: { name, nameHi, day, duration, tip }

function makeCrop(id, name, nameHi, icon, season, sow, harvest, dur, water, temp, soil, desc, stages) {
  return { id, name, nameHi, icon, season, sowingMonth: sow, harvestMonth: harvest, duration: dur, waterNeeded: water, idealTemp: temp, soilType: soil, description: desc, stages };
}

// ── Reusable stage sets ────────────────────────────────────────────────────────
const wheatStages = [
  { name: 'Land Preparation', nameHi: 'भूमि तैयारी', day: 0, duration: 5, tip: 'Deep plough and add compost before sowing.' },
  { name: 'Sowing', nameHi: 'बुवाई', day: 5, duration: 10, tip: 'Sow at 2–3 cm depth, 20 cm row spacing.' },
  { name: 'Germination', nameHi: 'अंकुरण', day: 15, duration: 10, tip: 'Maintain soil moisture for uniform germination.' },
  { name: 'Tillering', nameHi: 'टिलरिंग', day: 25, duration: 25, tip: 'Apply 1st dose of urea. First irrigation at 21 days.' },
  { name: 'Jointing', nameHi: 'जुड़ाव', day: 50, duration: 20, tip: 'Apply 2nd dose of urea + potash.' },
  { name: 'Heading', nameHi: 'सिर उठना', day: 70, duration: 20, tip: 'Watch for rust disease. Spray fungicide if needed.' },
  { name: 'Grain Filling', nameHi: 'अनाज भरना', day: 90, duration: 25, tip: 'Avoid water stress during this stage.' },
  { name: 'Maturity & Harvest', nameHi: 'पकाई और कटाई', day: 115, duration: 15, tip: 'Harvest when 90% grains turn golden.' },
];

const riceStages = [
  { name: 'Nursery Preparation', nameHi: 'नर्सरी तैयारी', day: 0, duration: 25, tip: 'Prepare nursery bed; soak seeds 24 hrs before sowing.' },
  { name: 'Transplanting', nameHi: 'रोपाई', day: 25, duration: 7, tip: 'Transplant 25-day seedlings; 2–3 seedlings per hill.' },
  { name: 'Vegetative Stage', nameHi: 'वनस्पति अवस्था', day: 32, duration: 30, tip: 'Keep 5 cm standing water. Apply nitrogen fertilizer.' },
  { name: 'Active Tillering', nameHi: 'सक्रिय कंशेरिंग', day: 62, duration: 20, tip: 'Weed control critical. Apply 2nd dose of N.' },
  { name: 'Panicle Initiation', nameHi: 'पैनिकल बनना', day: 82, duration: 15, tip: 'Maintain water level. Do not let field dry.' },
  { name: 'Heading/Flowering', nameHi: 'फूल आना', day: 97, duration: 10, tip: 'Avoid high winds/rain during flowering.' },
  { name: 'Grain Filling', nameHi: 'दाना भरना', day: 107, duration: 20, tip: 'Drain water 10 days before harvest.' },
  { name: 'Harvest', nameHi: 'कटाई', day: 127, duration: 10, tip: 'Harvest when 80% grains turn golden.' },
];

const cottonStages = [
  { name: 'Land Preparation', nameHi: 'भूमि तैयारी', day: 0, duration: 7, tip: 'Deep ploughing + FYM incorporation.' },
  { name: 'Sowing', nameHi: 'बुवाई', day: 7, duration: 7, tip: 'Sow Bt cotton seeds; spacing 90×60 cm.' },
  { name: 'Germination', nameHi: 'अंकुरण', day: 14, duration: 10, tip: 'Ensure soil moisture at 7–8 cm depth.' },
  { name: 'Seedling Growth', nameHi: 'पौध वृद्धि', day: 24, duration: 20, tip: 'Thin to one plant per hill. Apply basal fertilizer.' },
  { name: 'Square Formation', nameHi: 'कलियाँ', day: 44, duration: 20, tip: 'Monitor for bollworms; use pheromone traps.' },
  { name: 'Flowering', nameHi: 'फूल आना', day: 64, duration: 25, tip: 'Apply potash. Irrigate at 10-day intervals.' },
  { name: 'Boll Development', nameHi: 'टिंडे बनना', day: 89, duration: 40, tip: 'Protect from pink bollworm; continue monitoring.' },
  { name: 'Boll Opening & Harvest', nameHi: 'चुनाई', day: 129, duration: 60, tip: 'Pick cotton in 3–4 rounds as bolls open.' },
];

const teaStages = [
  { name: 'Nursery (Cutting)', nameHi: 'नर्सरी', day: 0, duration: 60, tip: 'Use single-node cuttings; maintain 70% shade.' },
  { name: 'Field Planting', nameHi: 'रोपण', day: 60, duration: 14, tip: 'Plant at 1.2m × 0.75m spacing; add lime if soil pH < 5.5.' },
  { name: 'Establishment', nameHi: 'स्थापना', day: 74, duration: 180, tip: 'Shade for 6 months; regular watering essential.' },
  { name: 'Formative Pruning', nameHi: 'आकार देना', day: 254, duration: 30, tip: 'Prune to 45 cm table height in year 1.' },
  { name: 'Plucking Starts', nameHi: 'तोड़ाई शुरू', day: 284, duration: 60, tip: 'First pluck 2 leaves + bud from 18 months onwards.' },
  { name: 'Continuous Plucking', nameHi: 'नियमित तोड़ाई', day: 344, duration: 60, tip: 'Pluck every 7–8 days during flush season.' },
];

const coconutStages = [
  { name: 'Nursery', nameHi: 'नर्सरी', day: 0, duration: 90, tip: 'Select heavy, well-filled nuts. Sow in nursery beds.' },
  { name: 'Field Planting', nameHi: 'रोपण', day: 90, duration: 10, tip: 'Pit size 1m × 1m × 1m; spacing 7.5m triangular.' },
  { name: 'Early Growth', nameHi: 'प्रारंभिक वृद्धि', day: 100, duration: 365, tip: 'Water twice a week; mulch with husk.' },
  { name: 'Vegetative Growth', nameHi: 'पत्ती वृद्धि', day: 465, duration: 730, tip: 'Apply NPK each year. Manage rhinoceros beetle.' },
  { name: 'Flower & Nut Set', nameHi: 'फूल और फल', day: 1825, duration: 365, tip: 'First bearing at ~5 years. Apply potash for nut filling.' },
  { name: 'Harvest', nameHi: 'तुड़ाई', day: 2190, duration: 30, tip: 'Harvest every 45 days; mature nuts in 12 months.' },
];

const fisheryStages = [
  { name: 'Pond Preparation', nameHi: 'तालाब तैयारी', day: 0, duration: 15, tip: 'Drain, dry, lime treatment (250 kg/ha). Refill.' },
  { name: 'Stocking Fingerlings', nameHi: 'मत्स्य बीज', day: 15, duration: 3, tip: 'Stock 5,000–8,000 fingerlings/ha; mixed species.' },
  { name: 'Feeding Phase 1', nameHi: 'आहार चरण 1', day: 18, duration: 60, tip: 'Feed 3% of body weight; rice bran + oilcake mixture.' },
  { name: 'Feeding Phase 2', nameHi: 'आहार चरण 2', day: 78, duration: 90, tip: 'Reduce feeding to 2% body weight; monitor O2 levels.' },
  { name: 'Growth Monitoring', nameHi: 'वृद्धि जाँच', day: 168, duration: 90, tip: 'Monthly sampling; adjust feed. Change 25% water monthly.' },
  { name: 'Harvest', nameHi: 'मछली पकड़ना', day: 258, duration: 10, tip: 'Partial harvest at 6 months; full harvest at 9–12 months.' },
];

const rubberStages = [
  { name: 'Nursery', nameHi: 'नर्सरी', day: 0, duration: 60, tip: 'Bud-grafted stumps give best results.' },
  { name: 'Planting', nameHi: 'रोपण', day: 60, duration: 10, tip: 'Space at 5m × 5m (400 trees/ha). Plant at onset of monsoon.' },
  { name: 'Immature Phase', nameHi: 'अपरिपक्व', day: 70, duration: 2190, tip: 'Apply fertilizer quarterly. Manage white root disease.' },
  { name: 'Tapping Starts', nameHi: 'टैपिंग शुरू', day: 2260, duration: 60, tip: 'First tapping at 5–6 years; girth ≥ 50 cm at 1m height.' },
  { name: 'Regular Tapping', nameHi: 'नियमित टैपिंग', day: 2320, duration: 90, tip: 'Tap alternate days (S/2 d2); use Ethrel stimulant.' },
];

const coffeeStages = [
  { name: 'Nursery', nameHi: 'नर्सरी', day: 0, duration: 90, tip: 'Shade 75%, water twice daily. Use selected seeds.' },
  { name: 'Planting', nameHi: 'रोपण', day: 90, duration: 14, tip: 'Pit 45×45×45 cm; shade trees essential.' },
  { name: 'Establishment', nameHi: 'स्थापना', day: 104, duration: 365, tip: 'Water twice a week; add mulch to retain moisture.' },
  { name: 'Growth & Training', nameHi: 'प्रशिक्षण', day: 469, duration: 730, tip: 'Prune to central leader; apply 110-75-75 NPK/ha/yr.' },
  { name: 'First Harvest', nameHi: 'पहली फसल', day: 1199, duration: 60, tip: 'Hand-pick ripe red cherries; pulping within 12 hrs.' },
];

// ── Main State Data ────────────────────────────────────────────────────────────
export const STATE_CROPS = {

  Maharashtra: {
    nameHi: 'महाराष्ट्र',
    icon: '🌾',
    climate: 'Semi-arid to Tropical',
    specialty: 'Cotton, Sugarcane, Soybean, Onion, Grapes',
    soilTypes: ['Black cotton soil (Regur)', 'Red laterite soil', 'Alluvial soil'],
    waterSources: ['Godavari', 'Krishna', 'Bhima', 'Irrigation canals (Nashik, Pune)'],
    farmingTypes: [
      { id: 'rain', label: 'Rain-fed Farming', icon: '🌧️', color: '#1565C0' },
      { id: 'irr',  label: 'Irrigated Farming', icon: '💧', color: '#0277BD' },
      { id: 'hort', label: 'Horticulture',       icon: '🍇', color: '#6A1B9A' },
      { id: 'sug',  label: 'Sugar Cooperative',  icon: '🎋', color: '#2E7D32' },
    ],
    crops: [
      makeCrop('cotton_mh','Cotton','कपास','🌸','Kharif','May–Jun','Oct–Jan','180–200 days','Medium (4–6 irrigations)','21–35°C','Black soil (Regur)','Major cash crop of Maharashtra. Bt cotton is widely grown in Vidarbha and Marathwada.',cottonStages),
      makeCrop('sugarcane_mh','Sugarcane','गन्ना','🎋','Perennial','Jan–Mar','Oct–Jan (18 months)','12–18 months','High (25–30 irrigations)','21–35°C','Deep black/red soil','Maharashtra is India\'s top sugar producer. Kolhapur & Ahmednagar are key districts.',[ { name:'Land Preparation', nameHi:'भूमि तैयारी', day:0, duration:10, tip:'Sub-soiling + FYM 25 t/ha.' },{ name:'Planting', nameHi:'रोपण', day:10, duration:7, tip:'Trench planting; use 3-bud setts at 75cm spacing.' },{ name:'Germination', nameHi:'अंकुरण', day:17, duration:20, tip:'Keep soil moist; fill gaps by 25th day.' },{ name:'Grand Growth', nameHi:'तेज वृद्धि', day:37, duration:150, tip:'Apply full NPK dose; irrigate every 10 days.' },{ name:'Maturity', nameHi:'पकाव', day:187, duration:60, tip:'Stop irrigation 4 weeks before harvest. Test Brix.' },{ name:'Harvest', nameHi:'कटाई', day:247, duration:20, tip:'Harvest at 10–14 Brix. Crush within 24 hrs.' }]),
      makeCrop('soybean_mh','Soybean','सोयाबीन','🫘','Kharif','Jun–Jul','Sep–Oct','95–105 days','Low (2–3 irrigations)','20–30°C','Black/loamy soil','Vidarbha & Marathwada are soybean belts. Excellent nitrogen fixer.',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:7, tip:'Seed treatment with Rhizobium culture; 30 kg seed/ha.' },{ name:'Germination', nameHi:'अंकुरण', day:7, duration:7, tip:'Maintain soil crust-free for germination.' },{ name:'Vegetative', nameHi:'वनस्पति', day:14, duration:30, tip:'Inter-cultivation at 20 & 35 days; apply phosphorus.' },{ name:'Flowering', nameHi:'फूल', day:44, duration:15, tip:'Avoid drought stress; no irrigation if rain ≥ 50mm/week.' },{ name:'Pod Fill', nameHi:'फली भरना', day:59, duration:25, tip:'Critical irrigation if dry. Watch for pod borer.' },{ name:'Maturity', nameHi:'पकाव', day:84, duration:15, tip:'Harvest when 95% pods turn brown.' }]),
      makeCrop('onion_mh','Onion','प्याज','🧅','Rabi','Oct–Nov','Feb–Apr','130–150 days','Moderate (8–10 irrigations)','13–24°C','Sandy loam / medium black','Nashik district supplies 40% of India\'s onion. Rabi onion has longer shelf life.',[ { name:'Nursery', nameHi:'नर्सरी', day:0, duration:40, tip:'Raised bed nursery; 10 kg seed/ha.' },{ name:'Transplanting', nameHi:'रोपाई', day:40, duration:7, tip:'Transplant 6-week seedlings; 15×10 cm spacing.' },{ name:'Bulb Initiation', nameHi:'गाँठ', day:47, duration:30, tip:'Reduce N, increase K. Stop excess irrigation.' },{ name:'Bulb Enlargement', nameHi:'वृद्धि', day:77, duration:40, tip:'Maintain even moisture. Apply calcium nitrate.' },{ name:'Maturity', nameHi:'पकाव', day:117, duration:20, tip:'Stop irrigation 10 days before harvest. Tops fall over.' },{ name:'Harvest & Curing', nameHi:'कटाई', day:137, duration:10, tip:'Cure 7–10 days in shade before storage.' }]),
      makeCrop('grapes_mh','Grapes','अंगूर','🍇','Perennial','Jul–Aug (pruning)','Jan–Feb','60–70 days from pruning','High (drip irrigation)','15–40°C','Loamy / well-drained','Nashik is India\'s wine capital. Thompson Seedless is the main variety.',[ { name:'Pruning', nameHi:'छंटाई', day:0, duration:5, tip:'Cane pruning in July; 8–10 buds/cane.' },{ name:'Bud Break', nameHi:'कली फूटना', day:5, duration:10, tip:'Apply Ethephon to break dormancy uniformly.' },{ name:'Shoot Growth', nameHi:'प्ररोह', day:15, duration:20, tip:'Training on bower system; apply N+K fertigation.' },{ name:'Flowering', nameHi:'फूल', day:35, duration:10, tip:'Apply borax + zinc at 10% flowering.' },{ name:'Berry Development', nameHi:'दाना बनना', day:45, duration:30, tip:'Apply gibberellic acid for berry size; manage downy mildew.' },{ name:'Harvest', nameHi:'तुड़ाई', day:75, duration:10, tip:'Harvest bunches with scissors; grade by colour/weight.' }]),
      makeCrop('turmeric_mh','Turmeric','हल्दी','💛','Kharif','May–Jun','Jan–Mar','8–9 months','Moderate (7–8 irrigations)','20–30°C','Sandy loam / red loam','Sangli district is India\'s turmeric hub. Used in medicine and cooking.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'Deep plough; add FYM 40 t/ha.' },{ name:'Planting', nameHi:'रोपण', day:7, duration:7, tip:'Use mother/finger rhizomes; 45×25 cm spacing.' },{ name:'Sprouting', nameHi:'अंकुरण', day:14, duration:20, tip:'Mulch with paddy straw to conserve moisture.' },{ name:'Vegetative Growth', nameHi:'वृद्धि', day:34, duration:120, tip:'Earth up twice; apply NPK at 60 days.' },{ name:'Rhizome Development', nameHi:'प्रकंद', day:154, duration:90, tip:'Do not over-irrigate; watch for rhizome rot.' },{ name:'Harvest', nameHi:'कटाई', day:244, duration:14, tip:'Harvest when leaves turn yellow-brown. Boil and dry rhizomes.' }]),
    ],
  },

  Punjab: {
    nameHi: 'पंजाब',
    icon: '🌾',
    climate: 'Semi-arid continental',
    specialty: 'Wheat, Rice — "Granary of India"',
    soilTypes: ['Alluvial (Indo-Gangetic plains)', 'Sandy loam'],
    waterSources: ['Sutlej', 'Beas', 'Ravi rivers', 'Canal network (Bhakra-Nangal)', 'Tube wells'],
    farmingTypes: [
      { id: 'wheat', label: 'Wheat-Rice Rotation', icon: '🌾', color: '#E65100' },
      { id: 'irr',   label: 'Intensive Irrigation', icon: '💧', color: '#0277BD' },
      { id: 'dairy', label: 'Dairy Farming',         icon: '🐄', color: '#6D4C41' },
      { id: 'veg',   label: 'Vegetable Farming',     icon: '🥕', color: '#388E3C' },
    ],
    crops: [
      makeCrop('wheat_pb','Wheat','गेहूँ','🌾','Rabi','Nov 1–15','Apr','120–140 days','5–6 irrigations','15–22°C','Alluvial loamy soil','Punjab produces ~17% of India\'s wheat. HD-2967, PBW-550 are popular varieties.',wheatStages),
      makeCrop('rice_pb','Rice (Paddy)','धान','🌾','Kharif','Jun–Jul (transplant)','Oct–Nov','105–125 days','Abundant (25–30 irrigations)','22–32°C','Alluvial clay loam','Basmati rice from Punjab commands premium export price. PR-126 is popular.',riceStages),
      makeCrop('maize_pb','Maize','मक्का','Kharif/Rabi','Jun–Jul','Sep','90–110 days','4–5 irrigations','21–27°C','Well-drained loamy','🌽','Growing as alternative to rice to conserve water in Punjab.',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:5, tip:'75×25 cm spacing; 20 kg seed/ha.' },{ name:'Germination', nameHi:'अंकुरण', day:5, duration:8, tip:'Maintain soil moisture.' },{ name:'Knee-High Stage', nameHi:'घुटने तक', day:13, duration:20, tip:'Thin to one plant; apply nitrogen.' },{ name:'Tasseling', nameHi:'झाड़ू', day:33, duration:15, tip:'Critical for pollination; irrigate if dry.' },{ name:'Silking/Grain Fill', nameHi:'दाना भरना', day:48, duration:30, tip:'Apply 3rd dose urea. Watch for stem borer.' },{ name:'Harvest', nameHi:'कटाई', day:78, duration:15, tip:'Harvest at 30% moisture for machine; 20% for hand.' }]),
      makeCrop('potato_pb','Potato','आलू','🥔','Rabi','Oct–Nov','Jan–Feb','90–100 days','6–7 irrigations','15–25°C','Sandy loam','Punjab grows quality seed potatoes. Kufri Jyoti is the main variety.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'Ridges 60 cm apart; apply FYM 25 t/ha.' },{ name:'Planting', nameHi:'रोपण', day:7, duration:5, tip:'Whole/cut tubers; 45-day chitted seed preferred.' },{ name:'Sprouting', nameHi:'अंकुरण', day:12, duration:10, tip:'Light irrigation after planting.' },{ name:'Vegetative', nameHi:'वनस्पति', day:22, duration:30, tip:'Earth up at 30 days; apply N+P+K.' },{ name:'Tuber Bulking', nameHi:'कंद भरना', day:52, duration:30, tip:'Avoid drought; control late blight with mancozeb.' },{ name:'Harvest', nameHi:'कटाई', day:82, duration:10, tip:'Kill haulm 10 days before harvest for skin set.' }]),
    ],
  },

  UttarPradesh: {
    nameHi: 'उत्तर प्रदेश',
    icon: '🌿',
    climate: 'Subtropical humid',
    specialty: 'Sugarcane, Wheat, Rice, Potato',
    soilTypes: ['Alluvial (Ganga-Yamuna doab)', 'Loamy'],
    waterSources: ['Ganga', 'Yamuna', 'Gomti', 'Ghaghra', 'Eastern & Western canals'],
    farmingTypes: [
      { id: 'sug',   label: 'Sugarcane Belt',    icon: '🎋', color: '#2E7D32' },
      { id: 'wheat', label: 'Wheat-Rice',         icon: '🌾', color: '#E65100' },
      { id: 'pot',   label: 'Potato Cluster',     icon: '🥔', color: '#6D4C41' },
      { id: 'mango', label: 'Mango Orchards',     icon: '🥭', color: '#F57F17' },
    ],
    crops: [
      makeCrop('sugarcane_up','Sugarcane','गन्ना','🎋','Perennial','Feb–Mar','Oct–Nov','10–12 months','High','20–35°C','Alluvial loam','UP produces ~40% of India\'s sugar. Muzaffarnagar, Meerut are major districts.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:10, tip:'Sub-soiling; apply 25 t/ha FYM.' },{ name:'Planting', nameHi:'बोआई', day:10, duration:7, tip:'3-bud setts in furrows 90 cm apart; plant Feb-Mar.' },{ name:'Germination', nameHi:'अंकुरण', day:17, duration:20, tip:'Keep moist. Spray pre-emergence herbicide.' },{ name:'Grand Growth', nameHi:'तेज वृद्धि', day:37, duration:150, tip:'Earth up at 90 & 150 days; apply K at heading.' },{ name:'Maturity', nameHi:'परिपक्वता', day:187, duration:60, tip:'Stop irrigation 4 weeks before harvest.' },{ name:'Harvest', nameHi:'कटाई', day:247, duration:30, tip:'Harvest Oct-Nov for high sucrose content.' }]),
      makeCrop('wheat_up','Wheat','गेहूँ','🌾','Rabi','Nov 10–25','Apr','125–140 days','5–6 irrigations','15–22°C','Alluvial loamy','GW-322, K-9107, and HD varieties are popular.',wheatStages),
      makeCrop('rice_up','Rice','धान','🌾','Kharif','Jun–Jul','Oct','105–135 days','High','25–35°C','Alluvial clay','Eastern UP grows basmati in Hardoi, Lakhimpur districts.',riceStages),
      makeCrop('mango_up','Mango','आम','🥭','Perennial','Jan–Feb (grafts)','Jun–Jul','3–4 yrs to bear','Low after establishment','24–35°C','Deep loamy / red laterite','Lucknow-Malihabad is the \'Mango capital\'; Dasheri, Langra, Chausa varieties.',[ { name:'Planting', nameHi:'रोपण', day:0, duration:5, tip:'10m × 10m spacing; pit 1m³ with FYM.' },{ name:'Establishment', nameHi:'स्थापना', day:5, duration:365, tip:'Water twice a week; stake young plants.' },{ name:'Vegetative Growth', nameHi:'वृद्धि', day:370, duration:730, tip:'Apply NPK annually; pruning for canopy structure.' },{ name:'Flowering', nameHi:'मंजर', day:1100, duration:30, tip:'Spray NAA to reduce alternate bearing. Control mango hopper.' },{ name:'Fruit Setting', nameHi:'फल', day:1130, duration:60, tip:'Thin weak fruits; apply 2% KNO₃ to improve size.' },{ name:'Harvest', nameHi:'तुड़ाई', day:1190, duration:30, tip:'Harvest with 2-cm stalk; handle gently to avoid sap burn.' }]),
    ],
  },

  Kerala: {
    nameHi: 'केरल',
    icon: '🌴',
    climate: 'Tropical monsoon (high rainfall)',
    specialty: 'Rice, Coconut, Rubber, Tea, Pepper, Fishery',
    soilTypes: ['Laterite soil', 'Alluvial (Kuttanad)', 'Red soil', 'Coastal sandy'],
    waterSources: ['Arabian Sea coast', 'Backwaters (Vembanad, Ashtamudi)', 'Periyar', 'Pamba', 'Chalakudy rivers'],
    farmingTypes: [
      { id: 'fish',  label: 'Marine Fishery',     icon: '🐟', color: '#0277BD' },
      { id: 'aqua',  label: 'Aquaculture',         icon: '🦐', color: '#00695C' },
      { id: 'plant', label: 'Plantation Farming',  icon: '🌿', color: '#2E7D32' },
      { id: 'spice', label: 'Spice Cultivation',   icon: '🌶️', color: '#B71C1C' },
      { id: 'rice',  label: 'Paddy (Kuttanad)',    icon: '🌾', color: '#F57F17' },
    ],
    crops: [
      makeCrop('fish_kl','Marine Fishery','समुद्री मत्स्य पालन','🐟','Year-round','Year-round','Year-round','Annual','Arabian Sea','Tropical coastal','Coastal zone','Kerala accounts for 8% of India\'s fish production. Sardines, mackerel, tuna are key catch.',fisheryStages),
      makeCrop('coconut_kl','Coconut','नारियल','🥥','Perennial','Any (June preferred)','Year-round (12 months/nut)','5–6 years to bear','Moderate (drip in dry areas)','27°C average','Sandy loam / laterite','Kerala = \'Land of Coconuts\'. Over 90% of India\'s coir comes from here.',coconutStages),
      makeCrop('rubber_kl','Rubber','रबर','🌿','Perennial','May–Jun','Year-round (latex tapping)','5–6 years','Moderate','25–28°C','Laterite / red loam','Kerala produces 90% of India\'s rubber. Kottayam, Idukki are key districts.',rubberStages),
      makeCrop('tea_kl','Tea','चाय','🍵','Perennial','May–Jun','Year-round','18 months to first flush','High humidity','15–25°C','Loamy acidic (pH 5.5–6)','Munnar tea gardens at 1600m altitude produce high-quality orthodox tea.',teaStages),
      makeCrop('pepper_kl','Black Pepper','काली मिर्च','🌶️','Kharif','May–Jun (vine)','Nov–Jan','3 years to bear','Moderate','23–32°C','Loamy / laterite with support trees','Kerala produces 95% of India\'s black pepper. Wayanad, Idukki are major zones.',[ { name:'Nursery', nameHi:'नर्सरी', day:0, duration:60, tip:'Runner shoots rooted in polythene bags under shade.' },{ name:'Planting', nameHi:'रोपण', day:60, duration:7, tip:'Plant near standard (Erythrina) at 3m spacing; June monsoon.' },{ name:'Training', nameHi:'लताड़ना', day:67, duration:365, tip:'Tie runners to standard; remove competing branches.' },{ name:'Bearing', nameHi:'फल देना', day:432, duration:30, tip:'Apply NPK 50:50:150 g/vine/year.' },{ name:'Harvest', nameHi:'तुड़ाई', day:462, duration:30, tip:'Harvest when 1–2 berries/spike turn red. Dry in sun 5 days.' }]),
      makeCrop('rice_kl','Rice (Pokkali)','चावल','🌾','Kharif/Rabi','Jun (Kharif), Nov (Rabi)','Sep, Feb','90–110 days','Flood/tidal','25–35°C','Alluvial / coastal clay','Kuttanad is below sea-level paddy farming — unique in the world.',riceStages),
      makeCrop('cashew_kl','Cashew','काजू','🥜','Kharif','Oct–Nov (planting)','Feb–May','3 yrs to bear','Low','24–28°C','Laterite / sandy loam','Kollam district is the cashew processing hub of India.',[ { name:'Planting', nameHi:'रोपण', day:0, duration:7, tip:'Air-layered plants; 7m × 7m spacing.' },{ name:'Establishment', nameHi:'स्थापना', day:7, duration:365, tip:'Shade for 3 months; water twice a week.' },{ name:'Vegetative', nameHi:'वृद्धि', day:372, duration:730, tip:'Apply NPK 500-125-125 g/tree/year.' },{ name:'Flowering', nameHi:'फूल', day:1102, duration:30, tip:'Spray 1% KNO₃ at panicle emergence.' },{ name:'Nut Development', nameHi:'फल', day:1132, duration:60, tip:'Protect from stem borer; harvest when nut turns grey.' },{ name:'Harvest', nameHi:'तुड़ाई', day:1192, duration:30, tip:'Collect fallen nuts daily; dry 2 days before storage.' }]),
    ],
  },

  Karnataka: {
    nameHi: 'कर्नाटक',
    icon: '☕',
    climate: 'Tropical to semi-arid',
    specialty: 'Coffee, Ragi, Sugarcane, Silk, Cotton',
    soilTypes: ['Red loamy soil', 'Black cotton soil', 'Laterite', 'Alluvial'],
    waterSources: ['Krishna', 'Cauvery', 'Tungabhadra', 'Western Ghats rivers'],
    farmingTypes: [
      { id: 'coffee', label: 'Coffee Plantation', icon: '☕', color: '#4E342E' },
      { id: 'silk',   label: 'Sericulture (Silk)',  icon: '🐛', color: '#7B1FA2' },
      { id: 'hort',   label: 'Horticulture',        icon: '🌻', color: '#F57F17' },
      { id: 'rain',   label: 'Dry-land Farming',    icon: '🌿', color: '#388E3C' },
    ],
    crops: [
      makeCrop('coffee_ka','Coffee','कॉफ़ी','☕','Perennial','May–Jun','Nov–Jan','3–4 years to bear','Moderate','15–28°C','Laterite / red loam acidic','Coorg (Kodagu) & Chikmagalur produce 70% of India\'s coffee. Arabica & Robusta.',coffeeStages),
      makeCrop('ragi_ka','Ragi (Finger Millet)','रागी','🌾','Kharif','Jun–Jul','Oct–Nov','100–120 days','Low (rain-fed)','20–30°C','Red sandy loam','Karnataka produces 58% of India\'s ragi. Rich in calcium. Drought-tolerant.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:5, tip:'Fine tilth; add FYM 5 t/ha.' },{ name:'Sowing', nameHi:'बुवाई', day:5, duration:5, tip:'Broadcasting or transplanting; 5 kg seed/ha (transplant).' },{ name:'Germination', nameHi:'अंकुरण', day:10, duration:10, tip:'Ensure even moisture for uniform germination.' },{ name:'Tillering', nameHi:'कंशेरिंग', day:20, duration:30, tip:'Weed at 20 days; apply 50 kg urea/ha.' },{ name:'Ear Emergence', nameHi:'बाली', day:50, duration:20, tip:'Apply 25 kg urea/ha at earhead emergence.' },{ name:'Harvest', nameHi:'कटाई', day:70, duration:15, tip:'Harvest when earheads turn brown. Thresh to separate grain.' }]),
      makeCrop('sugarcane_ka','Sugarcane','गन्ना','🎋','Perennial','Jan–Mar','Oct–Dec','12 months','High','21–30°C','Black / alluvial','Mandya, Belgaum are major sugarcane districts. Cooperative mills prevalent.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'Sub-soil 45 cm; FYM 25 t/ha.' },{ name:'Planting', nameHi:'रोपण', day:7, duration:7, tip:'3-bud setts; 90 cm row spacing.' },{ name:'Germination', nameHi:'अंकुरण', day:14, duration:20, tip:'Keep moist. Fill gaps at 25 days.' },{ name:'Tillering', nameHi:'कंशेरिंग', day:34, duration:60, tip:'Earth up; apply N+P+K.' },{ name:'Grand Growth', nameHi:'तेज वृद्धि', day:94, duration:120, tip:'Irrigate 10-day intervals; apply potash.' },{ name:'Maturity & Harvest', nameHi:'कटाई', day:214, duration:30, tip:'Test juice Brix ≥ 18 before harvest.' }]),
      makeCrop('silk_ka','Mulberry (Sericulture)','रेशम','🐛','Year-round','Year-round','3 crops/year','Moderate','25–28°C','Loamy (mulberry)','Karnataka produces 80% of India\'s silk. Ramanagara is the silk city.',[ { name:'Mulberry Planting', nameHi:'शहतूत रोपण', day:0, duration:14, tip:'V1 mulberry; 90×90 cm spacing.' },{ name:'Leaf Harvest', nameHi:'पत्ती तोड़ना', day:14, duration:45, tip:'Start harvesting at 45 days; every 45-day cycle.' },{ name:'Silkworm Rearing', nameHi:'रेशमकीट', day:59, duration:28, tip:'Young worms: 1-2 instar on chopped leaves.' },{ name:'Late Age Rearing', nameHi:'पालन', day:87, duration:10, tip:'Mature worms eat whole leaves; 30 kg/box.' },{ name:'Cocooning', nameHi:'कोकून', day:97, duration:5, tip:'Transfer to mountages; maintain 25°C, 80% RH.' },{ name:'Harvest', nameHi:'कटाई', day:102, duration:3, tip:'Harvest cocoons on day 7–8; market fresh.' }]),
      makeCrop('banana_ka','Banana','केला','🍌','Year-round','Jun–Jul','10–12 months','High (drip preferred)','15–35°C','Rich loamy / alluvial','Nanjangud Rasabale & Kadali are GI-tagged Karnataka varieties.',[ { name:'Planting', nameHi:'रोपण', day:0, duration:7, tip:'Tissue culture plants; 1.8m × 1.8m spacing.' },{ name:'Establishment', nameHi:'स्थापना', day:7, duration:60, tip:'Water twice daily; add mulch.' },{ name:'Vegetative', nameHi:'वनस्पति', day:67, duration:150, tip:'Remove suckers; apply 200-30-300 NPK g/plant.' },{ name:'Shooting', nameHi:'घड़', day:217, duration:30, tip:'Remove male bud after last hand sets.' },{ name:'Bunch Development', nameHi:'गुच्छा', day:247, duration:60, tip:'Bag bunch with blue polythene; apply K.' },{ name:'Harvest', nameHi:'तुड़ाई', day:307, duration:14, tip:'Harvest 75% maturity; ethylene ripen for market.' }]),
    ],
  },

  TamilNadu: {
    nameHi: 'तमिलनाडु',
    icon: '🌾',
    climate: 'Tropical (northeast monsoon)',
    specialty: 'Rice, Banana, Sugarcane, Cotton, Fishery, Flowers',
    soilTypes: ['Alluvial (Cauvery delta)', 'Red loamy', 'Black cotton', 'Coastal sandy'],
    waterSources: ['Cauvery delta', 'Palk Strait & Bay of Bengal (fishery)', 'Bhavani', 'Palar rivers', 'Chennai coast'],
    farmingTypes: [
      { id: 'fish',  label: 'Marine Fishery',   icon: '🐠', color: '#0277BD' },
      { id: 'rice',  label: 'Cauvery Delta Rice', icon: '🌾', color: '#2E7D32' },
      { id: 'flower',label: 'Floriculture',      icon: '🌺', color: '#E91E63' },
      { id: 'hort',  label: 'Horticulture',      icon: '🍌', color: '#F57F17' },
    ],
    crops: [
      makeCrop('rice_tn','Rice','அரிசி / चावल','🌾','Kharif+Rabi','Jun & Nov','Sep & Feb','105–120 days','High','22–32°C','Alluvial clay','Cauvery delta (Thanjavur, Tiruvarur) is Tamil Nadu\'s rice bowl. ADT-43 is popular.',riceStages),
      makeCrop('banana_tn','Banana (Poovan)','வாழை / केला','🍌','Year-round','May–Jun','11–12 months','High (drip)','22–35°C','Alluvial / loamy','Theni & Dindigul are banana hubs. Poovan, Robusta, Nendran are key varieties.',[ { name:'Planting', nameHi:'रोपण', day:0, duration:7, tip:'Tissue culture plants or sword suckers.' },{ name:'Establishment', nameHi:'स्थापना', day:7, duration:60, tip:'Water 2× daily; earthing up at 2 months.' },{ name:'Vegetative', nameHi:'वनस्पति', day:67, duration:150, tip:'Apply 200g N, 30g P, 200g K per plant.' },{ name:'Shooting', nameHi:'घड़', day:217, duration:30, tip:'Remove male bud; support with bamboo.' },{ name:'Bunch Fill', nameHi:'गुच्छा', day:247, duration:60, tip:'Bag bunch. Avoid water stress.' },{ name:'Harvest', nameHi:'तुड़ाई', day:307, duration:14, tip:'Harvest at 75–80% maturity.' }]),
      makeCrop('fish_tn','Fishery (Marine)','கடல் மீன் / मछली','🐠','Year-round','Year-round','—','Annual','Sea','Tropical coastal','Sea shore / trawler','Tamil Nadu 2nd largest marine fish producer. Nagapattinam, Rameswaram are key ports.',fisheryStages),
      makeCrop('jasmine_tn','Jasmine (Gundu Malli)','மல்லி / मोगरा','🌺','Year-round','Oct–Nov (planting)','Year-round','1 year to bear','Moderate','25–32°C','Sandy loam','Madurai Malli is GI-tagged. 80% of Tamil Nadu flower trade is jasmine.',[ { name:'Planting', nameHi:'रोपण', day:0, duration:7, tip:'Stem cuttings; 1m × 1m spacing.' },{ name:'Establishment', nameHi:'स्थापना', day:7, duration:60, tip:'Water daily; shade for 1 week.' },{ name:'Vegetative', nameHi:'वनस्पति', day:67, duration:180, tip:'Prune at 3 months; apply N heavily.' },{ name:'Flowering', nameHi:'फूल', day:247, duration:30, tip:'First bloom at 10–12 months.' },{ name:'Regular Harvest', nameHi:'चुनाई', day:277, duration:60, tip:'Pluck buds at evening daily. Apply NPK monthly.' }]),
    ],
  },

  WestBengal: {
    nameHi: 'पश्चिम बंगाल',
    icon: '🐟',
    climate: 'Tropical (Bay of Bengal influence)',
    specialty: 'Rice, Jute, Tea (Darjeeling), Potato, Fishery',
    soilTypes: ['Alluvial (Gangetic delta)', 'Laterite (Purulia)', 'Terai soil (North Bengal)'],
    waterSources: ['Ganga (Hooghly)', 'Bay of Bengal', 'Teesta', 'Damodar', 'Sundarbans waterways'],
    farmingTypes: [
      { id: 'fish',  label: 'Inland Fishery',    icon: '🐟', color: '#0277BD' },
      { id: 'jute',  label: 'Jute Cultivation',  icon: '🌿', color: '#388E3C' },
      { id: 'tea',   label: 'Darjeeling Tea',     icon: '🍵', color: '#4E342E' },
      { id: 'rice',  label: 'Aman Rice',          icon: '🌾', color: '#F57F17' },
    ],
    crops: [
      makeCrop('rice_wb','Rice (Aman)','আমন ধান / धान','🌾','Kharif','Jun–Jul','Nov','120–150 days','High (flood-prone)','25–35°C','Alluvial clay','West Bengal is India\'s top rice producer. Aman season most important.',riceStages),
      makeCrop('jute_wb','Jute','जूट','🌿','Kharif','Mar–May','Jun–Aug','100–120 days','High water table','24–35°C','Alluvial loam','WB produces 50% of India\'s jute — "Golden Fibre". Murshidabad, Nadia key.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'2–3 ploughings; FYM 5 t/ha.' },{ name:'Sowing', nameHi:'बुवाई', day:7, duration:5, tip:'Broadcast; 5–6 kg seed/ha in Mar-May.' },{ name:'Germination', nameHi:'अंकुरण', day:12, duration:8, tip:'Thin to 5–7 cm plant spacing at 12 days.' },{ name:'Vegetative Growth', nameHi:'वृद्धि', day:20, duration:60, tip:'Weed at 20 & 40 days; apply urea 30 kg/ha.' },{ name:'Flowering', nameHi:'फूल', day:80, duration:15, tip:'Harvest before full flowering for quality fibre.' },{ name:'Retting & Extraction', nameHi:'सड़ाई', day:95, duration:20, tip:'Bundle & immerse in water 10–15 days; strip fibre.' }]),
      makeCrop('tea_wb','Darjeeling Tea','दार्जिलिंग चाय','🍵','Perennial','May–Jun','Mar–May (1st flush)','Perennial','High rainfall (≥150 cm)','10–25°C','Acidic loamy (pH 4.5–5.5)','Darjeeling First Flush tea fetches ₹50,000+/kg at auction. GI-tagged product.',teaStages),
      makeCrop('fish_wb','Inland Fishery (Rohu)','মাছ / मछली','🐟','Year-round','Year-round','Year-round','Annual','Ponds & rivers','Tropical freshwater','Pond / river floodplain','WB 2nd in inland fish production. Rohu, Catla, Mrigal are carp species.',fisheryStages),
      makeCrop('potato_wb','Potato','আলু / आलू','🥔','Rabi','Oct–Nov','Jan–Feb','90–100 days','5–6 irrigations','15–22°C','Sandy loam / alluvial','Hooghly, Burdwan are potato belts. WB is India\'s top potato producer.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:5, tip:'Ridge beds 60 cm apart; add FYM.' },{ name:'Planting', nameHi:'रोपण', day:5, duration:5, tip:'45 cm × 20 cm spacing; 20 g seed piece/hill.' },{ name:'Sprouting', nameHi:'अंकुरण', day:10, duration:10, tip:'Light irrigation after planting.' },{ name:'Vegetative', nameHi:'वनस्पति', day:20, duration:30, tip:'Earth up at 25 days; apply NPK 150-60-60.' },{ name:'Tuber Bulking', nameHi:'कंद', day:50, duration:30, tip:'Critical stage — keep moist; monitor late blight.' },{ name:'Harvest', nameHi:'कटाई', day:80, duration:10, tip:'Desiccate tops 10 days before harvest.' }]),
    ],
  },

  Rajasthan: {
    nameHi: 'राजस्थान',
    icon: '🏜️',
    climate: 'Arid to semi-arid',
    specialty: 'Bajra, Mustard, Jowar, Gram, Cumin',
    soilTypes: ['Sandy desert soil', 'Loamy sand', 'Brown & red soil'],
    waterSources: ['Indira Gandhi Canal', 'Chambal', 'Banas river', 'Tube wells', 'Tanka (rainwater harvesting)'],
    farmingTypes: [
      { id: 'dry',    label: 'Dry-land Farming',   icon: '🌵', color: '#BF360C' },
      { id: 'oilseed',label: 'Oilseed Belt',       icon: '🟡', color: '#F57F17' },
      { id: 'spice',  label: 'Spice Cultivation',  icon: '🌶️', color: '#B71C1C' },
      { id: 'dairy',  label: 'Livestock & Dairy',  icon: '🐪', color: '#795548' },
    ],
    crops: [
      makeCrop('bajra_rj','Bajra (Pearl Millet)','बाजरा','🌾','Kharif','Jun–Jul','Sep–Oct','75–90 days','Very low (1 irrigation)','25–35°C','Sandy loam / desert soil','Most drought-tolerant cereal. Rajasthan produces 40% of India\'s bajra.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:5, tip:'Light ploughing; FYM not always needed in sandy soil.' },{ name:'Sowing', nameHi:'बुवाई', day:5, duration:3, tip:'50×25 cm spacing; 3.5 kg seed/ha.' },{ name:'Germination', nameHi:'अंकुरण', day:8, duration:6, tip:'Thin to 1 plant per hill at 2-leaf stage.' },{ name:'Tillering', nameHi:'कंशेरिंग', day:14, duration:20, tip:'Apply 40 kg urea/ha at 20 days.' },{ name:'Earhead Emergence', nameHi:'बाली', day:34, duration:20, tip:'Critical — irrigate if available at earhead stage.' },{ name:'Harvest', nameHi:'कटाई', day:54, duration:10, tip:'Harvest when earhead hard-dough stage. Dry 2–3 days.' }]),
      makeCrop('mustard_rj','Mustard','सरसों','🌼','Rabi','Oct 1–20','Feb–Mar','110–130 days','3–4 irrigations','10–25°C','Sandy loam','Rajasthan produces 45% of India\'s rapeseed-mustard. GaniMata variety popular.',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:5, tip:'Oct 10 is optimal; 5 kg seed/ha, 45 cm rows.' },{ name:'Germination', nameHi:'अंकुरण', day:5, duration:7, tip:'Keep soil moist for germination.' },{ name:'Vegetative', nameHi:'वनस्पति', day:12, duration:30, tip:'Apply N at 20 days; 1st irrigation at rosette stage.' },{ name:'Flowering', nameHi:'फूल', day:42, duration:20, tip:'Do not irrigate during full bloom (causes shattering).' },{ name:'Pod Fill', nameHi:'फली', day:62, duration:30, tip:'Apply 3rd irrigation at pod fill. Watch aphids.' },{ name:'Maturity', nameHi:'पकाव', day:92, duration:20, tip:'Harvest when 75% pods turn golden. Thresh & dry.' }]),
      makeCrop('cumin_rj','Cumin','जीरा','🟡','Rabi','Nov','Feb–Mar','100–120 days','3–4 irrigations','10–25°C','Sandy loam / calcareous','Rajasthan grows 80% of India\'s cumin. Jodhpur, Nagaur are key districts.',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:5, tip:'Nov 15–Dec 15 sowing; 10–12 kg seed/ha broadcast.' },{ name:'Germination', nameHi:'अंकुरण', day:5, duration:8, tip:'Maintain moisture; light irrigation required.' },{ name:'Vegetative', nameHi:'वनस्पति', day:13, duration:35, tip:'Weed twice; apply 20 kg urea/ha.' },{ name:'Flowering', nameHi:'फूल', day:48, duration:15, tip:'Watch for blight disease; apply mancozeb if needed.' },{ name:'Seed Fill', nameHi:'बीज', day:63, duration:30, tip:'Irrigate carefully; water splash causes blight.' },{ name:'Harvest', nameHi:'कटाई', day:93, duration:10, tip:'Cut when seeds turn greenish-grey; dry on threshing floor.' }]),
      makeCrop('gram_rj','Gram (Chickpea)','चना','🟤','Rabi','Oct–Nov','Mar','90–110 days','1–2 irrigations','10–25°C','Loamy / sandy loam','Rajasthan top chickpea producer. Rain-fed Desi type dominates.',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:5, tip:'Oct-Nov; 75–90 kg seed/ha, 30 cm rows.' },{ name:'Germination', nameHi:'अंकुरण', day:5, duration:7, tip:'Seed treatment with Rhizobium essential.' },{ name:'Vegetative', nameHi:'वनस्पति', day:12, duration:30, tip:'Weed at 20 & 35 days. No irrigation if soil moist.' },{ name:'Flowering', nameHi:'फूल', day:42, duration:20, tip:'Critical irrigation at flowering if dry.' },{ name:'Pod Fill', nameHi:'फली', day:62, duration:25, tip:'Watch pod borer; spray if damage > 5%.' },{ name:'Harvest', nameHi:'कटाई', day:87, duration:10, tip:'Harvest when 75% pods dry. Thresh by beating sheaves.' }]),
    ],
  },

  Gujarat: {
    nameHi: 'गुजरात',
    icon: '🌱',
    climate: 'Semi-arid to tropical',
    specialty: 'Cotton, Groundnut, Castor, Tobacco, Mango',
    soilTypes: ['Black cotton soil', 'Sandy loam (Saurashtra)', 'Alluvial (coastal)'],
    waterSources: ['Narmada canal', 'Sabarmati', 'Tapi', 'Mahi rivers', 'Drip irrigation (Saurashtra)'],
    farmingTypes: [
      { id: 'cotton',  label: 'Cotton Belt',        icon: '🌸', color: '#0288D1' },
      { id: 'gnut',    label: 'Groundnut (Moongfali)', icon: '🥜', color: '#F57F17' },
      { id: 'aqua',    label: 'Aquaculture (Shrimp)',  icon: '🦐', color: '#00695C' },
      { id: 'dairy',   label: 'Amul Dairy Cooperative', icon: '🐄', color: '#6D4C41' },
    ],
    crops: [
      makeCrop('cotton_gj','Bt Cotton','कपास','🌸','Kharif','May–Jun','Nov–Jan','180–200 days','Medium','25–35°C','Black / medium loam','Gujarat produces 30% of India\'s cotton. Bt cotton is universal here.',cottonStages),
      makeCrop('groundnut_gj','Groundnut','मूंगफली','🥜','Kharif','Jun–Jul','Oct–Nov','110–130 days','3–4 (pod stage critical)','25–30°C','Sandy loam','Saurashtra is India\'s groundnut capital. Gujarat Navbahar variety popular.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'Fine seedbed; gypsum 500 kg/ha basal.' },{ name:'Sowing', nameHi:'बुवाई', day:7, duration:5, tip:'15×30 cm; 100 kg pods/ha; seed treatment with thiram.' },{ name:'Germination', nameHi:'अंकुरण', day:12, duration:8, tip:'Light irrigation if soil dry.' },{ name:'Vegetative', nameHi:'वनस्पति', day:20, duration:30, tip:'Earth up at 30 days; apply gypsum at peg stage.' },{ name:'Peg & Pod Dev.', nameHi:'फल्ली', day:50, duration:40, tip:'Do not irrigate excess; peg needs aeration.' },{ name:'Maturity & Harvest', nameHi:'कटाई', day:90, duration:15, tip:'Check pods for maturity (inner shell dark). Dig carefully.' }]),
      makeCrop('castor_gj','Castor','अरंडी','🌿','Kharif','Jun–Jul','Jan–Feb','180–200 days','Low','20–28°C','Well-drained loamy','Gujarat produces 85% of world castor oil. Mehsana, Kutch are key zones.',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:5, tip:'Jun-Jul; 45×45 cm; hybrid GCH-4/GCH-7.' },{ name:'Germination', nameHi:'अंकुरण', day:5, duration:8, tip:'Thin to 1 plant at 10 days.' },{ name:'Vegetative', nameHi:'वनस्पति', day:13, duration:50, tip:'Apply 60 kg N/ha split; avoid waterlogging.' },{ name:'Flowering', nameHi:'फूल', day:63, duration:20, tip:'Watch for semi-looper caterpillar.' },{ name:'Capsule Dev.', nameHi:'बीज', day:83, duration:70, tip:'Multiple picks as capsules mature.' },{ name:'Final Harvest', nameHi:'कटाई', day:153, duration:30, tip:'Pick dry capsules; sun-dry before shelling.' }]),
    ],
  },

  MadhyaPradesh: {
    nameHi: 'मध्यप्रदेश',
    icon: '🫘',
    climate: 'Sub-tropical to tropical',
    specialty: 'Soybean, Wheat, Rice, Gram, Garlic',
    soilTypes: ['Black cotton soil', 'Alluvial (river valleys)', 'Red-yellow soil'],
    waterSources: ['Narmada', 'Chambal', 'Tapti', 'Betwa rivers', 'Irrigation dams'],
    farmingTypes: [
      { id: 'soy',    label: 'Soybean Belt',      icon: '🫘', color: '#388E3C' },
      { id: 'wheat',  label: 'Wheat Farming',     icon: '🌾', color: '#E65100' },
      { id: 'garlic', label: 'Garlic Cultivation', icon: '🧄', color: '#7B1FA2' },
      { id: 'forest', label: 'Forest Produce',    icon: '🌳', color: '#2E7D32' },
    ],
    crops: [
      makeCrop('soybean_mp','Soybean','सोयाबीन','🫘','Kharif','Jun–Jul','Sep–Oct','95–105 days','2–3 irrigations','20–30°C','Black / medium loam','MP produces 50% of India\'s soybean — "Soybean state". JS-335 is dominant variety.',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:5, tip:'Seed treatment with Rhizobium+Trichoderma; 70 kg/ha.' },{ name:'Germination', nameHi:'अंकुरण', day:5, duration:7, tip:'Don\'t overwater; black soil retains moisture.' },{ name:'Vegetative', nameHi:'वनस्पति', day:12, duration:30, tip:'Inter-cultivation at 15 & 30 days; apply P+K.' },{ name:'Flowering', nameHi:'फूल', day:42, duration:15, tip:'Don\'t irrigate excess; watch for girdle beetle.' },{ name:'Pod Fill', nameHi:'फली', day:57, duration:30, tip:'Irrigation at pod fill if dry; control pod borer.' },{ name:'Harvest', nameHi:'कटाई', day:87, duration:10, tip:'Harvest when 85% pods brown; avoid shattering losses.' }]),
      makeCrop('wheat_mp','Wheat','गेहूँ','🌾','Rabi','Nov 15–30','Mar–Apr','120–140 days','5–6 irrigations','15–22°C','Black / alluvial','MP is India\'s 3rd largest wheat producer. Sehore & Vidisha are key districts.',wheatStages),
      makeCrop('garlic_mp','Garlic','लहसुन','🧄','Rabi','Oct–Nov','Mar','130–150 days','5–6 irrigations','10–20°C','Sandy loam / well-drained','Mandsaur is India\'s garlic capital. MP produces 65% of India\'s garlic.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'Raised beds; FYM 20 t/ha + 40 kg S/ha.' },{ name:'Planting', nameHi:'रोपण', day:7, duration:5, tip:'15×7.5 cm spacing; tip of clove up; 400 kg cloves/ha.' },{ name:'Sprouting', nameHi:'अंकुरण', day:12, duration:10, tip:'Light irrigation; ensure drainage.' },{ name:'Vegetative', nameHi:'वनस्पति', day:22, duration:60, tip:'Apply N at 30 & 60 days; 3 irrigations.' },{ name:'Bulbing', nameHi:'गाँठ', day:82, duration:40, tip:'Reduce N; increase K. Mild water stress at maturity.' },{ name:'Harvest', nameHi:'कटाई', day:122, duration:14, tip:'Harvest when tops 40% fallen. Cure 10–15 days in shade.' }]),
    ],
  },

  Haryana: {
    nameHi: 'हरियाणा',
    icon: '🐄',
    climate: 'Semi-arid continental',
    specialty: 'Wheat, Rice, Mustard, Sugarcane, Dairy',
    soilTypes: ['Alluvial loamy', 'Sandy (Aravalli fringe)', 'Clayey (khadar)'],
    waterSources: ['Western Yamuna Canal', 'Bhakra canal', 'Yamuna', 'Tube wells'],
    farmingTypes: [
      { id: 'wheat',  label: 'Wheat-Rice Belt',   icon: '🌾', color: '#E65100' },
      { id: 'dairy',  label: 'Dairy Farming',     icon: '🐄', color: '#795548' },
      { id: 'horti',  label: 'Horticulture',      icon: '🥒', color: '#388E3C' },
    ],
    crops: [
      makeCrop('wheat_hr','Wheat','गेहूँ','🌾','Rabi','Nov 1–20','Apr','125–140 days','5–6 irrigations','15–22°C','Alluvial loamy','PBW-343, WH-147 are popular Haryana varieties. CCS HAU Hisar crop research hub.',wheatStages),
      makeCrop('rice_hr','Rice','धान','🌾','Kharif','Jun–Jul (transplant)','Oct','115–130 days','Abundant','25–35°C','Alluvial clay loam','PR-121 (short duration) helps in wheat-rice rotation without delay.',riceStages),
      makeCrop('mustard_hr','Mustard','सरसों','🌼','Rabi','Oct 1–20','Feb–Mar','100–120 days','2–3 irrigations','15–25°C','Loamy / sandy loam','Mahendra, Pusa Vijay varieties popular. Grown in rotation with wheat.',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:5, tip:'Oct 10–20 sowing; 5 kg seed/ha, 45 cm rows.' },{ name:'Germination', nameHi:'अंकुरण', day:5, duration:7, tip:'Pre-sowing irrigation essential.' },{ name:'Vegetative', nameHi:'वनस्पति', day:12, duration:30, tip:'Apply N at 20 days; 1st irrigation at rosette.' },{ name:'Flowering', nameHi:'फूल', day:42, duration:20, tip:'Spray 2% boron at 50% flowering for pod set.' },{ name:'Pod Fill', nameHi:'फली', day:62, duration:25, tip:'Watch aphids; threshold 20 aphids/leaf = spray.' },{ name:'Harvest', nameHi:'कटाई', day:87, duration:10, tip:'Harvest at 75% pod maturity; windrow for 3 days.' }]),
    ],
  },

  AndhraPradesh: {
    nameHi: 'आंध्र प्रदेश',
    icon: '🌶️',
    climate: 'Tropical semi-arid to tropical humid',
    specialty: 'Rice, Chilli, Tobacco, Cotton, Aquaculture',
    soilTypes: ['Alluvial (Krishna-Godavari delta)', 'Red sandy', 'Black cotton'],
    waterSources: ['Krishna delta', 'Godavari delta', 'Bay of Bengal (fishing)', 'Nagarjuna Sagar canal'],
    farmingTypes: [
      { id: 'rice',  label: 'Delta Rice Farming',  icon: '🌾', color: '#2E7D32' },
      { id: 'chili', label: 'Chilli Cultivation',  icon: '🌶️', color: '#B71C1C' },
      { id: 'aqua',  label: 'Shrimp Aquaculture',  icon: '🦐', color: '#006064' },
      { id: 'fish',  label: 'Marine Fishery',      icon: '🐟', color: '#0277BD' },
    ],
    crops: [
      makeCrop('rice_ap','Rice','వరి / चावल','🌾','Kharif+Rabi','Jun & Nov','Oct & Mar','110–125 days','High','25–35°C','Alluvial clay delta','AP is India\'s 2nd rice state. Krishna & Godavari deltas are the rice bowls.',riceStages),
      makeCrop('chili_ap','Chilli','మిర్చి / मिर्च','🌶️','Kharif','Jun–Jul (transplant)','Oct–Dec','150–180 days','Drip irrigation','25–30°C','Sandy loam / red loam','Guntur is the world\'s largest dry chilli market. LCA-206, Byadagi are popular.',[ { name:'Nursery', nameHi:'नर्सरी', day:0, duration:30, tip:'Pro-trays; 250g seed/ha; drench with carbendazim.' },{ name:'Transplanting', nameHi:'रोपाई', day:30, duration:5, tip:'60×45 cm spacing; drip irrigation system.' },{ name:'Vegetative', nameHi:'वनस्पति', day:35, duration:40, tip:'Train to 2-branch system; apply 60 kg N/ha.' },{ name:'Flowering', nameHi:'फूल', day:75, duration:20, tip:'Watch thrips & mites; spray spinosad.' },{ name:'Fruit Dev.', nameHi:'फल', day:95, duration:40, tip:'Apply K for thick skin; drip fertigation.' },{ name:'Harvest', nameHi:'तुड़ाई', day:135, duration:45, tip:'3–4 green pickings + 2–3 red pickings.' }]),
      makeCrop('aqua_ap','Shrimp (L. vannamei)','రొయ్యలు / झींगा','🦐','Year-round','Jan–Mar (crop 1)','Apr–Jun','90–100 days/crop','Brackish water ponds','28–33°C','Coastal brackish soil','AP produces 70% of India\'s shrimp exports. Nellore, Krishna coastal districts.',[ { name:'Pond Prep', nameHi:'तैयारी', day:0, duration:15, tip:'Lime 500 kg/ha; fill 1.2m depth; set aerators.' },{ name:'Stocking', nameHi:'बीज', day:15, duration:3, tip:'Stock 60–80 PL/m²; acclimatize in bags.' },{ name:'Nursery Phase', nameHi:'नर्सरी', day:18, duration:30, tip:'Feed 4× daily; 30–40% protein pellets.' },{ name:'Grow-out', nameHi:'वृद्धि', day:48, duration:45, tip:'Reduce feeding to 3×; monitor DO > 4 mg/L.' },{ name:'Harvest', nameHi:'कटाई', day:93, duration:5, tip:'Night harvest; ice in ratio 1:1; quick transport.' }]),
    ],
  },

  Assam: {
    nameHi: 'असम',
    icon: '🍵',
    climate: 'Subtropical humid',
    specialty: 'Tea, Rice, Jute, Silk, Fishery',
    soilTypes: ['Alluvial (Brahmaputra valley)', 'Acidic loam (tea zone)', 'Laterite (hills)'],
    waterSources: ['Brahmaputra', 'Barak', 'Bay of Bengal rains', 'Numerous tributaries'],
    farmingTypes: [
      { id: 'tea',   label: 'Tea Plantation',    icon: '🍵', color: '#4E342E' },
      { id: 'silk',  label: 'Muga/Eri Silk',    icon: '🐛', color: '#7B1FA2' },
      { id: 'fish',  label: 'Inland Fishery',   icon: '🐟', color: '#0277BD' },
      { id: 'rice',  label: 'SAli Rice (Boro)', icon: '🌾', color: '#2E7D32' },
    ],
    crops: [
      makeCrop('tea_as','Assam Tea','আসাম চা / असम चाय','🍵','Perennial','May–Jun','Year-round','Perennial','High rainfall','18–35°C','Acidic loamy (pH 4.5–5.5)','Assam produces 52% of India\'s tea. Bold CTC leaves for strong chai.',teaStages),
      makeCrop('rice_as','Rice (Boro/Sali)','ধান / धान','🌾','Kharif+Rabi','Jun & Nov','Oct & Apr','120–140 days','High rainfall','25–35°C','Alluvial','Assam rice culture is 2000 years old. Joha scented rice is GI-tagged.',riceStages),
      makeCrop('muga_as','Muga Silk','মুগা রেশম / मुगा रेशम','🐛','Year-round','Mar–Apr (1st crop)','Jun–Jul','3 crops/year','Natural rainfall','22–30°C','Alluvial (Som & Soalu trees)','Muga is golden silk found only in Assam — GI product. Natural sheen lasts decades.',[ { name:'Host Plant Maintenance', nameHi:'सोम वृक्ष', day:0, duration:30, tip:'Maintain Som (Machilus bombycina) & Soalu trees; prune.' },{ name:'Egg Hatching', nameHi:'अंडे', day:30, duration:10, tip:'Use fresh eggs; hatch at 25–28°C, 80% RH.' },{ name:'Young Age Rearing', nameHi:'छोटा पालन', day:40, duration:14, tip:'Indoor rearing for 1st instar; tender leaves only.' },{ name:'Outdoor Rearing', nameHi:'बाहर पालन', day:54, duration:20, tip:'Shift to Som trees; natural predation management.' },{ name:'Spinning', nameHi:'कोकून', day:74, duration:5, tip:'Cocoons turn golden; collect on day 8–10.' },{ name:'Reeling', nameHi:'रीलिंग', day:79, duration:5, tip:'Reel in 80°C water; single continuous filament.' }]),
    ],
  },

  HimachalPradesh: {
    nameHi: 'हिमाचल प्रदेश',
    icon: '🍎',
    climate: 'Temperate to alpine',
    specialty: 'Apple, Potato, Wheat, Maize, Mushroom',
    soilTypes: ['Brown forest soil', 'Grey-brown mountain soil', 'Alluvial (valleys)'],
    waterSources: ['Sutlej', 'Beas', 'Ravi', 'Chenab rivers', 'Glacial meltwater'],
    farmingTypes: [
      { id: 'apple', label: 'Apple Orchards',       icon: '🍎', color: '#C62828' },
      { id: 'veg',   label: 'Off-season Vegetables', icon: '🥦', color: '#2E7D32' },
      { id: 'mush',  label: 'Mushroom Cultivation',  icon: '🍄', color: '#795548' },
      { id: 'herb',  label: 'Herb/Spice Growing',    icon: '🌿', color: '#00695C' },
    ],
    crops: [
      makeCrop('apple_hp','Apple','सेब','🍎','Summer','Feb–Mar (pruning)','Sep–Oct','150–180 days','Drip/sprinkler','12–18°C','Brown forest soil (pH 5.5–7)','HP produces 25% of India\'s apples. Shimla, Kullu, Kinnaur are apple belts.',[ { name:'Dormancy Breaking', nameHi:'सुप्तावस्था', day:0, duration:15, tip:'Spray DNOC or mineral oil to break dormancy.' },{ name:'Pruning', nameHi:'छंटाई', day:15, duration:10, tip:'Thin-spurred heading-back cuts; remove crossing branches.' },{ name:'Bud Break', nameHi:'कली फूटना', day:25, duration:15, tip:'Apply copper fungicide at green tip.' },{ name:'Flowering', nameHi:'फूल', day:40, duration:15, tip:'Honey bee colonies in orchard for pollination.' },{ name:'June Drop', nameHi:'जून फल गिरना', day:55, duration:20, tip:'Natural thinning; hand-thin to 1 apple per spur.' },{ name:'Fruit Development', nameHi:'फल विकास', day:75, duration:90, tip:'Apply Ca-spray; cover with bio-nets from birds.' },{ name:'Harvest', nameHi:'तुड़ाई', day:165, duration:20, tip:'Harvest Sep-Oct; stagger picking for market spread.' }]),
      makeCrop('potato_hp','Seed Potato','बीज आलू','🥔','Summer','Mar–Apr','Jun–Jul','75–90 days','4–5 irrigations','15–20°C','Sandy loam mountain soil','HP produces disease-free certified seed potato for the plains.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'FYM 20 t/ha; pH 5.5–6.5 preferred.' },{ name:'Planting', nameHi:'रोपण', day:7, duration:5, tip:'Certified seed; 60×30 cm; eye-up planting.' },{ name:'Sprouting', nameHi:'अंकुरण', day:12, duration:10, tip:'Light irrigation; soil should not crack.' },{ name:'Vegetative', nameHi:'वनस्पति', day:22, duration:25, tip:'Earth up twice; apply N+K.' },{ name:'Tuber Set', nameHi:'कंद', day:47, duration:25, tip:'Watch late blight; spray mancozeb at 7-day intervals.' },{ name:'Harvest', nameHi:'कटाई', day:72, duration:10, tip:'Kill tops 10 days before for skin set; store in CAS.' }]),
      makeCrop('ginger_hp','Ginger','अदरक','🫚','Kharif','Mar–Apr','Oct–Nov','200–220 days','Moderate','20–28°C','Sandy loam well-drained','Kullu ginger is fragrant; organic ginger export potential.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'Raised beds; FYM 25 t/ha; neem cake 2 t/ha.' },{ name:'Planting', nameHi:'रोपण', day:7, duration:7, tip:'Seed rhizomes 15–25 g; 25×25 cm; mulch with leaves.' },{ name:'Sprouting', nameHi:'अंकुरण', day:14, duration:20, tip:'Maintain moisture; apply compost tea.' },{ name:'Vegetative', nameHi:'वनस्पति', day:34, duration:100, tip:'Earth up at 30 & 60 days; apply N+K.' },{ name:'Rhizome Dev.', nameHi:'प्रकंद', day:134, duration:60, tip:'Reduce irrigation; watch rhizome rot.' },{ name:'Harvest', nameHi:'कटाई', day:194, duration:14, tip:'Harvest when leaves turn yellow; cure 1 week.' }]),
    ],
  },

  Bihar: {
    nameHi: 'बिहार',
    icon: '🌽',
    climate: 'Subtropical humid',
    specialty: 'Rice, Wheat, Maize, Litchi, Makhana, Fishery',
    soilTypes: ['Alluvial (Gangetic)', 'Diara soil (flood plains)', 'Terai soil'],
    waterSources: ['Ganga', 'Gandak', 'Kosi', 'Bagmati rivers', 'Flood plains'],
    farmingTypes: [
      { id: 'maize', label: 'Maize Cluster',    icon: '🌽', color: '#F57F17' },
      { id: 'litchi',label: 'Litchi Orchards',  icon: '🍈', color: '#E91E63' },
      { id: 'fish',  label: 'Makhana Farming',  icon: '💧', color: '#0277BD' },
      { id: 'veg',   label: 'Vegetable Hub',    icon: '🥕', color: '#388E3C' },
    ],
    crops: [
      makeCrop('maize_br','Maize','मक्का','🌽','Kharif','Jun–Jul','Sep–Oct','90–110 days','4–5 irrigations','21–27°C','Well-drained alluvial','Bihar is 2nd in maize; Ganga basin double crop (kharif + spring).',[ { name:'Sowing', nameHi:'बुवाई', day:0, duration:5, tip:'75×25 cm; hybrid seed 20 kg/ha.' },{ name:'Germination', nameHi:'अंकुरण', day:5, duration:7, tip:'Ensure crust-free germination.' },{ name:'Knee-High', nameHi:'घुटने तक', day:12, duration:20, tip:'Thin at V3; apply urea 65 kg/ha.' },{ name:'Tasseling', nameHi:'नर पुष्प', day:32, duration:15, tip:'Critical irrigation at tasseling.' },{ name:'Silking/Fill', nameHi:'रेशम/भरना', day:47, duration:30, tip:'3rd urea dose; stink bug management.' },{ name:'Harvest', nameHi:'कटाई', day:77, duration:15, tip:'Harvest at 30% moisture for market.' }]),
      makeCrop('litchi_br','Litchi','लीची','🍈','Perennial','Oct–Nov (planting)','May–Jun','4–5 years to bear','Moderate (drip)','15–30°C','Sandy loam / acidic loam','Muzaffarpur Shahi litchi is GI-tagged; Bihar produces 40% of India\'s litchi.',[ { name:'Planting', nameHi:'रोपण', day:0, duration:7, tip:'Air-layered plants; 8m × 8m; Jun-Jul or Oct-Nov.' },{ name:'Establishment', nameHi:'स्थापना', day:7, duration:365, tip:'Water twice weekly; shade for 2 months.' },{ name:'Vegetative', nameHi:'वृद्धि', day:372, duration:1095, tip:'Annual NPK; pruning for canopy; pH < 6.' },{ name:'Flowering', nameHi:'फूल', day:1467, duration:20, tip:'No irrigation Oct-Dec to stress for flowering.' },{ name:'Fruit Setting', nameHi:'फल', day:1487, duration:50, tip:'Resume irrigation; calcium sprays; bird nets.' },{ name:'Harvest', nameHi:'तुड़ाई', day:1537, duration:15, tip:'Harvest complete clusters; precool within 2 hrs.' }]),
      makeCrop('makhana_br','Makhana (Fox Nut)','मखाना','💧','Kharif','Apr–May','Aug–Sep','5–6 months','Shallow ponds/lakes','28–35°C','Pond / wetland','Mithila (Darbhanga, Madhubani) produces 90% of world makhana — GI-tagged.',[ { name:'Pond Prep', nameHi:'तालाब', day:0, duration:15, tip:'1–1.5m water depth; apply urea 50 kg/ha to pond.' },{ name:'Seed Sowing', nameHi:'बीज', day:15, duration:5, tip:'Germinated seeds broadcast in Feb-Mar.' },{ name:'Vegetative', nameHi:'पत्ती वृद्धि', day:20, duration:60, tip:'Monitor weed; thin plants to 1m spacing.' },{ name:'Flowering', nameHi:'फूल', day:80, duration:30, tip:'Blue-violet flowers; allow to self-pollinate.' },{ name:'Seed Maturity', nameHi:'बीज पकना', day:110, duration:30, tip:'Seeds ripen and sink; divers collect from bottom.' },{ name:'Processing', nameHi:'प्रसंस्करण', day:140, duration:14, tip:'Sun-dry; roast in sand + fry to pop Makhana.' }]),
    ],
  },

  Odisha: {
    nameHi: 'ओडिशा',
    icon: '🌾',
    climate: 'Tropical monsoon',
    specialty: 'Rice, Jute, Sugarcane, Fishery, Turmeric',
    soilTypes: ['Alluvial (coastal)', 'Red & laterite', 'Medium black'],
    waterSources: ['Mahanadi delta', 'Bay of Bengal (fishery)', 'Brahmani', 'Baitarani rivers'],
    farmingTypes: [
      { id: 'fish',  label: 'Marine & Inland Fishery', icon: '🐟', color: '#0277BD' },
      { id: 'rice',  label: 'Paddy Cultivation',        icon: '🌾', color: '#388E3C' },
      { id: 'jute',  label: 'Jute Farming',             icon: '🌿', color: '#4E342E' },
    ],
    crops: [
      makeCrop('rice_or','Rice','ଧାନ / धान','🌾','Kharif','Jun–Jul','Nov','125–150 days','High','25–35°C','Alluvial / medium black','Odisha rice germplasm has 10,000+ varieties. Kalajeera scented rice is GI-tagged.',riceStages),
      makeCrop('fish_or','Marine Fishery','ମାଛ / मछली','🐟','Year-round','Year-round','—','Annual','Sea (Puri, Chilika)','Tropical','Coastal zone / Chilika lake','Chilika lake is Asia\'s largest brackish water lagoon — rich fishery zone.',fisheryStages),
      makeCrop('turmeric_or','Turmeric','ହଳଦି / हल्दी','💛','Kharif','May–Jun','Jan–Mar','8–9 months','Moderate','20–30°C','Loamy / well-drained','Kandhamal turmeric is GI-tagged; high curcumin content (7%).',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'FYM 25 t/ha; neem cake 1 t/ha.' },{ name:'Planting', nameHi:'रोपण', day:7, duration:5, tip:'Mother rhizomes; 45×30 cm spacing; mulch.' },{ name:'Sprouting', nameHi:'अंकुरण', day:12, duration:20, tip:'Maintain soil moisture; avoid waterlogging.' },{ name:'Vegetative', nameHi:'वनस्पति', day:32, duration:120, tip:'Earth up at 45 & 90 days.' },{ name:'Rhizome Dev.', nameHi:'प्रकंद', day:152, duration:90, tip:'Stop irrigation at 8th month.' },{ name:'Harvest', nameHi:'कटाई', day:242, duration:14, tip:'Boil 45 min; sun-dry 10–15 days.' }]),
    ],
  },

  Goa: {
    nameHi: 'गोवा',
    icon: '🥥',
    climate: 'Tropical monsoon',
    specialty: 'Rice, Coconut, Cashew, Fishery, Areca nut',
    soilTypes: ['Laterite', 'Alluvial (khazan lands)', 'Coastal sandy'],
    waterSources: ['Arabian Sea (fishery)', 'Mandovi', 'Zuari estuaries', 'Backwaters'],
    farmingTypes: [
      { id: 'fish',  label: 'Deep-sea Fishery',   icon: '🐡', color: '#0277BD' },
      { id: 'coco',  label: 'Coconut-Cashew',     icon: '🥥', color: '#2E7D32' },
      { id: 'khazan',label: 'Khazan (Tidal) Rice',icon: '🌾', color: '#F57F17' },
    ],
    crops: [
      makeCrop('fish_ga','Marine Fishery','मासो / मछली','🐡','Oct–May','Oct (season opens)','May','Seasonal','Sea','Tropical','Sea (Arabian)','Goa fishing season Oct-May; mackerel, kingfish, pomfret are key species.',fisheryStages),
      makeCrop('cashew_ga','Cashew','Caju / काजू','🥜','Summer','Oct–Nov (planting)','Feb–May','3 years to bear','Low','24–28°C','Laterite','Goa cashew feni is famous; 54,000 ha under cashew cultivation.',[ { name:'Planting', nameHi:'रोपण', day:0, duration:7, tip:'Air-layered; pit 50×50×50 cm; onset of pre-monsoon.' },{ name:'Establishment', nameHi:'स्थापना', day:7, duration:365, tip:'Water twice weekly; shade first 3 months.' },{ name:'Vegetative', nameHi:'वनस्पति', day:372, duration:730, tip:'NPK 500-200-200 g/tree/year.' },{ name:'Flowering', nameHi:'फूल', day:1102, duration:30, tip:'Spray boron at 10% bloom; bee pollination.' },{ name:'Nut Dev.', nameHi:'फल', day:1132, duration:60, tip:'Protect from stem & root borers.' },{ name:'Harvest', nameHi:'तुड़ाई', day:1192, duration:30, tip:'Collect fallen nuts daily; dry 2 days.' }]),
      makeCrop('coconut_ga','Coconut','नारळ / नारियल','🥥','Perennial','Jun–Jul','Year-round','5 years to bear','Moderate','27°C average','Laterite / coastal loam','Goa coconut produces toddy, coconut oil, and shell crafts; 46 ha/village average.',coconutStages),
    ],
  },

  Jharkhand: {
    nameHi: 'झारखंड',
    icon: '🌿',
    climate: 'Tropical humid',
    specialty: 'Rice, Maize, Wheat, Lac farming, Medicinal plants',
    soilTypes: ['Red & laterite', 'Sandy loam', 'Alluvial (valley)'],
    waterSources: ['Damodar', 'Subansiri', 'Kanchi rivers', 'Irrigation tanks'],
    farmingTypes: [
      { id: 'lac',   label: 'Lac (Shellac) Farming', icon: '🐛', color: '#C62828' },
      { id: 'rice',  label: 'Rain-fed Rice',          icon: '🌾', color: '#388E3C' },
      { id: 'med',   label: 'Medicinal Plants',        icon: '🌿', color: '#00695C' },
    ],
    crops: [
      makeCrop('rice_jh','Rice','झाड़खंडी धान','🌾','Kharif','Jun–Jul','Nov','120–145 days','Rain-fed','25–35°C','Red laterite','Rain-fed upland rice. Jhona variety is GI-tagged scented rice of Jharkhand.',riceStages),
      makeCrop('lac_jh','Lac (Shellac)','लाख','🐛','Year-round','Jun & Jan','Oct & Jun','6 months/crop','Host tree water','Tropical','Host tree (Kusum, Ber, Palas)','Jharkhand produces 55% of India\'s lac — a natural resin from Kerria lacca insect.',[ { name:'Host Tree Prep', nameHi:'पेड़ तैयारी', day:0, duration:10, tip:'Prune host tree; remove old lac sticks.' },{ name:'Inoculation', nameHi:'टीकाकरण', day:10, duration:5, tip:'Tie brood lac sticks to host tree branches.' },{ name:'Crawlers Spread', nameHi:'क्रॉलर', day:15, duration:15, tip:'Tiny crawlers spread over branches & settle to feed.' },{ name:'Development', nameHi:'विकास', day:30, duration:90, tip:'Secretes lac resin; tree needs to be healthy.' },{ name:'Harvesting', nameHi:'कटाई', day:120, duration:10, tip:'Cut lac-covered branches; cut stick lac.' },{ name:'Processing', nameHi:'प्रसंस्करण', day:130, duration:10, tip:'Scrape grain lac; melt for shellac; grade and sell.' }]),
    ],
  },

  Chhattisgarh: {
    nameHi: 'छत्तीसगढ़',
    icon: '🍚',
    climate: 'Tropical humid',
    specialty: 'Rice, Pulses, Oilseeds, Minor Forest Produce',
    soilTypes: ['Red-yellow soil', 'Alluvial (Chhattisgarh plain)', 'Black soil (Malwa fringe)'],
    waterSources: ['Mahanadi', 'Indravati', 'Sheonath rivers', 'Irrigation tanks'],
    farmingTypes: [
      { id: 'rice',   label: 'Paddy Cultivation',     icon: '🌾', color: '#388E3C' },
      { id: 'forest', label: 'Minor Forest Produce',  icon: '🌰', color: '#4E342E' },
      { id: 'pulse',  label: 'Pulse Cultivation',     icon: '🫘', color: '#F57F17' },
    ],
    crops: [
      makeCrop('rice_cg','Rice (Dubraj/Jeera)','छत्तीसगढ़ धान','🌾','Kharif','Jun–Jul','Nov','130–155 days','Rain-fed','25–35°C','Red / medium black','Chhattisgarh is the "Rice Bowl of India". Dubraj & Jeera scented rice are GI-tagged.',riceStages),
    ],
  },

  Uttarakhand: {
    nameHi: 'उत्तराखंड',
    icon: '🍎',
    climate: 'Temperate to Alpine',
    specialty: 'Apple, Potato, Wheat, Basmati, Medicinal herbs',
    soilTypes: ['Brown forest soil', 'Sandy loam (Terai)', 'Alluvial valleys'],
    waterSources: ['Ganga', 'Yamuna', 'Alaknanda', 'Glacial streams', 'Tehri dam'],
    farmingTypes: [
      { id: 'apple', label: 'Apple & Stone Fruits', icon: '🍎', color: '#C62828' },
      { id: 'herb',  label: 'Medicinal Herbs',      icon: '🌿', color: '#00695C' },
      { id: 'rice',  label: 'Basmati Rice',          icon: '🌾', color: '#F57F17' },
      { id: 'veg',   label: 'Off-season Vegetables', icon: '🥔', color: '#388E3C' },
    ],
    crops: [
      makeCrop('apple_uk','Apple','सेब','🍎','Summer','Feb–Mar','Sep–Oct','150 days','Drip','12–18°C','Brown mountain loam','Uttarkashi & Chamoli grow excellent apples at 1800–2500m altitude.',[ { name:'Pruning', nameHi:'छंटाई', day:0, duration:10, tip:'Heading-back & thinning cuts in Feb.' },{ name:'Bud Break', nameHi:'कली', day:10, duration:15, tip:'Apply copper fungicide at pink bud.' },{ name:'Bloom', nameHi:'फूल', day:25, duration:15, tip:'Honey bees placed in orchard.' },{ name:'Fruit Set', nameHi:'फल', day:40, duration:20, tip:'Chemical thinning with carbaryl.' },{ name:'Fruit Fill', nameHi:'फल भरना', day:60, duration:100, tip:'Calcium sprays every 2 weeks.' },{ name:'Harvest', nameHi:'कटाई', day:160, duration:20, tip:'Size 65mm+ for export; foam nets for packing.' }]),
      makeCrop('basmati_uk','Basmati Rice','बासमती','🌾','Kharif','Jun (transplant)','Oct','130–140 days','5–6 irrigations','25–30°C','Alluvial (Terai)','Dehradun basmati is GI-tagged; long grain, aromatic.',riceStages),
    ],
  },

  Manipur: {
    nameHi: 'मणिपुर',
    icon: '🌺',
    climate: 'Subtropical (hills) to tropical (valley)',
    specialty: 'Rice, Black rice, Vegetables, Fishery (loktak)',
    soilTypes: ['Loamy hill soil', 'Alluvial valley soil'],
    waterSources: ['Loktak lake', 'Barak', 'Imphal river'],
    farmingTypes: [
      { id: 'fish',  label: 'Loktak Fishery',    icon: '🐟', color: '#0277BD' },
      { id: 'rice',  label: 'Black Rice (Chakhao)', icon: '🌾', color: '#4A148C' },
      { id: 'veg',   label: 'Organic Vegetables', icon: '🌿', color: '#388E3C' },
    ],
    crops: [
      makeCrop('blackrice_mn','Black Rice (Chakhao)','चखाउ / काला चावल','🌾','Kharif','Jun','Nov','150 days','Rain-fed','22–32°C','Loamy hill soil','Chakhao Amubi (black rice) is GI-tagged from Manipur; anthocyanin-rich health food.',riceStages),
      makeCrop('fish_mn','Loktak Fishery','লোকতক মাছ / मछली','🐟','Year-round','Year-round','—','Annual','Loktak lake','Subtropical','Floating phumdis','Loktak lake (floating island lake) supports unique ecology & fishery.',fisheryStages),
    ],
  },

  Meghalaya: {
    nameHi: 'मेघालय',
    icon: '🍊',
    climate: 'Subtropical humid (highest rainfall zone)',
    specialty: 'Rice, Potato, Ginger, Turmeric, Orange, Betel leaf',
    soilTypes: ['Red-yellow laterite', 'Sandy loam (hills)'],
    waterSources: ['Umkhrah', 'Kynshi rivers', 'Heavy rainfall (Cherrapunji/Mawsynram)'],
    farmingTypes: [
      { id: 'jhum',  label: 'Jhum (Shifting) Cultivation', icon: '🔥', color: '#BF360C' },
      { id: 'ginger',label: 'Ginger Cultivation',           icon: '🫚', color: '#F57F17' },
      { id: 'hort',  label: 'Hill Horticulture',            icon: '🍊', color: '#E65100' },
    ],
    crops: [
      makeCrop('ginger_mg','Ginger','Sying / अदरक','🫚','Kharif','Apr–May','Nov–Dec','200–220 days','Rain-fed','20–28°C','Loamy well-drained','Meghalaya ginger (Nadia) is aromatic and high yielding; organic export potential.',[ { name:'Land Prep', nameHi:'तैयारी', day:0, duration:7, tip:'Raised bed; organic mulch system.' },{ name:'Planting', nameHi:'रोपण', day:7, duration:7, tip:'20 g rhizomes; 25×25 cm; mulch with leaves.' },{ name:'Sprouting', nameHi:'अंकुरण', day:14, duration:20, tip:'Moist-not-waterlogged; remove weed.' },{ name:'Vegetative', nameHi:'वनस्पति', day:34, duration:100, tip:'Earthing up twice; apply compost.' },{ name:'Rhizome Dev.', nameHi:'प्रकंद', day:134, duration:60, tip:'Cease irrigation last 2 months.' },{ name:'Harvest', nameHi:'कटाई', day:194, duration:14, tip:'Harvest Nov-Dec; cure 1 week in shade.' }]),
      makeCrop('rice_mg','Hill Rice','Khasi Rice / चावल','🌾','Kharif','Jun','Oct','120–135 days','Rain-fed','22–30°C','Sandy loam laterite','Traditional Khasi varieties grown on terraced hill slopes.',riceStages),
    ],
  },

};

// ── Sorted list of states for UI pickers ────────────────────────────────────────
export const STATE_LIST = Object.keys(STATE_CROPS).sort();

// ── Utility: get state from detected location string ───────────────────────────
// Maps common variations / alternate spellings to STATE_CROPS keys
const STATE_ALIASES = {
  'maharashtra': 'Maharashtra',
  'mumbai': 'Maharashtra',
  'pune': 'Maharashtra',
  'nashik': 'Maharashtra',
  'nagpur': 'Maharashtra',
  'kolhapur': 'Maharashtra',
  'aurangabad': 'Maharashtra',
  'amravati': 'Maharashtra',
  'punjab': 'Punjab',
  'amritsar': 'Punjab',
  'ludhiana': 'Punjab',
  'chandigarh': 'Punjab',
  'uttar pradesh': 'UttarPradesh',
  'up': 'UttarPradesh',
  'lucknow': 'UttarPradesh',
  'varanasi': 'UttarPradesh',
  'kanpur': 'UttarPradesh',
  'allahabad': 'UttarPradesh',
  'prayagraj': 'UttarPradesh',
  'agra': 'UttarPradesh',
  'kerala': 'Kerala',
  'kochi': 'Kerala',
  'thiruvananthapuram': 'Kerala',
  'kozhikode': 'Kerala',
  'thrissur': 'Kerala',
  'kottayam': 'Kerala',
  'karnataka': 'Karnataka',
  'bengaluru': 'Karnataka',
  'bangalore': 'Karnataka',
  'mysuru': 'Karnataka',
  'mysore': 'Karnataka',
  'hubli': 'Karnataka',
  'mangaluru': 'Karnataka',
  'tamil nadu': 'TamilNadu',
  'tamilnadu': 'TamilNadu',
  'chennai': 'TamilNadu',
  'coimbatore': 'TamilNadu',
  'madurai': 'TamilNadu',
  'west bengal': 'WestBengal',
  'westbengal': 'WestBengal',
  'kolkata': 'WestBengal',
  'calcutta': 'WestBengal',
  'howrah': 'WestBengal',
  'rajasthan': 'Rajasthan',
  'jaipur': 'Rajasthan',
  'jodhpur': 'Rajasthan',
  'udaipur': 'Rajasthan',
  'gujarat': 'Gujarat',
  'ahmedabad': 'Gujarat',
  'surat': 'Gujarat',
  'vadodara': 'Gujarat',
  'madhya pradesh': 'MadhyaPradesh',
  'mp': 'MadhyaPradesh',
  'bhopal': 'MadhyaPradesh',
  'indore': 'MadhyaPradesh',
  'jabalpur': 'MadhyaPradesh',
  'haryana': 'Haryana',
  'gurugram': 'Haryana',
  'gurgaon': 'Haryana',
  'faridabad': 'Haryana',
  'rohtak': 'Haryana',
  'andhra pradesh': 'AndhraPradesh',
  'ap': 'AndhraPradesh',
  'hyderabad': 'AndhraPradesh',
  'visakhapatnam': 'AndhraPradesh',
  'vijayawada': 'AndhraPradesh',
  'guntur': 'AndhraPradesh',
  'assam': 'Assam',
  'guwahati': 'Assam',
  'dibrugarh': 'Assam',
  'himachal pradesh': 'HimachalPradesh',
  'hp': 'HimachalPradesh',
  'shimla': 'HimachalPradesh',
  'manali': 'HimachalPradesh',
  'dharamsala': 'HimachalPradesh',
  'bihar': 'Bihar',
  'patna': 'Bihar',
  'muzaffarpur': 'Bihar',
  'gaya': 'Bihar',
  'odisha': 'Odisha',
  'bhubaneswar': 'Odisha',
  'cuttack': 'Odisha',
  'goa': 'Goa',
  'panaji': 'Goa',
  'jharkhand': 'Jharkhand',
  'ranchi': 'Jharkhand',
  'chhattisgarh': 'Chhattisgarh',
  'raipur': 'Chhattisgarh',
  'uttarakhand': 'Uttarakhand',
  'dehradun': 'Uttarakhand',
  'haridwar': 'Uttarakhand',
  'manipur': 'Manipur',
  'imphal': 'Manipur',
  'meghalaya': 'Meghalaya',
  'shillong': 'Meghalaya',
};

export function detectStateFromLocation(locationString) {
  if (!locationString) return null;
  const normalized = locationString.toLowerCase().trim();
  // Direct key match
  const directKey = STATE_ALIASES[normalized];
  if (directKey) return directKey;
  // Partial match
  for (const [alias, stateName] of Object.entries(STATE_ALIASES)) {
    if (normalized.includes(alias)) return stateName;
  }
  return null;
}

// Display-friendly state name (with Hindi)
export function getStateDisplayName(stateKey) {
  const state = STATE_CROPS[stateKey];
  if (!state) return stateKey;
  return `${stateKey.replace(/([A-Z])/g, ' $1').trim()} (${state.nameHi})`;
}
