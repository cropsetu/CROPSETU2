/**
 * Geo utilities — shared across rent, animaltrade routes.
 *
 * Haversine: O(1) per pair. attachDistance: O(n) for n items.
 */

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
