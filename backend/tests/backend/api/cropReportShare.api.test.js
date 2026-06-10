/**
 * API tests for /api/v1/crop-reports/* — the cropReportShare access matrix.
 *
 * A share is a triple (report, OWNER farmer, SHAREE seller). These tests verify
 * each cell of the matrix documented in src/routes/cropReportShare.routes.js:
 * the owner and the sharee get their intended access, and EVERY out-of-scope
 * actor (other farmer, other seller, cross-role, unauthenticated) is denied.
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller,
  createTestCropReport, createTestCropShare,
  createTestCategory, createTestProduct,
  cleanupTestData, prisma,
} from '../../fixtures/setup.js';
import { randomId } from '../../fixtures/factories.js';

const BASE = '/api/v1/crop-reports';

let app;
let owner;        // FARMER who owns the report (the share's farmerId)
let sharee;       // krushi-kendra SELLER the report is shared with (sellerId)
let otherFarmer;  // a different FARMER — owns nothing of ours
let otherSeller;  // a different krushi-kendra SELLER — not the sharee

// Baseline report + share used by read-only assertions.
let report;
let share;

beforeAll(async () => {
  app = await getApp();
  owner       = await createTestUser({ name: 'Owner Farmer' });
  sharee      = await createTestSeller({ name: 'Krushi Kendra', businessType: 'krushi_kendra' });
  otherFarmer = await createTestUser({ name: 'Other Farmer' });
  otherSeller = await createTestSeller({ name: 'Other Kendra', businessType: 'krushi_kendra' });

  report = await createTestCropReport(owner.user.id);
  share  = await createTestCropShare(report.id, owner.user.id, sharee.user.id);
});

afterAll(async () => {
  await cleanupTestData();
});

// ── GET /sellers/nearby — directory: any authenticated user ──────────────────
describe('GET /sellers/nearby (directory)', () => {
  test('401 — unauthenticated is rejected', async () => {
    const res = await request(app).get(`${BASE}/sellers/nearby`);
    expect(res.status).toBe(401);
  });

  test('200 — any authenticated user may browse', async () => {
    const res = await request(app).get(`${BASE}/sellers/nearby`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── POST /:reportId/share — owner of the report only ─────────────────────────
describe('POST /:reportId/share', () => {
  test('401 — unauthenticated is rejected', async () => {
    const res = await request(app)
      .post(`${BASE}/${report.id}/share`)
      .send({ sellerId: sharee.user.id });
    expect(res.status).toBe(401);
  });

  test('201 — OWNER can share their own report', async () => {
    const fresh = await createTestCropReport(owner.user.id);
    const res = await request(app)
      .post(`${BASE}/${fresh.id}/share`)
      .set(owner.headers)
      .send({ sellerId: sharee.user.id, message: 'Please advise' });

    expect(res.status).toBe(201);
    expect(res.body.data.farmerId).toBe(owner.user.id);
    expect(res.body.data.sellerId).toBe(sharee.user.id);
  });

  test('IDOR — OTHER farmer cannot share a report they do not own → 404', async () => {
    // report belongs to `owner`; otherFarmer must not be able to share it.
    const res = await request(app)
      .post(`${BASE}/${report.id}/share`)
      .set(otherFarmer.headers)
      .send({ sellerId: sharee.user.id });

    expect(res.status).toBe(404);
  });

  test('404 — sharing a non-existent report is rejected', async () => {
    const res = await request(app)
      .post(`${BASE}/${randomId()}/share`)
      .set(owner.headers)
      .send({ sellerId: sharee.user.id });
    expect(res.status).toBe(404);
  });

  test('400 — cannot share with yourself', async () => {
    const fresh = await createTestCropReport(owner.user.id);
    const res = await request(app)
      .post(`${BASE}/${fresh.id}/share`)
      .set(owner.headers)
      .send({ sellerId: owner.user.id });
    expect(res.status).toBe(400);
  });

  test('400 — cannot share with a non-Krushi-Kendra user', async () => {
    const plainFarmer = await createTestUser({ name: 'Plain Farmer' }); // businessType null
    const fresh = await createTestCropReport(owner.user.id);
    const res = await request(app)
      .post(`${BASE}/${fresh.id}/share`)
      .set(owner.headers)
      .send({ sellerId: plainFarmer.user.id });
    expect(res.status).toBe(400);
  });
});

// ── GET /:reportId/shares — owner of the report only ─────────────────────────
describe('GET /:reportId/shares', () => {
  test('401 — unauthenticated is rejected', async () => {
    const res = await request(app).get(`${BASE}/${report.id}/shares`);
    expect(res.status).toBe(401);
  });

  test('200 — OWNER lists shares of their own report', async () => {
    const res = await request(app).get(`${BASE}/${report.id}/shares`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.some((s) => s.id === share.id)).toBe(true);
  });

  test('IDOR — OTHER farmer cannot list shares of someone else\'s report → 404', async () => {
    const res = await request(app).get(`${BASE}/${report.id}/shares`).set(otherFarmer.headers);
    expect(res.status).toBe(404);
  });

  test('IDOR — SHAREE cannot use the farmer-side route to read report shares → 404', async () => {
    // The seller is a party to the share, but does NOT own the report, so the
    // owner-only list route must deny them.
    const res = await request(app).get(`${BASE}/${report.id}/shares`).set(sharee.headers);
    expect(res.status).toBe(404);
  });
});

// ── GET /me/shares — self only (no cross-user leakage) ───────────────────────
describe('GET /me/shares', () => {
  test('401 — unauthenticated is rejected', async () => {
    const res = await request(app).get(`${BASE}/me/shares`);
    expect(res.status).toBe(401);
  });

  test('200 — OWNER sees their own shares', async () => {
    const res = await request(app).get(`${BASE}/me/shares`).set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.some((s) => s.id === share.id)).toBe(true);
  });

  test('isolation — OTHER farmer never sees the owner\'s share', async () => {
    const res = await request(app).get(`${BASE}/me/shares`).set(otherFarmer.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.some((s) => s.id === share.id)).toBe(false);
  });
});

// ── GET /seller/inbox — self only (no cross-seller leakage) ──────────────────
describe('GET /seller/inbox', () => {
  test('401 — unauthenticated is rejected', async () => {
    const res = await request(app).get(`${BASE}/seller/inbox`);
    expect(res.status).toBe(401);
  });

  test('200 — SHAREE sees the share in their inbox', async () => {
    const res = await request(app).get(`${BASE}/seller/inbox`).set(sharee.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.some((s) => s.id === share.id)).toBe(true);
  });

  test('isolation — OTHER seller never sees a share addressed to someone else', async () => {
    const res = await request(app).get(`${BASE}/seller/inbox`).set(otherSeller.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.some((s) => s.id === share.id)).toBe(false);
  });
});

// ── GET /seller/inbox/:shareId — the sharee only ─────────────────────────────
describe('GET /seller/inbox/:shareId', () => {
  test('401 — unauthenticated is rejected', async () => {
    const res = await request(app).get(`${BASE}/seller/inbox/${share.id}`);
    expect(res.status).toBe(401);
  });

  test('200 — SHAREE opens the share with the full report', async () => {
    const s = await createTestCropShare(report.id, owner.user.id, otherSeller.user.id);
    const res = await request(app).get(`${BASE}/seller/inbox/${s.id}`).set(otherSeller.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.report).toBeTruthy();
    expect(res.body.data.report.id).toBe(report.id);
  });

  test('IDOR — OTHER seller cannot open a share not addressed to them → 404', async () => {
    // `share` is addressed to `sharee`; otherSeller must not read it.
    const res = await request(app).get(`${BASE}/seller/inbox/${share.id}`).set(otherSeller.headers);
    expect(res.status).toBe(404);
  });

  test('cross-role — the OWNER farmer cannot read via the seller route → 404', async () => {
    const res = await request(app).get(`${BASE}/seller/inbox/${share.id}`).set(owner.headers);
    expect(res.status).toBe(404);
  });
});

// ── POST /seller/inbox/:shareId/reply — the sharee only ──────────────────────
describe('POST /seller/inbox/:shareId/reply', () => {
  test('401 — unauthenticated is rejected', async () => {
    const res = await request(app)
      .post(`${BASE}/seller/inbox/${share.id}/reply`)
      .send({ reply: 'Use copper fungicide weekly.' });
    expect(res.status).toBe(401);
  });

  test('200 — SHAREE replies to their own share', async () => {
    const s = await createTestCropShare(report.id, owner.user.id, sharee.user.id);
    const res = await request(app)
      .post(`${BASE}/seller/inbox/${s.id}/reply`)
      .set(sharee.headers)
      .send({ reply: 'Apply Mancozeb 75% WP, 2g/L, every 7 days.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REPLIED');
  });

  test('IDOR — OTHER seller cannot reply to a share not addressed to them → 404', async () => {
    const res = await request(app)
      .post(`${BASE}/seller/inbox/${share.id}/reply`)
      .set(otherSeller.headers)
      .send({ reply: 'Trying to hijack this thread.' });
    expect(res.status).toBe(404);
  });

  test('cross-role — the OWNER farmer cannot reply via the seller route → 404', async () => {
    const res = await request(app)
      .post(`${BASE}/seller/inbox/${share.id}/reply`)
      .set(owner.headers)
      .send({ reply: 'Farmer should not be able to reply here.' });
    expect(res.status).toBe(404);
  });

  test('security — recommending another shop\'s product is silently stripped', async () => {
    // A reply may only recommend the sharee's OWN active products.
    const category = await createTestCategory();
    const foreignProduct = await createTestProduct(otherSeller.user.id, category.id);
    const s = await createTestCropShare(report.id, owner.user.id, sharee.user.id);

    const res = await request(app)
      .post(`${BASE}/seller/inbox/${s.id}/reply`)
      .set(sharee.headers)
      .send({ reply: 'Here is a product.', recommendedProductIds: [foreignProduct.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.recommendedProductIds).toEqual([]); // not owned → dropped
  });
});
