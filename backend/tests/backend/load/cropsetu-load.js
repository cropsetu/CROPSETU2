/**
 * CropSetu backend load test (k6).
 *
 * Answers two DIFFERENT questions that get conflated as "can it handle N users":
 *
 *   PROFILE=capacity     What is the maximum sustained requests/second one API
 *                        instance serves before latency or errors break? This is
 *                        the number you scale from — it does not depend on how
 *                        many humans are holding phones.
 *
 *   PROFILE=concurrency  Can it serve VUS simultaneous app sessions, each on a
 *                        realistic mobile think-time loop? This is the number the
 *                        product question is actually about.
 *
 *   PROFILE=smoke        One pass over every endpoint. Use to verify wiring.
 *
 * WHY EACH VU CARRIES ITS OWN X-Forwarded-For
 * The API keys its per-IP limits on Express's trust-proxy-resolved req.ip, and
 * TRUST_PROXY=1 in production (one LB hop). A load generator on one machine is
 * ONE IP, so without a distinct forwarded address every simulated user would
 * share a single rate-limit bucket and the test would measure the rate limiter
 * instead of the app. Handing each VU its own address is what a real LB does for
 * real distinct clients — see the CGNAT note in the accompanying report for why
 * that assumption is NOT free in production.
 *
 * Usage:
 *   node tests/backend/load/mint-tokens.mjs > /tmp/tokens.json
 *   k6 run -e BASE_URL=http://localhost:3005/api/v1 \
 *          -e TOKENS=/tmp/tokens.json \
 *          -e PROFILE=capacity \
 *          tests/backend/load/cropsetu-load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3005/api/v1';
const PROFILE  = __ENV.PROFILE  || 'smoke';
const VUS      = parseInt(__ENV.VUS || '200', 10);
const DURATION = __ENV.DURATION || '60s';
const PEAK_RPS = parseInt(__ENV.PEAK_RPS || '3000', 10);
// Seconds a real user spends reading a screen before the next call. 0 turns the
// test into a throughput hammer rather than a user simulation.
const THINK    = parseFloat(__ENV.THINK || '5');

// Tokens are minted out-of-band (mint-tokens.mjs) because the real login path is
// OTP + SMS and is itself rate limited to 5/hour/phone — exercising it would test
// MSG91, not this API.
const tokens = new SharedArray('tokens', () => {
  if (!__ENV.TOKENS) return [];
  return JSON.parse(open(__ENV.TOKENS)).map((u) => u.token);
});

// ── Metrics ──────────────────────────────────────────────────────────────────
const errorRate   = new Rate('cs_error_rate');       // non-2xx of any kind
const throttled   = new Counter('cs_throttled_429'); // rate-limit rejections
const serverError = new Counter('cs_server_5xx');
const geoBrowse   = new Trend('cs_geo_browse_ms', true);
const refData     = new Trend('cs_ref_data_ms', true);
const authRead    = new Trend('cs_auth_read_ms', true);

// ── Profiles ─────────────────────────────────────────────────────────────────
// capacity: open model. k6 holds the ARRIVAL RATE regardless of how slow the
// server gets, so a server that falls behind shows up as dropped iterations —
// the honest signal. A closed (constant-vus) model hides saturation, because
// slow responses simply mean each VU sends fewer requests.
const PROFILES = {
  smoke: {
    smoke: { executor: 'shared-iterations', vus: 1, iterations: 1, exec: 'session' },
  },
  capacity: {
    capacity: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 400,
      maxVUs: 2500,
      stages: [
        { duration: '30s', target: Math.round(PEAK_RPS * 0.10) },
        { duration: '30s', target: Math.round(PEAK_RPS * 0.25) },
        { duration: '30s', target: Math.round(PEAK_RPS * 0.50) },
        { duration: '30s', target: Math.round(PEAK_RPS * 0.75) },
        { duration: '45s', target: PEAK_RPS },
        { duration: '15s', target: 0 },
      ],
      exec: 'oneCall',
    },
  },
  concurrency: {
    concurrency: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      exec: 'session',
    },
  },
  // Same target as `concurrency`, but sessions ARRIVE gradually instead of all at
  // once. That separates two failures that look identical in a summary: not being
  // able to absorb a burst of new connections, and not being able to HOLD N
  // established sessions. Only the second is a statement about capacity.
  soak: {
    soak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '90s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '10s', target: 0 },
      ],
      exec: 'session',
    },
  },
};

export const options = {
  scenarios: PROFILES[PROFILE] || PROFILES.smoke,
  // Generous socket budget: at high VU counts the default can itself become the
  // limiter and be mistaken for a server-side ceiling.
  batchPerHost: 20,
  noConnectionReuse: false,
  discardResponseBodies: false,
  thresholds: {
    // 500 ms p95 is the target the repo's own db.js comments cite.
    http_req_duration: ['p(95)<500'],
    http_req_failed:   ['rate<0.01'],
    cs_error_rate:     ['rate<0.01'],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
// A unique forwarded address per simulated client (see header note). 10.0.0.0/8
// gives 16M addresses, so there are no collisions at any VU count this machine
// can generate. `perIteration` treats every request as a fresh client, which is
// what a throughput test of a large user population should look like; per-VU is
// what a session simulation should look like.
function xff(perIteration) {
  const n = (perIteration ? exec.scenario.iterationInTest : exec.vu.idInTest) + 1;
  return `10.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${(n & 0xff) || 1}`;
}

// Browse endpoints are optionalAuth, and their per-route limiter keys on
// `req.user?.id || clientIp(req)`. Sending a token collapses every simulated
// user onto one of the few seeded accounts and the test measures the rate
// limiter instead of the app — so anonymous browse deliberately sends NO token.
function anonHeaders(perIteration) {
  return { 'X-Forwarded-For': xff(perIteration) };
}

function authHeaders() {
  const h = { 'X-Forwarded-For': xff(false) };
  if (tokens.length) h.Authorization = `Bearer ${tokens[exec.vu.idInTest % tokens.length]}`;
  return h;
}

function record(res, trend, name) {
  trend.add(res.timings.duration);
  const ok = res.status >= 200 && res.status < 300;
  errorRate.add(!ok);
  if (res.status === 429) throttled.add(1);
  if (res.status >= 500)  serverError.add(1);
  check(res, { [`${name} 2xx`]: () => ok });
  return ok;
}

// Pune. Real traffic is spread over India, but a fixed point keeps the geo query
// plan stable so run-to-run numbers are comparable.
const GEO = 'lat=18.52&lng=73.85&radius=25';

// ── Exec: one representative call (capacity profile) ─────────────────────────
// Each iteration is a fresh simulated client, so per-IP limits key per request
// the way they would across a real user population.
export function oneCall() {
  const h = { headers: anonHeaders(true) };
  const pick = exec.scenario.iterationInTest % 3;
  if (pick === 0) record(http.get(`${BASE_URL}/rent/machinery?${GEO}`, h), geoBrowse, 'machinery');
  else if (pick === 1) record(http.get(`${BASE_URL}/animals/meta`, h), refData, 'animals-meta');
  else record(http.get(`${BASE_URL}/rent/labour?${GEO}`, h), geoBrowse, 'labour');
}

// ── Exec: a realistic app session (concurrency profile) ──────────────────────
// Mirrors what the mobile app actually does: a burst of calls when a screen
// opens, then reads separated by the time a human spends looking at the screen.
export function session() {
  // Anonymous browse under a per-VU address when there IS think time (a session),
  // per-iteration when there is not (a throughput hammer) — otherwise a zero-think
  // VU exceeds the 120/min browse limit on its own address within the run.
  const h = { headers: anonHeaders(THINK === 0) };

  // Screen open: reference data + first list, fired together as the app does.
  const opened = http.batch([
    ['GET', `${BASE_URL}/animals/meta`, null, h],
    ['GET', `${BASE_URL}/rent/machinery?${GEO}`, null, h],
  ]);
  record(opened[0], refData, 'animals-meta');
  record(opened[1], geoBrowse, 'machinery');

  sleep(THINK);

  // Switch tab → labour listings.
  record(http.get(`${BASE_URL}/rent/labour?${GEO}`, h), geoBrowse, 'labour');
  sleep(THINK);

  // An authenticated read (goes through the JWT middleware's per-request user
  // lookup — the cost every logged-in call pays before its handler runs).
  // AUTH_READ=off skips it when the shop tables are not migrated.
  if (tokens.length && __ENV.AUTH_READ !== 'off') {
    record(http.get(`${BASE_URL}/agristore/cart`, { headers: authHeaders() }), authRead, 'cart');
    sleep(THINK);
  }
}

export function handleSummary(data) {
  const m = data.metrics;
  const g = (k, f = 'value') => (m[k] && m[k].values ? m[k].values[f] : null);
  const out = {
    profile: PROFILE,
    vus_configured: PROFILE === 'concurrency' ? VUS : null,
    peak_rps_target: PROFILE === 'capacity' ? PEAK_RPS : null,
    iterations: g('iterations', 'count'),
    reqs_total: g('http_reqs', 'count'),
    reqs_per_sec: g('http_reqs', 'rate'),
    dropped_iterations: g('dropped_iterations', 'count') || 0,
    http_fail_rate: g('http_req_failed', 'rate'),
    err_rate: g('cs_error_rate', 'rate'),
    throttled_429: g('cs_throttled_429', 'count') || 0,
    server_5xx: g('cs_server_5xx', 'count') || 0,
    dur_avg: g('http_req_duration', 'avg'),
    dur_p50: g('http_req_duration', 'med'),
    dur_p90: g('http_req_duration', 'p(90)'),
    dur_p95: g('http_req_duration', 'p(95)'),
    dur_max: g('http_req_duration', 'max'),
    waiting_p95: g('http_req_waiting', 'p(95)'),
    geo_browse_p95: g('cs_geo_browse_ms', 'p(95)'),
    ref_data_p95: g('cs_ref_data_ms', 'p(95)'),
    auth_read_p95: g('cs_auth_read_ms', 'p(95)'),
  };
  const path = __ENV.OUT_JSON || 'summary.json';
  return { [path]: JSON.stringify(out, null, 2), stdout: '' };
}
