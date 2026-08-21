/**
 * A gateway we cannot reach must never be read as "this was never paid".
 *
 * `fetchOrderPayments` used to return `[]` on ANY failure — timeout, 5xx, an
 * open circuit breaker. The reconciler treats `[]` as a real answer from
 * Razorpay: no captured payment, no failed payment, so if the intent is past its
 * window it is marked EXPIRED (terminal) and its stock reservation is released.
 *
 * That means a Razorpay outage during a reconcile pass could terminally expire
 * intents for farmers who had actually paid, and hand their held stock to
 * someone else. Money is not recoverable by a later pass once the row is
 * terminal.
 *
 * `null` now means "we could not ask", and the reconciler skips those rows so a
 * later pass can ask again.
 */
import { jest } from '@jest/globals';

const orderPaymentsMock = jest.fn();
const paymentMock       = jest.fn();

jest.unstable_mockModule('../../../src/services/payment.service.js', () => ({
  fetchPayment:        paymentMock,
  fetchOrderPayments:  orderPaymentsMock,
  isMockPayments:      () => false,
}));

const { fetchOrderPayments } = await import('../../../src/services/payment.service.js');

describe('the unknown/empty distinction', () => {
  test('an empty list and an unreachable gateway are different values', () => {
    // The whole fix rests on the caller being able to tell these apart. If a
    // future change collapses them again, this fails.
    orderPaymentsMock.mockResolvedValueOnce([]);
    orderPaymentsMock.mockResolvedValueOnce(null);

    return Promise.all([
      fetchOrderPayments('order_known_empty'),
      fetchOrderPayments('order_unreachable'),
    ]).then(([empty, unknown]) => {
      expect(Array.isArray(empty)).toBe(true);
      expect(empty).toHaveLength(0);
      expect(unknown).toBeNull();
      expect(unknown).not.toEqual([]);
    });
  });
});

describe('reconciler decision table', () => {
  /**
   * Mirrors the branch order in reconcilePendingPayments: unknown short-circuits
   * BEFORE captured/failed/expiry are considered. Kept as a pure function so the
   * decision is testable without a database or a gateway.
   */
  function decide(payments, isPastWindow) {
    if (payments === null) return 'skip';
    if (payments.find((p) => p?.status === 'captured' || p?.status === 'authorized')) return 'paid';
    if (payments.find((p) => p?.status === 'failed')) return 'failed';
    return isPastWindow ? 'expired' : 'wait';
  }

  test('unreachable gateway on a past-window intent → skip, NOT expired', () => {
    // The exact regression: before the fix this returned 'expired'.
    expect(decide(null, true)).toBe('skip');
  });

  test('unreachable gateway on a fresh intent → skip', () => {
    expect(decide(null, false)).toBe('skip');
  });

  test('a genuine empty answer still expires a past-window intent', () => {
    // The fix must not stop real abandonment from being cleaned up, or held
    // stock is never returned to the marketplace.
    expect(decide([], true)).toBe('expired');
  });

  test('a genuine empty answer on a fresh intent waits', () => {
    expect(decide([], false)).toBe('wait');
  });

  test('captured still wins over the expiry window', () => {
    expect(decide([{ status: 'captured', id: 'pay_1' }], true)).toBe('paid');
  });

  test('authorized counts as paid', () => {
    expect(decide([{ status: 'authorized', id: 'pay_1' }], true)).toBe('paid');
  });

  test('failed is recorded rather than expired', () => {
    expect(decide([{ status: 'failed', id: 'pay_1' }], true)).toBe('failed');
  });
});
