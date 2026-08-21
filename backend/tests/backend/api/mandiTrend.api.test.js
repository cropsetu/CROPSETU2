/**
 * Mandi price trend — the numbers and the size of them.
 *
 * Two defects lived in this one handler.
 *
 * 1. `modalPrice` is a Prisma Decimal, and Decimal.prototype.valueOf() returns a
 *    STRING. So `prices.reduce((a, b) => a + b, 0)` was concatenating, not
 *    adding. Three prices of 1200/1300/1400 produced an average of
 *    40,004,333,800 and a "100% below average" verdict — on the screen a farmer
 *    uses to decide when to sell.
 *
 * 2. The query had no `take`, and `market` is a `contains` match rather than the
 *    single market the endpoint's contract implies. Measured on an
 *    Agmarknet-shaped dataset — 400 markets reporting one commodity daily for a
 *    year — `?market=a&days=365` returned 146,000 rows and 15.2 MB, and then
 *    summed 146,000 Decimals on the event loop.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { getApp, createTestUser, cleanupTestData, prisma } from '../../fixtures/setup.js';
import { TREND_ROW_CAP } from '../../../src/services/mandiPrice.service.js';

const API = '/api/v1/mandi';
let app; let user;

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function seed(rows) {
  await prisma.mandiPrice.createMany({
    data: rows.map((r, i) => ({
      commodity: r.commodity ?? 'Onion',
      market:    r.market    ?? 'Lasalgaon',
      district:  'Nashik',
      state:     'Maharashtra',
      variety:   r.variety ?? `v${i}`,
      minPrice:  r.min   ?? 1000,
      maxPrice:  r.max   ?? 1500,
      modalPrice: r.modal,
      priceDate: r.date,
      expiresAt: new Date(Date.now() + 86400000),
    })),
  });
}

beforeAll(async () => {
  app = await getApp();
  user = await createTestUser();
});
afterAll(async () => { await cleanupTestData(); });
beforeEach(async () => { await prisma.mandiPrice.deleteMany(); });

describe('GET /mandi/prices/:commodity/trend — statistics', () => {
  it('averages the prices instead of concatenating them', async () => {
    // The exact case from the bug: 1200, 1300, 1400 → mean 1300.
    await seed([
      { modal: 1200, date: daysAgo(3) },
      { modal: 1300, date: daysAgo(2) },
      { modal: 1400, date: daysAgo(1) },
    ]);

    const res = await request(app).get(`${API}/prices/Onion/trend?market=Lasalgaon&days=30`)
      .set(user.headers);

    expect(res.status).toBe(200);
    expect(res.body.data.stats.avg30).toBe(1300);       // was 40,004,333,800
    expect(res.body.data.stats.avg7).toBe(1300);
    expect(res.body.data.stats.currentPrice).toBe(1400);
    expect(res.body.data.stats.priceVsAvgPercent).toBe(8); // +7.69% → 8, was -100
  });

  it('no average falls outside the range of the prices it averaged', async () => {
    // The invariant that actually catches the bug. The concatenation never
    // threw and never produced a NaN — it produced a plausible-looking integer,
    // which is why a type check does not find it. A mean, however, cannot be
    // outside min..max, and the concatenated one is orders of magnitude above.
    await seed([
      { modal: 2000, date: daysAgo(3) },
      { modal: 2200, date: daysAgo(2) },
      { modal: 2100, date: daysAgo(1) },
    ]);
    const res = await request(app).get(`${API}/prices/Onion/trend?market=Lasalgaon`)
      .set(user.headers);

    const { avg7, avg30, currentPrice } = res.body.data.stats;
    for (const v of [avg7, avg30, currentPrice]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(2000);
      expect(v).toBeLessThanOrEqual(2200);
    }
    // And a percentage against that average stays in a believable range.
    expect(Math.abs(res.body.data.stats.priceVsAvgPercent)).toBeLessThan(50);
  });

  it('avg7 covers the last seven points, avg30 the whole window', async () => {
    // 10 days: 1000 for the older three, 2000 for the recent seven.
    await seed([
      ...[10, 9, 8].map((d) => ({ modal: 1000, date: daysAgo(d) })),
      ...[7, 6, 5, 4, 3, 2, 1].map((d) => ({ modal: 2000, date: daysAgo(d) })),
    ]);
    const res = await request(app).get(`${API}/prices/Onion/trend?market=Lasalgaon&days=30`)
      .set(user.headers);
    expect(res.body.data.stats.avg7).toBe(2000);
    expect(res.body.data.stats.avg30).toBe(1700); // (3*1000 + 7*2000) / 10
  });
});

describe('GET /mandi/prices/:commodity/trend — bounded', () => {
  it('caps the row count a wide market substring can pull', async () => {
    // Every generated name contains "a", which is what makes `contains` the
    // wrong shape for a per-market endpoint.
    const rows = [];
    for (let m = 0; m < 40; m++) {
      for (let d = 1; d <= 40; d++) {
        rows.push({ market: `Market ${m}`, variety: `v${m}-${d}`, modal: 1000 + d, date: daysAgo(d) });
      }
    }
    await seed(rows);                                   // 1,600 rows, all matching

    const res = await request(app).get(`${API}/prices/Onion/trend?market=a&days=365`)
      .set(user.headers);

    expect(res.status).toBe(200);
    expect(res.body.data.trend.length).toBeLessThanOrEqual(TREND_ROW_CAP);
    expect(res.body.data.truncated).toBe(true);
  });

  it('truncation drops the OLDEST rows, never the newest', async () => {
    // This is the whole reason the scan is descending. Capping an ascending
    // scan would drop the rows "current price" and avg7 are computed from, so a
    // truncated window would quietly report last year's price as today's.
    const rows = [];
    for (let d = 1; d <= 300; d++) {
      for (let v = 0; v < 5; v++) {
        // Recent days priced high, old days priced low — so which end survived
        // is visible in the numbers.
        rows.push({ market: `Market ${v}`, variety: `v${d}-${v}`, modal: d <= 30 ? 5000 : 900, date: daysAgo(d) });
      }
    }
    await seed(rows);                                   // 1,500 rows

    const res = await request(app).get(`${API}/prices/Onion/trend?market=Market&days=365`)
      .set(user.headers);

    const trend = res.body.data.trend;
    expect(trend.length).toBe(TREND_ROW_CAP);
    // Newest survived...
    expect(Number(trend[trend.length - 1].modalPrice)).toBe(5000);
    expect(res.body.data.stats.currentPrice).toBe(5000);
    // ...and the series is still oldest-first for the chart.
    const dates = trend.map((t) => new Date(t.priceDate).getTime());
    expect(dates[0]).toBeLessThan(dates[dates.length - 1]);
  });

  it('does not flag a normal single-market request as truncated', async () => {
    await seed([{ modal: 1100, date: daysAgo(2) }, { modal: 1150, date: daysAgo(1) }]);
    const res = await request(app).get(`${API}/prices/Onion/trend?market=Lasalgaon&days=30`)
      .set(user.headers);
    expect(res.body.data.truncated).toBe(false);
    expect(res.body.data.trend).toHaveLength(2);
  });
});
