/**
 * Refund / chargeback abuse engine (FRAUD-2 / COMP-5) — services/refundAbuse.service.js.
 *
 * prisma is module-mocked (like the login-risk suite) so the rate/threshold logic
 * runs without a database. order.count is the only dependency: the second call —
 * the one carrying a `status` filter — returns the refund subset, the first the
 * total order count.
 *
 * Acceptance covered: repeat-abuse accounts are flagged (and, at the higher tier,
 * restricted), while small samples and clean accounts are not false-positived.
 */
import { jest } from '@jest/globals';

const orderCount = jest.fn();
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { order: { count: orderCount } },
}));

const { assessRefundAbuse } = await import('../../../src/services/refundAbuse.service.js');
const { ENV } = await import('../../../src/config/env.js');

const R = ENV.REFUND_ABUSE; // { lookbackDays, flagCount, flagRate, restrictCount, restrictRate }

// Make the two counts deterministic: total orders vs the CANCELLED/REFUNDED subset.
function withHistory({ orders, refunds }) {
  orderCount.mockImplementation(({ where }) => Promise.resolve(where.status ? refunds : orders));
}

beforeEach(() => orderCount.mockReset());

test('no userId → not abusive (nothing to assess)', async () => {
  const a = await assessRefundAbuse(null);
  expect(a.decision).toBe('ok');
  expect(a.flagged).toBe(false);
  expect(a.restricted).toBe(false);
});

test('clean account → ok', async () => {
  withHistory({ orders: 10, refunds: 1 });
  const a = await assessRefundAbuse('u1');
  expect(a.decision).toBe('ok');
  expect(a.rate).toBeCloseTo(0.1, 3);
});

test('high rate but tiny sample is NOT flagged (min-count guard)', async () => {
  withHistory({ orders: 1, refunds: 1 }); // 100% rate, but only 1 refund
  const a = await assessRefundAbuse('u1');
  expect(a.refunds).toBeLessThan(R.flagCount);
  expect(a.flagged).toBe(false);
  expect(a.decision).toBe('ok');
});

test('flag tier — enough refunds at the flag rate, but below restrict', async () => {
  // refunds ≥ flagCount and rate ≥ flagRate, yet refunds < restrictCount.
  withHistory({ orders: R.flagCount * 2, refunds: R.flagCount });
  const a = await assessRefundAbuse('u1');
  expect(a.flagged).toBe(true);
  expect(a.restricted).toBe(false);
  expect(a.decision).toBe('flag');
});

test('restrict tier — repeat offender over the restrict thresholds', async () => {
  // orders chosen so rate ≥ restrictRate and refunds ≥ restrictCount.
  const refunds = Math.max(R.restrictCount, Math.ceil(R.restrictRate * 10));
  const orders = Math.ceil(refunds / R.restrictRate);
  withHistory({ orders, refunds });
  const a = await assessRefundAbuse('u1');
  expect(a.refunds).toBeGreaterThanOrEqual(R.restrictCount);
  expect(a.rate).toBeGreaterThanOrEqual(R.restrictRate);
  expect(a.restricted).toBe(true);
  expect(a.decision).toBe('restrict');
});

test('count ≥ restrictCount but rate below restrictRate → flag, not restrict', async () => {
  // 5 refunds out of 10 orders = 0.5 rate (≥ flagRate 0.5, < restrictRate 0.7).
  withHistory({ orders: 10, refunds: Math.max(R.flagCount, R.restrictCount) });
  const a = await assessRefundAbuse('u1');
  if (a.rate < R.restrictRate) {
    expect(a.restricted).toBe(false);
    expect(a.flagged).toBe(true);
  }
});

test('never throws — a DB failure fails open as ok', async () => {
  orderCount.mockRejectedValue(new Error('db down'));
  const a = await assessRefundAbuse('u1');
  expect(a.decision).toBe('ok');
  expect(a.restricted).toBe(false);
});
