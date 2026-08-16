/**
 * Shop observability — latency percentiles and failure counters.
 *
 * ── Why percentiles, not averages ────────────────────────────────────────────
 * The acceptance criteria ask for p50 and p95 rather than a mean, and that is
 * the right ask: a mean latency hides exactly the failure this module cares
 * about. If 95% of catalogue reads take 80 ms and 5% take 9 s because they miss
 * the cache and fall through to a filtered count over the whole catalogue, the
 * mean reads as a comfortable 500 ms while one farmer in twenty is staring at a
 * spinner. The mean cannot see that; p95 is the number that can.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 * Deliberately the same shape as utils/cacheMetrics.js: in-process, cumulative
 * since boot, no new dependency, exposed as flat numbers on /readyz for whatever
 * scraper is pointed at it. A metrics backend can be added later without
 * changing a single call site.
 *
 * Latency uses a bounded ring buffer per label (the most recent N samples) and
 * computes percentiles on read. Exact for the window, O(1) to record, and its
 * memory is capped no matter how much traffic arrives — which a growing array of
 * every sample since boot would not be.
 *
 * ── What is deliberately NOT recorded ────────────────────────────────────────
 * No user ids, no order ids, no amounts, no product ids, and above all no
 * indication of WHICH product was bought. A farmer's pesticide purchase is
 * sensitive: aggregated over a village it says something about a pest outbreak,
 * and attached to a user it is a private health-and-livelihood fact. Labels are
 * route TEMPLATES (`/products/:id`, never `/products/8f3a…`) and counters are
 * counts. There is nothing in this module that could identify a person or a
 * purchase, which is what makes it safe to ship to a third-party dashboard.
 */
import logger from '../utils/logger.js';

/** Samples retained per label. ~8 KB per label at 8 bytes a sample. */
const WINDOW = 500;

/** label -> { buf: Float64Array, n: number, count: number, sum: number, max: number } */
const _latency = new Map();
/** name -> count */
const _counters = new Map();
/** Alert baseline — the counter values at the previous checkShopAlerts() call. */
let _last = { checkoutFail: 0, checkoutOk: 0, paymentFail: 0, orphaned: 0 };

function lane(label) {
  let l = _latency.get(label);
  if (!l) {
    l = { buf: new Float64Array(WINDOW), n: 0, count: 0, sum: 0, max: 0 };
    _latency.set(label, l);
  }
  return l;
}

/**
 * Record a duration in milliseconds against a label.
 * @param {string} label  route template or operation name — NEVER an id
 * @param {number} ms
 */
export function recordLatency(label, ms) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const l = lane(label);
  l.buf[l.n % WINDOW] = ms;
  l.n += 1;
  l.count += 1;
  l.sum += ms;
  if (ms > l.max) l.max = ms;
}

/** Increment a named counter. */
export function recordEvent(name, by = 1) {
  _counters.set(name, (_counters.get(name) || 0) + by);
}

/**
 * Shop event names.
 *
 * Enumerated rather than free-form so a typo cannot silently create a parallel
 * metric that nobody is graphing — the classic way an alert stops firing.
 */
export const SHOP_EVENTS = {
  CART_ADD_OK: 'cart_add_ok',
  CART_ADD_FAIL: 'cart_add_fail',
  CART_ADD_BLOCKED_COMPLIANCE: 'cart_add_blocked_compliance',
  CHECKOUT_OK: 'checkout_ok',
  CHECKOUT_FAIL: 'checkout_fail',
  CHECKOUT_BLOCKED_ISSUES: 'checkout_blocked_issues',
  ORDER_CREATE_FAIL: 'order_create_fail',
  PAYMENT_INITIATE_OK: 'payment_initiate_ok',
  PAYMENT_INITIATE_FAIL: 'payment_initiate_fail',
  PAYMENT_CONFIRM_OK: 'payment_confirm_ok',
  PAYMENT_CONFIRM_FAIL: 'payment_confirm_fail',
  PAYMENT_CAPTURED_NO_ORDER: 'payment_captured_no_order',
  WEBHOOK_OK: 'webhook_ok',
  WEBHOOK_BAD_SIGNATURE: 'webhook_bad_signature',
  WEBHOOK_DUPLICATE: 'webhook_duplicate',
  WEBHOOK_FAIL: 'webhook_fail',
  INVENTORY_CONFLICT: 'inventory_conflict',
  INVENTORY_OVERSELL_BLOCKED: 'inventory_oversell_blocked',
  OUT_OF_STOCK_HIT: 'out_of_stock_hit',
  QUOTE_OK: 'quote_ok',
  RESERVATION_HELD: 'reservation_held',
  RESERVATION_CONSUMED: 'reservation_consumed',
  RESERVATION_RELEASED: 'reservation_released',
  RESERVATION_EXPIRED: 'reservation_expired',
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  // Nearest-rank. With a 500-sample window the interpolation difference is
  // noise, and nearest-rank always returns a value that actually occurred.
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

/** Percentiles for one label over its retained window. */
export function latencyFor(label) {
  const l = _latency.get(label);
  if (!l || !l.count) return null;
  const size = Math.min(l.n, WINDOW);
  const sorted = Array.from(l.buf.subarray(0, size)).sort((a, b) => a - b);
  return {
    count: l.count,
    windowSize: size,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: Math.round(l.max * 100) / 100,
    // Reported alongside the percentiles, never instead of them — see the header.
    avg: Math.round((l.sum / l.count) * 100) / 100,
  };
}

/**
 * Flat, scrapeable snapshot for /readyz.
 *
 * Every value is a number or null. Nothing here is an identifier.
 */
export function getShopMetrics() {
  const latency = {};
  for (const label of _latency.keys()) latency[label] = latencyFor(label);

  const counters = {};
  for (const [k, v] of _counters) counters[k] = v;

  // Derived rates, computed here so a dashboard does not have to know the
  // arithmetic — and so the denominator is never accidentally the wrong counter.
  const ratio = (a, b) => {
    const total = (counters[a] || 0) + (counters[b] || 0);
    return total ? Number(((counters[a] || 0) / total).toFixed(4)) : null;
  };

  return {
    latency,
    counters,
    rates: {
      checkout_failure_rate: ratio(SHOP_EVENTS.CHECKOUT_FAIL, SHOP_EVENTS.CHECKOUT_OK),
      cart_add_failure_rate: ratio(SHOP_EVENTS.CART_ADD_FAIL, SHOP_EVENTS.CART_ADD_OK),
      payment_confirm_failure_rate: ratio(SHOP_EVENTS.PAYMENT_CONFIRM_FAIL, SHOP_EVENTS.PAYMENT_CONFIRM_OK),
      // Share of add-to-cart attempts that hit an out-of-stock offer. The brief's
      // "out-of-stock rate" — a rising value here means the catalogue is
      // advertising stock it does not have.
      out_of_stock_rate: ratio(SHOP_EVENTS.OUT_OF_STOCK_HIT, SHOP_EVENTS.CART_ADD_OK),
    },
  };
}

/** Flattened `shop_*` numbers for the /readyz metrics block. */
export function getShopMetricsFlat() {
  const m = getShopMetrics();
  const out = {};
  for (const [label, l] of Object.entries(m.latency)) {
    if (!l) continue;
    const key = `shop_latency_${label.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase()}`;
    out[`${key}_p50_ms`] = l.p50;
    out[`${key}_p95_ms`] = l.p95;
    out[`${key}_count`] = l.count;
  }
  for (const [k, v] of Object.entries(m.counters)) out[`shop_${k}_total`] = v;
  for (const [k, v] of Object.entries(m.rates)) out[`shop_${k}`] = v ?? 0;
  return out;
}

/** Test-only: clear counters so they do not leak between test files. */
export function resetShopMetrics() {
  _latency.clear();
  _counters.clear();
  // The alert baseline MUST reset with the counters. Clearing one and not the
  // other leaves the windowed delta negative (0 minus the old high-water mark),
  // which silently suppresses the next alert — the failure mode where an alert
  // stops firing and nobody notices, because a missing alert looks exactly like
  // a healthy system.
  _last = { checkoutFail: 0, checkoutOk: 0, paymentFail: 0, orphaned: 0 };
}

/**
 * Collapse a request path to a route TEMPLATE.
 *
 * `/products/8f3a91c2-…` becomes `/products/:id`. This is the whole reason these
 * metrics are safe to export: without it, every product id a farmer opened would
 * end up as a distinct metric label in a third-party dashboard — an itemised
 * browsing history, and for crop-protection products a sensitive one. It also
 * keeps cardinality bounded, which is what stops a metrics backend falling over.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_ID_RE = /\b[A-Za-z0-9_-]{16,}\b/g;

export function routeTemplate(path) {
  return String(path || '/')
    .replace(UUID_RE, ':id')
    .replace(LONG_ID_RE, ':id')
    .replace(/\/\d+/g, '/:n')
    .slice(0, 80);
}

/**
 * Express middleware: time every response and label it by route template.
 *
 * Uses `res.on('finish')` so the measurement covers the handler AND the response
 * write — the part a farmer on a 2G link actually waits through, and the part a
 * handler-only timer misses entirely.
 */
export function shopMetricsMiddleware(prefix = 'shop') {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        const label = `${prefix} ${req.method} ${routeTemplate(req.baseUrl ? req.path : req.path)}`;
        recordLatency(label, ms);
        // Search is called out separately: it is the interaction with the
        // tightest responsiveness budget, and it is buried inside the generic
        // product-list label otherwise.
        if (req.path === '/products' && req.query?.search) {
          recordLatency(`${prefix} search`, ms);
        }
        if (res.statusCode >= 500) recordEvent('server_error');
      } catch { /* metrics must never break a response */ }
    });
    next();
  };
}

/**
 * Emit [ALERT] markers when the shop is degrading, for log-based alerting.
 *
 * Same contract as checkCacheAlerts: logger.error, because logger.warn is
 * suppressed in production. Windowed against the previous call so a cold-start
 * blip does not latch, and a sustained problem actually trips.
 */

export function checkShopAlerts({
  minSamples = 20,
  checkoutFailureCeil = 0.15,
  p95CeilMs = 2500,
} = {}) {
  const c = (k) => _counters.get(k) || 0;

  const dFail = c(SHOP_EVENTS.CHECKOUT_FAIL) - _last.checkoutFail;
  const dOk = c(SHOP_EVENTS.CHECKOUT_OK) - _last.checkoutOk;
  const dOrphan = c(SHOP_EVENTS.PAYMENT_CAPTURED_NO_ORDER) - _last.orphaned;
  const window = dFail + dOk;

  const result = { checkoutAlert: false, latencyAlert: false, orphanAlert: false, windowCheckouts: window };

  if (window >= minSamples) {
    const rate = dFail / window;
    if (rate > checkoutFailureCeil) {
      result.checkoutAlert = true;
      logger.error(
        { failureRate: Number(rate.toFixed(3)), window, ceiling: checkoutFailureCeil },
        '[ALERT][Shop] checkout failure rate above threshold',
      );
    }
  }

  const list = latencyFor('shop GET /products');
  if (list && list.windowSize >= minSamples && list.p95 > p95CeilMs) {
    result.latencyAlert = true;
    logger.error({ p95: list.p95, ceiling: p95CeilMs }, '[ALERT][Shop] product list p95 latency above threshold');
  }

  // Any captured payment with no order is money held against nothing. There is
  // no acceptable rate for this, so it alerts on a single occurrence.
  if (dOrphan > 0) {
    result.orphanAlert = true;
    logger.error({ count: dOrphan }, '[ALERT][Shop] captured payments with no order — manual refund required');
  }

  _last = {
    checkoutFail: c(SHOP_EVENTS.CHECKOUT_FAIL),
    checkoutOk: c(SHOP_EVENTS.CHECKOUT_OK),
    paymentFail: c(SHOP_EVENTS.PAYMENT_CONFIRM_FAIL),
    orphaned: c(SHOP_EVENTS.PAYMENT_CAPTURED_NO_ORDER),
  };
  return result;
}
