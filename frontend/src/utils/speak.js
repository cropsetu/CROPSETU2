/**
 * speak.js — offline, multilingual text-to-speech for low-literacy users.
 *
 * Uses expo-speech (on-device, free, no credits) to read insights / P&L /
 * mandi prices aloud. Complements the credit-gated Sarvam TTS in AI chat.
 *
 * IMPORTANT: expo-speech is a NATIVE module. It is only present after the dev
 * client / app binary is rebuilt (it won't exist in an older build even though
 * the JS package is installed). So we require it LAZILY and guard every call —
 * the feature silently no-ops (and SpeakerButton hides itself) until a rebuild,
 * instead of throwing "Cannot find native module 'ExpoSpeech'" at startup.
 */

// App language code → BCP-47 locale the OS TTS engine understands.
const LOCALE = {
  en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN',
  kn: 'kn-IN', ml: 'ml-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN',
};

// undefined = not tried yet · null = unavailable in this build · object = ready
let _engine;

function getEngine() {
  if (_engine !== undefined) return _engine;
  _engine = null;
  try {
    // Probe for the native module with the NON-throwing API first. Importing
    // `expo-speech` directly calls requireNativeModule() at module top level,
    // which — when the module isn't in the current build — reports through RN's
    // global error handler (a dev RedBox) even inside try/catch. requireOptional
    // returns null instead, so we only import expo-speech once it really exists.
    const core = require('expo-modules-core');
    const present = typeof core?.requireOptionalNativeModule === 'function'
      ? !!core.requireOptionalNativeModule('ExpoSpeech')
      : false;
    if (present) {
      const mod = require('expo-speech');
      if (typeof mod?.speak === 'function') _engine = mod;
    }
  } catch {
    _engine = null;   // anything unexpected → feature simply stays off
  }
  return _engine;
}

/** Whether on-device TTS is usable in this build (SpeakerButton hides if not). */
export function isSpeechAvailable() {
  return !!getEngine();
}

export function speak(text, lang = 'en') {
  const engine = getEngine();
  const body = String(text || '').trim();
  if (!engine || !body) return;
  try {
    engine.stop();
    engine.speak(body, { language: LOCALE[lang] || 'en-IN', rate: 0.95, pitch: 1.0 });
  } catch {}
}

export function stopSpeaking() {
  if (!_engine) return;   // never loaded → nothing to stop
  try { _engine.stop(); } catch {}
}
