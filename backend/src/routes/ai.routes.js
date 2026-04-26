/**
 * FarmMind AI Routes — Express (auth + DB layer)
 *
 * Architecture: Express handles auth, DB, file uploads.
 *               All LLM inference is proxied to FastAPI (port 8001).
 *
 * POST /api/v1/ai/chat           — FarmMind chat  → FastAPI /ai/chat
 * POST /api/v1/ai/voice          — Sarvam STT → FastAPI /ai/chat → (opt) Sarvam TTS
 * POST /api/v1/ai/tts            — Text-to-speech via Sarvam
 * POST /api/v1/ai/translate      — Translate via Sarvam
 * GET  /api/v1/ai/conversations  — User's chat history list
 * GET  /api/v1/ai/conversations/:id — Full conversation messages
 * POST /api/v1/ai/scan           — Crop image → Gemini disease diagnosis (Node.js direct, no FastAPI)
 * POST /api/v1/ai/scan/:id/chat  — Follow-up Q&A on scan session
 * GET  /api/v1/ai/scan/sessions  — List scan sessions
 * GET  /api/v1/ai/scan/sessions/:id — Full scan session
 * POST /api/v1/ai/alerts         — Smart alerts → FastAPI /ai/alerts
 * GET  /api/v1/ai/scan/history   — Scan report history
 * POST /api/v1/ai/scan/feedback  — Farmer feedback on diagnosis
 */
import { Router }  from 'express';
import multer      from 'multer';
import fs          from 'fs';
import os          from 'os';
import OpenAI      from 'openai';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { ENV } from '../config/env.js';
import {
  sarvamSTT,
  sarvamTTS,
  sarvamTranslate,
  normaliseLangCode,
} from '../services/sarvam.service.js';
import { getCurrentSeason } from '../services/ai.chat.service.js';
import { predictCropDisease } from '../services/ai.predict.service.js';
import { checkCredits, deductCredits, getCreditSummary } from '../services/aiCredit.service.js';
import { buildFarmerChatContext } from '../services/chatContext.service.js';
import { getWeatherData } from '../services/weather.service.js';
import { aiChatLimit, aiScanLimit, aiVoiceLimit } from '../middleware/redisRateLimit.js';
import prisma from '../config/db.js';
import logger from '../utils/logger.js';

// ── FastAPI proxy helper ──────────────────────────────────────────────────────
const AI_BACKEND = ENV.AI_BACKEND_URL || 'http://localhost:8001';

/**
 * POST JSON to FastAPI and return parsed data field.
 * Express passes x-user-id header so FastAPI can log/audit if needed.
 */
async function callFastAPI(path, body, userId, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${AI_BACKEND}${path}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'x-user-id': userId } : {}),
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: `FastAPI ${resp.status}` }));
      const e   = new Error(err.detail || `AI backend returned ${resp.status}`);
      e.status  = resp.status;
      throw e;
    }
    const data = await resp.json();
    return data.data;           // FastAPI wraps in { success, data, message }
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Flatten a predictCropDisease() result (Node.js format) into the flat shape
 * that DiagnosisResultScreen expects.  Used when /ai/scan runs Gemini directly
 * instead of proxying to FastAPI.
 */
function flattenNodePrediction(result, farmCtx = {}) {
  if (!result || typeof result !== 'object') return result;

  const dis      = result.primary_disease || {};
  const sevRaw   = (dis.severity || result.risk_level || 'moderate').toLowerCase();
  const urgency  = sevRaw === 'critical' ? 'immediate'
                 : sevRaw === 'high'     ? 'today'
                 : 'thisweek';

  // Format chemical treatment lines from pesticides array
  const treatment = (result.pesticides || []).map(p => {
    const base = `${p.name} — ${p.dose || p.dose_per_acre || ''}`;
    return p.timing ? `${base} (${p.timing})` : base;
  });

  // Use cultural_controls as organic treatment hint
  const organicArr = result.cultural_controls || [];
  const organicTreatment = organicArr.length ? organicArr.join('\n') : null;

  // Causes: primary disease cause + up to 2 differential reasons
  const causes = [];
  if (dis.cause) causes.push(dis.cause);
  (result.differential_diagnoses || []).slice(0, 2).forEach(d => {
    if (d.reason) causes.push(`Not ${d.name}: ${d.reason}`);
  });

  // Next steps: immediate actions + cultural controls (capped at 4 total)
  const nextSteps = [
    ...(result.immediate_actions || []).slice(0, 2),
    ...(result.cultural_controls || []).slice(0, 2),
  ];

  return {
    disease:              dis.name              || 'Unknown',
    scientific:           dis.scientific_name   || '',
    confidence:           Math.round((result.confidence_score || 0) * 100),
    severity:             sevRaw,
    isHealthy:            result.disease_category === 'healthy',
    crop:                 farmCtx.cropName      || '',
    stage:                farmCtx.growthStage   || (farmCtx.cropAge != null ? String(farmCtx.cropAge) : ''),
    affectedAreaEstimate: farmCtx.affectedArea  || '',
    spreadRisk:           (result.risk_level    || '').toLowerCase(),
    urgencyLevel:         urgency,
    estimatedYieldLoss:   '',
    immediateAction:      (result.immediate_actions || [])[0] || '',
    treatment,
    organicTreatment,
    prevention:           (result.preventive_measures || []).join('. '),
    nextSteps,
    notes:                result.farmer_friendly_summary || dis.description || '',
    causes,
    weatherRiskNote:      result.weather_risk?.next_3_days || '',
    soilConsideration:    '',
    previousCropNote:     '',
    consultExpert:        result.risk_level === 'CRITICAL',
    followUpSchedule:     [],
    _fullReport:          result,
  };
}

// ── Groq client for Whisper STT fallback ─────────────────────────────────────
let _groqSTT = null;
function getGroqSTT() {
  if (!_groqSTT) {
    if (!ENV.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set — required for voice transcription');
    _groqSTT = new OpenAI({ apiKey: ENV.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return _groqSTT;
}

const router = Router();

// ── Per-user caches ───────────────────────────────────────────────────────────
const alertCache   = new Map();
const ALERT_TTL_MS = 30 * 60 * 1000;
function alertCacheGet(uid) {
  const e = alertCache.get(uid);
  if (!e || Date.now() > e.expiresAt) { alertCache.delete(uid); return null; }
  return e.data;
}
function alertCacheSet(uid, data) {
  alertCache.set(uid, { data, expiresAt: Date.now() + ALERT_TTL_MS });
}

// ── Per-user AI cooldown (6 s gap) ───────────────────────────────────────────
const lastAiCall  = new Map();
const AI_MIN_GAP  = 6000;
function checkCooldown(uid) {
  const diff = Date.now() - (lastAiCall.get(uid) || 0);
  if (diff < AI_MIN_GAP) return Math.ceil((AI_MIN_GAP - diff) / 1000);
  lastAiCall.set(uid, Date.now());
  return 0;
}

// ── In-flight scan deduplication (prevents double-tap duplicate Gemini calls) ─
const inflightScans = new Map();  // userId → Promise<result>

// ── Periodic cleanup of in-memory Maps (prevents unbounded growth) ───────────
const MAP_CLEANUP_INTERVAL = 10 * 60 * 1000; // every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [uid, e] of alertCache) {
    if (now > e.expiresAt) alertCache.delete(uid);
  }
  // Cooldown entries older than 2x gap are stale
  for (const [uid, ts] of lastAiCall) {
    if (now - ts > AI_MIN_GAP * 2) lastAiCall.delete(uid);
  }
}, MAP_CLEANUP_INTERVAL).unref();

// ── Shared farm context enrichment (used by /chat, /voice, /scan/:id/chat) ───
async function buildEnrichedProfile(userId, frontendOverrides = {}) {
  const farmCtx = await buildFarmerChatContext(userId);
  if (!farmCtx) return { profile: {}, farmCtx: null };

  let enrichedProfile = {};
  if (farmCtx.farm) {
    enrichedProfile = {
      farmerName: farmCtx.farmer.name,
      experience: farmCtx.farmer.experience,
      language: farmCtx.farmer.language || 'en',
      state: farmCtx.farm.state || farmCtx.farmer.state,
      district: farmCtx.farm.district || farmCtx.farmer.district,
      village: farmCtx.farm.village,
      taluka: farmCtx.farm.taluka,
      farmName: farmCtx.farm.name,
      landSize: farmCtx.farm.landSizeAcres,
      soilType: farmCtx.farm.soilType,
      irrigationType: farmCtx.farm.irrigationSystem,
      waterSources: farmCtx.farm.waterSources,
      crops: (farmCtx.activeCycles || []).map(c => ({
        name: c.cropName, variety: c.variety, areaAcres: c.areaAcres, growthStage: c.growthStage,
      })),
      soil: farmCtx.soil,
      recentCycles: farmCtx.recentCycles,
    };
    // Only let frontend values override if non-empty
    if (frontendOverrides) {
      for (const [k, v] of Object.entries(frontendOverrides)) {
        if (v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
          enrichedProfile[k] = v;
        }
      }
    }
  } else if (farmCtx.farmer) {
    enrichedProfile = {
      farmerName: farmCtx.farmer.name,
      language: farmCtx.farmer.language || 'en',
      state: farmCtx.farmer.state,
      district: farmCtx.farmer.district,
    };
  }

  return { profile: enrichedProfile, farmCtx };
}

// ── Free-user AI limits ───────────────────────────────────────────────────────
const FREE_SCAN_DAILY_LIMIT   = 50;      // max crop scans per day (raised for testing)
const FREE_CHAT_DAILY_LIMIT   = 20;      // max AI chat messages per day
const FREE_TOKEN_DAILY_LIMIT  = 50_000;  // max tokens per day

/**
 * Get today's AIUsage row for the user (ISO date string key = YYYY-MM-DD).
 * Returns the record or null if none yet.
 */
async function getTodayUsage(userId) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return prisma.aIUsage.findUnique({
    where: { userId_date: { userId, date: today } },
  });
}

/**
 * Upsert AIUsage after a successful scan — add token counts + scan count.
 */
async function recordScanUsage(userId, tokenUsage) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tokens = tokenUsage?.total_tokens || 0;
  const cost   = tokenUsage?.total_cost_usd || 0;
  await prisma.aIUsage.upsert({
    where:  { userId_date: { userId, date: today } },
    create: { userId, date: today, scanCount: 1, totalTokens: tokens, totalCostUsd: cost, monthlyTokens: tokens, monthlyCostUsd: cost },
    update: {
      scanCount:      { increment: 1 },
      totalTokens:    { increment: tokens },
      totalCostUsd:   { increment: cost },
      monthlyTokens:  { increment: tokens },
      monthlyCostUsd: { increment: cost },
    },
  }).catch(e => logger.warn('[AIUsage] upsert failed: %s', e.message));
}

/**
 * Check free-user scan limits. Returns error string if exceeded, null if OK.
 */
async function checkScanLimits(userId) {
  const usage = await getTodayUsage(userId);
  if (!usage) return null; // no usage yet — allow
  if (usage.scanCount >= FREE_SCAN_DAILY_LIMIT)
    return `Daily limit reached — free users can run ${FREE_SCAN_DAILY_LIMIT} crop scans per day. Try again tomorrow.`;
  if (usage.totalTokens >= FREE_TOKEN_DAILY_LIMIT)
    return `Daily AI token limit reached. Try again tomorrow or upgrade to premium.`;
  return null;
}

// ── Multer: scan image ────────────────────────────────────────────────────────
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Please upload an image.`));
  },
});

// ── Multer: voice audio ───────────────────────────────────────────────────────
const audioUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['audio/m4a','audio/mp4','audio/mpeg','audio/mp3','audio/wav',
                'audio/webm','audio/ogg','audio/aac','audio/x-m4a',
                'video/mp4','application/octet-stream'];
    cb(null, ok.includes(file.mimetype));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/chat  — proxy to FastAPI, save to Prisma
// ─────────────────────────────────────────────────────────────────────────────
router.post('/chat', authenticate, aiChatLimit, async (req, res) => {
  const { message, conversationId, farmProfile, includeFarmContext = true, language } = req.body;

  if (!message?.trim())      return sendError(res, 'message is required', 400);
  if (message.length > 1000) return sendError(res, 'message too long (max 1000 chars)', 400);

  const wait = checkCooldown(req.user.id);
  if (wait > 0) return sendError(res, `Please wait ${wait}s before sending another message.`, 429);

  // Reject before expensive LLM call if user is out of credits
  const creditCheck = await checkCredits(req.user.id, 'ai_chat_groq');
  if (!creditCheck.allowed) {
    return sendError(res, creditCheck.message || 'Insufficient AI credits', 402);
  }

  try {
    // ── 1. Find or create conversation ───────────────────────────────────────
    let convo;
    if (conversationId) {
      convo = await prisma.aIConversation.findFirst({
        where: { id: conversationId, userId: req.user.id },
      });
      if (!convo) return sendError(res, 'Conversation not found', 404);
    } else {
      convo = await prisma.aIConversation.create({
        data: {
          userId: req.user.id,
          title:  message.trim().slice(0, 40) + (message.length > 40 ? '...' : ''),
        },
      });
    }

    // ── 2. Load history from Prisma ──────────────────────────────────────────
    const history = await prisma.aIMessage.findMany({
      where:   { conversationId: convo.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { role: true, content: true },
    });

    // ── 3. Enrich with farm context (optional — user can toggle off) ────────
    let enrichedProfile = {};
    if (includeFarmContext) {
      try {
        const { profile } = await buildEnrichedProfile(req.user.id, farmProfile);
        enrichedProfile = profile;
        logger.debug({ farmCtx: { farmerName: enrichedProfile.farmerName, farmName: enrichedProfile.farmName, soilType: enrichedProfile.soilType, cropsCount: enrichedProfile.crops?.length } }, '[AI Chat] Farm context sent to AI');
      } catch (ctxErr) { logger.warn('[AI Chat] Farm context failed (non-fatal): %s', ctxErr.message); }
    }

    // Inject user's preferred language into farm profile for AI response localisation
    if (language) enrichedProfile.language = language;

    const result = await callFastAPI('/ai/chat', {
      message:      message.trim(),
      history,
      farm_profile: enrichedProfile,
    }, req.user.id);

    const { reply, type, structured_data: structuredData, token_info: tokenInfo } = result;
    const tokens = tokenInfo?.total_tokens || 0;
    const model  = tokenInfo?.model || 'unknown';

    // ── 4. Save messages (with token tracking) ──────────────────────────────
    await prisma.aIMessage.createMany({
      data: [
        {
          conversationId: convo.id, role: 'user', content: message.trim(),
          messageType: 'text', language: farmProfile?.language || 'en',
        },
        {
          conversationId: convo.id, role: 'assistant', content: reply,
          messageType: type, structuredData: structuredData ?? undefined,
          language: farmProfile?.language || 'en',
          tokensUsed: tokens, modelUsed: model,
        },
      ],
    });

    // ── 5. Update conversation ───────────────────────────────────────────────
    const newCount = (convo.messageCount || 0) + 2;
    await prisma.aIConversation.update({
      where: { id: convo.id },
      data:  { updatedAt: new Date(), messageCount: newCount },
    });

    // ── 6. Track usage + deduct credits (non-blocking) ───────────────────────
    const featureType = model.includes('groq') || model.includes('llama') ? 'ai_chat_groq' : 'ai_chat_claude';
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    prisma.aIUsage.upsert({
      where:  { userId_date: { userId: req.user.id, date: today } },
      create: { userId: req.user.id, date: today, chatCount: 1, totalTokens: tokens, monthlyTokens: tokens },
      update: { chatCount: { increment: 1 }, totalTokens: { increment: tokens }, monthlyTokens: { increment: tokens } },
    }).catch(() => {});
    deductCredits(req.user.id, featureType, { model, tokensUsed: tokens, description: `Chat: ${model}` }).catch(() => {});

    return sendSuccess(res, {
      reply, type, card: structuredData ?? null, conversationId: convo.id,
      tokenUsage: { totalTokens: tokens, model },
    });

  } catch (err) {
    logger.error('[AI Chat] %s', err.message);
    if (err.status === 429)
      return sendError(res, 'AI rate limit reached. Please wait 30 seconds.', 429);
    if (err.name === 'AbortError')
      return sendError(res, 'AI response timed out. Please try again.', 504);
    return sendError(res, 'AI service unavailable. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/voice
// Sarvam STT → FastAPI /ai/chat → (opt) Sarvam TTS
// ─────────────────────────────────────────────────────────────────────────────
router.post('/voice', authenticate, aiVoiceLimit, audioUpload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) return sendError(res, 'audio file is required (field name: audio)', 400);

  const cleanUp = (p) => { try { fs.unlinkSync(p); } catch { /* ignore */ } };

  // Reject before expensive STT/TTS pipeline if user is out of credits
  const creditCheck = await checkCredits(req.user.id, 'ai_voice');
  if (!creditCheck.allowed) {
    cleanUp(file.path);
    return sendError(res, creditCheck.message || 'Insufficient AI credits', 402);
  }

  try {
    const ext         = (file.originalname?.match(/\.(\w+)$/)?.[1] || 'm4a').toLowerCase();
    const renamedPath = `${file.path}.${ext}`;
    fs.renameSync(file.path, renamedPath);

    let transcription    = '';
    let detectedLanguage = req.body.language || null;

    // Whisper rejects BCP-47 like "kn-IN" — it only knows ISO short codes
    // ("kn"). Strip the country suffix before any STT call. Sarvam accepts
    // either form internally, so this is safe for both.
    const shortLang = (req.body.language || '').split('-')[0].toLowerCase() || undefined;

    // ── Sarvam STT (primary) ─────────────────────────────────────────────────
    if (ENV.SARVAM_API_KEY) {
      try {
        const audioBuffer = fs.readFileSync(renamedPath);
        const r = await sarvamSTT(audioBuffer, `audio.${ext}`, detectedLanguage);
        transcription    = r.transcript;
        detectedLanguage = r.languageCode;
      } catch (e) {
        logger.warn('[Sarvam STT] failed, falling back to Groq Whisper: %s', e.message);
      }
    }

    // ── Groq Whisper (fallback) ───────────────────────────────────────────────
    if (!transcription) {
      const groqSTT = getGroqSTT();
      const result  = await groqSTT.audio.transcriptions.create({
        file:            fs.createReadStream(renamedPath),
        model:           'whisper-large-v3-turbo',
        response_format: 'text',
        language:        shortLang,
        prompt:          'FarmMind AI farming assistant. Farmer asking about crops, diseases, mandi prices, schemes.',
      });
      transcription = (typeof result === 'string' ? result : result?.text || '').trim();
    }

    cleanUp(renamedPath);
    if (!transcription)
      return sendError(res, 'Could not transcribe audio — please speak clearly and try again.', 422);

    const wait = checkCooldown(req.user.id);
    if (wait > 0) {
      return sendSuccess(res, {
        transcription, detectedLanguage,
        reply: `Please wait ${wait}s before sending another message.`,
        type: 'text', card: null, conversationId: null,
      });
    }

    // ── Create/find conversation ──────────────────────────────────────────────
    let farmProfile = {};
    try { farmProfile = JSON.parse(req.body.farmProfile || '{}'); } catch { /* ignore */ }
    const conversationId = req.body.conversationId || null;

    let convo;
    if (conversationId) {
      convo = await prisma.aIConversation.findFirst({
        where: { id: conversationId, userId: req.user.id },
      });
    }
    if (!convo) {
      convo = await prisma.aIConversation.create({
        data: {
          userId: req.user.id,
          title:  `Voice: ${transcription.slice(0, 37)}${transcription.length > 37 ? '...' : ''}`,
        },
      });
    }

    const history = await prisma.aIMessage.findMany({
      where:   { conversationId: convo.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { role: true, content: true },
    });

    // ── Enrich with farm context (same as /chat) ─────────────────────────────
    let enrichedProfile = {};
    try {
      const { profile } = await buildEnrichedProfile(req.user.id, farmProfile);
      enrichedProfile = profile;
    } catch (ctxErr) { logger.warn('[AI Voice] Farm context failed (non-fatal): %s', ctxErr.message); }

    // Honour the user-selected chat language so the LLM replies in the same
    // tongue (matches the text /chat behaviour at line ~368). Falls back to
    // whatever Sarvam STT detected, then to 'en'. Always short-coded —
    // FastAPI / chat_service expects 'mr', not 'mr-IN'.
    const replyLang = (
      shortLang
      || (detectedLanguage || '').split('-')[0].toLowerCase()
      || 'en'
    );
    if (replyLang) enrichedProfile.language = replyLang;

    // ── Proxy chat inference to FastAPI ───────────────────────────────────────
    const result = await callFastAPI('/ai/chat', {
      message:      transcription,
      history,
      farm_profile: enrichedProfile,
    }, req.user.id);

    const { reply, type, structured_data: structuredData, token_info: voiceTokenInfo } = result;
    const voiceTokens = voiceTokenInfo?.total_tokens || 0;
    const voiceModel  = voiceTokenInfo?.model || 'unknown';

    await prisma.aIMessage.createMany({
      data: [
        { conversationId: convo.id, role: 'user',      content: transcription, messageType: 'voice',
          language: detectedLanguage || 'hi-IN' },
        { conversationId: convo.id, role: 'assistant',  content: reply,         messageType: type,
          structuredData: structuredData ?? undefined, language: detectedLanguage || 'hi-IN',
          tokensUsed: voiceTokens, modelUsed: voiceModel },
      ],
    });
    await prisma.aIConversation.update({
      where: { id: convo.id },
      data:  { updatedAt: new Date(), messageCount: { increment: 2 } },
    });

    // Track usage + deduct credits
    const vToday = new Date(); vToday.setUTCHours(0, 0, 0, 0);
    prisma.aIUsage.upsert({
      where:  { userId_date: { userId: req.user.id, date: vToday } },
      create: { userId: req.user.id, date: vToday, chatCount: 1, totalTokens: voiceTokens, monthlyTokens: voiceTokens },
      update: { chatCount: { increment: 1 }, totalTokens: { increment: voiceTokens }, monthlyTokens: { increment: voiceTokens } },
    }).catch(() => {});
    deductCredits(req.user.id, 'ai_voice', { model: voiceModel, tokensUsed: voiceTokens, description: `Voice chat: ${voiceModel}` }).catch(() => {});

    // ── Optional TTS ─────────────────────────────────────────────────────────
    let audioData = null;
    const wantsTTS = req.query.tts === '1' || req.body.tts === true || req.body.tts === 'true';
    if (wantsTTS && ENV.SARVAM_API_KEY && reply) {
      try {
        const ttsLang = detectedLanguage || 'hi-IN';
        let ttsText   = reply;
        if (ttsLang !== 'en-IN' && !ttsLang.startsWith('en')) {
          try {
            const t = await sarvamTranslate(reply, 'en-IN', ttsLang);
            ttsText = t.translatedText || reply;
          } catch { /* speak English if translate fails */ }
        }
        const ttsResult = await sarvamTTS(ttsText, ttsLang);
        audioData = { audio: ttsResult.audio, mimeType: ttsResult.mimeType };
      } catch (e) {
        logger.warn('[Sarvam TTS] failed (non-fatal): %s', e.message);
      }
    }

    return sendSuccess(res, {
      transcription, detectedLanguage, reply, type,
      card: structuredData ?? null, conversationId: convo.id,
      ...(audioData ? { audio: audioData } : {}),
    });

  } catch (err) {
    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    logger.error('[AI Voice] %s', err.message);
    if (err.name === 'AbortError') return sendError(res, 'AI response timed out.', 504);
    return sendError(res, 'Voice processing failed. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/tts
// ─────────────────────────────────────────────────────────────────────────────
router.post('/tts', authenticate, async (req, res) => {
  const { text, language = 'hi-IN' } = req.body;
  if (!text?.trim())    return sendError(res, 'text is required', 400);
  if (text.length > 1000) return sendError(res, 'text too long (max 1000 chars)', 400);
  if (!ENV.SARVAM_API_KEY) return sendError(res, 'TTS not configured — set SARVAM_API_KEY', 503);

  try {
    const lang   = normaliseLangCode(language);
    const result = await sarvamTTS(text.trim(), lang);
    return sendSuccess(res, { audio: result.audio, mimeType: result.mimeType, language: lang });
  } catch (err) {
    logger.error('[Sarvam TTS] %s', err.message);
    return sendError(res, 'Text-to-speech failed. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/translate
// ─────────────────────────────────────────────────────────────────────────────
router.post('/translate', authenticate, async (req, res) => {
  const { text, sourceLang = 'en-IN', targetLang = 'hi-IN' } = req.body;
  if (!text?.trim())    return sendError(res, 'text is required', 400);
  if (text.length > 2000) return sendError(res, 'text too long (max 2000 chars)', 400);
  if (!ENV.SARVAM_API_KEY) return sendError(res, 'Translation not configured — set SARVAM_API_KEY', 503);

  try {
    const src    = normaliseLangCode(sourceLang);
    const tgt    = normaliseLangCode(targetLang);
    const result = await sarvamTranslate(text.trim(), src, tgt);
    return sendSuccess(res, { translatedText: result.translatedText, sourceLang: src, targetLang: tgt });
  } catch (err) {
    logger.error('[Sarvam Translate] %s', err.message);
    return sendError(res, 'Translation failed. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/conversations
// ─────────────────────────────────────────────────────────────────────────────
router.get('/conversations', authenticate, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const page  = parseInt(req.query.page || '1', 10);

  // Filter out soft-deleted (archived) conversations so the client sidebar
  // list doesn't re-show items the user just trashed.
  const baseWhere = { userId: req.user.id, isArchived: false };

  const [convos, total] = await Promise.all([
    prisma.aIConversation.findMany({
      where:   baseWhere,
      orderBy: { updatedAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, title: true, createdAt: true, updatedAt: true,
        _count: { select: { messages: true } },
      },
    }),
    prisma.aIConversation.count({ where: baseWhere }),
  ]);

  return sendSuccess(res, convos, 200, { total, page, limit });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/conversations/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/conversations/:id', authenticate, async (req, res) => {
  const convo = await prisma.aIConversation.findFirst({
    where:   { id: req.params.id, userId: req.user.id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, role: true, content: true,
          messageType: true, structuredData: true, createdAt: true,
        },
      },
    },
  });
  if (!convo) return sendError(res, 'Conversation not found', 404);
  return sendSuccess(res, convo);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/scan  — proxy to FastAPI 5-agent pipeline, save to Prisma
// ─────────────────────────────────────────────────────────────────────────────
router.post('/scan', authenticate, aiScanLimit, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return sendError(res, err.message || 'Image upload failed', 400);
    next();
  });
}, async (req, res) => {
  const file = req.file;
  if (!file) return sendError(res, 'image file is required — please attach a crop photo', 400);

  const t0 = Date.now();
  logger.info('[Express/Scan] REQUEST received — user=%s', req.user.id);

  // ── Free-user daily limit enforcement ────────────────────────────────────
  if (req.user.role === 'FARMER') {
    try {
      const limitErr = await checkScanLimits(req.user.id);
      if (limitErr) {
        try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
        logger.info('[Express/Scan] Rate limit hit for user=%s: %s', req.user.id, limitErr);
        return sendError(res, limitErr, 429);
      }
    } catch (limitCheckErr) {
      logger.warn('[AI Scan] Limit check failed (non-fatal, allowing scan): %s', limitCheckErr.message);
    }
  }

  // Reject before expensive Gemini vision call if user is out of credits
  const creditCheck = await checkCredits(req.user.id, 'ai_scan_gemini');
  if (!creditCheck.allowed) {
    try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
    return sendError(res, creditCheck.message || 'Insufficient AI credits', 402);
  }

  // ── Deduplication: if a scan is already in-flight for this user, reuse it ──
  if (inflightScans.has(req.user.id)) {
    logger.debug('[Express/Scan] Dedup — reusing in-flight scan for user=%s', req.user.id);
    try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
    try {
      const cached = await inflightScans.get(req.user.id);
      return sendSuccess(res, cached);
    } catch (err) {
      return sendError(res, 'Scan in progress failed — please retry', 500);
    }
  }

  // ── Wrap scan in a trackable promise for deduplication ───────────────────────
  const scanPromise = (async () => {
    const imageSize = fs.statSync(file.path).size;
    const mimeType  = file.mimetype;

    let farmCtx = {};
    try { farmCtx = JSON.parse(req.body.farmContext || '{}'); } catch { /* ignore */ }

    const lat = parseFloat(req.body.lat);
    const lon = parseFloat(req.body.lon);

    logger.debug({ imageKB: (imageSize / 1024).toFixed(1), mimeType, crop: farmCtx.cropName, stage: farmCtx.growthStage, lat, lon }, '[Express/Scan] Scan params');

    // ── Run Gemini diagnosis + weather fetch IN PARALLEL ────────────────────
    const scanPincode = farmCtx.pincode || req.user?.pincode || '000000';

    // Kick off weather fetch (non-blocking — diagnosis proceeds even if weather fails)
    const weatherPromise = getWeatherData(scanPincode).catch(e => {
      logger.warn('[Express/Scan] Weather fetch failed (non-fatal): %s', e.message);
      return null;
    });

    const params = {
      cropType:         farmCtx.cropName        || 'Unknown',
      growthStage:      farmCtx.growthStage      || (farmCtx.cropAge != null ? String(farmCtx.cropAge) : 'Unknown'),
      irrigationMethod: farmCtx.irrigationType  || null,
      symptoms:         Array.isArray(farmCtx.symptoms) ? farmCtx.symptoms : [],
      fieldArea:        farmCtx.landSize        || null,
      pincode:          scanPincode,
      weather:          null,  // weather injected below after parallel fetch
      soilData:         null,
      language:         farmCtx.language        || 'en',
    };

    // Wait for weather to resolve (it started before Gemini, completes in 1-3s)
    const weatherData = await weatherPromise;
    if (weatherData) {
      params.weather = weatherData;
      logger.debug('[Express/Scan] Weather enriched: temp=%s, humidity=%s, risk=%s', weatherData.current?.temp, weatherData.current?.humidity, weatherData.weatherRisk?.riskLevel);
    }

    const rawDiagnosis = await predictCropDisease(params, [
      { path: file.path, type: farmCtx.imageView || 'close_up' },
    ]);

    // Delete temp file after Gemini has finished reading it
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }

    logger.info('[Express/Scan] Gemini done in %dms — disease=%s conf=%s risk=%s', Date.now()-t0, rawDiagnosis?.primary_disease?.name, rawDiagnosis?.confidence_score, rawDiagnosis?.risk_level);

    // ── Record usage + deduct credits (non-blocking) ──────────────────────────
    const scanTokens = rawDiagnosis?.meta?.tokens_used || 0;
    const tokenUsage = { total_tokens: scanTokens, total_cost_usd: 0 };
    recordScanUsage(req.user.id, tokenUsage).catch(() => {});
    deductCredits(req.user.id, 'ai_scan_gemini', {
      model: 'gemini-2.5-flash', tokensUsed: scanTokens,
      description: `Crop scan: ${rawDiagnosis?.primary_disease?.name || 'analysis'}`,
    }).catch(() => {});

    // Flatten Node.js predict format → flat shape DiagnosisResultScreen expects
    const diagnosis = flattenNodePrediction(rawDiagnosis, farmCtx);
    logger.debug('[Express/Scan] disease=%s conf=%s severity=%s treatments=%d', diagnosis.disease, diagnosis.confidence, diagnosis.severity, diagnosis.treatment?.length);

    if (rawDiagnosis?.needs_rescan) {
      logger.info('[Express/Scan] needs_rescan — returning early');
      // Still persist the (uncertain) diagnosis so the farmer can share it
      // with a Krushi Kendra seller for a second opinion.
      let rescanReportId = null;
      try {
        const riskLevel = (rawDiagnosis?.risk_level || diagnosis.severity || 'low').toUpperCase();
        const riskScore = riskLevel === 'CRITICAL' ? 95 : riskLevel === 'HIGH' ? 75
          : riskLevel === 'MODERATE' ? 45 : 15;
        const saved = await prisma.cropDiseaseReport.create({
          data: {
            userId:          req.user.id,
            pincode:         req.user.pincode || farmCtx.pincode || '000000',
            cropType:        farmCtx.cropName || diagnosis.crop || 'Unknown',
            growthStage:     farmCtx.cropAge != null ? String(farmCtx.cropAge) : 'unknown',
            variety:         farmCtx.variety || null,
            fieldArea:       farmCtx.landSize || null,
            symptoms:        Array.isArray(farmCtx.symptoms) ? farmCtx.symptoms : [],
            imageCount:      1,
            overallRisk:     riskScore,
            riskLevel,
            primaryDisease:  diagnosis.disease || 'Needs rescan',
            confidenceScore: (diagnosis.confidence || 0) / 100,
            diagnosisMethod: 'gemini-direct',
            fullReport:      rawDiagnosis,
            weatherSnapshot: weatherData || null,
          },
        });
        rescanReportId = saved.id;
      } catch (e) {
        logger.warn('[AI Scan] needs_rescan report save failed: %s', e.message);
      }
      return { ...diagnosis, sessionId: null, reportId: rescanReportId, weatherUsed: false };
    }

    // ── Create scan chat session for follow-up Q&A (non-blocking — DB failures must not kill response) ──
    const diseaseName = diagnosis.disease || 'Crop Analysis';
    const cropName    = farmCtx.cropName  || diagnosis.crop || 'Unknown crop';

    let sessionId = null;
    let savedReportId = null;
    try {
      const convo = await prisma.aIConversation.create({
        data: {
          userId:        req.user.id,
          title:         `Scan: ${diseaseName} — ${cropName}`,
          language:      farmCtx.language || req.user.language || 'en',
          isScanSession: true,
          messages: {
            create: [{
              role:           'assistant',
              content:        `Diagnosis: **${diseaseName}** (${diagnosis.confidence || 0}% confidence)\n\nYou can now ask follow-up questions about this diagnosis.`,
              messageType:    'diagnosis',
              structuredData: diagnosis,
              language:       farmCtx.language || 'en',
            }],
          },
          messageCount: 1,
        },
      });
      sessionId = convo.id;

      // ── Persist CropDiseaseReport (fire-and-forget) ─────────────────────────
      const riskLevel = (rawDiagnosis?.risk_level || diagnosis.severity || 'low').toUpperCase();
      const riskScore = riskLevel === 'CRITICAL' ? 95 : riskLevel === 'HIGH' ? 75
        : riskLevel === 'MODERATE' ? 45 : 15;
      const confScore = (diagnosis.confidence || 0) / 100;

      // Awaited so the saved row's id can travel back to the client and the
      // farmer can immediately share it with a Krushi Kendra seller.
      try {
        const saved = await prisma.cropDiseaseReport.create({
          data: {
            userId:          req.user.id,
            pincode:         req.user.pincode || farmCtx.pincode || '000000',
            cropType:        farmCtx.cropName || cropName,
            growthStage:     farmCtx.cropAge != null ? String(farmCtx.cropAge) : 'unknown',
            variety:         farmCtx.variety || null,
            fieldArea:       farmCtx.landSize || null,
            symptoms:        Array.isArray(farmCtx.symptoms) ? farmCtx.symptoms : [],
            imageCount:      1,
            overallRisk:     riskScore,
            riskLevel,
            primaryDisease:  diseaseName,
            confidenceScore: confScore,
            diagnosisMethod: 'gemini-direct',
            modelAgreement:  null,
            fullReport:      rawDiagnosis,
            weatherSnapshot: weatherData || null,
            conversationId:  sessionId,
          },
        });
        savedReportId = saved.id;
      } catch (e) {
        logger.warn('[AI Scan] CropDiseaseReport save failed: %s', e.message);
      }
    } catch (dbErr) {
      logger.warn('[AI Scan] DB session create failed (returning diagnosis without sessionId): %s', dbErr.message);
    }

    // Strip large _fullReport from the response payload — frontend does not use it
    const { _fullReport, ...diagnosisForClient } = diagnosis;

    logger.info('[Express/Scan] Done — sessionId=%s total=%dms', sessionId, Date.now()-t0);

    return { ...diagnosisForClient, sessionId, reportId: savedReportId, weatherUsed: !!weatherData };
  })();

  // Store the in-flight promise for deduplication
  inflightScans.set(req.user.id, scanPromise);

  try {
    const result = await scanPromise;
    return sendSuccess(res, result);
  } catch (err) {
    try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
    const elapsed = Date.now() - t0;
    logger.error({ err, elapsed }, '[Express/Scan] ERROR after %dms', elapsed);

    if (err.status === 503 || err.message?.includes('No AI key'))
      return sendError(res, 'AI service not configured. Please contact support.', 503);
    if (err.status === 429 || err.message?.includes('rate limit') || err.message?.includes('quota'))
      return sendError(res, 'AI service is busy (rate limit). Please wait 1 minute and try again.', 429);
    if (err.name === 'AbortError' || elapsed >= 175_000)
      return sendError(res, 'Scan timed out after 3 minutes. Please try with a smaller/clearer photo.', 504);
    if (err.status === 400 && err.message?.includes('image'))
      return sendError(res, 'Image could not be read. Please take a new photo and try again.', 400);

    return sendError(res, `Scan failed: ${err.message || 'Unknown error'}. Please try again.`, 500);
  } finally {
    inflightScans.delete(req.user.id);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/scan/:sessionId/chat  — follow-up Q&A on a scan
// ─────────────────────────────────────────────────────────────────────────────
router.post('/scan/:sessionId/chat', authenticate, async (req, res) => {
  const { message } = req.body;
  if (!message?.trim())      return sendError(res, 'message is required', 400);
  if (message.length > 1000) return sendError(res, 'message too long (max 1000 chars)', 400);

  const wait = checkCooldown(req.user.id);
  if (wait > 0) return sendError(res, `Please wait ${wait}s before sending another message.`, 429);

  try {
    const convo = await prisma.aIConversation.findFirst({
      where: { id: req.params.sessionId, userId: req.user.id, isScanSession: true },
    });
    if (!convo) return sendError(res, 'Scan session not found', 404);

    const history = await prisma.aIMessage.findMany({
      where:   { conversationId: convo.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { role: true, content: true },
    });

    const report = await prisma.cropDiseaseReport.findFirst({
      where:  { conversationId: convo.id },
      select: { cropType: true, growthStage: true },
    });

    const farmProfile = {
      crops: report ? [{ name: report.cropType, ageInDays: parseInt(report.growthStage) || null }] : [],
      language: convo.language || 'en',
    };

    const result = await callFastAPI('/ai/chat', {
      message:      message.trim(),
      history,
      farm_profile: farmProfile,
    }, req.user.id);

    const { reply, type, structured_data: structuredData } = result;

    await prisma.aIMessage.createMany({
      data: [
        { conversationId: convo.id, role: 'user',      content: message.trim(), messageType: 'text' },
        { conversationId: convo.id, role: 'assistant',  content: reply,          messageType: type,
          structuredData: structuredData ?? undefined },
      ],
    });
    await prisma.aIConversation.update({
      where: { id: convo.id },
      data:  { updatedAt: new Date(), messageCount: { increment: 2 } },
    });

    return sendSuccess(res, { reply, type, card: structuredData ?? null, sessionId: convo.id });
  } catch (err) {
    logger.error('[Scan Chat] %s', err.message);
    return sendError(res, 'Failed to process your question. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/scan/sessions
// ─────────────────────────────────────────────────────────────────────────────
router.get('/scan/sessions', authenticate, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const page  = parseInt(req.query.page || '1', 10);

  const [sessions, total] = await Promise.all([
    prisma.aIConversation.findMany({
      where:   { userId: req.user.id, isScanSession: true, isArchived: false },
      orderBy: { updatedAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, title: true, createdAt: true, updatedAt: true,
        _count: { select: { messages: true } },
        scanReports: {
          select: {
            id: true, primaryDisease: true, riskLevel: true,
            confidenceScore: true, diagnosisMethod: true, cropType: true, createdAt: true,
          },
          take: 1,
        },
      },
    }),
    prisma.aIConversation.count({
      where: { userId: req.user.id, isScanSession: true, isArchived: false },
    }),
  ]);

  return sendSuccess(res, sessions, 200, { total, page, limit });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/scan/sessions/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/scan/sessions/:id', authenticate, async (req, res) => {
  const session = await prisma.aIConversation.findFirst({
    where:   { id: req.params.id, userId: req.user.id, isScanSession: true },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, role: true, content: true,
          messageType: true, structuredData: true, createdAt: true,
        },
      },
      scanReports: {
        select: {
          id: true, cropType: true, variety: true, growthStage: true,
          primaryDisease: true, riskLevel: true, confidenceScore: true,
          diagnosisMethod: true, fullReport: true, weatherSnapshot: true, createdAt: true,
        },
      },
    },
  });
  if (!session) return sendError(res, 'Scan session not found', 404);
  return sendSuccess(res, session);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/alerts  — proxy to FastAPI, cache in Express
// ─────────────────────────────────────────────────────────────────────────────
router.post('/alerts', authenticate, async (req, res) => {
  const cached = alertCacheGet(req.user.id);
  if (cached) return sendSuccess(res, cached);

  const { crop, state, dayOfSeason, irrigationType, soilType, previousCrop, landSize, currentCrops } = req.body;

  const farmContext = {
    crop:          crop          || req.user.farmDetail?.cropTypes?.[0] || 'Tomato',
    state:         state         || req.user.state || 'Maharashtra',
    district:      req.user.district || 'Nashik',
    day_of_season: dayOfSeason  || 45,
    season:        getCurrentSeason(),
    month:         new Date().toLocaleString('en-IN', { month: 'long' }),
    irrigationType, soilType, previousCrop, landSize, currentCrops,
  };

  try {
    const alerts = await callFastAPI('/ai/alerts', farmContext, req.user.id, 30_000);
    if (alerts?.length) alertCacheSet(req.user.id, alerts);
    return sendSuccess(res, alerts || []);
  } catch (err) {
    logger.error('[AI Alerts] %s', err.message);
    return sendSuccess(res, []);  // alerts are non-critical
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/scan/history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/scan/history', authenticate, async (req, res) => {
  const reports = await prisma.cropDiseaseReport.findMany({
    where:   { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, cropType: true, primaryDisease: true,
      riskLevel: true, confidenceScore: true, createdAt: true,
    },
  });
  return sendSuccess(res, reports);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/scan/feedback
// ─────────────────────────────────────────────────────────────────────────────
router.post('/scan/feedback', authenticate, async (req, res) => {
  const { reportId, farmerAgreed, confirmedDisease } = req.body;
  if (!reportId)               return sendError(res, 'reportId is required', 400);
  if (farmerAgreed === undefined) return sendError(res, 'farmerAgreed (boolean) is required', 400);

  const report = await prisma.cropDiseaseReport.findFirst({
    where: { id: reportId, userId: req.user.id },
    select: { id: true, primaryDisease: true },
  });
  if (!report) return sendError(res, 'Report not found', 404);

  const feedback = await prisma.diseaseFeedback.upsert({
    where:  { userId_reportId: { userId: req.user.id, reportId } },
    create: {
      userId: req.user.id, reportId,
      predictedDisease: report.primaryDisease,
      confirmedDisease: farmerAgreed ? null : (confirmedDisease || null),
      farmerAgreed: Boolean(farmerAgreed),
    },
    update: {
      confirmedDisease: farmerAgreed ? null : (confirmedDisease || null),
      farmerAgreed: Boolean(farmerAgreed),
    },
  });
  return sendSuccess(res, feedback);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/usage  — today's usage counts for the current user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usage', authenticate, async (req, res) => {
  const [usage, creditSummary] = await Promise.all([
    getTodayUsage(req.user.id),
    getCreditSummary(req.user.id).catch(() => null),
  ]);
  return sendSuccess(res, {
    scanCount:         usage?.scanCount       ?? 0,
    chatCount:         usage?.chatCount       ?? 0,
    totalTokens:       usage?.totalTokens     ?? 0,
    totalCostUsd:      usage?.totalCostUsd    ?? 0,
    monthlyTokens:     usage?.monthlyTokens   ?? 0,
    monthlyCostUsd:    usage?.monthlyCostUsd  ?? 0,
    limits: {
      scanDaily:   FREE_SCAN_DAILY_LIMIT,
      chatDaily:   FREE_CHAT_DAILY_LIMIT,
      tokensDaily: FREE_TOKEN_DAILY_LIMIT,
    },
    scansRemaining: Math.max(0, FREE_SCAN_DAILY_LIMIT - (usage?.scanCount ?? 0)),
    credits: creditSummary ? {
      balance:         creditSummary.balance,
      tier:            creditSummary.tier,
      tierLabel:       creditSummary.tierLabel,
      todaySpent:      creditSummary.todaySpent,
      lifetimeSpent:   creditSummary.lifetimeSpent,
      lifetimeEarned:  creditSummary.lifetimeEarned,
      nextRefill:      creditSummary.nextRefill,
    } : null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/ai/conversations/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/conversations/:id', authenticate, async (req, res) => {
  const convo = await prisma.aIConversation.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!convo) return sendError(res, 'Conversation not found', 404);

  await prisma.aIConversation.update({
    where: { id: convo.id },
    data:  { isArchived: true },
  });
  return sendSuccess(res, { archived: true });
});

export default router;
