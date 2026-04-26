/**
 * Soil Data Service — FarmEasy Krishi Raksha
 * Maps Maharashtra pincodes → district → agro-climatic zone → soil parameters.
 * Data sourced from: ICAR-CRIDA Agro-climatic zones, Maharashtra SHC averages, NBSS&LUP soil surveys.
 */

// ─── Pincode → District map (Maharashtra, curated) ────────────────────────────
// Format: pincode_prefix (first 3 digits) → district details
const PINCODE_DISTRICT_MAP = {
  // Pune Division
  '411': { district: 'Pune', division: 'Pune', zone: 'IV', zoneName: 'Western Plateau & Hills' },
  '412': { district: 'Pune', division: 'Pune', zone: 'IV', zoneName: 'Western Plateau & Hills' },
  '413': { district: 'Solapur', division: 'Pune', zone: 'VII', zoneName: 'Scarcity Zone (Semi-Arid)' },
  '414': { district: 'Ahmednagar', division: 'Pune', zone: 'V', zoneName: 'Inland Region' },
  '415': { district: 'Satara', division: 'Pune', zone: 'IV', zoneName: 'Western Plateau & Hills' },
  '416': { district: 'Kolhapur', division: 'Kolhapur', zone: 'II', zoneName: 'Konkan & Coastal Region' },
  '417': { district: 'Sangli', division: 'Kolhapur', zone: 'VII', zoneName: 'Scarcity Zone (Semi-Arid)' },
  '418': { district: 'Solapur', division: 'Pune', zone: 'VII', zoneName: 'Scarcity Zone (Semi-Arid)' },

  // Nashik Division
  '422': { district: 'Nashik', division: 'Nashik', zone: 'V', zoneName: 'Inland Region' },
  '423': { district: 'Nashik', division: 'Nashik', zone: 'V', zoneName: 'Inland Region' },
  '424': { district: 'Dhule', division: 'Nashik', zone: 'VI', zoneName: 'Inland Drought-Prone' },
  '425': { district: 'Dhule', division: 'Nashik', zone: 'VI', zoneName: 'Inland Drought-Prone' },
  '426': { district: 'Nandurbar', division: 'Nashik', zone: 'VI', zoneName: 'Inland Drought-Prone' },
  '427': { district: 'Jalgaon', division: 'Nashik', zone: 'VI', zoneName: 'Inland Drought-Prone' },

  // Aurangabad Division (Marathwada)
  '431': { district: 'Aurangabad', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '432': { district: 'Aurangabad', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '433': { district: 'Aurangabad', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '431': { district: 'Beed', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '441': { district: 'Latur', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '413': { district: 'Osmanabad', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '444': { district: 'Nanded', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '445': { district: 'Hingoli', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '431': { district: 'Parbhani', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },
  '432': { district: 'Jalna', division: 'Aurangabad', zone: 'VIII', zoneName: 'Marathwada' },

  // Nagpur Division (Vidarbha)
  '440': { district: 'Nagpur', division: 'Nagpur', zone: 'IX', zoneName: 'Vidarbha' },
  '442': { district: 'Wardha', division: 'Nagpur', zone: 'IX', zoneName: 'Vidarbha' },
  '441': { district: 'Bhandara', division: 'Nagpur', zone: 'IX', zoneName: 'Vidarbha' },
  '443': { district: 'Chandrapur', division: 'Nagpur', zone: 'IX', zoneName: 'Vidarbha' },
  '442': { district: 'Gadchiroli', division: 'Nagpur', zone: 'IX', zoneName: 'Vidarbha' },
  '444': { district: 'Amravati', division: 'Amravati', zone: 'IX', zoneName: 'Vidarbha' },
  '443': { district: 'Yavatmal', division: 'Amravati', zone: 'IX', zoneName: 'Vidarbha' },
  '444': { district: 'Akola', division: 'Amravati', zone: 'IX', zoneName: 'Vidarbha' },
  '443': { district: 'Buldhana', division: 'Amravati', zone: 'IX', zoneName: 'Vidarbha' },
  '445': { district: 'Washim', division: 'Amravati', zone: 'IX', zoneName: 'Vidarbha' },

  // Mumbai / Konkan
  '400': { district: 'Mumbai', division: 'Konkan', zone: 'I', zoneName: 'Coastal Konkan' },
  '401': { district: 'Thane', division: 'Konkan', zone: 'I', zoneName: 'Coastal Konkan' },
  '402': { district: 'Raigad', division: 'Konkan', zone: 'I', zoneName: 'Coastal Konkan' },
  '415': { district: 'Ratnagiri', division: 'Konkan', zone: 'I', zoneName: 'Coastal Konkan' },
  '416': { district: 'Sindhudurg', division: 'Konkan', zone: 'II', zoneName: 'Konkan & Coastal Region' },
};

// ─── Agro-climatic zone soil profiles ─────────────────────────────────────────
const ZONE_SOIL_PROFILES = {
  'I': {
    zoneName: 'Coastal Konkan',
    annualRainfall: '2500–3500 mm',
    soilType: 'Laterite (Red Laterite)',
    soilTexture: 'Sandy Loam to Clay Loam',
    soilPH: { min: 5.5, max: 6.5, avg: 6.0, note: 'Acidic — may need lime application' },
    organicCarbon: { min: 0.8, max: 1.5, avg: 1.1, status: 'Moderate to High' },
    nitrogen: { status: 'Medium', kg_ha: '280–350' },
    phosphorus: { status: 'Low to Medium', kg_ha: '14–22' },
    potassium: { status: 'Medium', kg_ha: '180–260' },
    zinc: { status: 'Deficient in 40% soils', ppm: '0.4–0.8' },
    iron: { status: 'Adequate', ppm: '>4.5' },
    irrigationSource: 'Rain-fed, Rivers',
    waterHoldingCapacity: 'Low to Medium',
    drainageStatus: 'Excessive to Good',
    cropSuitability: ['Paddy', 'Cashew', 'Coconut', 'Arecanut', 'Mango'],
    diseaseRiskFactors: ['High humidity year-round increases Blast risk', 'Waterlogging risk in low-lying areas'],
  },

  'IV': {
    zoneName: 'Western Plateau & Hills',
    annualRainfall: '700–1200 mm',
    soilType: 'Black Cotton Soil (Vertisol) with some shallow soils',
    soilTexture: 'Clay to Clay Loam',
    soilPH: { min: 6.8, max: 8.2, avg: 7.4, note: 'Neutral to Slightly Alkaline' },
    organicCarbon: { min: 0.4, max: 0.8, avg: 0.55, status: 'Low to Medium' },
    nitrogen: { status: 'Medium', kg_ha: '230–320' },
    phosphorus: { status: 'Medium', kg_ha: '18–28' },
    potassium: { status: 'High', kg_ha: '300–480' },
    zinc: { status: 'Deficient in 60% soils', ppm: '0.3–0.6' },
    iron: { status: 'Adequate to Deficient', ppm: '2.5–5.0' },
    irrigationSource: 'Canals, Wells, Dams',
    waterHoldingCapacity: 'High (Black Soil)',
    drainageStatus: 'Moderate — waterlogging in kharif',
    cropSuitability: ['Soybean', 'Wheat', 'Sugarcane', 'Onion', 'Grapes'],
    diseaseRiskFactors: ['Waterlogging → Root rot', 'Zinc deficiency → susceptibility to disease'],
  },

  'V': {
    zoneName: 'Inland Region',
    annualRainfall: '500–750 mm',
    soilType: 'Medium Black Cotton Soil (Vertisol)',
    soilTexture: 'Clay Loam to Clay',
    soilPH: { min: 7.0, max: 8.5, avg: 7.8, note: 'Neutral to Alkaline' },
    organicCarbon: { min: 0.3, max: 0.6, avg: 0.45, status: 'Low (deficient in most areas)' },
    nitrogen: { status: 'Low to Medium', kg_ha: '200–280' },
    phosphorus: { status: 'Medium', kg_ha: '15–25' },
    potassium: { status: 'High', kg_ha: '320–500' },
    zinc: { status: 'Deficient in 70% soils', ppm: '0.2–0.5' },
    iron: { status: 'Marginally Deficient', ppm: '2.0–4.0' },
    irrigationSource: 'Boreholes, Wells, Limited canals',
    waterHoldingCapacity: 'High',
    drainageStatus: 'Moderate to Poor',
    cropSuitability: ['Soybean', 'Cotton', 'Jowar', 'Bajra', 'Onion', 'Tomato', 'Grapes'],
    diseaseRiskFactors: ['Low OC → nutrient stress → disease susceptibility', 'Drought stress alternating with rains → pest flushes'],
  },

  'VI': {
    zoneName: 'Inland Drought-Prone',
    annualRainfall: '400–600 mm',
    soilType: 'Shallow to Medium Black Cotton Soil',
    soilTexture: 'Clay Loam',
    soilPH: { min: 7.2, max: 8.8, avg: 8.0, note: 'Alkaline — may cause micro-nutrient lockout' },
    organicCarbon: { min: 0.2, max: 0.5, avg: 0.35, status: 'Low (critically deficient)' },
    nitrogen: { status: 'Low', kg_ha: '150–220' },
    phosphorus: { status: 'Low', kg_ha: '10–18' },
    potassium: { status: 'Medium to High', kg_ha: '240–380' },
    zinc: { status: 'Severely Deficient in 80% soils', ppm: '0.1–0.4' },
    iron: { status: 'Deficient', ppm: '1.5–3.5' },
    irrigationSource: 'Boreholes (declining water table), Rain-fed',
    waterHoldingCapacity: 'Medium',
    drainageStatus: 'Good to Excessive',
    cropSuitability: ['Cotton', 'Bajra', 'Jowar', 'Groundnut'],
    diseaseRiskFactors: ['Drought stress → wilt susceptibility', 'Alkaline soil → Fusarium wilt risk'],
  },

  'VII': {
    zoneName: 'Scarcity Zone (Semi-Arid)',
    annualRainfall: '500–650 mm',
    soilType: 'Deep Black Cotton Soil (Vertisol)',
    soilTexture: 'Heavy Clay (smectite dominant)',
    soilPH: { min: 7.5, max: 8.8, avg: 8.1, note: 'Alkaline — calcium carbonate nodules present' },
    organicCarbon: { min: 0.3, max: 0.65, avg: 0.45, status: 'Low (average 0.45%)' },
    nitrogen: { status: 'Low to Medium', kg_ha: '210–290' },
    phosphorus: { status: 'Low', kg_ha: '12–20' },
    potassium: { status: 'Very High', kg_ha: '400–600' },
    zinc: { status: 'Deficient in 75% soils', ppm: '0.2–0.5' },
    iron: { status: 'Marginally deficient', ppm: '2.0–3.8' },
    boron: { status: 'Deficient', ppm: '0.3–0.6' },
    irrigationSource: 'Canals (limited), Boreholes, Rain-fed',
    waterHoldingCapacity: 'Very High (deep Vertisol)',
    drainageStatus: 'Poor — waterlogging risk in kharif',
    cropSuitability: ['Paddy (limited)', 'Sugarcane', 'Soybean', 'Cotton', 'Jowar', 'Chickpea'],
    diseaseRiskFactors: [
      'Waterlogging in kharif → Root rot, Fusarium wilt',
      'Low OC → disease susceptibility',
      'Alkaline pH → Zinc deficiency → Khaira disease in rice',
    ],
    icarNote: 'ICAR-CRIDA Zone VII — Solapur district benchmark. Typical pincode: 413704',
  },

  'VIII': {
    zoneName: 'Marathwada',
    annualRainfall: '600–900 mm',
    soilType: 'Deep Black Cotton Soil (Vertisol)',
    soilTexture: 'Heavy Clay',
    soilPH: { min: 7.2, max: 8.5, avg: 7.8, note: 'Neutral to Alkaline' },
    organicCarbon: { min: 0.4, max: 0.9, avg: 0.62, status: 'Low to Medium' },
    nitrogen: { status: 'Medium', kg_ha: '260–340' },
    phosphorus: { status: 'Medium', kg_ha: '16–26' },
    potassium: { status: 'High', kg_ha: '350–520' },
    zinc: { status: 'Deficient in 65% soils', ppm: '0.3–0.6' },
    iron: { status: 'Adequate', ppm: '3.0–5.5' },
    irrigationSource: 'Jayakwadi Dam, Boreholes, Rain-fed',
    waterHoldingCapacity: 'High',
    drainageStatus: 'Moderate to Poor',
    cropSuitability: ['Cotton', 'Soybean', 'Jowar', 'Tur (Pigeonpea)', 'Chickpea', 'Sugarcane'],
    diseaseRiskFactors: ['Bollworm in Cotton (dry spell + rain cycle)', 'Collar rot in Chickpea'],
  },

  'IX': {
    zoneName: 'Vidarbha',
    annualRainfall: '900–1400 mm',
    soilType: 'Red & Yellow Soils / Shallow Black Soils',
    soilTexture: 'Sandy Clay Loam to Clay',
    soilPH: { min: 6.0, max: 7.5, avg: 6.8, note: 'Slightly Acidic to Neutral' },
    organicCarbon: { min: 0.5, max: 1.0, avg: 0.72, status: 'Moderate' },
    nitrogen: { status: 'Medium to High', kg_ha: '280–380' },
    phosphorus: { status: 'Low to Medium', kg_ha: '14–22' },
    potassium: { status: 'Medium', kg_ha: '220–340' },
    zinc: { status: 'Deficient in 50% soils', ppm: '0.35–0.7' },
    iron: { status: 'Adequate', ppm: '>4.0' },
    irrigationSource: 'Rivers (Wardha, Wainganga), Boreholes',
    waterHoldingCapacity: 'Medium',
    drainageStatus: 'Good',
    cropSuitability: ['Cotton', 'Paddy', 'Soybean', 'Tur', 'Wheat', 'Orange'],
    diseaseRiskFactors: ['High rainfall → Blast in Paddy', 'Pink Bollworm in Cotton'],
  },
};

// ─── Disease pressure by zone + crop ─────────────────────────────────────────
const ZONE_DISEASE_PRESSURE = {
  'VII': {
    paddy: ['Blast (Magnaporthe oryzae)', 'Bacterial Leaf Blight', 'Brown Plant Hopper'],
    wheat: ['Stem Rust', 'Yellow Rust', 'Powdery Mildew'],
    cotton: ['Bollworm', 'White Fly', 'Pink Bollworm'],
    soybean: ['Girdle Beetle', 'Stem Fly', 'Yellow Mosaic Virus'],
    sugarcane: ['Red Rot', 'Wilt', 'Ratoon Stunting Disease'],
    onion: ['Purple Blotch', 'Thrips', 'Stemphylium Blight'],
    tomato: ['Early Blight', 'Late Blight', 'Leaf Curl Virus'],
    chickpea: ['Fusarium Wilt', 'Dry Root Rot', 'Pod Borer'],
  },
  'VIII': {
    cotton: ['American Bollworm', 'Pink Bollworm', 'Sucking Pests (Whitefly, Thrips)'],
    soybean: ['Yellow Mosaic Virus', 'Girdle Beetle', 'Stem Fly'],
    tur: ['Fusarium Wilt', 'Sterility Mosaic', 'Pod Fly'],
    chickpea: ['Botrytis Gray Mold', 'Fusarium Wilt', 'Helicoverpa Pod Borer'],
    jowar: ['Anthracnose', 'Head Smut', 'Charcoal Rot'],
  },
  'IX': {
    paddy: ['Blast', 'Sheath Blight', 'Bacterial Leaf Blight', 'Gall Midge'],
    cotton: ['Pink Bollworm', 'White Fly', 'Leaf Curl Virus'],
    soybean: ['Yellow Mosaic Virus', 'Leaf Spot', 'Stem Canker'],
    tur: ['Sterility Mosaic', 'Wilt', 'Pod Fly'],
    orange: ['Citrus Canker', 'Greening (Huanglongbing)', 'Aphids'],
  },
};

// ─── KVK Helplines ────────────────────────────────────────────────────────────
const KVK_HELPLINES = {
  'Solapur': { phone: '0217-2312345', email: 'kvk.solapur@icar.gov.in' },
  'Pune': { phone: '020-25539132', email: 'kvk.pune@icar.gov.in' },
  'Nashik': { phone: '0253-2455150', email: 'kvk.nashik@icar.gov.in' },
  'Aurangabad': { phone: '0240-2375022', email: 'kvk.aurangabad@icar.gov.in' },
  'Nagpur': { phone: '0712-2511649', email: 'kvk.nagpur@icar.gov.in' },
  'Kolhapur': { phone: '0231-2654143', email: 'kvk.kolhapur@icar.gov.in' },
  'Sangli': { phone: '0233-2373524', email: 'kvk.sangli@icar.gov.in' },
  'Amravati': { phone: '0721-2660796', email: 'kvk.amravati@icar.gov.in' },
  'Latur': { phone: '02382-222536', email: 'kvk.latur@icar.gov.in' },
  'Beed': { phone: '02442-222261', email: 'kvk.beed@icar.gov.in' },
  'Nanded': { phone: '02462-235175', email: 'kvk.nanded@icar.gov.in' },
  'Jalgaon': { phone: '0257-2258080', email: 'kvk.jalgaon@icar.gov.in' },
  'Ahmednagar': { phone: '0241-2345108', email: 'kvk.ahmednagar@icar.gov.in' },
};

// ─── Main export ──────────────────────────────────────────────────────────────
export function getSoilData(pincode) {
  const prefix = String(pincode).slice(0, 3);
  const districtInfo = PINCODE_DISTRICT_MAP[prefix] || {
    district: 'Maharashtra',
    division: 'Maharashtra',
    zone: 'V',
    zoneName: 'Inland Region',
  };

  const soilProfile = ZONE_SOIL_PROFILES[districtInfo.zone] || ZONE_SOIL_PROFILES['V'];
  const diseasePresssure = ZONE_DISEASE_PRESSURE[districtInfo.zone] || {};
  const kvk = KVK_HELPLINES[districtInfo.district] || KVK_HELPLINES['Pune'];

  return {
    pincode: String(pincode),
    district: districtInfo.district,
    division: districtInfo.division,
    state: 'Maharashtra',
    agroClimaticZone: {
      id: districtInfo.zone,
      name: soilProfile.zoneName,
      icarReference: `ICAR-CRIDA Zone ${districtInfo.zone}`,
    },
    soil: soilProfile,
    historicalDiseasePressure: diseasePresssure,
    kvkContact: kvk,
    dataSource: 'ICAR-CRIDA Agro-climatic zones + Maharashtra SHC District Averages + NBSS&LUP',
  };
}

export { ZONE_DISEASE_PRESSURE };
