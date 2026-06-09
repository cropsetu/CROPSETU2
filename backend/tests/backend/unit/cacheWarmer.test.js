/**
 * Tests for cache warming / preloading (services/cacheWarmer.service.js).
 *
 * Acceptance: hot keys are populated before the first user request post-deploy.
 * We verify the warmer calls getMarketPrices() for every hot combo (which is what
 * populates the in-process cache), tolerates failures, and skips cleanly when no
 * LLM key is configured. market.data.service and featureFlag.service are
 * module-mocked so warming runs without Groq or a DB.
 */
import { jest } from '@jest/globals';

const getMarketPrices = jest.fn(async (commodity, state) => ({ crop: commodity, state, isFallback: false }));
jest.unstable_mockModule('../../../src/services/market.data.service.js', () => ({ getMarketPrices }));

const isEnabled = jest.fn(async () => true);
jest.unstable_mockModule('../../../src/services/featureFlag.service.js', () => ({ isEnabled }));

// ENV is read for GROQ_API_KEY; mock it as a stable object whose property we
// mutate per-test (the consumer reads ENV.GROQ_API_KEY off this same reference).
const fakeEnv = { GROQ_API_KEY: 'test-key' };
jest.unstable_mockModule('../../../src/config/env.js', () => ({ ENV: fakeEnv }));

const { warmMarketCache, warmFeatureFlags, warmAllCaches } =
  await import('../../../src/services/cacheWarmer.service.js');

beforeEach(() => { getMarketPrices.mockClear(); isEnabled.mockClear(); fakeEnv.GROQ_API_KEY = 'test-key'; });

describe('warmMarketCache', () => {
  test('warms every hot combo (one getMarketPrices call each) and reports them ok', async () => {
    const res = await warmMarketCache();
    expect(res.total).toBeGreaterThan(0);
    expect(getMarketPrices).toHaveBeenCalledTimes(res.total); // every hot key preloaded
    expect(res.ok).toBe(res.total);
    expect(res.fail).toBe(0);
  });

  test('skips cleanly when GROQ_API_KEY is unset (no pointless calls)', async () => {
    fakeEnv.GROQ_API_KEY = '';
    const res = await warmMarketCache();
    expect(res.skipped).toBe(true);
    expect(getMarketPrices).not.toHaveBeenCalled();
  });

  test('counts fallback/failed results as misses, not warm', async () => {
    getMarketPrices.mockImplementation(async (c, s) => ({ crop: c, state: s, isFallback: true }));
    const res = await warmMarketCache();
    expect(res.ok).toBe(0);
    expect(res.fail).toBe(res.total);
  });

  test('a rejected warm call does not abort the rest of the batch', async () => {
    getMarketPrices
      .mockRejectedValueOnce(new Error('groq down'))
      .mockResolvedValue({ isFallback: false });
    const res = await warmMarketCache();
    expect(getMarketPrices).toHaveBeenCalledTimes(res.total); // all attempted despite one throw
    expect(res.fail).toBeGreaterThanOrEqual(1);
    expect(res.ok).toBeGreaterThan(0);
  });
});

describe('warmAllCaches', () => {
  test('warms feature flags and market cache, never throws', async () => {
    await expect(warmAllCaches()).resolves.toBeUndefined();
    expect(isEnabled).toHaveBeenCalled();
    expect(getMarketPrices).toHaveBeenCalled();
  });

  test('warmFeatureFlags swallows errors', async () => {
    isEnabled.mockRejectedValueOnce(new Error('db down'));
    await expect(warmFeatureFlags()).resolves.toBeUndefined();
  });
});
