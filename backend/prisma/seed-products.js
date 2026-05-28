/**
 * Seed AgriStore products — 2-3 representative products per category.
 *
 * Idempotent: matches by (name, categoryId). Re-running updates prices/stock
 * without creating duplicates. Safe to run on a fresh DB or top of existing.
 *
 * Run: node prisma/seed-products.js
 */
import prisma from '../src/config/db.js';

const PRODUCTS = [
  // ── Seeds & Planting Material ──
  { category: 'Seeds & Planting Material',
    items: [
      { name: 'Hybrid Tomato Seeds (10g)', nameHi: 'हाइब्रिड टमाटर बीज (10 ग्राम)', nameMr: 'हायब्रिड टोमॅटो बियाणे (१० ग्रॅम)',
        price: 180, mrp: 220, unit: 'pack', stock: 120, brand: 'Mahyco',
        description: 'High-yield hybrid tomato seeds with disease resistance. Germination > 90%.',
        highlights: ['Disease resistant', '90+ days to harvest', '~4-5 kg/plant yield'],
        tags: ['seeds', 'vegetable', 'hybrid'], isFeatured: true },
      { name: 'BT Cotton Seeds (450g)', nameHi: 'बीटी कपास बीज (450 ग्राम)', nameMr: 'बीटी कापूस बियाणे (४५० ग्रॅम)',
        price: 850, mrp: 920, unit: 'pack', stock: 80, brand: 'Rasi Seeds',
        description: 'BT cotton hybrid resistant to American bollworm. Approved by GEAC.',
        highlights: ['Bollworm resistant', 'High lint quality', '160-180 days duration'],
        tags: ['seeds', 'cotton', 'bt'] },
      { name: 'Bajra (Pearl Millet) Seeds 1kg', nameHi: 'बाजरा बीज 1 किलो', nameMr: 'बाजरी बियाणे १ किलो',
        price: 320, mrp: 380, unit: 'kg', stock: 200, brand: 'Nuziveedu',
        description: 'Drought-tolerant pearl millet hybrid for arid zones.',
        highlights: ['Drought tolerant', '75-85 day maturity'], tags: ['seeds', 'millet'] },
    ]
  },
  // ── Fertilizers & Soil Nutrition ──
  { category: 'Fertilizers & Soil Nutrition',
    items: [
      { name: 'Urea 50kg Bag', nameHi: 'यूरिया 50 किलो बैग', nameMr: 'युरिया ५० किलो बॅग',
        price: 280, mrp: 310, unit: 'bag', stock: 500, brand: 'IFFCO',
        description: '46% Nitrogen content. Subsidised rate. Primary nitrogen source for cereals.',
        highlights: ['46% N', 'Subsidised price', 'Govt. approved'], tags: ['fertilizer', 'nitrogen'],
        isFeatured: true },
      { name: 'DAP 50kg Bag', nameHi: 'डीएपी 50 किलो बैग', nameMr: 'डीएपी ५० किलो बॅग',
        price: 1350, mrp: 1450, unit: 'bag', stock: 400, brand: 'IFFCO',
        description: 'Di-Ammonium Phosphate — 18% N, 46% P₂O₅. Best for basal application.',
        highlights: ['18-46-0 NPK', 'Quick P release'], tags: ['fertilizer', 'phosphate'] },
      { name: 'NPK 19-19-19 Water Soluble 1kg', nameHi: 'एनपीके 19-19-19 (1 किलो)', nameMr: 'एनपीके १९-१९-१९ (१ किलो)',
        price: 320, mrp: 380, unit: 'kg', stock: 250, brand: 'Coromandel',
        description: 'Balanced water-soluble NPK for drip & foliar feeding.',
        highlights: ['100% water soluble', 'Drip-compatible'], tags: ['fertilizer', 'npk', 'soluble'] },
    ]
  },
  // ── Crop Protection ──
  { category: 'Crop Protection',
    items: [
      { name: 'Imidacloprid 17.8% SL (500ml)', nameHi: 'इमिडाक्लोप्रिड 17.8% (500ml)', nameMr: 'इमिडाक्लोप्रिड १७.८% (५००ml)',
        price: 480, mrp: 560, unit: 'bottle', stock: 150, brand: 'Bayer',
        description: 'Systemic insecticide for sucking pests — aphids, jassids, whitefly.',
        highlights: ['Systemic action', 'Wide-spectrum', '7-day residual'],
        tags: ['pesticide', 'insecticide'] },
      { name: 'Mancozeb 75% WP (1kg)', nameHi: 'मॅन्कोझेब 75% WP (1 किलो)', nameMr: 'मॅन्कोझेब ७५% WP (१ किलो)',
        price: 380, mrp: 440, unit: 'kg', stock: 180, brand: 'UPL',
        description: 'Contact fungicide for blight, rust, and downy mildew.',
        highlights: ['Broad-spectrum', 'Rain-fast'], tags: ['pesticide', 'fungicide'] },
    ]
  },
  // ── Organic & Natural Farming ──
  { category: 'Organic & Natural Farming',
    items: [
      { name: 'Vermicompost 25kg', nameHi: 'वर्मीकम्पोस्ट 25 किलो', nameMr: 'गांडूळ खत २५ किलो',
        price: 450, mrp: 520, unit: 'bag', stock: 300, brand: 'EcoFarms',
        description: 'Pure earthworm castings. Improves soil structure and microbial activity.',
        highlights: ['100% organic', 'OMRI-grade', 'Rich in NPK'], tags: ['organic', 'manure'],
        isFeatured: true },
      { name: 'Neem Cake Powder 10kg', nameHi: 'नीम खली 10 किलो', nameMr: 'कडुनिंब पेंड १० किलो',
        price: 380, mrp: 440, unit: 'bag', stock: 200, brand: 'Multiplex',
        description: 'Organic soil enricher with natural pest-repellent properties.',
        highlights: ['Pest repellent', 'Nitrogen rich'], tags: ['organic', 'neem'] },
    ]
  },
  // ── Plant Growth Regulators ──
  { category: 'Plant Growth Regulators',
    items: [
      { name: 'Gibberellic Acid 0.001% (100ml)', nameHi: 'जिब्रेलिक एसिड (100ml)', nameMr: 'जिब्रेलिक ॲसिड (१००ml)',
        price: 240, mrp: 290, unit: 'bottle', stock: 100, brand: 'Sumitomo',
        description: 'Plant hormone — increases fruit size, breaks seed dormancy.',
        highlights: ['Boosts fruit size', 'Improves germination'], tags: ['pgr', 'hormone'] },
      { name: 'Humic Acid 12% Liquid (1L)', nameHi: 'ह्यूमिक एसिड 12% (1L)', nameMr: 'ह्युमिक अ‍ॅसिड १२% (१L)',
        price: 360, mrp: 420, unit: 'bottle', stock: 140, brand: 'Aries Agro',
        description: 'Soil conditioner — improves nutrient uptake & root development.',
        highlights: ['Improves soil', 'Root booster'], tags: ['pgr', 'humic'] },
    ]
  },
  // ── Irrigation & Water Management ──
  { category: 'Irrigation & Water Management',
    items: [
      { name: 'Drip Irrigation Kit (1 acre)', nameHi: 'ड्रिप सिंचाई किट (1 एकड़)', nameMr: 'ठिबक सिंचन संच (१ एकर)',
        price: 18500, mrp: 22000, unit: 'kit', stock: 25, brand: 'Jain Irrigation',
        description: 'Complete drip kit for 1 acre — mainline, laterals, emitters, filter.',
        highlights: ['Saves 40% water', 'Govt. subsidy eligible'],
        tags: ['irrigation', 'drip'], isFeatured: true },
      { name: 'HDPE Sprinkler Set', nameHi: 'स्प्रिंकलर सेट', nameMr: 'स्प्रिंकलर संच',
        price: 4200, mrp: 4800, unit: 'set', stock: 60, brand: 'Netafim',
        description: 'Impact sprinkler set — covers ~50 sqm per head.',
        highlights: ['Wide coverage', 'Rust proof'], tags: ['irrigation', 'sprinkler'] },
    ]
  },
  // ── Farm Machinery & Equipment ──
  { category: 'Farm Machinery & Equipment',
    items: [
      { name: 'Power Tiller 7 HP', nameHi: 'पावर टिलर 7 एचपी', nameMr: 'पॉवर टिलर ७ एचपी',
        price: 78000, mrp: 85000, unit: 'unit', stock: 8, brand: 'Honda',
        description: 'Compact 7HP power tiller for small farms — fuel efficient.',
        highlights: ['Honda GX engine', 'Subsidy eligible'],
        tags: ['machinery', 'tiller'], isFeatured: true },
      { name: 'Rotavator 5 ft', nameHi: 'रोटावेटर 5 फीट', nameMr: 'रोटाव्हेटर ५ फूट',
        price: 62000, mrp: 70000, unit: 'unit', stock: 12, brand: 'Mahindra',
        description: 'Tractor-mounted rotavator for primary tillage.',
        highlights: ['Heavy duty', '42 blades'], tags: ['machinery', 'rotavator'] },
    ]
  },
  // ── Hand Tools & Small Equipment ──
  { category: 'Hand Tools & Small Equipment',
    items: [
      { name: 'Khurpi (Hand Weeder)', nameHi: 'खुरपी', nameMr: 'खुरपी',
        price: 120, mrp: 160, unit: 'piece', stock: 400, brand: 'Falcon',
        description: 'Forged steel hand weeder with wooden handle.',
        highlights: ['Forged steel', 'Comfort grip'], tags: ['tool', 'hand'] },
      { name: 'Sickle (Drati) Heavy Duty', nameHi: 'दराती', nameMr: 'विळा',
        price: 220, mrp: 260, unit: 'piece', stock: 350, brand: 'Falcon',
        description: 'Curved sickle for harvesting paddy, wheat.',
        highlights: ['Sharp edge', 'Anti-rust'], tags: ['tool', 'harvest'] },
      { name: 'Pickaxe (Phavda)', nameHi: 'फावड़ा', nameMr: 'फावडे',
        price: 350, mrp: 420, unit: 'piece', stock: 200, brand: 'Stanley',
        description: 'Heavy-duty pickaxe with hickory handle.',
        highlights: ['Hickory handle', 'Heat-treated head'], tags: ['tool'] },
    ]
  },
  // ── Protected Cultivation ──
  { category: 'Protected Cultivation',
    items: [
      { name: 'Polyhouse Film (200 micron) 100m', nameHi: 'पॉलीहाउस फिल्म 100 मी', nameMr: 'पॉलीहाऊस फिल्म १०० मी',
        price: 8500, mrp: 9800, unit: 'roll', stock: 30, brand: 'Tuflex',
        description: 'UV-stabilised polyethylene film for greenhouse covering. 5-year life.',
        highlights: ['UV-stabilised', '5-year warranty'], tags: ['polyhouse', 'film'] },
      { name: 'Shade Net 50% Green (3m × 10m)', nameHi: 'शेड नेट 50% हरा', nameMr: 'शेड नेट ५०% हिरवा',
        price: 1200, mrp: 1400, unit: 'roll', stock: 80, brand: 'Garware',
        description: 'HDPE shade net for nursery & sensitive crops.',
        highlights: ['50% shade', 'UV treated'], tags: ['shade', 'nursery'] },
    ]
  },
  // ── Micronutrients & Specialty Nutrition ──
  { category: 'Micronutrients & Specialty Nutrition',
    items: [
      { name: 'Chelated Zinc (Zn 12%) 1kg', nameHi: 'चेलेटेड ज़िंक 1 किलो', nameMr: 'चिलेटेड झिंक १ किलो',
        price: 480, mrp: 560, unit: 'kg', stock: 150, brand: 'Aries Agro',
        description: 'EDTA-chelated zinc for foliar spray. Corrects Zn deficiency.',
        highlights: ['EDTA chelated', 'Foliar grade'], tags: ['micronutrient', 'zinc'] },
      { name: 'Boron 20% (Solubor) 500g', nameHi: 'बोरॉन 20% (500g)', nameMr: 'बोरॉन २०% (५००g)',
        price: 280, mrp: 340, unit: 'pack', stock: 120, brand: 'Coromandel',
        description: 'Boron for flowering & fruit set in pulses, oilseeds, vegetables.',
        highlights: ['20% B', 'Improves fruit set'], tags: ['micronutrient', 'boron'] },
    ]
  },
  // ── Seeds Treatment & Additives ──
  { category: 'Seeds Treatment & Additives',
    items: [
      { name: 'Trichoderma viride 1kg', nameHi: 'ट्राइकोडर्मा (1 किलो)', nameMr: 'ट्रायकोडर्मा (१ किलो)',
        price: 340, mrp: 400, unit: 'kg', stock: 100, brand: 'Multiplex',
        description: 'Bio-fungicide for seed treatment & soil application.',
        highlights: ['Bio-control', '2×10⁹ CFU/g'], tags: ['biofertilizer', 'seed-treatment'] },
      { name: 'Carbendazim 50% WP (100g)', nameHi: 'कार्बेन्डाजिम 50% (100g)', nameMr: 'कार्बेंडाझिम ५०% (१००g)',
        price: 95, mrp: 120, unit: 'pack', stock: 250, brand: 'BASF',
        description: 'Systemic fungicide for seed dressing.',
        highlights: ['Systemic', 'Wide-spectrum'], tags: ['fungicide', 'seed-treatment'] },
    ]
  },
  // ── Livestock, Dairy & Poultry ──
  { category: 'Livestock, Dairy & Poultry',
    items: [
      { name: 'Mineral Mixture for Cattle 25kg', nameHi: 'मिनरल मिक्सचर 25 किलो', nameMr: 'मिनरल मिक्श्चर २५ किलो',
        price: 1450, mrp: 1700, unit: 'bag', stock: 80, brand: 'Godrej Agrovet',
        description: 'Balanced mineral mix for dairy cattle — boosts milk yield.',
        highlights: ['Calcium + trace minerals', 'Boosts milk yield'], tags: ['cattle', 'feed'] },
      { name: 'Poultry Feed Grower 50kg', nameHi: 'पोल्ट्री फीड (ग्रोवर) 50 किलो', nameMr: 'पोल्ट्री फीड (ग्रोवर) ५० किलो',
        price: 2100, mrp: 2400, unit: 'bag', stock: 120, brand: 'Venky\'s',
        description: 'Grower mash for broiler chicks 3-6 weeks.',
        highlights: ['22% crude protein', 'Antibiotic-free'], tags: ['poultry', 'feed'] },
    ]
  },
  // ── Fencing & Farm Protection ──
  { category: 'Fencing & Farm Protection',
    items: [
      { name: 'Barbed Wire 25kg Roll', nameHi: 'काँटेदार तार 25 किलो', nameMr: 'काटेरी तार २५ किलो',
        price: 2400, mrp: 2800, unit: 'roll', stock: 60, brand: 'Tata Wiron',
        description: 'GI barbed wire for boundary fencing. ~400m per roll.',
        highlights: ['GI coated', 'Rust resistant'], tags: ['fencing', 'wire'] },
      { name: 'Solar Electric Fence Energizer (5km)', nameHi: 'सोलर इलेक्ट्रिक फेंस', nameMr: 'सोलर इलेक्ट्रिक कुंपण',
        price: 8900, mrp: 10500, unit: 'unit', stock: 25, brand: 'Crompton',
        description: 'Solar-powered fence energizer to deter cattle, wild animals.',
        highlights: ['Solar powered', '5km range'], tags: ['fencing', 'solar'] },
    ]
  },
  // ── Storage & Packaging ──
  { category: 'Storage & Packaging',
    items: [
      { name: 'Jute Gunny Bags 50kg (10 pcs)', nameHi: 'जूट बोरे (10 नग)', nameMr: 'गोणी पिशव्या (१० नग)',
        price: 380, mrp: 450, unit: 'pack', stock: 300, brand: 'Local',
        description: 'Standard jute bags for grain storage.',
        highlights: ['Reusable', 'Breathable'], tags: ['storage', 'packaging'] },
      { name: 'HDPE Silo Bag 50kg (50 pcs)', nameHi: 'HDPE साइलो बैग (50 नग)', nameMr: 'एचडीपीई पिशव्या (५० नग)',
        price: 850, mrp: 1000, unit: 'pack', stock: 150, brand: 'Reliance',
        description: 'Moisture-resistant HDPE bags for long-term grain storage.',
        highlights: ['Moisture proof', 'UV stabilised'], tags: ['storage', 'hdpe'] },
    ]
  },
  // ── Agri Technology & Smart Farming ──
  { category: 'Agri Technology & Smart Farming',
    items: [
      { name: 'Soil Moisture Sensor Kit', nameHi: 'मिट्टी नमी सेंसर', nameMr: 'मातीची आर्द्रता सेन्सर',
        price: 1850, mrp: 2200, unit: 'unit', stock: 40, brand: 'Fyto',
        description: 'Capacitive soil moisture sensor with mobile app dashboard.',
        highlights: ['Mobile app', 'Solar charged'], tags: ['iot', 'sensor'], isFeatured: true },
      { name: 'Weather Station (Mini)', nameHi: 'मिनी मौसम स्टेशन', nameMr: 'मिनी हवामान स्टेशन',
        price: 12500, mrp: 14000, unit: 'unit', stock: 15, brand: 'Davis',
        description: 'On-farm weather station — temp, humidity, rainfall, wind.',
        highlights: ['5 sensors', 'Cloud sync'], tags: ['iot', 'weather'] },
    ]
  },
  // ── Solar & Energy ──
  { category: 'Solar & Energy',
    items: [
      { name: 'Solar Water Pump 3HP (DC)', nameHi: 'सोलर वाटर पंप 3HP', nameMr: 'सोलर वॉटर पंप ३HP',
        price: 145000, mrp: 165000, unit: 'unit', stock: 6, brand: 'Tata Power Solar',
        description: 'PMKUSUM-eligible DC submersible solar pump. 5-year warranty.',
        highlights: ['PMKUSUM eligible', '5-yr warranty'], tags: ['solar', 'pump'],
        isFeatured: true },
      { name: 'Solar LED Street Light 30W', nameHi: 'सोलर एलईडी स्ट्रीट लाइट 30W', nameMr: 'सोलर एलईडी स्ट्रीट लाइट ३०W',
        price: 4800, mrp: 5500, unit: 'unit', stock: 80, brand: 'Crompton',
        description: 'All-in-one solar street light with motion sensor.',
        highlights: ['Motion sensor', '12hr backup'], tags: ['solar', 'light'] },
    ]
  },
  // ── Safety & Protective Gear ──
  { category: 'Safety & Protective Gear',
    items: [
      { name: 'Spray Suit (Full Body PPE)', nameHi: 'स्प्रे सूट (PPE)', nameMr: 'स्प्रे सूट (पीपीई)',
        price: 850, mrp: 1000, unit: 'set', stock: 120, brand: '3M',
        description: 'Chemical-resistant suit for pesticide spraying. Includes hood, gloves.',
        highlights: ['Chemical resistant', 'Reusable'], tags: ['safety', 'ppe'] },
      { name: 'Respirator Mask (P2)', nameHi: 'रेस्पिरेटर मास्क', nameMr: 'रेस्पिरेटर मास्क',
        price: 220, mrp: 280, unit: 'piece', stock: 200, brand: '3M',
        description: 'P2-grade respirator for pesticide/dust protection.',
        highlights: ['P2 rated', 'Adjustable strap'], tags: ['safety', 'mask'] },
    ]
  },
  // ── Spraying Equipment ──
  { category: 'Spraying Equipment',
    items: [
      { name: 'Battery Sprayer 16L', nameHi: 'बैटरी स्प्रेयर 16L', nameMr: 'बॅटरी फवारणी पंप १६L',
        price: 2400, mrp: 2800, unit: 'unit', stock: 100, brand: 'Aspee',
        description: 'Rechargeable battery sprayer — 6 hrs runtime per charge.',
        highlights: ['6hr battery', '16L tank'], tags: ['sprayer', 'battery'],
        isFeatured: true },
      { name: 'Manual Knapsack Sprayer 16L', nameHi: 'हाथ से चलाया जाने वाला स्प्रेयर', nameMr: 'मॅन्युअल नापसॅक स्प्रेयर',
        price: 1100, mrp: 1300, unit: 'unit', stock: 180, brand: 'Aspee',
        description: 'Manual lever-operated knapsack sprayer.',
        highlights: ['No batteries', 'Durable'], tags: ['sprayer', 'manual'] },
    ]
  },
  // ── Harvesting & Post-Harvest ──
  { category: 'Harvesting & Post-Harvest',
    items: [
      { name: 'Mini Combine Harvester 14HP', nameHi: 'मिनी कम्बाइन हार्वेस्टर', nameMr: 'मिनी कम्बाइन हार्वेस्टर',
        price: 245000, mrp: 280000, unit: 'unit', stock: 4, brand: 'Kubota',
        description: 'Compact harvester for paddy/wheat on small plots.',
        highlights: ['14 HP diesel', '1 acre/hour'], tags: ['machinery', 'harvest'] },
      { name: 'Grain Threshing Drum', nameHi: 'थ्रेशर ड्रम', nameMr: 'थ्रेशर ड्रम',
        price: 38000, mrp: 45000, unit: 'unit', stock: 12, brand: 'Mahindra',
        description: 'Pedal/motor-operated threshing drum for paddy.',
        highlights: ['Manual/motor', 'High output'], tags: ['thresher'] },
    ]
  },
  // ── Aquaculture & Fisheries ──
  { category: 'Aquaculture & Fisheries',
    items: [
      { name: 'Aerator (1HP) for Fish Pond', nameHi: 'मछली तालाब एयरेटर', nameMr: 'मासेमारी तळ्यासाठी एरेटर',
        price: 14500, mrp: 16500, unit: 'unit', stock: 18, brand: 'CIFA',
        description: 'Paddle wheel aerator for prawn & fish ponds.',
        highlights: ['1HP motor', 'Increases DO'], tags: ['aquaculture', 'aerator'] },
      { name: 'Fish Feed Floating Pellets 25kg', nameHi: 'मछली फीड 25 किलो', nameMr: 'मासे खाद्य २५ किलो',
        price: 1850, mrp: 2100, unit: 'bag', stock: 80, brand: 'Growel',
        description: 'High-protein floating feed for tilapia, catla, rohu.',
        highlights: ['32% protein', 'Floating'], tags: ['aquaculture', 'feed'] },
    ]
  },
  // ── Horticulture & Nursery ──
  { category: 'Horticulture & Nursery',
    items: [
      { name: 'Mango Saplings (Kesar) — 5 plants', nameHi: 'केसर आम पौधे (5)', nameMr: 'केशर आंबा रोपे (५)',
        price: 850, mrp: 1000, unit: 'pack', stock: 60, brand: 'NurseryDirect',
        description: 'Grafted Kesar mango saplings, 1-year-old.',
        highlights: ['Grafted', '1 year old'], tags: ['nursery', 'fruit'] },
      { name: 'Coco-Peat Block 5kg', nameHi: 'कोको पीट ब्लॉक 5 किलो', nameMr: 'कोकोपीट ब्लॉक ५ किलो',
        price: 280, mrp: 340, unit: 'piece', stock: 250, brand: 'JustCocopeat',
        description: 'Compressed coir pith for nursery & hydroponics.',
        highlights: ['Expands 8×', 'pH balanced'], tags: ['nursery', 'cocopeat'] },
    ]
  },
  // ── Agri Inputs for Home & Kitchen Garden ──
  { category: 'Agri Inputs for Home & Kitchen Garden',
    items: [
      { name: 'Kitchen Garden Starter Kit', nameHi: 'किचन गार्डन किट', nameMr: 'किचन गार्डन किट',
        price: 1200, mrp: 1500, unit: 'kit', stock: 100, brand: 'UrbanFarms',
        description: '8 vegetable seeds + cocopeat + pots + manual.',
        highlights: ['8 varieties', 'Beginner friendly'],
        tags: ['home', 'kitchen-garden'], isFeatured: true },
      { name: 'Terracotta Planter (Set of 3)', nameHi: 'टेराकोटा गमले (3 नग)', nameMr: 'टेराकोटा कुंड्या (३ नग)',
        price: 540, mrp: 660, unit: 'set', stock: 120, brand: 'Local Artisan',
        description: 'Hand-thrown terracotta planters — 6", 8", 10".',
        highlights: ['Handmade', 'Breathable'], tags: ['planter', 'home'] },
    ]
  },
];

async function main() {
  console.log('Seeding products (~50 across 22 categories)...');

  // Pre-fetch all categories once to avoid N lookups
  const cats = await prisma.category.findMany();
  const catByName = Object.fromEntries(cats.map(c => [c.name, c.id]));

  let created = 0, updated = 0, skipped = 0;

  for (const group of PRODUCTS) {
    const categoryId = catByName[group.category];
    if (!categoryId) {
      console.warn(`  ⚠  Category not found: "${group.category}" — skipping ${group.items.length} products`);
      skipped += group.items.length;
      continue;
    }

    for (const item of group.items) {
      const data = {
        ...item,
        categoryId,
        // Default missing optional fields to sane values
        images: item.images ?? [],
        tags: item.tags ?? [],
        highlights: item.highlights ?? [],
        unit: item.unit ?? 'kg',
        sellScope: 'state',
      };

      const existing = await prisma.product.findFirst({
        where: { name: item.name, categoryId },
        select: { id: true },
      });

      if (existing) {
        await prisma.product.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.product.create({ data });
        created++;
      }
    }
  }

  console.log(`Done — created: ${created}, updated: ${updated}, skipped: ${skipped}`);
}

main()
  .catch(err => { console.error('❌ Seed failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
