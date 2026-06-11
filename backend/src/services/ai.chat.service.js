/**
 * FarmMind AI Service (Gemini-only)
 *
 * Text tasks  → Gemini (gemini-2.5-flash)
 * Vision task → Gemini (gemini-2.5-flash) native REST
 *               ↳ fallback: Gemini symptom-based text analysis (no image)
 *
 * CropSetu consolidated onto Google Gemini for production; the Groq + Claude
 * provider paths were removed.
 */
import OpenAI from 'openai';
import { ENV } from '../config/env.js';
import { extractJSON as extractJSONFromResponse } from '../utils/jsonExtract.js';
import logger from '../utils/logger.js';

// ── Client factory ─────────────────────────────────────────────────────────────
function makeGeminiClient() {
  if (!ENV.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
  return new OpenAI({
    apiKey: ENV.GEMINI_API_KEY,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  });
}

// Lazy singleton
let _gemini = null;
const gemini = () => { if (!_gemini) _gemini = makeGeminiClient(); return _gemini; };

const GEMINI_MODEL = ENV.GEMINI_MODEL || 'gemini-2.5-flash';

// ── Season helper ──────────────────────────────────────────────────────────────
export function getCurrentSeason() {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 6 && month <= 9)  return 'Kharif (Monsoon)';
  if (month >= 10 && month <= 11) return 'Rabi sowing';
  if (month >= 12 || month <= 2)  return 'Rabi (Winter)';
  return 'Zaid (Summer)';
}

// ── Crop stage derivation from age (days) ──────────────────────────────────────
function getCropStageFromAge(cropAge) {
  if (!cropAge || isNaN(Number(cropAge))) return null;
  const days = Number(cropAge);
  if (days <= 15)  return 'Germination / Establishment';
  if (days <= 30)  return 'Seedling';
  if (days <= 55)  return 'Vegetative Growth';
  if (days <= 75)  return 'Flowering / Bud Initiation';
  if (days <= 100) return 'Fruit Set / Pod Fill';
  return 'Maturation / Pre-harvest';
}

// ── Crop stage labels in Marathi ───────────────────────────────────────────────
function getCropStageMarathi(cropAge) {
  if (!cropAge || isNaN(Number(cropAge))) return null;
  const days = Number(cropAge);
  if (days <= 15)  return 'उगवण / स्थापना';
  if (days <= 30)  return 'रोपण अवस्था';
  if (days <= 55)  return 'वनस्पती वाढ';
  if (days <= 75)  return 'फुलोरा / कळी येणे';
  if (days <= 100) return 'फळ धरणे / शेंग भरणे';
  return 'पक्वता / काढणीपूर्व';
}

// ── Marathi system prompt ──────────────────────────────────────────────────────
function buildMarathiSystemPrompt(farmProfile = {}) {
  const {
    farmerName,
    state,
    district,
    crops,
    currentCrops,
    previousCrop,
    landSize,
    soilType,
    irrigationType,
  } = farmProfile;

  const currentMonth  = new Date().toLocaleString('mr-IN', { month: 'long' });
  const currentSeason = getCurrentSeason();
  const resolvedCrops = crops || currentCrops || [];

  const seasonMr = currentSeason.includes('Kharif') ? 'खरीप (पावसाळी)'
    : currentSeason.includes('Rabi') ? 'रब्बी (हिवाळी)'
    : 'झायद (उन्हाळी)';

  let cropLines = '';
  if (resolvedCrops.length > 0) {
    cropLines = resolvedCrops.map((c) => {
      const name  = typeof c === 'string' ? c : (c.name || c.cropName || 'अज्ञात');
      const age   = typeof c === 'object' ? (c.ageInDays || c.age || null) : null;
      const stage = age ? getCropStageMarathi(age) : null;
      const agePart   = age   ? `, ${age} दिवस जुने`      : '';
      const stagePart = stage ? ` (अवस्था: ${stage})`     : '';
      return `  • ${name}${agePart}${stagePart}`;
    }).join('\n');
  }

  const farmLines = [
    farmerName     ? `शेतकऱ्याचे नाव  : ${farmerName}` : null,
    state          ? `राज्य           : ${state}` : null,
    district       ? `जिल्हा          : ${district}` : null,
    soilType       ? `मातीचा प्रकार   : ${soilType}` : null,
    irrigationType ? `सिंचन पद्धत     : ${irrigationType}` : null,
    landSize       ? `शेताचा आकार     : ${landSize}` : null,
    previousCrop   ? `मागील पीक       : ${previousCrop}` : null,
    cropLines      ? `सध्याची पिके    :\n${cropLines}` : null,
    `सध्याचा महिना  : ${currentMonth}`,
    `सध्याचा हंगाम  : ${seasonMr}`,
  ].filter(Boolean).join('\n');

  return `तुम्ही FarmMind आहात — भारतीय शेतकऱ्यांसाठी एक अनुभवी AI कृषी सल्लागार.
${farmerName ? `तुम्ही सध्या ${farmerName} यांना मदत करत आहात.` : 'तुम्ही एका शेतकऱ्याला मदत करत आहात.'}

━━━ शेतकऱ्याची शेती माहिती ━━━━━━━━━━━━━━━━━━━━━━━━━━━
${farmLines}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

तुमची तज्ज्ञता (नेहमी उत्तरात वापरा):
१. पिकांचे रोग व कीड — ओळख, तीव्रता, रासायनिक आणि सेंद्रिय उपाय
२. IPM (एकात्मिक कीड व्यवस्थापन) — वेळापत्रक, उंबरठा, सापळा पिके
३. पोषण व्यवस्थापन — NPK, सूक्ष्म पोषण, कमतरतेची लक्षणे, खत वेळ व मात्रा (kg/एकर, ml/लिटर)
४. सिंचन नियोजन — ठिबक, पूर, तुषार; पीक अवस्थेनुसार वेळापत्रक
५. मातीचे आरोग्य — pH सुधारणा, सेंद्रिय पदार्थ, हिरवळ खत, FYM
६. मंडई भाव व बाजार — विक्री धोरण, साठवण वेळ, APMC, FPO, e-NAM
७. सरकारी योजना — PM-KISAN, PMFBY, KCC, माती आरोग्य पत्रिका, PKVY, NMSA, RKVY
८. हंगामी पीक कॅलेंडर — खरीप, रब्बी, झायद; पेरणीच्या खिडक्या
९. काढणीपश्चात व्यवस्थापन — ग्रेडिंग, साठवण, प्रक्रिया, शीत साखळी
१०. सेंद्रिय व नैसर्गिक शेती — ZBNF, जीवामृत, पंचगव्य, जैव निविष्ठा व मात्रा

परिस्थिती जागरूकता:
- सध्या ${currentMonth} महिना आहे (${seasonMr} हंगाम).
${resolvedCrops.length > 0 ? `- शेतकऱ्याच्या पिकांच्या अवस्था वरील प्रोफाइलमध्ये दिल्या आहेत. सर्व सल्ला त्या अवस्थांनुसार द्या.` : ''}
${soilType ? `- माती ${soilType} प्रकाराची आहे — पाणी धारण क्षमता, pH आणि पोषण वर्तन लक्षात घ्या.` : ''}
${irrigationType ? `- सिंचन पद्धत ${irrigationType} आहे — पाणी व खत सल्ला त्यानुसार द्या.` : ''}
${state ? `- सल्ला ${state}${district ? `, ${district}` : ''} च्या हवामान, कीड दाब आणि स्थानिक मंडई भावांनुसार असावा.` : ''}
${previousCrop ? `- मागील पीक ${previousCrop} होते — रोग व पोषण असंतुलनावर लक्ष ठेवा.` : ''}

उत्तर देण्याचे नियम:
१. उत्तर संक्षिप्त ठेवा: सामान्य प्रश्नांसाठी २०० शब्दांपेक्षा कमी.
२. साध्या मराठीत लिहा जी शेतकऱ्याला समजेल. शास्त्रीय शब्द टाळा.
३. रोग किंवा पोषण प्रश्नांसाठी नेहमी रासायनिक आणि सेंद्रिय/नैसर्गिक दोन्ही पर्याय द्या.
४. नेहमी ठराविक मात्रा द्या: फवारणीसाठी ml/लिटर, जमिनीसाठी kg/एकर, विद्राव्य खतांसाठी g/लिटर.
५. रोग किंवा कीड निदानासाठी उत्तराच्या शेवटी हे जोडा:
   DIAGNOSIS_JSON_START{"disease":"नाव","confidence":85,"severity":"low|moderate|high","crop":"पीकनाव","treatment":["पायरी १ उत्पाद + मात्रा","पायरी २","पायरी ३"],"prevention":"एक वाक्य प्रतिबंध टिप"}DIAGNOSIS_JSON_END
६. बाजार भाव किंवा विक्री प्रश्नांसाठी शेवटी जोडा:
   MARKET_JSON_START{"crop":"पीकनाव","insight":"थोडक्यात बाजार माहिती","recommendation":"sell|hold|wait"}MARKET_JSON_END
७. सरकारी योजना प्रश्नांसाठी — योजनेचे नाव + एक ओळीत फायदा + पात्रता सांगा.
८. ठराविक मंडई भाव बनवू नका. माहिती नसल्यास म्हणा: "आपल्या स्थानिक मंडई / e-NAM अॅपवर तपासा."
९. ब्रँड नाव सांगताना नेहमी सामान्य सक्रिय घटक आणि सेंद्रिय पर्यायही सांगा.
१०. प्रत्येक रोग/कीड उत्तराच्या शेवटी लिहा: "अधिक खात्रीसाठी आपल्या जवळच्या कृषी विज्ञान केंद्र (KVK) किंवा कृषी अधिकाऱ्यांशी संपर्क करा."
११. शेती, कृषी किंवा ग्रामीण उपजीविकेशी संबंधित नसलेल्या प्रश्नांसाठी म्हणा: "मी फक्त शेती आणि कृषी प्रश्नांमध्येच मदत करू शकतो."

कधीही करू नका:
- पीक भाव किंवा उत्पादन बनवू नका
- शेतीशी असंबंधित वैद्यकीय सल्ला देऊ नका
- शेती / ग्रामीण उपजीविकेबाहेरचे प्रश्न सोडवू नका`;
}

// ── Build personalised system prompt ──────────────────────────────────────────
export function buildSystemPrompt(farmProfile = {}) {
  // Route to language-specific prompt if language is set
  const lang = (farmProfile.language || '').toLowerCase();
  if (lang === 'mr' || lang === 'mr-in') return buildMarathiSystemPrompt(farmProfile);

  const {
    farmerName,
    state,
    district,
    crops,           // array of { name, ageInDays }
    currentCrops,    // alternative field name
    previousCrop,
    landSize,
    soilType,
    irrigationType,
  } = farmProfile;

  const currentMonth  = new Date().toLocaleString('en-IN', { month: 'long' });
  const currentSeason = getCurrentSeason();
  const resolvedCrops = crops || currentCrops || [];

  // Build crop context string
  let cropLines = '';
  if (resolvedCrops.length > 0) {
    cropLines = resolvedCrops.map((c) => {
      const name  = typeof c === 'string' ? c : (c.name || c.cropName || 'Unknown');
      const age   = typeof c === 'object' ? (c.ageInDays || c.age || null) : null;
      const stage = age ? getCropStageFromAge(age) : null;
      const agePart  = age   ? `, ${age} days old`         : '';
      const stagePart = stage ? ` (stage: ${stage})`        : '';
      return `  • ${name}${agePart}${stagePart}`;
    }).join('\n');
  }

  // Build the farm context block
  const farmLines = [
    farmerName    ? `Farmer Name    : ${farmerName}` : null,
    state         ? `State          : ${state}` : null,
    district      ? `District       : ${district}` : null,
    soilType      ? `Soil Type      : ${soilType}` : null,
    irrigationType ? `Irrigation     : ${irrigationType}` : null,
    landSize      ? `Farm Size      : ${landSize}` : null,
    previousCrop  ? `Previous Crop  : ${previousCrop}` : null,
    cropLines     ? `Current Crops  :\n${cropLines}` : null,
    `Current Month  : ${currentMonth}`,
    `Current Season : ${currentSeason}`,
  ].filter(Boolean).join('\n');

  return `You are FarmMind, a highly experienced AI farming advisor dedicated to Indian farmers.
${farmerName ? `You are currently assisting ${farmerName}.` : 'You are assisting a farmer.'}

━━━ FARMER'S FARM PROFILE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${farmLines}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR EXPERTISE (always apply in answers):
1. Crop Diseases & Pests — identification, severity, India-specific treatment plans with chemical AND organic options
2. IPM (Integrated Pest Management) — schedule, thresholds, beneficial insects, trap crops
3. Nutrient Management — NPK, micro-nutrients, deficiency symptoms, fertilizer timing with doses (kg/acre, ml/litre, g/litre)
4. Irrigation Scheduling — drip, flood, sprinkler; scheduling by crop stage and evapotranspiration
5. Soil Health — pH correction, organic matter, green manuring, FYM application
6. Mandi Prices & Market — selling strategies, storage timing, APMCs, FPOs, e-NAM
7. Government Schemes — PM-KISAN, PMFBY, KCC (Kisan Credit Card), Soil Health Card, PKVY, NMSA, RKVY
8. Seasonal Crop Calendar — Kharif, Rabi, Zaid; sowing windows for major Indian crops
9. Post-Harvest Management — grading, storage, processing, cold chain, value addition
10. Organic & Natural Farming — ZBNF, Jeevamrit, Panchagavya, bio-inputs with doses

CONTEXT AWARENESS:
- It is currently ${currentMonth} (${currentSeason} season in India).
${resolvedCrops.length > 0 ? `- The farmer's crops are at the stages listed in the profile above. Tailor ALL advice to these crop stages.` : ''}
${soilType ? `- Soil is ${soilType} — account for its water-holding capacity, pH tendency, and nutrient behaviour.` : ''}
${irrigationType ? `- Irrigation method is ${irrigationType} — adjust water and fertilizer advice accordingly.` : ''}
${state ? `- Advice must be relevant for ${state}${district ? `, ${district}` : ''} climate, pest pressure, and local mandi prices.` : ''}
${previousCrop ? `- Previous crop was ${previousCrop} — watch for carry-over diseases and nutrient imbalances.` : ''}

RESPONSE RULES:
1. Keep answers concise: under 200 words for general questions.
2. Write in simple English a farmer can understand. Avoid scientific jargon unless explaining it.
3. Always give BOTH chemical option AND organic/natural option when answering disease or nutrient questions.
4. Always include specific doses: ml/litre for sprays, kg/acre for soil application, g/litre for soluble fertilizers.
5. For disease or pest diagnosis, append this block at the end of your response:
   DIAGNOSIS_JSON_START{"disease":"name","confidence":85,"severity":"low|moderate|high","crop":"CropName","treatment":["Step 1 with product + dose","Step 2","Step 3"],"prevention":"one sentence tip"}DIAGNOSIS_JSON_END
6. For market price or selling questions, append at the end:
   MARKET_JSON_START{"crop":"CropName","insight":"brief market insight","recommendation":"sell|hold|wait"}MARKET_JSON_END
7. For government scheme questions — list scheme name + one-line benefit + eligibility.
8. Never make up specific mandi prices. Say "check your local mandi / e-NAM app" if you don't know current prices.
9. Never recommend a brand name without mentioning the generic active ingredient and an organic substitute.
10. End every disease/pest answer with: "Consult your nearest Krishi Vigyan Kendra (KVK) or local agronomist for confirmation."
11. If a question is not about farming, agriculture, or rural livelihoods, say: "I can only help with farming and agriculture questions."

NEVER:
- Fabricate crop prices or yields
- Give medical advice unrelated to farming
- Answer questions outside farming / rural livelihoods`;
}

// ── Build weather risk summary for scan prompt ────────────────────────────────
function buildWeatherBlock(w) {
  if (!w) return '';
  const c   = w.current || {};
  const agr = w.agriculture || {};

  const humidity    = c.humidity ?? null;
  const leafWetness = c.leafWetness ?? null;
  const vpd         = c.vapourPressureDeficit ?? null;
  const rain        = c.precipitation ?? 0;
  const rainProb    = w.hourly?.[0]?.precipitationProbability ?? null;
  const soilMoist   = agr.soilMoisture?.surface ?? null;
  const soilTemp    = agr.soilTemperature?.surface ?? null;

  // Compute disease pressure signals
  const fungalRisk    = humidity >= 85 || leafWetness >= 70 ? 'HIGH ⚠' : humidity >= 65 ? 'MODERATE' : 'LOW';
  const bacterialRisk = rain > 5 ? 'HIGH ⚠' : rain > 1 ? 'MODERATE' : 'LOW';
  const insectRisk    = (c.temperature >= 28 && humidity < 70) ? 'HIGH ⚠' : 'MODERATE';

  const lines = [
    c.temperature  != null ? `Temperature     : ${c.temperature}°C (feels like ${c.feelsLike ?? c.temperature}°C)` : null,
    humidity       != null ? `Humidity        : ${humidity}% ${humidity >= 85 ? '⚠ HIGH — prime fungal window' : ''}` : null,
    c.dewPoint     != null ? `Dew Point       : ${c.dewPoint}°C` : null,
    leafWetness    != null ? `Leaf Wetness    : ${leafWetness}% ${leafWetness >= 70 ? '⚠ HIGH — spore germination active' : ''}` : null,
    rain           != null ? `Rain (current)  : ${rain} mm` : null,
    rainProb       != null ? `Rain Chance 24h : ${rainProb}%` : null,
    c.cloudCover   != null ? `Cloud Cover     : ${c.cloudCover}%` : null,
    vpd            != null ? `VPD             : ${vpd} kPa ${vpd < 0.5 ? '(very low — high fungal risk)' : ''}` : null,
    soilMoist      != null ? `Soil Moisture   : ${soilMoist}%` : null,
    soilTemp       != null ? `Soil Temp       : ${soilTemp}°C` : null,
  ].filter(Boolean).join('\n');

  return `
━━━ REAL-TIME WEATHER AT FARM LOCATION ━━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WEATHER-DRIVEN DISEASE PRESSURE (use these to weight your diagnosis):
• Fungal diseases  : ${fungalRisk}
• Bacterial diseases: ${bacterialRisk}
• Insect / pest    : ${insectRisk}
NOTE: High humidity + leaf wetness are the PRIMARY triggers for most fungal and bacterial crop diseases. Adjust your confidence and disease ranking accordingly.`;
}

// ── Build detailed scan prompt ─────────────────────────────────────────────────
export function buildScanPrompt(farmContext = {}, weatherContext = null) {
  const {
    cropName,
    cropAge,
    variety,              // crop variety (e.g. "Pusa 1121" for basmati)
    symptoms,
    firstNoticed,
    affectedArea,         // e.g. "30% of field"
    affectedPlantParts,   // e.g. ["leaves", "stem", "roots"]
    additionalSymptoms,
    state,
    district,
    soilType,
    irrigationType,
    previousCrop,
    landSize,
    recentFertilizer,     // e.g. "Urea 50 kg/acre 10 days ago"
    recentPesticide,      // e.g. "Chlorpyrifos spray 7 days ago"
    lastIrrigationDate,   // e.g. "3 days ago"
    neighboringCropIssues,// e.g. "neighbor's tomato has blight"
    seedSource,           // e.g. "certified / local / saved"
    waterSource,          // e.g. "borewell / canal / rainwater"
    farmingMethod,        // e.g. "organic / conventional / IPM"
  } = farmContext;

  const currentMonth  = new Date().toLocaleString('en-IN', { month: 'long' });
  const currentSeason = getCurrentSeason();
  const cropStage     = cropAge ? getCropStageFromAge(cropAge) : null;
  const symptomList   = Array.isArray(symptoms)
    ? symptoms.filter(Boolean).join(', ')
    : (symptoms || 'Not specified');
  const affectedParts = Array.isArray(affectedPlantParts)
    ? affectedPlantParts.join(', ')
    : (affectedPlantParts || null);

  const contextBlock = [
    cropName            ? `Crop              : ${cropName}` : null,
    variety             ? `Variety           : ${variety}` : null,
    cropAge             ? `Crop Age          : ${cropAge} days` : null,
    cropStage           ? `Crop Stage        : ${cropStage}` : null,
    landSize            ? `Land Size         : ${landSize}` : null,
    state               ? `State             : ${state}` : null,
    district            ? `District          : ${district}` : null,
    soilType            ? `Soil Type         : ${soilType}` : null,
    irrigationType      ? `Irrigation Type   : ${irrigationType}` : null,
    waterSource         ? `Water Source      : ${waterSource}` : null,
    farmingMethod       ? `Farming Method    : ${farmingMethod}` : null,
    previousCrop        ? `Previous Crop     : ${previousCrop}` : null,
    seedSource          ? `Seed Source       : ${seedSource}` : null,
    symptomList         ? `Symptoms Reported : ${symptomList}` : null,
    affectedParts       ? `Affected Parts    : ${affectedParts}` : null,
    firstNoticed        ? `First Noticed     : ${firstNoticed}` : null,
    affectedArea        ? `Affected Area     : ${affectedArea}` : null,
    recentFertilizer    ? `Recent Fertilizer : ${recentFertilizer}` : null,
    recentPesticide     ? `Recent Pesticide  : ${recentPesticide}` : null,
    lastIrrigationDate  ? `Last Irrigation   : ${lastIrrigationDate}` : null,
    neighboringCropIssues ? `Neighbor's Field  : ${neighboringCropIssues}` : null,
    additionalSymptoms  ? `Additional Notes  : ${additionalSymptoms}` : null,
    `Current Month     : ${currentMonth}`,
    `Current Season    : ${currentSeason}`,
  ].filter(Boolean).join('\n');

  const weatherBlock = buildWeatherBlock(weatherContext);

  return `You are a world-class agricultural pathologist and agronomist specialising in Indian crop diseases, pests, and nutrient deficiencies. Your diagnosis must be as accurate as a field expert.

━━━ FARM CONTEXT PROVIDED BY FARMER ━━━━━━━━━━━━━━━━━━━
${contextBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${weatherBlock}

ANALYSIS INSTRUCTIONS — follow every point:
1. Study the image first — identify the crop, then look for symptoms (spots, lesions, discolouration, wilting, deformity, pest presence, nutrient patterns).
2. Cross-reference with the farm context: crop stage, soil type, irrigation, previous crop, and farming method all narrow the differential.
3. Cross-reference with the WEATHER data: high humidity + leaf wetness = fungal; recent rain = bacterial; hot+dry = insect/mite; low VPD = downy/powdery mildew.
4. Consider the regional disease calendar: diseases prevalent in ${state || 'India'} during ${currentSeason} for ${cropName || 'this crop'}.
5. If multiple diseases are possible, rank them by probability and diagnose the most likely. Set confidence based on how clearly the image and context match.
6. For nutrient deficiency: check interveinal chlorosis (Mg, Fe, Mn), uniform yellowing (N), purple tinge (P), tip/edge burn (K, Ca, B).
7. Check recentPesticide — if the farmer sprayed recently, resistance or phytotoxicity may be causing symptoms.
8. Check recentFertilizer — excess N → lush growth → fungal susceptibility; K deficiency → tip burn.
9. Neighboring crop issues can indicate spread — flag this as a high-urgency spread risk.

Return ONLY valid JSON — no markdown, no explanation, no text outside the JSON:
{
  "disease": "Full disease / pest / deficiency name",
  "scientific": "Scientific name (genus species), or empty string",
  "crop": "Crop identified in image",
  "confidence": 85,
  "severity": "low|moderate|high|critical",
  "isHealthy": false,
  "stage": "Early|Active|Advanced",
  "affectedPlantPart": "Leaves|Stem|Root|Fruit|Flower|Whole plant",
  "pathogenType": "Fungal|Bacterial|Viral|Insect|Nutrient deficiency|Abiotic stress|Unknown",
  "causes": [
    "Primary cause — e.g. Phytophthora infestans spores in high-humidity conditions",
    "Contributing factor 1",
    "Contributing factor 2"
  ],
  "weatherContribution": "Specific explanation of how current weather conditions promote or reduce this disease",
  "immediateAction": "Single most critical action the farmer MUST take TODAY (with product and dose)",
  "treatment": [
    {
      "step": 1,
      "action": "Precise description of what to do",
      "chemical": "Generic active ingredient (avoid brand names)",
      "dose": "e.g. 2 ml/litre water, 500 g/acre",
      "applicationMethod": "Spray / Soil drench / Seed treatment / Dust / Fertigation",
      "timing": "Morning / Evening / After irrigation / Before rain",
      "interval": "Repeat every X days",
      "safetyNote": "PHI (pre-harvest interval) and safety precaution"
    }
  ],
  "organicTreatment": {
    "method": "Organic / ZBNF / Jeevamrit / Panchagavya / bio-input name",
    "dose": "e.g. 3 ml/litre, 10 litres/acre",
    "frequency": "How often to apply",
    "effectiveness": "low|moderate|high"
  },
  "nutrientLink": "If a nutrient imbalance is contributing, specify it (e.g. Low K reduces cell wall resistance)",
  "resistanceNote": "If farmer recently sprayed the same class of chemical, note possible resistance",
  "prevention": "One strong prevention tip for future crops / seasons",
  "spreadRisk": "low|medium|high",
  "spreadMechanism": "How this disease/pest spreads — e.g. wind-borne spores, soil-borne, insect vector",
  "estimatedYieldLoss": "e.g. 20-40% if untreated within 5 days",
  "products": [
    {
      "name": "Generic product / active ingredient",
      "type": "Fungicide|Insecticide|Bactericide|Bio-pesticide|Nutrient|Organic",
      "dose": "e.g. 2 g/litre",
      "waitingPeriod": "Days before harvest"
    }
  ],
  "followUpSchedule": [
    { "day": 3,  "action": "Inspect treated area — look for improvement or new lesions" },
    { "day": 7,  "action": "Second spray if symptoms persist" },
    { "day": 14, "action": "Full field assessment — consult KVK if not recovered" }
  ],
  "consultExpert": false,
  "urgencyLevel": "immediate|today|this_week",
  "notes": "Any additional observations — nutrient deficiency signs, other stress visible in image, general plant health"
}

If the image does not show a crop or plant: {"error": "Not a crop image", "confidence": 0}
If the crop appears completely healthy: set "isHealthy": true, "disease": "Healthy Crop", "severity": "low", confidence to your certainty, and fill remaining fields appropriately.`;
}

// ── Updated planner prompt ─────────────────────────────────────────────────────
const PLANNER_PROMPT = (ctx) => {
  const season    = ctx.season    || getCurrentSeason();
  const month     = ctx.month     || new Date().toLocaleString('en-IN', { month: 'long' });
  const cropStage = ctx.dayOfSeason ? getCropStageFromAge(ctx.dayOfSeason) : 'Unknown stage';

  return `You are FarmMind's daily task planner for Indian farmers.

Farm context:
- Farmer : ${ctx.farmerName || 'Farmer'}
- Crop   : ${ctx.crop || 'Unknown crop'} (Day ${ctx.dayOfSeason || '?'} of season)
- Stage  : ${cropStage}
- Season : ${season} — ${month}
- State  : ${ctx.state || 'Maharashtra'}, ${ctx.district || ''}
- Soil   : ${ctx.soilType || 'Not specified'}
- Irrigation: ${ctx.irrigationType || 'Not specified'}
- Previous Crop: ${ctx.previousCrop || 'Not specified'}

Generate exactly 5 practical farming tasks for TODAY that are:
1. Appropriate for the current crop stage (${cropStage})
2. Seasonally relevant for ${season} in ${ctx.state || 'India'}
3. Covering disease/pest scouting, irrigation, fertilization, field hygiene, or market prep as appropriate
4. Specific enough to be actionable (mention quantities, timings, or product names where useful)

Return ONLY valid JSON (no other text):
{
  "tasks": [
    {
      "title": "Task title (max 8 words)",
      "description": "Exactly what to do today — include quantities, timings, or conditions if relevant",
      "crop": "Crop name",
      "field": "Field/Block identifier or empty string",
      "priority": "urgent|today|plan",
      "icon": "flask-outline|water-outline|leaf-outline|earth-outline|bug-outline|cut-outline|calendar-outline|storefront-outline",
      "color": "#E74C3C|#3498DB|#2ECC71|#E67E22|#F39C12",
      "aiReason": "Why this task matters specifically at day ${ctx.dayOfSeason || '?'} of the crop season (1 sentence)"
    }
  ]
}

Priority guide: urgent = must do before 10am, today = anytime today, plan = this week.
Color guide: urgent/pest=#E74C3C, water=#3498DB, crop growth=#2ECC71, soil/fertilizer=#E67E22, general/market=#F39C12`;
};


// ── Parse structured delimiters from chat response ────────────────────────────
export function parseStructuredData(text) {
  const diagMatch = text.match(/DIAGNOSIS_JSON_START([\s\S]*?)DIAGNOSIS_JSON_END/);
  if (diagMatch) {
    try {
      return {
        type: 'diagnosis',
        data: JSON.parse(diagMatch[1].trim()),
        cleanText: text.replace(/DIAGNOSIS_JSON_START[\s\S]*?DIAGNOSIS_JSON_END/g, '').trim(),
      };
    } catch (err) {
      logger.warn('[parseStructuredData] Malformed DIAGNOSIS JSON from AI: %s', err.message);
    }
  }
  const mktMatch = text.match(/MARKET_JSON_START([\s\S]*?)MARKET_JSON_END/);
  if (mktMatch) {
    try {
      return {
        type: 'market',
        data: JSON.parse(mktMatch[1].trim()),
        cleanText: text.replace(/MARKET_JSON_START[\s\S]*?MARKET_JSON_END/g, '').trim(),
      };
    } catch (err) {
      logger.warn('[parseStructuredData] Malformed MARKET JSON from AI: %s', err.message);
    }
  }
  return { type: 'text', data: null, cleanText: text };
}

// ── Helper: single Gemini text call ──────────────────────────────────────────
async function callGeminiChat(params) {
  if (!ENV.GEMINI_API_KEY) throw new Error('No AI provider configured — set GEMINI_API_KEY in .env');
  const res = await gemini().chat.completions.create({ ...params, model: GEMINI_MODEL });
  return res.choices[0]?.message?.content || '';
}

// ── Main chat ─────────────────────────────────────────────────────────────────
export async function chatWithFarmMind(userMessage, conversationHistory = [], farmProfile = {}) {
  const systemPrompt  = buildSystemPrompt(farmProfile);
  const recentHistory = conversationHistory.slice(-10);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const rawText = await callGeminiChat({ messages, temperature: 0.7, max_tokens: 700 });

  const { type, data, cleanText } = parseStructuredData(rawText);
  return { reply: cleanText, type, structuredData: data };
}

// ── Planner task generation ────────────────────────────────────────────────────
export async function generatePlannerTasks(farmContext) {
  const messages = [{ role: 'user', content: PLANNER_PROMPT(farmContext) }];

  const rawText = await callGeminiChat({
    messages, temperature: 0.6, max_tokens: 900,
    response_format: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(rawText);
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch (err) {
    logger.warn('[PlannerTasks] Failed to parse AI response as JSON: %s — raw: %s', err.message, rawText?.slice(0, 120));
    return [];
  }
}

// ── Sleep helper ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));


// ── Text-only fallback diagnosis via Gemini (when vision is unavailable) ──────
async function analyzeBySymptoms(farmContext) {
  if (!ENV.GEMINI_API_KEY) throw new Error('No AI provider available');

  const {
    cropName, cropAge, symptoms, firstNoticed, affectedArea,
    additionalSymptoms, state, district, soilType, irrigationType, previousCrop,
  } = farmContext;

  const currentSeason = getCurrentSeason();
  const cropStage     = cropAge ? getCropStageFromAge(cropAge) : null;
  const symptomList   = Array.isArray(symptoms)
    ? symptoms.filter(Boolean).join(', ')
    : (typeof symptoms === 'string' ? symptoms.trim() : '');

  // Without an image AND without symptoms we cannot produce a meaningful diagnosis
  const hasContext = symptomList || additionalSymptoms;
  if (!hasContext) {
    return {
      disease: 'Insufficient information',
      scientific: '',
      crop: cropName || 'Unknown',
      confidence: 0,
      severity: 'low',
      isHealthy: false,
      stage: 'Unknown',
      causes: [],
      immediateAction: 'Please retake the image in good daylight and describe visible symptoms (yellowing, spots, wilting, etc.) so we can give an accurate diagnosis.',
      treatment: [],
      organicTreatment: { method: '', dose: '', frequency: '', effectiveness: 'low' },
      prevention: 'Describe the symptoms you can see on the plant for a proper diagnosis.',
      weatherRiskNote: '',
      spreadRisk: 'low',
      estimatedYieldLoss: 'Cannot estimate without diagnosis',
      products: [],
      followUpSchedule: [],
      consultExpert: true,
      urgencyLevel: 'this_week',
      notes: 'Image could not be analysed and no symptoms were provided. Please describe the problem you see (e.g. yellowing leaves, brown spots, wilting) or retake the photo in clear daylight.',
      diagnosisMethod: 'symptom-based',
      error: 'no_symptoms',
    };
  }

  const prompt = `You are an expert agricultural pathologist specialising in Indian crops.

A farmer reports the following problem (no image available — diagnose ONLY from the symptoms described):

Crop            : ${cropName || 'Unknown'}
Crop Age        : ${cropAge ? cropAge + ' days' : 'Unknown'}
Crop Stage      : ${cropStage || 'Unknown'}
Symptoms        : ${symptomList || 'Not specified'}
First Noticed   : ${firstNoticed || 'Unknown'}
Affected Area   : ${affectedArea || 'Unknown'}
Additional Notes: ${additionalSymptoms || 'None'}
State           : ${state || 'India'}
District        : ${district || ''}
Soil Type       : ${soilType || 'Unknown'}
Irrigation      : ${irrigationType || 'Unknown'}
Previous Crop   : ${previousCrop || 'Unknown'}
Season          : ${currentSeason}
Month           : ${new Date().toLocaleString('en-IN', { month: 'long' })}

IMPORTANT:
- Diagnose ONLY based on the specific symptoms described above — do NOT default to a generic answer.
- If symptoms suggest a pest, diagnose pest. If fungal, diagnose fungal. If nutrient, diagnose specific nutrient.
- If the symptoms are too vague to distinguish one disease from another, name the top 2 possibilities and explain why.
- Set confidence to 50 or below if the symptoms are vague or incomplete.

Return ONLY valid JSON (no other text):
{
  "disease": "Most likely disease/condition based specifically on the symptoms above",
  "scientific": "Scientific name if applicable, else empty string",
  "crop": "${cropName || 'Unknown'}",
  "confidence": 60,
  "severity": "low|moderate|high|critical",
  "isHealthy": false,
  "stage": "Early|Active|Advanced",
  "causes": ["Primary cause based on the reported symptoms", "Contributing factor"],
  "immediateAction": "Most important action the farmer should take TODAY based on these specific symptoms",
  "treatment": [
    {
      "step": 1,
      "action": "What to do",
      "chemical": "Active ingredient / generic name",
      "dose": "e.g. 2 ml/litre",
      "applicationMethod": "Spray / Soil drench",
      "timing": "Morning / Evening",
      "interval": "Repeat every X days",
      "safetyNote": "PHI or safety precaution"
    }
  ],
  "organicTreatment": {
    "method": "Organic / natural treatment name",
    "dose": "e.g. 3 ml/litre",
    "frequency": "How often to apply",
    "effectiveness": "low|moderate|high"
  },
  "prevention": "One actionable prevention tip for future crops",
  "weatherRiskNote": "How ${currentSeason} season affects this specific disease",
  "spreadRisk": "low|medium|high",
  "estimatedYieldLoss": "e.g. 10-30% if untreated",
  "products": [
    { "name": "Generic product / active ingredient", "type": "Fungicide|Insecticide|Bio-pesticide|Nutrient", "dose": "2 g/litre" }
  ],
  "followUpSchedule": [
    { "day": 3, "action": "Check for improvement" },
    { "day": 7, "action": "Second application if needed" },
    { "day": 14, "action": "Assess recovery" }
  ],
  "consultExpert": false,
  "urgencyLevel": "immediate|today|this_week",
  "notes": "Note: This diagnosis is based on reported symptoms only (no image). Confirm with local agronomist.",
  "diagnosisMethod": "symptom-based"
}`;

  const res = await gemini().chat.completions.create({
    model: GEMINI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');

  // Cap confidence — no image means maximum 55% certainty
  if (parsed.confidence > 55) parsed.confidence = 55;

  // Hard-reject if the model returned a generic guess with no symptoms to support it
  const genericGuesses = ['nitrogen deficiency', 'nutrient deficiency', 'iron deficiency', 'unknown disease'];
  if (genericGuesses.some(g => (parsed.disease || '').toLowerCase().includes(g)) && !symptomList) {
    return {
      disease: 'Insufficient information',
      confidence: 0,
      severity: 'low',
      isHealthy: false,
      crop: cropName || 'Unknown',
      consultExpert: true,
      urgencyLevel: 'this_week',
      diagnosisMethod: 'symptom-based',
      error: 'vision_failed_no_symptoms',
      notes: 'Image analysis failed and no symptoms were provided. Please retake the photo in clear daylight or describe visible symptoms (colour change, spots, wilting, etc.).',
      immediateAction: 'Retake the photo in good natural light, or describe what you see on the plant.',
      treatment: [], products: [], followUpSchedule: [],
      organicTreatment: { method: '', dose: '', frequency: '', effectiveness: 'low' },
    };
  }

  logger.debug('[Scan/Gemini-text] diagnosed: %s (%d%% confidence, symptom-based)', parsed.disease, parsed.confidence);
  return parsed;
}

// extractJSON → imported from utils/jsonExtract.js as extractJSONFromResponse

// ── Gemini vision call — uses native REST API (OpenAI-compat wrapper is broken for vision) ──
async function runGeminiVision(prompt, base64Image, mimeType) {
  if (!ENV.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const safeMime = allowedMimes.includes(mimeType) ? mimeType : 'image/jpeg';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${ENV.GEMINI_API_KEY}`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: safeMime, data: base64Image } },
      ],
    }],
    generationConfig: {
      temperature:      0.1,
      maxOutputTokens:  1800,
      responseMimeType: 'application/json',   // native Gemini JSON mode — works with vision
    },
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (res.status === 429 && attempt === 1) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '4', 10) * 1000;
      const wait = Math.min(retryAfter, 6000);
      logger.warn('[Scan/Gemini] rate limited, retrying after %ds', Math.round(wait/1000));
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw Object.assign(new Error(`Gemini vision HTTP ${res.status}: ${errBody.slice(0, 150)}`), { status: res.status });
    }

    const json = await res.json();
    const raw  = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    logger.debug('[Scan/Gemini] raw (first 250): %s', raw.slice(0, 250));

    const parsed = extractJSONFromResponse(raw);
    if (parsed.error || !parsed.disease) {
      throw new Error(`Gemini returned invalid diagnosis: ${JSON.stringify(parsed).slice(0, 100)}`);
    }

    parsed.diagnosisMethod = 'gemini-vision';
    logger.debug('[Scan/Gemini] diagnosed: "%s" confidence=%d%%', parsed.disease, parsed.confidence);
    return parsed;
  }
}

// ── Main crop scan — Gemini vision, symptom-based fallback ────────────────────
export async function scanCropImage(base64Image, mimeType = 'image/jpeg', farmContext = {}, weatherContext = null) {
  const prompt = buildScanPrompt(farmContext, weatherContext);

  if (ENV.GEMINI_API_KEY) {
    try {
      return await runGeminiVision(prompt, base64Image, mimeType);
    } catch (err) {
      logger.warn('[Scan/Gemini] vision failed: %s', err?.message?.slice(0, 80));
    }
  }

  // Vision unavailable/failed — symptom-based text fallback (also Gemini).
  logger.warn('[Scan] Gemini vision unavailable — running symptom-based fallback');
  return analyzeBySymptoms(farmContext);
}

