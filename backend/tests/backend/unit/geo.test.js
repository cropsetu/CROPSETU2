/**
 * Unit tests for src/utils/geo.js
 * Covers: haversineKm, attachDistance
 */
import { haversineKm, attachDistance } from '../../../src/utils/geo.js';

describe('haversineKm', () => {
  test('same point returns 0', () => {
    expect(haversineKm(18.52, 73.85, 18.52, 73.85)).toBe(0);
  });

  test('Pune to Mumbai ≈ 150 km', () => {
    const dist = haversineKm(18.52, 73.85, 19.07, 72.87);
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(200);
  });

  test('returns positive value regardless of argument order', () => {
    const a = haversineKm(18.52, 73.85, 19.07, 72.87);
    const b = haversineKm(19.07, 72.87, 18.52, 73.85);
    expect(a).toBeCloseTo(b, 5);
  });

  test('null coordinates coerce to 0,0 — returns distance to null island', () => {
    // haversineKm does not guard against null — JS coerces null to 0.
    // attachDistance handles null coords by skipping the distance calc.
    const dist = haversineKm(null, null, 18.52, 73.85);
    expect(typeof dist).toBe('number');
    expect(dist).toBeGreaterThan(0);
  });
});

describe('attachDistance', () => {
  const items = [
    { id: '1', lat: 18.52, lng: 73.85 },  // Pune
    { id: '2', lat: 19.07, lng: 72.87 },  // Mumbai (~150km)
    { id: '3', lat: null,  lng: null },     // No coords
    { id: '4', lat: 18.55, lng: 73.88 },  // Near Pune (~4km)
  ];

  test('attaches distanceKm to items with coordinates', () => {
    const result = attachDistance(items, 18.52, 73.85, 200);
    const withDist = result.filter(i => i.distanceKm != null);
    expect(withDist.length).toBeGreaterThanOrEqual(2);
  });

  test('filters out items beyond radius', () => {
    const result = attachDistance(items, 18.52, 73.85, 10);
    // Only Pune itself and nearby (4km) should be within 10km
    const ids = result.map(r => r.id);
    expect(ids).toContain('1');
    expect(ids).toContain('4');
    expect(ids).not.toContain('2'); // Mumbai is ~150km away
  });

  test('includes items with null coordinates (no exclusion)', () => {
    const result = attachDistance(items, 18.52, 73.85, 200);
    const ids = result.map(r => r.id);
    expect(ids).toContain('3');
  });

  test('sorts by distance ascending', () => {
    const result = attachDistance(items, 18.52, 73.85, 200);
    const distances = result
      .filter(r => r.distanceKm != null)
      .map(r => r.distanceKm);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
    }
  });
});
