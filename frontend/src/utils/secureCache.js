/**
 * secureCache — encrypted-at-rest storage for sensitive local data.
 *
 * Native (iOS/Android): values are persisted via expo-secure-store, which
 * encrypts them with a hardware-backed key (iOS Keychain / Android Keystore).
 * Nothing readable as plaintext lands on disk, so the data is safe even on a
 * rooted/compromised device. expo-secure-store warns (and can fail on Android)
 * above ~2 KB per entry, so larger JSON blobs are transparently split into
 * fixed-size chunks — each its own encrypted entry — with a small manifest
 * recording the chunk count.
 *
 * Migration: the first read of a key checks the old AsyncStorage location for a
 * pre-existing plaintext value, copies it into secure storage, and SCRUBS the
 * plaintext copy. Existing users' PII is moved out of cleartext on next launch.
 *
 * Web: there is no Keychain/Keystore, and Web Storage is readable by any
 * injected/XSS script. We deliberately leave web on AsyncStorage (localStorage)
 * unchanged — the "rooted device" threat model is native-only, and web's
 * cleartext concern is a separate (XSS) problem. See utils/storage.js for the
 * matching token-storage posture.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const IS_WEB = Platform.OS === 'web';

// Lazy require so web bundles never pull in the native module.
let _SecureStore = null;
function getSecureStore() {
  if (!_SecureStore) _SecureStore = require('expo-secure-store');
  return _SecureStore;
}

// Stay safely under expo-secure-store's 2048-byte per-value limit.
const CHUNK_SIZE = 1800;

// expo-secure-store keys allow [A-Za-z0-9._-]; '__sc' suffixes stay in range.
const manifestKey = (key) => `${key}__scmf`;
const chunkKey = (key, i) => `${key}__sc${i}`;

// ── Native chunked secure storage ─────────────────────────────────────────────
async function secureSetRaw(key, str) {
  const S = getSecureStore();

  const chunks = [];
  for (let i = 0; i < str.length; i += CHUNK_SIZE) chunks.push(str.slice(i, i + CHUNK_SIZE));
  // A zero-length value still needs one (empty) chunk so reads round-trip ''.
  if (chunks.length === 0) chunks.push('');

  // How many chunks did the previous value use? Needed to clean up leftovers
  // when the new value is shorter.
  let prevCount = 0;
  try {
    const m = await S.getItemAsync(manifestKey(key));
    if (m) prevCount = JSON.parse(m).n || 0;
  } catch { /* treat as no previous value */ }

  // Write all chunks, THEN the manifest (the manifest is the commit point: a
  // crash before it leaves the previous value intact).
  for (let i = 0; i < chunks.length; i++) {
    await S.setItemAsync(chunkKey(key, i), chunks[i]);
  }
  await S.setItemAsync(manifestKey(key), JSON.stringify({ n: chunks.length }));

  // Drop any now-unused trailing chunks from a longer previous value. Harmless
  // if this is interrupted — the manifest already ignores them.
  for (let i = chunks.length; i < prevCount; i++) {
    try { await S.deleteItemAsync(chunkKey(key, i)); } catch { /* best-effort */ }
  }
}

async function secureGetRaw(key) {
  const S = getSecureStore();

  let n = 0;
  try {
    const m = await S.getItemAsync(manifestKey(key));
    if (!m) return null;
    n = JSON.parse(m).n || 0;
  } catch {
    return null;
  }

  let out = '';
  for (let i = 0; i < n; i++) {
    const c = await S.getItemAsync(chunkKey(key, i));
    if (c == null) return null; // torn/partial write → treat as a cache miss
    out += c;
  }
  return out;
}

async function secureDeleteRaw(key) {
  const S = getSecureStore();
  let n = 0;
  try {
    const m = await S.getItemAsync(manifestKey(key));
    if (m) n = JSON.parse(m).n || 0;
  } catch { /* ignore */ }
  for (let i = 0; i < n; i++) {
    try { await S.deleteItemAsync(chunkKey(key, i)); } catch { /* best-effort */ }
  }
  try { await S.deleteItemAsync(manifestKey(key)); } catch { /* best-effort */ }
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Read a string value. On native, migrates+scrubs any legacy plaintext that an
 * older app version wrote to AsyncStorage under the same key.
 */
export async function getSecureItem(key) {
  if (IS_WEB) return AsyncStorage.getItem(key);

  const v = await secureGetRaw(key);
  if (v != null) return v;

  // One-time migration of a pre-existing plaintext value.
  try {
    const legacy = await AsyncStorage.getItem(key);
    if (legacy != null) {
      await secureSetRaw(key, legacy);
      await AsyncStorage.removeItem(key); // scrub the cleartext copy
      return legacy;
    }
  } catch { /* migration is best-effort */ }

  return null;
}

/** Persist a string value to encrypted storage (native) or AsyncStorage (web). */
export async function setSecureItem(key, value) {
  const str = typeof value === 'string' ? value : String(value);
  if (IS_WEB) return AsyncStorage.setItem(key, str);
  return secureSetRaw(key, str);
}

/** Remove a value (all chunks + manifest, and any legacy plaintext). */
export async function removeSecureItem(key) {
  if (IS_WEB) return AsyncStorage.removeItem(key);
  await secureDeleteRaw(key);
  try { await AsyncStorage.removeItem(key); } catch { /* ignore */ }
}

/** Read and JSON.parse a value. Returns null if absent or unparseable. */
export async function getSecureJSON(key) {
  const raw = await getSecureItem(key);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** JSON.stringify and persist a value to encrypted storage. */
export async function setSecureJSON(key, obj) {
  return setSecureItem(key, JSON.stringify(obj));
}
