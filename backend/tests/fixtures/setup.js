/**
 * Test Setup — shared helpers for API and integration tests.
 *
 * Usage:
 *   import { getApp, createTestUser, authHeader, prisma } from '../fixtures/setup.js';
 *
 * This module:
 *   1. Imports the Express app (no server.listen — supertest handles that)
 *   2. Provides helper functions to create users + get JWT tokens
 *   3. Exposes the Prisma client for direct DB assertions
 *   4. Cleans up after each suite
 */
import { jest } from '@jest/globals';
import prisma from '../../src/config/db.js';
import { buildUser, buildSeller, randomPhone } from './factories.js';
import { resetRateLimitStore } from '../../src/middleware/rateLimit.js';
import { resetOtpLockoutStore } from '../../src/services/otpLockout.service.js';
import { signAccessToken } from '../../src/utils/jwt.js';

// ── Guard: never run against a non-test database ─────────────────────────────
// cleanupTestData() below deletes EVERY row in ~20 tables, users included. If
// DATABASE_URL points at a dev or production database that wipe destroys real
// accounts — the developer is thrown back to signup + onboarding on the next app
// launch. fixtures/jest.env.js redirects the URL to `<db>_test`; this is the
// backstop for anything that bypasses it (a stray runner, a hand-set env var).
// Checked at import time so a mis-pointed suite fails before it writes anything.
{
  const dbName = /^[^?]*\/([^/?]*)/.exec(process.env.DATABASE_URL || '')?.[1];
  if (!dbName || !dbName.endsWith('_test')) {
    throw new Error(
      `[tests] Refusing to run against database "${dbName || '(unset)'}" — the suite ` +
      `deletes every user, order and listing when it finishes. Point DATABASE_URL ` +
      `at a database whose name ends in "_test".`,
    );
  }
}

// ── App import ───────────────────────────────────────────────────────────────
let _app;
export async function getApp() {
  if (!_app) {
    const mod = await import('../../src/app.js');
    _app = mod.default;
  }
  return _app;
}

// ── Auth helpers ─────────────────────────────────────────────────────────────
// Sign through the production helper so test tokens carry the issuer/audience
// claims that verifyAccessToken() enforces — otherwise every authenticated
// request 401s.
export function signTestToken(userId, role = 'FARMER') {
  return signAccessToken({ sub: userId, role });
}

export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Create a real user in the DB and return { user, token, headers }.
 */
export async function createTestUser(overrides = {}) {
  const data = buildUser(overrides);
  const user = await prisma.user.create({ data });
  const token = signTestToken(user.id, user.role);
  return { user, token, headers: authHeader(token) };
}

export async function createTestSeller(overrides = {}) {
  const data = buildSeller(overrides);
  const user = await prisma.user.create({ data });
  const token = signTestToken(user.id, user.role);
  return { user, token, headers: authHeader(token) };
}

/**
 * Create a category in the DB for product tests.
 */
export async function createTestCategory(overrides = {}) {
  return prisma.category.create({
    data: {
      name: `Test Category ${Date.now()}`,
      icon: 'leaf',
      color: '#176B43',
      sortOrder: 1,
      isActive: true,
      ...overrides,
    },
  });
}

/**
 * Create a PRE-SPLIT fused product — catalog identity and one seller's offer on
 * a single row, with no variants. This is what every row looked like before the
 * catalog split, so it is exactly the shape the DUAL-READ paths must keep
 * serving until the backfill runs. New tests should use
 * createTestCatalogProduct + createTestListing instead.
 *
 * `status: 'APPROVED'` is explicit: the schema default is PENDING_QC (new
 * seller-proposed entries queue for review), but a legacy fused row is by
 * definition already live — the expand migration backfills exactly this value.
 */
export async function createTestProduct(sellerId, categoryId, overrides = {}) {
  return prisma.product.create({
    data: {
      name: `Test Product ${Date.now()}`,
      price: 199.99,
      unit: 'kg',
      stock: 100,
      sellerId,
      categoryId,
      isActive: true,
      status: 'APPROVED',
      images: [],
      tags: [],
      sellScope: 'district',
      ...overrides,
    },
  });
}

// ── Catalog split fixtures ───────────────────────────────────────────────────
/**
 * A CATALOG product — identity only. No price, no stock, no seller: those live
 * on the offer. Defaults to APPROVED so it is publicly visible; pass
 * { status: 'PENDING_QC' } to test the QC gate.
 */
export async function createTestCatalogProduct(categoryId, overrides = {}) {
  const { normalizeProductKey } = await import('../../src/services/catalogMatch.service.js');
  const name = overrides.name || `Test Catalog Product ${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const { variants, ...rest } = overrides;
  return prisma.product.create({
    data: {
      name,
      categoryId,
      status: 'APPROVED',
      images: [], tags: [], highlights: [],
      normalizedKey: normalizeProductKey({
        categoryId, brand: overrides.brand, manufacturer: overrides.manufacturer, name,
      }),
      ...rest,
      variants: { create: variants || [{ unit: 'packet', attributes: { packSize: '1kg' }, isDefault: true }] },
    },
    include: { variants: true },
  });
}

/** One seller's OFFER against a variant. */
export async function createTestListing(sellerId, variantId, overrides = {}) {
  return prisma.sellerListing.create({
    data: {
      sellerId,
      variantId,
      sellingPrice: 100,
      stockQty: 10,
      status: 'ACTIVE',
      sellScope: 'district',
      district: 'Pune',
      state: 'Maharashtra',
      ...overrides,
    },
  });
}

/**
 * Create a machinery listing in the DB.
 */
export async function createTestMachinery(ownerId, overrides = {}) {
  return prisma.machineryListing.create({
    data: {
      ownerId,
      name: `Test Tractor ${Date.now()}`,
      category: 'tractor',
      pricePerDay: 2500,
      location: 'Baramati',
      district: 'Pune',
      state: 'Maharashtra',
      status: 'ACTIVE',
      available: true,
      images: [],
      videos: [],
      features: [],
      ...overrides,
    },
  });
}

/**
 * Create a crop disease report owned by `userId`. Provides the non-nullable
 * columns; override any of them for specific assertions.
 */
export async function createTestCropReport(userId, overrides = {}) {
  return prisma.cropDiseaseReport.create({
    data: {
      userId,
      pincode:         '411001',
      cropType:        'Tomato',
      growthStage:     'flowering',
      overallRisk:     45,
      riskLevel:       'MODERATE',
      primaryDisease:  'Early Blight',
      confidenceScore: 0.9,
      fullReport:      {},
      ...overrides,
    },
  });
}

/**
 * Create a crop-report share linking a report, its owner (farmerId) and a
 * recipient seller (sellerId).
 */
export async function createTestCropShare(reportId, farmerId, sellerId, overrides = {}) {
  return prisma.cropReportShare.create({
    data: { reportId, farmerId, sellerId, ...overrides },
  });
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
/**
 * Delete all test data. Call in afterAll().
 * Order matters due to foreign key constraints.
 */
export async function cleanupTestData() {
  // Clear in-memory rate-limit and OTP-lockout counters so they don't carry
  // into the next test file when jest reuses this worker process.
  resetRateLimitStore();
  resetOtpLockoutStore();
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    // Crop-report shares reference reports → delete shares first, then reports.
    prisma.cropReportShare.deleteMany(),
    prisma.cropDiseaseReport.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.review.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.cartItem.deleteMany(),
    prisma.chatMessage.deleteMany(),
    prisma.chat.deleteMany(),
    // listing_reports FKs the reporter with RESTRICT, so it has to clear before
    // users; user_blocks cascades but is listed for symmetry.
    prisma.listingReport.deleteMany(),
    prisma.userBlock.deleteMany(),
    prisma.animalListing.deleteMany(),
    prisma.labourListing.deleteMany(),
    prisma.machineryListing.deleteMany(),
    // SHOP HARDENING: payment + compliance rows. Most cascade from their parent,
    // but they are listed explicitly so a leaked row can never make the NEXT
    // suite's compliance gate refuse a sale for no visible reason — a sale block
    // or a recall left behind is invisible in a product fixture and would look
    // like a flaky test.
    prisma.paymentWebhookEvent.deleteMany(),
    prisma.paymentIntent.deleteMany(),
    // Held stock leaked between suites would silently reduce availability in
    // the next one — an out-of-stock failure with no visible cause.
    prisma.stockReservation.deleteMany(),
    prisma.saleBlock.deleteMany(),
    prisma.productRecall.deleteMany(),
    prisma.productBatch.deleteMany(),
    prisma.productCompliance.deleteMany(),
    prisma.sellerLicence.deleteMany(),
    prisma.sellerServiceArea.deleteMany(),
    // CATALOG SPLIT: offers → variants → catalog. seller_listings FKs the variant
    // (cascade) and the user (RESTRICT), so it must clear before users, and
    // variants before products.
    prisma.sellerListing.deleteMany(),
    prisma.productVariant.deleteMany(),
    prisma.product.deleteMany(),
    prisma.subcategory.deleteMany(),
    prisma.category.deleteMany(),
    prisma.otpSession.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.sellerProfile.deleteMany(),
    prisma.farmDetail.deleteMany(),
    prisma.pushToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // Hand the pool back. Jest gives every test FILE its own module registry, so
  // each one builds its own PrismaClient, and `beforeExit` in config/db.js only
  // fires when the whole process ends — so without this the pools accumulate
  // across all ~104 files inside the single --runInBand process. Measured before
  // any of this: a full run peaked at 89 of Postgres's 100 max_connections.
  //
  // Safe here because every caller invokes cleanupTestData from afterAll, i.e.
  // once its file has finished. Prisma reconnects lazily if anything does run
  // afterwards, so the worst case is one reconnect rather than a failure.
  await prisma.$disconnect().catch(() => {});
}

export { prisma };
