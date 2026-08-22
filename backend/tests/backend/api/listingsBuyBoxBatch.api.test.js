/**
 * GET /agristore/listings must rank the whole page in one pass (§24).
 *
 * The route deduplicated by variantId and then called `rankOffersForVariant`
 * once per distinct variant. Deduping helped but did not change the SHAPE:
 * that function is a thin wrapper over the batch method, so each distinct
 * variant still cost its own `sellerListing.findMany` plus its own `weights()`
 * — six getSetting reads apiece.
 *
 * Page size here is up to 50, making this the larger of the two §24 sites, and
 * unlike the product-detail buy box it has no Redis cache in front of it.
 *
 * Query count is the assertion. The rankings were always CORRECT — this is a
 * read-amplification defect, so every value-level check passes either way.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import {
  getApp, createTestSeller, createTestCategory, createTestCatalogProduct,
  createTestListing, cleanupTestData, prisma,
} from '../../fixtures/setup.js';

const API = '/api/v1/agristore';
const VARIANTS = 8;

let app; let seller;

beforeAll(async () => {
  app = await getApp();
  seller = await createTestSeller();
  const category = await createTestCategory();
  for (let i = 0; i < VARIANTS; i++) {
    const p = await createTestCatalogProduct(category.id, {
      name: `BuyBox Product ${i}`,
      variants: [{ unit: 'kg', attributes: { packSize: `${i + 1}kg` }, isDefault: true }],
    });
    await createTestListing(seller.user.id, p.variants[0].id, { sellingPrice: 100 + i });
  }
});

afterAll(async () => { await cleanupTestData(); });

async function capture(fn) {
  const seen = [];
  prisma.$on('query', (e) => seen.push(e.query));
  const res = await fn();
  await new Promise((r) => setTimeout(r, 200));
  return { res, queries: seen };
}

describe('GET /agristore/listings — buy-box batching', () => {
  it('reads seller_listings a bounded number of times, not once per variant', async () => {
    const { res, queries } = await capture(() =>
      request(app).get(`${API}/listings?limit=50`).set(seller.headers));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(VARIANTS);

    const listingReads = queries.filter((q) => /FROM "public"\."seller_listings"/i.test(q));
    // One page fetch + one batched ranking read. The old shape was 1 + 8.
    expect(listingReads.length).toBeLessThan(VARIANTS);
  });

  it('total query count does not scale with the number of variants on the page', async () => {
    // Deliberately NOT asserting on settings reads, though weights() is six
    // getSetting calls per ranking pass: getSetting is TTL-cached, so those
    // collapse to a handful either way and the assertion would pass against the
    // broken code. Verified that — it does. The per-variant `sellerListing`
    // read is the cost that actually scales, so total query count is the
    // honest discriminator.
    const { queries } = await capture(() =>
      request(app).get(`${API}/listings?limit=50`).set(seller.headers));
    // 8 variants. The old shape added one listing read per variant on top of a
    // fixed base; the batch adds exactly one.
    expect(queries.length).toBeLessThan(VARIANTS + 8);
  });

  it('still decorates every row with its buy-box standing', async () => {
    // The behaviour that must survive: correctness was never the problem.
    const res = await request(app).get(`${API}/listings?limit=50`).set(seller.headers);
    for (const row of res.body.data) {
      expect(row).toHaveProperty('buyBox');
    }
  });

  it('a seller with only their own offer wins their own buy box', async () => {
    const res = await request(app).get(`${API}/listings?limit=50`).set(seller.headers);
    const row = res.body.data[0];
    expect(row.buyBox.isWinner).toBe(true);
    expect(row.buyBox.competitorCount).toBe(0);
  });
});
