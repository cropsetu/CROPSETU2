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
 * attachDistance() semantics exactly BY DEFAULT:
 *   - located rows are kept only within `radiusKm` (circle, not just the box),
 *     ordered by distance ascending (rounded to 0.1 km, matching toFixed(1));
 *   - coordinate-less (legacy) rows are kept and sorted LAST;
 *   - ties break by rating desc, then createdAt desc (the listing default order).
 *
 * Two OPT-IN behaviours extend that; both default to the semantics above so
 * existing callers are byte-for-byte unchanged:
 *
 *   strict:true    drop coordinate-less rows entirely. "Within 5 km" then means
 *                  every returned row is provably within 5 km — a row with no
 *                  lat/lng cannot make that claim, so it is excluded rather than
 *                  silently included in every radius.
 *
 *   radiusKm:null  no distance ceiling ("any distance"). Distances are still
 *                  computed and still drive the sort — only the circle filter and
 *                  the bounding box are dropped. This is what lets the client
 *                  keep distance badges while removing the radius limit.
 *
 * @param prisma          Prisma client
 * @param tableSql        Prisma.raw('"machinery_listings"') — TRUSTED constant, never user input
 * @param whereSql        Prisma.sql boolean fragment for non-geo filters (already parameterised)
 * @param {number} lat, lng
 * @param {number|null} radiusKm  km ceiling, or null for "no ceiling"
 * @param {number} offset, limit
 * @param {boolean} [strict=false]        exclude rows with no coordinates
 * @param {'distance'|'price'|'rating'} [sort='distance']  result ordering
 * @param {object} [priceColSql]  Prisma.sql column used by sort:'price' — TRUSTED
 *                                constant, never user input. Only referenced when
 *                                sort === 'price', so tables without the column
 *                                are unaffected.
 * @returns {Promise<{ ids: string[], distById: Map<string, number|null>, total: number }>}
 */
export async function geoPageIds(prisma, {
  tableSql, whereSql, lat, lng, radiusKm, offset, limit,
  strict = false,
  sort = 'distance',
  priceColSql = Prisma.sql`"pricePerDay"`,
}) {
  // `null` radius = no ceiling. Anything non-finite (e.g. a junk ?radius=) is
  // treated the same way rather than poisoning the bounding box with NaN, which
  // would silently match zero located rows.
  const unbounded = radiusKm == null || !Number.isFinite(radiusKm);

  // NULL distance for coordinate-less rows; great-circle km otherwise.
  const distExpr = Prisma.sql`CASE WHEN lat IS NULL OR lng IS NULL THEN NULL ELSE
    6371 * acos(LEAST(1.0,
      cos(radians(${lat})) * cos(radians(lat)) * cos(radians(lng) - radians(${lng}))
      + sin(radians(${lat})) * sin(radians(lat)))) END`;

  // Located rows are pre-filtered by an index-friendly box (skipped when there
  // is no ceiling — there is nothing to bound). Coordinate-less rows pass the
  // box in loose mode and are rejected outright in strict mode.
  const hasCoords = Prisma.sql`(lat IS NOT NULL AND lng IS NOT NULL)`;
  let geoFilter;
  if (unbounded) {
    geoFilter = strict ? hasCoords : Prisma.sql`TRUE`;
  } else {
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
    const box = Prisma.sql`(lat BETWEEN ${lat - latDelta} AND ${lat + latDelta}
      AND lng BETWEEN ${lng - lngDelta} AND ${lng + lngDelta})`;
    geoFilter = strict ? box : Prisma.sql`( (lat IS NULL OR lng IS NULL) OR ${box} )`;
  }

  // Circle refine on the computed distance. Loose mode keeps NULL distances
  // (they cannot be compared); strict mode has already excluded them.
  let distFilter;
  if (unbounded) distFilter = strict ? Prisma.sql`dist IS NOT NULL` : Prisma.sql`TRUE`;
  else distFilter = strict ? Prisma.sql`dist <= ${radiusKm}`
                           : Prisma.sql`dist IS NULL OR dist <= ${radiusKm}`;

  // Only select the price column when it is actually ordered on, so tables
  // without a pricePerDay column keep working with the other sorts.
  const wantPrice = sort === 'price';
  const priceSelect = wantPrice ? Prisma.sql`, ${priceColSql} AS sortprice` : Prisma.empty;

  const byDist = Prisma.sql`ROUND(dist::numeric, 1) ASC NULLS LAST`;
  const orderBy =
    sort === 'price'  ? Prisma.sql`sortprice ASC NULLS LAST, ${byDist}, rating DESC` :
    sort === 'rating' ? Prisma.sql`rating DESC, ${byDist}, "createdAt" DESC` :
                        Prisma.sql`${byDist}, rating DESC, "createdAt" DESC`;

  const inner = Prisma.sql`
    SELECT id, ${distExpr} AS dist, rating, "createdAt"${priceSelect}
    FROM ${tableSql}
    WHERE ${whereSql} AND ${geoFilter}`;

  const [pageRows, countRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT id, dist FROM ( ${inner} ) t
      WHERE ${distFilter}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM ( ${inner} ) t
      WHERE ${distFilter}`,
  ]);

  const ids = pageRows.map(r => r.id);
  const distById = new Map(
    pageRows.map(r => [r.id, r.dist == null ? null : parseFloat(Number(r.dist).toFixed(1))]),
  );
  return { ids, distById, total: countRows[0]?.n ?? 0 };
}
