/**
 * UUID path-param guard.
 *
 * Every model id in the schema is `@default(uuid())`, so a path param that isn't
 * a UUID can never match a row. Passing a malformed id straight to Prisma either
 * throws (P2023 "malformed uuid" → 500) or invites enumeration / timing probes.
 * This guard rejects non-UUID ids with a clean 400 before they reach the DB.
 *
 * Register per UUID param name on a router (NOT on slug/name/key params such as
 * :commodity, :name, :key, or the non-DB FastAPI :jobId):
 *
 *   import { uuidParamGuard } from '../middleware/uuidParams.js';
 *   router.param('id', uuidParamGuard);
 *   router.param('productId', uuidParamGuard);
 *
 * Express calls the guard once per request when the named param is present,
 * before the route handlers, and passes the matched param name as the 5th arg.
 */
import { sendError } from '../utils/response.js';

// Accepts any RFC-4122 UUID version (Prisma uuid() emits v4); case-insensitive.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParamGuard(req, res, next, value, name) {
  if (!UUID_RE.test(String(value))) {
    return sendError(res, `Invalid ${name}: not a valid id`, 400);
  }
  return next();
}
