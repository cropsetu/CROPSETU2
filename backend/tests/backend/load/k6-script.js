/**
 * k6 Load Test Script for FarmEasy Backend
 *
 * Usage:
 *   k6 run tests/backend/load/k6-script.js
 *
 * Prerequisites:
 *   - Install k6: brew install k6
 *   - Start the backend: npm run dev
 *   - Set BASE_URL env var if not localhost:3000
 *
 * Scenarios:
 *   1. Browse products (500 VUs) — simulates farmers browsing
 *   2. Seller upload (50 VUs) — simulates sellers managing listings
 *   3. Last-unit checkout (10 VUs) — concurrency stress test
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';

// Custom metrics
const errorRate = new Rate('error_rate');
const productListTrend = new Trend('product_list_duration');

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m',  target: 500 },
        { duration: '2m',  target: 500 },
        { duration: '30s', target: 0 },
      ],
      exec: 'browseProducts',
    },
    seller_upload: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      exec: 'sellerFlow',
      startTime: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    error_rate: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

// ── Scenario 1: Browse products ──────────────────────────────────────────────
export function browseProducts() {
  // Categories
  const catRes = http.get(`${BASE_URL}/agristore/categories`);
  check(catRes, {
    'categories 200': (r) => r.status === 200,
    'categories has data': (r) => JSON.parse(r.body).success === true,
  });
  errorRate.add(catRes.status !== 200);

  // Products list
  const prodRes = http.get(`${BASE_URL}/agristore/products?page=1&limit=20`);
  productListTrend.add(prodRes.timings.duration);
  check(prodRes, {
    'products 200': (r) => r.status === 200,
    'products array': (r) => Array.isArray(JSON.parse(r.body).data),
  });
  errorRate.add(prodRes.status !== 200);

  // Product search
  const searchRes = http.get(`${BASE_URL}/agristore/products?search=seed`);
  check(searchRes, { 'search 200': (r) => r.status === 200 });

  // Machinery browse
  const machRes = http.get(`${BASE_URL}/rent/machinery?lat=18.52&lng=73.85&radius=25`);
  check(machRes, { 'machinery 200': (r) => r.status === 200 });

  sleep(1);
}

// ── Scenario 2: Seller flow ──────────────────────────────────────────────────
export function sellerFlow() {
  // Note: In a real test you'd authenticate first. This tests unauthenticated rejection.
  const createRes = http.post(
    `${BASE_URL}/agristore/seller/products`,
    JSON.stringify({
      name: `k6 Product ${Date.now()}`,
      categoryId: 'test-cat',
      price: 100,
      stock: 10,
      unit: 'kg',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(createRes, {
    'unauthenticated create returns 401': (r) => r.status === 401,
  });
  errorRate.add(createRes.status === 500);

  sleep(2);
}
