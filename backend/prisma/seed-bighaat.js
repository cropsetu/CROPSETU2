/**
 * seed-bighaat.js — realistic AgriStore TEST catalogue: 5 products per category
 * across all 22 categories (110 products). Generated representative data
 * (real Indian agri brands/names/prices) for testing — NOT scraped. Images are
 * left empty so the app shows its colourful category-icon fallback.
 *
 * Idempotent: matches by (name, categoryId). Re-running updates price/stock
 * without duplicates. Run:  node prisma/seed-bighaat.js
 */
import prisma from '../src/config/db.js';

const PRODUCTS = [
  {
    "category": "Seeds & Planting Material",
    "items": [
      {
        "name": "Mahyco Hybrid Tomato Seeds (10g) - Variety 1057",
        "nameHi": "महिको हाइब्रिड टमाटर बीज (10g) - किस्म 1057",
        "nameMr": "महिको हायब्रिड टोमॅटो बियाणे (10g) - वाण 1057",
        "price": 195,
        "mrp": 240,
        "unit": "pack",
        "stock": 140,
        "brand": "Mahyco",
        "subcategory": "Vegetable Seeds",
        "manufacturer": "Maharashtra Hybrid Seeds Co. Pvt. Ltd.",
        "countryOfOrigin": "India",
        "description": "High-yield hybrid tomato seeds that grow strong plants with round, firm red fruits. Good for both home and market sale.",
        "highlights": [
          "Disease resistant plants",
          "Firm fruits, long shelf life",
          "Ready in 90-100 days",
          "Good for transport"
        ],
        "tags": [
          "seeds",
          "tomato",
          "vegetable",
          "hybrid"
        ]
      },
      {
        "name": "Rasi BG-II BT Cotton Seeds (475g) - RCH 659",
        "nameHi": "रासी BG-II बीटी कपास बीज (475g) - RCH 659",
        "nameMr": "रासी BG-II बीटी कापूस बियाणे (475g) - RCH 659",
        "price": 864,
        "mrp": 901,
        "unit": "pack",
        "stock": 90,
        "brand": "Rasi Seeds",
        "subcategory": "Field Crop Seeds",
        "manufacturer": "Rasi Seeds Pvt. Ltd.",
        "countryOfOrigin": "India",
        "description": "BT cotton seed packet for one acre. The plant fights bollworm on its own and gives strong, long cotton fibre.",
        "highlights": [
          "Bollworm (pink) resistant",
          "Government approved BG-II",
          "High cotton fibre quality",
          "Suited to rain-fed fields"
        ],
        "tags": [
          "seeds",
          "cotton",
          "bt",
          "kharif"
        ]
      },
      {
        "name": "Pioneer Hybrid Maize Seeds 4kg - P3396",
        "nameHi": "पायोनियर हाइब्रिड मक्का बीज 4kg - P3396",
        "nameMr": "पायोनियर हायब्रिड मका बियाणे 4kg - P3396",
        "price": 1450,
        "mrp": 1620,
        "unit": "pack",
        "stock": 110,
        "brand": "Pioneer",
        "subcategory": "Field Crop Seeds",
        "manufacturer": "Corteva Agriscience (Pioneer Seeds)",
        "countryOfOrigin": "India",
        "description": "Hybrid maize seeds for one acre that give big cobs and heavy grain. Stays strong in wind and gives high yield.",
        "highlights": [
          "Bold, heavy grain",
          "Stands well, less lodging",
          "Matures in 100-110 days",
          "Good for grain and fodder"
        ],
        "tags": [
          "seeds",
          "maize",
          "corn",
          "hybrid"
        ]
      },
      {
        "name": "Kaveri Paddy Seeds 5kg - KPH 468 (Fine Grain)",
        "nameHi": "कावेरी धान बीज 5kg - KPH 468 (बारीक दाना)",
        "nameMr": "कावेरी भात बियाणे 5kg - KPH 468 (बारीक दाणा)",
        "price": 540,
        "mrp": 620,
        "unit": "pack",
        "stock": 160,
        "brand": "Kaveri Seeds",
        "subcategory": "Field Crop Seeds",
        "manufacturer": "Kaveri Seed Company Ltd.",
        "countryOfOrigin": "India",
        "description": "Fine-grain paddy seeds for transplanting in flooded fields. Gives full panicles and good rice recovery at the mill.",
        "highlights": [
          "Fine long grain",
          "High milling recovery",
          "Matures in 130-135 days",
          "Suited to irrigated fields"
        ],
        "tags": [
          "seeds",
          "paddy",
          "rice",
          "kharif"
        ]
      },
      {
        "name": "Grafted Kesar Mango Sapling (Set of 5)",
        "nameHi": "ग्राफ्टेड केसर आम का पौधा (5 का सेट)",
        "nameMr": "कलमी केशर आंबा रोप (5 चा संच)",
        "price": 750,
        "mrp": 900,
        "unit": "set",
        "stock": 60,
        "brand": "Namdhari Seeds",
        "subcategory": "Planting Material",
        "manufacturer": "Namdhari Seeds Pvt. Ltd.",
        "countryOfOrigin": "India",
        "description": "Five healthy grafted Kesar mango plants ready to plant in your field or garden. Grafted plants give sweet fruit in fewer years.",
        "highlights": [
          "Grafted, true to variety",
          "Fruits in 3-4 years",
          "Sweet Kesar pulp",
          "Healthy nursery-raised roots"
        ],
        "tags": [
          "sapling",
          "mango",
          "fruit",
          "grafted",
          "plant"
        ]
      }
    ]
  },
  {
    "category": "Fertilizers & Soil Nutrition",
    "items": [
      {
        "name": "IFFCO Urea 45kg Bag",
        "nameHi": "IFFCO यूरिया 45 किलो बैग",
        "nameMr": "IFFCO युरिया 45 किलो बॅग",
        "price": 266,
        "mrp": 280,
        "unit": "bag",
        "stock": 480,
        "brand": "IFFCO",
        "subcategory": "Straight Nitrogen Fertilizer",
        "countryOfOrigin": "India",
        "manufacturer": "Indian Farmers Fertiliser Cooperative Ltd (IFFCO)",
        "description": "White granular urea that gives crops nitrogen for green, healthy leaves and fast growth. Spread evenly in the field and water after applying.",
        "highlights": [
          "46% nitrogen for strong leaf growth",
          "Suitable for all crops",
          "Government subsidized price",
          "45kg neem-coated bag"
        ],
        "tags": [
          "urea",
          "nitrogen",
          "iffco",
          "top dressing",
          "fertilizer"
        ]
      },
      {
        "name": "Coromandel DAP 50kg Bag",
        "nameHi": "Coromandel DAP 50 किलो बैग",
        "nameMr": "Coromandel DAP 50 किलो बॅग",
        "price": 1350,
        "mrp": 1400,
        "unit": "bag",
        "stock": 320,
        "brand": "Coromandel",
        "subcategory": "Phosphatic Fertilizer",
        "countryOfOrigin": "India",
        "manufacturer": "Coromandel International Ltd",
        "description": "Di-Ammonium Phosphate (DAP) gives crops phosphorus and nitrogen for strong roots at sowing time. Apply in the soil while sowing seeds.",
        "highlights": [
          "18% nitrogen and 46% phosphorus",
          "Best at sowing for strong roots",
          "Helps better flowering and grain filling",
          "50kg bag"
        ],
        "tags": [
          "dap",
          "phosphorus",
          "coromandel",
          "basal",
          "sowing"
        ]
      },
      {
        "name": "Mahadhan 10:26:26 NPK Complex 50kg Bag",
        "nameHi": "Mahadhan 10:26:26 NPK कॉम्प्लेक्स 50 किलो बैग",
        "nameMr": "Mahadhan 10:26:26 NPK कॉम्प्लेक्स 50 किलो बॅग",
        "price": 1470,
        "mrp": 1525,
        "unit": "bag",
        "stock": 210,
        "brand": "Mahadhan",
        "subcategory": "NPK Complex Fertilizer",
        "countryOfOrigin": "India",
        "manufacturer": "Deepak Fertilisers and Petrochemicals Corporation Ltd",
        "description": "A balanced complex fertilizer giving nitrogen, phosphorus and potash together for healthy roots, flowers and fruit. Good for cotton, sugarcane, chilli and vegetables.",
        "highlights": [
          "10% N, 26% P, 26% K balanced nutrition",
          "Boosts flowering and fruit setting",
          "Ideal for cotton, chilli and sugarcane",
          "50kg bag"
        ],
        "tags": [
          "npk",
          "complex",
          "10:26:26",
          "mahadhan",
          "potash"
        ]
      },
      {
        "name": "Tata Paras Zinc Sulphate 21% 5kg Pack",
        "nameHi": "Tata Paras जिंक सल्फेट 21% 5 किलो पैक",
        "nameMr": "Tata Paras झिंक सल्फेट 21% 5 किलो पॅक",
        "price": 320,
        "mrp": 360,
        "unit": "pack",
        "stock": 150,
        "brand": "Tata Paras",
        "subcategory": "Micronutrient",
        "countryOfOrigin": "India",
        "manufacturer": "Tata Chemicals Ltd",
        "description": "Zinc sulphate corrects zinc shortage in soil, which causes yellow leaves and stunted plants. Mix in soil or spray on leaves to get bigger, greener crops.",
        "highlights": [
          "21% zinc to fix zinc deficiency",
          "Stops yellowing and stunted growth",
          "Use in paddy, wheat and maize",
          "5kg pack"
        ],
        "tags": [
          "zinc sulphate",
          "micronutrient",
          "tata paras",
          "deficiency",
          "soil"
        ]
      },
      {
        "name": "Multiplex General Liquid Micronutrient 1L Bottle",
        "nameHi": "Multiplex General लिक्विड माइक्रोन्यूट्रिएंट 1 लीटर बोतल",
        "nameMr": "Multiplex General लिक्विड मायक्रोन्यूट्रिएंट 1 लिटर बाटली",
        "price": 410,
        "mrp": 470,
        "unit": "bottle",
        "stock": 260,
        "brand": "Multiplex",
        "subcategory": "Liquid Micronutrient",
        "countryOfOrigin": "India",
        "manufacturer": "Multiplex Group (Karnataka Agro Chemicals)",
        "description": "A liquid mix of zinc, iron, manganese, boron and other micronutrients to spray on leaves. Quickly fixes nutrient shortage and makes plants greener and stronger.",
        "highlights": [
          "All-in-one micronutrient mix",
          "Spray on leaves for fast results",
          "Greener leaves and better yield",
          "1 litre bottle"
        ],
        "tags": [
          "micronutrient",
          "foliar spray",
          "multiplex",
          "liquid",
          "boron"
        ]
      }
    ]
  },
  {
    "category": "Crop Protection",
    "items": [
      {
        "name": "Confidor Imidacloprid 30.5% SC (250ml)",
        "nameHi": "कॉन्फिडोर इमिडाक्लोप्रिड 30.5% SC (250ml)",
        "nameMr": "कॉन्फिडोर इमिडाक्लोप्रिड ३०.५% SC (२५०ml)",
        "price": 620,
        "mrp": 725,
        "unit": "bottle",
        "stock": 140,
        "brand": "Bayer",
        "manufacturer": "Bayer CropScience Ltd",
        "countryOfOrigin": "India",
        "subcategory": "Insecticide",
        "description": "Spray on cotton, rice and vegetables to kill sucking pests like aphids, jassids and whiteflies. A small dose works for a long time.",
        "highlights": [
          "Controls sucking pests",
          "Long-lasting systemic action",
          "Low dose per acre",
          "For cotton, rice & veg"
        ],
        "tags": [
          "insecticide",
          "imidacloprid",
          "sucking-pest",
          "bayer"
        ]
      },
      {
        "name": "Glycel Glyphosate 41% SL Weedicide (1L)",
        "nameHi": "ग्लाइसेल ग्लाइफोसेट 41% SL खरपतवारनाशक (1L)",
        "nameMr": "ग्लायसेल ग्लायफोसेट ४१% SL तणनाशक (१L)",
        "price": 410,
        "mrp": 480,
        "unit": "bottle",
        "stock": 220,
        "brand": "UPL",
        "manufacturer": "UPL Limited",
        "countryOfOrigin": "India",
        "subcategory": "Herbicide",
        "description": "Spray on empty fields, bunds and orchard floors to kill all kinds of grass and weeds from the root. Clears land before sowing.",
        "highlights": [
          "Kills weeds from the root",
          "Use on non-crop land & bunds",
          "Works on grass & broadleaf weeds",
          "Cleans field before sowing"
        ],
        "tags": [
          "herbicide",
          "weedicide",
          "glyphosate",
          "upl"
        ]
      },
      {
        "name": "Taqat Hexaconazole + Captan Fungicide (500g)",
        "nameHi": "ताकत हेक्साकोनाझोल + कैप्टन फफूंदीनाशक (500g)",
        "nameMr": "ताकत हेक्साकोनाझोल + कॅप्टन बुरशीनाशक (५००g)",
        "price": 540,
        "mrp": 640,
        "unit": "pack",
        "stock": 95,
        "brand": "Tata Rallis",
        "manufacturer": "Rallis India Ltd (Tata Group)",
        "countryOfOrigin": "India",
        "subcategory": "Fungicide",
        "description": "A double-action powder that stops blight, rust and leaf spot diseases on your crops. Mix with water and spray on leaves.",
        "highlights": [
          "Two fungicides in one",
          "Controls blight, rust & leaf spot",
          "Both protects & cures",
          "Rain-fast on leaves"
        ],
        "tags": [
          "fungicide",
          "hexaconazole",
          "disease-control",
          "rallis"
        ]
      },
      {
        "name": "Aatank Cypermethrin 25% EC Insecticide (1L)",
        "nameHi": "आतंक साइपरमेथ्रिन 25% EC कीटनाशक (1L)",
        "nameMr": "आतंक सायपरमेथ्रिन २५% EC कीटकनाशक (१L)",
        "price": 680,
        "mrp": 790,
        "unit": "bottle",
        "stock": 110,
        "brand": "Dhanuka",
        "manufacturer": "Dhanuka Agritech Ltd",
        "countryOfOrigin": "India",
        "subcategory": "Insecticide",
        "description": "A fast-acting spray that kills bollworms, caterpillars and borers on cotton, vegetables and pulses. Pests die quickly after contact.",
        "highlights": [
          "Quick knockdown of pests",
          "Controls bollworm & caterpillars",
          "For cotton, veg & pulses",
          "Contact + stomach action"
        ],
        "tags": [
          "insecticide",
          "cypermethrin",
          "caterpillar",
          "dhanuka"
        ]
      },
      {
        "name": "Crystal Neem Oil 1500 PPM Bio-Pesticide (500ml)",
        "nameHi": "क्रिस्टल नीम तेल 1500 PPM जैविक कीटनाशक (500ml)",
        "nameMr": "क्रिस्टल कडुनिंब तेल १५०० PPM जैविक कीटकनाशक (५००ml)",
        "price": 260,
        "mrp": 320,
        "unit": "bottle",
        "stock": 300,
        "brand": "Crystal",
        "manufacturer": "Crystal Crop Protection Ltd",
        "countryOfOrigin": "India",
        "subcategory": "Bio-Pesticide",
        "description": "Natural neem-based spray that keeps insects and mites away and is safe for organic farming. Good for vegetables and fruit crops.",
        "highlights": [
          "Natural & organic-safe",
          "Repels insects & mites",
          "Safe for friendly insects",
          "No harmful residue"
        ],
        "tags": [
          "bio-pesticide",
          "neem-oil",
          "organic",
          "crystal"
        ]
      }
    ]
  },
  {
    "category": "Organic & Natural Farming",
    "items": [
      {
        "name": "IFFCO Sagarika Liquid Bio-Stimulant 500ml",
        "nameHi": "IFFCO सागरिका लिक्विड जैव-उत्तेजक 500ml",
        "nameMr": "IFFCO सागरिका लिक्विड जैव-उत्तेजक 500ml",
        "price": 250,
        "mrp": 295,
        "unit": "bottle",
        "stock": 180,
        "brand": "IFFCO",
        "subcategory": "Bio-Stimulant",
        "countryOfOrigin": "India",
        "manufacturer": "Indian Farmers Fertiliser Cooperative Ltd (IFFCO)",
        "description": "Seaweed-based liquid tonic that makes plants stronger and helps flowers and fruits grow better. Mix in water and spray on the crop or give through drip.",
        "highlights": [
          "Made from natural seaweed extract",
          "Increases flowering and yield",
          "Works on all crops",
          "Use as spray or with drip irrigation"
        ],
        "tags": [
          "bio-stimulant",
          "seaweed",
          "organic",
          "iffco",
          "growth promoter"
        ]
      },
      {
        "name": "T Stanes Multiplex Neem Oil 1500 PPM 1L",
        "nameHi": "T Stanes मल्टीप्लेक्स नीम तेल 1500 PPM 1L",
        "nameMr": "T Stanes मल्टीप्लेक्स कडुनिंब तेल 1500 PPM 1L",
        "price": 360,
        "mrp": 420,
        "unit": "L",
        "stock": 140,
        "brand": "T Stanes",
        "subcategory": "Bio-Pesticide",
        "countryOfOrigin": "India",
        "manufacturer": "T. Stanes & Company Limited",
        "description": "Pure neem oil that kills small insects, sucking pests and mites without harming the crop. Safe natural spray for vegetables, fruits and cotton.",
        "highlights": [
          "Cold-pressed pure neem oil (1500 PPM Azadirachtin)",
          "Controls aphids, whitefly and mites",
          "Safe for soil and useful insects",
          "Allowed in organic farming"
        ],
        "tags": [
          "neem oil",
          "bio-pesticide",
          "organic",
          "pest control",
          "azadirachtin"
        ]
      },
      {
        "name": "Annapurna Vermicompost Organic Manure 50kg Bag",
        "nameHi": "अन्नपूर्णा वर्मीकम्पोस्ट जैविक खाद 50kg बैग",
        "nameMr": "अन्नपूर्णा गांडूळ खत सेंद्रिय खत 50kg बॅग",
        "price": 420,
        "mrp": 500,
        "unit": "bag",
        "stock": 95,
        "brand": "Annapurna",
        "subcategory": "Organic Manure",
        "countryOfOrigin": "India",
        "manufacturer": "Annapurna Agro Industries",
        "description": "Earthworm-made compost that adds natural food to the soil and helps roots grow well. Spread in the field before sowing for healthy, strong plants.",
        "highlights": [
          "100% natural earthworm compost",
          "Improves soil and holds water",
          "No chemicals, fully organic",
          "Good for all crops and kitchen garden"
        ],
        "tags": [
          "vermicompost",
          "organic manure",
          "soil health",
          "compost",
          "natural"
        ]
      },
      {
        "name": "Multiplex Annapurna Bio-Fertilizer (Azotobacter) 1kg",
        "nameHi": "Multiplex अन्नपूर्णा जैव-उर्वरक (एज़ोटोबैक्टर) 1kg",
        "nameMr": "Multiplex अन्नपूर्णा जैव-खत (अ‍ॅझोटोबॅक्टर) 1kg",
        "price": 150,
        "mrp": 180,
        "unit": "kg",
        "stock": 220,
        "brand": "Multiplex",
        "subcategory": "Bio-Fertilizer",
        "countryOfOrigin": "India",
        "manufacturer": "Multiplex Biotech Pvt Ltd",
        "description": "Live good bacteria that take nitrogen from air and give it to the plant, so you need less urea. Mix with seed or soil before sowing.",
        "highlights": [
          "Natural nitrogen-fixing bacteria",
          "Reduces urea cost",
          "Use for seed treatment or soil",
          "Safe and eco-friendly"
        ],
        "tags": [
          "bio-fertilizer",
          "azotobacter",
          "nitrogen",
          "organic",
          "seed treatment"
        ]
      },
      {
        "name": "Jeevamrutham Ready Organic Liquid Culture 5L Can",
        "nameHi": "जीवामृतम् रेडी जैविक तरल कल्चर 5L कैन",
        "nameMr": "जीवामृतम् रेडी सेंद्रिय द्रव कल्चर 5L कॅन",
        "price": 320,
        "mrp": 399,
        "unit": "L",
        "stock": 110,
        "brand": "Captain",
        "subcategory": "Microbial Culture",
        "countryOfOrigin": "India",
        "manufacturer": "Captain Polyplast (Captain Organics)",
        "description": "Ready-made Jeevamrut liquid full of useful microbes for natural farming. Mix in water and give to soil to wake up the land and feed the crop.",
        "highlights": [
          "Ready-to-use Jeevamrut culture",
          "Boosts soil microbes naturally",
          "Best for zero-budget natural farming",
          "Apply through drip or flood water"
        ],
        "tags": [
          "jeevamrut",
          "natural farming",
          "microbial",
          "organic",
          "soil culture"
        ]
      }
    ]
  },
  {
    "category": "Plant Growth Regulators",
    "items": [
      {
        "name": "Planofix (NAA 4.5% SL) 250ml Bottle",
        "nameHi": "Planofix (NAA 4.5% SL) 250ml बोतल",
        "nameMr": "Planofix (NAA 4.5% SL) 250ml बाटली",
        "price": 245,
        "mrp": 290,
        "unit": "bottle",
        "stock": 120,
        "brand": "Bayer",
        "subcategory": "Auxin (NAA)",
        "countryOfOrigin": "India",
        "manufacturer": "Bayer CropScience Ltd",
        "description": "Yeh dawai phool aur phal ko jhadne se rokti hai aur fasal ki paidawar badhati hai. Cotton, tomato, mirchi aur angoor jaisi faslon par chhidkav karein.",
        "highlights": [
          "Phool aur phal girna kam karta hai",
          "Naphthyl Acetic Acid (NAA) 4.5% SL",
          "Cotton, tamatar, mirchi, angoor ke liye",
          "Paidawar aur quality dono badhe"
        ],
        "tags": [
          "naa",
          "planofix",
          "flower drop",
          "growth regulator",
          "bayer"
        ]
      },
      {
        "name": "Sumitomo Progibb GA3 (Gibberellic Acid 0.186% SP) 100g Pack",
        "nameHi": "Sumitomo Progibb GA3 (Gibberellic Acid 0.186% SP) 100g पैक",
        "nameMr": "Sumitomo Progibb GA3 (Gibberellic Acid 0.186% SP) 100g पॅक",
        "price": 480,
        "mrp": 560,
        "unit": "pack",
        "stock": 80,
        "brand": "Sumitomo",
        "subcategory": "Gibberellic Acid (GA3)",
        "countryOfOrigin": "India",
        "manufacturer": "Sumitomo Chemical India Ltd",
        "description": "Yeh dawai paudhe ki badhwar tez karti hai aur angoor, ganne aur sabziyon ka size aur weight badhati hai. Pani me ghol kar chhidkav karein.",
        "highlights": [
          "Gibberellic Acid (GA3) 0.186% SP",
          "Fruit aur dana ka size bada karta hai",
          "Angoor, ganna, sabzi ke liye uttam",
          "Paudhe ki tezi se badhwar"
        ],
        "tags": [
          "ga3",
          "gibberellic acid",
          "progibb",
          "grape",
          "growth promoter"
        ]
      },
      {
        "name": "Cultar (Paclobutrazol 23% SC) 1L Bottle",
        "nameHi": "Cultar (Paclobutrazol 23% SC) 1L बोतल",
        "nameMr": "Cultar (Paclobutrazol 23% SC) 1L बाटली",
        "price": 2150,
        "mrp": 2450,
        "unit": "bottle",
        "stock": 45,
        "brand": "Syngenta",
        "subcategory": "Growth Retardant (Paclobutrazol)",
        "countryOfOrigin": "India",
        "manufacturer": "Syngenta India Ltd",
        "description": "Yeh dawai aam (mango) ke ped me jaldi aur zyada baur (flowering) laane me madad karti hai. Ped ki jad ke paas mitti me dali jaati hai.",
        "highlights": [
          "Paclobutrazol 23% SC",
          "Aam me jaldi aur zyada flowering",
          "Mango ki paidawar badhaye",
          "Soil application waali dawai"
        ],
        "tags": [
          "paclobutrazol",
          "cultar",
          "mango",
          "flowering",
          "syngenta"
        ]
      },
      {
        "name": "Double (Homobrassinolide 0.04% W/W) 500ml Bottle",
        "nameHi": "Double (Homobrassinolide 0.04% W/W) 500ml बोतल",
        "nameMr": "Double (Homobrassinolide 0.04% W/W) 500ml बाटली",
        "price": 520,
        "mrp": 620,
        "unit": "bottle",
        "stock": 95,
        "brand": "Crystal",
        "subcategory": "Brassinolide",
        "countryOfOrigin": "India",
        "manufacturer": "Crystal Crop Protection Ltd",
        "description": "Yeh dawai fasal ko stress (garmi, sookha) se ladne ki taqat deti hai aur achhi badhwar karti hai. Sabhi faslon par chhidkav kar sakte hain.",
        "highlights": [
          "Homobrassinolide 0.04% W/W",
          "Garmi aur sookhe me fasal bachaye",
          "Sabhi faslon ke liye safe",
          "Achhi badhwar aur zyada paidawar"
        ],
        "tags": [
          "homobrassinolide",
          "brassinolide",
          "stress",
          "crystal",
          "yield"
        ]
      },
      {
        "name": "Maxin (Triacontanol 0.05% EC) 1L Can",
        "nameHi": "Maxin (Triacontanol 0.05% EC) 1L कैन",
        "nameMr": "Maxin (Triacontanol 0.05% EC) 1L कॅन",
        "price": 390,
        "mrp": 460,
        "unit": "L",
        "stock": 110,
        "brand": "Dhanuka",
        "subcategory": "Triacontanol",
        "countryOfOrigin": "India",
        "manufacturer": "Dhanuka Agritech Ltd",
        "description": "Yeh dawai paudhe ke patte hara-bhara aur mazboot banati hai aur dhaan, gehu, sabzi ki paidawar badhati hai. Pani me ghol kar patton par chhidkav karein.",
        "highlights": [
          "Triacontanol 0.05% EC",
          "Patte hare aur paudha mazboot",
          "Dhaan, gehu, sabzi ke liye",
          "Paidawar me badhotari"
        ],
        "tags": [
          "triacontanol",
          "maxin",
          "dhanuka",
          "growth promoter",
          "yield"
        ]
      }
    ]
  },
  {
    "category": "Irrigation & Water Management",
    "items": [
      {
        "name": "Drip Lateral Inline Pipe 16mm 400m Roll (30cm Spacing)",
        "nameHi": "ड्रिप लैटरल इनलाइन पाइप 16mm 400m रोल (30cm दूरी)",
        "nameMr": "ड्रिप लॅटरल इनलाइन पाईप 16mm 400m रोल (30cm अंतर)",
        "price": 2850,
        "mrp": 3400,
        "unit": "roll",
        "stock": 60,
        "brand": "Jain Irrigation",
        "subcategory": "Drip Irrigation",
        "description": "Black plastic drip pipe with built-in droppers every 30cm. Lay it along the crop rows so water drips slowly to each plant and saves water.",
        "highlights": [
          "Droppers fitted inside every 30cm, 4 litre per hour",
          "Full 400 metre roll, ISI marked pipe",
          "Saves up to 50% water versus flood watering",
          "Good for vegetables, cotton and sugarcane rows"
        ],
        "tags": [
          "drip",
          "lateral pipe",
          "16mm",
          "water saving",
          "jain"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Jain Irrigation Systems Ltd, Jalgaon"
      },
      {
        "name": "Rain Hose Sprinkler Set 32mm 50m with End Cap",
        "nameHi": "रेन होज़ स्प्रिंकलर सेट 32mm 50m एंड कैप के साथ",
        "nameMr": "रेन होज स्प्रिंकलर सेट 32mm 50m एंड कॅपसह",
        "price": 1450,
        "mrp": 1799,
        "unit": "set",
        "stock": 80,
        "brand": "Finolex",
        "subcategory": "Sprinkler Irrigation",
        "description": "A long flat pipe with small holes that sprays water like light rain over the field. Just connect to your pump and spread it across the beds.",
        "highlights": [
          "Sprays water like soft rain on leafy crops",
          "50 metre flat hose, easy to roll and shift",
          "Best for onion, garlic, fenugreek and nursery beds",
          "Connects directly to 32mm pump outlet"
        ],
        "tags": [
          "rain hose",
          "sprinkler",
          "32mm",
          "vegetable",
          "finolex"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Finolex Industries Ltd, Pune"
      },
      {
        "name": "Screen Filter 2 inch (50mm) Disc Type for Drip System",
        "nameHi": "स्क्रीन फिल्टर 2 इंच (50mm) ड्रिप सिस्टम के लिए",
        "nameMr": "स्क्रीन फिल्टर 2 इंच (50mm) ड्रिप सिस्टमसाठी",
        "price": 1100,
        "mrp": 1450,
        "unit": "piece",
        "stock": 45,
        "brand": "Netafim",
        "subcategory": "Filters & Fittings",
        "description": "A filter fitted before the drip pipes that catches sand and dirt from the water. This stops the small drippers from getting blocked.",
        "highlights": [
          "Stops drip droppers from choking with mud and sand",
          "2 inch (50mm) size for tube-well and tank water",
          "Strong plastic body, easy to open and clean mesh",
          "Long life stainless steel screen inside"
        ],
        "tags": [
          "filter",
          "drip",
          "2 inch",
          "netafim",
          "fittings"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Netafim Irrigation India Pvt Ltd, Vadodara"
      },
      {
        "name": "HDPE Sprinkler Pipe Set 63mm 6m x 30 Pipes with Sprinkler Heads",
        "nameHi": "HDPE स्प्रिंकलर पाइप सेट 63mm 6m x 30 पाइप स्प्रिंकलर हेड के साथ",
        "nameMr": "HDPE स्प्रिंकलर पाईप सेट 63mm 6m x 30 पाईप स्प्रिंकलर हेडसह",
        "price": 18500,
        "mrp": 21000,
        "unit": "set",
        "stock": 15,
        "brand": "Premier Irrigation Adritec",
        "subcategory": "Sprinkler Irrigation",
        "description": "A full set of 30 light pipes with quick joints and sprinkler heads that throw water in a circle over the field. Move the pipes to water the whole farm.",
        "highlights": [
          "Covers about 1 acre, 30 pipes of 6 metre each",
          "Quick-coupling joints, easy to join and shift by hand",
          "Brass rotating sprinkler heads for even watering",
          "Best for wheat, groundnut and pulses"
        ],
        "tags": [
          "sprinkler set",
          "hdpe pipe",
          "63mm",
          "1 acre",
          "premier"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Premier Irrigation Adritec Pvt Ltd, Kolkata"
      },
      {
        "name": "Venturi Fertigation Injector 1 inch (25mm) for Drip Lines",
        "nameHi": "वेंचुरी फर्टिगेशन इंजेक्टर 1 इंच (25mm) ड्रिप लाइन के लिए",
        "nameMr": "व्हेंचुरी फर्टिगेशन इंजेक्टर 1 इंच (25mm) ड्रिप लाईनसाठी",
        "price": 480,
        "mrp": 650,
        "unit": "piece",
        "stock": 120,
        "brand": "Captain Polyplast",
        "subcategory": "Fertigation",
        "description": "A small fitting that pulls liquid fertiliser into the drip water and feeds it straight to plant roots. Saves fertiliser and the work of spreading by hand.",
        "highlights": [
          "Mixes water-soluble fertiliser into the drip line",
          "1 inch (25mm) size, fits common drip mains",
          "No moving parts, works on water pressure alone",
          "Saves fertiliser and gives faster crop growth"
        ],
        "tags": [
          "venturi",
          "fertigation",
          "fertiliser injector",
          "25mm",
          "drip"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Captain Polyplast Ltd, Rajkot"
      }
    ]
  },
  {
    "category": "Farm Machinery & Equipment",
    "items": [
      {
        "name": "Manual Knapsack Sprayer 16L",
        "nameHi": "मैनुअल नैपसैक स्प्रेयर 16L",
        "nameMr": "मॅन्युअल नॅपसॅक फवारणी पंप 16L",
        "price": 950,
        "mrp": 1250,
        "unit": "piece",
        "stock": 120,
        "brand": "Kisan Kraft",
        "subcategory": "Sprayers",
        "countryOfOrigin": "India",
        "manufacturer": "Kisan Kraft Limited",
        "description": "Back-mounted hand pump sprayer with a 16 litre tank. Pump the lever by hand to spray pesticide, weedkiller or liquid fertiliser on your crop.",
        "highlights": [
          "16 litre tank holds plenty for one round",
          "Comfortable padded shoulder straps",
          "Brass nozzle for fine even spray",
          "No fuel or electricity needed"
        ],
        "tags": [
          "sprayer",
          "knapsack",
          "pesticide",
          "16 litre",
          "manual"
        ]
      },
      {
        "name": "Battery Operated Sprayer 16L (12V 8Ah)",
        "nameHi": "बैटरी संचालित स्प्रेयर 16L (12V 8Ah)",
        "nameMr": "बॅटरी फवारणी पंप 16L (12V 8Ah)",
        "price": 2150,
        "mrp": 2899,
        "unit": "piece",
        "stock": 85,
        "brand": "Neptune",
        "subcategory": "Sprayers",
        "countryOfOrigin": "India",
        "manufacturer": "Neptune Agro Engineering",
        "description": "Rechargeable battery sprayer with a 16 litre tank. Charge it overnight and spray your field without pumping by hand, saving your arm and time.",
        "highlights": [
          "12V 8Ah battery runs many hours per charge",
          "No hand pumping, just press the switch",
          "Comes with charger and spare nozzles",
          "Adjustable spray from mist to jet"
        ],
        "tags": [
          "battery sprayer",
          "rechargeable",
          "16 litre",
          "spraying",
          "neptune"
        ]
      },
      {
        "name": "Power Weeder 5HP Petrol (Mini Tiller)",
        "nameHi": "पावर वीडर 5HP पेट्रोल (मिनी टिलर)",
        "nameMr": "पॉवर वीडर 5HP पेट्रोल (मिनी टिलर)",
        "price": 28500,
        "mrp": 34000,
        "unit": "unit",
        "stock": 18,
        "brand": "Honda",
        "subcategory": "Tillers & Weeders",
        "countryOfOrigin": "India",
        "manufacturer": "Honda India Power Products Ltd",
        "description": "Petrol-powered mini tiller that loosens soil and removes weeds between crop rows. Saves many hours of hard labour and works well in small to medium fields.",
        "highlights": [
          "Strong 5HP petrol engine",
          "Easy pull-start, simple to handle",
          "Tills soil and clears weeds together",
          "Good for vegetable and orchard rows"
        ],
        "tags": [
          "power weeder",
          "mini tiller",
          "petrol",
          "weeding",
          "tilling"
        ]
      },
      {
        "name": "Brush Cutter 2-Stroke 43cc (Side Pack)",
        "nameHi": "ब्रश कटर 2-स्ट्रोक 43cc (साइड पैक)",
        "nameMr": "ब्रश कटर 2-स्ट्रोक 43cc (साइड पॅक)",
        "price": 6200,
        "mrp": 7999,
        "unit": "unit",
        "stock": 40,
        "brand": "Kisan Kraft",
        "subcategory": "Cutters & Harvesters",
        "countryOfOrigin": "India",
        "manufacturer": "Kisan Kraft Limited",
        "description": "Petrol brush cutter you carry on your shoulder to cut grass, weeds and small bushes. The spinning blade clears overgrown field edges and bunds fast.",
        "highlights": [
          "Powerful 43cc 2-stroke engine",
          "Cuts grass, weeds and thin shrubs",
          "Comes with blade and nylon trimmer head",
          "Shoulder harness for easy carrying"
        ],
        "tags": [
          "brush cutter",
          "grass cutter",
          "43cc",
          "petrol",
          "weeding"
        ]
      },
      {
        "name": "Chaff Cutter Electric 2HP (Toka Machine)",
        "nameHi": "चाफ कटर इलेक्ट्रिक 2HP (तोका मशीन)",
        "nameMr": "कडबा कुट्टी मशीन इलेक्ट्रिक 2HP (टोका मशीन)",
        "price": 14500,
        "mrp": 17500,
        "unit": "unit",
        "stock": 25,
        "brand": "Captain",
        "subcategory": "Fodder & Dairy Equipment",
        "countryOfOrigin": "India",
        "manufacturer": "Captain Agri Machinery (Captain Tractors Pvt Ltd)",
        "description": "Electric machine that cuts green or dry fodder into small pieces for cattle. Chopped fodder is easier for animals to eat and wastes less feed.",
        "highlights": [
          "2HP electric motor, runs on single phase",
          "Cuts both green grass and dry stalks",
          "Sharp steel blades for clean chopping",
          "Saves time over hand cutting fodder"
        ],
        "tags": [
          "chaff cutter",
          "toka machine",
          "fodder cutter",
          "cattle feed",
          "electric"
        ]
      }
    ]
  },
  {
    "category": "Hand Tools & Small Equipment",
    "items": [
      {
        "name": "Knapsack Sprayer 16L",
        "nameHi": "नैपसैक स्प्रेयर 16 लीटर",
        "nameMr": "नॅपसॅक फवारणी पंप 16 लिटर",
        "price": 1150,
        "mrp": 1499,
        "unit": "piece",
        "stock": 60,
        "brand": "Neptune",
        "subcategory": "Sprayers",
        "manufacturer": "Neptune Equipments, Ahmedabad",
        "countryOfOrigin": "India",
        "description": "Back-mounted 16 litre hand sprayer for spraying medicine and weedkiller on the crop. Pump the handle by hand and spray, no electricity needed.",
        "highlights": [
          "16 litre big tank, covers more area in one fill",
          "Soft shoulder straps, comfortable to carry on back",
          "Brass nozzle gives fine spray",
          "Strong handle pump, no battery or fuel needed"
        ],
        "tags": [
          "sprayer",
          "knapsack",
          "pesticide spray",
          "hand pump",
          "16 litre"
        ]
      },
      {
        "name": "Battery Sprayer 18L Double Motor",
        "nameHi": "बैटरी स्प्रेयर 18 लीटर डबल मोटर",
        "nameMr": "बॅटरी फवारणी पंप 18 लिटर डबल मोटर",
        "price": 2350,
        "mrp": 2999,
        "unit": "piece",
        "stock": 45,
        "brand": "Kisan Kraft",
        "subcategory": "Sprayers",
        "manufacturer": "Kisan Kraft Ltd, Bengaluru",
        "countryOfOrigin": "India",
        "description": "18 litre rechargeable battery sprayer with two motors for strong spray. Charge it once and spray for hours without pumping by hand.",
        "highlights": [
          "Rechargeable battery, no hand pumping needed",
          "Double motor for extra spray pressure",
          "12V 8Ah battery, long backup on one charge",
          "Comes with charger and extra nozzles"
        ],
        "tags": [
          "battery sprayer",
          "rechargeable",
          "double motor",
          "18 litre",
          "spray pump"
        ]
      },
      {
        "name": "Khurpi & Hand Hoe Garden Set (3 Piece)",
        "nameHi": "खुरपी और हैंड हो बागवानी सेट (3 पीस)",
        "nameMr": "खुरपी आणि हात कुदळ बाग सेट (3 नग)",
        "price": 299,
        "mrp": 449,
        "unit": "set",
        "stock": 120,
        "brand": "Falcon",
        "subcategory": "Digging & Weeding Tools",
        "manufacturer": "Falcon Garden Tools Pvt Ltd, Ludhiana",
        "countryOfOrigin": "India",
        "description": "Set of 3 small hand tools - khurpi, hand hoe and weeder. Use for digging soil, removing weeds and planting in the kitchen garden or field beds.",
        "highlights": [
          "3 useful tools in one set, good value",
          "Strong steel blade, does not bend easily",
          "Plastic grip handle, easy to hold",
          "Good for weeding, digging and planting"
        ],
        "tags": [
          "khurpi",
          "hand hoe",
          "weeder",
          "garden tools",
          "weeding"
        ]
      },
      {
        "name": "Pruning Secateur Bypass 8 inch",
        "nameHi": "प्रूनिंग सेकेटर बायपास 8 इंच",
        "nameMr": "छाटणी कात्री बायपास 8 इंच",
        "price": 549,
        "mrp": 799,
        "unit": "piece",
        "stock": 80,
        "brand": "Wolf-Garten",
        "subcategory": "Cutting & Pruning Tools",
        "manufacturer": "Wolf-Garten India, distributed by Goodearth",
        "countryOfOrigin": "Germany",
        "description": "Hand pruning shears for cutting small branches, stems and flowers. Sharp bypass blade gives a clean cut without harming the plant.",
        "highlights": [
          "Sharp bypass blade for clean cuts",
          "Cuts branches up to 20mm thick",
          "Safety lock to keep blade closed",
          "Comfortable non-slip grip"
        ],
        "tags": [
          "secateur",
          "pruning shears",
          "cutting tool",
          "bypass",
          "garden cutter"
        ]
      },
      {
        "name": "Vati Sickle (Darati) Serrated 7 inch",
        "nameHi": "वटी हंसिया (दरांती) दांतेदार 7 इंच",
        "nameMr": "वाटी विळा (दरांती) दातेरी 7 इंच",
        "price": 159,
        "mrp": 249,
        "unit": "piece",
        "stock": 200,
        "brand": "Falcon",
        "subcategory": "Harvesting Tools",
        "manufacturer": "Falcon Garden Tools Pvt Ltd, Ludhiana",
        "countryOfOrigin": "India",
        "description": "Sharp curved sickle with teeth for cutting wheat, paddy, grass and fodder by hand. The serrated edge cuts crop fast and clean.",
        "highlights": [
          "Serrated teeth cut crop quickly",
          "Hardened steel blade stays sharp longer",
          "Strong wooden handle, firm grip",
          "Good for harvesting and cutting grass"
        ],
        "tags": [
          "sickle",
          "darati",
          "harvesting",
          "serrated",
          "crop cutter"
        ]
      }
    ]
  },
  {
    "category": "Protected Cultivation",
    "items": [
      {
        "name": "Green Shade Net 50% 3m x 50m Roll",
        "nameHi": "ग्रीन शेड नेट 50% 3m x 50m रोल",
        "nameMr": "ग्रीन शेड नेट 50% 3m x 50m रोल",
        "price": 4200,
        "mrp": 4800,
        "unit": "roll",
        "stock": 60,
        "brand": "Garware",
        "subcategory": "Shade Nets",
        "description": "Yeh hari shade net dhoop ko 50% kam karti hai, jisse paudhe tej garmi se bachte hain. Polyhouse, nursery aur sabzi ke khet ke upar lagayein.",
        "highlights": [
          "50% shade for nursery and vegetables",
          "UV treated, lasts 4-5 years",
          "Size 3 metre x 50 metre roll",
          "Strong HDPE knitted net"
        ],
        "tags": [
          "shade net",
          "greenhouse",
          "nursery",
          "shadenet",
          "polyhouse"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Garware Technical Fibres Ltd"
      },
      {
        "name": "Polyhouse UV Film 200 Micron 24ft x 100ft",
        "nameHi": "पॉलीहाउस UV फिल्म 200 माइक्रोन 24ft x 100ft",
        "nameMr": "पॉलीहाऊस UV फिल्म 200 मायक्रॉन 24ft x 100ft",
        "price": 11500,
        "mrp": 13000,
        "unit": "roll",
        "stock": 25,
        "brand": "Ginegar",
        "subcategory": "Greenhouse Film",
        "description": "Polyhouse ki chhat dhakne wali mazboot plastic film. UV se bachao deti hai aur dhoop andar aane deti hai, jisse fasal saal bhar achhi hoti hai.",
        "highlights": [
          "200 micron thick triple-layer film",
          "UV stabilised for 3 year life",
          "High light transmission for good growth",
          "Width 24 feet, length 100 feet"
        ],
        "tags": [
          "polyhouse film",
          "greenhouse",
          "uv film",
          "plastic sheet",
          "protected cultivation"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Ginegar Plastic Products India"
      },
      {
        "name": "Insect Proof Net 40 Mesh 2m x 50m",
        "nameHi": "कीट रोधी जाली 40 मेश 2m x 50m",
        "nameMr": "कीटरोधक जाळी 40 मेश 2m x 50m",
        "price": 5600,
        "mrp": 6300,
        "unit": "roll",
        "stock": 40,
        "brand": "Tuflex",
        "subcategory": "Insect Nets",
        "description": "Yeh barik jaali keede-makodon ko polyhouse ke andar aane se rokti hai. Isse keetnashak dawai ka kharcha kam hota hai aur fasal surakshit rehti hai.",
        "highlights": [
          "40 mesh stops thrips and whitefly",
          "UV treated HDPE, long life",
          "Less spray, healthy crop",
          "2 metre x 50 metre roll"
        ],
        "tags": [
          "insect net",
          "mesh net",
          "pest control",
          "greenhouse",
          "nethouse"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Tuflex India Pvt Ltd"
      },
      {
        "name": "Silver Black Plastic Mulch Film 25 Micron 4ft x 400m",
        "nameHi": "सिल्वर ब्लैक प्लास्टिक मल्च फिल्म 25 माइक्रोन 4ft x 400m",
        "nameMr": "सिल्व्हर ब्लॅक प्लास्टिक मल्च फिल्म 25 मायक्रॉन 4ft x 400m",
        "price": 2400,
        "mrp": 2800,
        "unit": "roll",
        "stock": 80,
        "brand": "Mahaveer",
        "subcategory": "Mulch Film",
        "description": "Zameen par bichhane wali plastic film. Upar silver rang keede bhagata hai aur niche kala rang khar-patwar rokta hai. Pani bhi kam lagta hai.",
        "highlights": [
          "Silver top reflects insects away",
          "Black bottom stops weeds",
          "Saves water and keeps soil moist",
          "4 feet wide, 400 metre roll"
        ],
        "tags": [
          "mulch film",
          "plastic mulch",
          "weed control",
          "silver black",
          "protected cultivation"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Mahaveer Polyplast"
      },
      {
        "name": "Polyhouse Exhaust Fan 48 inch Heavy Duty",
        "nameHi": "पॉलीहाउस एग्जॉस्ट फैन 48 इंच हैवी ड्यूटी",
        "nameMr": "पॉलीहाऊस एक्झॉस्ट फॅन 48 इंच हेवी ड्युटी",
        "price": 18500,
        "mrp": 21000,
        "unit": "piece",
        "stock": 15,
        "brand": "Kisankraft",
        "subcategory": "Ventilation",
        "description": "Bada pankha jo polyhouse ki garam hawa bahar nikalta hai aur andar thandak aur taaza hawa rakhta hai. Garmi mein fasal ko thanda rakhne ke liye zaroori.",
        "highlights": [
          "48 inch heavy duty exhaust fan",
          "Cools polyhouse in summer",
          "Galvanised body, rust free",
          "Removes hot and humid air"
        ],
        "tags": [
          "exhaust fan",
          "polyhouse fan",
          "ventilation",
          "cooling",
          "greenhouse"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "KisanKraft Limited"
      }
    ]
  },
  {
    "category": "Micronutrients & Specialty Nutrition",
    "items": [
      {
        "name": "Zinc Sulphate 21% (Heptahydrate) 25kg Bag",
        "nameHi": "जिंक सल्फेट 21% (हेप्टाहाइड्रेट) 25 किलो बैग",
        "nameMr": "झिंक सल्फेट 21% (हेप्टाहायड्रेट) 25 किलो बॅग",
        "price": 1450,
        "mrp": 1700,
        "unit": "bag",
        "stock": 60,
        "subcategory": "Zinc Sulphate",
        "brand": "Coromandel",
        "countryOfOrigin": "India",
        "manufacturer": "Coromandel International Ltd",
        "description": "Zinc fertilizer to fix zinc shortage in soil. Sprinkle in the field or mix in soil so leaves stay green and grain fills well.",
        "highlights": [
          "21% zinc, dissolves easily in water",
          "Stops yellow leaves and stunted plant growth",
          "Good for paddy, wheat, maize and vegetables",
          "Use in soil or as spray"
        ],
        "tags": [
          "zinc",
          "micronutrient",
          "zinc sulphate",
          "soil",
          "wheat"
        ]
      },
      {
        "name": "Chelated Iron EDTA-Fe 12% 500g Pack",
        "nameHi": "चिलेटेड आयरन EDTA-Fe 12% 500 ग्राम पैक",
        "nameMr": "चिलेटेड आयर्न EDTA-Fe 12% 500 ग्रॅम पॅक",
        "price": 410,
        "mrp": 480,
        "unit": "pack",
        "stock": 90,
        "subcategory": "EDTA Chelated Micronutrients",
        "brand": "Aries Agro",
        "countryOfOrigin": "India",
        "manufacturer": "Aries Agro Ltd",
        "description": "Iron powder for spraying on leaves to cure yellowing between veins. Plant takes it up fast and turns green again.",
        "highlights": [
          "12% chelated iron, absorbed quickly by leaves",
          "Cures iron-deficiency yellowing (chlorosis)",
          "Best for citrus, grapes, pomegranate, vegetables",
          "Mix 1 gram per litre of water and spray"
        ],
        "tags": [
          "iron",
          "chelated",
          "EDTA",
          "foliar spray",
          "chlorosis"
        ]
      },
      {
        "name": "Boron 20% (Solubor) 1kg Pack",
        "nameHi": "बोरॉन 20% (सॉल्यूबोर) 1 किलो पैक",
        "nameMr": "बोरॉन 20% (सॉल्युबोर) 1 किलो पॅक",
        "price": 320,
        "mrp": 390,
        "unit": "pack",
        "stock": 110,
        "subcategory": "Boron (Solubor / Borax)",
        "brand": "Tata Rallis",
        "countryOfOrigin": "India",
        "manufacturer": "Rallis India Ltd (Tata Group)",
        "description": "Boron powder that fully dissolves in water for spraying. Helps flowers set into fruit and stops fruit cracking and hollow stems.",
        "highlights": [
          "20% boron, 100% water soluble",
          "More flowering and better fruit setting",
          "Stops fruit cracking and flower drop",
          "Use on cotton, groundnut, vegetables and fruit crops"
        ],
        "tags": [
          "boron",
          "solubor",
          "flowering",
          "fruit set",
          "foliar"
        ]
      },
      {
        "name": "Multi-Micronutrient Grade-II Foliar Mixture 5kg Bag",
        "nameHi": "मल्टी-माइक्रोन्यूट्रिएंट ग्रेड-II फोलियर मिश्रण 5 किलो बैग",
        "nameMr": "मल्टी-मायक्रोन्यूट्रिएंट ग्रेड-II फोलियर मिश्रण 5 किलो बॅग",
        "price": 980,
        "mrp": 1150,
        "unit": "bag",
        "stock": 70,
        "subcategory": "Multi-Micronutrient Mixtures",
        "brand": "IFFCO",
        "countryOfOrigin": "India",
        "manufacturer": "Indian Farmers Fertiliser Cooperative (IFFCO)",
        "description": "All-in-one mix of zinc, iron, manganese, copper, boron and molybdenum. One spray covers all small nutrient needs and removes hidden hunger.",
        "highlights": [
          "Contains Zn, Fe, Mn, Cu, B and Mo together",
          "Fixes many deficiencies in one spray",
          "Suitable for all crops and seasons",
          "Greener leaves and higher yield"
        ],
        "tags": [
          "micronutrient",
          "mixture",
          "zinc",
          "boron",
          "foliar"
        ]
      },
      {
        "name": "Calcium Nitrate with Boron Foliar Grade 1kg Pack",
        "nameHi": "कैल्शियम नाइट्रेट विद बोरॉन फोलियर ग्रेड 1 किलो पैक",
        "nameMr": "कॅल्शियम नायट्रेट विथ बोरॉन फोलियर ग्रेड 1 किलो पॅक",
        "price": 260,
        "mrp": 310,
        "unit": "pack",
        "stock": 130,
        "subcategory": "Calcium + Boron Combos (Fruit Quality)",
        "brand": "UPL",
        "countryOfOrigin": "India",
        "manufacturer": "UPL Ltd",
        "description": "Calcium and boron spray that makes fruit firm, shiny and longer lasting. Stops blossom-end rot in tomato and tip burn in vegetables.",
        "highlights": [
          "Calcium plus boron for better fruit quality",
          "Stops blossom-end rot and fruit cracking",
          "Improves shelf life and shine of produce",
          "Spray during flowering and fruit growth"
        ],
        "tags": [
          "calcium",
          "boron",
          "fruit quality",
          "tomato",
          "foliar"
        ]
      }
    ]
  },
  {
    "category": "Seeds Treatment & Additives",
    "items": [
      {
        "name": "Bayer Raxil Easy Seed Treatment Fungicide 500ml",
        "nameHi": "Bayer Raxil Easy बीज उपचार फफूंदनाशक 500ml",
        "nameMr": "Bayer Raxil Easy बियाणे प्रक्रिया बुरशीनाशक 500ml",
        "price": 615,
        "mrp": 690,
        "unit": "bottle",
        "stock": 80,
        "brand": "Bayer",
        "subcategory": "Seeds Treatment & Additives",
        "description": "Ready-to-mix red liquid that you coat on wheat and other seeds before sowing. It stops smut, bunt and seed-borne fungus so plants come up clean and healthy.",
        "highlights": [
          "Stops loose smut, bunt and seed rot in wheat",
          "Liquid formula sticks well and is easy to mix",
          "Just 1.5 ml treats 1 kg of seed",
          "Gives strong, even crop stand"
        ],
        "tags": [
          "seed treatment",
          "fungicide",
          "wheat",
          "tebuconazole",
          "raxil"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Bayer CropScience Ltd"
      },
      {
        "name": "Syngenta Cruiser 70 WS Seed Insecticide 500g",
        "nameHi": "Syngenta Cruiser 70 WS बीज कीटनाशक 500g",
        "nameMr": "Syngenta Cruiser 70 WS बियाणे कीटकनाशक 500g",
        "price": 1180,
        "mrp": 1320,
        "unit": "pack",
        "stock": 55,
        "brand": "Syngenta",
        "subcategory": "Seeds Treatment & Additives",
        "description": "A blue powder you dust on cotton, maize and pulse seeds before sowing. It protects young plants from sucking pests like aphids, jassids and thrips for the early weeks.",
        "highlights": [
          "Protects new plants from sucking insects early",
          "Single coating guards the seedling for weeks",
          "Works on cotton, maize and pulses",
          "Less spraying needed after sowing"
        ],
        "tags": [
          "seed treatment",
          "insecticide",
          "cotton",
          "thiamethoxam",
          "cruiser"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Syngenta India Ltd"
      },
      {
        "name": "IFFCO Rhizobium Bio-Fertilizer Seed Inoculant 200g (5 Pack)",
        "nameHi": "IFFCO Rhizobium जैव-उर्वरक बीज टीका 200g (5 पैक)",
        "nameMr": "IFFCO Rhizobium जैव-खत बियाणे संवर्धक 200g (5 पॅक)",
        "price": 210,
        "mrp": 250,
        "unit": "pack",
        "stock": 140,
        "brand": "IFFCO",
        "subcategory": "Seeds Treatment & Additives",
        "description": "A natural culture you mix with soybean, gram and other pulse seeds before sowing. The friendly bacteria fix nitrogen in the soil so your crop needs less urea and grows stronger.",
        "highlights": [
          "Natural nitrogen-fixing bacteria for pulses",
          "Cuts down on urea and fertilizer cost",
          "Improves root growth and yield",
          "One 200g pack treats around 10 kg seed"
        ],
        "tags": [
          "seed treatment",
          "biofertilizer",
          "rhizobium",
          "soybean",
          "pulses"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Indian Farmers Fertiliser Cooperative Ltd"
      },
      {
        "name": "Syngenta Apron XL 35 ES Seed Treatment 250ml",
        "nameHi": "Syngenta Apron XL 35 ES बीज उपचार 250ml",
        "nameMr": "Syngenta Apron XL 35 ES बियाणे प्रक्रिया 250ml",
        "price": 540,
        "mrp": 600,
        "unit": "bottle",
        "stock": 70,
        "brand": "Syngenta",
        "subcategory": "Seeds Treatment & Additives",
        "description": "A liquid you coat on bajra, sunflower and vegetable seeds before sowing. It stops downy mildew and damping-off disease so seedlings do not rot in wet soil.",
        "highlights": [
          "Protects against downy mildew and damping-off",
          "Saves seedlings in cold, wet soil",
          "Good for bajra, sunflower and vegetables",
          "Small dose treats a large seed lot"
        ],
        "tags": [
          "seed treatment",
          "fungicide",
          "downy mildew",
          "metalaxyl",
          "apron"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Syngenta India Ltd"
      },
      {
        "name": "Kisan Kraft Hand Rotary Seed Dresser Drum 10kg",
        "nameHi": "Kisan Kraft हाथ रोटरी बीज उपचार ड्रम 10kg",
        "nameMr": "Kisan Kraft हात रोटरी बियाणे प्रक्रिया ड्रम 10kg",
        "price": 2450,
        "mrp": 2850,
        "unit": "piece",
        "stock": 35,
        "brand": "Kisan Kraft",
        "subcategory": "Seeds Treatment & Additives",
        "description": "A hand-turned drum that mixes seed with fungicide or culture evenly without touching the chemical. Put seed and treatment inside, turn the handle, and every seed gets coated safely.",
        "highlights": [
          "Coats seed evenly without hand contact",
          "Keeps farmer safe from chemicals",
          "Holds up to 10 kg seed per batch",
          "Strong drum, easy hand-turning handle"
        ],
        "tags": [
          "seed treatment",
          "seed dresser",
          "drum",
          "equipment",
          "kisan kraft"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Kisankraft Ltd"
      }
    ]
  },
  {
    "category": "Livestock, Dairy & Poultry",
    "items": [
      {
        "name": "Godrej Milky Way Cattle Feed 50kg Bag",
        "nameHi": "Godrej Milky Way पशु आहार 50kg बोरी",
        "nameMr": "Godrej Milky Way जनावरांचे खाद्य 50kg पोतं",
        "price": 1180,
        "mrp": 1320,
        "unit": "bag",
        "stock": 240,
        "brand": "Godrej Agrovet",
        "subcategory": "Cattle & Dairy Feed",
        "description": "Pellet feed for cows and buffaloes that gives more milk. Mix a little daily with green grass to keep animals healthy.",
        "highlights": [
          "Helps increase milk",
          "Bypass protein for dairy animals",
          "Easy-to-digest pellets",
          "50kg value bag"
        ],
        "tags": [
          "cattle feed",
          "dairy",
          "buffalo feed",
          "milk",
          "godrej"
        ],
        "manufacturer": "Godrej Agrovet Ltd",
        "countryOfOrigin": "India"
      },
      {
        "name": "Venky's Broiler Starter Poultry Feed 50kg Bag",
        "nameHi": "Venky's ब्रॉयलर स्टार्टर मुर्गी दाना 50kg बोरी",
        "nameMr": "Venky's ब्रॉयलर स्टार्टर कोंबडी खाद्य 50kg पोतं",
        "price": 1650,
        "mrp": 1820,
        "unit": "bag",
        "stock": 160,
        "brand": "Venky's",
        "subcategory": "Poultry Feed",
        "description": "Crumble feed for young broiler chicks for fast and healthy growth. Feed from day one to keep chicks strong.",
        "highlights": [
          "For chicks 0-15 days",
          "Fast weight gain",
          "Added vitamins and minerals",
          "Crumble form, easy to eat"
        ],
        "tags": [
          "poultry feed",
          "broiler",
          "chicken feed",
          "starter",
          "venkys"
        ],
        "manufacturer": "Venkateshwara Hatcheries Pvt Ltd",
        "countryOfOrigin": "India"
      },
      {
        "name": "Tata Animal Feed Chelated Mineral Mixture 5kg Bucket",
        "nameHi": "Tata पशु खनिज मिश्रण 5kg डिब्बा",
        "nameMr": "Tata जनावरांचे खनिज मिश्रण 5kg बादली",
        "price": 690,
        "mrp": 780,
        "unit": "bucket",
        "stock": 320,
        "brand": "Tata Chemicals",
        "subcategory": "Animal Health & Supplements",
        "description": "Mineral powder to mix in animal feed daily. Gives calcium and minerals so animals stay healthy and give more milk.",
        "highlights": [
          "Chelated minerals, better absorption",
          "Improves milk and fertility",
          "Stronger bones",
          "Mix 50g per animal daily"
        ],
        "tags": [
          "mineral mixture",
          "cattle supplement",
          "calcium",
          "dairy",
          "tata"
        ],
        "manufacturer": "Tata Chemicals Ltd",
        "countryOfOrigin": "India"
      },
      {
        "name": "DeLaval Single Bucket Milking Machine 25L",
        "nameHi": "DeLaval सिंगल बकेट दूध निकालने की मशीन 25L",
        "nameMr": "DeLaval सिंगल बकेट दूध काढण्याची मशीन 25L",
        "price": 38500,
        "mrp": 44000,
        "unit": "unit",
        "stock": 18,
        "brand": "DeLaval",
        "subcategory": "Dairy Equipment",
        "description": "Electric machine to milk one cow or buffalo quickly and cleanly. Saves time and gives clean milk without hurting the animal.",
        "highlights": [
          "Milks one animal at a time",
          "Stainless steel 25L bucket",
          "Gentle on udder",
          "Runs on electricity"
        ],
        "tags": [
          "milking machine",
          "dairy equipment",
          "delaval",
          "milk",
          "buffalo"
        ],
        "manufacturer": "DeLaval Pvt Ltd",
        "countryOfOrigin": "India"
      },
      {
        "name": "Hester Raksha Ovac FMD Cattle Vaccine 30ml (30 Doses)",
        "nameHi": "Hester Raksha Ovac खुरपका मुंहपका टीका 30ml (30 खुराक)",
        "nameMr": "Hester Raksha Ovac लाळ्या खुरकूत लस 30ml (30 मात्रा)",
        "price": 540,
        "mrp": 600,
        "unit": "bottle",
        "stock": 90,
        "brand": "Hester Biosciences",
        "subcategory": "Veterinary Medicine & Vaccines",
        "description": "Vaccine to protect cattle and buffalo from foot-and-mouth disease (FMD). Get it given by a vet to keep animals safe.",
        "highlights": [
          "Protects against FMD disease",
          "30 doses per bottle",
          "Keep in fridge (2-8°C)",
          "Give with vet's help"
        ],
        "tags": [
          "fmd vaccine",
          "cattle vaccine",
          "veterinary",
          "hester",
          "animal health"
        ],
        "manufacturer": "Hester Biosciences Ltd",
        "countryOfOrigin": "India"
      }
    ]
  },
  {
    "category": "Fencing & Farm Protection",
    "items": [
      {
        "name": "Barbed Wire GI Coil 25kg (Approx 400m)",
        "nameHi": "कांटेदार तार GI कुंडली 25kg (लगभग 400m)",
        "nameMr": "काटेरी तार GI रिंगण 25kg (अंदाजे 400m)",
        "price": 2150,
        "mrp": 2500,
        "unit": "bag",
        "stock": 120,
        "brand": "Tata Wiron",
        "subcategory": "Barbed Wire & Chain Link",
        "description": "Strong galvanised barbed wire to fence your farm boundary and keep stray animals out. Rust-resistant coating lasts many years in rain and sun.",
        "highlights": [
          "Heavy 25kg coil covers about 400 metres",
          "GI zinc coating stops rust",
          "Sharp double barbs stop cattle and intruders",
          "Long lasting in all weather"
        ],
        "tags": [
          "barbed wire",
          "fencing",
          "boundary",
          "cattle protection",
          "gi wire"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Tata Steel Ltd"
      },
      {
        "name": "Chain Link Fencing Mesh 4ft x 90ft Roll (50mm Mesh)",
        "nameHi": "चेन लिंक फेंसिंग जाली 4ft x 90ft रोल (50mm जाली)",
        "nameMr": "चेन लिंक फेन्सिंग जाळी 4ft x 90ft रोल (50mm जाळी)",
        "price": 3900,
        "mrp": 4600,
        "unit": "unit",
        "stock": 60,
        "brand": "Tata Wiron",
        "subcategory": "Barbed Wire & Chain Link",
        "description": "Galvanised steel chain link mesh to make a strong see-through fence around your field, poultry shed or nursery. Easy to fix on poles.",
        "highlights": [
          "4 feet height, 90 feet long roll",
          "50mm diamond mesh, rust-proof GI coating",
          "Good for poultry, nursery and boundary fencing",
          "Strong yet easy to install"
        ],
        "tags": [
          "chain link",
          "mesh fencing",
          "poultry fence",
          "nursery",
          "gi mesh"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Tata Steel Ltd"
      },
      {
        "name": "Solar Power Fence Energizer 5km (12V Battery)",
        "nameHi": "सोलर पावर फेंस एनर्जाइज़र 5km (12V बैटरी)",
        "nameMr": "सोलर पॉवर फेन्स एनर्जायझर 5km (12V बॅटरी)",
        "price": 8500,
        "mrp": 10500,
        "unit": "set",
        "stock": 35,
        "brand": "Kisan Kraft",
        "subcategory": "Electric & Solar Fencing",
        "description": "Solar electric fence unit that gives a safe shock to keep wild boar, nilgai and elephants away from crops. Runs on sun, no electricity bill.",
        "highlights": [
          "Covers up to 5 km of fence line",
          "Runs on solar panel and 12V battery",
          "Safe pulse shock scares animals, does not harm",
          "Protects crops from wild animals at night"
        ],
        "tags": [
          "solar fence",
          "electric fence",
          "wild animal",
          "crop protection",
          "energizer"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Kisan Kraft Ltd"
      },
      {
        "name": "Crop Protection Anti-Bird Net 6m x 50m (Green HDPE)",
        "nameHi": "फसल सुरक्षा एंटी-बर्ड नेट 6m x 50m (हरा HDPE)",
        "nameMr": "पीक संरक्षण अँटी-बर्ड नेट 6m x 50m (हिरवे HDPE)",
        "price": 1650,
        "mrp": 2100,
        "unit": "unit",
        "stock": 200,
        "brand": "Garware",
        "subcategory": "Crop Protection Nets",
        "description": "Light green HDPE net to cover fruit trees, grapes and vegetables so birds cannot eat or damage them. Reusable for many seasons.",
        "highlights": [
          "Large 6m x 50m sheet covers orchards",
          "Tough UV-treated HDPE net",
          "Stops birds, bats and large pests",
          "Light weight, easy to spread and reuse"
        ],
        "tags": [
          "bird net",
          "anti bird",
          "crop protection net",
          "orchard",
          "hdpe net"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Garware Technical Fibres Ltd"
      },
      {
        "name": "RCC Fencing Pole 8ft Pre-Cast (Pack of 10)",
        "nameHi": "RCC फेंसिंग पोल 8ft प्री-कास्ट (10 का पैक)",
        "nameMr": "RCC फेन्सिंग पोल 8ft प्री-कास्ट (10 चा पॅक)",
        "price": 3500,
        "mrp": 4200,
        "unit": "pack",
        "stock": 80,
        "brand": "Captain",
        "subcategory": "Fencing Poles & Posts",
        "description": "Strong cement RCC poles to hold barbed wire or chain link fence around your farm. Do not rot or rust like wood, last for years.",
        "highlights": [
          "8 feet tall pre-cast cement poles",
          "Pack of 10 poles",
          "Pre-made holes for easy wire fixing",
          "Termite-proof and weatherproof, very durable"
        ],
        "tags": [
          "fencing pole",
          "rcc pole",
          "cement post",
          "boundary",
          "fence post"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Captain Polyplast Ltd"
      }
    ]
  },
  {
    "category": "Storage & Packaging",
    "items": [
      {
        "name": "PP Woven Storage Bags 50kg (Pack of 50)",
        "nameHi": "पीपी बुना भंडारण बैग 50kg (50 का पैक)",
        "nameMr": "पीपी विणलेल्या साठवण पिशव्या 50kg (50 चा पॅक)",
        "price": 640,
        "mrp": 750,
        "unit": "pack",
        "stock": 320,
        "brand": "Tarpaulin India",
        "subcategory": "Grain Bags",
        "description": "Strong woven plastic bags to fill grain, wheat or rice. Each bag holds up to 50kg and can be used many times.",
        "highlights": [
          "Holds up to 50kg grain",
          "Strong stitched edges, reusable",
          "UV-treated for outdoor use",
          "Pack of 50 bags"
        ],
        "tags": [
          "pp bags",
          "grain storage",
          "sacks",
          "50kg",
          "packaging"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Tarpaulin India Pvt Ltd"
      },
      {
        "name": "PICS Hermetic Grain Storage Bag 50kg (Pack of 10)",
        "nameHi": "पिक्स वायुरोधी अनाज भंडारण बैग 50kg (10 का पैक)",
        "nameMr": "पिक्स हवाबंद धान्य साठवण पिशवी 50kg (10 चा पॅक)",
        "price": 1150,
        "mrp": 1350,
        "unit": "pack",
        "stock": 140,
        "brand": "Super Bag",
        "subcategory": "Hermetic Bags",
        "description": "Triple-layer airtight bags that kill insects without any chemical. Store wheat, pulses or paddy safely for many months.",
        "highlights": [
          "3-layer airtight, no pesticide needed",
          "Stops weevil and insect damage",
          "Keeps grain dry and fresh",
          "Each bag holds 50kg"
        ],
        "tags": [
          "pics bag",
          "hermetic",
          "airtight",
          "insect free",
          "grain storage"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "GrainPro Bharat"
      },
      {
        "name": "Galvanized Steel Grain Storage Bin 500kg",
        "nameHi": "जस्ती इस्पात अनाज भंडारण ड्रम 500kg",
        "nameMr": "गॅल्व्हनाइज्ड स्टील धान्य साठवण ड्रम 500kg",
        "price": 8900,
        "mrp": 10500,
        "unit": "piece",
        "stock": 35,
        "brand": "Pusa",
        "subcategory": "Metal Bins",
        "description": "Big rust-proof steel bin to store up to 500kg of grain safely at home. Rats and moisture cannot get inside.",
        "highlights": [
          "Rust-proof galvanized steel",
          "Rat and moisture proof lid",
          "Holds up to 500kg grain",
          "Long lasting, many years use"
        ],
        "tags": [
          "grain bin",
          "metal silo",
          "storage drum",
          "500kg",
          "rat proof"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Pusa Agro Industries"
      },
      {
        "name": "Jute Gunny Bags 100kg (Pack of 25)",
        "nameHi": "जूट बोरी बैग 100kg (25 का पैक)",
        "nameMr": "ज्यूट गोणी पिशव्या 100kg (25 चा पॅक)",
        "price": 1875,
        "mrp": 2200,
        "unit": "pack",
        "stock": 210,
        "brand": "NJMC",
        "subcategory": "Jute Bags",
        "description": "Natural jute sacks for packing and storing grain, potato or onion. Breathable cloth keeps produce dry and cool.",
        "highlights": [
          "Natural breathable jute",
          "Holds up to 100kg",
          "Good for grain, onion, potato",
          "Pack of 25 bags"
        ],
        "tags": [
          "jute bags",
          "gunny",
          "bori",
          "100kg",
          "natural"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "National Jute Manufactures Corporation"
      },
      {
        "name": "HDPE Tarpaulin Sheet 200 GSM 20x30 ft",
        "nameHi": "एचडीपीई तिरपाल शीट 200 GSM 20x30 फुट",
        "nameMr": "एचडीपीई ताडपत्री शीट 200 GSM 20x30 फूट",
        "price": 1290,
        "mrp": 1550,
        "unit": "piece",
        "stock": 175,
        "brand": "Garware",
        "subcategory": "Tarpaulin",
        "description": "Waterproof tarpaulin sheet to cover grain heaps, dry crops or protect goods from rain. Has metal eyelets to tie down easily.",
        "highlights": [
          "Fully waterproof 200 GSM",
          "UV resistant, lasts long",
          "Metal eyelets on all sides",
          "Large 20x30 feet size"
        ],
        "tags": [
          "tarpaulin",
          "tadpatri",
          "waterproof",
          "crop cover",
          "hdpe sheet"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Garware Technical Fibres Ltd"
      }
    ]
  },
  {
    "category": "Agri Technology & Smart Farming",
    "items": [
      {
        "name": "Battery Knapsack Sprayer 16L (Double Motor)",
        "nameHi": "बैटरी नैपसैक स्प्रेयर 16L (डबल मोटर)",
        "nameMr": "बॅटरी नॅपसॅक स्प्रेअर 16L (डबल मोटर)",
        "price": 2350,
        "mrp": 2899,
        "unit": "piece",
        "stock": 140,
        "brand": "Kisan Kraft",
        "description": "Rechargeable 16-litre back sprayer with two motors. One full charge sprays many tanks, so you do not need to pump by hand.",
        "highlights": [
          "12V rechargeable battery",
          "Double motor high pressure",
          "Covers 1 acre per charge",
          "4 nozzles included"
        ],
        "tags": [
          "sprayer",
          "battery",
          "spraying",
          "tools"
        ],
        "subcategory": "Spraying Equipment",
        "countryOfOrigin": "India",
        "manufacturer": "Kisan Kraft Limited"
      },
      {
        "name": "Soil Moisture & NPK Sensor Kit (with App)",
        "nameHi": "मिट्टी नमी और NPK सेंसर किट (ऐप सहित)",
        "nameMr": "माती ओलावा व NPK सेन्सर किट (अॅपसह)",
        "price": 4499,
        "mrp": 5499,
        "unit": "set",
        "stock": 60,
        "brand": "Fasal",
        "description": "Put the sensor in your field and see soil water and nutrient levels on your mobile. It tells you when to water and how much fertiliser to give.",
        "highlights": [
          "Live readings on mobile app",
          "Measures moisture and N-P-K",
          "Solar charged probe",
          "Saves water and fertiliser"
        ],
        "tags": [
          "iot",
          "sensor",
          "soil",
          "smart-farming"
        ],
        "subcategory": "IoT & Sensors",
        "countryOfOrigin": "India",
        "manufacturer": "Wolkus Technology Solutions Pvt Ltd"
      },
      {
        "name": "Agriculture Spraying Drone 10L (Kisan Drone)",
        "nameHi": "कृषि स्प्रे ड्रोन 10L (किसान ड्रोन)",
        "nameMr": "शेती फवारणी ड्रोन 10L (किसान ड्रोन)",
        "price": 485000,
        "mrp": 540000,
        "unit": "unit",
        "stock": 8,
        "brand": "IoTechWorld Avigation",
        "description": "A flying machine that sprays your whole field by itself in minutes. Saves labour and keeps you away from harmful chemicals.",
        "highlights": [
          "10 litre tank",
          "Sprays 1 acre in 7-10 minutes",
          "DGCA approved Kisan Drone",
          "GPS auto-flight"
        ],
        "tags": [
          "drone",
          "spraying",
          "smart-farming",
          "precision"
        ],
        "subcategory": "Drones",
        "countryOfOrigin": "India",
        "manufacturer": "IoTechWorld Avigation Pvt Ltd"
      },
      {
        "name": "Solar Automatic Weather Station (Farm)",
        "nameHi": "सोलर स्वचालित मौसम स्टेशन (खेत)",
        "nameMr": "सोलर स्वयंचलित हवामान केंद्र (शेत)",
        "price": 18999,
        "mrp": 22500,
        "unit": "set",
        "stock": 25,
        "brand": "Fyllo",
        "description": "A small solar weather station for your farm that tells rain, temperature and humidity on your phone. Helps you plan spraying and watering.",
        "highlights": [
          "Solar powered, no wiring",
          "Rain, temp, humidity sensors",
          "Disease and pest alerts",
          "Cloud data on mobile"
        ],
        "tags": [
          "weather",
          "iot",
          "smart-farming",
          "sensor"
        ],
        "subcategory": "IoT & Sensors",
        "countryOfOrigin": "India",
        "manufacturer": "Eom Innovations Pvt Ltd"
      },
      {
        "name": "Smart Drip Irrigation Timer (Mobile Control)",
        "nameHi": "स्मार्ट ड्रिप सिंचाई टाइमर (मोबाइल नियंत्रण)",
        "nameMr": "स्मार्ट ठिबक सिंचन टायमर (मोबाइल नियंत्रण)",
        "price": 3299,
        "mrp": 3999,
        "unit": "piece",
        "stock": 90,
        "brand": "Netafim",
        "description": "Fit this timer on your drip line and set watering times from your phone. Water starts and stops on its own, even when you are away.",
        "highlights": [
          "Start/stop water from phone",
          "Auto on-off schedule",
          "Saves water and time",
          "Easy fit on drip line"
        ],
        "tags": [
          "irrigation",
          "drip",
          "smart-farming",
          "timer"
        ],
        "subcategory": "Smart Irrigation",
        "countryOfOrigin": "India",
        "manufacturer": "Netafim India Pvt Ltd"
      }
    ]
  },
  {
    "category": "Solar & Energy",
    "items": [
      {
        "name": "Shakti 3HP Solar Water Pump Set (DC Submersible)",
        "nameHi": "Shakti 3HP सोलर वॉटर पंप सेट (DC सबमर्सिबल)",
        "nameMr": "Shakti 3HP सोलर वॉटर पंप संच (DC सबमर्सिबल)",
        "price": 142000,
        "mrp": 165000,
        "unit": "set",
        "stock": 8,
        "brand": "Shakti Pumps",
        "subcategory": "Solar Water Pumps",
        "description": "Sun-powered borewell pump that lifts water without electricity or diesel. Runs on solar panels in daytime, so no monthly power bill.",
        "highlights": [
          "3 HP DC submersible motor for borewells",
          "Works without grid power or diesel",
          "PM-KUSUM subsidy eligible",
          "Complete kit with controller and panels"
        ],
        "tags": [
          "solar pump",
          "submersible",
          "borewell",
          "irrigation",
          "kusum"
        ],
        "manufacturer": "Shakti Pumps (India) Ltd",
        "countryOfOrigin": "India"
      },
      {
        "name": "Waaree 540W Mono PERC Solar Panel (Single)",
        "nameHi": "Waaree 540W मोनो PERC सोलर पैनल (1 नग)",
        "nameMr": "Waaree 540W मोनो PERC सोलर पॅनेल (1 नग)",
        "price": 11500,
        "mrp": 14000,
        "unit": "piece",
        "stock": 45,
        "brand": "Waaree",
        "subcategory": "Solar Panels (For Farm Use)",
        "description": "High-power solar panel for farm pumps, lights and battery charging. Makes free electricity from sunlight every day.",
        "highlights": [
          "540 watt high-efficiency mono PERC",
          "Tough glass, handles rain and hail",
          "25-year power output warranty",
          "Ideal for solar pump and lighting setups"
        ],
        "tags": [
          "solar panel",
          "540w",
          "mono perc",
          "farm energy",
          "waaree"
        ],
        "manufacturer": "Waaree Energies Ltd",
        "countryOfOrigin": "India"
      },
      {
        "name": "Kisan Kraft Solar Fence Energiser 8 Acre (12V)",
        "nameHi": "Kisan Kraft सोलर फेंस एनर्जाइज़र 8 एकड़ (12V)",
        "nameMr": "Kisan Kraft सोलर फेन्स एनर्जायझर 8 एकर (12V)",
        "price": 8900,
        "mrp": 10500,
        "unit": "unit",
        "stock": 22,
        "brand": "Kisan Kraft",
        "subcategory": "Solar Fencing Energisers",
        "description": "Solar-charged shock unit for fencing that keeps wild boar, nilgai and stray cattle out of your field. Gives a safe sharp shock that scares animals away without harming them.",
        "highlights": [
          "Powers fence for up to 8 acres",
          "Built-in solar panel and battery",
          "Safe pulse shock, not harmful",
          "Works at night and on cloudy days"
        ],
        "tags": [
          "solar fence",
          "energiser",
          "crop protection",
          "animal repel",
          "fencing"
        ],
        "manufacturer": "KisanKraft Ltd",
        "countryOfOrigin": "India"
      },
      {
        "name": "Luminous Solar LED Pathway Light 12W (With Pole)",
        "nameHi": "Luminous सोलर LED पाथवे लाइट 12W (पोल सहित)",
        "nameMr": "Luminous सोलर LED पाथवे लाइट 12W (खांबासह)",
        "price": 3200,
        "mrp": 3999,
        "unit": "piece",
        "stock": 60,
        "brand": "Luminous",
        "subcategory": "Solar Lights (Farm / Pathway)",
        "description": "All-in-one solar light for farm paths, sheds and gates. Charges in the sun by day and switches on automatically at night, no wiring needed.",
        "highlights": [
          "Bright 12W LED with auto dusk-to-dawn",
          "Built-in battery, no electricity bill",
          "Waterproof for outdoor use",
          "Mounting pole and remote included"
        ],
        "tags": [
          "solar light",
          "led",
          "pathway",
          "farm lighting",
          "luminous"
        ],
        "manufacturer": "Luminous Power Technologies Pvt Ltd",
        "countryOfOrigin": "India"
      },
      {
        "name": "Tata Solar Crop Dryer 10kg Capacity (Cabinet Type)",
        "nameHi": "Tata सोलर क्रॉप ड्रायर 10kg क्षमता (कैबिनेट टाइप)",
        "nameMr": "Tata सोलर क्रॉप ड्रायर 10kg क्षमता (कॅबिनेट प्रकार)",
        "price": 18500,
        "mrp": 22000,
        "unit": "unit",
        "stock": 14,
        "brand": "Tata Power Solar",
        "subcategory": "Solar Dryers",
        "description": "Closed solar dryer that dries chillies, turmeric, vegetables and fruit using only sunlight. Keeps dust and rain out, so produce dries clean and sells for a better price.",
        "highlights": [
          "Dries up to 10 kg per batch",
          "No fuel or electricity needed",
          "Dust and insect free drying",
          "Better colour and quality for selling"
        ],
        "tags": [
          "solar dryer",
          "crop drying",
          "post harvest",
          "chilli turmeric",
          "tata"
        ],
        "manufacturer": "Tata Power Solar Systems Ltd",
        "countryOfOrigin": "India"
      }
    ]
  },
  {
    "category": "Safety & Protective Gear",
    "items": [
      {
        "name": "Pesticide Spray Protective Suit (Full Body, Free Size)",
        "nameHi": "कीटनाशक छिड़काव सुरक्षा सूट (फुल बॉडी, फ्री साइज)",
        "nameMr": "कीटकनाशक फवारणी संरक्षण सूट (फुल बॉडी, फ्री साइज)",
        "price": 649,
        "mrp": 899,
        "unit": "set",
        "stock": 120,
        "brand": "Kisan Kraft",
        "subcategory": "Spray Protection",
        "description": "Poora shareer dhakne wala suit jo dawa chhidkav ke samay aapki tvacha aur kapdo ko keetnashak se bachata hai. Halka aur aaram se pehna jaa sakta hai.",
        "highlights": [
          "Sar se paer tak poora cover karta hai",
          "Pani aur dawa ko andar nahi aane deta",
          "Halka aur saans lene layak kapda",
          "Free size sab par fit"
        ],
        "tags": [
          "spray suit",
          "pesticide protection",
          "safety gear",
          "body cover"
        ],
        "manufacturer": "Kisan Kraft Limited",
        "countryOfOrigin": "India"
      },
      {
        "name": "Chemical Resistant Nitrile Gloves (Pair, Large)",
        "nameHi": "केमिकल रेसिस्टेंट नाइट्राइल दस्ताने (जोड़ी, लार्ज)",
        "nameMr": "केमिकल रेझिस्टंट नायट्राईल हातमोजे (जोडी, लार्ज)",
        "price": 145,
        "mrp": 199,
        "unit": "pair",
        "stock": 300,
        "brand": "Dhanuka",
        "subcategory": "Hand Protection",
        "description": "Mazboot nitrile ke dastane jo dawa aur khaad ko haath par lagne se rokte hain. Phisalte nahi aur lambe samay tak chalte hain.",
        "highlights": [
          "Keetnashak aur khaad se haath ki suraksha",
          "Pakad achhi, phisalti nahi",
          "Aaram se dhokar dobara istemal karein"
        ],
        "tags": [
          "gloves",
          "nitrile",
          "hand safety",
          "chemical resistant"
        ],
        "manufacturer": "Dhanuka Agritech Limited",
        "countryOfOrigin": "India"
      },
      {
        "name": "Half-Face Respirator Mask with Filter (1 Piece)",
        "nameHi": "हाफ-फेस रेस्पिरेटर मास्क फिल्टर के साथ (1 पीस)",
        "nameMr": "हाफ-फेस रेस्पिरेटर मास्क फिल्टरसह (1 नग)",
        "price": 389,
        "mrp": 549,
        "unit": "piece",
        "stock": 90,
        "brand": "Kisan Kraft",
        "subcategory": "Respiratory Protection",
        "description": "Naak aur muh dhakne wala mask jo dawa chhidkav ke samay zehrili gas aur dhool ko saans mein jaane se rokta hai. Filter badla jaa sakta hai.",
        "highlights": [
          "Zehrili dawa ki gandh aur dhool rokta hai",
          "Filter badalne wala, baar baar istemal",
          "Naram patti se aaram se fit hota hai"
        ],
        "tags": [
          "respirator",
          "face mask",
          "spray safety",
          "filter mask"
        ],
        "manufacturer": "Kisan Kraft Limited",
        "countryOfOrigin": "India"
      },
      {
        "name": "Safety Goggles Anti-Fog (1 Piece)",
        "nameHi": "सेफ्टी गॉगल्स एंटी-फॉग (1 पीस)",
        "nameMr": "सेफ्टी गॉगल्स अँटी-फॉग (1 नग)",
        "price": 99,
        "mrp": 149,
        "unit": "piece",
        "stock": 250,
        "brand": "UPL",
        "subcategory": "Eye Protection",
        "description": "Aankhon ko dawa ke chhinte aur dhool se bachane wale chashme. Andar bhaap nahi jamti, isliye saaf dikhta hai.",
        "highlights": [
          "Aankhon ko dawa aur dhool se bachata hai",
          "Andar dhundla nahi hota (anti-fog)",
          "Halka aur aaram se pehna jaa sakta hai"
        ],
        "tags": [
          "goggles",
          "eye protection",
          "anti-fog",
          "safety glasses"
        ],
        "manufacturer": "UPL Limited",
        "countryOfOrigin": "India"
      },
      {
        "name": "Agricultural Gumboots PVC (Pair, Size 9)",
        "nameHi": "कृषि गमबूट पीवीसी (जोड़ी, साइज 9)",
        "nameMr": "शेती गमबूट पीव्हीसी (जोडी, साइज 9)",
        "price": 379,
        "mrp": 499,
        "unit": "pair",
        "stock": 160,
        "brand": "Captain",
        "subcategory": "Foot Protection",
        "description": "Mazboot PVC ke gumboot jo keechad, pani aur dawa wale khet mein pairon ko surakshit rakhte hain. Phisalan rokne wala tala.",
        "highlights": [
          "Pani aur keechad andar nahi aata",
          "Phisalan rokne wala mazboot tala",
          "Dawa aur kaante se pairon ki suraksha",
          "Lambe samay tak chalne wale"
        ],
        "tags": [
          "gumboots",
          "foot protection",
          "PVC boots",
          "farm footwear"
        ],
        "manufacturer": "Captain Polyplast Limited",
        "countryOfOrigin": "India"
      }
    ]
  },
  {
    "category": "Spraying Equipment",
    "items": [
      {
        "name": "Knapsack Sprayer 16L Manual",
        "nameHi": "नैपसैक स्प्रेयर 16L मैनुअल",
        "nameMr": "नॅपसॅक स्प्रेयर 16L मॅन्युअल",
        "price": 1150,
        "mrp": 1450,
        "unit": "piece",
        "stock": 80,
        "brand": "Neptune",
        "subcategory": "Knapsack Sprayer",
        "description": "Back-mounted hand-pump sprayer holding 16 litres. Pump the handle to spray pesticide or weedicide on your crop.",
        "highlights": [
          "16 litre tank, easy to carry on back",
          "Strong hand pump, no battery needed",
          "Comes with brass nozzle and lance",
          "Good for vegetables, cotton and pulses"
        ],
        "tags": [
          "sprayer",
          "knapsack",
          "manual",
          "pesticide",
          "16L"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Neptune Agro Industries"
      },
      {
        "name": "Battery Sprayer 16L Double Motor",
        "nameHi": "बैटरी स्प्रेयर 16L डबल मोटर",
        "nameMr": "बॅटरी स्प्रेयर 16L डबल मोटर",
        "price": 2350,
        "mrp": 2999,
        "unit": "piece",
        "stock": 60,
        "brand": "Pad Corp",
        "subcategory": "Battery Sprayer",
        "description": "Rechargeable 16 litre battery sprayer. Charge it once and spray many tanks without hand pumping, saving your time and effort.",
        "highlights": [
          "12V rechargeable battery, no hand pumping",
          "Double motor for strong, even spray",
          "16 litre tank with charger included",
          "4 nozzles for different crops"
        ],
        "tags": [
          "battery sprayer",
          "rechargeable",
          "16L",
          "power sprayer",
          "double motor"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Pad Corp"
      },
      {
        "name": "HTP Power Sprayer 22L Engine",
        "nameHi": "HTP पावर स्प्रेयर 22L इंजन",
        "nameMr": "HTP पॉवर स्प्रेयर 22L इंजिन",
        "price": 8500,
        "mrp": 10500,
        "unit": "piece",
        "stock": 25,
        "brand": "Kisan Kraft",
        "subcategory": "Power Sprayer",
        "description": "Petrol engine HTP sprayer for big fields and tall crops. High pressure pump reaches far and covers orchards and sugarcane quickly.",
        "highlights": [
          "2-stroke petrol engine, high pressure",
          "Reaches tall trees and large fields",
          "Brass triple-piston pump for long life",
          "Best for orchards, sugarcane and cotton"
        ],
        "tags": [
          "power sprayer",
          "HTP",
          "petrol",
          "high pressure",
          "engine"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "KisanKraft Limited"
      },
      {
        "name": "Mist Blower Knapsack Petrol 14L",
        "nameHi": "मिस्ट ब्लोअर नैपसैक पेट्रोल 14L",
        "nameMr": "मिस्ट ब्लोअर नॅपसॅक पेट्रोल 14L",
        "price": 11500,
        "mrp": 13999,
        "unit": "piece",
        "stock": 18,
        "brand": "Aspee",
        "subcategory": "Mist Blower",
        "description": "Petrol back-carried mist blower that sprays a fine fog far into the crop. Great for tall plants and quick coverage of orchards.",
        "highlights": [
          "Petrol engine, blows fine mist far",
          "14 litre tank, back-carried",
          "Covers tall crops and dense orchards fast",
          "Can also be used to dust powder"
        ],
        "tags": [
          "mist blower",
          "duster",
          "petrol",
          "knapsack",
          "14L"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "American Spring & Pressing Works (Aspee)"
      },
      {
        "name": "Brass Spray Nozzle Set (4 Pieces)",
        "nameHi": "पीतल स्प्रे नोजल सेट (4 पीस)",
        "nameMr": "पितळी स्प्रे नोझल सेट (4 नग)",
        "price": 260,
        "mrp": 350,
        "unit": "set",
        "stock": 200,
        "brand": "Sharpe",
        "subcategory": "Sprayer Accessories",
        "description": "Set of 4 brass nozzles for your sprayer lance. Different nozzles give fine mist, flat fan or strong jet for different sprays.",
        "highlights": [
          "4 brass nozzles in one set",
          "Fits most knapsack and battery sprayers",
          "Brass body lasts long, does not rust",
          "Choose mist, fan or jet spray"
        ],
        "tags": [
          "nozzle",
          "brass",
          "sprayer parts",
          "accessories",
          "spare"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Sharpe Spares"
      }
    ]
  },
  {
    "category": "Harvesting & Post-Harvest",
    "items": [
      {
        "name": "Falcon Harvesting Sickle (Serrated Blade, Pack of 2)",
        "nameHi": "फाल्कन कटाई हंसिया (दांतेदार ब्लेड, 2 का पैक)",
        "nameMr": "फाल्कन कापणी विळा (दातेरी पाते, 2 चा संच)",
        "price": 320,
        "mrp": 399,
        "unit": "set",
        "stock": 150,
        "brand": "Falcon",
        "subcategory": "Sickles & Scythes",
        "description": "Sharp serrated sickle for cutting paddy, wheat and grass by hand. Strong steel blade with a comfortable wooden handle that does not slip.",
        "highlights": [
          "Serrated carbon steel blade stays sharp longer",
          "Anti-slip wooden handle for easy grip",
          "Pack of 2 — keep one spare",
          "Light weight, good for long hours of cutting"
        ],
        "tags": [
          "sickle",
          "hansiya",
          "harvesting",
          "paddy",
          "wheat"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Falcon Garden Tools Pvt. Ltd."
      },
      {
        "name": "Kisan Kraft Fruit Plucker with Telescopic Pole (3m)",
        "nameHi": "किसान क्राफ्ट फल तोड़ने वाला यंत्र दूरबीन डंडे के साथ (3 मीटर)",
        "nameMr": "किसान क्राफ्ट फळ तोडणी यंत्र दुर्बिणी काठीसह (3 मीटर)",
        "price": 850,
        "mrp": 1100,
        "unit": "piece",
        "stock": 80,
        "brand": "Kisan Kraft",
        "subcategory": "Mango / Fruit Pluckers",
        "description": "Pluck mango, guava and other fruits from tall trees without climbing. The pole extends up to 3 metres and the net catches the fruit gently so it does not get damaged.",
        "highlights": [
          "Reaches high branches — no climbing needed",
          "Extends up to 3 metres",
          "Soft net basket protects fruit from bruising",
          "Light aluminium pole, easy to carry"
        ],
        "tags": [
          "fruit plucker",
          "mango",
          "harvesting pole",
          "guava",
          "phal todai"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Kisan Kraft Limited"
      },
      {
        "name": "Nilkamal Heavy-Duty Harvesting Crate 50L (Pack of 5)",
        "nameHi": "निलकमल मजबूत कटाई क्रेट 50 लीटर (5 का पैक)",
        "nameMr": "निलकमल मजबूत कापणी क्रेट 50 लिटर (5 चा संच)",
        "price": 2250,
        "mrp": 2750,
        "unit": "set",
        "stock": 60,
        "brand": "Nilkamal",
        "subcategory": "Vegetable Harvesting Crates",
        "description": "Strong plastic crates to collect and carry vegetables and fruits from the field to the market. Stackable design saves space and the holes keep the produce fresh.",
        "highlights": [
          "Holds up to 50 litres of produce",
          "Stackable to save storage space",
          "Ventilation holes keep vegetables fresh",
          "Washable, reusable for many seasons"
        ],
        "tags": [
          "crate",
          "vegetable",
          "storage",
          "harvest box",
          "plastic crate"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Nilkamal Limited"
      },
      {
        "name": "Equal Digital Platform Weighing Scale 100kg",
        "nameHi": "इक्वल डिजिटल प्लेटफॉर्म वजन तौलने की मशीन 100 किग्रा",
        "nameMr": "इक्वल डिजिटल प्लॅटफॉर्म वजन काटा 100 किलो",
        "price": 1899,
        "mrp": 2499,
        "unit": "unit",
        "stock": 45,
        "brand": "Equal",
        "subcategory": "Weighing Machines & Balances",
        "description": "Digital weighing scale to weigh grain bags, vegetables and fruits up to 100 kg. Clear number display helps you sell at the correct weight and avoid loss.",
        "highlights": [
          "Weighs up to 100 kg accurately",
          "Bright LED display, easy to read",
          "Rechargeable battery works without power",
          "Strong steel platform for daily use"
        ],
        "tags": [
          "weighing scale",
          "kanta",
          "100kg",
          "digital",
          "grain weight"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Equal Retail Pvt. Ltd."
      },
      {
        "name": "VST Shakti Power Paddy & Wheat Reaper (4-Stroke, Walk-Behind)",
        "nameHi": "वीएसटी शक्ति पावर धान और गेहूं रीपर (4-स्ट्रोक, पैदल चालित)",
        "nameMr": "व्हीएसटी शक्ती पॉवर भात व गहू रीपर (4-स्ट्रोक, चालत मागे)",
        "price": 38500,
        "mrp": 44000,
        "unit": "unit",
        "stock": 12,
        "brand": "VST Shakti",
        "subcategory": "Paddy / Wheat Harvesters (Small)",
        "description": "Small petrol-powered reaper that cuts paddy and wheat fast and lays the crop neatly in a row. Saves many days of hand-cutting labour for small and medium farms.",
        "highlights": [
          "Cuts paddy and wheat much faster than by hand",
          "Fuel-efficient 4-stroke petrol engine",
          "Lays crop in a neat windrow for easy collection",
          "Easy to handle on small and medium fields"
        ],
        "tags": [
          "reaper",
          "paddy harvester",
          "wheat",
          "power reaper",
          "kataai machine"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "VST Tillers Tractors Ltd."
      }
    ]
  },
  {
    "category": "Aquaculture & Fisheries",
    "items": [
      {
        "name": "Avanti Floating Fish Feed 25kg Bag (Grower)",
        "nameHi": "अवंती तैरने वाला मछली आहार 25kg बैग (ग्रोवर)",
        "nameMr": "अवंती तरंगणारे मासे खाद्य 25kg बॅग (ग्रोवर)",
        "price": 1450,
        "mrp": 1650,
        "unit": "bag",
        "stock": 120,
        "brand": "Avanti Feeds",
        "subcategory": "Fish Feed",
        "countryOfOrigin": "India",
        "manufacturer": "Avanti Feeds Limited",
        "description": "Floating pellet feed for growing fish like rohu, catla and tilapia. Pellets stay on top of the water so you can see how much the fish eat and avoid waste.",
        "highlights": [
          "Floating pellets, easy to check fish appetite",
          "High protein for faster growth",
          "For grow-out stage fish",
          "Less water pollution"
        ],
        "tags": [
          "fish feed",
          "floating feed",
          "rohu",
          "tilapia",
          "aquaculture"
        ]
      },
      {
        "name": "CP Vannamei Shrimp Feed 25kg Bag (Starter)",
        "nameHi": "CP वन्नामी झींगा आहार 25kg बैग (स्टार्टर)",
        "nameMr": "CP व्हॅनामी कोळंबी खाद्य 25kg बॅग (स्टार्टर)",
        "price": 1980,
        "mrp": 2200,
        "unit": "bag",
        "stock": 80,
        "brand": "Charoen Pokphand (CP)",
        "subcategory": "Shrimp Feed",
        "countryOfOrigin": "India",
        "manufacturer": "CP Aquaculture (India) Pvt. Ltd.",
        "description": "Sinking starter feed for small vannamei shrimp in the early pond stage. Small pellets help baby shrimp eat easily and grow strong.",
        "highlights": [
          "For early-stage vannamei shrimp",
          "Small sinking pellets",
          "Rich in protein and minerals",
          "Supports healthy growth"
        ],
        "tags": [
          "shrimp feed",
          "vannamei",
          "prawn",
          "starter feed",
          "aquaculture"
        ]
      },
      {
        "name": "Kisan Kraft Paddle Wheel Pond Aerator 2HP",
        "nameHi": "किसान क्राफ्ट पैडल व्हील तालाब एरेटर 2HP",
        "nameMr": "किसान क्राफ्ट पॅडल व्हील तळे एरेटर 2HP",
        "price": 42500,
        "mrp": 48000,
        "unit": "piece",
        "stock": 15,
        "brand": "Kisan Kraft",
        "subcategory": "Aeration Equipment",
        "countryOfOrigin": "India",
        "manufacturer": "Kisan Kraft Limited",
        "description": "A 2HP paddle wheel machine that mixes air into pond water so fish and shrimp get enough oxygen. Keeps the water fresh and prevents fish from dying at night.",
        "highlights": [
          "2HP motor, four paddle wheels",
          "Adds oxygen to pond water",
          "Prevents night-time oxygen loss",
          "Floats on plastic drums"
        ],
        "tags": [
          "pond aerator",
          "paddle wheel",
          "oxygen",
          "fish pond",
          "aquaculture"
        ]
      },
      {
        "name": "UPL Aquaculture Pond Liner Tarpaulin 500 GSM 20x30 ft",
        "nameHi": "UPL एक्वाकल्चर तालाब लाइनर तिरपाल 500 GSM 20x30 फीट",
        "nameMr": "UPL मत्स्यपालन तळे लायनर ताडपत्री 500 GSM 20x30 फूट",
        "price": 3200,
        "mrp": 3800,
        "unit": "piece",
        "stock": 40,
        "brand": "UPL",
        "subcategory": "Pond Liner",
        "countryOfOrigin": "India",
        "manufacturer": "UPL Limited",
        "description": "Thick waterproof plastic sheet to line the bottom and sides of a fish or shrimp pond so water does not leak into the soil. Helps you keep clean water and farm fish even in sandy land.",
        "highlights": [
          "Strong 500 GSM HDPE sheet",
          "Stops water leakage into soil",
          "UV protected for outdoor use",
          "Size 20x30 feet"
        ],
        "tags": [
          "pond liner",
          "tarpaulin",
          "HDPE",
          "waterproof",
          "aquaculture"
        ]
      },
      {
        "name": "Coromandel Aqua Zeolite Pond Water Conditioner 10kg",
        "nameHi": "कोरोमंडल एक्वा ज़ियोलाइट तालाब जल कंडीशनर 10kg",
        "nameMr": "कोरोमंडल एक्वा झिओलाइट तळे पाणी कंडिशनर 10kg",
        "price": 420,
        "mrp": 520,
        "unit": "bag",
        "stock": 200,
        "brand": "Coromandel",
        "subcategory": "Water Treatment",
        "countryOfOrigin": "India",
        "manufacturer": "Coromandel International Limited",
        "description": "A natural mineral powder you spread in the pond to soak up harmful ammonia and dirty gases from fish and shrimp waste. Keeps pond water clean and the bottom soil healthy.",
        "highlights": [
          "Removes harmful ammonia gas",
          "Cleans pond bottom soil",
          "Reduces bad smell in water",
          "Natural mineral, safe for fish"
        ],
        "tags": [
          "zeolite",
          "water treatment",
          "ammonia",
          "pond conditioner",
          "aquaculture"
        ]
      }
    ]
  },
  {
    "category": "Horticulture & Nursery",
    "items": [
      {
        "name": "HDPE Grow Bags 12x12 inch (Pack of 25)",
        "nameHi": "एचडीपीई ग्रो बैग 12x12 इंच (25 का पैक)",
        "nameMr": "एचडीपीई ग्रो बॅग 12x12 इंच (25 चा पॅक)",
        "price": 449,
        "mrp": 650,
        "unit": "pack",
        "stock": 320,
        "brand": "Kisan Kraft",
        "subcategory": "Grow Bags (Black HDPE)",
        "description": "Strong black plastic bags to grow vegetables, flowers or saplings on terrace or in nursery. Reusable for many seasons and the bottom holes let extra water drain out.",
        "highlights": [
          "Thick 200 GSM UV-treated HDPE, lasts 4-5 years",
          "Pre-made drainage holes, no root rot",
          "Light to lift and move on terrace",
          "25 bags, ideal size for tomato and chilli"
        ],
        "tags": [
          "grow bag",
          "terrace garden",
          "nursery",
          "hdpe",
          "planter"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Kisan Kraft Limited, Bengaluru"
      },
      {
        "name": "Coco Peat Block 5kg (Expands to 75L)",
        "nameHi": "कोको पीट ब्लॉक 5 किलो (75 लीटर तक फूलता है)",
        "nameMr": "कोको पीट ब्लॉक 5 किलो (75 लिटरपर्यंत फुगतो)",
        "price": 280,
        "mrp": 399,
        "unit": "piece",
        "stock": 540,
        "brand": "Coco Natural",
        "subcategory": "Rooting Cubes & Plugs",
        "description": "A dry coconut husk block that soaks up water and swells into soft, light growing media. Mix it with soil to grow strong roots in pots, trays and grow bags.",
        "highlights": [
          "One 5kg block makes about 75 litres of media",
          "Holds water well, keeps roots airy",
          "Low EC, washed and ready to use",
          "Great for seedlings and potting mix"
        ],
        "tags": [
          "coco peat",
          "cocopeat",
          "potting media",
          "seedling",
          "soil mix"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Coco Natural India Pvt Ltd, Pollachi"
      },
      {
        "name": "Grafting & Budding Tape 1 inch x 50m (Pack of 2)",
        "nameHi": "ग्राफ्टिंग और बडिंग टेप 1 इंच x 50 मीटर (2 का पैक)",
        "nameMr": "ग्राफ्टिंग व बडिंग टेप 1 इंच x 50 मीटर (2 चा पॅक)",
        "price": 199,
        "mrp": 299,
        "unit": "pack",
        "stock": 410,
        "brand": "Tata Rallis",
        "subcategory": "Budding & Grafting Supplies",
        "description": "Stretchy clear tape to tie grafted and budded plants tightly so the joint heals fast. Stays stuck in sun and rain and you can wrap it by hand.",
        "highlights": [
          "Stretchable self-adhesive film, no extra clips",
          "Two rolls of 50 metres each",
          "Works for mango, citrus, guava grafting",
          "Sun and water resistant"
        ],
        "tags": [
          "grafting tape",
          "budding",
          "nursery",
          "plant grafting",
          "horticulture"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Rallis India Limited (Tata Enterprise), Mumbai"
      },
      {
        "name": "Rooting Hormone Gel 100ml",
        "nameHi": "रूटिंग हार्मोन जेल 100 मिली",
        "nameMr": "रूटिंग हार्मोन जेल 100 मिली",
        "price": 240,
        "mrp": 320,
        "unit": "bottle",
        "stock": 260,
        "brand": "Geolife",
        "subcategory": "Nutrient Solution (Horticulture)",
        "description": "A sticky gel you dip plant cuttings in so they grow roots quickly and survive. Useful for raising new plants from rose, hibiscus and fruit cuttings.",
        "highlights": [
          "Dip the cut end, plant in media, roots come fast",
          "Higher success rate for soft and hard cuttings",
          "Easy gel form, no powder mess",
          "100ml treats hundreds of cuttings"
        ],
        "tags": [
          "rooting hormone",
          "cutting",
          "propagation",
          "nursery",
          "plant growth"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Geolife Agritech India Pvt Ltd, Mumbai"
      },
      {
        "name": "Nursery Pro Trays 98 Cavity (Pack of 10)",
        "nameHi": "नर्सरी प्रो ट्रे 98 कैविटी (10 का पैक)",
        "nameMr": "नर्सरी प्रो ट्रे 98 कॅव्हिटी (10 चा पॅक)",
        "price": 360,
        "mrp": 520,
        "unit": "pack",
        "stock": 380,
        "brand": "Mahyco",
        "subcategory": "Rooting Cubes & Plugs",
        "description": "Plastic trays with 98 small cups to raise many healthy seedlings together. Fill with coco peat, drop seeds, and move the whole tray easily to the field.",
        "highlights": [
          "98 cavities per tray, 980 seedlings per pack",
          "Reusable strong plastic, washable",
          "Even root plugs, easy transplanting",
          "Fits chilli, tomato, brinjal, cabbage"
        ],
        "tags": [
          "pro tray",
          "seedling tray",
          "nursery",
          "98 cavity",
          "transplanting"
        ],
        "countryOfOrigin": "India",
        "manufacturer": "Maharashtra Hybrid Seeds Co. (Mahyco), Jalna"
      }
    ]
  },
  {
    "category": "Agri Inputs for Home & Kitchen Garden",
    "items": [
      {
        "name": "Kitchen Garden Vegetable Seed Kit (12 Varieties)",
        "nameHi": "किचन गार्डन सब्जी बीज किट (12 किस्में)",
        "nameMr": "किचन गार्डन भाजीपाला बियाणे किट (12 प्रकार)",
        "price": 299,
        "mrp": 449,
        "unit": "pack",
        "stock": 180,
        "brand": "Ugaoo",
        "subcategory": "Kitchen Garden Seed Kits",
        "countryOfOrigin": "India",
        "manufacturer": "Ugaoo Agritech Pvt. Ltd., Pune",
        "description": "Ek hi pack mein 12 tarah ki sabzi ke beej - tamatar, mirchi, dhaniya, methi aur aur bhi. Ghar ki chhat ya aangan mein taazi sabzi ugaane ke liye.",
        "highlights": [
          "12 vegetable seed packets in one kit",
          "High germination, fresh season seeds",
          "Easy to grow for beginners at home",
          "Sowing guide included on each packet"
        ],
        "tags": [
          "seed kit",
          "kitchen garden",
          "vegetable seeds",
          "home garden",
          "ghar ki sabzi"
        ]
      },
      {
        "name": "Enriched Potting Mix 5kg Bag",
        "nameHi": "पोषक मिट्टी पॉटिंग मिक्स 5kg बैग",
        "nameMr": "पोषक माती पॉटिंग मिक्स 5kg बॅग",
        "price": 199,
        "mrp": 280,
        "unit": "bag",
        "stock": 240,
        "brand": "TrustBasket",
        "subcategory": "Potting Mix & Garden Soil",
        "countryOfOrigin": "India",
        "manufacturer": "TrustBasket, Bengaluru",
        "description": "Taiyaar mitti jisme khaad, cocopeat aur vermicompost mila hai. Gamle aur grow bag mein seedhe daalein, paudhe achhe se badhte hain.",
        "highlights": [
          "Ready-to-use mix with compost and cocopeat",
          "Light and airy, good for pot drainage",
          "Suitable for vegetables, herbs and flowers",
          "5kg covers 8-10 medium pots"
        ],
        "tags": [
          "potting mix",
          "garden soil",
          "cocopeat",
          "vermicompost",
          "gamla mitti"
        ]
      },
      {
        "name": "Neem Oil Plant Spray 250ml",
        "nameHi": "नीम तेल पौधा स्प्रे 250ml",
        "nameMr": "कडुलिंब तेल रोप स्प्रे 250ml",
        "price": 145,
        "mrp": 220,
        "unit": "bottle",
        "stock": 320,
        "brand": "Sansar Green",
        "subcategory": "Neem Oil (Small Pack)",
        "countryOfOrigin": "India",
        "manufacturer": "Sansar Agropro Pvt. Ltd., Haryana",
        "description": "Shudh neem tel se bana spray jo keede aur fungus se paudhon ko bachata hai. Paani mein milakar patton par chhidkein.",
        "highlights": [
          "Controls aphids, mealybugs and white fly",
          "Organic - safe for kitchen garden veggies",
          "Cold pressed neem oil base",
          "Mix 5ml per litre of water"
        ],
        "tags": [
          "neem oil",
          "organic pesticide",
          "plant spray",
          "keet niyantran",
          "home garden"
        ]
      },
      {
        "name": "Mini Drip Irrigation Kit (20 Plants)",
        "nameHi": "मिनी ड्रिप सिंचाई किट (20 पौधे)",
        "nameMr": "मिनी ठिबक सिंचन किट (20 रोपे)",
        "price": 549,
        "mrp": 799,
        "unit": "set",
        "stock": 95,
        "brand": "Jain Irrigation",
        "subcategory": "Mini Drip Kits",
        "countryOfOrigin": "India",
        "manufacturer": "Jain Irrigation Systems Ltd., Jalgaon",
        "description": "Chhote bagiche ke liye taiyaar drip set - 20 paudhon tak boond-boond paani deta hai. Nal se jodein, paani ki bachat ho aur paudhe roz seenche jaayein.",
        "highlights": [
          "Waters up to 20 pots / plants",
          "Saves water with drip emitters",
          "Easy fit to tap, no tools needed",
          "Pipe, drippers and connectors included"
        ],
        "tags": [
          "drip kit",
          "mini drip",
          "terrace garden",
          "water saving",
          "thibak sinchan"
        ]
      },
      {
        "name": "HDPE Grow Bags 15x15 inch (Pack of 5)",
        "nameHi": "HDPE ग्रो बैग 15x15 इंच (5 का पैक)",
        "nameMr": "HDPE ग्रो बॅग 15x15 इंच (5 चा पॅक)",
        "price": 249,
        "mrp": 399,
        "unit": "pack",
        "stock": 160,
        "brand": "Mipatex",
        "subcategory": "Grow Bags (Home Size)",
        "countryOfOrigin": "India",
        "manufacturer": "Mipatex Nonwoven Industries, Rajkot",
        "description": "Mazboot HDPE kapde ke grow bag, mitti bharein aur sabzi ya phool ugaayein. Chhat aur balcony ke liye sahi, baar-baar istemaal hote hain.",
        "highlights": [
          "5 reusable UV-treated grow bags",
          "Good drainage, roots stay healthy",
          "Light to move, ideal for terrace/balcony",
          "Holds about 12-15 litres of soil each"
        ],
        "tags": [
          "grow bags",
          "terrace garden",
          "balcony garden",
          "HDPE",
          "sabzi ugaaye"
        ]
      }
    ]
  }
];

async function main() {
  console.log('Seeding bighaat test products (110 across 22 categories)...');
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
        images: item.images ?? [],
        tags: item.tags ?? [],
        highlights: item.highlights ?? [],
        unit: item.unit ?? 'kg',
        sellScope: 'state',
        isActive: true,
      };
      const existing = await prisma.product.findFirst({ where: { name: item.name, categoryId }, select: { id: true } });
      if (existing) { await prisma.product.update({ where: { id: existing.id }, data }); updated++; }
      else { await prisma.product.create({ data }); created++; }
    }
  }
  console.log(`Done — created: ${created}, updated: ${updated}, skipped: ${skipped}`);
}

main()
  .catch(err => { console.error('❌ Seed failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
