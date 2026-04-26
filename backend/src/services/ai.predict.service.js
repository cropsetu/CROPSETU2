/**
 * AI Prediction Service — FarmEasy Krishi Raksha
 *
 * Sends crop images + field context to Gemini (primary) or Groq (429 fallback)
 * and returns a structured disease diagnosis JSON. Key design choices:
 *  - Chain-of-thought _reasoning field forces the model to reason before diagnosing
 *  - snake_case schema avoids model confusion with mixed naming
 *  - temperature 0.0 for maximum determinism
 *  - Confidence normalised from 0-100 integer → 0.0-1.0 float
 *  - Automatic retry with backoff (3 attempts) + JSON repair prompt on parse failure
 *  - Falls back to a "needs_rescan" response when images are unusable
 */
import OpenAI from 'openai';
import fs from 'fs';
import crypto from 'crypto';
import { ENV } from '../config/env.js';
import { extractJSONString } from '../utils/jsonExtract.js';
import logger from '../utils/logger.js';

export const PROMPT_VERSION = 'v3.0';

// ─── Client singletons ───────────────────────────────────────────────────────
let _geminiClient = null;
let _groqClient = null;

function getClient(provider = 'gemini') {
  if (provider === 'groq' && ENV.GROQ_API_KEY) {
    if (!_groqClient) {
      _groqClient = new OpenAI({
        apiKey: ENV.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      });
    }
    return _groqClient;
  }
  if (!_geminiClient) {
    if (ENV.GEMINI_API_KEY) {
      _geminiClient = new OpenAI({
        apiKey: ENV.GEMINI_API_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
    } else if (ENV.OPENAI_API_KEY) {
      _geminiClient = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
    } else {
      throw new Error('No AI key configured — set GEMINI_API_KEY or OPENAI_API_KEY in .env');
    }
  }
  return _geminiClient;
}

function getModel(provider = 'gemini') {
  if (provider === 'groq') return 'meta-llama/llama-4-scout-17b-16e-instruct';
  return ENV.GEMINI_API_KEY
    ? (ENV.GEMINI_MODEL || 'gemini-2.5-flash')
    : 'gpt-4o';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function calcDAS(sowingDate) {
  if (!sowingDate) return null;
  return Math.max(0, Math.round((Date.now() - new Date(sowingDate).getTime()) / 86400000));
}

function imageToBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function getImageMimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  return map[ext] || 'image/jpeg';
}

// ─── System Prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(language = 'en') {
  const LANG_NAMES = { en: 'English', hi: 'Hindi', mr: 'Marathi', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', te: 'Telugu', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi' };
  const langInstruction = language !== 'en'
    ? `\n\nIMPORTANT: All human-readable text fields in the JSON (disease name, description, symptoms, treatment names, action_items, organic_alternatives, causes, follow_up text, prevention tips, safety notes) MUST be written in ${LANG_NAMES[language] || 'English'} language using its native script. Keep JSON keys, product names (brand names), and dosage units in English.\n`
    : '';
  return `You are Dr. Krishi AI, an expert plant pathologist and agronomist with 25+ years in Indian agriculture. You know ICAR disease thresholds, CIB&RC registered pesticides, IMD weather-disease correlations, Maharashtra agro-climatic zones, and NCIPM IPM guidelines deeply.${langInstruction}

══ ABSOLUTE RULES ════════════════════════════════════════════════════════════
R1  OUTPUT: Return ONLY a single valid JSON object. No markdown, no code fences, no extra text before or after.
R2  REASONING FIRST: Fill "_reasoning" before "status". Think step by step: image quality → symptom pattern → differential → final diagnosis.
R3  NO GUESSING: If image quality is poor (blur / dark / wrong organ / cluttered / no symptoms), set status="needs_rescan". Do NOT invent a diagnosis from an unusable image.
R4  CONSERVATIVE CONFIDENCE (decimal 0.0–1.0):
    0.85–1.00 = textbook symptoms + strong weather/crop match
    0.60–0.84 = clear symptoms, some uncertainty
    0.40–0.59 = ambiguous symptoms or key metadata missing
    0.01–0.39 = very weak evidence → ALSO set needs_rescan=true
    0.00       = no evidence at all
R5  DISEASE CATEGORY: must be exactly one of: "disease", "pest", "abiotic", "healthy", "unknown"
R6  STATUS: must be exactly one of: "ok", "needs_rescan", "needs_more_context"
R7  CROSS-REFERENCE: weather × soil × growth_stage × das × irrigation × fungicide_history × image findings
R8  PESTICIDES: Use only CIB&RC registered products. Include actual registration numbers (e.g. CIR-2023-xxx). If you do not know the real CIB&RC reg number, set reg_no to null — never fabricate it.
R9  FARMER SUMMARY: Write farmer_friendly_summary in 2–3 simple sentences. No technical jargon. Focus on what to do TODAY.
R10 RISK LEVEL: must be exactly one of: "LOW", "MODERATE", "HIGH", "CRITICAL"
R11 NEVER: Do not use "N/A", do not return arrays with null elements, do not skip the _reasoning field.

══ IMAGE QUALITY RULES ══════════════════════════════════════════════════════
Per image, check for: blur, low_light, wrong_organ, too_far, overlapping_leaves, no_symptoms_visible, partial_visibility.
If the "close_up" view is missing AND symptoms are on leaves/stems, set needs_rescan=true and add "close_up_missing" to image_quality.issues.
If ALL images are unusable, set status="needs_rescan", confidence=0.0.

══ REQUIRED OUTPUT SCHEMA (field: type) ════════════════════════════════════
{
  "_reasoning": string,          // Step 1-4 chain of thought (required, write BEFORE other fields)
  "status": "ok"|"needs_rescan"|"needs_more_context",
  "needs_rescan": boolean,
  "disease_category": "disease"|"pest"|"abiotic"|"healthy"|"unknown",
  "overall_risk": number (0-100),
  "risk_level": "LOW"|"MODERATE"|"HIGH"|"CRITICAL",
  "confidence_score": number (0.0-1.0),
  "image_quality": { "usable": boolean, "per_image": [{"index":number,"type":string,"usable":boolean,"issues":string[]}], "issues": string[] },
  "missing_inputs": string[],
  "primary_disease": { "name":string, "scientific_name":string, "probability":number, "severity":"Low"|"Moderate"|"High"|"Critical", "description":string, "cause":string },
  "differential_diagnoses": [{ "name":string, "type":string, "probability":number, "reason":string }],
  "diseases": [{ "name":string, "probability":number, "severity":string }],
  "pesticides": [{ "name":string, "active_ingredient":string, "dose":string, "dose_per_acre":string, "timing":string, "reg_no":string|null, "type":string, "phi_days":number, "resistance_group":string }],
  "fertilizers": [{ "nutrient":string, "product":string, "dose":string, "method":string, "timing":string, "reason":string }],
  "cultural_controls": string[],
  "immediate_actions": string[],
  "preventive_measures": string[],
  "weather_risk": { "next_3_days":string, "risk_trend":"INCREASING"|"STABLE"|"DECREASING" },
  "nutritional_deficiencies": string[],
  "location_info": { "pincode":string, "district":string, "zone":string, "kvk_contact":string, "icar_region":string },
  "farmer_friendly_summary": string,  // 2-3 simple sentences, no jargon, focus on what to do TODAY
  "analysis_notes": string
}`;
}

// ─── User Prompt ──────────────────────────────────────────────────────────────
function buildUserPrompt(params, imageLabels) {
  const {
    pincode, cropType, growthStage, variety, sowingDate, fieldArea,
    irrigationMethod, lastIrrigatedDate, fertilizerType, prevCrop, waterQuality,
    soilPh, organicCarbon, nitrogenLevel, phosphorusLevel, potassiumLevel, soilMoisture,
    lastFungicideDate, symptomOnsetDays, symptoms,
    weather, soilData,
  } = params;

  const das = calcDAS(sowingDate);
  const daysSinceIrrigation = lastIrrigatedDate
    ? Math.round((Date.now() - new Date(lastIrrigatedDate).getTime()) / 86400000) : null;
  const daysSinceFungicide = lastFungicideDate
    ? Math.round((Date.now() - new Date(lastFungicideDate).getTime()) / 86400000) : null;

  const w = weather?.current || {};
  const forecast = weather?.forecast?.slice(0, 3) || [];
  const soil = soilData?.soil || {};

  // Track which key views are present
  const hasCloseUp = imageLabels.includes('close_up');
  const hasWholePlant = imageLabels.includes('whole_plant');
  const missingViews = [];
  if (!hasCloseUp) missingViews.push('close_up');
  if (!hasWholePlant) missingViews.push('whole_plant');

  const imageSection = imageLabels.length > 0
    ? `IMAGES PROVIDED: ${imageLabels.length}
${imageLabels.map((t, i) => `  • Image ${i + 1}: ${t}`).join('\n')}
${missingViews.length > 0 ? `MISSING VIEWS: ${missingViews.join(', ')} → flag these in image_quality.issues` : 'All key views present.'}
TASK PER IMAGE: Check blur / lighting / organ type / symptom visibility. Document findings in image_quality.per_image BEFORE diagnosing.`
    : `IMAGES PROVIDED: 0
→ No images. Set needs_rescan=true. List required views in image_quality.issues.`;

  const symptomStr = Array.isArray(symptoms) && symptoms.length > 0
    ? symptoms.join('; ')
    : 'None reported by farmer';

  return `## CROP DISEASE ANALYSIS REQUEST [${PROMPT_VERSION}]

━━ IMAGES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${imageSection}

━━ CROP & FIELD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Crop            : ${cropType}
Variety         : ${variety || 'Not specified'}
Growth Stage    : ${growthStage}
DAS             : ${das !== null ? `${das} days` : 'Not provided'}
Field Area      : ${fieldArea || '1'} acres
Previous Crop   : ${prevCrop || 'Not specified'}
Symptom Onset   : ${symptomOnsetDays != null ? `${symptomOnsetDays} days ago` : 'Not provided'}
Symptoms        : ${symptomStr}

━━ LOCATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pincode         : ${pincode}
District        : ${soilData?.district || 'Unknown'}, Maharashtra
Agro Zone       : ${soilData?.agroClimaticZone?.id || '?'} — ${soilData?.agroClimaticZone?.name || 'Unknown'}
Coordinates     : ${weather?.location?.lat || '?'}°N, ${weather?.location?.lon || '?'}°E

━━ CURRENT WEATHER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Temperature     : ${w.temp || '?'}°C (feels ${w.feelsLike || '?'}°C)
Humidity        : ${w.humidity || '?'}%
Dew Point       : ${w.dewPoint || '?'}°C
Wind            : ${w.windSpeed || '?'} km/h
Cloud Cover     : ${w.cloudCover || '?'}%
Condition       : ${w.weatherDesc || '?'}

━━ 3-DAY FORECAST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${forecast.length > 0
    ? forecast.map((d, i) => `Day ${i + 1} (${d.date}): ${d.tempMin}–${d.tempMax}°C | Humidity ${d.humidity}% | Rain ${d.rainfall}mm`).join('\n')
    : 'Not available'}
Weather Risk    : ${weather?.weatherRisk?.riskLevel || 'UNKNOWN'} — ${(weather?.weatherRisk?.riskFactors || []).slice(0, 3).join('; ')}

━━ SOIL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type / Texture  : ${soil.soilType || 'Unknown'} / ${soil.soilTexture || 'Unknown'}
pH              : ${soilPh ? `${soilPh} (farmer)` : `${soil.soilPH?.avg || '?'} (zone avg)`}
Organic Carbon  : ${organicCarbon ? `${organicCarbon}%` : `${soil.organicCarbon?.avg || '?'}% (zone avg)`}
N / P / K       : ${nitrogenLevel || soil.nitrogen?.status || '?'} / ${phosphorusLevel || soil.phosphorus?.status || '?'} / ${potassiumLevel || soil.potassium?.status || '?'}
Zinc Status     : ${soil.zinc?.status || 'Often deficient in this zone'}
Soil Moisture   : ${soilMoisture ? `${soilMoisture}%` : 'Not provided'}
Drainage        : ${soil.drainageStatus || 'Unknown'}

━━ FIELD MANAGEMENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Irrigation      : ${irrigationMethod || 'Not specified'}
Days since irrig: ${daysSinceIrrigation !== null ? daysSinceIrrigation : 'Not provided'}
Fertilizer used : ${fertilizerType || 'Not specified'}
Water quality   : ${waterQuality || 'Not specified'}
Days since fungicide: ${daysSinceFungicide !== null ? daysSinceFungicide : 'Not provided / never sprayed'}

━━ ZONE DISEASE PRESSURE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${(soilData?.historicalDiseasePressure?.[cropType?.toLowerCase()] || []).join(', ') || 'Use general Maharashtra zone data'}

━━ YOUR TASK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Follow these steps IN ORDER — write your reasoning in the _reasoning field:
  STEP 1 — Assess each image for quality (blur, light, organ, symptoms). Mark unusable images.
  STEP 2 — List all visible symptoms from usable images. Cross-check with farmer-reported symptoms.
  STEP 3 — Generate differential diagnoses: disease / pest / abiotic. Eliminate using weather + soil + DAS.
  STEP 4 — Assign confidence. If < 0.40, set needs_rescan=true.
  STEP 5 — Output ONLY the JSON schema from the system prompt. No extra text.`;
}

// ─── JSON extraction + validation ────────────────────────────────────────────
const STATUS_VALUES     = ['ok', 'needs_rescan', 'needs_more_context'];
const CATEGORY_VALUES   = ['disease', 'pest', 'abiotic', 'healthy', 'unknown'];
const RISK_LEVEL_VALUES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const SEVERITY_VALUES   = ['Low', 'Moderate', 'High', 'Critical', 'Unknown'];
const RISK_TREND_VALUES = ['DECREASING', 'STABLE', 'INCREASING'];

function normaliseConfidence(val) {
  if (typeof val !== 'number') return 0;
  // Model sometimes returns 0-100 integer — normalise to 0.0-1.0
  if (val > 1.0) return Math.min(1.0, val / 100);
  return Math.max(0, Math.min(1.0, val));
}

function validateAndRepair(result) {
  // ── status ──
  if (!STATUS_VALUES.includes(result.status)) result.status = 'ok';

  // ── needs_rescan ──
  if (typeof result.needs_rescan !== 'boolean') result.needs_rescan = result.status !== 'ok';

  // ── disease_category ──
  if (!CATEGORY_VALUES.includes(result.disease_category)) result.disease_category = 'unknown';

  // ── confidence ──
  result.confidence_score = normaliseConfidence(result.confidence_score ?? result.confidenceScore);
  delete result.confidenceScore; // remove old key if present

  // Confidence < 0.30 → force needs_rescan
  if (result.confidence_score < 0.30) {
    result.needs_rescan = true;
    if (result.status === 'ok') result.status = 'needs_rescan';
  }

  // ── risk ──
  result.overall_risk = typeof result.overall_risk === 'number'
    ? Math.max(0, Math.min(100, result.overall_risk))
    : (typeof result.overallRisk === 'number' ? result.overallRisk : 0);
  delete result.overallRisk;

  if (!RISK_LEVEL_VALUES.includes(result.risk_level)) {
    result.risk_level = result.riskLevel || 'UNKNOWN';
  }
  delete result.riskLevel;

  // ── image_quality ──
  if (!result.image_quality || typeof result.image_quality !== 'object') {
    result.image_quality = { usable: true, per_image: [], issues: [] };
  }
  if (!Array.isArray(result.image_quality.per_image)) result.image_quality.per_image = [];
  if (!Array.isArray(result.image_quality.issues)) result.image_quality.issues = [];

  // ── missing_inputs ──
  if (!Array.isArray(result.missing_inputs)) result.missing_inputs = [];

  // ── primary_disease ──
  if (!result.primary_disease) {
    result.primary_disease = { name: 'Could not determine', scientific_name: '', probability: 0, severity: 'Unknown', description: '', cause: '' };
  } else {
    if (!SEVERITY_VALUES.includes(result.primary_disease.severity)) result.primary_disease.severity = 'Unknown';
    result.primary_disease.probability = normaliseConfidence(result.primary_disease.probability ?? 0) * 100;
    if (!result.primary_disease.scientific_name) result.primary_disease.scientific_name = '';
  }
  delete result.primaryDisease;

  // ── differential_diagnoses ──
  if (!Array.isArray(result.differential_diagnoses)) result.differential_diagnoses = [];

  // ── diseases (legacy summary array) ──
  if (!Array.isArray(result.diseases)) result.diseases = [];

  // ── pesticides ──
  if (!Array.isArray(result.pesticides)) result.pesticides = [];
  result.pesticides = result.pesticides.filter(Boolean).map((p) => ({
    name: p.name || '',
    active_ingredient: p.active_ingredient || p.activeIngredient || '',
    dose: p.dose || '',
    dose_per_acre: p.dose_per_acre || p.dosePerAcre || '',
    timing: p.timing || '',
    reg_no: p.reg_no || p.regNo || null,  // null is fine, never fabricate
    type: p.type || 'Fungicide',
    phi_days: p.phi_days ?? p.phi ?? null,
    resistance_group: p.resistance_group || p.resistanceGroup || '',
  }));

  // ── fertilizers ──
  if (!Array.isArray(result.fertilizers)) result.fertilizers = [];

  // ── action arrays ──
  if (!Array.isArray(result.cultural_controls)) result.cultural_controls = result.culturalControls || [];
  if (!Array.isArray(result.immediate_actions)) result.immediate_actions = result.immediateActions || [];
  if (!Array.isArray(result.preventive_measures)) result.preventive_measures = result.preventiveMeasures || [];
  delete result.culturalControls;
  delete result.immediateActions;
  delete result.preventiveMeasures;

  // ── weather_risk ──
  if (!result.weather_risk || typeof result.weather_risk !== 'object') {
    result.weather_risk = { next_3_days: 'Unknown', risk_trend: 'STABLE' };
  }
  if (!RISK_TREND_VALUES.includes(result.weather_risk.risk_trend)) result.weather_risk.risk_trend = 'STABLE';

  // ── nutritional_deficiencies ──
  if (!Array.isArray(result.nutritional_deficiencies)) result.nutritional_deficiencies = result.nutritionalDeficiencies || [];
  delete result.nutritionalDeficiencies;

  // ── location_info ──
  if (!result.location_info || typeof result.location_info !== 'object') {
    result.location_info = result.locationInfo || {};
  }
  delete result.locationInfo;

  // ── farmer_friendly_summary ──
  if (!result.farmer_friendly_summary) {
    result.farmer_friendly_summary = result.primary_disease?.name
      ? `Likely diagnosis: ${result.primary_disease.name} (${Math.round(result.confidence_score * 100)}% confidence). Check immediate_actions for what to do now.`
      : 'Image analysis incomplete. Please retake photos in good daylight — one of the whole plant and one close-up of the affected area.';
  }

  // ── analysis_notes ──
  if (!result.analysis_notes) result.analysis_notes = '';

  return result;
}

// ─── Rescan fallback ──────────────────────────────────────────────────────────
function buildRescanFallback(reason, requestId) {
  return {
    _reasoning: `Fallback triggered: ${reason}`,
    status: 'needs_rescan',
    needs_rescan: true,
    disease_category: 'unknown',
    overall_risk: 0,
    risk_level: 'UNKNOWN',
    confidence_score: 0,
    image_quality: {
      usable: false,
      per_image: [],
      issues: [reason],
    },
    missing_inputs: ['close_up_image', 'whole_plant_image'],
    primary_disease: { name: 'Could not determine', scientific_name: '', probability: 0, severity: 'Unknown', description: '', cause: '' },
    differential_diagnoses: [],
    diseases: [],
    pesticides: [],
    fertilizers: [],
    cultural_controls: [],
    immediate_actions: [
      'Retake images: (1) whole plant from 1 m away, (2) close-up of affected leaf/stem from 20 cm, (3) underside of an affected leaf.',
      'Ensure good daylight. Avoid shadows. Keep camera steady.',
    ],
    preventive_measures: [],
    weather_risk: { next_3_days: 'Unknown', risk_trend: 'STABLE' },
    nutritional_deficiencies: [],
    location_info: {},
    farmer_friendly_summary: 'The images could not be analysed. Please retake photos in good natural light — one of the full plant and one close-up of the affected area.',
    analysis_notes: reason,
    meta: { requestId, promptVersion: PROMPT_VERSION, fallback: true },
  };
}

// ─── Core LLM call with retry + Groq fallback on 429 ─────────────────────────
async function callGemini(messages, attempt = 1, provider = 'gemini') {
  const client = getClient(provider);
  const model  = getModel(provider);

  try {
    const createParams = {
      model,
      messages,
      max_tokens: 8192,
      temperature: 0.0,
    };
    // json_object mode — Gemini supports it, Groq Llama4 may not
    if (provider === 'gemini') {
      createParams.response_format = { type: 'json_object' };
    }
    logger.info('[AI] Calling %s model=%s attempt=%d', provider, model, attempt);
    const response = await client.chat.completions.create(createParams, {
      signal: AbortSignal.timeout(120_000),
    });

    const raw = response.choices[0]?.message?.content || '';
    if (!raw.trim()) throw new Error('EMPTY_RESPONSE');

    if (response.choices[0]?.finish_reason === 'content_filter') {
      throw new Error('SAFETY_BLOCKED');
    }

    let result;
    try {
      result = JSON.parse(extractJSONString(raw));
    } catch {
      throw new Error('PARSE_FAILURE');
    }

    return { result, tokensUsed: response.usage?.total_tokens || 0 };
  } catch (err) {
    const retriable = ['PARSE_FAILURE', 'EMPTY_RESPONSE'].includes(err.message)
      || [408, 503, 529].includes(err.status);

    // On 429 (rate limit) — try Groq fallback immediately instead of waiting
    if (err.status === 429 && provider === 'gemini' && ENV.GROQ_API_KEY) {
      logger.warn('[AI] Gemini 429 rate limited — switching to Groq fallback');
      // Strip image parts for Groq text-only fallback (Groq vision model handles base64 too)
      return callGemini(messages, 1, 'groq');
    }

    if (retriable && attempt < 3) {
      const backoff = 1000 * attempt;
      logger.warn('[AI] Attempt %d failed (%s), retrying in %ds', attempt, err.message || err.status, backoff/1000);
      await new Promise((r) => setTimeout(r, backoff));

      // On PARSE_FAILURE retry, add a JSON-format hint to improve success rate
      if (err.message === 'PARSE_FAILURE') {
        const retryMessages = [
          ...messages,
          { role: 'user', content: 'Your previous response was not valid JSON. Return ONLY a raw JSON object with no markdown fences, no explanation — just the JSON.' },
        ];
        return callGemini(retryMessages, attempt + 1, provider);
      }
      return callGemini(messages, attempt + 1, provider);
    }
    throw err;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
/**
 * @param {object} params — crop/field/weather metadata
 * @param {{ path: string, type: string }[]} images — array of { path, type }
 *   type must be one of: field_view | whole_plant | close_up | underside | other
 */
export async function predictCropDisease(params, images = []) {
  const requestId  = crypto.randomUUID();
  const capturedAt = new Date().toISOString();

  // Guard: fail early if no client
  getClient();

  const imageLabels = images.map((img) => img.type || 'other');

  // ── Build messages ──
  const messages = [
    { role: 'system', content: buildSystemPrompt(params.language) },
  ];

  const userContent = [];
  userContent.push({ type: 'text', text: buildUserPrompt(params, imageLabels) });

  // Attach images with view-type labels
  let attachedCount = 0;
  for (const img of images.slice(0, 4)) {
    try {
      const base64   = imageToBase64(img.path);
      const mimeType = getImageMimeType(img.path);
      userContent.push({
        type: 'text',
        text: `[Image ${attachedCount + 1} — view: ${img.type || 'other'}] — Assess quality before using for diagnosis.`,
      });
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' },
      });
      attachedCount++;
    } catch {
      logger.warn('[AI] Could not read image: %s', img.path);
    }
  }

  // All requested images failed to load
  if (attachedCount === 0 && images.length > 0) {
    return buildRescanFallback('All uploaded images could not be read. Please re-upload.', requestId);
  }

  if (attachedCount > 0) {
    userContent.push({
      type: 'text',
      text: 'For EACH image above: (1) rate its quality, (2) list visible symptoms, (3) note any quality issues. Write this in _reasoning. Then produce your final JSON diagnosis.',
    });
  }

  messages.push({ role: 'user', content: userContent });

  // ── Call Gemini ──
  let result, tokensUsed = 0;
  try {
    const callResult = await callGemini(messages);
    result    = callResult.result;
    tokensUsed = callResult.tokensUsed;
  } catch (err) {
    logger.error('[AI] Gemini call failed: %s status=%s', err.message, err.status);

    if (err.message === 'SAFETY_BLOCKED') {
      return buildRescanFallback('Request was blocked by safety filters. Please retake images clearly showing only the affected plant area.', requestId);
    }
    if (err.status === 429) {
      // callGemini already retried 2x with backoff — if still 429, report gracefully
      return buildRescanFallback('AI service is temporarily busy. Please wait 2 minutes and try again.', requestId);
    }
    if (err.message?.includes('No AI key')) throw err;

    return buildRescanFallback('AI service temporarily unavailable. Please try again.', requestId);
  }

  // ── Validate + repair schema ──
  result = validateAndRepair(result);

  // ── Attach meta ──
  result.meta = {
    requestId,
    promptVersion: PROMPT_VERSION,
    model: getModel(),
    images_analysed: attachedCount,
    image_types: imageLabels.slice(0, attachedCount),
    tokens_used: tokensUsed,
    captured_at: capturedAt,
    generated_at: new Date().toISOString(),
  };

  return result;
}
