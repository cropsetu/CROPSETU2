/**
 * Tests for location/horizon-granular weather caching (routes/weather.routes.js).
 *
 * Acceptance (weather cache ticket): updating one location doesn't invalidate all
 * forecasts, and the independently-sourced parts (Open-Meteo forecast vs IMD
 * alerts) cache/refresh independently. The services + prisma are module-mocked so
 * the route runs without network or a DB; call counts reveal what was (re)fetched.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Count Open-Meteo fetches per coordinate so we can prove cache hits + isolation.
const omCalls = new Map();
const fetchOpenMeteo = jest.fn(async (lat, lon) => {
  const k = `${lat},${lon}`;
  omCalls.set(k, (omCalls.get(k) || 0) + 1);
  return {
    current: { tempC: 30 }, hourly: { t: [] }, daily: { tMax: [] }, agriculture: { soil: 1 },
  };
});
const reverseGeocode = jest.fn(async () => 'TestCity');
jest.unstable_mockModule('../../../src/services/openMeteo.service.js', () => ({ fetchOpenMeteo, reverseGeocode }));

const scrapeIMD = jest.fn(async () => ({ imdAvailable: true, alerts: [{ title: 'Heatwave' }] }));
jest.unstable_mockModule('../../../src/services/imd.scraper.service.js', () => ({ scrapeIMD }));

jest.unstable_mockModule('../../../src/services/weather.advisory.service.js', () => ({
  generateAdvisories: jest.fn(() => [{ tip: 'irrigate' }]),
}));

// In-memory only: DB cache returns nothing so all caching happens in L1.
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: {
    weatherCache: {
      findUnique: jest.fn(async () => null),
      upsert:     jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  },
}));

const { default: weatherRouter, makeCacheKey, _resetWeatherCacheForTest } = await import('../../../src/routes/weather.routes.js');

function buildApp() {
  const app = express();
  app.use('/weather', weatherRouter);
  return app;
}
const flush = () => new Promise((r) => setTimeout(r, 20)); // let setImmediate + IMD promise settle

const A = '?lat=19.07&lon=72.88'; // Mumbai
const B = '?lat=28.61&lon=77.23'; // Delhi (non-trailing-zero coords keep the call key unambiguous)

describe('makeCacheKey — location + segment granularity', () => {
  test('different locations and segments map to distinct keys', () => {
    expect(makeCacheKey(19.07, 72.88, 'forecast')).toBe('19.07_72.88:forecast');
    // Segment is part of the key → forecast and alerts never collide.
    expect(makeCacheKey(19.07, 72.88, 'forecast')).not.toBe(makeCacheKey(19.07, 72.88, 'alerts'));
    // Location is part of the key → one location can't touch another.
    expect(makeCacheKey(19.07, 72.88, 'forecast')).not.toBe(makeCacheKey(28.61, 77.20, 'forecast'));
  });
});

describe('weather cache — independence', () => {
  beforeEach(() => { _resetWeatherCacheForTest(); omCalls.clear(); fetchOpenMeteo.mockClear(); scrapeIMD.mockClear(); });

  test('a repeat request for the same location is served from cache (no re-fetch)', async () => {
    const app = buildApp();
    await request(app).get(`/weather/${A}`).expect(200);
    await request(app).get(`/weather/${A}`).expect(200);
    expect(omCalls.get('19.07,72.88')).toBe(1); // second request hit L1
  });

  test('updating one location does NOT invalidate another location’s forecast', async () => {
    const app = buildApp();
    await request(app).get(`/weather/${A}`).expect(200); // A fetched + cached
    await request(app).get(`/weather/${B}`).expect(200); // B fetched (independent key)
    await request(app).get(`/weather/${A}`).expect(200); // A still cached

    expect(omCalls.get('19.07,72.88')).toBe(1); // A fetched exactly once — B didn't evict it
    expect(omCalls.get('28.61,77.23')).toBe(1); // B fetched once
  });

  test('IMD alerts compose independently — they appear without re-fetching the forecast', async () => {
    const app = buildApp();
    const first = await request(app).get(`/weather/${A}`).expect(200);
    expect(first.body.data.alerts).toEqual([]);      // forecast returns before IMD enrichment
    expect(first.body.data.meta.imdAvailable).toBe(false);

    await flush(); // background IMD scrape populates the ALERTS segment only

    const second = await request(app).get(`/weather/${A}`).expect(200);
    expect(second.body.data.alerts).toEqual([{ title: 'Heatwave' }]); // alerts now composed in
    expect(second.body.data.meta.imdAvailable).toBe(true);
    expect(omCalls.get('19.07,72.88')).toBe(1); // forecast was NOT re-fetched to add alerts
  });
});
