/**
 * UUID path-param COVERAGE — a lint, not a behaviour test.
 *
 * The finding this exists for was reported as a single missing
 * `router.param('orderId', uuidParamGuard)`, but named the real problem
 * correctly: "this is a class of defect, not a single instance". A non-UUID
 * reaching a `uuid` column throws P2023 inside Prisma, and on a route with no
 * try/catch that surfaces as a 500 — an error oracle that distinguishes
 * "malformed" from "not found" for free.
 *
 * Coverage is split across two mechanisms — a router-level
 * `router.param(name, uuidParamGuard)` and a per-route `param(name).isUUID()`
 * chain — and both answer 400, so either is fine. What was missing is anything
 * that NOTICES when a newly added route has neither. That is what this file is:
 * it walks the route sources and fails if any path param is unguarded.
 *
 * When this test fails, the fix is one of:
 *   1. register `router.param('<name>', uuidParamGuard)` on that router, or
 *   2. add `param('<name>').isUUID()` to that route's validator chain, or
 *   3. if the param genuinely is not a database id, add it to NON_UUID_PARAMS
 *      below WITH the reason — an unexplained entry there is how this check
 *      gets quietly hollowed out.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROUTES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../../src/routes',
);

/**
 * Path params that are NOT database uuids. Each needs a reason: this map is the
 * only way to opt out of the check, so an entry without justification is
 * indistinguishable from an oversight.
 */
const NON_UUID_PARAMS = new Map([
  ['name', 'crops.routes.js — crop name, a slug from the seed data'],
  ['key', 'features.routes.js — feature-flag key, not a row id'],
  ['commodity', 'mandi/msp routes — commodity name, not an id'],
  ['column', 'farmCropCycle.routes.js — a log column name, validated with isIn()'],
  ['jobId', 'ai.routes.js — FastAPI job handle, not a row in our database'],
  ['providerOrderId', 'agristore.routes.js — Razorpay order id (order_XXXX), length-checked in the handler'],
]);

/**
 * Source with block comments removed.
 *
 * A route sketched inside a file's /* *\/ header is not a live route, and must
 * not be reported as an unguarded one.
 */
const stripBlockComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every argument list of a router.<verb>(...) call, found by matching parens.
 *
 * Anchored to a line start so a registration someone COMMENTED OUT stops
 * counting. The first version of this lint was not anchored, matched
 * `// router.param('orderId', ...)`, and went green against the exact route it
 * existed to catch.
 */
function routerCalls(src) {
  const out = [];
  const re = /^[ \t]*router\.(get|post|put|patch|delete|use)\(/gm;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const call = src.slice(m.index, i);
    const pathMatch = call.match(/^\s*router\.\w+\(\s*['"]([^'"]*)['"]/);
    if (!pathMatch) continue;
    out.push({
      verb: m[1].toUpperCase(),
      routePath: pathMatch[1],
      call,
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

/** Param names registered at router level, ignoring commented-out lines. */
function routerLevelParams(src) {
  const names = new Set();
  for (const m of src.matchAll(/^[ \t]*router\.param\(\s*['"]([^'"]+)['"]/gm)) names.add(m[1]);
  return names;
}

/** Does this route's own validator chain assert the param is a UUID? */
function hasPerRouteGuard(call, name) {
  const at = call.indexOf("param('" + name + "')");
  return at !== -1 && call.slice(at, at + 120).includes('.isUUID(');
}

function findGaps() {
  const gaps = [];
  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'))) {
    const src = stripBlockComments(fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8'));
    const routerLevel = routerLevelParams(src);

    for (const { verb, routePath, call, line } of routerCalls(src)) {
      for (const pm of routePath.matchAll(/:([A-Za-z0-9_]+)/g)) {
        const name = pm[1];
        if (NON_UUID_PARAMS.has(name) || routerLevel.has(name)) continue;
        if (hasPerRouteGuard(call, name)) continue;
        gaps.push(file + ':' + line + '  ' + verb + ' ' + routePath + '  -> :' + name);
      }
    }
  }
  return gaps;
}

describe('every UUID path param is guarded before it reaches Prisma', () => {
  test('no route has an unguarded uuid param', () => {
    // Reported in full rather than as a count: the whole value of this test is
    // naming the route to fix.
    expect(findGaps()).toEqual([]);
  });

  test('an unguarded route IS reported — the lint is not vacuously green', () => {
    const sample = "const router = Router();\n"
      + "router.put('/seller/orders/:orderId/status', authenticate, handler);\n";
    const [call] = routerCalls(sample);
    expect(call.routePath).toBe('/seller/orders/:orderId/status');
    expect(routerLevelParams(sample).has('orderId')).toBe(false);
    expect(hasPerRouteGuard(call.call, 'orderId')).toBe(false);
  });

  test('a COMMENTED-OUT registration does not count as coverage', () => {
    // This is the bug the first draft of this lint had.
    const sample = "// router.param('orderId', uuidParamGuard);\n";
    expect(routerLevelParams(sample).has('orderId')).toBe(false);
    expect(routerLevelParams("router.param('orderId', uuidParamGuard);\n").has('orderId')).toBe(true);
  });

  test('both guard mechanisms are recognised', () => {
    const atRouter = "router.param('orderId', uuidParamGuard);\n"
      + "router.put('/orders/:orderId', handler);\n";
    expect(routerLevelParams(atRouter).has('orderId')).toBe(true);

    const perRoute = "router.get('/:farmId', [param('farmId').isUUID()], validate, handler);\n";
    expect(hasPerRouteGuard(routerCalls(perRoute)[0].call, 'farmId')).toBe(true);
  });

  test('every NON_UUID_PARAMS exemption carries a reason', () => {
    for (const [name, reason] of NON_UUID_PARAMS) {
      expect(name).toBeTruthy();
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
