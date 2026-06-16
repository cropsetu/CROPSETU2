/**
 * Runtime settings service — typed key/value config editable from the admin panel
 * WITHOUT a redeploy and WITHOUT ever touching a .env file on disk.
 *
 * Three guarantees:
 *  1. Only keys in SETTINGS_MANIFEST are editable. Unknown keys are rejected, so
 *     the admin surface can't be used to write arbitrary config.
 *  2. SECRETS ARE NEVER STORED HERE. API keys, DB URLs, JWT / encryption keys stay
 *     in process.env. The env-status manifest (ENV_MANIFEST) reports only whether
 *     each expected secret is PRESENT — never its value.
 *  3. getSetting() falls back to the env var (envKey) then the manifest default,
 *     so a fresh DB with no app_settings rows behaves exactly like today.
 *
 * Values are cached in-process for SETTINGS_CACHE_TTL_MS; setSetting() invalidates.
 */
import prisma from '../config/db.js';

export const SETTINGS_CACHE_TTL_MS = 60_000;

// Model options shared by the LLM-backed services (per-service routing). Labels are
// provider-prefixed so the admin dropdown reads naturally. The FastAPI pipeline
// honours the selection per-request (multi-provider dispatch — WI-11); a missing
// provider API key surfaces a clear "key not configured" error rather than a silent
// failure. Text features (chat, treatment) may use any model below; VISION features
// (diagnose, soil OCR) must use a vision-capable model — see VISION_MODEL_OPTIONS.
const LLM_MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · fast + cheap (Google)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro · higher accuracy (Google)' },
  { value: 'gpt-4o', label: 'GPT-4o · vision (OpenAI)' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini · fast, vision (OpenAI)' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 · vision (Anthropic)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 · vision (Anthropic)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B · text-only (Groq)' },
];

// Vision-capable subset — for features that send an image (disease diagnosis, soil
// OCR). Groq's Llama has NO vision, so it is excluded here; offering it for a vision
// feature would hard-fail the call (the FastAPI dispatch rejects a non-vision model
// for vision). Keeping it out of the dropdown is the guard.
const VISION_MODEL_OPTIONS = LLM_MODEL_OPTIONS.filter(
  (m) => m.value !== 'llama-3.3-70b-versatile',
);

// value convention: '<provider>:<modelId>' (split on the FIRST colon). The route
// forwards the modelId to the Sarvam STT call; non-sarvam providers (e.g. Whisper)
// are not yet implemented and safely fall back to the Sarvam default with a warning.
const VOICE_STT_OPTIONS = [
  { value: 'sarvam:saaras:v3', label: 'Sarvam Saaras v3 (Indic STT)' },
  { value: 'openai:whisper-1', label: 'OpenAI Whisper (falls back to Sarvam until enabled)' },
];

// type: 'STRING' | 'NUMBER' | 'BOOL' | 'JSON' | 'ENUM'
// Optional `envKey`: env var used as the fallback when no DB row exists (keeps a
// fresh DB behaving exactly like the current env-driven config).
// Optional `options` (ENUM): array of { value, label }.
export const SETTINGS_MANIFEST = [
  // ── AI budget & token limits ────────────────────────────────────────────────
  { key: 'ai.monthlyBudgetUsdCap', type: 'NUMBER', category: 'AI Budget & Limits', label: 'Monthly AI budget cap (USD)', description: 'Company-wide AI spend ceiling for the calendar month. 0 = no cap (dashboard tracks usage either way).', default: 0 },
  { key: 'ai.tokensPerCredit', type: 'NUMBER', category: 'AI Budget & Limits', label: 'Tokens per credit', description: 'How many model tokens one AI credit buys.', envKey: 'AI_TOKENS_PER_CREDIT', default: 1000 },
  { key: 'ai.freeMonthlyCredits', type: 'NUMBER', category: 'AI Budget & Limits', label: 'Free monthly credits', description: 'Auto-refill grant for free-tier users on the 1st of each month.', envKey: 'AI_FREE_MONTHLY_CREDITS', default: 100 },
  { key: 'ai.freeScanDailyLimit', type: 'NUMBER', category: 'AI Budget & Limits', label: 'Free disease scans / day', description: 'Daily disease-scan cap for free-tier users.', default: 500 },
  { key: 'ai.freeChatDailyLimit', type: 'NUMBER', category: 'AI Budget & Limits', label: 'Free AI chats / day', description: 'Daily AI-chat cap for free-tier users.', default: 200 },
  { key: 'ai.freeTokenDailyLimit', type: 'NUMBER', category: 'AI Budget & Limits', label: 'Free tokens / day', description: 'Daily token cap for free-tier users.', default: 1_000_000 },

  // ── AI model routing (per service) ──────────────────────────────────────────
  // The FastAPI pipeline honours these per-request (multi-provider dispatch). Vision
  // features (diagnose, soil OCR) are limited to vision-capable models; a missing
  // provider key surfaces a clear error. Diagnose/treatment have NO model fallback —
  // a model that errors fails that scan loudly (by design), so pick a keyed provider.
  { key: 'ai.model.chat', type: 'ENUM', category: 'AI Models', label: 'Text chat model', description: 'LLM for the farmer text assistant (chat). Any provider works; if the primary is unavailable it falls back Gemini→Groq so the farmer still gets a reply. Switching e.g. Gemini Flash↔Pro is verified working.', envKey: 'AI_TEXT_CHAT_MODEL', default: 'gemini-2.5-flash', options: LLM_MODEL_OPTIONS },
  { key: 'ai.model.diagnose', type: 'ENUM', category: 'AI Models', label: 'Disease diagnosis model', description: 'Vision LLM that identifies the disease from the leaf photo — the always-on first pass of every scan. Vision-capable models only (Groq is text-only, excluded). No fallback: an unkeyed or failing model fails the scan, so pick a provider whose key is set.', envKey: 'AI_CROP_DIAGNOSE_MODEL', default: 'gemini-2.5-flash', options: VISION_MODEL_OPTIONS },
  { key: 'ai.model.treatment', type: 'ENUM', category: 'AI Models', label: 'Treatment plan model', description: 'Text LLM that writes the RAG-grounded spray/IPM treatment plan after diagnosis. Skipped automatically for uncertain or out-of-scope diagnoses. Pro is the default for accuracy.', envKey: 'AI_CROP_TREATMENT_MODEL', default: 'gemini-2.5-pro', options: LLM_MODEL_OPTIONS },
  { key: 'ai.model.soilOcr', type: 'ENUM', category: 'AI Models', label: 'Soil-card OCR model', description: 'Vision LLM that reads the 12 parameters off a soil health card photo. Vision-capable models only (Groq is text-only, excluded).', envKey: 'AI_SOIL_OCR_MODEL', default: 'gemini-2.5-flash', options: VISION_MODEL_OPTIONS },
  { key: 'ai.model.voiceStt', type: 'ENUM', category: 'AI Models', label: 'Voice / audio STT model', description: 'Speech-to-text for the voice assistant. Sarvam Saaras is Indic-tuned (recommended for Marathi/Hindi/regional); Whisper falls back to Sarvam until enabled.', envKey: 'AI_VOICE_STT_MODEL', default: 'sarvam:saaras:v3', options: VOICE_STT_OPTIONS },

  // ── AI diagnosis behaviour ──────────────────────────────────────────────────
  // Admin-controlled, default ON. Forwarded per-scan to FastAPI (params.ensemble),
  // which overrides its own ENABLE_ENSEMBLE env. Toggle OFF to minimise cost.
  { key: 'ai.diagnose.ensemble', type: 'BOOL', category: 'AI Models', label: 'Second-opinion ensemble (diagnosis)', description: 'When the first diagnosis is unsure (confidence < 0.80) or ambiguous, re-check the photo with extra models in parallel (Gemini Pro + Flash, plus the GPT-4o voter when the OpenAI key is set) and vote for the most reliable answer. Improves accuracy on hard scans; it only fires on those — easy, confident scans skip it. Costs roughly 2–4× on a scan when it triggers, and near-budget users are skipped automatically. Turn off to minimise cost.', default: true },

  // ── Marketplace ─────────────────────────────────────────────────────────────
  { key: 'marketplace.commissionRatePct', type: 'NUMBER', category: 'Marketplace', label: 'Seller commission (%)', description: 'Platform commission deducted from seller sales when computing settlement balances.', default: 5 },
  { key: 'catalog.lowStockThreshold', type: 'NUMBER', category: 'Marketplace', label: 'Low-stock threshold', description: 'Products at or below this stock count appear in low-stock alerts.', default: 10 },

  // ── Broadcast ───────────────────────────────────────────────────────────────
  { key: 'broadcast.maxRecipients', type: 'NUMBER', category: 'Broadcast', label: 'Max recipients / broadcast', description: 'Per-broadcast fan-out cap. Can be lowered from the 5000 safety ceiling, never raised above it.', default: 5000 },

  // ── App ─────────────────────────────────────────────────────────────────────
  { key: 'app.maintenanceMode', type: 'BOOL', category: 'General', label: 'Maintenance mode', description: 'Surface a maintenance banner / pause non-essential traffic.', default: false },
  { key: 'app.maintenanceMessage', type: 'STRING', category: 'General', label: 'Maintenance message', description: 'Message shown to users while maintenance mode is on.', default: '' },
];

const MANIFEST_BY_KEY = new Map(SETTINGS_MANIFEST.map((s) => [s.key, s]));

// Expected environment variables — for the read-only env-status panel. The panel
// reports PRESENT / ABSENT only; values (especially secrets) NEVER leave the server.
export const ENV_MANIFEST = [
  { key: 'DATABASE_URL', category: 'Core', secret: true },
  { key: 'REDIS_URL', category: 'Core', secret: true },
  { key: 'JWT_SECRET', category: 'Core', secret: true },
  { key: 'FIELD_ENCRYPTION_KEY', category: 'Core', secret: true },
  { key: 'NODE_ENV', category: 'Core', secret: false },
  { key: 'ALLOWED_ORIGINS', category: 'Core', secret: false },
  { key: 'GEMINI_API_KEY', category: 'AI / LLM', secret: true },
  { key: 'GEMINI_MODEL', category: 'AI / LLM', secret: false },
  { key: 'OPENAI_API_KEY', category: 'AI / LLM', secret: true },
  { key: 'SARVAM_API_KEY', category: 'AI / LLM', secret: true },
  { key: 'AI_SHARED_SECRET', category: 'AI / LLM', secret: true },
  { key: 'AI_BACKEND_URL', category: 'AI / LLM', secret: false },
  { key: 'USE_FASTAPI_FOR_SCAN', category: 'AI / LLM', secret: false },
  { key: 'MSG91_AUTH_KEY', category: 'SMS / OTP', secret: true },
  { key: 'MSG91_TEMPLATE_ID', category: 'SMS / OTP', secret: false },
  { key: 'MSG91_SENDER_ID', category: 'SMS / OTP', secret: false },
  { key: 'CLOUDINARY_CLOUD_NAME', category: 'Media', secret: false },
  { key: 'CLOUDINARY_API_KEY', category: 'Media', secret: true },
  { key: 'CLOUDINARY_API_SECRET', category: 'Media', secret: true },
  { key: 'DATA_GOV_API_KEY', category: 'Market Data', secret: true },
  { key: 'OPENWEATHER_API_KEY', category: 'Market Data', secret: true },
  { key: 'RAZORPAY_KEY_ID', category: 'Payments', secret: true },
  { key: 'RAZORPAY_KEY_SECRET', category: 'Payments', secret: true },
];

// ── coercion / validation ──────────────────────────────────────────────────────
export class SettingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingError';
    this.expose = true;
    this.statusCode = 400;
  }
}

function enumValues(def) {
  return (def.options || []).map((o) => (typeof o === 'string' ? o : o.value));
}

function coerce(def, value) {
  switch (def.type) {
    case 'NUMBER': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new SettingError(`${def.key} must be a number`);
      return n;
    }
    case 'BOOL': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new SettingError(`${def.key} must be a boolean`);
    }
    case 'ENUM': {
      const v = String(value);
      const allowed = enumValues(def);
      if (allowed.length && !allowed.includes(v)) {
        throw new SettingError(`${def.key} must be one of: ${allowed.join(', ')}`);
      }
      return v;
    }
    case 'JSON':
      return value;
    case 'STRING':
    default:
      return value == null ? '' : String(value);
  }
}

function envFallback(def) {
  if (!def.envKey) return undefined;
  const raw = process.env[def.envKey];
  if (raw == null || raw === '') return undefined;
  try {
    return coerce(def, raw);
  } catch {
    return undefined;
  }
}

function defaultValue(def) {
  const env = envFallback(def);
  return env !== undefined ? env : def.default;
}

// ── cache ───────────────────────────────────────────────────────────────────────
const cache = new Map(); // key -> { value, at }

export function invalidateSetting(key) {
  if (key) cache.delete(key);
  else cache.clear();
}

/** Effective value for a key (DB row → env fallback → manifest default). Cached. */
export async function getSetting(key) {
  const def = MANIFEST_BY_KEY.get(key);
  if (!def) throw new SettingError(`Unknown setting: ${key}`);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < SETTINGS_CACHE_TTL_MS) return hit.value;
  let value = defaultValue(def);
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (row && row.value != null) value = coerce(def, row.value);
  } catch {
    // app_settings table may not exist yet → fall through to the default.
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** All settings grouped by category with effective values. Secrets are masked. */
export async function listSettings() {
  let rows = [];
  try {
    rows = await prisma.appSetting.findMany();
  } catch {
    rows = [];
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const groups = {};
  for (const def of SETTINGS_MANIFEST) {
    const row = byKey.get(def.key);
    let value = defaultValue(def);
    if (row && row.value != null) {
      try {
        value = coerce(def, row.value);
      } catch {
        /* keep default if a stored value no longer validates */
      }
    }
    (groups[def.category] ||= []).push({
      key: def.key,
      type: def.type,
      label: def.label,
      description: def.description,
      value: def.isSecret ? '••••' : value,
      isDefault: !row,
      options: def.options ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    });
  }
  return Object.entries(groups).map(([category, items]) => ({ category, items }));
}

/** Set a setting (validated; the caller writes the audit row). Returns new value. */
export async function setSetting(key, value, updatedBy = null) {
  const def = MANIFEST_BY_KEY.get(key);
  if (!def) throw new SettingError(`Unknown setting: ${key}`);
  if (def.isSecret) throw new SettingError(`${key} is a secret and cannot be set from the admin panel`);
  const coerced = coerce(def, value);
  await prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      value: coerced,
      type: def.type,
      category: def.category,
      label: def.label ?? null,
      description: def.description ?? null,
      isSecret: false,
      updatedBy,
    },
    update: { value: coerced, updatedBy },
  });
  invalidateSetting(key);
  return { key, value: coerced };
}

/** Read-only env status: which expected env vars are present (never the value). */
export function getEnvStatus() {
  const groups = {};
  for (const def of ENV_MANIFEST) {
    const raw = process.env[def.key];
    (groups[def.category] ||= []).push({
      key: def.key,
      secret: def.secret,
      present: typeof raw === 'string' && raw.length > 0,
    });
  }
  return Object.entries(groups).map(([category, items]) => ({ category, items }));
}

/** Company-wide AI token/cost rollup vs the configured monthly budget cap. */
export async function getBudgetSummary() {
  const cap = await getSetting('ai.monthlyBudgetUsdCap');
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // AIUsage is a per-user-per-UTC-day rollup; sum across all users for the window.
  const [monthAgg, todayAgg, lifetimeAgg] = await Promise.all([
    prisma.aIUsage.aggregate({ _sum: { totalTokens: true, totalCostUsd: true }, where: { date: { gte: monthStart } } }),
    prisma.aIUsage.aggregate({ _sum: { totalTokens: true, totalCostUsd: true }, where: { date: { gte: dayStart } } }),
    prisma.aIUsage.aggregate({ _sum: { totalTokens: true, totalCostUsd: true } }),
  ]);

  const num = (v) => Number(v || 0);
  const monthCostUsd = num(monthAgg._sum.totalCostUsd);
  const capNum = Number(cap) || 0;
  return {
    monthlyBudgetUsdCap: capNum,
    month: { tokens: num(monthAgg._sum.totalTokens), costUsd: monthCostUsd },
    today: { tokens: num(todayAgg._sum.totalTokens), costUsd: num(todayAgg._sum.totalCostUsd) },
    lifetime: { tokens: num(lifetimeAgg._sum.totalTokens), costUsd: num(lifetimeAgg._sum.totalCostUsd) },
    usagePct: capNum > 0 ? Math.round((monthCostUsd / capNum) * 100) : null,
    overCap: capNum > 0 && monthCostUsd > capNum,
  };
}
