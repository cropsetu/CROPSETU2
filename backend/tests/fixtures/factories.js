/**
 * Test Data Factories
 * Generates realistic test data for all FarmEasy models.
 * Each factory returns a plain object — persistence is the test's responsibility.
 */
import crypto from 'crypto';

let counter = 0;
const seq = () => ++counter;

// ── Helpers ──────────────────────────────────────────────────────────────────
export const randomPhone = () => `${6 + Math.floor(Math.random() * 4)}${String(Date.now()).slice(-9)}`;
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
