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
import { authenticate } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { sendSuccess, sendError, parsePageNumber } from '../utils/response.js';
import { ENV } from '../config/env.js';
import {
  sarvamSTT,
  sarvamTTS,
  sarvamTranslate,
  normaliseLangCode,
} from '../services/sarvam.service.js';
import { getCurrentSeason } from '../services/ai.chat.service.js';
import { predictCropDisease } from '../services/ai.predict.service.js';
import {
  callFastAPIScan,
  submitFastAPIScan,
  getFastAPIScanStatus,
  flattenFastAPIDiagnosis,
  scanNonResultKind,
  extractUsage as extractFastAPIUsage,
} from '../services/ai.scan.fastapi.js';
// checkCredits is deliberately NOT imported any more: every credit gate in this
// file now goes through the atomic reserve/settle/release triple. deductCredits
// survives for the one path with no hold to reconcile — a scan poll that lands
// after the submitting process lost its pendingScans entry.
import { deductCredits, getCreditSummary, reserveCredits, settleCredits, releaseCredits } from '../services/aiCredit.service.js';
import { buildFarmerChatContext } from '../services/chatContext.service.js';
import { getWeatherData } from '../services/weather.service.js';
import { aiChatLimit, aiScanLimit, aiVoiceLimit } from '../middleware/redisRateLimit.js';
import { idempotency } from '../middleware/idempotency.js';
import redis from '../config/redis.js';
import { withLeaderLock } from '../utils/leaderLock.js';
import { safetyRefusalLine } from '../constants/aiSafetyCopy.js';
import { uploadBuffer } from '../config/cloudinary.js';
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { getSetting } from '../services/settings.service.js';
import { requireFeature } from '../middleware/requireFeature.js';

/**
 * Kick off Cloudinary uploads for the base64 image array sent with a scan.
 * Returns a Promise that resolves to a list of secure URLs — empty array on
 * failure or when Cloudinary isn't configured so the scan flow never blocks.
 * Runs in parallel with the FastAPI pipeline; the URLs are written to the
 * CropDiseaseReport row in _persistDoneScan once both finish.
 */
function uploadScanImagesToCloudinary(images, userId) {
  if (!ENV.CLOUDINARY_CLOUD_NAME) return Promise.resolve([]);
  if (!Array.isArray(images) || images.length === 0) return Promise.resolve([]);
  return Promise.all(
    images.map(img => {
      try {
        const buf = Buffer.from(img.data, 'base64');
        return uploadBuffer(buf, `scans/${userId}`).catch(err => {
          logger.warn('[Cloudinary/scan] one upload failed: %s', err?.message);
          return null;
        });
      } catch (err) {
        logger.warn('[Cloudinary/scan] base64 decode failed: %s', err?.message);
        return Promise.resolve(null);
      }
    }),
  ).then(urls => urls.filter(Boolean));
}

// ── FastAPI proxy helper ──────────────────────────────────────────────────────
// All Express → FastAPI calls now route through utils/fastapi-signed.js which
// adds HMAC-SHA256 signatures over (ts, METHOD, path, body_hash). The contract
// must stay in lock-step with fastapi/security/auth.py — change them together.
import { callFastAPI, streamSignedSSE } from '../utils/fastapi-signed.js';
import { registerVoiceStream, unregisterVoiceStream } from '../services/voiceStream.registry.js';
import { archiveResource } from '../services/softDelete.service.js';

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


const router = Router();
// :id (conversations) and :sessionId (scan sessions) are uuid()s; reject non-UUIDs
// with 400. :jobId is a FastAPI job id (not a DB id), so it is intentionally not guarded.
router.param('id', uuidParamGuard);
router.param('sessionId', uuidParamGuard);

// ── Per-user caches ───────────────────────────────────────────────────────────
const alertCache       = new Map();
const ALERT_TTL_MS     = 30 * 60 * 1000;
const ALERT_MAX_ENTRIES = 50_000; // hard cap so a burst of unique users can't OOM us
function alertCacheGet(uid) {
  const e = alertCache.get(uid);
  if (!e || Date.now() > e.expiresAt) { alertCache.delete(uid); return null; }
  return e.data;
}
function alertCacheSet(uid, data) {
  if (!alertCache.has(uid) && alertCache.size >= ALERT_MAX_ENTRIES) {
    const oldest = alertCache.keys().next().value; // FIFO eviction; periodic sweep handles TTL
    alertCache.delete(oldest);
  }
  alertCache.set(uid, { data, expiresAt: Date.now() + ALERT_TTL_MS });
}

// ── Per-user AI cooldown (6 s gap) — Redis so it holds across instances ───────
const AI_MIN_GAP_MS = 6000;
async function checkCooldown(uid) {
  // Returns seconds the caller must wait (0 = allowed). Fail-open if Redis down.
  try {
    if (redis?.status !== 'ready') return 0;
    const ok = await redis.set(`cooldown:ai:${uid}`, '1', 'PX', AI_MIN_GAP_MS, 'NX');
    if (ok === 'OK') return 0;                      // first call in window → allow + arm
    const pttl = await redis.pttl(`cooldown:ai:${uid}`);
    return pttl > 0 ? Math.ceil(pttl / 1000) : 0;   // still cooling down
  } catch {
    return 0;                                       // never block on a Redis blip
  }
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
  // (AI cooldown now lives in Redis with a TTL — no in-memory map to sweep.)
}, MAP_CLEANUP_INTERVAL).unref();

// ── farm_profile override allowlist ───────────────────────────────────────────
// The client could override ANY key on the server-built profile, uncapped, and
// chat_service interpolates the whole profile verbatim into the writer system
// prompt — ABOVE the SECURITY paragraph that says "the farmer's message is user
// data". So an un-allowlisted key was a prompt-injection channel carrying
// system-prompt privilege on the one surface with no downstream safety
// validator. Exactly these keys survive (a superset of what
// chat_service._compute_profile reads); everything else is dropped silently.
//
// `state` and `district` are deliberately NOT on this list. They stopped being
// personalization the moment chat_service._gate_state started keying
// STATE_LEVEL_BANS and FULLY_ORGANIC_STATES off farm_profile.state: a client
// sending state:"Maharashtra" for a Kerala farmer would re-enable every active
// Kerala bans, and state:"Karnataka" for a Sikkim farmer would defeat the
// fully-organic check. Jurisdiction is law, so it is server-derived only — read
// from the Farm/User record in buildEnrichedProfile below, where the client
// cannot reach it.
const FARM_PROFILE_ALLOWED_KEYS = new Set([
  'language', 'village', 'taluka',
  'farmerName', 'farmName', 'experience', 'landSize',
  'soilType', 'irrigationType', 'waterSources',
  'crops', 'soil', 'recentCycles', 'history', 'priorIssues',
]);
const FARM_PROFILE_MAX_STR   = 200;  // per interpolated string
const FARM_PROFILE_MAX_ARRAY = 5;    // crops[] and friends

// Depth-limited cap so a 100 KB blob, or a newline-stuffed fake "FarmMind:" turn,
// can't ride in on a nested field the top-level cap never sees.
function _capProfileValue(v, depth = 0) {
  if (typeof v === 'string') return v.slice(0, FARM_PROFILE_MAX_STR);
  if (Array.isArray(v)) {
    if (depth >= 2) return undefined;
    return v.slice(0, FARM_PROFILE_MAX_ARRAY).map(x => _capProfileValue(x, depth + 1));
  }
  if (v && typeof v === 'object') {
    if (depth >= 2) return undefined;
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = _capProfileValue(val, depth + 1);
    return out;
  }
  return v;  // number | boolean | null
}

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
        season: c.seasonLabel,
        fertilizerHistory: c.fertilizerHistory, pesticideHistory: c.pesticideHistory,
        irrigationSummary: c.irrigationSummary, eventsSummary: c.eventsSummary,
        costSplit: c.costSplit, netProfitInr: c.netProfitInr, profitPerAcreInr: c.profitPerAcreInr,
      })),
      soil: farmCtx.soil,
      recentCycles: farmCtx.recentCycles,
      history: farmCtx.history,
      priorIssues: farmCtx.history?.priorIssues || [],
    };
    // Only let ALLOWLISTED, length-capped frontend values override, and only
    // when non-empty (see FARM_PROFILE_ALLOWED_KEYS above).
    if (frontendOverrides && typeof frontendOverrides === 'object') {
      for (const [k, v] of Object.entries(frontendOverrides)) {
        if (!FARM_PROFILE_ALLOWED_KEYS.has(k)) continue;
        if (v === '' || v === null || v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        const capped = _capProfileValue(v);
        if (capped !== undefined) enrichedProfile[k] = capped;
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

// ── Enriched-profile cache (per user+conversation) ────────────────────────────
// buildEnrichedProfile → buildFarmerChatContext runs several DB queries, but the
// result barely changes within a single conversation. Caching it for a short TTL
// removes that work from turns 2+ of a voice/text conversation. The TTL bounds
// staleness if the farmer edits their profile mid-conversation.
const ENRICHED_PROFILE_TTL_MS = 90_000;
const _enrichedProfileCache = new Map(); // key -> { profile, expiresAt }

function getCachedEnrichedProfile(key) {
  const entry = _enrichedProfileCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _enrichedProfileCache.delete(key); return null; }
  return entry.profile;
}

function setCachedEnrichedProfile(key, profile) {
  // Store a shallow copy so a later per-turn mutation of the returned profile
  // (e.g. setting .language) can never corrupt the cached entry.
  _enrichedProfileCache.set(key, { profile: { ...profile }, expiresAt: Date.now() + ENRICHED_PROFILE_TTL_MS });
  // Opportunistic eviction to bound memory — no dedicated timer needed.
  if (_enrichedProfileCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _enrichedProfileCache) if (now > v.expiresAt) _enrichedProfileCache.delete(k);
  }
}

// ── Conversation history window ───────────────────────────────────────────────
// `orderBy: asc` + `take: 20` returns the OLDEST 20 rows ever written, not the
// latest 20: after ten exchanges the model's most recent context was still turn
// 10, so "aur kitna dalu?" got re-answered against the opening question or an
// invented referent — and because the FastAPI quality rules demand an exact
// dose, it invented a dose for a guessed product. It is also the worst token
// profile in the system, pinning the least-relevant turns into every later
// prompt and re-billing them forever.
//
// Read newest-first, walk back until the turn cap OR the token budget is spent,
// then reverse to chronological — the shape chat_service's `history[-20:]`
// tail-slice expects (oldest first, newest last). Same idiom as the nested-
// message loader in GET /conversations/:id below.
// The turn cap alone bounds nothing: chat_service caps each entry at 2000 chars
// (_CHAT_HISTORY_MAX_LEN), so 20 turns is a 40,000-char / ~13K-token worst case
// re-sent and re-billed on EVERY turn of an extra_long conversation. The token
// budget is the real bound; it leaves all 20 turns intact for the normal short
// answers and keeps ~6 of the longest ones, which is well past what referent
// resolution ("aur kitna dalu?") needs.
const HISTORY_MAX_TURNS  = 20;
const HISTORY_MAX_TOKENS = 3000;
// ~3 chars/token is deliberately pessimistic: Gemini tokenises Devanagari and
// Tamil far denser than Latin, and under-counting is exactly what let a bloated
// window get re-billed on every turn.
const _estTokens = (s) => Math.ceil(String(s || '').length / 3);

async function loadRecentHistory(delegate, conversationId) {
  const rows = await delegate.findMany({
    where:   { conversationId },
    orderBy: { createdAt: 'desc' },
    take:    HISTORY_MAX_TURNS,
    select:  { role: true, content: true },
  });
  const window = [];
  let budget = HISTORY_MAX_TOKENS;
  for (const row of rows) {              // newest → oldest
    const cost = _estTokens(row.content);
    // The newest turn always survives: one long answer must not erase the whole
    // context, and FastAPI truncates each entry at 2000 chars regardless.
    if (window.length > 0 && cost > budget) break;
    budget -= cost;
    window.push(row);
  }
  return window.reverse();               // back to chronological (oldest → newest)
}

// ── Safety-refusal substitution (shared by every /ai/chat consumer) ───────────
// When safety.validator excises every sentence of a reply, FastAPI returns an
// EMPTY reply and sets token_info.safety.replaced_with_fallback. It deliberately
// does NOT send its own fallback sentence: that constant is hardcoded English,
// and on the voice path Express hands the reply straight to Sarvam TTS with the
// farmer's language tag — an English refusal spoken in a Marathi voice, on the
// one surface built for people who cannot read. So the copy is chosen here (see
// constants/aiSafetyCopy.js) and `safetyRefusal` rides the wire for clients that
// would rather render their own localized line on screen.
function applySafetyRefusal(result, lang, label, userId) {
  const refused = result?.token_info?.safety?.replaced_with_fallback === true;
  let reply = result?.reply;
  if (refused && !String(reply || '').trim()) {
    reply = safetyRefusalLine(lang);
  }
  logAiProvenance(result?.token_info, label, userId);
  return { reply, safetyRefusal: refused };
}

// ── Safety + prompt provenance ───────────────────────────────────────────────
// chat_service stamps token_info.safety (blockers, warnings, registry versions)
// and token_info.prompts (name/version/content-hash per prompt that shaped the
// answer) on EVERY turn, and Express destructured only total_tokens/model/
// cost_usd — so the whole audit trail was produced and then dropped on the
// floor. There is no metadata column on AIMessage/VoiceMessage to persist it
// into (a schema change is its own migration), so the log is the trail: a
// blocked chemical is a WARN with the codes and the prompt versions that
// produced it, which is what makes "why did it say that" and "replay this answer
// against the prompt that wrote it" answerable at all. Clean turns log nothing —
// this must not become a per-turn line in production.
function logAiProvenance(tokenInfo, label, userId) {
  const safety = tokenInfo?.safety;
  if (!safety || !(safety.blocker_count > 0)) return;
  logger.warn(
    '[%s] safety gate fired (user=%s blockers=%d warnings=%d replaced=%s codes=%s ' +
    'registry=%s state_bans=%s prompts=%s)',
    label, userId, safety.blocker_count, safety.warning_count || 0,
    safety.replaced_with_fallback === true,
    (safety.blockers || []).map(b => b?.code).filter(Boolean).join(','),
    safety.registry_version, safety.state_bans_version,
    (tokenInfo?.prompts || []).map(p => `${p?.name}@${p?.version}#${p?.hash}`).join(' '),
  );
}

// ── Voice streaming pipeline (Socket.IO) ──────────────────────────────────────
// Consumes the FastAPI SSE token stream, synthesises each finished sentence via
// Sarvam TTS, and pushes audio chunks to the user's socket room as they're ready —
// so playback starts on sentence 1 while later sentences are still being written.
// Self-contained: owns the credit hold (settles on success, releases on failure)
// and never touches the already-sent HTTP response; failures surface as a
// voice:error socket event the client maps to a friendly message.
const VOICE_TTS_MIN_CHARS = 12;   // don't synthesise tiny fragments
const VOICE_TTS_MAX_CHARS = 180;  // force a cut if one "sentence" runs long

// A `.` is only a sentence end when it is NOT a decimal point. Cutting inside
// "Spray Mancozeb 2.5 g per litre" produced two separate Sarvam TTS clips — the
// farmer heard "…at two." then "five grams per litre", each with sentence-final
// falling intonation and an inter-clip gap, and mixed at 2 g/L (under-dose) or
// 5 g/L (phytotoxicity + MRL breach). This fired on essentially every dosing
// answer, because the FastAPI quality rules force an exact dose and Indian EC
// label rates are almost always decimal.
//   \p{Nd} (not \d) so Devanagari ०-९ in a Hindi/Marathi reply is covered too.
//   The lookahead also keeps "Rs.500" and "No.3" whole.
//   । and \n are never decimal separators, so they stay unguarded.
const VOICE_SENTENCE_BOUNDARY = /(?<!\p{Nd})[.!?](?=\s|$)|[।\n]/u;

// Pull the next complete sentence from `buf`. Cuts at the first sentence-final
// . ! ? (see above), । or newline; force-cuts at a space past MAX; on flush emits
// whatever remains. Returns [sentence|null, remainingBuf].
function _nextVoiceSentence(buf, flush) {
  const at = buf.search(VOICE_SENTENCE_BOUNDARY);
  if (at !== -1) {
    const sentence = buf.slice(0, at + 1).trim();
    const rest = buf.slice(at + 1);
    if (sentence.length >= VOICE_TTS_MIN_CHARS || flush) return [sentence, rest];
    return [null, buf]; // too short — keep buffering toward a fuller sentence
  }
  if (buf.length >= VOICE_TTS_MAX_CHARS) {
    let cut = buf.lastIndexOf(' ', VOICE_TTS_MAX_CHARS);
    if (cut < VOICE_TTS_MIN_CHARS) cut = VOICE_TTS_MAX_CHARS;
    return [buf.slice(0, cut).trim(), buf.slice(cut)];
  }
  if (flush && buf.trim()) return [buf.trim(), ''];
  return [null, buf];
}

async function runVoiceStreamPipeline(ctx) {
  const {
    io, userId, streamId, convo, transcription, detectedLanguage,
    history, enrichedProfile, voiceRespLen, voiceChatModel, hold, requestId,
  } = ctx;
  const room    = io.to(`user:${userId}`);
  const ttsLang = detectedLanguage || 'hi-IN';
  const emit = (event, payload) => { try { room.emit(event, { streamId, ...payload }); } catch { /* ignore */ } };

  // Cancellation: the client emits voice:cancel on leaving the screen; the socket
  // handler flips state.cancelled, which we check between SSE frames and before
  // every TTS/emit so the pipeline stops promptly instead of running to completion.
  const cancelKey = `${userId}:${streamId}`;
  const state = registerVoiceStream(cancelKey);

  let buffer = '';        // un-spoken text awaiting a sentence boundary
  let fullReply = '';     // everything streamed (fallback if no `final`)
  let seq = 0;            // audio chunk ordering
  let finalReply = '';
  let followUps = [];
  let tokenInfo = null;
  let settled = false;
  // chat_service sets `partial: true` on the `final` frame when generation blew
  // up mid-stream. Express used to read only reply/followUps/token_info, so a
  // truncated answer ("…mix 2" and nothing else) was spoken, persisted as a
  // completed assistant turn, and billed as complete with no voice:error to tell
  // the client. Capture it and degrade the turn instead.
  let partial = false;

  const ttsAndEmit = async (text) => {
    const t = (text || '').trim();
    if (!t || !ENV.SARVAM_API_KEY || state.cancelled) return;
    try {
      const r = await sarvamTTS(t, ttsLang);
      if (state.cancelled) return;                 // user left while we synthesised — don't emit
      emit('voice:audio_chunk', { seq: seq++, text: t, audio: r.audio, mimeType: r.mimeType });
    } catch (e) {
      logger.warn('[AI Voice stream] TTS chunk failed (non-fatal): %s', e.message);
    }
  };

  try {
    await streamSignedSSE('/ai/chat/stream', {
      message:         transcription,
      history,
      farm_profile:    enrichedProfile,
      response_length: voiceRespLen,
      ...(voiceChatModel ? { model: voiceChatModel } : {}),
    }, { userId, requestId, timeoutMs: 60_000 }, async (evt) => {
      // Abort the upstream SSE read the moment a cancel is seen (throwing here
      // propagates out of streamSignedSSE, which aborts the FastAPI request).
      if (state.cancelled) { const e = new Error('cancelled'); e._cancelled = true; throw e; }
      if (evt.type === 'delta') {
        const text = evt.text || '';
        if (!text) return;
        fullReply += text;
        buffer    += text;
        emit('voice:reply_delta', { text });
        // Speak every complete sentence now sitting in the buffer, in order.
        let sentence;
        for (;;) {
          [sentence, buffer] = _nextVoiceSentence(buffer, false);
          if (!sentence) break;
          await ttsAndEmit(sentence);
        }
      } else if (evt.type === 'final') {
        finalReply = evt.reply || fullReply;
        followUps  = Array.isArray(evt.followUps) ? evt.followUps : [];
        tokenInfo  = evt.token_info || null;
        partial    = evt.partial === true;
      } else if (evt.type === 'error') {
        throw new Error(evt.error || 'voice stream error');
      }
    });

    // If the user left while the stream was finishing, bail before flushing more
    // audio or persisting — the catch below refunds the hold.
    if (state.cancelled) { const e = new Error('cancelled'); e._cancelled = true; throw e; }

    // Flush the trailing buffer as the final sentence(s).
    let tail;
    for (;;) {
      [tail, buffer] = _nextVoiceSentence(buffer, true);
      if (!tail) break;
      await ttsAndEmit(tail);
    }

    // The safety gate excised every sentence, so FastAPI deliberately sent back
    // an EMPTY reply rather than its own English fallback line (that line would
    // otherwise have been synthesised in the farmer's voice, in English, on the
    // surface built for people who cannot read). Substitute the server-owned
    // refusal and speak it, so the turn ends with an answer instead of silence.
    const safetyRefusal = tokenInfo?.safety?.replaced_with_fallback === true;
    let reply = (finalReply || fullReply || '').trim();
    logAiProvenance(tokenInfo, 'AI Voice stream', userId);
    if (safetyRefusal && !reply) {
      reply = safetyRefusalLine(ttsLang);
      await ttsAndEmit(reply);
    }
    const voiceTokens = tokenInfo?.total_tokens || 0;
    const voiceModel  = tokenInfo?.model || voiceChatModel || 'unknown';
    // getBudgetSummary sums totalCostUsd/monthlyCostUsd, so a voice turn that
    // writes only totalTokens is invisible to the admin budget view.
    const voiceCost   = Number(tokenInfo?.cost_usd || 0);

    // A partial reply is NOT a completed turn: persisting it as one feeds a
    // truncated, half-a-dose answer back as authoritative context on the next
    // turn. The farmer's question is still persisted — he did ask it.
    const turnRows = [
      { conversationId: convo.id, role: 'user', content: transcription,
        language: detectedLanguage || 'hi-IN' },
      ...(partial ? [] : [{
        conversationId: convo.id, role: 'assistant', content: reply,
        language: detectedLanguage || 'hi-IN', modelUsed: voiceModel,
      }]),
    ];
    await prisma.voiceMessage.createMany({ data: turnRows });
    await prisma.voiceConversation.update({
      where: { id: convo.id },
      data:  { updatedAt: new Date(), messageCount: { increment: turnRows.length } },
    });
    const vToday = new Date(); vToday.setUTCHours(0, 0, 0, 0);
    prisma.aIUsage.upsert({
      where:  { userId_date: { userId, date: vToday } },
      create: { userId, date: vToday, chatCount: 1, totalTokens: voiceTokens, totalCostUsd: voiceCost,
                monthlyTokens: voiceTokens, monthlyCostUsd: voiceCost },
      update: { chatCount: { increment: 1 },
                totalTokens: { increment: voiceTokens }, totalCostUsd: { increment: voiceCost },
                monthlyTokens: { increment: voiceTokens }, monthlyCostUsd: { increment: voiceCost } },
    }).catch(() => {});

    // Is anyone still in the room? This pipeline runs AFTER the HTTP response
    // returned, so a farmer on patchy 4G whose socket dropped mid-generation was
    // charged in full for audio emitted into nothing — and the catch's refund
    // only fires when !settled, i.e. never once we reached this line.
    // fetchSockets() is adapter-aware, so it counts this user's sockets across
    // every replica. If the lookup itself fails, treat the room as LIVE: the
    // Gemini + Sarvam spend was real and refund-on-infra-blip is a free-call
    // vector (same reasoning as the scan settle-claim below).
    let roomLive = true;
    try {
      roomLive = (await io.in(`user:${userId}`).fetchSockets()).length > 0;
    } catch (e) {
      logger.warn('[AI Voice stream] occupancy check failed, settling anyway: %s', e?.message);
    }

    if (roomLive) {
      await settleCredits(userId, 'ai_voice', {
        reserved: hold.reserved, holdId: hold.holdId, tokensUsed: voiceTokens, model: voiceModel,
        description: `Voice chat: ${voiceModel}`, costUsd: tokenInfo?.cost_usd,
      });
    } else {
      await releaseCredits(userId, 'ai_voice', { reserved: hold.reserved, holdId: hold.holdId }).catch(() => {});
      logger.info('[AI Voice stream] room empty at completion — hold refunded (user=%s)', userId);
    }
    // BOTH branches finalise the hold — the catch below must not refund again.
    settled = true;

    // `partial` is always present so the client can test a defined field on both
    // branches; nothing to emit when the room is empty.
    if (roomLive) emit('voice:done', { reply, followUps, conversationId: convo.id, partial, safetyRefusal });
  } catch (err) {
    // Refund the hold for any incomplete turn (cancel, partial, or total failure).
    if (!settled) {
      await releaseCredits(userId, 'ai_voice', { reserved: hold.reserved, holdId: hold.holdId }).catch(() => {});
    }
    if (err && err._cancelled) {
      // User left the screen — terminate quietly. No voice:error (nobody's listening),
      // and the upstream FastAPI request was already aborted by streamSignedSSE.
      logger.info('[AI Voice stream] cancelled by client (user=%s)', userId);
    } else {
      logger.error('[AI Voice stream] %s', err.message);
      emit('voice:error', { message: 'Voice service had a problem. Please try again.' });
    }
  } finally {
    unregisterVoiceStream(cancelKey);
  }
}

// ── Free-user AI limits ───────────────────────────────────────────────────────
// These consts are the SAFE FALLBACKS. The live caps are resolved per request
// from the admin App Settings (ai.freeScanDailyLimit / ai.freeChatDailyLimit /
// ai.freeTokenDailyLimit) via getSetting, which itself falls back to these when
// no DB override exists. A stored 0/NaN falls back too (so a bad value can't
// silently block everyone) — set a deliberate cap from the panel to change it.
const FREE_SCAN_DAILY_LIMIT   = 500;       // max crop scans per day (fallback)
const FREE_CHAT_DAILY_LIMIT   = 200;       // max AI chat messages per day (fallback)
const FREE_TOKEN_DAILY_LIMIT  = 1_000_000; // max tokens per day (fallback)

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
  // `|| FALLBACK` is NOT a sufficient guard here: it only catches 0/NaN, so a
  // negative limit sailed through and made `scanCount >= limit` true for everyone.
  // The manifest now rejects negatives at write time; this is the defence in depth
  // for rows written before that existed. Note 0 is a LEGITIMATE value (feature off
  // for free users), so it must survive — hence >= 0 rather than a truthy check.
  const asLimit = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const scanLimit  = asLimit(await getSetting('ai.freeScanDailyLimit').catch(() => undefined), FREE_SCAN_DAILY_LIMIT);
  const tokenLimit = asLimit(await getSetting('ai.freeTokenDailyLimit').catch(() => undefined), FREE_TOKEN_DAILY_LIMIT);
  if (usage.scanCount >= scanLimit)
    return `Daily limit reached — free users can run ${scanLimit} crop scans per day. Try again tomorrow.`;
  if (usage.totalTokens >= tokenLimit)
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
router.post('/chat', authenticate, requireFeature('ai_chat'), aiChatLimit, idempotency('chat'), async (req, res) => {
  const { message, conversationId, farmProfile, includeFarmContext = true, language, responseLength, image } = req.body;

  // An attached photo routes to the (pricier) vision model for a conversational
  // disease read. A photo alone — no text — is a valid request.
  const hasImage = !!(image && typeof image === 'object' && image.data);
  if (hasImage) {
    if (typeof image.mime_type === 'string' && !image.mime_type.startsWith('image/')) {
      return sendError(res, 'attached file must be an image', 400);
    }
    if (typeof image.data !== 'string' || image.data.length > 12_000_000) {
      return sendError(res, 'attached image is too large', 413);
    }
  }

  if (!message?.trim() && !hasImage) return sendError(res, 'message is required', 400);
  if (message && message.length > 1000) return sendError(res, 'message too long (max 1000 chars)', 400);

  // Whitelist the farmer-selected response length (defaults to "short").
  const LENGTHS = ['short', 'medium', 'long', 'extra_long'];
  const respLen = LENGTHS.includes(responseLength) ? responseLength : 'short';

  const wait = await checkCooldown(req.user.id);
  if (wait > 0) return sendError(res, `Please wait ${wait}s before sending another message.`, 429);

  // RESERVE credits atomically before the expensive LLM call (race-free). Image
  // chats hold against the vision (scan) bucket; text holds the chat floor.
  const reserveFeature = hasImage ? 'ai_scan_gemini' : 'ai_chat_gemini';
  const hold = await reserveCredits(req.user.id, reserveFeature);
  if (!hold.ok) {
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }

  try {
    // ── 1. Find or create conversation ───────────────────────────────────────
    let convo;
    if (conversationId) {
      convo = await prisma.aIConversation.findFirst({
        where: { id: conversationId, userId: req.user.id },
      });
      if (!convo) {
        // Release the reserved hold — this early return bypasses the catch refund.
        await releaseCredits(req.user.id, reserveFeature, { reserved: hold.reserved, holdId: hold.holdId });
        return sendError(res, 'Conversation not found', 404);
      }
    } else {
      // message may be empty/undefined for an image-only chat — guard the title
      // so `.trim()` can't throw (crashed non-app callers that omit the field).
      const titleText = (message?.trim() || '[photo]');
      convo = await prisma.aIConversation.create({
        data: {
          userId: req.user.id,
          title:  titleText.slice(0, 40) + (titleText.length > 40 ? '...' : ''),
        },
      });
    }

    // ── 2. Load history from Prisma (newest-first + reverse; see loadRecentHistory) ─
    const history = await loadRecentHistory(prisma.aIMessage, convo.id);

    // ── 3. Enrich with farm context (optional — user can toggle off) ────────
    let enrichedProfile = {};
    if (includeFarmContext) {
      try {
        const { profile } = await buildEnrichedProfile(req.user.id, farmProfile);
        enrichedProfile = profile;
        logger.debug({ farmCtx: { farmerName: enrichedProfile.farmerName, farmName: enrichedProfile.farmName, soilType: enrichedProfile.soilType, cropsCount: enrichedProfile.crops?.length } }, '[AI Chat] Farm context sent to AI');
      } catch (ctxErr) { logger.warn('[AI Chat] Farm context failed (non-fatal): %s', ctxErr.message); }
    } else {
      // The "Farm context" toggle (AIChatScreen → "Farm context off") governs
      // PERSONALIZATION — crops, soil, cycle history. It must not govern
      // jurisdiction: chat_service's chemical gate keys the state bans and the
      // fully-organic check off farm_profile.state, and with an empty profile
      // is_banned() skips STATE_LEVEL_BANS entirely. That put the exact scenario
      // the gate was built for — a Kerala farmer told to spray Chlorpyrifos,
      // which nothing but Kerala blocks — back within one toggle's reach. So the
      // ban key is always sent, and only the personal block is withheld.
      try {
        const { profile } = await buildEnrichedProfile(req.user.id);
        if (profile.state)    enrichedProfile.state    = profile.state;
        if (profile.district) enrichedProfile.district = profile.district;
      } catch (ctxErr) { logger.warn('[AI Chat] jurisdiction lookup failed (non-fatal): %s', ctxErr.message); }
    }

    // Inject user's preferred language into farm profile for AI response localisation
    if (language) enrichedProfile.language = language;

    // Admin-selected chat model (App Settings → ai.model.chat). Forwarded to
    // FastAPI as body.model; omitted if unresolved so FastAPI keeps its default.
    const chatModel = await getSetting('ai.model.chat').catch(() => undefined);

    const result = await callFastAPI('/ai/chat', {
      message:         (message || '').trim(),
      history,
      farm_profile:    enrichedProfile,
      response_length: respLen,
      mode:            'text',
      ...(chatModel ? { model: chatModel } : {}),
      ...(hasImage ? { image: { data: image.data, mime_type: image.mime_type || 'image/jpeg' } } : {}),
    }, req.user.id, 120_000, req.id);  // Indic chat models can be slow; output is capped server-side

    const { type, structured_data: structuredData, token_info: tokenInfo, followUps } = result;
    const { reply, safetyRefusal } =
      applySafetyRefusal(result, enrichedProfile.language || language, 'AI Chat', req.user.id);
    const tokens = tokenInfo?.total_tokens || 0;
    const model  = tokenInfo?.model || 'unknown';
    // settings.service.getBudgetSummary sums totalCostUsd/monthlyCostUsd. Chat
    // wrote only totalTokens, so the admin budget view saw scan spend and
    // nothing else. recordScanUsage() is the reference shape.
    const cost   = Number(tokenInfo?.cost_usd || 0);

    // ── SETTLE FIRST ─────────────────────────────────────────────────────────
    // The LLM call above already incurred real spend, so the DB persistence
    // below must be best-effort: a Prisma hiccup must NOT refund the hold (free
    // chat) nor cost the user the reply they paid for. Settle here; the catch's
    // refund now only covers pre-LLM failures (conversation lookup / the call).
    const featureType = hasImage ? 'ai_scan_gemini' : 'ai_chat_gemini';
    await settleCredits(req.user.id, featureType, {
      reserved: hold.reserved, holdId: hold.holdId, tokensUsed: tokens, model,
      description: `Chat: ${model}`, costUsd: tokenInfo?.cost_usd,
    });

    // ── Persist (best-effort) — log failures, still return the reply. ────────
    try {
      await prisma.aIMessage.createMany({
        data: [
          {
            conversationId: convo.id, role: 'user',
            content: (message || '').trim() || '[photo]',
            messageType: hasImage ? 'image' : 'text', language: farmProfile?.language || 'en',
          },
          {
            conversationId: convo.id, role: 'assistant', content: reply,
            messageType: type, structuredData: structuredData ?? undefined,
            language: farmProfile?.language || 'en',
            tokensUsed: tokens, modelUsed: model,
          },
        ],
      });
      await prisma.aIConversation.update({
        where: { id: convo.id },
        data:  { updatedAt: new Date(), messageCount: (convo.messageCount || 0) + 2 },
      });
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      prisma.aIUsage.upsert({
        where:  { userId_date: { userId: req.user.id, date: today } },
        create: { userId: req.user.id, date: today, chatCount: 1, totalTokens: tokens, totalCostUsd: cost,
                  monthlyTokens: tokens, monthlyCostUsd: cost },
        update: { chatCount: { increment: 1 },
                  totalTokens: { increment: tokens }, totalCostUsd: { increment: cost },
                  monthlyTokens: { increment: tokens }, monthlyCostUsd: { increment: cost } },
      }).catch(() => {});
    } catch (persistErr) {
      logger.warn('[AI Chat] persist failed (reply still returned to user): %s', persistErr.message);
    }

    return sendSuccess(res, {
      reply, type, card: structuredData ?? null, conversationId: convo.id,
      followUps: Array.isArray(followUps) ? followUps : [],
      tokenUsage: { totalTokens: tokens, model },
      ...(safetyRefusal ? { safetyRefusal: true } : {}),
    });

  } catch (err) {
    // LLM/processing failed → refund the hold so the user isn't charged.
    await releaseCredits(req.user.id, reserveFeature, { reserved: hold.reserved, holdId: hold.holdId });
    logger.error('[AI Chat] %s', err.message);
    if (err.status === 429)
      return sendError(res, 'AI is busy right now — please wait 30 seconds and try again.', 429);
    // FastAPI now maps Gemini overload to 503 and a pipeline timeout to 504.
    // postSignedJSON rethrows an aborted fetch as an Error with .status=504
    // (not name==='AbortError'), so branch on status.
    if (err.status === 503)
      return sendError(res, 'AI is busy right now — please try again in a moment.', 503);
    if (err.status === 504 || err.name === 'AbortError')
      return sendError(res, 'AI took too long to respond. Please try again.', 504);
    return sendError(res, 'AI service unavailable. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/soil-card-ocr
// Soil Health Card photo → FastAPI vision → structured 12-parameter JSON.
// The farmer reviews/edits the extracted values before saving (never auto-saved).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/soil-card-ocr', authenticate, requireFeature('ai_soil_ocr'), aiChatLimit, async (req, res) => {
  const { image } = req.body;

  const hasImage = !!(image && typeof image === 'object' && image.data);
  if (!hasImage) return sendError(res, 'image is required', 400);
  if (typeof image.mime_type === 'string' && !image.mime_type.startsWith('image/')) {
    return sendError(res, 'attached file must be an image', 400);
  }
  if (typeof image.data !== 'string' || image.data.length > 12_000_000) {
    return sendError(res, 'attached image is too large', 413);
  }

  // RESERVE atomically before the (pricier) vision call. checkCredits was a
  // plain read-then-return: two concurrent OCRs both read the same balance and
  // both passed. reserveCredits is the conditional decrement, so only one can.
  const hold = await reserveCredits(req.user.id, 'ai_soil_ocr');
  if (!hold.ok) {
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }

  try {
    const soilOcrModel = await getSetting('ai.model.soilOcr').catch(() => undefined);
    const result = await callFastAPI('/ai/soil-card-ocr', {
      image: { data: image.data, mime_type: image.mime_type || 'image/jpeg' },
      ...(soilOcrModel ? { model: soilOcrModel } : {}),
    }, req.user.id, 60_000);

    const tokens = result?.token_info?.total_tokens || 0;
    const model  = result?.token_info?.model || 'gemini';
    const cost   = Number(result?.token_info?.cost_usd || 0);

    // Track usage (non-blocking), then SETTLE the hold against actual tokens.
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    prisma.aIUsage.upsert({
      where:  { userId_date: { userId: req.user.id, date: today } },
      create: { userId: req.user.id, date: today, totalTokens: tokens, totalCostUsd: cost,
                monthlyTokens: tokens, monthlyCostUsd: cost },
      update: { totalTokens: { increment: tokens }, totalCostUsd: { increment: cost },
                monthlyTokens: { increment: tokens }, monthlyCostUsd: { increment: cost } },
    }).catch(() => {});
    const _ocrSettle = await settleCredits(req.user.id, 'ai_soil_ocr', {
      reserved: hold.reserved, holdId: hold.holdId, tokensUsed: tokens, model,
      description: 'Soil card OCR', costUsd: cost,
    });
    if (_ocrSettle?.error) logger.warn('[Soil OCR] credit settle failed for user=%s: %s', req.user.id, _ocrSettle.error);

    return sendSuccess(res, result);
  } catch (err) {
    // Vision call failed → refund the hold so the user isn't charged.
    await releaseCredits(req.user.id, 'ai_soil_ocr', { reserved: hold.reserved, holdId: hold.holdId }).catch(() => {});
    logger.error('[Soil OCR] %s', err.message);
    // postSignedJSON rethrows an aborted fetch as a plain Error with .status=504,
    // never name==='AbortError' — branch on status (same fix as /chat).
    if (err.status === 504 || err.name === 'AbortError')
      return sendError(res, 'Card reading timed out. Please try again or enter values manually.', 504);
    return sendError(res, 'Could not read the card. Please enter values manually.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/voice
// Sarvam STT → FastAPI /ai/chat → (opt) Sarvam TTS
// ─────────────────────────────────────────────────────────────────────────────
router.post('/voice', authenticate, requireFeature('ai_voice'), aiVoiceLimit, idempotency('voice'), audioUpload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) return sendError(res, 'audio file is required (field name: audio)', 400);

  const cleanUp = (p) => { try { fs.unlinkSync(p); } catch { /* ignore */ } };

  // Cooldown BEFORE the pipeline, matching /chat. The check used to sit after
  // Sarvam STT, so a double-tap paid for a transcription that was then thrown
  // away — and it answered 200 with the excuse in `reply`, which the voice screen
  // renders as an AI bubble ("Please wait 5s…" spoken back as advice). A 429 is
  // what the client's error mapper already understands.
  const wait = await checkCooldown(req.user.id);
  if (wait > 0) {
    cleanUp(file.path);
    return sendError(res, `Please wait ${wait}s before sending another message.`, 429);
  }

  // RESERVE credits atomically before the expensive STT/LLM pipeline (race-free).
  const hold = await reserveCredits(req.user.id, 'ai_voice');
  if (!hold.ok) {
    cleanUp(file.path);
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }

  try {
    const ext         = (file.originalname?.match(/\.(\w+)$/)?.[1] || 'm4a').toLowerCase();
    const renamedPath = `${file.path}.${ext}`;
    fs.renameSync(file.path, renamedPath);

    let transcription    = '';
    let detectedLanguage = req.body.language || null;

    // ── Sarvam STT (sole transcription provider) ─────────────────────────────
    // KrushiSarva uses Sarvam for Indic speech-to-text (Groq Whisper was dropped
    // in the Gemini consolidation). The chat reply is generated by Gemini and
    // spoken back via Sarvam TTS.
    if (!ENV.SARVAM_API_KEY) {
      cleanUp(renamedPath);
      await releaseCredits(req.user.id, 'ai_voice', { reserved: hold.reserved, holdId: hold.holdId });
      return sendError(res, 'Voice is temporarily unavailable. Please type your question instead.', 503);
    }
    // Admin-selected STT model (App Settings → ai.model.voiceStt), value form
    // '<provider>:<modelId>'. Only a sarvam:* model overrides the Sarvam call;
    // any other provider (e.g. openai:whisper-1, not yet implemented) safely
    // falls back to the Sarvam default with a warning so voice never breaks.
    let sttModel; // undefined → sarvamSTT default (saaras:v3)
    try {
      const sttSetting = String(await getSetting('ai.model.voiceStt') || '');
      const sepIdx = sttSetting.indexOf(':');
      const provider = sepIdx >= 0 ? sttSetting.slice(0, sepIdx) : sttSetting;
      const modelId  = sepIdx >= 0 ? sttSetting.slice(sepIdx + 1) : '';
      if (provider === 'sarvam' && modelId) sttModel = modelId;
      else if (provider && provider !== 'sarvam')
        logger.warn('[Voice] STT model "%s" not supported by the Sarvam path — using default', sttSetting);
    } catch { /* fall back to sarvamSTT default */ }

    let sttError = null;
    try {
      const audioBuffer = fs.readFileSync(renamedPath);
      const r = await sarvamSTT(audioBuffer, `audio.${ext}`, detectedLanguage, sttModel);
      transcription    = (r.transcript || '').trim();
      detectedLanguage = r.languageCode || detectedLanguage;
    } catch (e) {
      sttError = e;
      logger.warn('[Sarvam STT] failed: %s', e.message);
    }

    cleanUp(renamedPath);
    // Distinguish a SERVICE failure (Sarvam down/auth/5xx/breaker-open) from a
    // genuinely empty transcript. The former is a 503 "try again", not a
    // misleading 422 "speak more clearly" that blames the farmer.
    if (sttError) {
      await releaseCredits(req.user.id, 'ai_voice', { reserved: hold.reserved, holdId: hold.holdId });
      return sendError(res, 'Voice service is temporarily unavailable. Please try again in a moment.', 503);
    }
    if (!transcription) {
      await releaseCredits(req.user.id, 'ai_voice', { reserved: hold.reserved, holdId: hold.holdId });
      return sendError(res, 'Could not transcribe audio — please speak clearly and try again.', 422);
    }

    // ── Create/find voice conversation (separate from text chats) ────────────
    let farmProfile = {};
    try { farmProfile = JSON.parse(req.body.farmProfile || '{}'); } catch { /* ignore */ }
    const conversationId = req.body.conversationId || null;

    let convo;
    if (conversationId) {
      convo = await prisma.voiceConversation.findFirst({
        where: { id: conversationId, userId: req.user.id },
      });
    }
    if (!convo) {
      convo = await prisma.voiceConversation.create({
        data: {
          userId:   req.user.id,
          title:    transcription.slice(0, 60),
          language: detectedLanguage || 'hi-IN',
        },
      });
    }

    const history = await loadRecentHistory(prisma.voiceMessage, convo.id);

    // ── Enrich with farm context (same as /chat), cached per conversation ─────
    // convo.id already exists here, so turn 1 seeds the cache and turns 2+ skip
    // the multi-query rebuild. Work on a COPY so the per-turn language override
    // below never mutates the cached object.
    let enrichedProfile = {};
    const enrichKey = `${req.user.id}:${convo.id}`;
    const cachedProfile = getCachedEnrichedProfile(enrichKey);
    if (cachedProfile) {
      enrichedProfile = { ...cachedProfile };
    } else {
      try {
        const { profile } = await buildEnrichedProfile(req.user.id, farmProfile);
        enrichedProfile = profile;
        setCachedEnrichedProfile(enrichKey, profile);
      } catch (ctxErr) { logger.warn('[AI Voice] Farm context failed (non-fatal): %s', ctxErr.message); }
    }

    // Honour the user-selected chat language so the LLM replies in the same
    // tongue (matches the text /chat behaviour at line ~368). Falls back to
    // whatever Sarvam STT detected, then to 'en'. Always short-coded —
    // FastAPI / chat_service expects 'mr', not 'mr-IN'.
    const replyLang = (
      (req.body.language || '').split('-')[0].toLowerCase()
      || (detectedLanguage || '').split('-')[0].toLowerCase()
      || 'en'
    );
    if (replyLang) enrichedProfile.language = replyLang;

    // ── Proxy chat inference to FastAPI ───────────────────────────────────────
    // The dedicated voice screen requests TTS (tts=1) → concise, header-free
    // spoken reply. The inline mic inside text chat (no TTS) is just voice INPUT,
    // so it gets a normal text-style reply honouring the farmer's length setting.
    const speakReply = req.query.tts === '1' || req.body.tts === true || req.body.tts === 'true';
    const LENGTHS = ['short', 'medium', 'long', 'extra_long'];
    const voiceRespLen = speakReply
      ? 'short'
      : (LENGTHS.includes(req.body.responseLength) ? req.body.responseLength : 'short');
    // Cap the FastAPI call at 55s so the whole voice round-trip returns inside
    // the native client's ~60s OkHttp upload ceiling (was unbounded → default
    // 90s, so a slow reply aborted on-device after credits had settled). Voice
    // forces a SHORT, single-call reply, so 55s is ample headroom.
    const voiceChatModel = await getSetting('ai.model.chat').catch(() => undefined);

    // ── Streaming voice path (low-latency) ────────────────────────────────────
    // When the client opens a Socket.IO stream (passes streamId) and wants spoken
    // audio, generate + speak the reply sentence-by-sentence over the socket so
    // playback starts on sentence 1. We respond to the HTTP request immediately
    // (transcription + conversationId) and hand the credit hold to the background
    // pipeline, which settles/releases it. No streamId / no socket → falls through
    // to the one-shot path below (unchanged), so older clients keep working.
    const streamId = (req.body.streamId || '').toString().trim() || null;
    const io = req.app.get('io');
    if (streamId && speakReply && io) {
      sendSuccess(res, { transcription, detectedLanguage, conversationId: convo.id, streaming: true });
      runVoiceStreamPipeline({
        io, userId: req.user.id, streamId, convo, transcription, detectedLanguage,
        history, enrichedProfile, voiceRespLen, voiceChatModel, hold, requestId: req.id,
      }).catch((e) => logger.error('[AI Voice stream] pipeline crashed: %s', e.message));
      return;
    }

    const result = await callFastAPI('/ai/chat', {
      message:         transcription,
      history,
      farm_profile:    enrichedProfile,
      mode:            speakReply ? 'voice' : 'text',
      response_length: voiceRespLen,
      ...(voiceChatModel ? { model: voiceChatModel } : {}),
    }, req.user.id, 55_000, req.id);

    const { type, structured_data: structuredData, token_info: voiceTokenInfo, followUps } = result;
    const { reply, safetyRefusal } =
      applySafetyRefusal(result, detectedLanguage, 'AI Voice', req.user.id);
    const voiceTokens = voiceTokenInfo?.total_tokens || 0;
    const voiceModel  = voiceTokenInfo?.model || 'unknown';
    const voiceCost   = Number(voiceTokenInfo?.cost_usd || 0);   // getBudgetSummary sums this

    // ── Start TTS NOW, concurrently with persistence + settle ─────────────────
    // TTS (~1–2s) is the slowest remaining step and only needs `reply`. Running it
    // in parallel with the DB writes + credit settle (instead of after them) hides
    // ~100–300ms of serial DB latency under the synthesis, so time-to-audio ≈
    // max(TTS, persist+settle) instead of their sum.
    // The reply is ALREADY in the user's language (enrichedProfile.language was set
    // to replyLang above), so speak it directly — no re-translation. ttsPromise
    // swallows its own failure → null, so a missing clip is non-fatal and never
    // rejects the Promise.all below.
    const ttsPromise = (speakReply && ENV.SARVAM_API_KEY && reply)
      ? sarvamTTS(reply, detectedLanguage || 'hi-IN')
          .then((r) => ({ audio: r.audio, mimeType: r.mimeType }))
          .catch((e) => { logger.warn('[Sarvam TTS] failed (non-fatal): %s', e.message); return null; })
      : Promise.resolve(null);

    // Persist the turn, THEN settle the hold. Order is preserved (persist → settle)
    // so a DB failure still leaves the hold UNSETTLED and the outer catch refunds it
    // correctly — never a settle-then-release double-handling of the same hold.
    const persistAndSettle = (async () => {
      await prisma.voiceMessage.createMany({
        data: [
          { conversationId: convo.id, role: 'user',      content: transcription,
            language: detectedLanguage || 'hi-IN' },
          { conversationId: convo.id, role: 'assistant', content: reply,
            language: detectedLanguage || 'hi-IN', modelUsed: voiceModel },
        ],
      });
      await prisma.voiceConversation.update({
        where: { id: convo.id },
        data:  { updatedAt: new Date(), messageCount: { increment: 2 } },
      });
      // Track usage (fire-and-forget — never blocks billing or the response).
      const vToday = new Date(); vToday.setUTCHours(0, 0, 0, 0);
      prisma.aIUsage.upsert({
        where:  { userId_date: { userId: req.user.id, date: vToday } },
        create: { userId: req.user.id, date: vToday, chatCount: 1, totalTokens: voiceTokens, totalCostUsd: voiceCost,
                  monthlyTokens: voiceTokens, monthlyCostUsd: voiceCost },
        update: { chatCount: { increment: 1 },
                  totalTokens: { increment: voiceTokens }, totalCostUsd: { increment: voiceCost },
                  monthlyTokens: { increment: voiceTokens }, monthlyCostUsd: { increment: voiceCost } },
      }).catch(() => {});
      // SETTLE the hold against actual tokens (awaited).
      await settleCredits(req.user.id, 'ai_voice', {
        reserved: hold.reserved, holdId: hold.holdId, tokensUsed: voiceTokens, model: voiceModel,
        description: `Voice chat: ${voiceModel}`, costUsd: voiceTokenInfo?.cost_usd,
      });
    })();

    // Wait for both tracks. Only persist/settle can reject here (ttsPromise can't),
    // so a failure routes to the outer catch which releases the hold.
    const [audioData] = await Promise.all([ttsPromise, persistAndSettle]);

    return sendSuccess(res, {
      transcription, detectedLanguage, reply, type,
      card: structuredData ?? null, conversationId: convo.id,
      followUps: Array.isArray(followUps) ? followUps : [],
      ...(audioData ? { audio: audioData } : {}),
      ...(safetyRefusal ? { safetyRefusal: true } : {}),
    });

  } catch (err) {
    // Pipeline failed → refund the hold so the user isn't charged.
    await releaseCredits(req.user.id, 'ai_voice', { reserved: hold.reserved, holdId: hold.holdId });
    try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    logger.error('[AI Voice] %s', err.message);
    // postSignedJSON rethrows an aborted fetch as a plain Error with .status=504,
    // never name==='AbortError' — branch on status (same fix as /chat).
    if (err.status === 504 || err.name === 'AbortError') return sendError(res, 'AI response timed out.', 504);
    return sendError(res, 'Voice processing failed. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/tts
// ─────────────────────────────────────────────────────────────────────────────
router.post('/tts', authenticate, aiChatLimit, async (req, res) => {
  const { text, language = 'hi-IN' } = req.body;
  if (!text?.trim())    return sendError(res, 'text is required', 400);
  if (text.length > 1000) return sendError(res, 'text too long (max 1000 chars)', 400);
  if (!ENV.SARVAM_API_KEY) return sendError(res, 'TTS not configured — set SARVAM_API_KEY', 503);

  // Meter TTS (flat floor debit). Reserve atomically up-front and settle/release
  // so concurrent calls can't TOCTOU-overspend, and a Sarvam failure refunds.
  const hold = await reserveCredits(req.user.id, 'ai_tts');
  if (!hold.ok) {
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }

  try {
    const lang   = normaliseLangCode(language);
    const result = await sarvamTTS(text.trim(), lang);
    await settleCredits(req.user.id, 'ai_tts', { reserved: hold.reserved, holdId: hold.holdId, description: 'Text-to-speech (Sarvam)' });
    return sendSuccess(res, { audio: result.audio, mimeType: result.mimeType, language: lang });
  } catch (err) {
    await releaseCredits(req.user.id, 'ai_tts', { reserved: hold.reserved, holdId: hold.holdId });
    logger.error('[Sarvam TTS] %s', err.message);
    return sendError(res, 'Text-to-speech failed. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/translate
// ─────────────────────────────────────────────────────────────────────────────
router.post('/translate', authenticate, aiChatLimit, async (req, res) => {
  const { text, sourceLang = 'en-IN', targetLang = 'hi-IN' } = req.body;
  if (!text?.trim())    return sendError(res, 'text is required', 400);
  if (text.length > 2000) return sendError(res, 'text too long (max 2000 chars)', 400);
  if (!ENV.SARVAM_API_KEY) return sendError(res, 'Translation not configured — set SARVAM_API_KEY', 503);

  // Meter translation (flat floor debit) — atomic reserve/settle/release.
  const hold = await reserveCredits(req.user.id, 'ai_translate');
  if (!hold.ok) {
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }

  try {
    const src    = normaliseLangCode(sourceLang);
    const tgt    = normaliseLangCode(targetLang);
    const result = await sarvamTranslate(text.trim(), src, tgt);
    await settleCredits(req.user.id, 'ai_translate', { reserved: hold.reserved, holdId: hold.holdId, description: 'Translation (Sarvam)' });
    return sendSuccess(res, { translatedText: result.translatedText, sourceLang: src, targetLang: tgt });
  } catch (err) {
    await releaseCredits(req.user.id, 'ai_translate', { reserved: hold.reserved, holdId: hold.holdId });
    logger.error('[Sarvam Translate] %s', err.message);
    return sendError(res, 'Translation failed. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/conversations
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Message counts for a page of conversations, as Map(conversationId → count).
 *
 * Replaces `_count: { select: { messages: true } }`, which Prisma compiles to
 *
 *   LEFT JOIN (SELECT "conversationId", COUNT(*) FROM ai_messages
 *              WHERE 1=1 GROUP BY "conversationId") …
 *
 * — literally `WHERE 1=1`. The aggregate is not correlated to the page, so it
 * groups EVERY message on the platform and the join then discards the ones
 * belonging to other people. The cost is a function of total platform messages
 * rather than of the requesting user, so every farmer opening chat history pays
 * for every message anyone has ever sent.
 *
 * Measured on a 20k-conversation / 400k-message probe: GET /ai/conversations
 * took 134 ms and touched 29,369 shared buffers to return 4 rows; the same page
 * without `_count` took 0.059 ms. Scoping the aggregate to the page's ids makes
 * the cost proportional to the page. Same fix, same shape, as
 * unreadCountsByChat in animaltrade.routes.js.
 *
 * @param delegate prisma.aIMessage or prisma.voiceMessage
 */
async function messageCountsByConversation(delegate, ids) {
  if (!ids.length) return new Map();
  const rows = await delegate.groupBy({
    by: ['conversationId'],
    where: { conversationId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.conversationId, r._count._all]));
}

/**
 * Re-attach the counts in the shape the shipped clients already read.
 *
 * The `?? 0` is load-bearing: groupBy returns NO ROW for a conversation with
 * zero messages, where Prisma's `_count` emitted COALESCE(…, 0). Zero-message
 * conversations are reachable — message persistence is wrapped in try/catch and
 * is explicitly best-effort ("persist failed (reply still returned to user)").
 *
 * The `_count: { messages: n }` shape is deliberately preserved rather than
 * flattened. AIChatScreen reads `item._count?.messages` and VoiceHistoryScreen
 * reads the same; renaming it would make every row in the shipped app's history
 * list read "0 msgs" until users update.
 */
function withMessageCounts(rows, counts) {
  return rows.map((r) => ({ ...r, _count: { messages: counts.get(r.id) ?? 0 } }));
}

router.get('/conversations', authenticate, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const page  = parsePageNumber(req.query.page);

  // Text chats only. Filter out:
  //  - archived (soft-deleted) rows
  //  - scan sessions (those live in CropDiseaseReport, surfaced via ScanHistoryScreen)
  //  - legacy conversations that ever held a voice message (those now belong to
  //    VoiceConversation; the legacy rows stay in DB but are hidden here).
  const baseWhere = {
    userId: req.user.id,
    isArchived: false,
    isScanSession: false,
    messages: { none: { messageType: 'voice' } },
  };

  const [convos, total] = await Promise.all([
    prisma.aIConversation.findMany({
      where:   baseWhere,
      orderBy: { updatedAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, title: true, createdAt: true, updatedAt: true,
      },
    }),
    prisma.aIConversation.count({ where: baseWhere }),
  ]);

  const counts = await messageCountsByConversation(prisma.aIMessage, convos.map((c) => c.id));
  return sendSuccess(res, withMessageCounts(convos, counts), 200, { total, page, limit });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE CONVERSATIONS — separate from text chat history
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/v1/ai/voice/conversations
router.get('/voice/conversations', authenticate, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const page  = parsePageNumber(req.query.page);
  const where = { userId: req.user.id, isArchived: false };

  const [convos, total] = await Promise.all([
    prisma.voiceConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, title: true, language: true, messageCount: true,
        createdAt: true, updatedAt: true,
      },
    }),
    prisma.voiceConversation.count({ where }),
  ]);
  const counts = await messageCountsByConversation(prisma.voiceMessage, convos.map((c) => c.id));
  return sendSuccess(res, withMessageCounts(convos, counts), 200, { total, page, limit });
});

// GET /api/v1/ai/voice/conversations/:id
router.get('/voice/conversations/:id', authenticate, async (req, res) => {
  const convo = await prisma.voiceConversation.findFirst({
    where:   { id: req.params.id, userId: req.user.id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select:  {
          id: true, role: true, content: true,
          audioInputUrl: true, audioOutputUrl: true,
          language: true, createdAt: true,
        },
      },
    },
  });
  if (!convo) return sendError(res, 'Voice conversation not found', 404);
  return sendSuccess(res, convo);
});

// DELETE /api/v1/ai/voice/conversations/:id  — soft delete (archive)
router.delete('/voice/conversations/:id', authenticate, async (req, res) => {
  const convo = await prisma.voiceConversation.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!convo) return sendError(res, 'Voice conversation not found', 404);
  // archiveResource records a RESOURCE_ARCHIVE audit event (actor + timestamp).
  await archiveResource(req, 'VoiceConversation', convo.id);
  return sendSuccess(res, { archived: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/conversations/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/conversations/:id', authenticate, async (req, res) => {
  // DB-3: bound the nested messages so a very long thread can't return an
  // unbounded row set (memory/latency spike). Default to the most recent 100,
  // newest-first from the DB then reversed to chronological for the client.
  const msgLimit = Math.min(parseInt(req.query.messageLimit || '100', 10) || 100, 200);
  const convo = await prisma.aIConversation.findFirst({
    where:   { id: req.params.id, userId: req.user.id },
    include: {
      // Deliberately still `_count` here, unlike the three list routes above.
      //
      // Be precise about WHY, because the reason is not what it looks like.
      // This emits the identical uncorrelated `WHERE 1=1 GROUP BY` SQL the list
      // routes did. It is fast — measured 0.176 ms and 7 buffers, with the plan
      // showing `Index Cond: ("conversationId" = $1)` and Heap Fetches: 0 —
      // because the single-PK outer row lets Postgres push the qualifier into
      // the grouped subquery. That is a property of the chosen PLAN, not of the
      // query, and plan choice is not guaranteed stable as the table grows.
      //
      // Left alone under §73: there is no measured problem, and a groupBy here
      // would add a round trip to the hottest AI read to fix nothing. But if
      // this endpoint ever shows up slow, this is the first thing to check —
      // the SQL has always been the bad shape; only the planner was saving it.
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: msgLimit,
        select: {
          id: true, role: true, content: true,
          messageType: true, structuredData: true, createdAt: true,
        },
      },
    },
  });
  if (!convo) return sendError(res, 'Conversation not found', 404);
  convo.messages.reverse();  // back to chronological (oldest → newest)
  const totalMessages = convo._count?.messages ?? convo.messages.length;
  delete convo._count;
  return sendSuccess(res, { ...convo, totalMessages, messagesTruncated: totalMessages > convo.messages.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// Async-job scan path: POST /scan/submit returns jobId immediately, mobile
// polls GET /scan/job/:jobId. This is the working solution for the Android
// OkHttp 60s socket ceiling — long-running ensemble scans no longer drop
// the request mid-flight. The legacy synchronous POST /scan below stays
// for callers that don't need this (web upload, internal tooling).
// ─────────────────────────────────────────────────────────────────────────────

// Module-scope map: jobId -> { userId, farmCtx, weatherData, t0, hold, ... }.
// Holds the context the poll endpoint needs to flatten + persist when the
// FastAPI job completes. Cleared on success/failure or 30 min TTL sweep.
const pendingScans = new Map();

// ── Cross-process scan hold context ──────────────────────────────────────────
// pendingScans is a MODULE-SCOPE Map, so the credit hold /scan/submit reserves
// used to live on exactly one process. GET /scan/job/:jobId very often lands on
// a different replica (server.js mounts the Socket.IO Redis adapter and wraps the
// crons in withLeaderLock — this deployment is multi-instance), and there `ctx`
// is undefined, `hold` is null, and _persistDoneScan falls through to
// deductCredits. That charges a SECOND 3 credits while the original hold stays
// debited on the submitting process until a sweep no redeploy survives: 6
// credits out, 3 of them never reconciled. Before the hold existed, a lost
// context cost exactly one charge.
//
// So the part of the context that is MONEY is mirrored into Redis under the job
// id. farmCtx / weatherData / imageUrlsPromise stay in the Map on purpose — a
// live Promise cannot be serialised, and losing them only costs the Prisma
// persist, never a credit.
//
// Exactly-once handover is the whole point: settleCredits and releaseCredits both
// mutate the balance unconditionally (neither is idempotent), so two replicas
// must never both receive the same hold. The claim is therefore MULTI GET+DEL,
// which Redis executes atomically — the loser gets null and does nothing.
const SCAN_CTX_PREFIX   = 'scan_ctx:';
// The claim deadline the sweep enforces. Matches the pendingScans TTL above.
const SCAN_CTX_STALE_MS = 30 * 60_000;
// The KEY deliberately outlives that deadline, so the sweep still has a window in
// which to FIND an abandoned hold and refund it. A key that merely expired would
// leave the 3 credits debited with nothing left pointing at them.
const SCAN_CTX_TTL_SEC  = 45 * 60;
const _scanCtxKey = (jobId) => `${SCAN_CTX_PREFIX}${jobId}`;

async function saveScanHoldCtx(jobId, userId, hold) {
  if (!jobId || !hold?.ok || redis?.status !== 'ready') return false;
  try {
    await redis.set(
      _scanCtxKey(jobId),
      JSON.stringify({ userId, holdId: hold.holdId, reserved: hold.reserved, t0: Date.now() }),
      'EX', SCAN_CTX_TTL_SEC,
    );
    return true;
  } catch (e) {
    logger.warn('[Scan] hold ctx persist failed for job=%s: %s', jobId, e?.message);
    return false;
  }
}

/** Read WITHOUT claiming — used for the ownership pre-check and the sweep scan. */
async function peekScanHoldCtx(jobId) {
  if (!jobId || redis?.status !== 'ready') return null;
  try {
    const raw = await redis.get(_scanCtxKey(jobId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Atomically take ownership of a job's hold. Returns a `hold`-shaped object
 * ({ ok, reserved, holdId }) or null when there is nothing to claim.
 *
 * A non-owner's claim is put straight back rather than dropped: evicting it would
 * strand the real owner's 3 credits, which is the exact failure the ownership
 * check upstream exists to prevent.
 */
async function claimScanHoldCtx(jobId, userId) {
  if (!jobId || redis?.status !== 'ready') return null;
  let raw;
  try {
    const res = await redis.multi().get(_scanCtxKey(jobId)).del(_scanCtxKey(jobId)).exec();
    raw = res?.[0]?.[1];
  } catch (e) {
    logger.warn('[Scan] hold ctx claim failed for job=%s: %s', jobId, e?.message);
    return null;
  }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (userId && parsed.userId !== userId) {
    redis.set(_scanCtxKey(jobId), raw, 'EX', SCAN_CTX_TTL_SEC)
      .catch(e => logger.warn('[Scan] hold ctx restore failed for job=%s: %s', jobId, e?.message));
    return null;
  }
  return { ok: true, reserved: parsed.reserved, holdId: parsed.holdId, userId: parsed.userId };
}

/**
 * Refund holds whose job was never polled to completion (app killed, permanent
 * network loss). The in-process sweep below can only see holds THIS process still
 * owns, so the Redis-owned ones need their own pass. Leader-locked so N replicas
 * don't each SCAN the keyspace every 5 minutes.
 */
async function sweepAbandonedScanHolds() {
  if (redis?.status !== 'ready') return;
  await withLeaderLock('scan-hold-sweep', async () => {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${SCAN_CTX_PREFIX}*`, 'COUNT', 200);
      cursor = next;
      for (const key of keys) {
        const jobId = key.slice(SCAN_CTX_PREFIX.length);
        const peek = await peekScanHoldCtx(jobId);
        if (!peek || Date.now() - (peek.t0 || 0) < SCAN_CTX_STALE_MS) continue;
        const stale = await claimScanHoldCtx(jobId, peek.userId);
        if (!stale?.ok) continue;   // another poll claimed it between peek and claim
        await releaseCredits(peek.userId, 'ai_scan_gemini', { reserved: stale.reserved, holdId: stale.holdId })
          .catch(e => logger.warn('[Scan] abandoned hold release failed for job=%s: %s', jobId, e?.message));
        logger.info('[Scan] abandoned hold refunded (job=%s user=%s)', jobId, peek.userId);
      }
    } while (cursor !== '0');
  }, { ttlMs: 4 * 60_000 });
}

setInterval(() => {
  const cutoff = Date.now() - SCAN_CTX_STALE_MS;
  for (const [k, v] of pendingScans) {
    if ((v.t0 || 0) >= cutoff) continue;
    pendingScans.delete(k);
    // Only ever set when the Redis mirror failed at submit (see /scan/submit) —
    // otherwise Redis owns the hold and sweepAbandonedScanHolds refunds it.
    if (v.hold?.ok) {
      releaseCredits(v.userId, 'ai_scan_gemini', { reserved: v.hold.reserved, holdId: v.hold.holdId })
        .catch(e => logger.warn('[Scan] stale hold release failed: %s', e?.message));
    }
  }
  sweepAbandonedScanHolds().catch(e => logger.warn('[Scan] abandoned-hold sweep failed: %s', e?.message));
}, 5 * 60_000).unref?.();

// ── Scan form → FastAPI params normalisation ──────────────────────────────────
// The diagnose prompt renders `Affected Area: {affected_area_percent}%`, so a
// string, a label, or an out-of-range number puts garbage in front of the model.
// The client's `affectedArea` stays a translated human LABEL (flattenFastAPIDiagnosis
// reads it for affectedAreaEstimate) — this is the separate numeric field.
// An UNFILLED field must stay null, not become 0: Number(null) and Number('')
// are both 0, and "Affected Area: 0%" reads to the model as "no visible damage"
// on a photo the farmer took precisely because there is damage.
function _scanAffectedPercent(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// The two numeric CROP & FIELD fields, emitted ONLY when the farmer actually
// filled them in.
//
// disease_diagnosis_agent renders `Field Area: {params.get('farm_size_acres','?')}
// acres` and `Affected Area: {params.get('affected_area_percent','?')}%`, and a
// dict default fires only when the key is ABSENT. Sending an explicit null — which
// is what _scanAffectedPercent correctly returns for an unfilled band — therefore
// printed "Affected Area: None%" and "Field Area: None acres" to the model, not
// the intended "?". Nothing between here and the prompt strips nulls:
// routes/scan._sanitize_params only cleans the free-text keys.
function _scanNumericParams(farmCtx) {
  const pct  = _scanAffectedPercent(farmCtx.affectedAreaPercent);
  const acres = farmCtx.landSize || farmCtx.farmSizeAcres || null;
  return {
    ...(acres === null || acres === undefined || acres === '' ? {} : { farm_size_acres: acres }),
    ...(pct === null ? {} : { affected_area_percent: pct }),
  };
}

// Fast (cheap chain) vs Best (frontier chain). Anything the client sends that
// isn't exactly 'best' is coerced to the cheap chain — matching FastAPI's own
// normalize_tier — so a typo can never silently buy the expensive fan-out.
function _scanTier(v) {
  return String(v || '').trim().toLowerCase() === 'best' ? 'best' : 'fast';
}

// The scan form collects symptom CHIPS and a free-text note, and step-2
// validation accepts either. `additionalSymptoms || symptoms.join()` threw the
// chips away whenever the farmer also typed something — and this is the only
// symptom channel into the vision prompt. Join both.
function _scanSymptoms(farmCtx) {
  const chips = Array.isArray(farmCtx.symptoms) ? farmCtx.symptoms.filter(Boolean).join(', ') : '';
  return [chips, farmCtx.additionalSymptoms].filter(Boolean).join('. ');
}

// Branch on Content-Type so the same route accepts both shapes:
//   • application/json     → mobile multi-image path: { images: [{data, mime_type}], farmContext }
//                            (skip multer; the 50 MB JSON parser is mounted in app.js)
//   • multipart/form-data  → legacy single-image path used by web + older clients
// `idempotency('scan_submit')` (AI-04): a scan is the most expensive duplicate in
// the app — a second LLM pipeline run AND a second credit charge. The axios
// 401-refresh-and-replay and ordinary mobile retries make duplicate POSTs
// routine, and FastAPI's own body-hash fallback gets it wrong in BOTH
// directions: two deliberate scans of a byte-identical image collapse into one
// job, while a genuine retry of a re-compressed image does not dedupe at all.
// Keying on a client-generated operation id fixes both. Fails OPEN when the
// header is absent, so older installs behave exactly as before.
router.post('/scan/submit', authenticate, requireFeature('ai_scan'), aiScanLimit, idempotency('scan_submit'), (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (ct.startsWith('application/json')) return next();
  upload.single('image')(req, res, (err) => {
    if (err) return sendError(res, err.message || 'Image upload failed', 400);
    next();
  });
}, async (req, res) => {
  const isJson = String(req.headers['content-type'] || '').startsWith('application/json');
  const file   = isJson ? null : req.file;
  if (!isJson && !file) return sendError(res, 'image file is required — please attach a crop photo', 400);
  if (isJson && (!Array.isArray(req.body.images) || req.body.images.length === 0)) {
    return sendError(res, 'images array is required (1–5 base64-encoded images)', 400);
  }
  if (isJson && req.body.images.length > 5) {
    return sendError(res, 'too many images (max 5 per scan)', 400);
  }
  const t0 = Date.now();
  const cleanupFile = () => { if (file?.path) { try { fs.unlinkSync(file.path); } catch { /* ignore */ } } };

  // Same gates as the legacy /scan: rate-limit + credit + free-tier daily cap.
  if (req.user.role === 'FARMER') {
    try {
      const limitErr = await checkScanLimits(req.user.id);
      if (limitErr) {
        cleanupFile();
        return sendError(res, limitErr, 429);
      }
    } catch (e) { logger.warn('[AI Scan/submit] limit check failed (non-fatal): %s', e.message); }
  }
  // RESERVE atomically. checkCredits was a plain read-then-return, so two
  // concurrent submits with DIFFERENT form values both read the same balance and
  // both passed (the double-tap case is separately deduped by the job binding).
  // The hold travels with the job: _persistDoneScan settles it, the TTL sweep
  // above and every early return below release it.
  const hold = await reserveCredits(req.user.id, 'ai_scan_gemini');
  if (!hold.ok) {
    cleanupFile();
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }
  const releaseScanHold = () =>
    releaseCredits(req.user.id, 'ai_scan_gemini', { reserved: hold.reserved, holdId: hold.holdId })
      .catch(e => logger.warn('[AI Scan/submit] hold release failed: %s', e?.message));

  let farmCtx = {};
  try {
    farmCtx = isJson
      ? (req.body.farmContext || {})
      : JSON.parse(req.body.farmContext || '{}');
  } catch { /* ignore */ }

  // Weather is a NICE-TO-HAVE for the persisted report (FastAPI fetches its own
  // weather for the diagnosis independently), so cap it at 2.5s — a slow weather
  // upstream must not eat the native client's ~60s submit ceiling before we even
  // return the job id.
  const scanPincode = farmCtx.pincode || req.user?.pincode || '000000';
  const weatherData = await Promise.race([
    getWeatherData(scanPincode).catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 2_500)),
  ]);

  const lat = parseFloat(req.body.lat);
  const lon = parseFloat(req.body.lon);
  // Admin-selected scan models (App Settings → ai.model.diagnose / ai.model.treatment).
  // Carried inside params so they survive the enqueue→Celery→worker hop; FastAPI
  // honours them per-request and falls back to its own env/default when absent.
  const [modelDiagnose, modelTreatment, ensembleEnabled] = await Promise.all([
    getSetting('ai.model.diagnose').catch(() => undefined),
    getSetting('ai.model.treatment').catch(() => undefined),
    getSetting('ai.diagnose.ensemble').catch(() => undefined),
  ]);
  const fastapiParams = {
    crop_name:           farmCtx.cropName || 'Unknown',
    crop_growth_stage:   farmCtx.growthStage || (farmCtx.cropAge != null ? String(farmCtx.cropAge) : 'Unknown'),
    crop_variety:        farmCtx.variety || farmCtx.cropVariety || '',
    soil_type:           farmCtx.soilType || '',
    irrigation_system:   farmCtx.irrigationType || farmCtx.irrigation || '',
    previous_crop:       farmCtx.previousCrop || '',
    // OMITTED, never null: the diagnose prompt renders these with
    // `params.get(k, '?')`, and a dict default only fires when the key is
    // ABSENT — sending null puts the literal "Affected Area: None%" and
    // "Field Area: None acres" in front of the model. _scanAffectedPercent
    // returning null is exactly the "farmer left it blank" case.
    ..._scanNumericParams(farmCtx),
    symptom_description: _scanSymptoms(farmCtx),
    recent_pesticide_used: farmCtx.recentPesticideUsed || '',
    fertilizer_history:  farmCtx.fertilizerHistory || '',
    planting_date:       farmCtx.plantingDate || null,
    // Collected on step 2 of the scan form and previously dropped on the floor;
    // the diagnose prompt's CROP & FIELD block now renders all three (onset speed
    // and the seasonal window are what separate look-alike lesions).
    // `village` is deliberately NOT forwarded: state + district already drive
    // zone_for(), nothing downstream reads it, and params is persisted verbatim
    // by diagnosis_repo while security/pii._SENSITIVE_KEYS does not redact it —
    // so it would be PII widening the surface for no diagnostic gain.
    first_noticed:       farmCtx.firstNoticed || '',
    season:              farmCtx.season || '',
    month:               farmCtx.month || '',
    field_latitude:      Number.isFinite(lat) ? lat : null,
    field_longitude:     Number.isFinite(lon) ? lon : null,
    state:               farmCtx.state || '',
    district:            farmCtx.district || '',
    city:                farmCtx.city || '',
    // MyFarm crop-cycle history + report contact details (from the
    // "use my farm history" toggle on the scan screen). Free-form, optional.
    farm_history:        farmCtx.farmHistory || '',
    farmer_name:         farmCtx.farmerName || '',
    farmer_contact:      farmCtx.farmerContact || farmCtx.phone || '',
    farm_address:        farmCtx.farmAddress || '',
    language:            farmCtx.language || 'en',
    tier:                _scanTier(farmCtx.tier),
    ...(modelDiagnose  ? { model_diagnose: modelDiagnose }   : {}),
    ...(modelTreatment ? { model_treatment: modelTreatment } : {}),
    // Second-opinion ensemble toggle (App Settings → ai.diagnose.ensemble). Forwarded
    // per-scan so FastAPI's cascade gate honours the admin choice over its env default.
    ...(ensembleEnabled !== undefined ? { ensemble: ensembleEnabled } : {}),
  };

  try {
    const result = await submitFastAPIScan({
      // JSON path → pass images[] straight through; multipart path → filePath
      images:         isJson ? req.body.images : undefined,
      filePath:       isJson ? undefined : file.path,
      mimeType:       file?.mimetype || 'image/jpeg',
      viewType:       farmCtx.imageView || 'close_up',
      params:         fastapiParams,
      userId:         req.user.id,
      requestId:      req.id || undefined,
      idempotencyKey: req.headers['idempotency-key'] || undefined,
    });

    // Fire-and-forget Cloudinary uploads for the JSON multi-image path so
    // we can show the actual photos in the past-report viewer later. Runs
    // in parallel with the FastAPI pipeline; URLs are awaited (with a
    // bounded timeout) inside _persistDoneScan before the DB row is written.
    const imageUrlsPromise = isJson
      ? uploadScanImagesToCloudinary(req.body.images, req.user.id)
      : Promise.resolve([]);

    // Idempotent inline replay — pipeline was already done. Persist now,
    // return as if the client had polled once.
    if (result.status === 'done' && result.data) {
      cleanupFile();
      const flat = flattenFastAPIDiagnosis(result.data, farmCtx);
      // result.jobId is what lets the `scan_settled:${jobId}` claim inside
      // _persistDoneScan fire, so a replay can't re-charge; `hold` is settled or
      // released in there, never left dangling.
      const finalised = await _persistDoneScan({
        userId: req.user.id, farmCtx, weatherData, raw: result.data, flat, imageUrlsPromise,
        jobId: result.jobId, hold,
      });
      logger.info('[Express/Scan/submit] idempotent inline replay — user=%s elapsed=%dms', req.user.id, Date.now() - t0);
      return sendSuccess(res, { status: 'done', ...finalised });
    }

    // Mirror the hold to Redis so the poll can settle it from ANY replica; the
    // Map keeps it only when that write failed (Redis down), because two live
    // copies of one hold is how you settle and release the same ledger row.
    const ctxPersisted = await saveScanHoldCtx(result.jobId, req.user.id, hold);
    pendingScans.set(result.jobId, {
      userId: req.user.id, farmCtx, weatherData, t0, imageUrlsPromise,
      hold: ctxPersisted ? null : hold,
    });
    cleanupFile();
    logger.info('[Express/Scan/submit] enqueued jobId=%s user=%s images=%d',
      result.jobId, req.user.id, isJson ? req.body.images.length : 1);
    return sendSuccess(res, { status: 'queued', jobId: result.jobId });

  } catch (err) {
    cleanupFile();
    // Nothing was enqueued, so nothing will ever settle this hold.
    await releaseScanHold();
    logger.error({ err }, '[Express/Scan/submit] enqueue failed');
    const st = err.status || 500;
    const msg = st === 402 ? 'You’ve used all your AI credits for this month. They refill on the 1st.'
      : st === 429 ? 'Too many scans right now — please wait a moment and try again.'
      : st === 503 ? 'The diagnosis service is busy. Please try again in a moment.'
      : st === 504 ? 'The diagnosis service took too long. Please try again.'
      : 'Scan submission failed. Please try again.';
    return sendError(res, msg, st);
  }
});


router.get('/scan/job/:jobId', authenticate, async (req, res) => {
  const { jobId } = req.params;
  if (!jobId) return sendError(res, 'jobId required', 400);

  let snap;
  try {
    snap = await getFastAPIScanStatus({ jobId, userId: req.user.id, requestId: req.id });
  } catch (err) {
    logger.error({ err, jobId }, '[Express/Scan/job] status fetch failed');
    return sendError(res, 'Could not fetch scan status. Please try again.', err.status || 502);
  }

  // ── Ownership FIRST, before either terminal branch touches the context ──────
  // The `failed` branch used to `pendingScans.delete(jobId)` unconditionally and
  // only ownership-check the refund, so a stranger polling a known jobId evicted
  // the owner's context — and with it the only pointer to the owner's 3-credit
  // hold, which the sweep then never released. FastAPI's own IDOR guard fails
  // open when the job→owner mapping is gone (Redis outage), so this is the check
  // that has to hold.
  const ctx = pendingScans.get(jobId);
  if (ctx && ctx.userId !== req.user.id) {
    return sendError(res, 'Job not owned by this user', 403);
  }
  if (!ctx) {
    const peek = await peekScanHoldCtx(jobId);
    if (peek && peek.userId !== req.user.id) {
      return sendError(res, 'Job not owned by this user', 403);
    }
  }

  if (snap.status === 'queued' || snap.status === 'running') {
    return sendSuccess(res, { status: snap.status });
  }
  if (snap.status === 'failed') {
    pendingScans.delete(jobId);
    // The pipeline produced nothing — refund the hold /scan/submit reserved,
    // wherever it lives (Map when the Redis mirror failed, Redis otherwise).
    const failedHold = ctx?.hold?.ok ? ctx.hold : await claimScanHoldCtx(jobId, req.user.id);
    if (failedHold?.ok) {
      await releaseCredits(req.user.id, 'ai_scan_gemini', {
        reserved: failedHold.reserved, holdId: failedHold.holdId,
      }).catch(e => logger.warn('[Express/Scan/job] failed-job hold release: %s', e?.message));
    }
    return sendError(res, snap.error || `Job ${jobId} failed`, 500);
  }
  if (snap.status !== 'done' || !snap.data) {
    return sendError(res, `Unexpected job status: ${snap.status}`, 502);
  }

  // status === 'done': finalize.
  // Missing ctx means the submit was on a different process or server-restart
  // dropped it — we can still flatten the diagnosis but skip Prisma persist
  // (since farmCtx is gone). The mobile still gets the rich report, and the
  // Redis-mirrored hold still settles instead of being charged a second time.
  const farmCtx = ctx?.farmCtx || {};
  const weatherData = ctx?.weatherData || null;
  // Hand the hold over exactly ONCE. If _persistDoneScan throws before the
  // delete below, the TTL sweep must not refund a hold that was already settled.
  const scanHold = ctx?.hold?.ok ? ctx.hold : await claimScanHoldCtx(jobId, req.user.id);
  if (ctx) ctx.hold = null;
  const flat = flattenFastAPIDiagnosis(snap.data, farmCtx);
  const finalised = await _persistDoneScan({
    userId: req.user.id, farmCtx, weatherData, raw: snap.data, flat,
    imageUrlsPromise: ctx?.imageUrlsPromise,
    skipPersist: !ctx,
    jobId,
    hold: scanHold,
  });
  pendingScans.delete(jobId);
  return sendSuccess(res, { status: 'done', ...finalised });
});


// Shared finalizer for both inline-replay (in /scan/submit) and poll (in
// /scan/job/:jobId). Records usage, deducts credits, persists the
// CropDiseaseReport, strips _fullReport for the wire response, and returns
// the client-facing diagnosis dict.
async function _persistDoneScan({ userId, farmCtx, weatherData, raw, flat, imageUrlsPromise, skipPersist = false, jobId = null, hold = null }) {
  const releaseScanHold = () => (hold?.ok
    ? releaseCredits(userId, 'ai_scan_gemini', { reserved: hold.reserved, holdId: hold.holdId })
        .catch(e => logger.warn('[Scan] hold release failed: %s', e?.message))
    : Promise.resolve());

  // Non-results must NOT be charged or persisted: a "retake the photo"
  // (needs_rescan) ran no diagnosis LLM, and a service_unavailable is the
  // graceful response when Gemini 503'd — the farmer got no analysis, so
  // charging 3 credits for it is wrong. Still return the report so the UI can
  // show the retry/rescan message.
  //
  // The old test here was `raw?.needs_rescan === true`, a key the orchestrator
  // never emits — it emits `report_id: "needs_rescan"` — so the rescan branch
  // fell through and billed the 3-credit floor on zero token usage. Ask
  // scanNonResultKind, which is keyed off what FastAPI actually sends; `flat`
  // carries the same answer on to the client as `nonResult`.
  const isNonResult = scanNonResultKind(raw) !== null;
  if (isNonResult) {
    logger.info('[Scan] non-result (rescan/service-unavailable) — not charging or persisting (user=%s job=%s)', userId, jobId || '-');
    await releaseScanHold();
    const { _fullReport, ...diagnosisForClient } = flat;
    return { ...diagnosisForClient, _fullReport, reportId: null, weatherUsed: !!weatherData };
  }

  // Idempotent settlement (credit + DB safety): GET /scan/job/:jobId has no
  // idempotency middleware and FastAPI returns `done` for ~24h, so a duplicate
  // or concurrent poll (or the inline-replay racing a poll) would re-deduct
  // credits AND re-insert the report. Claim settlement atomically per jobId —
  // only the winner charges + persists. Redis down → fall through and settle
  // once (rare; a possible double-charge beats a silent free scan).
  if (jobId && redis?.status === 'ready') {
    try {
      const claimed = await redis.set(`scan_settled:${jobId}`, '1', 'EX', 86400, 'NX');
      if (!claimed) {
        logger.info('[Scan] job=%s already settled — returning report without re-charge/re-persist', jobId);
        // Someone else already charged this job; this request's hold must go back.
        await releaseScanHold();
        const { _fullReport, ...diagnosisForClient } = flat;
        return { ...diagnosisForClient, _fullReport, reportId: null, weatherUsed: !!weatherData, alreadySettled: true };
      }
    } catch (e) { logger.warn('[Scan] settle-claim failed (non-fatal): %s', e?.message); }
  }

  const tokenUsage = (() => { const u = extractFastAPIUsage(raw); return { total_tokens: u.tokens, total_cost_usd: u.costUsd }; })();
  recordScanUsage(userId, tokenUsage).catch(() => {});
  // Awaited so the credit charge is reliably recorded (was fire-and-forget — a
  // failed write silently gave a free scan). Both helpers handle their own
  // errors internally, so this never throws the scan away.
  //
  // SETTLE when /scan/submit reserved a hold for this job; DEDUCT when it did
  // not. A poll landing on another replica now still SETTLES — the hold is
  // mirrored to `scan_ctx:${jobId}` and claimed atomically by the caller — so the
  // deduct branch is left only for the case where Redis was down at BOTH submit
  // and poll, i.e. no hold was ever recoverable. The settle-claim above
  // guarantees exactly one of the two runs per jobId.
  const scanModel = raw?.meta?.model_diagnose || 'fastapi-agentic';
  const scanDesc  = `Crop scan: ${flat?.disease || 'analysis'}`;
  const _charge = hold?.ok
    ? await settleCredits(userId, 'ai_scan_gemini', {
        reserved: hold.reserved, holdId: hold.holdId, tokensUsed: tokenUsage.total_tokens,
        model: scanModel, description: scanDesc, costUsd: tokenUsage.total_cost_usd,
      })
    : await deductCredits(userId, 'ai_scan_gemini', {
        model: scanModel, tokensUsed: tokenUsage.total_tokens,
        description: scanDesc, costUsd: tokenUsage.total_cost_usd,
      });
  if (_charge?.error) logger.warn('[Scan] credit charge failed for user=%s: %s', userId, _charge.error);

  // Wait briefly for the parallel Cloudinary uploads to finish so the
  // report row carries the image URLs. Cap the wait so a slow CDN doesn't
  // block the user from seeing the diagnosis — empty array is acceptable.
  let imageUrls = [];
  if (imageUrlsPromise) {
    try {
      imageUrls = await Promise.race([
        imageUrlsPromise,
        new Promise(resolve => setTimeout(() => resolve([]), 10_000)),
      ]) || [];
    } catch (e) {
      logger.warn('[Cloudinary/scan] resolve failed: %s', e?.message);
    }
  }

  let savedReportId = null;
  if (!skipPersist) {
    try {
      const riskLevel = (raw?.risk_level || flat.severity || 'low').toUpperCase();
      const riskScore = riskLevel === 'CRITICAL' ? 95 : riskLevel === 'HIGH' ? 75
        : riskLevel === 'MODERATE' ? 45 : 15;
      const saved = await prisma.cropDiseaseReport.create({
        data: {
          userId,
          pincode:         farmCtx.pincode || '000000',
          cropType:        farmCtx.cropName || flat.crop || 'Unknown',
          growthStage:     farmCtx.cropAge != null ? String(farmCtx.cropAge) : 'unknown',
          variety:         farmCtx.variety || null,
          fieldArea:       farmCtx.landSize || null,
          symptoms:        Array.isArray(farmCtx.symptoms) ? farmCtx.symptoms : [],
          imageCount:      imageUrls.length || 1,
          imageUrls,
          overallRisk:     riskScore,
          riskLevel,
          primaryDisease:  flat.disease || 'Unknown',
          confidenceScore: (flat.confidence || 0) / 100,
          diagnosisMethod: 'fastapi-agentic',
          // Schema is Boolean — true when models agreed (perspective or
          // ensemble agreement reaches the "all agree" mark). The raw
          // string ("3/3", "2/3", etc.) is preserved inside fullReport
          // for anyone who wants the breakdown.
          modelAgreement:  (() => {
            const a = raw?.meta?.ensemble_agreement || raw?.meta?.perspective_agreement;
            if (typeof a !== 'string' || !a.includes('/')) return null;
            const [num, denom] = a.split('/').map(n => parseInt(n, 10));
            if (!denom) return null;
            return num === denom;  // unanimous => true; any dissent => false
          })(),
          fullReport:      raw,
          weatherSnapshot: weatherData || null,
        },
      });
      savedReportId = saved.id;
    } catch (e) {
      logger.warn('[AI Scan/job] CropDiseaseReport save failed: %s', e.message);
    }
  }

  // Strip the heavy nested fullReport from the WIRE payload, but the mobile
  // still gets it via diagnosis._fullReport (flattenFastAPIDiagnosis attaches
  // it). The split below mirrors what the legacy /scan route does.
  const { _fullReport, ...diagnosisForClient } = flat;
  return { ...diagnosisForClient, _fullReport, reportId: savedReportId, weatherUsed: !!weatherData };
}


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/scan  — proxy to FastAPI 5-agent pipeline, save to Prisma
// ─────────────────────────────────────────────────────────────────────────────
router.post('/scan', authenticate, requireFeature('ai_scan'), aiScanLimit, (req, res, next) => {
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

  // RESERVE atomically before the expensive Gemini vision call. checkCredits was
  // a plain read-then-return, so two concurrent scans with different form values
  // both read the same balance and both passed. Every early return below — and
  // the outer catch — must release this hold.
  const hold = await reserveCredits(req.user.id, 'ai_scan_gemini');
  if (!hold.ok) {
    try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }
  let scanSettled = false;
  const releaseScanHold = () =>
    releaseCredits(req.user.id, 'ai_scan_gemini', { reserved: hold.reserved, holdId: hold.holdId })
      .catch(e => logger.warn('[Express/Scan] hold release failed: %s', e?.message));

  // ── Deduplication: if a scan is already in-flight for this user, reuse it ──
  // The in-flight scan owns its own hold and will settle it; this request's hold
  // buys nothing, so give it back before returning the shared result.
  if (inflightScans.has(req.user.id)) {
    logger.debug('[Express/Scan] Dedup — reusing in-flight scan for user=%s', req.user.id);
    try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
    await releaseScanHold();
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

    // ── BRANCH: FastAPI agentic pipeline vs in-Express Gemini ───────────────
    // Toggle via the ai.useFastapiForScan App Setting (admin panel, no redeploy),
    // which falls back to the USE_FASTAPI_FOR_SCAN env var via its manifest
    // envKey — so existing deploys keep their current behaviour until an admin
    // overrides it. The FastAPI path runs the full
    // agentic pipeline (image-quality CV, weather correlation, vision
    // diagnosis with router fallback, chemical-registry-validated treatment,
    // confidence-gated chemicals, structured report). Both paths produce
    // the SAME flat shape, so the mobile client is identical.
    let rawDiagnosis;
    let diagnosis;
    let diagnosisMethod;
    let needsRescan = false;
    let tokenUsage  = { total_tokens: 0, total_cost_usd: 0 };

    const useFastapiScan = await getSetting('ai.useFastapiForScan').catch(() => ENV.USE_FASTAPI_FOR_SCAN);
    if (useFastapiScan === true || useFastapiScan === 'true') {
      diagnosisMethod = 'fastapi-agentic';
      // Translate the existing Node-side params shape into the FastAPI
      // shape (snake_case keys that orchestrator.run_diagnosis expects).
      const [modelDiagnose, modelTreatment, ensembleEnabled] = await Promise.all([
        getSetting('ai.model.diagnose').catch(() => undefined),
        getSetting('ai.model.treatment').catch(() => undefined),
        getSetting('ai.diagnose.ensemble').catch(() => undefined),
      ]);
      const fastapiParams = {
        crop_name:           farmCtx.cropName || 'Unknown',
        crop_growth_stage:   farmCtx.growthStage || (farmCtx.cropAge != null ? String(farmCtx.cropAge) : 'Unknown'),
        crop_variety:        farmCtx.variety || farmCtx.cropVariety || '',
        soil_type:           farmCtx.soilType || '',
        irrigation_system:   farmCtx.irrigationType || farmCtx.irrigation || '',
        previous_crop:       farmCtx.previousCrop || '',
        // See the /scan/submit builder: omitted rather than null, so the prompt's
        // `params.get(k, '?')` default is the one that renders.
        ..._scanNumericParams(farmCtx),
        symptom_description: _scanSymptoms(farmCtx),
        recent_pesticide_used: farmCtx.recentPesticideUsed || '',
        fertilizer_history:  farmCtx.fertilizerHistory || '',
        planting_date:       farmCtx.plantingDate || null,
        // See the /scan/submit builder — same three fields, same reason `village`
        // is absent.
        first_noticed:       farmCtx.firstNoticed || '',
        season:              farmCtx.season || '',
        month:               farmCtx.month || '',
        field_latitude:      Number.isFinite(lat) ? lat : null,
        field_longitude:     Number.isFinite(lon) ? lon : null,
        state:               farmCtx.state || '',
        district:            farmCtx.district || '',
        city:                farmCtx.city || '',
        language:            farmCtx.language || 'en',
        // Farmer-chosen quality tier — Fast (default) or Best. The
        // CropScanScreen sends this via farmContext; AsyncStorage persists
        // the last choice. FastAPI maps it to per-stage model chains.
        tier:                _scanTier(farmCtx.tier),
        ...(modelDiagnose  ? { model_diagnose: modelDiagnose }   : {}),
        ...(modelTreatment ? { model_treatment: modelTreatment } : {}),
        ...(ensembleEnabled !== undefined ? { ensemble: ensembleEnabled } : {}),
      };

      try {
        rawDiagnosis = await callFastAPIScan({
          filePath:       file.path,
          mimeType,
          viewType:       farmCtx.imageView || 'close_up',
          params:         fastapiParams,
          userId:         req.user.id,
          requestId:      req.id || undefined,
          idempotencyKey: req.headers['idempotency-key'] || undefined,
        });
      } finally {
        // Clean up the multer temp file regardless of success — the bytes
        // already live in the FastAPI request body.
        try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      }

      logger.info(
        '[Express/Scan] FastAPI done in %dms — disease=%s conf=%s tier=%s tokens=%d cost=$%s',
        Date.now() - t0,
        rawDiagnosis?.disease?.name_common,
        rawDiagnosis?.confidence_score,
        rawDiagnosis?.meta?.tier,
        rawDiagnosis?.meta?.pipeline_token_usage?.total_tokens || 0,
        rawDiagnosis?.meta?.pipeline_token_usage?.total_cost_usd || 0,
      );

      tokenUsage = (() => {
        const u = extractFastAPIUsage(rawDiagnosis);
        return { total_tokens: u.tokens, total_cost_usd: u.costUsd };
      })();

      diagnosis = flattenFastAPIDiagnosis(rawDiagnosis, farmCtx);
      needsRescan = diagnosis.needsRescan === true;
    } else {
      // ── Legacy path: in-Express Gemini call. Identical to previous
      // behaviour; kept so USE_FASTAPI_FOR_SCAN=false rolls back cleanly. ─
      diagnosisMethod = 'gemini-direct';
      rawDiagnosis = await predictCropDisease(params, [
        { path: file.path, type: farmCtx.imageView || 'close_up' },
      ]);
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      logger.info('[Express/Scan] Gemini done in %dms — disease=%s conf=%s risk=%s',
        Date.now() - t0,
        rawDiagnosis?.primary_disease?.name,
        rawDiagnosis?.confidence_score,
        rawDiagnosis?.risk_level,
      );
      const scanTokens = rawDiagnosis?.meta?.tokens_used || 0;
      tokenUsage = { total_tokens: scanTokens, total_cost_usd: 0 };
      diagnosis = flattenNodePrediction(rawDiagnosis, farmCtx);
      needsRescan = rawDiagnosis?.needs_rescan === true;
    }

    // ── Record usage + settle credits — usage is analytics (non-blocking),
    //    the credit charge is AWAITED so spend is never silently lost. ──
    //    A needs_rescan ("retake photo") or service_unavailable (Gemini 503)
    //    ran no real diagnosis, so it must NOT be charged. ──
    recordScanUsage(req.user.id, tokenUsage).catch(() => {});
    // scanNonResultKind reads the FastAPI envelope (report_id / service_unavailable);
    // `needsRescan` additionally covers the legacy in-Express Gemini path, whose
    // predictor emits a top-level `needs_rescan: true` instead of a report_id.
    const _scanNonResult = scanNonResultKind(rawDiagnosis) !== null || needsRescan;
    if (!_scanNonResult) {
      const _scanSettle = await settleCredits(req.user.id, 'ai_scan_gemini', {
        reserved: hold.reserved, holdId: hold.holdId,
        model: diagnosisMethod === 'fastapi-agentic'
          ? (rawDiagnosis?.meta?.model_diagnose || 'fastapi-agentic')
          : 'gemini-2.5-flash',
        tokensUsed: tokenUsage.total_tokens,
        costUsd: tokenUsage.total_cost_usd,
        description: `Crop scan: ${diagnosis?.disease || 'analysis'}`,
      });
      scanSettled = true;
      if (_scanSettle?.error) logger.warn('[Scan] credit settle failed for user=%s: %s', req.user.id, _scanSettle.error);
    }

    logger.debug('[Express/Scan] disease=%s conf=%s severity=%s treatments=%d',
      diagnosis.disease, diagnosis.confidence, diagnosis.severity, diagnosis.treatment?.length);

    if (_scanNonResult) {
      logger.info('[Express/Scan] non-result (rescan/service-unavailable) — not charging or persisting');
      // This used to persist a CropDiseaseReport "so the farmer can share it with
      // a Krushi Kendra seller" — but a non-result has no diagnosis to share: it
      // wrote a junk "Needs rescan" row into Scan History at 0% confidence and
      // handed back a reportId that made the failure look like a real report.
      // Return it unpersisted; `diagnosis.nonResult` tells the client to show the
      // retake/retry affordance instead of navigating to the report screen.
      await releaseScanHold();
      scanSettled = true;   // hold finalised (refunded) — the outer catch must not refund again
      return { ...diagnosis, sessionId: null, reportId: null, weatherUsed: false };
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
            diagnosisMethod,
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
    // Refund unless the promise already finalised the hold (settle or non-result
    // release) — double-handling one hold would mint the user free credits.
    if (!scanSettled) await releaseScanHold();
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

    return sendError(res, 'Scan failed. Please try again.', 500);
  } finally {
    inflightScans.delete(req.user.id);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/ai/scan/:sessionId/chat  — follow-up Q&A on a scan
// ─────────────────────────────────────────────────────────────────────────────
router.post('/scan/:sessionId/chat', authenticate, requireFeature('ai_chat'), aiChatLimit, async (req, res) => {
  const { message } = req.body;
  if (!message?.trim())      return sendError(res, 'message is required', 400);
  if (message.length > 1000) return sendError(res, 'message too long (max 1000 chars)', 400);

  const wait = await checkCooldown(req.user.id);
  if (wait > 0) return sendError(res, `Please wait ${wait}s before sending another message.`, 429);

  // Meter the follow-up: this forwards to the LLM exactly like /ai/chat, so it
  // must reserve + settle credits (previously it was unmetered — free token burn).
  const hold = await reserveCredits(req.user.id, 'ai_chat_gemini');
  if (!hold.ok) {
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }

  try {
    // Authorization: look the session up by id ALONE first so we can tell
    // "doesn't exist" (404) apart from "exists but isn't yours" (403). Scoping
    // the query to userId would hide the IDOR behind a 404; the ownership
    // check below must run before we forward the message to FastAPI.
    const convo = await prisma.aIConversation.findFirst({
      where:  { id: req.params.sessionId, isScanSession: true },
      select: { id: true, userId: true, language: true, messageCount: true },
    });
    if (!convo) { await releaseCredits(req.user.id, 'ai_chat_gemini', { reserved: hold.reserved, holdId: hold.holdId }); return sendError(res, 'Scan session not found', 404); }
    if (convo.userId !== req.user.id) {
      await releaseCredits(req.user.id, 'ai_chat_gemini', { reserved: hold.reserved, holdId: hold.holdId });
      return sendError(res, 'You do not have access to this scan session', 403);
    }

    const history = await loadRecentHistory(prisma.aIMessage, convo.id);

    const report = await prisma.cropDiseaseReport.findFirst({
      where:  { conversationId: convo.id },
      select: { cropType: true, growthStage: true },
    });

    // The chat safety gate keys jurisdiction off `farm_profile.state` (state
    // pesticide bans, fully-organic states). This route sent only crops +
    // language, so a Kerala farmer asking a follow-up about his scan was
    // evaluated with no jurisdiction at all — the one scan-adjacent surface
    // where the FastAPI safety package could not see where he farms.
    // Reuse the per-conversation enriched-profile cache so turns 2+ skip the
    // multi-query rebuild.
    let farmerState = null, farmerDistrict = null;
    try {
      const enrichKey = `${req.user.id}:${convo.id}`;
      let cached = getCachedEnrichedProfile(enrichKey);
      if (!cached) {
        const { profile } = await buildEnrichedProfile(req.user.id);
        cached = profile || {};
        setCachedEnrichedProfile(enrichKey, cached);
      }
      farmerState    = cached.state    || null;
      farmerDistrict = cached.district || null;
    } catch (ctxErr) {
      logger.warn('[Scan Chat] state lookup failed (non-fatal): %s', ctxErr.message);
    }

    const farmProfile = {
      crops: report ? [{ name: report.cropType, ageInDays: parseInt(report.growthStage) || null }] : [],
      language: convo.language || 'en',
      ...(farmerState    ? { state:    farmerState }    : {}),
      ...(farmerDistrict ? { district: farmerDistrict } : {}),
    };

    const followupChatModel = await getSetting('ai.model.chat').catch(() => undefined);
    const result = await callFastAPI('/ai/chat', {
      message:      message.trim(),
      history,
      farm_profile: farmProfile,
      ...(followupChatModel ? { model: followupChatModel } : {}),
    }, req.user.id);

    const { type, structured_data: structuredData, token_info: tokenInfo } = result;
    const { reply, safetyRefusal } =
      applySafetyRefusal(result, farmProfile.language, 'Scan Chat', req.user.id);
    const tokens = tokenInfo?.total_tokens || 0;
    const followupCost = Number(tokenInfo?.cost_usd || 0);

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

    // This path settled credits but wrote no AIUsage row at all, so scan
    // follow-ups were invisible to both the daily-limit check and
    // getBudgetSummary. Mirror recordScanUsage's column set.
    const fToday = new Date(); fToday.setUTCHours(0, 0, 0, 0);
    prisma.aIUsage.upsert({
      where:  { userId_date: { userId: req.user.id, date: fToday } },
      create: { userId: req.user.id, date: fToday, chatCount: 1, totalTokens: tokens, totalCostUsd: followupCost,
                monthlyTokens: tokens, monthlyCostUsd: followupCost },
      update: { chatCount: { increment: 1 },
                totalTokens: { increment: tokens }, totalCostUsd: { increment: followupCost },
                monthlyTokens: { increment: tokens }, monthlyCostUsd: { increment: followupCost } },
    }).catch(() => {});

    // Settle the hold against actual tokens (awaited — spend is never lost).
    await settleCredits(req.user.id, 'ai_chat_gemini', {
      reserved: hold.reserved, holdId: hold.holdId, tokensUsed: tokens,
      model: tokenInfo?.model, description: 'Scan follow-up chat', costUsd: tokenInfo?.cost_usd,
    });

    return sendSuccess(res, {
      reply, type, card: structuredData ?? null, sessionId: convo.id,
      ...(safetyRefusal ? { safetyRefusal: true } : {}),
    });
  } catch (err) {
    // Refund the hold — the user shouldn't pay for a failed request.
    await releaseCredits(req.user.id, 'ai_chat_gemini', { reserved: hold.reserved, holdId: hold.holdId });
    logger.error('[Scan Chat] %s', err.message);
    return sendError(res, 'Failed to process your question. Please try again.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/scan/sessions
// ─────────────────────────────────────────────────────────────────────────────
router.get('/scan/sessions', authenticate, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const page  = parsePageNumber(req.query.page);

  const [sessions, total] = await Promise.all([
    prisma.aIConversation.findMany({
      where:   { userId: req.user.id, isScanSession: true, isArchived: false },
      orderBy: { updatedAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, title: true, createdAt: true, updatedAt: true,
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

  const counts = await messageCountsByConversation(prisma.aIMessage, sessions.map((c) => c.id));
  return sendSuccess(res, withMessageCounts(sessions, counts), 200, { total, page, limit });
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
router.post('/alerts', authenticate, requireFeature('ai_alerts'), aiChatLimit, async (req, res) => {
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

  // This route invoked an LLM with no rate limiter and no ledger interaction at
  // all. Reserve/settle it like every other AI route (see the §6 checklist:
  // "no new LLM endpoint without a ledger interaction").
  const hold = await reserveCredits(req.user.id, 'ai_chat_gemini');
  if (!hold.ok) {
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }

  try {
    // NESTING: routes/alerts.py reads `body["farm_profile"]`, and Express sent the
    // context as the raw body — so farm_profile was always {} and alert_service
    // fell back to every hardcoded default (Tomato / Maharashtra / Nashik / day
    // 45 / Drip / Black) for every farmer in the country.
    const payload = await callFastAPI('/ai/alerts', { farm_profile: farmContext }, req.user.id, 30_000);
    // ENVELOPE: the response is `{ alerts: [...] }`, an object — so the old
    // `alerts?.length` test was always falsy and the 30-min cache never
    // populated, re-billing a full LLM call on every request.
    const alerts = Array.isArray(payload?.alerts) ? payload.alerts
                 : Array.isArray(payload)         ? payload
                 : [];
    // generate_smart_alerts returns [] for a model failure, a parse miss AND a
    // fully-malformed batch, and this route has no token_info to settle against.
    // An empty batch is a blank dashboard, so refund rather than charge the floor
    // for it — same rule the scan non-result branch applies.
    if (alerts.length) {
      alertCacheSet(req.user.id, alerts);
      await settleCredits(req.user.id, 'ai_chat_gemini', {
        reserved: hold.reserved, holdId: hold.holdId,
        description: 'Smart alerts',
      });
    } else {
      await releaseCredits(req.user.id, 'ai_chat_gemini', { reserved: hold.reserved, holdId: hold.holdId }).catch(() => {});
      logger.info('[AI Alerts] empty batch — hold refunded (user=%s)', req.user.id);
    }
    return sendSuccess(res, alerts);
  } catch (err) {
    await releaseCredits(req.user.id, 'ai_chat_gemini', { reserved: hold.reserved, holdId: hold.holdId }).catch(() => {});
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
  const [usage, creditSummary, scanDaily, chatDaily, tokensDaily] = await Promise.all([
    getTodayUsage(req.user.id),
    getCreditSummary(req.user.id).catch(() => null),
    getSetting('ai.freeScanDailyLimit').then(v => Number(v) || FREE_SCAN_DAILY_LIMIT).catch(() => FREE_SCAN_DAILY_LIMIT),
    getSetting('ai.freeChatDailyLimit').then(v => Number(v) || FREE_CHAT_DAILY_LIMIT).catch(() => FREE_CHAT_DAILY_LIMIT),
    getSetting('ai.freeTokenDailyLimit').then(v => Number(v) || FREE_TOKEN_DAILY_LIMIT).catch(() => FREE_TOKEN_DAILY_LIMIT),
  ]);
  return sendSuccess(res, {
    scanCount:         usage?.scanCount       ?? 0,
    chatCount:         usage?.chatCount       ?? 0,
    totalTokens:       usage?.totalTokens     ?? 0,
    totalCostUsd:      usage?.totalCostUsd    ?? 0,
    monthlyTokens:     usage?.monthlyTokens   ?? 0,
    monthlyCostUsd:    usage?.monthlyCostUsd  ?? 0,
    limits: {
      scanDaily,
      chatDaily,
      tokensDaily,
    },
    scansRemaining: Math.max(0, scanDaily - (usage?.scanCount ?? 0)),
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

  // archiveResource records a RESOURCE_ARCHIVE audit event (actor + timestamp).
  await archiveResource(req, 'AIConversation', convo.id);
  return sendSuccess(res, { archived: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/ai/credits — User's AI credit balance & history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/credits', authenticate, async (req, res) => {
  try {
    const summary = await getCreditSummary(req.user.id);
    return sendSuccess(res, summary);
  } catch (err) {
    logger.error('[Credits] %s', err.message);
    return sendError(res, 'Failed to fetch credit info', 500);
  }
});

export default router;
