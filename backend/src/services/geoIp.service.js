/**
 * IP → geolocation resolver (FRAUD-4 support).
 *
 * Resolves a public IP to coarse coordinates + country for geo-anomaly scoring.
 * Two hard constraints drive the design:
 *
 *   1. PRIVACY (DPDP). A login IP is personal data. We resolve it OFFLINE — no IP
 *      is ever sent to a third party — via the optional `geoip-lite` package
 *      (a bundled MaxMind GeoLite2 snapshot). It's loaded by dynamic import so it
 *      stays a soft dependency: if it isn't installed the resolver simply returns
 *      null and geo-anomaly detection is inert (no errors, no false positives).
 *      Activate the feature with a single `npm i geoip-lite`.
 *
 *   2. RESILIENCE. This sits in the login path, so it NEVER throws and always
 *      degrades to null on any problem (private IP, lib missing, lookup miss).
 *
 * Results are cached in Redis (IP geo is stable) to avoid repeat lookups.
 */
import redis from '../config/redis.js';
import logger from '../utils/logger.js';

const CACHE_PREFIX = 'geoip:';
const CACHE_TTL_SEC = 7 * 24 * 60 * 60; // IP→geo is stable; refresh weekly

// Soft-load geoip-lite once. _lib === undefined → not tried yet; null → absent.
let _lib;
async function getGeoLib() {
  if (_lib !== undefined) return _lib;
  try {
    const mod = await import('geoip-lite');
    _lib = mod?.default ?? mod ?? null;
  } catch {
    _lib = null;
    logger.info('[GeoIP] geoip-lite not installed — geo-anomaly detection is inert. Install it to enable offline IP geolocation.');
  }
  return _lib;
}

/**
 * Is this a routable public IP worth geolocating? Rejects loopback, RFC1918
 * private, link-local, CGNAT and IPv6 local ranges — none of which geolocate
 * meaningfully (and dev/test traffic is all loopback).
 */
export function isPublicIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  let s = ip.trim();
  if (!s) return false;
  // Normalise IPv4-mapped IPv6 (::ffff:1.2.3.4) down to the IPv4 form.
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) s = mapped[1];

  if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length !== 4) return false;
    const o = parts.map((p) => Number(p));
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = o;
    if (a === 10) return false;                          // 10.0.0.0/8
    if (a === 127) return false;                         // loopback
    if (a === 172 && b >= 16 && b <= 31) return false;   // 172.16.0.0/12
    if (a === 192 && b === 168) return false;            // 192.168.0.0/16
    if (a === 169 && b === 254) return false;            // link-local
    if (a === 100 && b >= 64 && b <= 127) return false;  // CGNAT 100.64.0.0/10
    if (a === 0) return false;
    return true;
  }

  // IPv6
  const lower = s.toLowerCase();
  if (lower === '::1' || lower === '::') return false;   // loopback / unspecified
  if (lower.startsWith('fe80')) return false;            // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false; // unique-local fc00::/7
  return lower.includes(':');
}

async function getCached(ip) {
  if (redis?.status !== 'ready') return undefined;
  try {
    const raw = await redis.get(`${CACHE_PREFIX}${ip}`);
    if (raw == null) return undefined;
    return JSON.parse(raw); // may be null (cached "no geo")
  } catch { return undefined; }
}

async function setCached(ip, geo) {
  if (redis?.status !== 'ready') return;
  try {
    await redis.set(`${CACHE_PREFIX}${ip}`, JSON.stringify(geo), 'EX', CACHE_TTL_SEC);
  } catch { /* cache is best-effort */ }
}

/**
 * Resolve an IP to `{ lat, lng, country, region }` or null. Never throws.
 * @param {string} ip
 * @returns {Promise<{lat:number,lng:number,country:?string,region:?string}|null>}
 */
export async function resolveIpGeo(ip) {
  try {
    if (!isPublicIp(ip)) return null;

    const cached = await getCached(ip);
    if (cached !== undefined) return cached;

    const lib = await getGeoLib();
    if (!lib?.lookup) return null;

    const g = lib.lookup(ip);
    const geo = g && Array.isArray(g.ll) && g.ll.length === 2
      ? { lat: g.ll[0], lng: g.ll[1], country: g.country || null, region: g.region || null }
      : null;

    await setCached(ip, geo);
    return geo;
  } catch (err) {
    logger.warn('[GeoIP] resolve failed (treating as unknown): %s', err.message);
    return null;
  }
}

/** Test-only: reset the soft-loaded lib reference. */
export function _resetGeoLibForTests() {
  _lib = undefined;
}
