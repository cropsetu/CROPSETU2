/**
 * Money exactness: the Decimal helpers must not drift, and the API serializer
 * must turn Prisma.Decimal into plain numbers at the boundary.
 */
import { Prisma } from '@prisma/client';

const { D, sumD, round2, toMinorUnits } = await import('../../../src/utils/money.js');
const { serializeDecimals } = await import('../../../src/utils/response.js');

const Decimal = Prisma.Decimal;

describe('money helpers — no rounding drift (compute)', () => {
  test('the classic 0.1 + 0.2 is exact (float gives 0.30000000000000004)', () => {
    expect(D('0.1').plus(D('0.2')).toString()).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3); // sanity: float really does drift
  });

  test('price × quantity accumulation stays exact', () => {
    // 19.99 × 3 = 59.97 exactly; naive float reduce drifts.
    const items = [{ price: new Decimal('19.99'), qty: 3 }, { price: new Decimal('0.10'), qty: 7 }];
    const total = items.reduce((s, i) => s.plus(D(i.price).times(i.qty)), D(0));
    expect(total.toString()).toBe('60.67'); // 59.97 + 0.70
  });

  test('sumD sums {amountInr} log entries exactly', () => {
    const logs = [{ amountInr: 100.1 }, { amountInr: 200.2 }, { amountInr: 0.05 }];
    expect(sumD(logs, (x) => x.amountInr).toString()).toBe('300.35');
  });

  test('D() coerces numbers via their decimal string, not the float expansion', () => {
    expect(D(100.1).toString()).toBe('100.1');
    expect(D(null).toString()).toBe('0');
    expect(D(undefined).toString()).toBe('0');
    expect(D(NaN).toString()).toBe('0');
    expect(D('not-a-number').toString()).toBe('0');
    expect(D(new Decimal('42.42')).toString()).toBe('42.42');
  });

  test('round2 rounds half-up to two places', () => {
    expect(round2('1.005').toString()).toBe('1.01');
    expect(round2(2.675).toString()).toBe('2.68'); // float 2.675*100 would give 267.49…
  });

  test('toMinorUnits → exact integer paise (Razorpay)', () => {
    expect(toMinorUnits('19.99')).toBe(1999);
    expect(toMinorUnits(new Decimal('1234.50'))).toBe(123450);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30, not 30.000…4
  });
});

describe('serializeDecimals — API boundary (Decimal → Number)', () => {
  test('converts a top-level Decimal', () => {
    expect(serializeDecimals(new Decimal('99.99'))).toBe(99.99);
    expect(typeof serializeDecimals(new Decimal('99.99'))).toBe('number');
  });

  test('walks nested objects and arrays', () => {
    const out = serializeDecimals({
      id: 'x',
      totalAmount: new Decimal('1500.50'),
      items: [{ unitPrice: new Decimal('10.25'), qty: 2 }],
      meta: { nested: { price: new Decimal('3.30') } },
    });
    expect(out.totalAmount).toBe(1500.5);
    expect(out.items[0].unitPrice).toBe(10.25);
    expect(out.meta.nested.price).toBe(3.3);
    expect(out.id).toBe('x');
    expect(out.items[0].qty).toBe(2);
  });

  test('leaves primitives, Dates, null, and Buffers untouched', () => {
    const d = new Date('2026-06-10T00:00:00Z');
    expect(serializeDecimals('str')).toBe('str');
    expect(serializeDecimals(42)).toBe(42);
    expect(serializeDecimals(null)).toBeNull();
    expect(serializeDecimals(d)).toBe(d);
    const buf = Buffer.from('x');
    expect(serializeDecimals(buf)).toBe(buf);
  });

  test('JSON of a serialized payload has numbers, not strings', () => {
    const json = JSON.stringify(serializeDecimals({ price: new Decimal('5.50') }));
    expect(json).toBe('{"price":5.5}'); // not {"price":"5.5"}
  });
});
