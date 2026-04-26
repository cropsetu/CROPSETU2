/**
 * WMO Weather Code → human-readable condition
 * Source: https://open-meteo.com/en/docs#weathervariables
 *
 * Each entry has:
 *   en  — English label
 *   hi  — Hindi label
 *   icon — Ionicons name (outline variant appended on frontend)
 *   isRain / isStorm / isSnow — advisory flags
 */

export const WMO_CODES = {
  0:  { en: 'Clear Sky',             hi: 'साफ आसमान',           icon: 'sunny',         isRain: false, isStorm: false },
  1:  { en: 'Mainly Clear',          hi: 'ज्यादातर साफ',         icon: 'partly-sunny',  isRain: false, isStorm: false },
  2:  { en: 'Partly Cloudy',         hi: 'आंशिक बादल',          icon: 'partly-sunny',  isRain: false, isStorm: false },
  3:  { en: 'Overcast',              hi: 'बादल छाए',             icon: 'cloud',         isRain: false, isStorm: false },
  45: { en: 'Foggy',                 hi: 'कोहरा',                icon: 'partly-sunny',  isRain: false, isStorm: false },
  48: { en: 'Icy Fog',               hi: 'बर्फीला कोहरा',        icon: 'partly-sunny',  isRain: false, isStorm: false },
  51: { en: 'Light Drizzle',         hi: 'हल्की बूंदाबांदी',     icon: 'rainy',         isRain: true,  isStorm: false },
  53: { en: 'Drizzle',               hi: 'बूंदाबांदी',           icon: 'rainy',         isRain: true,  isStorm: false },
  55: { en: 'Heavy Drizzle',         hi: 'तेज बूंदाबांदी',       icon: 'rainy',         isRain: true,  isStorm: false },
  56: { en: 'Light Freezing Drizzle',hi: 'हल्की जमने वाली बूंद', icon: 'rainy',         isRain: true,  isStorm: false },
  57: { en: 'Heavy Freezing Drizzle',hi: 'तेज जमने वाली बूंद',   icon: 'rainy',         isRain: true,  isStorm: false },
  61: { en: 'Light Rain',            hi: 'हल्की बारिश',          icon: 'rainy',         isRain: true,  isStorm: false },
  63: { en: 'Rain',                  hi: 'बारिश',                icon: 'rainy',         isRain: true,  isStorm: false },
  65: { en: 'Heavy Rain',            hi: 'तेज बारिश',            icon: 'rainy',         isRain: true,  isStorm: false },
  66: { en: 'Light Freezing Rain',   hi: 'हल्की जमने वाली बारिश',icon: 'rainy',         isRain: true,  isStorm: false },
  67: { en: 'Heavy Freezing Rain',   hi: 'तेज जमने वाली बारिश',  icon: 'rainy',         isRain: true,  isStorm: false },
  71: { en: 'Light Snow',            hi: 'हल्की बर्फबारी',       icon: 'snow',          isRain: false, isStorm: false, isSnow: true },
  73: { en: 'Snow',                  hi: 'बर्फबारी',             icon: 'snow',          isRain: false, isStorm: false, isSnow: true },
  75: { en: 'Heavy Snow',            hi: 'तेज बर्फबारी',         icon: 'snow',          isRain: false, isStorm: false, isSnow: true },
  77: { en: 'Snow Grains',           hi: 'बर्फ के कण',           icon: 'snow',          isRain: false, isStorm: false, isSnow: true },
  80: { en: 'Light Rain Showers',    hi: 'हल्की बौछार',          icon: 'rainy',         isRain: true,  isStorm: false },
  81: { en: 'Rain Showers',          hi: 'बौछार',                icon: 'rainy',         isRain: true,  isStorm: false },
  82: { en: 'Heavy Rain Showers',    hi: 'तेज बौछार',            icon: 'rainy',         isRain: true,  isStorm: false },
  85: { en: 'Light Snow Showers',    hi: 'हल्की बर्फ की बौछार',  icon: 'snow',          isRain: false, isStorm: false, isSnow: true },
  86: { en: 'Heavy Snow Showers',    hi: 'तेज बर्फ की बौछार',    icon: 'snow',          isRain: false, isStorm: false, isSnow: true },
  95: { en: 'Thunderstorm',          hi: 'आंधी-तूफान',           icon: 'thunderstorm',  isRain: true,  isStorm: true  },
  96: { en: 'Thunderstorm w/ Hail',  hi: 'ओलावृष्टि',            icon: 'thunderstorm',  isRain: true,  isStorm: true  },
  99: { en: 'Heavy Hail Storm',      hi: 'तेज ओलावृष्टि',        icon: 'thunderstorm',  isRain: true,  isStorm: true  },
};

/**
 * Returns the condition entry for a WMO code.
 * Falls back to nearest lower code if exact code not found.
 */
export function getCondition(code) {
  if (WMO_CODES[code]) return WMO_CODES[code];

  // Find nearest lower code
  const keys = Object.keys(WMO_CODES).map(Number).sort((a, b) => a - b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] <= code) return WMO_CODES[keys[i]];
  }
  return { en: 'Unknown', hi: 'अज्ञात', icon: 'partly-sunny', isRain: false, isStorm: false };
}

/**
 * Returns the condition label string for a given language.
 * @param {number} code - WMO weather code
 * @param {'en'|'hi'} lang
 */
export function getConditionLabel(code, lang = 'en') {
  const entry = getCondition(code);
  return lang === 'hi' ? entry.hi : entry.en;
}
