/**
 * Pest Risk Engine
 *
 * Logic:
 * 1. Fetch 7-day forecast from Open-Meteo for a district (lat/lng)
 * 2. Load pest rules from PEST_RULES below
 * 3. Check weather conditions vs. each rule's trigger thresholds
 * 4. Check crop stage vulnerability
 * 5. Severity: critical (3+ conditions) / high (2) / moderate (1)
 * 6. Persist PestAlert records, expire after validUntil
 *
 * Sources:
 *   Weather: Open-Meteo (free, no key required)
 *   Pest rules: ICAR NCIPM bulletins + KVK advisories (compiled below)
 */
import axios from 'axios';

// ── Pest rules (weather-based triggers) ──────────────────────────────────────
// Each rule has weather trigger thresholds + crop stage vulnerability window
export const PEST_RULES = [
  {
    pest: 'Late Blight',
    pestHi: 'लेट ब्लाइट (आलू/टमाटर)',
    affectedCrops: ['tomato', 'potato'],
    triggers: {
      humidity:            { min: 85 },
      temperature:         { min: 15, max: 22 },
      consecutiveRainDays: 3,
    },
    vulnerableStages:   [40, 100],   // DAS window
    symptoms: [
      { description: 'Water-soaked spots on lower leaves turning brown/black',       descriptionHi: 'पत्तियों पर पानी भरे धब्बे जो भूरे-काले हो जाते हैं' },
      { description: 'White fluffy mold under leaves in early morning humid weather', descriptionHi: 'सुबह नमी में पत्तियों के नीचे सफेद फफूंद' },
    ],
    solutions: {
      organic:   [{ method: 'Bordeaux Mixture 1%',           methodHi: 'बोर्डो मिश्रण 1%', dosage: '500 litre/acre', applicationTiming: 'every 7 days in humid weather' }],
      chemical:  [{ product: 'Metalaxyl + Mancozeb 72WP',    activeIngredient: 'Metalaxyl 8% + Mancozeb 64%', dosage: '2.5 g/litre', applicationTiming: 'at first sign, every 7-10 days', safetyPrecautions: 'PHI 7 days' }],
    },
  },
  {
    pest: 'Powdery Mildew',
    pestHi: 'चूर्णिल फफूंद',
    affectedCrops: ['wheat', 'grapes', 'onion', 'gram'],
    triggers: {
      humidity:    { min: 70, max: 90 },
      temperature: { min: 16, max: 28 },
    },
    vulnerableStages: [30, 90],
    symptoms: [
      { description: 'White powdery coating on leaves, stems, and flowers', descriptionHi: 'पत्तियों, तने और फूलों पर सफेद चूर्ण' },
    ],
    solutions: {
      organic:  [{ method: 'Wettable Sulphur 80WP',             methodHi: 'गंधक का चूर्ण', dosage: '3 g/litre', applicationTiming: 'spray early morning every 10 days' }],
      chemical: [{ product: 'Propiconazole 25EC',                activeIngredient: 'Propiconazole', dosage: '1 ml/litre', applicationTiming: 'at first sign', safetyPrecautions: 'PHI 14 days' }],
    },
  },
  {
    pest: 'Yellow Rust',
    pestHi: 'पीला रतुआ (गेहूँ)',
    affectedCrops: ['wheat'],
    triggers: {
      humidity:    { min: 80 },
      temperature: { min: 10, max: 15 },
    },
    vulnerableStages: [50, 90],
    symptoms: [
      { description: 'Yellow/orange pustule stripes running parallel on leaves', descriptionHi: 'पत्तियों पर पीले/नारंगी धारीदार फुंसियाँ' },
    ],
    solutions: {
      organic:  [{ method: 'No effective organic option — act fast chemically', methodHi: 'तुरंत रासायनिक उपचार करें', dosage: '', applicationTiming: '' }],
      chemical: [{ product: 'Propiconazole 25EC', activeIngredient: 'Propiconazole', dosage: '1 ml/litre', applicationTiming: 'immediately at first sign — do not delay', safetyPrecautions: 'PHI 14 days. Harvest after 14 days of spray.' }],
    },
  },
  {
    pest: 'Fall Armyworm',
    pestHi: 'फॉल आर्मीवर्म (मक्का)',
    affectedCrops: ['maize', 'jowar', 'bajra'],
    triggers: {
      humidity:    { min: 60 },
      temperature: { min: 25, max: 38 },
    },
    vulnerableStages: [10, 60],
    symptoms: [
      { description: 'Scraping of leaves resulting in windows / transparent patches', descriptionHi: 'पत्तियों पर खुरचने के निशान — पारदर्शी खिड़कियाँ' },
      { description: 'Circular holes in whorl with frass (sawdust-like excreta)',      descriptionHi: 'पत्ते की घुंडी में छेद, चूरे जैसा मल' },
    ],
    solutions: {
      organic:  [{ method: 'Neem oil 1500ppm',           methodHi: 'नीम तेल', dosage: '5 ml/litre into whorl', applicationTiming: 'early morning, repeat every 7 days' }],
      chemical: [{ product: 'Emamectin Benzoate 5SG',    activeIngredient: 'Emamectin Benzoate', dosage: '0.4 g/litre into whorl', applicationTiming: 'early morning, repeat if >5 larvae/plant', safetyPrecautions: 'PHI 7 days. Use sand+water mix for whorl application.' }],
    },
  },
  {
    pest: 'Thrips',
    pestHi: 'थ्रिप्स',
    affectedCrops: ['onion', 'cotton', 'tomato', 'grapes', 'pomegranate'],
    triggers: {
      humidity:    { min: 30, max: 65 },
      temperature: { min: 28, max: 40 },
    },
    vulnerableStages: [20, 90],
    symptoms: [
      { description: 'Silvery streaks / white patches on leaves, distorted young leaves', descriptionHi: 'पत्तियों पर चांदी जैसी धारियाँ, नई पत्तियाँ मुड़ी हुई' },
    ],
    solutions: {
      organic:  [{ method: 'Spinosad 45SC (OMRI listed)',  methodHi: 'स्पिनोसैड', dosage: '0.3 ml/litre', applicationTiming: 'morning spray, repeat after 7 days' }],
      chemical: [{ product: 'Fipronil 5SC',                activeIngredient: 'Fipronil', dosage: '1.5 ml/litre', applicationTiming: 'spray at ETL (5-10 thrips/leaf)', safetyPrecautions: 'PHI 5 days' }],
    },
  },
  {
    pest: 'Brown Plant Hopper',
    pestHi: 'भूरा पत्ता फुदका (धान)',
    affectedCrops: ['rice'],
    triggers: {
      humidity:            { min: 85 },
      temperature:         { min: 25, max: 32 },
      consecutiveRainDays: 5,
    },
    vulnerableStages: [45, 90],
    symptoms: [
      { description: '"Hopper burn" — circular brown patches in field', descriptionHi: 'खेत में गोलाकार भूरे धब्बे — होपर बर्न' },
      { description: 'Base of plant covered with hoppers',               descriptionHi: 'पौधे की जड़ के पास भूरे कीड़े' },
    ],
    solutions: {
      organic:  [{ method: 'Drain field and expose hoppers to predators', methodHi: 'खेत से पानी निकालें, शिकारी कीटों को बढ़ावा दें', dosage: '', applicationTiming: '' }],
      chemical: [{ product: 'Buprofezin 25SC', activeIngredient: 'Buprofezin', dosage: '1.25 ml/litre', applicationTiming: 'direct spray at base of plants at ETL (5 hoppers/hill)', safetyPrecautions: 'PHI 14 days' }],
    },
  },
  {
    pest: 'Bacterial Blight',
    pestHi: 'जीवाणु झुलसा (कपास)',
    affectedCrops: ['cotton'],
    triggers: {
      humidity:            { min: 80 },
      temperature:         { min: 28, max: 38 },
      consecutiveRainDays: 2,
    },
    vulnerableStages: [30, 120],
    symptoms: [
      { description: 'Angular water-soaked lesions on leaves, turning brown-black', descriptionHi: 'पत्तियों पर कोणीय पानी भरे धब्बे जो भूरे-काले होते हैं' },
      { description: 'Boll shedding, blackarm on petioles',                          descriptionHi: 'फूल-फल झड़ना, डंठलों पर काला धब्बा' },
    ],
    solutions: {
      organic:  [{ method: 'Copper oxychloride 50WP', methodHi: 'कॉपर ऑक्सीक्लोराइड', dosage: '3 g/litre', applicationTiming: 'preventive spray before rain' }],
      chemical: [{ product: 'Streptomycin Sulphate 90% + Tetracycline 10% (0.5g/L)', activeIngredient: 'Streptomycin + Tetracycline', dosage: '0.5 g/litre + Copper oxychloride 3g/L', applicationTiming: 'at first sign', safetyPrecautions: 'PHI 21 days. Avoid spraying in high temperature.' }],
    },
  },
  {
    pest: 'Soybean Rust',
    pestHi: 'सोयाबीन रतुआ',
    affectedCrops: ['soybean'],
    triggers: {
      humidity:            { min: 80 },
      temperature:         { min: 18, max: 28 },
      consecutiveRainDays: 4,
    },
    vulnerableStages: [40, 80],
    symptoms: [
      { description: 'Small tan/brown pustules on underside of leaves, yellow above', descriptionHi: 'पत्तियों के नीचे हल्के भूरे फुंसियाँ, ऊपर पीलापन' },
    ],
    solutions: {
      organic:  [{ method: 'No effective organic option — act chemically', methodHi: 'रासायनिक उपचार जरूरी', dosage: '', applicationTiming: '' }],
      chemical: [{ product: 'Tebuconazole 25.9EC', activeIngredient: 'Tebuconazole', dosage: '1 ml/litre', applicationTiming: 'at first sign — preventive spray at flowering', safetyPrecautions: 'PHI 30 days' }],
    },
  },
];

// ── Fetch weather from Open-Meteo (reused logic, no API key needed) ───────────
async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_max&timezone=Asia%2FKolkata&forecast_days=7`;
  const res = await axios.get(url, { timeout: 8000 });
  return res.data;
}

// ── Calculate consecutive rain days from forecast ─────────────────────────────
function countConsecutiveRainDays(precipArray) {
  let count = 0;
  for (const p of precipArray) {
    if (p > 2) count++; else break;
  }
  return count;
}

// ── Evaluate one pest rule against weather conditions ────────────────────────
function evaluateRule(rule, weather) {
  const { daily } = weather;
  if (!daily) return { triggered: false, severity: 'low', matchCount: 0 };

  const maxHumidity = Math.max(...(daily.relative_humidity_2m_max || [0]));
  const maxTemp     = Math.max(...(daily.temperature_2m_max || [0]));
  const minTemp     = Math.min(...(daily.temperature_2m_min || [0]));
  const avgTemp     = (maxTemp + minTemp) / 2;
  const rainDays    = countConsecutiveRainDays(daily.precipitation_sum || []);

  const t = rule.triggers;
  let matchCount = 0;

  if (t.humidity) {
    const inRange = (!t.humidity.min || maxHumidity >= t.humidity.min) && (!t.humidity.max || maxHumidity <= t.humidity.max);
    if (inRange) matchCount++;
  }
  if (t.temperature) {
    const inRange = (!t.temperature.min || avgTemp >= t.temperature.min) && (!t.temperature.max || avgTemp <= t.temperature.max);
    if (inRange) matchCount++;
  }
  if (t.consecutiveRainDays && rainDays >= t.consecutiveRainDays) matchCount++;

  if (matchCount === 0) return { triggered: false, severity: 'low', matchCount };

  const severity = matchCount >= 3 ? 'critical' : matchCount === 2 ? 'high' : 'moderate';
  return { triggered: true, severity, matchCount, humidity: maxHumidity, avgTemp, rainDays };
}

// ── Pre-indexed rules by crop for O(1) lookup instead of O(rules×crops) ──────
// Built once at module load. Maps crop name (lowercase) → Set of rule indices.
const RULES_BY_CROP = new Map();
PEST_RULES.forEach((rule, idx) => {
  for (const crop of rule.affectedCrops) {
    const key = crop.toLowerCase();
    if (!RULES_BY_CROP.has(key)) RULES_BY_CROP.set(key, new Set());
    RULES_BY_CROP.get(key).add(idx);
  }
});

// ── Main: generate pest alerts for a location + crop list ────────────────────
export async function generatePestAlerts({ lat, lon, state, district, crops = [], dayOfSeason = 45 }) {
  let weather;
  try {
    weather = await fetchWeather(lat, lon);
  } catch (err) {
    console.warn('[PestRisk] Weather fetch failed for lat=%s lon=%s: %s — skipping alert generation', lat, lon, err.message);
    return [];
  }

  // Determine which rules to evaluate: O(crops) lookup via pre-built index
  let rulesToCheck;
  if (crops.length > 0) {
    const ruleIndices = new Set();
    const cropSet = new Set(crops.map(c => c.toLowerCase()));
    for (const cropName of cropSet) {
      // exact match first
      const exact = RULES_BY_CROP.get(cropName);
      if (exact) for (const idx of exact) ruleIndices.add(idx);
      // substring fallback for partial matches (e.g. "red onion" matches "onion")
      if (!exact) {
        for (const [key, indices] of RULES_BY_CROP) {
          if (cropName.includes(key) || key.includes(cropName)) {
            for (const idx of indices) ruleIndices.add(idx);
          }
        }
      }
    }
    rulesToCheck = [...ruleIndices].map(i => PEST_RULES[i]);
  } else {
    rulesToCheck = PEST_RULES;
  }

  const activeAlerts = [];

  for (const rule of rulesToCheck) {

    // Check crop stage vulnerability
    const [stageMin, stageMax] = rule.vulnerableStages || [0, 999];
    if (dayOfSeason < stageMin || dayOfSeason > stageMax) continue;

    const { triggered, severity, matchCount, humidity, avgTemp, rainDays } = evaluateRule(rule, weather);
    if (!triggered) continue;

    activeAlerts.push({
      pest:          rule.pest,
      pestHi:        rule.pestHi,
      affectedCrops: rule.affectedCrops,
      severity,
      state,
      districts:     [district],
      lat,
      lng:           lon,
      radiusKm:      50,
      symptoms:      rule.symptoms,
      solutions:     rule.solutions,
      triggerConditions: {
        humidity:           Math.round(humidity || 0),
        avgTemp:            Math.round(avgTemp  || 0),
        consecutiveRainDays: rainDays || 0,
        matchCount,
        description: `${matchCount} weather condition(s) triggered: humidity=${Math.round(humidity || 0)}%, temp=${Math.round(avgTemp || 0)}°C, rain days=${rainDays}`,
      },
      validFrom:  new Date(),
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),  // valid 7 days
      source:     'auto',
      isActive:   true,
    });
  }

  return activeAlerts;
}
