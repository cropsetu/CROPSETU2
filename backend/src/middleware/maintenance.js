/**
 * Maintenance mode gate.
 *
 * The `app.maintenanceMode` / `app.maintenanceMessage` settings were editable from
 * the admin panel but read by NOTHING — flipping the switch turned it green, fired
 * a "saved" toast, and let every request through untouched. That is worse than not
 * having the control: it fails exactly when an operator is relying on it.
 *
 * Deliberate exemptions, so enabling maintenance never locks you out of fixing it:
 *   - /healthz, /readyz, /health  — the platform healthcheck must keep passing or
 *     Railway will kill and restart the container mid-maintenance.
 *   - /api/v1/admin/*            — the admin panel must stay usable to turn it OFF.
 *   - /api/v1/auth/*             — an admin still has to be able to log in.
 *   - the /admin SPA assets      — same reason.
 *
 * Reads the DB row DIRECTLY rather than through getSetting(): that helper caches
 * for 60s, and a minute of lag is unacceptable on the one control you reach for
 * during an incident. This adds a single indexed lookup to non-exempt requests,
 * throttled by a 5s in-process cache so a traffic spike cannot stampede the DB.
 */
import prisma from '../config/db.js';
import { sendError } from '../utils/response.js';
import logger from '../utils/logger.js';

const CHECK_TTL_MS = 5_000;
let _cached = { on: false, message: '', at: 0 };

const EXEMPT_PREFIXES = ['/healthz', '/readyz', '/health', '/admin'];
const EXEMPT_API_PREFIXES = ['/admin', '/auth'];

function isExempt(req) {
  const p = req.path || '';
  if (EXEMPT_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return true;
  // API_PREFIX-agnostic: match /api/v1/admin/... and /api/v1/auth/... whatever the
  // configured prefix is, by looking for the segment after the version.
  return EXEMPT_API_PREFIXES.some((x) => p.includes(`${x}/`) || p.endsWith(x));
}

async function readState() {
  const now = Date.now();
  if (now - _cached.at < CHECK_TTL_MS) return _cached;
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ['app.maintenanceMode', 'app.maintenanceMessage'] } },
      select: { key: true, value: true },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const raw = byKey['app.maintenanceMode'];
    _cached = {
      on: raw === true || raw === 'true',
      message: typeof byKey['app.maintenanceMessage'] === 'string' ? byKey['app.maintenanceMessage'] : '',
      at: now,
    };
  } catch (err) {
    // Fail OPEN: a DB blip must not take the whole API down. Keep the last known
    // state rather than assuming maintenance.
    logger.warn('[Maintenance] state read failed, keeping last known: %s', err.message);
    _cached = { ..._cached, at: now };
  }
  return _cached;
}

export async function maintenanceMode(req, res, next) {
  if (isExempt(req)) return next();
  const { on, message } = await readState();
  if (!on) return next();
  return sendError(
    res,
    message || 'CropSetu is temporarily down for maintenance. Please try again shortly.',
    503,
    { maintenance: true },
  );
}

export default maintenanceMode;
