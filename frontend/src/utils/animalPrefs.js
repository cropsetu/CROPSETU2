/**
 * Small on-device preferences for the animal marketplace: the location the
 * farmer chose by hand, and their recent searches.
 *
 * Both are stored with AsyncStorage rather than secureCache: a district name
 * and a list of breed searches are not secrets, and putting them in the
 * Keychain would cost a native round-trip on every keystroke. The GPS FIX is
 * never persisted here — only a place name the user typed themselves, which is
 * why saving it needs no separate consent prompt.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_LOCATION = '@animals:manualLocation';
const KEY_RECENT   = '@animals:recentSearches';
const MAX_RECENT   = 6;

/**
 * @typedef {{label:string, district?:string, taluka?:string, village?:string,
 *            state?:string, pincode?:string, savedAt:number}} ManualLocation
 */

/** The place the user picked by hand, or null. Never throws. */
export async function getManualLocation() {
  try {
    const raw = await AsyncStorage.getItem(KEY_LOCATION);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persist a hand-picked place. Pass null to forget it. */
export async function setManualLocation(loc) {
  try {
    if (!loc) return void (await AsyncStorage.removeItem(KEY_LOCATION));
    await AsyncStorage.setItem(KEY_LOCATION, JSON.stringify({ ...loc, savedAt: Date.now() }));
  } catch {
    /* ignore — the filter still works for this session */
  }
}

/** Most-recent-first list of past searches. */
export async function getRecentSearches() {
  try {
    const raw = await AsyncStorage.getItem(KEY_RECENT);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/**
 * Record a search. Case-insensitively de-duplicated and moved to the front, so
 * repeating a search reorders the list instead of filling it with near-copies.
 */
export async function pushRecentSearch(term) {
  const q = String(term || '').trim();
  if (q.length < 2) return getRecentSearches();
  try {
    const current = await getRecentSearches();
    const next = [q, ...current.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(KEY_RECENT, JSON.stringify(next));
    return next;
  } catch {
    return getRecentSearches();
  }
}

export async function clearRecentSearches() {
  try { await AsyncStorage.removeItem(KEY_RECENT); } catch { /* ignore */ }
  return [];
}

/** "2 minutes ago" style label for the offline-cache banner. */
export function relativeTime(ms) {
  if (!ms) return '';
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}
