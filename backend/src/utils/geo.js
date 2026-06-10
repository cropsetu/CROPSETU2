/**
 * Geo utilities — shared across rent, animaltrade routes.
 *
 * Haversine: O(1) per pair. attachDistance: O(n) for n items.
 */
import { Prisma } from '@prisma/client';

/**
 * Great-circle distance in km between two lat/lng points (Haversine formula).
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Attach distanceKm to each item and filter by radius.
 * Items without lat/lng are kept but sorted last.
 *
 * @param {Array} items - objects with .lat/.lng or .latitude/.longitude
 * @param {number} userLat
 * @param {number} userLng
 * @param {number} radiusKm - max distance to include
 * @returns {Array} filtered + sorted by distance ascending
 */
export function attachDistance(items, userLat, userLng, radiusKm) {
  return items
    .map(item => {
      const lat = item.lat ?? item.latitude;
      const lng = item.lng ?? item.longitude;
      if (lat == null || lng == null) return { ...item, distanceKm: null };
      const d = haversineKm(userLat, userLng, lat, lng);
      return { ...item, distanceKm: parseFloat(d.toFixed(1)) };
    })
    .filter(item => item.distanceKm === null || item.distanceKm <= radiusKm)
    .sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
}

/**
 * Push a geo-radius query down to SQL and return ONLY the requested page's row
 * IDs — bounded by `limit`, never the old 500-row in-memory buffer.
 *
 * The bounding box (index-friendly lat/lng range), the Haversine circle refine,
 * the distance sort, and LIMIT/OFFSET all run in Postgres, so pagination
 * discards rows in the DB instead of after shipping them. Mirrors
 * attachDistance() semantics exactly:
 *   - located rows are kept only within `radiusKm` (circle, not just the box),
 *     ordered by distance ascending (rounded to 0.1 km, matching toFixed(1));
 *   - coordinate-less (legacy) rows are kept and sorted LAST;
 *   - ties break by rating desc, then createdAt desc (the listing default order).
 *
 * @param prisma          Prisma client
 * @param tableSql        Prisma.raw('"machinery_listings"') — TRUSTED constant, never user input
 * @param whereSql        Prisma.sql boolean fragment for non-geo filters (already parameterised)
 * @param {number} lat, lng, radiusKm
 * @param {number} offset, limit
 * @returns {Promise<{ ids: string[], distById: Map<string, number|null>, total: number }>}
 */
export async function geoPageIds(prisma, { tableSql, whereSql, lat, lng, radiusKm, offset, limit }) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  const latLo = lat - latDelta, latHi = lat + latDelta;
  const lngLo = lng - lngDelta, lngHi = lng + lngDelta;

  // NULL distance for coordinate-less rows; great-circle km otherwise.
  const distExpr = Prisma.sql`CASE WHEN lat IS NULL OR lng IS NULL THEN NULL ELSE
    6371 * acos(LEAST(1.0,
      cos(radians(${lat})) * cos(radians(lat)) * cos(radians(lng) - radians(${lng}))
      + sin(radians(${lat})) * sin(radians(lat)))) END`;

  // Index-friendly box for located rows; coordinate-less rows pass through.
  const geoFilter = Prisma.sql`( (lat IS NULL OR lng IS NULL)
    OR (lat BETWEEN ${latLo} AND ${latHi} AND lng BETWEEN ${lngLo} AND ${lngHi}) )`;

  const inner = Prisma.sql`
    SELECT id, ${distExpr} AS dist, rating, "createdAt"
    FROM ${tableSql}
    WHERE ${whereSql} AND ${geoFilter}`;

  const [pageRows, countRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT id, dist FROM ( ${inner} ) t
      WHERE dist IS NULL OR dist <= ${radiusKm}
      ORDER BY ROUND(dist::numeric, 1) ASC NULLS LAST, rating DESC, "createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}`,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM ( ${inner} ) t
      WHERE dist IS NULL OR dist <= ${radiusKm}`,
  ]);

  const ids = pageRows.map(r => r.id);
  const distById = new Map(
    pageRows.map(r => [r.id, r.dist == null ? null : parseFloat(Number(r.dist).toFixed(1))]),
  );
  return { ids, distById, total: countRows[0]?.n ?? 0 };
}
