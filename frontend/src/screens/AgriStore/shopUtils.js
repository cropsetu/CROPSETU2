/**
 * Shop data layer — the network rules the Shop screens were missing.
 *
 * ── What this fixes ──────────────────────────────────────────────────────────
 * AgriStoreHome fetched products like this:
 *
 *     async function fetchProducts() {
 *       setLoading(true);
 *       try { ... setProducts(items) }
 *       catch { setProducts([]) }        // ← every network blip empties the shop
 *       finally { setLoading(false) }
 *     }
 *
 * Three separate problems, all of which bite hardest on exactly the connection
 * a farmer has:
 *
 *   1. NO REQUEST CANCELLATION AND NO SEQUENCING. Type "urea", then "urea 50".
 *      On a slow link the first response can land after the second, and the
 *      older results silently replace the newer ones. There was nothing to stop
 *      it — no abort, no request id.
 *   2. AN ERROR WIPED THE SCREEN. `catch { setProducts([]) }` turns a dropped
 *      packet into the "coming soon, no products" empty state. CartScreen had
 *      the same shape and showed an EMPTY CART on a network error, which is a
 *      considerably worse thing to show someone.
 *   3. NO CACHE. Reopening the Shop out of signal showed nothing at all, even
 *      though the same 20 products had been on screen a minute earlier.
 *
 * ── What it does instead ─────────────────────────────────────────────────────
 * Every fetch carries a monotonic sequence number; a response older than the
 * newest one issued is dropped, not rendered. In-flight requests are aborted
 * when superseded. Failures return a TYPED error the UI can act on, and keep
 * whatever was already on screen. Successful catalogue reads are persisted to
 * AsyncStorage with a timestamp, so the next cold open paints instantly and says
 * how old it is.
 *
 * No new dependencies: AsyncStorage and axios' AbortController support are
 * already in the app.
 *
 * ── Why this file has no `api` import ────────────────────────────────────────
 * Everything here is pure logic or AsyncStorage: the sequencing rule, the error
 * taxonomy, the image transform, the money formatting. Keeping the axios client
 * out means all of it is unit-testable under the project's lightweight node Jest
 * config, without standing up a React Native runtime for a function that
 * rewrites a URL string. The network calls live in shopClient.js, which
 * re-exports everything below so screens have one import site.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Typed errors ──────────────────────────────────────────────────────────────
/**
 * Structured error codes. The screen switches on the CODE and offers the right
 * recovery action; the message is only ever the safe, user-facing text the API
 * client already produced. Raw server strings never reach the UI.
 */
export const SHOP_ERRORS = {
  OFFLINE: 'OFFLINE',
  TIMEOUT: 'TIMEOUT',
  SERVER: 'SERVER',
  MAINTENANCE: 'MAINTENANCE',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH: 'AUTH',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION: 'VALIDATION',
  UNKNOWN: 'UNKNOWN',
};

/** Recovery actions a screen can render for an error. */
export const SHOP_ACTIONS = {
  RETRY: 'RETRY',
  SIGN_IN: 'SIGN_IN',
  CHANGE_LOCATION: 'CHANGE_LOCATION',
  CLEAR_FILTERS: 'CLEAR_FILTERS',
  UPDATE_CART: 'UPDATE_CART',
  CHECK_PAYMENT: 'CHECK_PAYMENT',
  CONTACT_SUPPORT: 'CONTACT_SUPPORT',
};

const ACTION_FOR = {
  [SHOP_ERRORS.OFFLINE]: SHOP_ACTIONS.RETRY,
  [SHOP_ERRORS.TIMEOUT]: SHOP_ACTIONS.RETRY,
  [SHOP_ERRORS.SERVER]: SHOP_ACTIONS.RETRY,
  [SHOP_ERRORS.MAINTENANCE]: SHOP_ACTIONS.RETRY,
  [SHOP_ERRORS.RATE_LIMITED]: SHOP_ACTIONS.RETRY,
  [SHOP_ERRORS.AUTH]: SHOP_ACTIONS.SIGN_IN,
  [SHOP_ERRORS.NOT_FOUND]: SHOP_ACTIONS.RETRY,
  [SHOP_ERRORS.CONFLICT]: SHOP_ACTIONS.UPDATE_CART,
  [SHOP_ERRORS.VALIDATION]: SHOP_ACTIONS.RETRY,
  [SHOP_ERRORS.UNKNOWN]: SHOP_ACTIONS.RETRY,
};

/**
 * Classify an axios error into something the UI can act on.
 *
 * The previous behaviour everywhere in Shop was a bare `catch {}` — the farmer
 * got "no products" whether the server was down, their signal had dropped, or
 * their session had expired, and the correct next step is different in all three.
 */
export function classifyError(err) {
  // A superseded request is not an error and must never be rendered as one.
  if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return null;

  const status = err?.response?.status;
  let code = SHOP_ERRORS.UNKNOWN;

  if (err?.message === 'Network Error') code = SHOP_ERRORS.OFFLINE;
  else if (err?.code === 'ECONNABORTED') code = SHOP_ERRORS.TIMEOUT;
  else if (status === 401) code = SHOP_ERRORS.AUTH;
  else if (status === 404) code = SHOP_ERRORS.NOT_FOUND;
  else if (status === 409) code = SHOP_ERRORS.CONFLICT;
  else if (status === 400 || status === 422) code = SHOP_ERRORS.VALIDATION;
  else if (status === 429) code = SHOP_ERRORS.RATE_LIMITED;
  else if (status === 503) code = SHOP_ERRORS.MAINTENANCE;
  else if (status >= 500) code = SHOP_ERRORS.SERVER;

  return {
    code,
    action: ACTION_FOR[code] || SHOP_ACTIONS.RETRY,
    // `userMessage` is set by the shared API client's interceptor and is already
    // sanitised — no stack traces, no SQL, no upstream payloads.
    message: err?.userMessage || 'Something went wrong. Please try again.',
    // Structured detail the backend attaches to quote / compliance refusals, so
    // the cart screen can point at the exact line that is blocked.
    issues: err?.response?.data?.error?.details?.issues || null,
    reason: err?.response?.data?.error?.details?.reason || null,
    // For a support ticket. The API attaches it to every error envelope.
    requestId: err?.response?.data?.error?.requestId || null,
    status: status || null,
  };
}

// ── Sequenced, cancellable requests ───────────────────────────────────────────
/**
 * A request lane.
 *
 * One lane per logical stream (the product grid is one lane, the offers sheet is
 * another). Issuing a request on a lane aborts whatever that lane had in flight
 * and stamps the new request with the next sequence number. A response is only
 * delivered if its sequence is still the newest — which is what makes a slow
 * "urea" response unable to overwrite a fast "urea 50" one.
 */
export function createRequestLane() {
  let seq = 0;
  let controller = null;

  return {
    /**
     * @param {(signal: AbortSignal) => Promise<any>} run
     * @returns {Promise<{stale: boolean, data?: any, error?: object|null}>}
     */
    async send(run) {
      // Abort the previous request on this lane: it is superseded, and letting it
      // finish burns bandwidth on a connection that has very little.
      controller?.abort();
      controller = new AbortController();

      const mySeq = ++seq;
      const myController = controller;

      try {
        const data = await run(myController.signal);
        // A response that is no longer the newest is DROPPED, never rendered.
        if (mySeq !== seq) return { stale: true };
        return { stale: false, data };
      } catch (err) {
        if (mySeq !== seq) return { stale: true };
        const error = classifyError(err);
        if (!error) return { stale: true }; // deliberately cancelled
        return { stale: false, error };
      }
    },
    cancel() { controller?.abort(); controller = null; },
  };
}

// ── Offline cache ─────────────────────────────────────────────────────────────
const CACHE_PREFIX = '@shop_cache:';
/** Cached catalogue is shown immediately and refreshed; this bounds how stale. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Read a cached payload with its age.
 *
 * Returns `{ data, cachedAt, ageMs }` so the screen can SAY how old it is.
 * Showing month-old prices as if they were live is worse than showing nothing;
 * showing five-minute-old prices labelled "updated 5 minutes ago" is better than
 * a spinner on a connection that is not going to come back.
 *
 * NOTE: catalogue data only. Nothing user-specific (cart, orders, addresses) is
 * cached here — a shared device would leak one farmer's cart to the next.
 */
export async function readCache(key) {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ageMs = Date.now() - (parsed.cachedAt || 0);
    if (ageMs > CACHE_MAX_AGE_MS) return null;
    return { data: parsed.data, cachedAt: parsed.cachedAt, ageMs };
  } catch {
    return null; // a corrupt cache entry is a cache miss, never a crash
  }
}

export async function writeCache(key, data) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ cachedAt: Date.now(), data }));
  } catch { /* a full disk must not break the shop */ }
}

/** Human-readable cache age, for the "showing saved results" banner. */
export function formatCacheAge(ageMs, t) {
  const mins = Math.round(ageMs / 60000);
  if (mins < 1) return t('shop.cacheJustNow', 'Updated just now');
  if (mins < 60) return t('shop.cacheMinutes', { count: mins, defaultValue: `Updated ${mins} min ago` });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('shop.cacheHours', { count: hours, defaultValue: `Updated ${hours} h ago` });
  return t('shop.cacheOld', 'Saved earlier');
}

// ── Images ────────────────────────────────────────────────────────────────────
/**
 * Turn a full-resolution catalogue image into a card-sized thumbnail.
 *
 * Product cards were rendering `item.images[0]` — the original upload — into a
 * 130px-tall box. On a 20-product grid that is twenty full-resolution downloads
 * and twenty full-resolution decodes for images displayed at a fraction of their
 * size, which is both the slowest part of the screen and the largest share of a
 * farmer's data bill.
 *
 * Images are already on Cloudinary, which resizes on the fly from the URL, so
 * this needs no new dependency and no re-upload: inserting a transformation
 * segment after `/upload/` is the whole change. `f_auto` picks WebP/AVIF where
 * the client supports it, `q_auto` sets quality by content.
 *
 * Any non-Cloudinary URL is returned untouched.
 */
export function thumbUrl(url, width = 320) {
  if (typeof url !== 'string' || !url) return url;
  if (!url.includes('/upload/')) return url;
  // Never transform twice — an already-transformed URL has a segment here.
  if (/\/upload\/[a-z]_[^/]+\//.test(url)) return url;
  return url.replace('/upload/', `/upload/f_auto,q_auto,c_limit,w_${Math.round(width)}/`);
}

/** Detail-screen gallery: bigger, still not the raw original. */
export const detailImageUrl = (url) => thumbUrl(url, 900);

// ── Retry with backoff ────────────────────────────────────────────────────────
/**
 * Retry a SAFE (idempotent) read with exponential backoff and jitter.
 *
 * Bounded at `attempts` — never unlimited. Jitter matters more than usual here:
 * when a village tower comes back, every phone on it retries at the same instant,
 * and a fixed backoff turns recovery into a synchronised stampede.
 *
 * Deliberately NOT used for order or payment creation. Those carry an
 * Idempotency-Key and are retried by the user, not silently by the client.
 */
export async function retryRead(fn, { attempts = 3, baseMs = 400 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const info = classifyError(err);
      if (!info) throw err;                       // cancelled — do not retry
      // Retrying a 401/404/409/422 just repeats the same answer more slowly.
      const retryable = [SHOP_ERRORS.OFFLINE, SHOP_ERRORS.TIMEOUT, SHOP_ERRORS.SERVER, SHOP_ERRORS.MAINTENANCE];
      if (!retryable.includes(info.code) || i === attempts - 1) throw err;
      lastError = err;
      const delay = baseMs * 2 ** i + Math.random() * baseMs;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ── Recent searches ───────────────────────────────────────────────────────────
const RECENT_KEY = '@shop_recent_searches';
const RECENT_MAX = 8;

export async function readRecentSearches() {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export async function pushRecentSearch(term) {
  const clean = String(term || '').trim();
  if (clean.length < 2) return;
  try {
    const current = await readRecentSearches();
    const next = [clean, ...current.filter((s) => s.toLowerCase() !== clean.toLowerCase())].slice(0, RECENT_MAX);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* non-essential */ }
}

export async function clearRecentSearches() {
  try { await AsyncStorage.removeItem(RECENT_KEY); } catch { /* non-essential */ }
}

// ── Money formatting ──────────────────────────────────────────────────────────
/**
 * Format rupees for an Indian audience.
 *
 * The screens were calling `price.toLocaleString()` with no locale, which gives
 * the device's grouping (1,234,567) rather than the Indian one (12,34,567) that
 * every farmer reads prices in.
 */
export function inr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Discount percentage — computed from MRP and price, never taken from the server
 * as a display string and never invented.
 *
 * Returns 0 unless there is a genuine, positive difference, so a listing with no
 * MRP shows no "% off" badge at all rather than a fabricated one.
 */
export function discountPct(mrp, price) {
  const m = Number(mrp); const p = Number(price);
  if (!Number.isFinite(m) || !Number.isFinite(p) || m <= 0 || p <= 0 || m <= p) return 0;
  return Math.round(((m - p) / m) * 100);
}
