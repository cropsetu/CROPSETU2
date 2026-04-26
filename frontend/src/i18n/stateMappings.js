/**
 * CropSetu — Indian State → Language Mapping
 * Selecting a state automatically activates that state's primary native language.
 * States with no dedicated language file fall back to Hindi (hi) or English (en).
 */

export const INDIAN_STATES = [
  // ── North India (Hindi belt) ──────────────────────────────────────────────
  { name: 'Uttar Pradesh',       nativeName: 'उत्तर प्रदेश',      lang: 'hi', region: 'North' },
  { name: 'Bihar',               nativeName: 'बिहार',              lang: 'hi', region: 'North' },
  { name: 'Rajasthan',           nativeName: 'राजस्थान',           lang: 'hi', region: 'North' },
  { name: 'Haryana',             nativeName: 'हरियाणा',            lang: 'hi', region: 'North' },
  { name: 'Himachal Pradesh',    nativeName: 'हिमाचल प्रदेश',      lang: 'hi', region: 'North' },
  { name: 'Uttarakhand',         nativeName: 'उत्तराखंड',          lang: 'hi', region: 'North' },
  { name: 'Delhi',               nativeName: 'दिल्ली',             lang: 'hi', region: 'North' },
  { name: 'Jammu & Kashmir',     nativeName: 'जम्मू कश्मीर',       lang: 'hi', region: 'North' },
  { name: 'Ladakh',              nativeName: 'लद्दाख',             lang: 'hi', region: 'North' },

  // ── Central India ─────────────────────────────────────────────────────────
  { name: 'Madhya Pradesh',      nativeName: 'मध्य प्रदेश',        lang: 'hi', region: 'Central' },
  { name: 'Chhattisgarh',        nativeName: 'छत्तीसगढ़',          lang: 'hi', region: 'Central' },
  { name: 'Jharkhand',           nativeName: 'झारखंड',             lang: 'hi', region: 'Central' },

  // ── West India ────────────────────────────────────────────────────────────
  { name: 'Maharashtra',         nativeName: 'महाराष्ट्र',          lang: 'mr', region: 'West' },
  { name: 'Goa',                 nativeName: 'गोवा',               lang: 'mr', region: 'West' },
  { name: 'Gujarat',             nativeName: 'ગુજરાત',             lang: 'gu', region: 'West' },
  { name: 'Dadra & Nagar Haveli',nativeName: 'Dadra & NH',         lang: 'gu', region: 'West' },
  { name: 'Daman & Diu',         nativeName: 'Daman & Diu',        lang: 'gu', region: 'West' },

  // ── North West ────────────────────────────────────────────────────────────
  { name: 'Punjab',              nativeName: 'ਪੰਜਾਬ',              lang: 'pa', region: 'North West' },
  { name: 'Chandigarh',          nativeName: 'ਚੰਡੀਗੜ੍ਹ',            lang: 'pa', region: 'North West' },

  // ── South India ───────────────────────────────────────────────────────────
  { name: 'Tamil Nadu',          nativeName: 'தமிழ்நாடு',           lang: 'ta', region: 'South' },
  { name: 'Karnataka',           nativeName: 'ಕರ್ನಾಟಕ',            lang: 'kn', region: 'South' },
  { name: 'Kerala',              nativeName: 'കേരളം',              lang: 'ml', region: 'South' },
  { name: 'Andhra Pradesh',      nativeName: 'ఆంధ్రప్రదేశ్',        lang: 'te', region: 'South' },
  { name: 'Telangana',           nativeName: 'తెలంగాణ',             lang: 'te', region: 'South' },
  { name: 'Puducherry',          nativeName: 'புதுச்சேரி',           lang: 'ta', region: 'South' },
  { name: 'Lakshadweep',         nativeName: 'ലക്ഷദ്വീപ്',          lang: 'ml', region: 'South' },

  // ── East India ────────────────────────────────────────────────────────────
  { name: 'West Bengal',         nativeName: 'পশ্চিমবঙ্গ',           lang: 'bn', region: 'East' },
  { name: 'Odisha',              nativeName: 'ଓଡ଼ିଶା',              lang: 'or', region: 'East' },
  { name: 'Assam',               nativeName: 'অসম',                lang: 'as', region: 'East' },
  { name: 'Tripura',             nativeName: 'ত্রিপুরা',             lang: 'bn', region: 'East' },

  // ── North East ────────────────────────────────────────────────────────────
  { name: 'Manipur',             nativeName: 'Manipur',            lang: 'en', region: 'North East' },
  { name: 'Meghalaya',           nativeName: 'Meghalaya',          lang: 'en', region: 'North East' },
  { name: 'Nagaland',            nativeName: 'Nagaland',           lang: 'en', region: 'North East' },
  { name: 'Mizoram',             nativeName: 'Mizoram',            lang: 'en', region: 'North East' },
  { name: 'Arunachal Pradesh',   nativeName: 'Arunachal Pradesh',  lang: 'en', region: 'North East' },
  { name: 'Sikkim',              nativeName: 'Sikkim',             lang: 'en', region: 'North East' },

  // ── Islands ───────────────────────────────────────────────────────────────
  { name: 'Andaman & Nicobar',   nativeName: 'Andaman & Nicobar', lang: 'en', region: 'Islands' },
];

/** Group states by region for the picker UI. */
export function getStatesByRegion() {
  const map = {};
  for (const state of INDIAN_STATES) {
    if (!map[state.region]) map[state.region] = [];
    map[state.region].push(state);
  }
  return map;
}

/** Get the language code for a given state name. Returns 'en' if not found. */
export function getLangForState(stateName) {
  return INDIAN_STATES.find((s) => s.name === stateName)?.lang ?? 'en';
}

// Region display order for the UI
export const REGION_ORDER = [
  'North', 'North West', 'Central', 'West', 'South', 'East', 'North East', 'Islands',
];
