/**
 * Credit prices are a product decision, not an implementation detail.
 *
 * §72 lists "changing payment semantics" among the things to pause and report
 * on rather than fold into a refactor. This suite exists so a price change has
 * to be deliberate: it pins the numbers that farmers are actually charged, in a
 * file with no mocks, so a correctness fix elsewhere cannot quietly reprice a
 * feature on its way past.
 */
import { describe, it, expect } from '@jest/globals';
import { CREDIT_COSTS } from '../../../src/services/aiCredit.service.js';

describe('CREDIT_COSTS', () => {
  it('prices price-prediction the same as the legacy key the route used to charge', () => {
    // agriPredict's /predict route charged `ai_chat_claude` (2 credits) through
    // a fire-and-forget deductCredits. Converting it to reserve/settle/release
    // fixed the GATE; `ai_predict` is 2 so the price is untouched.
    expect(CREDIT_COSTS.ai_predict).toBe(2);
    expect(CREDIT_COSTS.ai_predict).toBe(CREDIT_COSTS.ai_chat_claude);
  });

  it('keeps the live Gemini-era prices farmers are quoted', () => {
    expect(CREDIT_COSTS.ai_scan_gemini).toBe(3);
    expect(CREDIT_COSTS.ai_chat_gemini).toBe(1);
    expect(CREDIT_COSTS.ai_voice).toBe(2);
    expect(CREDIT_COSTS.ai_soil_ocr).toBe(3);
  });

  it('every price is a non-negative integer', () => {
    // A fractional or negative cost would silently break the reserve/settle
    // arithmetic rather than throw.
    for (const [key, cost] of Object.entries(CREDIT_COSTS)) {
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(0);
    }
  });

  it('every key a route gates on is defined here', async () => {
    // reserveCredits falls back to a 1-credit minimum for an unknown key, which
    // UNDER-gates a 3-credit feature. It warns, but a warning in production logs
    // is a worse place to find this than a failing test.
    const { readFileSync, readdirSync } = await import('fs');
    const dir = new URL('../../../src/routes/', import.meta.url);
    const used = new Set();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(/reserveCredits\([^,]+,\s*'([a-z0-9_]+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) expect(CREDIT_COSTS).toHaveProperty(key);
  });
});
