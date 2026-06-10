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
 * Create a product in the DB.
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
      images: [],
      tags: [],
      sellScope: 'district',
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
    prisma.animalListing.deleteMany(),
    prisma.labourListing.deleteMany(),
    prisma.machineryListing.deleteMany(),
    prisma.product.deleteMany(),
    prisma.category.deleteMany(),
    prisma.otpSession.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.sellerProfile.deleteMany(),
    prisma.farmDetail.deleteMany(),
    prisma.pushToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export { prisma };
