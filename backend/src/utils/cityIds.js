/**
 * IMD City IDs for major Maharashtra districts + other metros.
 * Source: city.imd.gov.in — IDs verified manually.
 *
 * Usage:
 *   import { getCityId } from '../utils/cityIds.js';
 *   const id = getCityId('Pune'); // → '43063'
 */

const CITY_MAP = {
  // Maharashtra districts
  'Pune':         '43063',
  'Mumbai':       '43003',
  'Nagpur':       '42867',
  'Nashik':       '43019',
  'Aurangabad':   '43085',
  'Solapur':      '43159',
  'Kolhapur':     '43176',
  'Amravati':     '42854',
  'Nanded':       '43138',
  'Satara':       '43126',
  'Sangli':       '43167',
  'Latur':        '43149',
  'Jalgaon':      '42966',
  'Dhule':        '43012',
  'Akola':        '42884',
  'Yavatmal':     '42916',
  'Chandrapur':   '42933',
  'Osmanabad':    '43143',
  'Wardha':       '42879',
  'Buldhana':     '42895',

  // Other major Indian cities
  'Delhi':        '42182',
  'Bangalore':    '43295',
  'Hyderabad':    '43128',
  'Chennai':      '43279',
  'Kolkata':      '42809',
  'Ahmedabad':    '42647',
  'Jaipur':       '42357',
  'Lucknow':      '42369',
  'Bhopal':       '42666',
};

// Built ONCE at module load (not per request): lowercase-name → id for O(1)
// case-insensitive lookups. LOWER_ENTRIES is the same data as an array, used
// only by the substring fallback so it never recomputes toLowerCase() per call.
const LOWER_MAP = new Map(
  Object.entries(CITY_MAP).map(([name, id]) => [name.toLowerCase(), id])
);
const LOWER_ENTRIES = [...LOWER_MAP.entries()];

/**
 * Returns the IMD city ID for a city name (case-insensitive).
 * Returns null if not found.
 * @param {string} cityName
 * @returns {string|null}
 */
export function getCityId(cityName) {
  if (!cityName) return null;
  const normalized = String(cityName).trim();

  // Exact match (O(1))
  if (CITY_MAP[normalized]) return CITY_MAP[normalized];

  const lower = normalized.toLowerCase();

  // Case-insensitive exact match (O(1))
  const hit = LOWER_MAP.get(lower);
  if (hit) return hit;

  // Substring fallback — input contains a known city name (e.g. "Pune District").
  // Inherently a scan, but only reached when both exact lookups miss, and it
  // iterates precomputed lowercase keys in insertion order (matching the old
  // Object.entries() order, so the chosen match is unchanged).
  for (const [k, id] of LOWER_ENTRIES) {
    if (lower.includes(k)) return id;
  }
  return null;
}
