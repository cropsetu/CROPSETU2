/**
 * Tests for buildCyclePredictions() — the pure rule engine behind
 * FarmerPrediction insights. No DB needed.
 *
 * Run:  node --test src/__tests__/farmPrediction.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCyclePredictions } from '../services/farmPrediction.service.js';

test('no priors → no predictions (nothing to ground them on)', () => {
  const preds = buildCyclePredictions({ cropName: 'Soybean', areaAllocatedAcres: 2 }, []);
  assert.deepEqual(preds, []);
});

test('prior yields + profit produce YIELD + INCOME forecasts scaled to area', () => {
  const preds = buildCyclePredictions(
    { cropName: 'Soybean', areaAllocatedAcres: 3 },
    [
      { harvestYieldQuintal: 20, profitPerAcreInr: 10000 },
      { harvestYieldQuintal: 24, profitPerAcreInr: 12000 },
    ],
  );
  const yld = preds.find((p) => p.predictionType === 'YIELD_FORECAST');
  const inc = preds.find((p) => p.predictionType === 'INCOME_FORECAST');
  assert.ok(yld, 'has yield forecast');
  assert.equal(yld.output.expectedQuintal, 22);          // avg(20,24)
  assert.ok(inc, 'has income forecast');
  assert.equal(inc.output.perAcreInr, 11000);            // avg(10000,12000)
  assert.equal(inc.output.projectedNetProfitInr, 33000); // 11000 × 3 acres
  assert.ok(inc.explanationEn && inc.explanationHi && inc.explanationMr);
});

test('recurring pests across priors produce a PEST_RISK insight (deduped)', () => {
  const preds = buildCyclePredictions(
    { cropName: 'Cotton', areaAllocatedAcres: 1 },
    [
      { observedEvents: [{ type: 'Pink bollworm' }], pesticidesUsed: [{ targetPestOrDisease: 'pink bollworm' }] },
      { observedEvents: [{ type: 'Aphids' }] },
    ],
  );
  const pest = preds.find((p) => p.predictionType === 'PEST_RISK');
  assert.ok(pest, 'has pest risk');
  assert.deepEqual(pest.output.recurringIssues, ['Pink bollworm', 'Aphids']);
});
