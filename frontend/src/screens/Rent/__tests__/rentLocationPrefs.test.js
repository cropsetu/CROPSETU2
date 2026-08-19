/**
 * The Rent distance filter.
 *
 * The bug this pass fixes was not that radius filtering was broken — it worked
 * — but that it was UNREACHABLE. The chips rendered only when GPS was already
 * the chosen source AND a fix had landed, while the shipped default is "All of
 * Maharashtra". A farmer had to understand an abstract "source" concept and
 * pick "Near me" before any distance control appeared, so in practice nobody
 * found it and the answer to "show me tractors within 10 km" was "you can't".
 *
 * These tests pin the two things that make the chips safe to expose: the query
 * a given choice produces, and what happens to a preference saved under the old
 * ladder.
 */
import {
  SOURCE,
  RADIUS_OPTIONS,
  DEFAULT_PREFS,
  effectiveSource,
  buildListParams,
} from '../rentLocationPrefs';

const PUNE = { latitude: 18.5204, longitude: 73.8567 };
const prefs = (over = {}) => ({ ...DEFAULT_PREFS, ...over });

describe('the distance ladder', () => {
  test('offers 20 km — the distance a farmer actually asked for', () => {
    expect(RADIUS_OPTIONS).toContain(20);
  });

  test('leads with "All" (null), then ascends — the Animals-tab order', () => {
    expect(RADIUS_OPTIONS[0]).toBeNull();
    const numeric = RADIUS_OPTIONS.filter((r) => r != null);
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  });
});

describe('buildListParams — what the server is actually asked for', () => {
  test('a distance choice sends the radius, an origin and distance ordering', () => {
    const p = buildListParams(prefs({ source: SOURCE.GPS, radiusKm: 20 }), PUNE, {});
    expect(p.lat).toBe(PUNE.latitude);
    expect(p.lng).toBe(PUNE.longitude);
    expect(p.radius).toBe(20);
    expect(p.sort).toBe('distance');
  });

  test('every rung of the ladder produces a usable query', () => {
    for (const km of RADIUS_OPTIONS.filter((r) => r != null)) {
      const p = buildListParams(prefs({ source: SOURCE.GPS, radiusKm: km }), PUNE, {});
      expect(p.radius).toBe(km);
      expect(p.sort).toBe('distance');
    }
  });

  test('"All" keeps the origin so distances survive — it only drops the ceiling', () => {
    // The whole point of the null rung. An earlier version dropped lat/lng too,
    // which silently switched the API to its rating-sorted branch and wiped
    // every distance badge on the screen.
    const p = buildListParams(prefs({ source: SOURCE.GPS, radiusKm: null }), PUNE, {});
    expect(p.radius).toBe('all');
    expect(p.lat).toBe(PUNE.latitude);
    expect(p.sort).toBe('distance');
  });

  test('strict coords is sent by default so "within 5 km" means provably within 5 km', () => {
    const p = buildListParams(prefs({ source: SOURCE.GPS, radiusKm: 5 }), PUNE, {});
    expect(p.strict).toBe('true');
  });

  test('turning strict off drops the flag rather than sending false', () => {
    const p = buildListParams(prefs({ source: SOURCE.GPS, radiusKm: 5, strictCoords: false }), PUNE, {});
    expect(p.strict).toBeUndefined();
  });

  test('no radius is sent without an origin — the server would ignore it anyway', () => {
    const p = buildListParams(prefs({ source: SOURCE.ALL, radiusKm: 10 }), null, {});
    expect(p.radius).toBeUndefined();
    expect(p.lat).toBeUndefined();
    expect(p.sort).toBe('rating');
  });

  test('a district search filters by name, never by a radius that does not apply', () => {
    const p = buildListParams(prefs({ source: SOURCE.DISTRICT, district: 'Pune', radiusKm: 10 }), null, {});
    expect(p.district).toBe('Pune');
    expect(p.radius).toBeUndefined();
    expect(p.sort).toBe('rating');
  });

  test('GPS chosen but no fix yet falls back to unfiltered rather than a bogus radius', () => {
    const p = buildListParams(prefs({ source: SOURCE.GPS, radiusKm: 10 }), null, {});
    expect(p.radius).toBeUndefined();
    expect(p.sort).toBe('rating');
  });
});

describe('effectiveSource tells the truth about what is in force', () => {
  test('GPS without a fix is not GPS', () => {
    expect(effectiveSource(prefs({ source: SOURCE.GPS }), null)).toBe(SOURCE.ALL);
  });

  test('district without a district chosen is not district', () => {
    expect(effectiveSource(prefs({ source: SOURCE.DISTRICT, district: null }), null)).toBe(SOURCE.ALL);
  });

  test('GPS with a fix is GPS', () => {
    expect(effectiveSource(prefs({ source: SOURCE.GPS }), PUNE)).toBe(SOURCE.GPS);
  });
});

describe('a preference saved under the OLD ladder', () => {
  // This only runs once per device, on the first launch after the release, and
  // only for farmers who had picked a distance. If it is wrong it silently
  // shrinks or widens their search and there is nothing on screen to explain it.
  const { sanitize } = require('../rentLocationPrefs');

  test('25 km (offered previously) snaps to 20, not back to the 10 km default', () => {
    expect(sanitize({ source: SOURCE.GPS, radiusKm: 25 }).radiusKm).toBe(20);
  });

  test('a value still on the ladder is left exactly alone', () => {
    for (const km of RADIUS_OPTIONS.filter((r) => r != null)) {
      expect(sanitize({ source: SOURCE.GPS, radiusKm: km }).radiusKm).toBe(km);
    }
  });

  test('"All" survives as null rather than being treated as missing', () => {
    expect(sanitize({ source: SOURCE.GPS, radiusKm: null }).radiusKm).toBeNull();
  });

  test('an off-ladder value snaps to the CLOSEST rung, in both directions', () => {
    expect(sanitize({ radiusKm: 6 }).radiusKm).toBe(5);
    expect(sanitize({ radiusKm: 12 }).radiusKm).toBe(10);
    expect(sanitize({ radiusKm: 30 }).radiusKm).toBe(20);
    expect(sanitize({ radiusKm: 100 }).radiusKm).toBe(50);
  });

  test('junk falls back to the default instead of snapping to something arbitrary', () => {
    for (const bad of ['10', {}, [], NaN, Infinity, -5, 0, undefined]) {
      expect(sanitize({ radiusKm: bad }).radiusKm).toBe(DEFAULT_PREFS.radiusKm);
    }
  });

  test('a corrupt or empty blob yields the defaults rather than throwing', () => {
    for (const bad of [null, undefined, 'nonsense', 42]) {
      expect(sanitize(bad)).toEqual(DEFAULT_PREFS);
    }
  });

  test('an unknown source falls back rather than leaving the UI in a dead state', () => {
    expect(sanitize({ source: 'satellite' }).source).toBe(DEFAULT_PREFS.source);
  });
});
