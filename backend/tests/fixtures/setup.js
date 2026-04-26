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
import jwt from 'jsonwebtoken';
import prisma from '../../src/config/db.js';
import { ENV } from '../../src/config/env.js';
import { buildUser, buildSeller, randomPhone } from './factories.js';

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
export function signTestToken(userId, role = 'FARMER') {
  return jwt.sign({ sub: userId, role }, ENV.JWT_SECRET, { expiresIn: '1h' });
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

// ── Cleanup ──────────────────────────────────────────────────────────────────
/**
 * Delete all test data. Call in afterAll().
 * Order matters due to foreign key constraints.
 */
export async function cleanupTestData() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
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
