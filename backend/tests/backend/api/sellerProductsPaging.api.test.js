/**
 * A seller must be able to reach every one of their own listings.
 *
 * The seller app's My Products screen asked for CURSOR pagination
 * (`?paginate=cursor`, then `?cursor=…`) against a route that has only ever
 * implemented OFFSET pagination. The server returns
 * `{page, limit, total, totalPages}` and no `nextCursor`, so the client's cursor
 * branch read undefined, set hasMore=false, and never asked for another page.
 *
 * The user-visible result was not a missing button — it was a lie. A seller with
 * 50 products saw the newest 20 and a footer reading "That's everything". The
 * other 30 could not be edited, re-priced, hidden or deleted from the app.
 *
 * Neither half was wrong alone, which is why it survived review: the sibling
 * /agristore/listings route really does speak cursor. The mismatch existed only
 * in the pairing, and no test crossed that boundary — these do.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import {
  getApp, createTestSeller, createTestCategory, createTestCatalogProduct,
  createTestListing, cleanupTestData, prisma,
} from '../../fixtures/setup.js';

const API = '/api/v1/agristore';
const TOTAL = 25;                 // more than one page at the default limit of 20

let app; let seller; let listingIds = [];

beforeAll(async () => {
  app = await getApp();
  seller = await createTestSeller();
  const category = await createTestCategory();
  for (let i = 0; i < TOTAL; i++) {
    const p = await createTestCatalogProduct(category.id, { name: `Paging Product ${i}` });
    const l = await createTestListing(seller.user.id, p.variants[0].id, {
      // Deliberately identical timestamps on a few rows: ties are what make an
      // offset walk skip or repeat rows unless the sort is total.
      createdAt: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 5))),
    });
    listingIds.push(l.id);
  }
});

afterAll(async () => { await cleanupTestData(); });

describe('GET /agristore/seller/products — the walk is complete', () => {
  it('reaches every listing exactly once by paging', async () => {
    // The loop condition is usePagedList's own page-mode formula verbatim —
    // `pageRef.current * limit < meta.total` (usePagedList.js:110). So this
    // walks the endpoint the way the fixed client walks it, rather than the way
    // a test author imagines it does.
    const seen = [];
    let page = 1; let meta;
    do {
      const res = await request(app)
        .get(`${API}/seller/products?page=${page}&limit=20`).set(seller.headers);
      expect(res.status).toBe(200);
      meta = res.body.meta;
      res.body.data.forEach((row) => seen.push(row.listingId));
      page += 1;
    } while ((page - 1) * 20 < meta.total && page < 10);

    expect(meta.total).toBe(TOTAL);
    expect(seen).toHaveLength(TOTAL);          // nothing repeated
    expect(new Set(seen).size).toBe(TOTAL);    // nothing skipped
    expect(new Set(seen)).toEqual(new Set(listingIds));
  });

  it('sends the meta fields the client computes hasMore from', async () => {
    // This is the assertion whose absence let the mismatch ship. The client
    // needs `total` (or `hasMore`); it was reading `nextCursor`, which this
    // route does not and will not send.
    const res = await request(app)
      .get(`${API}/seller/products?page=1&limit=20`).set(seller.headers);
    expect(typeof res.body.meta.total).toBe('number');
    expect(res.body.meta.totalPages).toBe(2);
    expect(res.body.meta.page).toBe(1);
  });

  it('documents that this route does NOT speak cursor', async () => {
    // Pinned deliberately. If someone later adds a cursor branch here, this
    // test fails and makes them go update the client in the same change —
    // rather than leaving the two halves disagreeing again, silently.
    const res = await request(app)
      .get(`${API}/seller/products?paginate=cursor&limit=20`).set(seller.headers);
    expect(res.status).toBe(200);
    expect(res.body.meta.nextCursor).toBeUndefined();
    expect(res.body.data).toHaveLength(20);
  });

  it('orders totally, so tied createdAt values cannot shuffle between pages', async () => {
    // Five listings share each createdAt here. Without the id tiebreak Postgres
    // may order ties differently for the page-1 and page-2 queries, which drops
    // some rows and duplicates others — invisibly, since both pages look full.
    const a = await request(app).get(`${API}/seller/products?page=1&limit=10`).set(seller.headers);
    const b = await request(app).get(`${API}/seller/products?page=1&limit=10`).set(seller.headers);
    expect(a.body.data.map((r) => r.listingId)).toEqual(b.body.data.map((r) => r.listingId));

    const all = [];
    for (const p of [1, 2, 3]) {
      const r = await request(app).get(`${API}/seller/products?page=${p}&limit=10`).set(seller.headers);
      all.push(...r.body.data.map((x) => x.listingId));
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('scopes to the requesting seller', async () => {
    const other = await createTestSeller();
    const res = await request(app)
      .get(`${API}/seller/products?page=1&limit=20`).set(other.headers);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });
});
