/**
 * Planner AI Service (Gemini)
 *
 * The only live LLM use in this file is generatePlannerTasks() — the daily planner
 * (POST /planner/generate). The legacy FarmMind chat + crop-scan code that used to
 * live here (chatWithFarmMind, scanCropImage, runGeminiVision, analyzeBySymptoms,
 * and their prompt/stage/Marathi helpers) was DEAD — chat, voice and crop-disease
 * all run through the FastAPI AI service now — and has been removed.
 *
 * getCurrentSeason() is a pure date helper reused by a couple of routes.
 */
import OpenAI from 'openai';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';

// ── Gemini client (OpenAI-compatible endpoint) ─────────────────────────────────
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

// ── Season helper (pure — also imported by planner + ai routes) ────────────────
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

// ── Daily planner prompt ───────────────────────────────────────────────────────
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

// ── Helper: single Gemini text call ──────────────────────────────────────────
// Returns the text AND the usage block: callers debit the credit ledger against
// real token counts, and settling with 0 would silently charge only the per-feature
// floor no matter how large the response.
async function callGeminiChat(params) {
  if (!ENV.GEMINI_API_KEY) throw new Error('No AI provider configured — set GEMINI_API_KEY in .env');
  const res = await gemini().chat.completions.create({ ...params, model: GEMINI_MODEL });
  return {
    text: res.choices[0]?.message?.content || '',
    tokensUsed: res.usage?.total_tokens || 0,
    model: GEMINI_MODEL,
  };
}

// ── Planner task generation ────────────────────────────────────────────────────
export async function generatePlannerTasks(farmContext) {
  const messages = [{ role: 'user', content: PLANNER_PROMPT(farmContext) }];

  const { text: rawText, tokensUsed, model } = await callGeminiChat({
    messages, temperature: 0.6, max_tokens: 900,
    response_format: { type: 'json_object' },
  });

  // Returns { tasks, tokensUsed, model } — the caller debits the credit ledger
  // against tokensUsed. A parse failure still reports usage: the tokens were spent
  // whether or not the JSON came back well-formed.
  try {
    const parsed = JSON.parse(rawText);
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], tokensUsed, model };
  } catch (err) {
    logger.warn('[PlannerTasks] Failed to parse AI response as JSON: %s — raw: %s', err.message, rawText?.slice(0, 120));
    return { tasks: [], tokensUsed, model };
  }
}
