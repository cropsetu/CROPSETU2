/**
 * Sarvam AI Service  — Indian multilingual voice & translation
 *
 * Endpoints:
 *   STT  → POST https://api.sarvam.ai/speech-to-text        (saaras:v3)
 *   TTS  → POST https://api.sarvam.ai/text-to-speech        (bulbul:v3)
 *   TL   → POST https://api.sarvam.ai/translate             (mayura:v1)
 *
 * Auth: api-subscription-key header
 * Uses Node 18+ built-in fetch / FormData / Blob (no extra deps needed).
 *
 * Supported language codes:
 *   hi-IN  mr-IN  ta-IN  te-IN  kn-IN
 *   gu-IN  pa-IN  bn-IN  ml-IN  or-IN  en-IN
 */
import { ENV } from '../config/env.js';
import { sarvamBreaker, httpFailure } from '../resilience/breakers.js';

const BASE_URL = 'https://api.sarvam.ai';
// These fetches previously had NO timeout — an unresponsive Sarvam could hang the
// request indefinitely. AbortSignal.timeout cancels the socket; the breaker's
// timeout is a backstop above it.
const REQUEST_TIMEOUT_MS = 15_000;

function getKey() {
  if (!ENV.SARVAM_API_KEY) throw new Error('SARVAM_API_KEY not set in .env');
  return ENV.SARVAM_API_KEY;
}

// ── Language helpers ──────────────────────────────────────────────────────────

const SARVAM_LANGUAGES = {
  'hi': 'hi-IN',  // Hindi
  'mr': 'mr-IN',  // Marathi
  'ta': 'ta-IN',  // Tamil
  'te': 'te-IN',  // Telugu
  'kn': 'kn-IN',  // Kannada
  'gu': 'gu-IN',  // Gujarati
  'pa': 'pa-IN',  // Punjabi
  'bn': 'bn-IN',  // Bengali
  'ml': 'ml-IN',  // Malayalam
  'or': 'or-IN',  // Odia
  'en': 'en-IN',  // English (Indian)
};

// Default speaker per language (Sarvam bulbul:v3)
const SPEAKER_MAP = {
  'hi-IN': 'priya',
  'mr-IN': 'priya',
  'ta-IN': 'priya',
  'te-IN': 'priya',
  'kn-IN': 'priya',
  'gu-IN': 'priya',
  'pa-IN': 'priya',
  'bn-IN': 'priya',
  'ml-IN': 'priya',
  'or-IN': 'priya',
  'en-IN': 'priya',
};

/**
 * Normalise short code ("hi") → full BCP-47 tag ("hi-IN").
 * Already correct codes pass through unchanged.
 */
export function normaliseLangCode(code = 'hi-IN') {
  if (!code) return 'hi-IN';
  const short = code.split('-')[0].toLowerCase();
  return SARVAM_LANGUAGES[short] || (code.includes('-') ? code : 'hi-IN');
}

// ── Speech-to-Text ────────────────────────────────────────────────────────────

/**
 * Transcribe audio using Sarvam saarika:v2.
 * Supports 10+ Indian languages + English natively.
 *
 * @param {Buffer}  audioBuffer   Raw audio bytes
 * @param {string}  fileName      e.g. "voice.m4a" — extension tells Sarvam the codec
 * @param {string}  languageCode  BCP-47 tag, e.g. "hi-IN". Pass null for auto-detect.
 * @returns {Promise<{ transcript: string, languageCode: string }>}
 */
export async function sarvamSTT(audioBuffer, fileName = 'audio.m4a', languageCode = null) {
  const mimeType = mimeFromExt(fileName);

  // Use Node 18+ built-in FormData + Blob
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mimeType }), fileName);
  form.append('model', 'saaras:v3');
  form.append('mode', 'transcribe');
  if (languageCode) {
    form.append('language_code', normaliseLangCode(languageCode));
  }

  return sarvamBreaker().execute(async () => {
    const res = await fetch(`${BASE_URL}/speech-to-text`, {
      method:  'POST',
      headers: { 'api-subscription-key': getKey() },
      body:    form,
      signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`Sarvam STT failed (${res.status}): ${body}`), { status: res.status });
    }

    const json = await res.json();
    // Response shape: { transcript, language_code, ... }
    return {
      transcript:   (json.transcript || '').trim(),
      languageCode: json.language_code || languageCode || 'hi-IN',
    };
  }, { isFailure: httpFailure });
}

// ── Text-to-Speech ────────────────────────────────────────────────────────────

/**
 * Synthesise speech using Sarvam bulbul:v1.
 * Returns base64-encoded WAV audio.
 *
 * @param {string}  text          Text to speak (max ~500 chars per call)
 * @param {string}  languageCode  BCP-47 tag, e.g. "hi-IN"
 * @param {string}  [speaker]     Override speaker name (optional)
 * @returns {Promise<{ audio: string, mimeType: string }>}
 *          audio is a base64-encoded WAV string
 */
export async function sarvamTTS(text, languageCode = 'hi-IN', speaker = null) {
  const lang = normaliseLangCode(languageCode);
  const spkr = speaker || SPEAKER_MAP[lang] || 'meera';

  const body = {
    text:                  text.trim(),
    target_language_code:  lang,
    speaker:               spkr,
    pace:                  1.0,
    speech_sample_rate:    22050,
    model:                 'bulbul:v3',
  };

  return sarvamBreaker().execute(async () => {
    const res = await fetch(`${BASE_URL}/text-to-speech`, {
      method:  'POST',
      headers: {
        'api-subscription-key': getKey(),
        'Content-Type':         'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const err = await res.text();
      throw Object.assign(new Error(`Sarvam TTS failed (${res.status}): ${err}`), { status: res.status });
    }

    const json = await res.json();
    // Response shape: { audios: ["<base64-wav>"], request_id: "..." }
    const audio = Array.isArray(json.audios) ? json.audios[0] : '';
    return { audio, mimeType: 'audio/wav' };
  }, { isFailure: httpFailure });
}

// ── Translation ───────────────────────────────────────────────────────────────

/**
 * Translate text between Indian languages using Sarvam mayura:v1.
 *
 * @param {string} text           Text to translate
 * @param {string} sourceLang     BCP-47 source language code (e.g. "en-IN")
 * @param {string} targetLang     BCP-47 target language code (e.g. "hi-IN")
 * @returns {Promise<{ translatedText: string }>}
 */
export async function sarvamTranslate(text, sourceLang = 'en-IN', targetLang = 'hi-IN') {
  const body = {
    input:                text.trim(),
    source_language_code: normaliseLangCode(sourceLang),
    target_language_code: normaliseLangCode(targetLang),
    speaker_gender:       'Male',
    mode:                 'formal',
    model:                'mayura:v1',
    enable_preprocessing: false,
  };

  return sarvamBreaker().execute(async () => {
    const res = await fetch(`${BASE_URL}/translate`, {
      method:  'POST',
      headers: {
        'api-subscription-key': getKey(),
        'Content-Type':         'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const err = await res.text();
      throw Object.assign(new Error(`Sarvam Translate failed (${res.status}): ${err}`), { status: res.status });
    }

    const json = await res.json();
    return { translatedText: json.translated_text || '' };
  }, { isFailure: httpFailure });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function mimeFromExt(filename = '') {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    mp3:  'audio/mpeg',
    mp4:  'audio/mp4',
    m4a:  'audio/x-m4a',
    wav:  'audio/wav',
    ogg:  'audio/ogg',
    webm: 'audio/webm',
    aac:  'audio/aac',
  };
  return map[ext] || 'application/octet-stream';
}
