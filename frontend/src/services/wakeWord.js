/**
 * Wake-word engine — "Hey Krushi", powered by Vosk (offline, FREE, no account/key).
 *
 * How it works: Vosk runs a small offline speech recogniser continuously and we
 * watch the transcript for the phrase "hey krushi" (+ common mishears). No audio
 * ever leaves the device, and there's no API key or per-user fee.
 *
 * IMPORTANT: this needs a CUSTOM NATIVE BUILD (react-native-vosk) + a bundled Vosk
 * model — it cannot run in Expo Go. This module is GUARDED so it's totally inert
 * until both exist: if the native module or the model is missing, every function
 * no-ops (never throws), so the app keeps running everywhere. See
 * docs/HEY_KRUSHI_WAKEWORD.md for the one-time model + EAS build setup.
 *
 * Exposes the same interface the KrushiAssistantProvider already uses:
 *   isWakeWordAvailable() / startWakeWord(onWake) / stopWakeWord()
 *   pauseWakeWord() / resumeWakeWord()
 */

// Guarded require: absent in Expo Go → Vosk stays null (no crash). Handle both
// ESM-default and CommonJS export shapes.
let Vosk = null;
try {
  // eslint-disable-next-line global-require
  const mod = require('react-native-vosk');
  Vosk = mod?.default || mod || null;
} catch {
  Vosk = null;
}

// Folder name of the bundled Vosk model (see plugins/withVoskModel.js). Small
// Indian/US English model is plenty for a two-word wake phrase.
const MODEL_NAME = 'vosk-model';

// The wake phrase + common recogniser mishears ("krushi" is often heard as
// krishi/krushni/crushy). Matched case-insensitively as a substring so partial
// results trigger quickly.
const WAKE_PHRASES = [
  'hey krushi', 'hey krishi', 'hey krushni', 'hey krushy', 'hey crushy',
  'a krushi', 'hey krush', 'he krushi',
];
// Restricted grammar = keyword-spotting mode: far lower CPU/battery and fewer
// false triggers than open-vocabulary ASR. '[unk]' catches everything else.
const GRAMMAR = [...WAKE_PHRASES, '[unk]'];

let vosk = null;
let subs = [];
let listening = false;
let onWakeCb = null;
let lastFireAt = 0;
const DEBOUNCE_MS = 2500; // ignore repeat matches within this window

/** True only when the native Vosk module is present in the build. */
export function isWakeWordAvailable() {
  return !!Vosk;
}

function matches(text) {
  const t = String(text || '').toLowerCase();
  return t && WAKE_PHRASES.some((p) => t.includes(p));
}

function handleText(res) {
  // react-native-vosk gives the recognised string (or { result } depending on ver).
  const text = typeof res === 'string' ? res : (res?.result ?? res?.text ?? '');
  if (!matches(text)) return;
  const now = Date.now();
  if (now - lastFireAt < DEBOUNCE_MS) return;
  lastFireAt = now;
  try { onWakeCb?.(); } catch { /* ignore */ }
}

async function beginRecognition() {
  // Try grammar-constrained (KWS) first; fall back to open ASR if unsupported.
  try {
    await vosk.start({ grammar: GRAMMAR });
  } catch {
    try { await vosk.start(); } catch { /* ignore */ }
  }
  listening = true;
}

/** Start always-listening for "Hey Krushi". Returns true if it actually started. */
export async function startWakeWord(onWake) {
  if (!isWakeWordAvailable() || vosk) return !!vosk;
  onWakeCb = onWake;
  try {
    vosk = new Vosk();
    await vosk.loadModel(MODEL_NAME);
    subs = [
      vosk.onResult?.(handleText),
      vosk.onPartialResult?.(handleText),
      vosk.onFinalResult?.(handleText),
      vosk.onError?.((e) => { if (__DEV__) console.warn('[WakeWord/Vosk] error:', e?.message || e); }),
    ].filter(Boolean);
    await beginRecognition();
    return true;
  } catch (e) {
    if (__DEV__) console.warn('[WakeWord/Vosk] init failed (non-fatal):', e?.message || e);
    await stopWakeWord();
    return false;
  }
}

/** Stop + release the recogniser entirely. */
export async function stopWakeWord() {
  listening = false;
  try { vosk?.stop?.(); } catch { /* ignore */ }
  try { subs.forEach((s) => s?.remove?.()); } catch { /* ignore */ }
  subs = [];
  try { vosk?.unload?.(); } catch { /* ignore */ }
  vosk = null;
}

/** Release the mic so the assistant can record; keep the model loaded. */
export async function pauseWakeWord() {
  if (vosk && listening) {
    listening = false;
    try { vosk.stop?.(); } catch { /* ignore */ }
  }
}

/** Resume listening after the assistant closes. */
export async function resumeWakeWord() {
  if (vosk && !listening) {
    try { await beginRecognition(); } catch { /* ignore */ }
  }
}
