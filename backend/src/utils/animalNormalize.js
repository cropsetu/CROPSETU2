/**
 * Animal-listing normalisation — free-text in, canonical values out.
 *
 * The AnimalListing table stores age / weight / milk yield as DISPLAY strings
 * ("3 years", "450 kg", "12 Litre/Day") because that is what the post-ad form
 * collects. Strings cannot be range-filtered or sorted, so every "animals
 * between 2 and 5 years" style filter had to happen on the device after
 * downloading the rows. These parsers derive the numeric columns
 * (ageMonths / weightKg / milkYieldLpd) that the indexed filters use, while the
 * original display string is left untouched so nothing that renders today
 * changes.
 *
 * Search: `searchText` is a single lowercased haystack (animal, breed, location,
 * tags, description head) that ALSO carries the Marathi/Hindi names of the
 * animal. That is what makes "म्हैस" find a listing typed as "Buffalo" and vice
 * versa, with ONE trigram index instead of OR-ing four ILIKEs.
 *
 * Everything here is pure and total — a malformed value yields null, never a
 * throw, because a bad string must not be able to fail a listing write.
 */

/**
 * Canonical English animal name → the Marathi / Hindi words a farmer would type.
 * Both directions are covered because every listing's searchText carries the
 * whole alias set, so a query in either language hits the same rows.
 */
export const ANIMAL_ALIASES = {
  cow:      ['गाय', 'गाई', 'gay', 'gai'],
  buffalo:  ['म्हैस', 'म्हशी', 'भैंस', 'mhais', 'bhains'],
  goat:     ['शेळी', 'बकरी', 'बकरा', 'sheli', 'bakri'],
  bullock:  ['बैल', 'बेल', 'bail'],
  ox:       ['बैल', 'bail'],
  sheep:    ['मेंढी', 'मेंढरू', 'भेड', 'mendhi'],
  poultry:  ['कोंबडी', 'मुर्गी', 'kombdi', 'murgi', 'hen', 'chicken'],
  horse:    ['घोडा', 'घोडी', 'ghoda'],
  camel:    ['उंट', 'unt'],
  pig:      ['डुक्कर', 'वराह', 'dukkar'],
  duck:     ['बदक', 'बत्तख', 'badak'],
  rabbit:   ['ससा', 'खरगोश', 'sasa'],
  donkey:   ['गाढव', 'गधा', 'gadhav'],
  dog:      ['कुत्रा', 'कुत्ता', 'kutra'],
  fish:     ['मासा', 'मछली', 'masa'],
  honeybee: ['मधमाशी', 'madhmashi', 'bee'],
};

/** Reverse index: every alias word → its canonical English animal name. */
const ALIAS_TO_CANONICAL = (() => {
  const map = new Map();
  for (const [canonical, aliases] of Object.entries(ANIMAL_ALIASES)) {
    map.set(canonical, canonical);
    for (const a of aliases) map.set(a.toLowerCase(), canonical);
  }
  return map;
})();

/**
 * Lowercase, collapse whitespace, drop punctuation that a farmer's keyboard
 * sprinkles in ("cow,", "3-year"). Devanagari is left intact — it has no case
 * and its characters must survive verbatim for the alias match to work.
 */
export function normalizeText(raw) {
  if (raw == null) return '';
  return String(raw)
    .toLowerCase()
    .replace(/[.,;:!?"'`()[\]{}/\\|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words this long or shorter are dropped from a multi-word query as noise. */
const MIN_WORD_LEN = 2;
/** Cap the AND-groups so a pathological query can't build a 40-clause WHERE. */
const MAX_WORDS = 5;

/**
 * Turn a raw query into AND-of-OR search groups.
 *
 * Every word must appear SOMEWHERE in the listing's searchText (the AND), and a
 * word that names an animal also matches its Marathi/Hindi equivalents (the OR
 * inside a group). So:
 *
 *   "म्हैस"        → [[म्हैस, buffalo, म्हशी, भैंस, …]]
 *   "jersey cow"  → [[jersey], [cow, गाय, गाई, …]]
 *
 * The AND is what keeps precision: a flat OR would have made "jersey cow"
 * return every cow in the state, because "cow" alone matched.
 *
 * @returns {string[][]} groups; empty array for a blank query
 */
export function searchGroups(raw) {
  const q = normalizeText(raw);
  if (!q) return [];

  // The whole query is an animal name ("म्हैस", "buffalo") — the common case.
  const whole = ALIAS_TO_CANONICAL.get(q);
  if (whole) return [[q, whole, ...ANIMAL_ALIASES[whole].map((a) => a.toLowerCase())]];

  const words = q.split(' ').filter((w) => w.length >= MIN_WORD_LEN).slice(0, MAX_WORDS);
  // A single short word ("hf", "gir") is still a legitimate search.
  if (words.length === 0) return [[q]];

  return words.map((word) => {
    const canonical = ALIAS_TO_CANONICAL.get(word);
    if (!canonical) return [word];
    return [...new Set([word, canonical, ...ANIMAL_ALIASES[canonical].map((a) => a.toLowerCase())])];
  });
}

/**
 * Flat list of every term any group would match. Kept for callers that only
 * need "did the query mention an animal?" — the list endpoint uses
 * searchGroups() so it can AND the words.
 */
export function expandQueryTerms(raw) {
  return [...new Set(searchGroups(raw).flat())];
}

/** First finite number in a string, or null. Accepts "12.5", "१२" is NOT parsed. */
function firstNumber(raw) {
  const m = /(\d+(?:\.\d+)?)/.exec(String(raw ?? ''));
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * "3 years" / "18 months" / "2.5 वर्ष" / "3" → age in MONTHS.
 *
 * A bare number is ambiguous. Livestock ages are quoted in years far more often
 * than months, and no farm animal in this marketplace is 31+ years old, so a
 * bare value ≤ 30 is read as years and anything larger as months. Returns null
 * when there is no number at all, and clamps to a sane 0–600 months (50 years)
 * so a typo can't poison a range filter.
 */
export function parseAgeMonths(raw) {
  const n = firstNumber(raw);
  if (n == null) return null;
  const s = normalizeText(raw);
  const isMonths = /month|mahin|महिन|माह|mth|mo\b/.test(s);
  const isYears  = /year|yr|varsh|वर्ष|साल|वय/.test(s);
  let months;
  if (isMonths && !isYears) months = n;
  else if (isYears) months = n * 12;
  else months = n <= 30 ? n * 12 : n;
  months = Math.round(months);
  if (months < 0 || months > 600) return null;
  return months;
}

/**
 * "450 kg" / "450" / "4.5 quintal" → weight in KG. Quintal (100 kg) is the unit
 * cattle are actually weighed in at many markets, so it is understood too.
 * Clamped to 0–5000 kg.
 */
export function parseWeightKg(raw) {
  const n = firstNumber(raw);
  if (n == null) return null;
  const s = normalizeText(raw);
  let kg = n;
  if (/quintal|क्विंटल|qtl/.test(s)) kg = n * 100;
  else if (/\bton|टन/.test(s)) kg = n * 1000;
  else if (/\bg\b|gram|ग्रॅम/.test(s) && !/kg|किलो/.test(s)) kg = n / 1000;
  kg = Math.round(kg * 10) / 10;
  if (kg <= 0 || kg > 5000) return null;
  return kg;
}

/** "12 Litre/Day" / "12" / "१२" → litres per day. Clamped to 0–100 L/day. */
export function parseMilkLpd(raw) {
  const n = firstNumber(raw);
  if (n == null) return null;
  const lpd = Math.round(n * 10) / 10;
  if (lpd <= 0 || lpd > 100) return null;
  return lpd;
}

/**
 * Build the lowercased search haystack persisted on the row.
 *
 * Includes the animal's aliases in both scripts so a Marathi query matches an
 * English listing. The description is capped at 200 chars: enough for the
 * seller's own keywords ("jersey, high yield, Pune"), short enough that the
 * trigram index stays small.
 *
 * @param {{animal?:string, breed?:string, sellerLocation?:string, tags?:string[], description?:string}} l
 * @returns {string} never null — an empty listing yields '' (stored as-is)
 */
export function buildSearchText(l = {}) {
  const parts = [
    normalizeText(l.animal),
    normalizeText(l.breed),
    normalizeText(l.sellerLocation),
    ...(Array.isArray(l.tags) ? l.tags.map(normalizeText) : []),
    normalizeText(String(l.description ?? '').slice(0, 200)),
  ];

  // Alias expansion, driven by the animal field (and the breed, which sometimes
  // carries the animal word: "Murrah Buffalo").
  const seed = `${normalizeText(l.animal)} ${normalizeText(l.breed)}`.trim();
  for (const word of seed.split(' ')) {
    const canonical = ALIAS_TO_CANONICAL.get(word);
    if (!canonical) continue;
    parts.push(canonical, ...(ANIMAL_ALIASES[canonical] || []).map((a) => a.toLowerCase()));
  }

  return [...new Set(parts.filter(Boolean).join(' ').split(' '))].join(' ').slice(0, 1000);
}

/**
 * Derive every normalised column from the display fields of a listing payload.
 * Callers spread the result straight into a Prisma create/update.
 */
export function normalizedColumns(l = {}) {
  return {
    ageMonths:    parseAgeMonths(l.age),
    weightKg:     parseWeightKg(l.weight),
    milkYieldLpd: parseMilkLpd(l.milkYield),
    searchText:   buildSearchText(l),
  };
}
