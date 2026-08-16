/**
 * Shop observability.
 *
 * Two properties matter here and both are easy to get wrong silently:
 *
 *   1. PERCENTILES, NOT AVERAGES. The acceptance criteria ask for p50/p95
 *      because a mean hides the failure that matters — 5% of requests taking 9 s
 *      barely moves an average built mostly from 80 ms samples, while one farmer
 *      in twenty stares at a spinner.
 *   2. NO IDENTIFIERS IN LABELS. A metric label per product id is an itemised
 *      browsing history, and for crop-protection products a sensitive one. The
 *      redaction is the thing that makes these metrics safe to export at all, so
 *      it is tested directly rather than assumed.
 */
import {
  recordLatency, recordEvent, latencyFor, getShopMetrics, getShopMetricsFlat,
  resetShopMetrics, routeTemplate, checkShopAlerts, SHOP_EVENTS,
} from '../../../src/services/shopMetrics.service.js';

beforeEach(() => resetShopMetrics());

describe('latency percentiles', () => {
  test('p95 exposes a tail an average would bury', () => {
    // 95 fast requests and 5 disastrous ones — a realistic cache-miss profile.
    for (let i = 0; i < 95; i++) recordLatency('shop GET /products', 80);
    for (let i = 0; i < 5; i++) recordLatency('shop GET /products', 9000);

    const l = latencyFor('shop GET /products');

    expect(l.count).toBe(100);
    expect(l.p50).toBe(80);
    // The number that can see the problem…
    expect(l.p95).toBeGreaterThanOrEqual(80);
    expect(l.max).toBe(9000);
    // …versus the one that cannot: a ~526 ms mean reads as perfectly healthy.
    expect(l.avg).toBeLessThan(600);
  });

  test('p50 is the median, not the mean', () => {
    [1, 2, 3, 4, 100].forEach((ms) => recordLatency('x', ms));
    const l = latencyFor('x');
    expect(l.p50).toBe(3);
    expect(l.avg).toBe(22);
  });

  test('memory is bounded — the window caps at 500 samples', () => {
    for (let i = 0; i < 5000; i++) recordLatency('big', i);
    const l = latencyFor('big');
    // Every sample is counted…
    expect(l.count).toBe(5000);
    // …but only the most recent 500 are retained, so a busy process cannot grow
    // an unbounded array of every request since boot.
    expect(l.windowSize).toBe(500);
  });

  test('an unrecorded label reports nothing rather than zero', () => {
    // Zero would look like a fast endpoint. Null looks like no data, which is
    // what it is.
    expect(latencyFor('never-seen')).toBeNull();
  });

  test('ignores nonsense values instead of poisoning the percentiles', () => {
    recordLatency('y', 10);
    recordLatency('y', NaN);
    recordLatency('y', -5);
    recordLatency('y', Infinity);
    expect(latencyFor('y').count).toBe(1);
  });
});

describe('routeTemplate — the privacy guard', () => {
  test('strips product UUIDs from the label', () => {
    expect(routeTemplate('/products/8f3a91c2-1b4d-4a2e-9c3f-77aa11bb22cc'))
      .toBe('/products/:id');
  });

  test('strips ids from nested paths', () => {
    expect(routeTemplate('/products/8f3a91c2-1b4d-4a2e-9c3f-77aa11bb22cc/offers'))
      .toBe('/products/:id/offers');
    expect(routeTemplate('/orders/payment-status/order_QxYzAbCd1234567890'))
      .toBe('/orders/payment-status/:id');
  });

  test('leaves a genuine route alone', () => {
    expect(routeTemplate('/cart/quote')).toBe('/cart/quote');
    expect(routeTemplate('/products')).toBe('/products');
  });

  test('a label can never carry an id, however the path is shaped', () => {
    const label = routeTemplate('/products/8f3a91c2-1b4d-4a2e-9c3f-77aa11bb22cc');
    // This is the assertion that keeps a farmer's pesticide browsing out of a
    // third-party metrics backend.
    expect(label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  test('is length-bounded so a hostile path cannot explode label cardinality', () => {
    expect(routeTemplate(`/${'a'.repeat(500)}`).length).toBeLessThanOrEqual(80);
  });
});

describe('counters and derived rates', () => {
  test('computes a failure rate against the right denominator', () => {
    for (let i = 0; i < 9; i++) recordEvent(SHOP_EVENTS.CHECKOUT_OK);
    recordEvent(SHOP_EVENTS.CHECKOUT_FAIL);

    const m = getShopMetrics();
    expect(m.counters[SHOP_EVENTS.CHECKOUT_OK]).toBe(9);
    // 1 failure in 10 attempts — not 1/9.
    expect(m.rates.checkout_failure_rate).toBeCloseTo(0.1, 4);
  });

  test('a rate with no samples is null, not zero', () => {
    // Zero would read as "no failures", which is a different claim from "no data".
    expect(getShopMetrics().rates.checkout_failure_rate).toBeNull();
  });

  test('flattens to scrapeable numbers with no identifiers', () => {
    recordLatency('shop GET /products', 120);
    recordEvent(SHOP_EVENTS.CART_ADD_OK);

    const flat = getShopMetricsFlat();
    expect(flat['shop_latency_shop_get_products_p50_ms']).toBe(120);
    expect(flat['shop_cart_add_ok_total']).toBe(1);
    for (const [k, v] of Object.entries(flat)) {
      expect(typeof v === 'number' || v === null).toBe(true);
      expect(k).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });
});

describe('alerting', () => {
  test('a single captured-payment-with-no-order alerts immediately', () => {
    recordEvent(SHOP_EVENTS.PAYMENT_CAPTURED_NO_ORDER);
    // There is no acceptable rate for money held against nothing, so this does
    // not wait for a threshold.
    expect(checkShopAlerts().orphanAlert).toBe(true);
  });

  test('does not re-alert on the same occurrence', () => {
    recordEvent(SHOP_EVENTS.PAYMENT_CAPTURED_NO_ORDER);
    expect(checkShopAlerts().orphanAlert).toBe(true);
    // Windowed against the previous call, so a latched alert does not fire
    // every five minutes forever.
    expect(checkShopAlerts().orphanAlert).toBe(false);
  });

  test('stays quiet below the sample floor', () => {
    // Three failures out of three is a 100% failure rate — and meaningless.
    // Alerting on it would page someone for a cold start.
    for (let i = 0; i < 3; i++) recordEvent(SHOP_EVENTS.CHECKOUT_FAIL);
    expect(checkShopAlerts({ minSamples: 20 }).checkoutAlert).toBe(false);
  });

  test('fires once the failure rate is real and the window is big enough', () => {
    for (let i = 0; i < 30; i++) recordEvent(SHOP_EVENTS.CHECKOUT_FAIL);
    for (let i = 0; i < 10; i++) recordEvent(SHOP_EVENTS.CHECKOUT_OK);
    expect(checkShopAlerts({ minSamples: 20, checkoutFailureCeil: 0.15 }).checkoutAlert).toBe(true);
  });

  test('fires on a p95 breach, not on a single slow request', () => {
    for (let i = 0; i < 40; i++) recordLatency('shop GET /products', 100);
    recordLatency('shop GET /products', 30000);
    expect(checkShopAlerts({ minSamples: 20, p95CeilMs: 2500 }).latencyAlert).toBe(false);

    resetShopMetrics();
    for (let i = 0; i < 40; i++) recordLatency('shop GET /products', 8000);
    expect(checkShopAlerts({ minSamples: 20, p95CeilMs: 2500 }).latencyAlert).toBe(true);
  });
});
