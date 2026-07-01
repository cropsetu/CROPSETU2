/**
 * Wake-word engine — "Hey Krushi" (Picovoice Porcupine), guarded + optional.
 *
 * IMPORTANT: always-listening wake word needs a CUSTOM NATIVE BUILD — it cannot
 * run in Expo Go. This module is written to be totally inert until three things
 * exist, so the app keeps running everywhere in the meantime:
 *   1. the native module (@picovoice/porcupine-react-native) is in the build,
 *   2. a Picovoice access key   → app.json  extra.picovoiceAccessKey,
 *   3. a trained "Hey Krushi" keyword file bundled in the app, referenced by
 *      app.json extra.picovoiceKeywordPath (+ optional non-English acoustic model
 *      via extra.picovoiceModelPath).
 * If any is missing, every function no-ops and logs — never throws.
 *
 * See docs/HEY_KRUSHI_WAKEWORD.md for the one-time setup + EAS build steps.
 */
import Constants from 'expo-constants';

// Guarded require: absent in Expo Go → PorcupineManager stays null (no crash).
let PorcupineManager = null;
try {
  // eslint-disable-next-line global-require
  PorcupineManager = require('@picovoice/porcupine-react-native').PorcupineManager;
} catch {
  PorcupineManager = null;
}

const extra = Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};
const ACCESS_KEY   = extra.picovoiceAccessKey || '';
const KEYWORD_PATH = extra.picovoiceKeywordPath || 'hey_krushi.ppn';
const MODEL_PATH   = extra.picovoiceModelPath || undefined; // optional (non-English acoustic model)

let manager = null;

/** True only when the native module AND an access key are present. */
export function isWakeWordAvailable() {
  return !!(PorcupineManager && ACCESS_KEY);
}

/**
 * Start listening for "Hey Krushi". onWake(keywordIndex) fires on detection.
 * Returns true if listening actually started, false if unavailable (no-op).
 */
export async function startWakeWord(onWake) {
  if (!isWakeWordAvailable() || manager) return !!manager;
  try {
    manager = await PorcupineManager.fromKeywordPaths(
      ACCESS_KEY,
      [KEYWORD_PATH],
      (idx) => { try { onWake?.(idx); } catch { /* ignore */ } },
      (e) => { if (__DEV__) console.warn('[WakeWord] runtime error:', e?.message); },
      MODEL_PATH,
    );
    await manager.start();
    return true;
  } catch (e) {
    if (__DEV__) console.warn('[WakeWord] init failed (non-fatal):', e?.message);
    manager = null;
    return false;
  }
}

/** Stop + release the engine entirely. */
export async function stopWakeWord() {
  if (!manager) return;
  try { await manager.stop(); } catch { /* ignore */ }
  try { await manager.delete(); } catch { /* ignore */ }
  manager = null;
}

/** Temporarily release the mic (so the assistant can record), keep the engine. */
export async function pauseWakeWord() {
  if (manager) { try { await manager.stop(); } catch { /* ignore */ } }
}

/** Resume listening after the assistant closes. */
export async function resumeWakeWord() {
  if (manager) { try { await manager.start(); } catch { /* ignore */ } }
}
