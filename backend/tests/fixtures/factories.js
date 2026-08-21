/**
 * Test Data Factories
 * Generates realistic test data for all FarmEasy models.
 * Each factory returns a plain object — persistence is the test's responsibility.
 */
import crypto from 'crypto';

let counter = 0;
const seq = () => ++counter;

// ── Helpers ──────────────────────────────────────────────────────────────────
// A valid Indian mobile: leading 6-9, then 9 more digits. `users.phone` is
// UNIQUE, so a factory that can repeat itself makes any test that creates
// several users in quick succession fail on the constraint rather than on its
// own assertion.
//
// This used to be `Date.now()`'s last 9 digits, which is a MILLISECOND clock —
// two users built in the same millisecond got byte-identical suffixes, and the
// only other entropy was a 1-in-4 leading digit. Every test that provisions its
// actors in a tight loop was therefore a ~25%-per-pair coin flip, and the two
// that provision the most — tests/backend/load/booking-concurrency.test.js and
// the concurrent-review suite in tests/backend/db/prisma.test.js — lost it
// every run. Those are the suites that assert the marketplace does not
// oversell a slot and does not lose a rating update under concurrency, so the
// two properties the money path most depends on were never actually exercised.
//
// The 9 digits now come from a per-process counter offset by a random base:
// unique by construction within a run (the counter cannot repeat until 1e9),
// and distinct across parallel jest workers because each picks its own base.
const PHONE_BASE = Math.floor(Math.random() * 1e9);
let phoneSeq = 0;
export const randomPhone = () => {
  const suffix = (PHONE_BASE + phoneSeq++) % 1e9;
  return `${6 + Math.floor(Math.random() * 4)}${String(suffix).padStart(9, '0')}`;
};
export const randomId = () => crypto.randomUUID();

// ── User ─────────────────────────────────────────────────────────────────────
export function buildUser(overrides = {}) {
  const n = seq();
  return {
    phone: randomPhone(),
    name: `Test Farmer ${n}`,
    role: 'FARMER',
    language: 'en',
    district: 'Pune',
    state: 'Maharashtra',
    isActive: true,
    onboardingStep: 'COMPLETE',
    ...overrides,
  };
}

export function buildSeller(overrides = {}) {
  // A test SELLER represents an onboarded, ADMIN-APPROVED seller/Kendra, so default
  // kycStatus to VERIFIED — the crop-report discovery + share routes only surface
  // VERIFIED Kendras. Override with { kycStatus: 'PENDING' } to test the gate.
  return buildUser({ role: 'SELLER', businessType: 'individual_farmer', kycStatus: 'VERIFIED', ...overrides });
}

export function buildAdmin(overrides = {}) {
  return buildUser({ role: 'ADMIN', ...overrides });
}

// ── Category ─────────────────────────────────────────────────────────────────
export function buildCategory(overrides = {}) {
  const n = seq();
  return {
    name: `Category ${n}`,
    icon: 'leaf',
    color: '#176B43',
    sortOrder: n,
    isActive: true,
    ...overrides,
  };
}

// ── Product ──────────────────────────────────────────────────────────────────
export function buildProduct(overrides = {}) {
  const n = seq();
  return {
    name: `Product ${n}`,
    description: `High quality agricultural product ${n}`,
    price: 199.99,
    mrp: 249.99,
    unit: 'kg',
    stock: 100,
    minOrderQty: 1,
    images: [],
    tags: ['organic', 'natural'],
    isActive: true,
    rating: 4.5,
    ratingCount: 10,
    sellScope: 'district',
    district: 'Pune',
    ...overrides,
  };
}

// ── Order ────────────────────────────────────────────────────────────────────
export function buildDeliveryAddress(overrides = {}) {
  return {
    type: 'home',
    name: 'Rajesh Kumar',
    phone: randomPhone(),
    flat: '12A',
    street: 'MG Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    ...overrides,
  };
}

// ── Machinery ────────────────────────────────────────────────────────────────
export function buildMachineryListing(overrides = {}) {
  const n = seq();
  return {
    name: `Tractor ${n}`,
    category: 'tractor',
    pricePerDay: 2500,
    location: 'Baramati',
    district: 'Pune',
    state: 'Maharashtra',
    status: 'ACTIVE',
    available: true,
    images: [],
    videos: [],
    features: ['4WD', 'Power Steering'],
    lat: 18.1537,
    lng: 74.5771,
    ...overrides,
  };
}

// ── Labour ───────────────────────────────────────────────────────────────────
export function buildLabourListing(overrides = {}) {
  const n = seq();
  return {
    name: `Worker Team ${n}`,
    skills: ['Harvesting', 'Planting'],
    pricePerDay: 500,
    location: 'Indapur',
    district: 'Pune',
    state: 'Maharashtra',
    status: 'ACTIVE',
    available: true,
    images: [],
    groupSize: 5,
    ...overrides,
  };
}

// ── Booking ──────────────────────────────────────────────────────────────────
export function buildBooking(overrides = {}) {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 3);

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    days: 3,
    totalAmount: 7500,
    status: 'PENDING',
    ...overrides,
  };
}

// ── Animal Listing ───────────────────────────────────────────────────────────
export function buildAnimalListing(overrides = {}) {
  const n = seq();
  return {
    animal: 'cow',
    breed: `Holstein ${n}`,
    age: '3 years',
    gender: 'Female',
    weight: 450,
    price: 75000,
    description: 'Healthy dairy cow',
    location: 'Satara',
    district: 'Satara',
    state: 'Maharashtra',
    vaccinated: true,
    images: [],
    ...overrides,
  };
}

// ── Security Payloads ────────────────────────────────────────────────────────
export const SQLI_PAYLOADS = [
  "' OR 1=1--",
  "'; DROP TABLE users;--",
  "' UNION SELECT * FROM users--",
  "1; SELECT * FROM information_schema.tables",
  "' OR ''='",
];

export const NOSQL_PAYLOADS = [
  { $ne: null },
  { $gt: '' },
  { $where: 'sleep(5000)' },
  { $regex: '.*' },
];

export const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  '<svg onload=alert(1)>',
  '"><script>alert(document.cookie)</script>',
  '<a href="javascript:void(0)" onclick="alert(1)">click</a>',
];

export const PATH_TRAVERSAL_PAYLOADS = [
  '../../etc/passwd',
  '..\\..\\windows\\system32\\config\\sam',
  '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  '....//....//etc/passwd',
];

export const COMMAND_INJECTION_PAYLOADS = [
  '; rm -rf /',
  '| whoami',
  '`whoami`',
  '$(cat /etc/passwd)',
  '& ping -c 5 127.0.0.1',
];

// ── JWT helpers ──────────────────────────────────────────────────────────────
export function buildJwtPayload(userId, role = 'FARMER') {
  return { sub: userId, role };
}

// Reset counter between test suites
export function resetFactories() {
  counter = 0;
}
