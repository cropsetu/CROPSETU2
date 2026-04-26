/**
 * languageDetect — light-weight Unicode script detector for routing chat
 * messages to the right language path (so the LLM replies in-language).
 *
 * Returns a BCP-47 short code that matches `LANGUAGES` in src/i18n/translations.js:
 *   'hi' | 'mr' | 'ta' | 'te' | 'kn' | 'ml' | 'bn' | 'gu' | 'pa' | 'en'
 *
 * Heuristic: count characters in each Indic Unicode block; whichever block has
 * the majority wins. If no Indic chars appear, returns 'en'.
 *
 * Devanagari (Hindi + Marathi) share a script. We can't reliably tell them
 * apart from character frequencies alone, so we fall back to the user's app
 * preference when they differ — e.g. if app is set to Marathi, Devanagari text
 * is treated as Marathi; otherwise Hindi.
 */

// Unicode ranges for the Indic scripts we support.
// Each tuple is [startCodePoint, endCodePoint, langCode].
const SCRIPT_RANGES = [
  [0x0900, 0x097F, 'devanagari'], // Hindi + Marathi
  [0x0980, 0x09FF, 'bn'],         // Bengali
  [0x0A00, 0x0A7F, 'pa'],         // Gurmukhi (Punjabi)
  [0x0A80, 0x0AFF, 'gu'],         // Gujarati
  [0x0B00, 0x0B7F, 'or'],         // Odia (not in LANGUAGES today, maps to 'hi' fallback)
  [0x0B80, 0x0BFF, 'ta'],         // Tamil
  [0x0C00, 0x0C7F, 'te'],         // Telugu
  [0x0C80, 0x0CFF, 'kn'],         // Kannada
  [0x0D00, 0x0D7F, 'ml'],         // Malayalam
];

function scriptOfCodePoint(cp) {
  for (let i = 0; i < SCRIPT_RANGES.length; i++) {
    const [lo, hi, code] = SCRIPT_RANGES[i];
    if (cp >= lo && cp <= hi) return code;
  }
  return null;
}

/**
 * Detect the dominant Indic script in `text`.
 * @param {string} text
 * @param {string} [userPreference] — used to disambiguate Devanagari (Hindi vs Marathi).
 *   Any of: 'hi', 'mr', 'en', etc. Defaults to 'hi'.
 * @returns {string} short BCP-47 code ('hi', 'mr', 'ta', ..., 'en')
 */
export function detectLanguage(text, userPreference = 'hi') {
  if (!text || typeof text !== 'string') return 'en';

  const counts = {};
  const trimmed = text.trim();
  if (!trimmed) return 'en';

  for (const ch of trimmed) {
    const cp = ch.codePointAt(0);
    const script = scriptOfCodePoint(cp);
    if (script) counts[script] = (counts[script] || 0) + 1;
  }

  // Find dominant script
  let best = null;
  let bestCount = 0;
  for (const [code, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }

  // No Indic characters → English
  if (!best) return 'en';

  // Require at least 2 characters of the dominant script to avoid mis-routing
  // on a single emoji/punctuation slip.
  if (bestCount < 2) return 'en';

  // Devanagari could be Hindi or Marathi. Respect user's app preference when
  // it's one of the two; otherwise default to Hindi.
  if (best === 'devanagari') {
    return userPreference === 'mr' ? 'mr' : 'hi';
  }

  // Odia isn't in our LANGUAGES set yet — fall back to Hindi
  if (best === 'or') return 'hi';

  return best;
}

/**
 * Convenience: map a short code to a Sarvam-style BCP-47 full code for backend
 * (used by TTS). Falls back to 'en-IN'.
 */
export function toFullLocale(shortCode) {
  const map = {
    en: 'en-IN',
    hi: 'hi-IN',
    mr: 'mr-IN',
    ta: 'ta-IN',
    te: 'te-IN',
    kn: 'kn-IN',
    ml: 'ml-IN',
    bn: 'bn-IN',
    gu: 'gu-IN',
    pa: 'pa-IN',
  };
  return map[shortCode] || 'en-IN';
}
