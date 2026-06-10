/**
 * Geo-anomaly login detection (FRAUD-4).
 *
 * Scores a successful login against the account's recent login geography (from
 * the AUTH_LOGIN audit trail — AUTH-18) for two anomalies:
 *
 *   • impossible_travel — the implied speed between this login and the previous
 *     one exceeds a physical plausibility bound (≈ jet cruise). Logging in from
 *     Delhi and, minutes later, from Mumbai means an account is in two far-apart
 *     places at once — a classic account-takeover / shared-credential signal.
 *   • new_country — login from a country the account has never used before.
 *
 * On a hit the login is NOT blocked (the OTP already authenticated it, and a real
 * traveler must not be locked out). Instead it triggers ALERT (push to the owner)
 * + audit + a deduped FRAUD incident, and the caller surfaces a step-up hint to
 * the client. IP→geo is resolved offline (geoIp.service) so no IP leaves the
 * server. Every IO function is best-effort and NEVER throws — geo scoring must
 * not break login. Overlaps COMP-10 (geo/IP signals into risk scoring).
 */
import prisma from '../config/db.js';
import redis from '../config/redis.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';
import { haversineKm } from '../utils/geo.js';
import { resolveIpGeo } from './geoIp.service.js';
import { sendPushToUser } from './push.service.js';
import { reportSecurityEvent } from './incident.service.js';

const INCIDENT_DEDUPE_TTL_SEC = 60 * 60; // at most one geo incident per user/hour

const toMs = (t) => (t instanceof Date ? t.getTime() : Number(t));
const isCoord = (g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lng);
const round = (n) => Math.round(n * 10) / 10;

/**
 * Implied travel speed (km/h) between two timestamped points. Returns Infinity
 * when the points are simultaneous or out of order (zero/negative elapsed time)
 * — two far-apart logins at the "same instant" is itself the anomaly.
 * @param {{lat:number,lng:number,at:number|Date}} prev
 * @param {{lat:number,lng:number,at:number|Date}} curr
 */
export function impliedSpeedKmh(prev, curr) {
  const hours = (toMs(curr.at) - toMs(prev.at)) / 3_600_000;
  const km = haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
  if (hours <= 0) return km > 0 ? Infinity : 0;
  return km / hours;
}

/**
 * Pure geo-anomaly scorer. No IO — given current geo, the previous login's geo +
 * time, and the set of countries the account is known to use, decide the
 * anomaly. Exported for direct testing.
 *
 * @param {object} p
 * @param {?{lat:number,lng:number,country:?string}} p.currGeo
 * @param {number|Date} p.currAt
 * @param {?{lat:number,lng:number}} [p.prevGeo]
 * @param {number|Date} [p.prevAt]
 * @param {string[]} [p.knownCountries]
 * @returns {{anomalous:boolean, reasons:string[], action:'step_up'|'alert'|'none', impliedSpeedKmh:number, distanceKm:number}}
 */
export function scoreGeoAnomaly({ currGeo, currAt, prevGeo = null, prevAt = null, knownCountries = [] }) {
  const reasons = [];
  let impliedSpeed = 0;
  let distanceKm = 0;

  if (!currGeo) {
    return { anomalous: false, reasons, action: 'none', impliedSpeedKmh: 0, distanceKm: 0 };
  }

  // New country: only when we actually have prior country history to compare to
  // (otherwise the first geolocated login would always look "new").
  if (currGeo.country && knownCountries.length && !knownCountries.includes(currGeo.country)) {
    reasons.push('new_country');
  }

  // Impossible travel: substantial hop AND implausible implied speed. The minKm
  // floor keeps coarse IP-geo jitter within a region from false-positiving.
  if (isCoord(prevGeo) && isCoord(currGeo) && prevAt != null) {
    distanceKm = haversineKm(prevGeo.lat, prevGeo.lng, currGeo.lat, currGeo.lng);
    impliedSpeed = impliedSpeedKmh(
      { lat: prevGeo.lat, lng: prevGeo.lng, at: prevAt },
      { lat: currGeo.lat, lng: currGeo.lng, at: currAt },
    );
    if (distanceKm >= ENV.GEO_ANOMALY.minKm && impliedSpeed >= ENV.GEO_ANOMALY.maxSpeedKmh) {
      reasons.push('impossible_travel');
    }
  }

  const anomalous = reasons.length > 0;
  // Step-up on the strong signal (impossible travel); a lone new-country only alerts.
  const action = reasons.includes('impossible_travel') ? 'step_up' : anomalous ? 'alert' : 'none';
  return {
    anomalous,
    reasons,
    action,
    impliedSpeedKmh: Number.isFinite(impliedSpeed) ? round(impliedSpeed) : impliedSpeed,
    distanceKm: round(distanceKm),
  };
}

/** Pull the most-recent prior login geo + the set of known countries from audit. */
async function loadPriorGeo(userId) {
  const since = new Date(Date.now() - ENV.GEO_ANOMALY.lookbackDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.auditLog.findMany({
    where:   { userId, action: 'AUTH_LOGIN', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take:    ENV.GEO_ANOMALY.lookbackLogins,
    select:  { createdAt: true, metadata: true },
  });

  const knownCountries = new Set();
  let prevGeo = null;
  let prevAt = null;
  for (const r of rows) {
    let geo = null;
    try { geo = JSON.parse(r.metadata || '{}')?.geo || null; } catch { /* ignore */ }
    if (!geo) continue;
    if (geo.country) knownCountries.add(geo.country);
    // First (most recent) row that carries coordinates is the "previous" login.
    if (!prevGeo && isCoord(geo)) { prevGeo = { lat: geo.lat, lng: geo.lng }; prevAt = r.createdAt; }
  }
  return { prevGeo, prevAt, knownCountries: [...knownCountries] };
}

/**
 * Resolve the current login's geo and score it against the account's history.
 * MUST be called BEFORE this login's AUTH_LOGIN row is written, so the "previous"
 * login is genuinely the prior one. Never throws — returns a non-anomalous result
 * (with currGeo for the caller to persist) on any failure.
 *
 * @returns {Promise<{anomalous:boolean, reasons:string[], action:string, impliedSpeedKmh:number, distanceKm:number, currGeo:object|null}>}
 */
export async function assessLoginGeoAnomaly({ userId, ip, at = Date.now() }) {
  const inert = { anomalous: false, reasons: [], action: 'none', impliedSpeedKmh: 0, distanceKm: 0, currGeo: null };
  try {
    const currGeo = await resolveIpGeo(ip);
    if (!currGeo) return inert; // geo unknown (lib absent / private IP) → nothing to score

    const { prevGeo, prevAt, knownCountries } = await loadPriorGeo(userId);
    const score = scoreGeoAnomaly({ currGeo, currAt: at, prevGeo, prevAt, knownCountries });
    return { ...score, currGeo };
  } catch (err) {
    logger.warn('[GeoAnomaly] assessment failed, treating as non-anomalous: %s', err.message);
    return inert;
  }
}

/** Redis SET-NX dedupe so one user raises at most one geo incident per window. */
async function reserveIncidentSlot(userId) {
  if (redis?.status !== 'ready') return false;
  try {
    const r = await redis.set(`fraud:geoanomaly:inc:${userId}`, '1', 'EX', INCIDENT_DEDUPE_TTL_SEC, 'NX');
    return r === 'OK';
  } catch { return false; }
}

/**
 * Alert the account owner about an anomalous-location login + raise a deduped
 * FRAUD incident (MEDIUM — a risk signal, not a confirmed breach, so it does not
 * trip the DPDP breach-notification duty). Best-effort; never throws.
 */
export async function flagGeoAnomaly(userId, decision, { ip = null } = {}) {
  const where = decision.reasons.includes('impossible_travel') ? 'an impossible-travel pattern' : 'a new location';
  try {
    await sendPushToUser({
      userId,
      type:  'SYSTEM',
      title: 'New sign-in from an unusual location',
      body:  `We noticed a sign-in showing ${where}. If this was you, you can ignore this. If not, secure your account right away.`,
      data:  { kind: 'geo_anomaly', reasons: decision.reasons },
    });
  } catch (err) {
    logger.warn('[GeoAnomaly] alert failed: %s', err.message);
  }

  try {
    if (await reserveIncidentSlot(userId)) {
      await reportSecurityEvent({
        title: 'Anomalous-location login detected',
        description:
          `Login flagged for geo anomaly (${decision.reasons.join(', ')}). ` +
          (decision.reasons.includes('impossible_travel')
            ? `Implied travel speed ${decision.impliedSpeedKmh} km/h over ${decision.distanceKm} km from the previous login. `
            : '') +
          'Owner alerted; step-up requested.',
        category: 'FRAUD',
        severity: 'MEDIUM',
        affectedUserIds: [userId],
        metadata: { reasons: decision.reasons, impliedSpeedKmh: decision.impliedSpeedKmh, distanceKm: decision.distanceKm, ip },
      });
    }
  } catch (err) {
    logger.warn('[GeoAnomaly] incident failed: %s', err.message);
  }
}
