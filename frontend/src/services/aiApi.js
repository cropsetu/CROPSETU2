/**
 * FarmMind AI API Client
 * All AI, market, and planner endpoints hit the same Express backend (port 3001).
 * Auth token is injected automatically via the existing api.js interceptors.
 */
import api, { getAccessToken } from './api';
import { compressImage } from '../utils/mediaCompressor';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '../constants/config';

// One key per *send action* (NOT per HTTP attempt) so a 401-replay / network
// retry reuses it and the server returns the cached response instead of
// re-calling the LLM + re-charging credits. See backend middleware/idempotency.js.
function newIdemKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a message to FarmMind AI.
 * @param {string} message
 * @param {string|null} conversationId  Pass null to start a new conversation.
 * @param {object} farmProfile  Farm context to personalise the AI response.
 * @param {boolean} includeFarmContext
 * @param {string} language
 * @param {string} responseLength  'short' | 'medium' | 'long' | 'extra_long'
 * @param {{data:string, mime_type:string}|null} image  Optional attached photo
 *        (compressed base64) → conversational disease diagnosis.
 * @returns {{ reply, type, card, followUps, conversationId }}
 */
export async function sendChatMessage(
  message,
  conversationId = null,
  farmProfile = {},
  includeFarmContext = true,
  language = 'en',
  responseLength = 'short',
  image = null,
) {
  const { data } = await api.post(
    '/ai/chat',
    { message, conversationId, farmProfile, includeFarmContext, language, responseLength, image },
    { headers: { 'Idempotency-Key': newIdemKey() } },
  );
  return data.data; // { reply, type, card, followUps, conversationId }
}

/**
 * List all conversations for the current user.
 */
export async function getConversations() {
  const { data } = await api.get('/ai/conversations');
  return data.data || [];
}

/**
 * Get full message history for a conversation.
 * @param {string} conversationId
 */
export async function getConversationMessages(conversationId) {
  const { data } = await api.get(`/ai/conversations/${conversationId}`);
  return data.data || { messages: [] };
}

/**
 * Soft-delete (archive) a conversation. Backend flips isArchived=true so the
 * item disappears from the sidebar list but underlying messages are preserved.
 */
export async function deleteConversation(conversationId) {
  const { data } = await api.delete(`/ai/conversations/${conversationId}`);
  return data.data || { archived: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE CONVERSATIONS — separate history from text chat
// ─────────────────────────────────────────────────────────────────────────────

export async function getVoiceConversations() {
  const { data } = await api.get('/ai/voice/conversations');
  return data.data || [];
}

export async function getVoiceConversationDetail(conversationId) {
  const { data } = await api.get(`/ai/voice/conversations/${conversationId}`);
  return data.data || { messages: [] };
}

export async function deleteVoiceConversation(conversationId) {
  const { data } = await api.delete(`/ai/voice/conversations/${conversationId}`);
  return data.data || { archived: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// CROP SCAN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a crop image for AI disease diagnosis.
 * @param {string} imageUri    Local file URI from ImagePicker / Camera
 * @param {object} farmContext All farm context (crop, age, symptoms, soil, etc.)
 * @returns {Object} diagnosis result
 */
// Normalize MIME types so multer always accepts the image.
// HEIC/HEIF from iOS cameras are re-encoded to JPEG on upload.
const MIME_NORMALIZE = {
  'image/heic':   'image/jpeg',
  'image/heif':   'image/jpeg',
  'image/HEIC':   'image/jpeg',
  'image/HEIF':   'image/jpeg',
  'image/jpg':    'image/jpeg',
  'image/JPG':    'image/jpeg',
  'image/JPEG':   'image/jpeg',
};

/**
 * Submit one OR more crop images for AI disease diagnosis.
 *
 * Accepts either a single URI string (legacy callers) or an array of up to
 * 5 URIs (new multi-image callers). Each image is compressed + base64-
 * encoded and posted as JSON to Express, which forwards the array straight
 * through to FastAPI's /ai/scan endpoint (already accepts a list).
 *
 * @param {string|string[]} imageUris   Local file URI(s) from ImagePicker / Camera
 * @param {object}          farmContext All farm context (crop, age, symptoms, soil, etc.)
 * @param {string|string[]|null} mimeTypes  Optional MIME type(s) matching imageUris
 * @returns {Object} diagnosis result (after polling the worker to completion)
 */
export async function scanCropImage(imageUris, farmContext = {}, mimeTypes = null) {
  // ── Normalize to arrays (back-compat: a single string URI still works) ──
  const uris  = Array.isArray(imageUris) ? imageUris : (imageUris ? [imageUris] : []);
  const mimes = Array.isArray(mimeTypes) ? mimeTypes : (mimeTypes ? [mimeTypes] : []);
  if (uris.length === 0) throw new Error('scanCropImage: at least one image is required');
  if (uris.length > 5)   throw new Error('scanCropImage: max 5 images per scan');

  // ── Compress + base64-encode each image. ImageManipulator handles HEIC,
  //    content:// URIs, etc., and emits JPEG. Posting JSON (not multipart)
  //    sidesteps the Android OkHttp file:// + multi-file limitation that
  //    forced the FileSystem.uploadAsync workaround for single uploads.
  //    Same quality preset for every image regardless of count — the user
  //    explicitly wants full resolution preserved even on 5-image scans.
  const images = [];
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];
    try {
      const compressed = await compressImage(uri, { needBase64: true });
      const base64 = compressed?.base64
        || await FileSystem.readAsStringAsync(compressed?.uri || uri, { encoding: FileSystem.EncodingType.Base64 });
      const rawMime = mimes[i] || 'image/jpeg';
      const mime    = MIME_NORMALIZE[rawMime] || 'image/jpeg';
      images.push({ data: base64, mime_type: mime });
    } catch (e) {
      if (__DEV__) console.warn('[scanCropImage] failed to encode image', i, e?.message);
    }
  }
  if (images.length === 0) throw new Error('Could not encode any images for upload');

  // ── Submit — Express returns a jobId in <500ms via the new JSON branch.
  //    axios handles auth header injection + refresh via interceptors, so
  //    we don't need the manual JWT refresh dance the old multipart code did.
  const SUBMIT_TIMEOUT_MS = 60_000;
  const { data: submitJson } = await api.post(
    '/ai/scan/submit',
    { images, farmContext },
    { timeout: SUBMIT_TIMEOUT_MS },
  );
  const submitData = submitJson?.data || {};

  // Server may have served a cached result inline; if so, we're done.
  if (submitData.status === 'done' && submitData.disease) {
    return submitData;
  }

  const jobId = submitData.jobId;
  if (!jobId) {
    throw new Error('Scan submit did not return a jobId — please retry');
  }

  // ── Poll for completion via axios (short individual requests, no socket
  //    timeout risk). Backend's task budget is ~240s; we wait up to 300s here
  //    so a slow ensemble run completes cleanly. Interval is 2s, which is
  //    short enough to feel responsive without hammering the server.
  const POLL_INTERVAL_MS = 2_000;
  const POLL_MAX_MS      = 300_000;
  const startedAt = Date.now();
  // Brief delay before first poll — the worker typically takes >2s to even
  // pick the task off the queue.
  await new Promise(r => setTimeout(r, 1_500));

  while (Date.now() - startedAt < POLL_MAX_MS) {
    let pollResp;
    try {
      const { data } = await api.get(`/ai/scan/job/${encodeURIComponent(jobId)}`);
      pollResp = data?.data || {};
    } catch (err) {
      // Network blip — retry next tick. Hard failures (4xx/5xx with body)
      // bubble up as a real error.
      const status = err?.response?.status;
      if (status && status >= 400) {
        throw new Error(err?.response?.data?.error?.message || `Status check failed (HTTP ${status})`);
      }
      if (__DEV__) console.warn('[scanCropImage] transient poll error:', err?.message);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    if (pollResp.status === 'done') {
      return pollResp;
    }
    if (pollResp.status === 'failed') {
      throw new Error(pollResp.error || 'Diagnosis pipeline failed on the server');
    }
    // queued | running — wait and re-check
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error('Scan timed out — the AI is taking longer than usual. Please try again.');
}

/**
 * Get past scan history for the current user (basic list).
 */
export async function getScanHistory() {
  const { data } = await api.get('/ai/scan/history');
  return data.data || [];
}

/**
 * Get past scan chat sessions (with follow-up Q&A).
 */
export async function getScanSessions(page = 1, limit = 20) {
  const { data } = await api.get('/ai/scan/sessions', { params: { page, limit } });
  return data.data || [];
}

/**
 * Get a full scan session with all messages.
 */
export async function getScanSessionDetail(sessionId) {
  const { data } = await api.get(`/ai/scan/sessions/${sessionId}`);
  return data.data;
}

/**
 * Send a follow-up message in a scan session.
 */
export async function sendScanFollowUp(sessionId, message) {
  const { data } = await api.post(`/ai/scan/${sessionId}/chat`, { message });
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART ALERTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate smart farming alerts based on user's farm context.
 * @param {{ crop, state, dayOfSeason }} context
 * @returns {Array} alerts
 */
export async function getSmartAlerts(context = {}) {
  const { data } = await api.post('/ai/alerts', context);
  return data.data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET PRICES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get real-time market prices from data.gov.in (Agmarknet).
 * @param {string} crop   e.g. 'Tomato', 'Onion', 'Wheat'
 * @param {string} state  e.g. 'Maharashtra', 'Punjab'
 */
export async function getMarketPrices(crop = 'Tomato', state = 'Maharashtra', city = null) {
  const params = { crop, state };
  if (city) params.city = city;
  const { data } = await api.get('/market/prices', { params });
  return data.data;
}

/**
 * Get 7-day AI price prediction.
 */
export async function getMarketPrediction(crop = 'Tomato', state = 'Maharashtra') {
  const { data } = await api.get('/market/predict', { params: { crop, state } });
  return data.data;
}

/**
 * Get extended multi-month price forecast.
 * @param {string} crop   e.g. 'Tomato'
 * @param {string} state  e.g. 'Maharashtra'
 * @param {string} period '3m' | '6m' | '12m'
 */
export async function getExtendedForecast(crop = 'Tomato', state = 'Maharashtra', period = '3m') {
  const { data } = await api.get('/market/forecast', { params: { crop, state, period }, timeout: 30000 });
  return data.data;
}

/**
 * Get list of supported crops and states.
 */
export async function getMarketCrops() {
  const { data } = await api.get('/market/crops');
  return data.data || { crops: [], states: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE CHAT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a voice recording to FarmMind AI.
 * Backend transcribes with Groq Whisper, then answers with FarmMind.
 * @param {string}      audioUri       Local file URI (m4a / wav / mp3)
 * @param {string|null} conversationId Existing conversation to continue, or null
 * @param {object}      farmProfile    Farm context for personalised response
 * @param {string}      language       BCP-47 short code ('en' | 'hi' | 'mr' …) —
 *                                     user-selected chat language. Sent to both
 *                                     STT (transcription hint) and FastAPI
 *                                     (so reply is in selected tongue).
 * @returns {{ transcription, reply, type, card, conversationId }}
 */
export async function sendVoiceMessage(audioUri, conversationId = null, farmProfile = {}, language = 'en') {
  const isWeb = typeof document !== 'undefined';
  const idemKey = newIdemKey();

  // ── Web path ────────────────────────────────────────────────────────────────
  if (isWeb) {
    const fileName = audioUri.split('/').pop() || 'voice.m4a';
    const ext      = fileName.split('.').pop()?.toLowerCase() || 'm4a';
    const mimeMap  = { m4a: 'audio/m4a', mp3: 'audio/mpeg', wav: 'audio/wav',
                       webm: 'audio/webm', ogg: 'audio/ogg', aac: 'audio/aac' };
    const mimeType = mimeMap[ext] || 'audio/m4a';
    const formData = new FormData();
    const resp = await fetch(audioUri);
    const blob = await resp.blob();
    formData.append('audio', blob, fileName);
    if (conversationId) formData.append('conversationId', conversationId);
    formData.append('farmProfile', JSON.stringify(farmProfile));
    if (language) formData.append('language', language);
    const { data } = await api.post('/ai/voice', formData, {
      headers: { 'Content-Type': 'multipart/form-data', 'Idempotency-Key': idemKey },
      timeout: 60000,
    });
    return data.data;
  }

  // ── Native (iOS + Android) path ─────────────────────────────────────────────
  // Android New Architecture (OkHttp/Turbo) silently drops file:// URIs in
  // FormData — same issue as scanCropImage. Use FileSystem.uploadAsync instead.
  const token = await getAccessToken();
  const params = { farmProfile: JSON.stringify(farmProfile) };
  if (conversationId) params.conversationId = conversationId;
  if (language) params.language = language;

  const uploadResult = await FileSystem.uploadAsync(
    `${API_BASE_URL}/ai/voice`,
    audioUri,
    {
      httpMethod:  'POST',
      uploadType:  FileSystem.FileSystemUploadType.MULTIPART,
      fieldName:   'audio',
      mimeType:    'audio/m4a',
      headers:     { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Idempotency-Key': idemKey },
      parameters:  params,
    },
  );

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    let errBody;
    try { errBody = JSON.parse(uploadResult.body); } catch { errBody = {}; }
    const e = new Error(errBody?.error?.message || `HTTP ${uploadResult.status}`);
    e.status = uploadResult.status;
    e.response = { status: uploadResult.status, data: errBody };
    throw e;
  }

  const json = JSON.parse(uploadResult.body);
  return json.data; // { transcription, reply, type, card, conversationId }
}

/**
 * Voice chat with TTS response — sends audio, gets back transcription + AI reply + audio response.
 * @param {string} audioUri   Local file URI
 * @param {string} language   BCP-47 language code (e.g. 'mr-IN', 'hi-IN')
 * @param {string|null} conversationId
 * @param {object} farmProfile
 * @returns {{ transcription, detectedLanguage, reply, conversationId, audio: { audio: base64, mimeType } }}
 */
export async function sendVoiceChatMessage(audioUri, language = 'hi-IN', conversationId = null, farmProfile = {}) {
  const isWeb = typeof document !== 'undefined';
  const idemKey = newIdemKey();

  // Text-first: hit /ai/voice WITHOUT tts so the {transcription, reply} returns
  // immediately; the screen fetches audio via textToSpeech() and auto-plays.
  // (A TTS failure no longer wastes the STT+LLM spend, and the payload is small.)
  if (isWeb) {
    const formData = new FormData();
    const resp = await fetch(audioUri);
    const blob = await resp.blob();
    formData.append('audio', blob, audioUri.split('/').pop() || 'voice.m4a');
    formData.append('language', language);
    if (conversationId) formData.append('conversationId', conversationId);
    formData.append('farmProfile', JSON.stringify(farmProfile));
    const { data } = await api.post('/ai/voice', formData, {
      headers: { 'Content-Type': 'multipart/form-data', 'Idempotency-Key': idemKey },
      timeout: 90000,
    });
    return data.data;
  }

  const token = await getAccessToken();
  const params = { farmProfile: JSON.stringify(farmProfile), language };
  if (conversationId) params.conversationId = conversationId;

  const uploadResult = await FileSystem.uploadAsync(
    `${API_BASE_URL}/ai/voice`,
    audioUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'audio',
      mimeType: 'audio/m4a',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Idempotency-Key': idemKey },
      parameters: params,
    },
  );

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    let errBody;
    try { errBody = JSON.parse(uploadResult.body); } catch { errBody = {}; }
    const e = new Error(errBody?.error?.message || `HTTP ${uploadResult.status}`);
    e.status = uploadResult.status;
    throw e;
  }

  return JSON.parse(uploadResult.body).data;
}

/**
 * Text-to-speech — convert text to audio in the given language.
 * @returns {{ audio: base64, mimeType: string }}
 */
export async function textToSpeech(text, language = 'hi-IN') {
  const { data } = await api.post('/ai/tts', { text, language }, { timeout: 30000 });
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY PLANNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get today's planner tasks.
 * @param {string} [date]  ISO date string, defaults to today
 */
export async function getPlannerTasks(date = null) {
  const params = date ? { date } : {};
  const { data } = await api.get('/planner/tasks', { params });
  return data.data || [];
}

/**
 * Mark a task as done or undone.
 * @param {string}  taskId
 * @param {boolean} done
 */
export async function updateTaskDone(taskId, done) {
  const { data } = await api.put(`/planner/tasks/${taskId}`, { done });
  return data.data;
}

/**
 * Create a manual task.
 */
export async function createTask(task) {
  const { data } = await api.post('/planner/tasks', task);
  return data.data;
}

/**
 * Delete a task.
 */
export async function deleteTask(taskId) {
  const { data } = await api.delete(`/planner/tasks/${taskId}`);
  return data.data;
}

/**
 * Ask AI to generate today's tasks based on farm context.
 * @param {{ crop, state, dayOfSeason }} context
 */
export async function generateAITasks(context = {}) {
  const { data } = await api.post('/planner/generate', context, { timeout: 20000 });
  return data.data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// MANDI BHAV (Real mandi prices from data.gov.in)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMandiPrices(commodity = 'Tomato', state = 'Maharashtra', district = null) {
  const params = { commodity, state };
  if (district) params.district = district;
  const { data } = await api.get('/mandi/prices', { params });
  return data.data;
}

export async function getMandiTrend(commodity, market, days = 7) {
  const { data } = await api.get(`/mandi/prices/${encodeURIComponent(commodity)}/trend`, { params: { market, days } });
  return data.data;
}

export async function getNearbyMandis(district) {
  const { data } = await api.get('/mandi/nearby', { params: { district } });
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGRIPREDICT — Real data.gov.in prices + Claude-powered predictions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get list of states that have data in the DB.
 */
export async function getAgriPredictStates() {
  const { data } = await api.get('/agripredict/filters/states');
  return data.data?.states || [];
}

/**
 * Get districts for a state (from DB).
 */
export async function getAgriPredictDistricts(state) {
  const { data } = await api.get('/agripredict/filters/districts', { params: { state } });
  return data.data?.districts || [];
}

/**
 * Get commodities available for a state+district in DB.
 */
export async function getAgriPredictCommodities(state, district = null) {
  const params = { state };
  if (district) params.district = district;
  const { data } = await api.get('/agripredict/filters/commodities', { params });
  return data.data?.commodities || [];
}

/**
 * Get 5-year monthly historical price data for a commodity+state+district.
 * Returns { monthlySummary, stats, summary }
 */
export async function getAgriHistoricalPrices(commodity, state, district = null) {
  const params = { commodity, state };
  if (district) params.district = district;
  const { data } = await api.get('/agripredict/prices/history', { params, timeout: 15000 });
  return data.data;
}

/**
 * Get Claude-powered price prediction (cache-first, returns in <1s if cached).
 * Returns { cached, prediction, nearbyMarkets, dataUsed, ... }
 */
export async function getAgriPrediction(commodity, state, district = '') {
  const { data } = await api.post(
    '/agripredict/predict',
    { commodity, state, district },
    { timeout: 30000 }
  );
  return data.data;
}

/**
 * Compare current prices across nearby districts for same commodity.
 */
export async function getAgriNearbyComparison(commodity, state, district = '') {
  const { data } = await api.get('/agripredict/compare', {
    params: { commodity, state, district },
  });
  return data.data;
}

/**
 * Trigger a background data sync from data.gov.in for a commodity+state.
 * Non-blocking — returns 202 immediately.
 */
export async function triggerAgriSync(commodity, state, district = null) {
  const { data } = await api.post('/agripredict/sync/trigger', { commodity, state, district });
  return data.data;
}

/**
 * Get the status of the last data sync for a commodity+state.
 */
export async function getAgriSyncStatus(commodity, state) {
  const { data } = await api.get('/agripredict/sync/status', { params: { commodity, state } });
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// MSP TRACKER
// ─────────────────────────────────────────────────────────────────────────────

export async function getMSPRates(year = null, season = null) {
  const params = {};
  if (year)   params.year   = year;
  if (season) params.season = season;
  const { data } = await api.get('/msp/rates', { params });
  return data.data;
}

export async function getMSPRateForCommodity(commodity) {
  const { data } = await api.get(`/msp/rates/${encodeURIComponent(commodity)}`);
  return data.data;
}

export async function getMSPComparison(commodity, state = 'Maharashtra', district = null) {
  const params = { state };
  if (district) params.district = district;
  const { data } = await api.get(`/msp/compare/${encodeURIComponent(commodity)}`, { params });
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOIL HEALTH
// ─────────────────────────────────────────────────────────────────────────────

export async function submitSoilReport(soilData) {
  const { data } = await api.post('/soil/manual', soilData);
  return data.data;
}

export async function getSoilReports() {
  const { data } = await api.get('/soil/reports');
  return data.data || [];
}

export async function getSoilReportDetail(id) {
  const { data } = await api.get(`/soil/reports/${id}`);
  return data.data;
}

export async function getSoilRecommendation(soilId, crop, area = 1, unit = 'acre') {
  const params = {};
  if (soilId) params.soilId = soilId;
  if (crop)   params.crop   = crop;
  if (area)   params.area   = area;
  if (unit)   params.unit   = unit;
  const { data } = await api.get('/soil/recommendation', { params });
  return data.data;
}

/**
 * Soil Health Card OCR — upload a card photo, get the 12 parameters extracted.
 * Returns { fields, units, confidence, notes, fieldsFound, token_info }.
 * The caller must let the farmer review/edit before saving (never auto-submit).
 */
export async function scanSoilCard(base64, mimeType = 'image/jpeg') {
  const { data } = await api.post(
    '/ai/soil-card-ocr',
    { image: { data: base64, mime_type: mimeType } },
    { timeout: 60000 },
  );
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI CREDITS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get user's AI credit balance, history, and available packs.
 */
export async function getAICredits() {
  const { data } = await api.get('/ai/credits');
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAN CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

export async function calculateLoanKCC(loanData) {
  const { data } = await api.post('/loan/kcc-eligibility', loanData);
  return data.data;
}

export async function calculateLoanEMI(emiData) {
  const { data } = await api.post('/loan/emi', emiData);
  return data.data;
}

export async function getLoanBankComparison() {
  const { data } = await api.get('/loan/compare');
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// CROP CALENDAR
// ─────────────────────────────────────────────────────────────────────────────

export async function generateCropCalendar(calendarData) {
  const { data } = await api.post('/calendar/generate', calendarData, { timeout: 20000 });
  return data.data;
}

export async function getCropCalendars() {
  const { data } = await api.get('/calendar');
  return data.data || [];
}

export async function getCalendarTodaysTasks() {
  const { data } = await api.get('/calendar/today');
  return data.data || [];
}

export async function updateCalendarTask(taskId, status) {
  const { data } = await api.patch(`/calendar/tasks/${taskId}`, { status });
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// IRRIGATION
// ─────────────────────────────────────────────────────────────────────────────

export async function getIrrigationToday(params = {}) {
  const { data } = await api.get('/irrigation/today', { params });
  return data.data;
}

export async function getIrrigationWeekly(params = {}) {
  const { data } = await api.get('/irrigation/weekly', { params });
  return data.data;
}

export async function logIrrigation(logData) {
  const { data } = await api.post('/irrigation/log', logData);
  return data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

export async function calculateInputs(crop, area, unit = 'acre', organic = false) {
  const { data } = await api.post('/inputs/calculate', { crop, area, unit, organic });
  return data.data;
}

export async function getInputPriceList() {
  const { data } = await api.get('/inputs/price-list');
  return data.data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// CROPS
// ─────────────────────────────────────────────────────────────────────────────

export async function getCrops() {
  const { data } = await api.get('/crops');
  return data.data || [];
}

export async function searchCrops(q) {
  const { data } = await api.get('/crops/search', { params: { q } });
  return data.data || [];
}
