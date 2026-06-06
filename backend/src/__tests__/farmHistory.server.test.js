/**
 * Tests for src/utils/farmHistory.server.js — the pure helpers that turn a
 * crop-cycle's JSON logs + cost columns into compact AI-context strings and
 * multi-year trend aggregates.
 *
 * Run:  node --test src/__tests__/farmHistory.server.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeFertilizers,
  summarizePesticides,
  summarizeCostSplit,
  buildPriorIssues,
  buildHistory,
} from '../utils/farmHistory.server.js';

test('summarizeFertilizers renders product, qty, stage and date', () => {
  const s = summarizeFertilizers([
    { productName: 'Urea', quantityKg: 50, applicationStage: 'Vegetative', applicationDate: '2026-06-20' },
  ]);
  assert.match(s, /Urea 50kg \(Vegetative, 20 Jun\)/);
});

test('summarizers are defensive on empty/garbage input', () => {
  assert.equal(summarizeFertilizers(null), '');
  assert.equal(summarizePesticides(undefined), '');
  assert.equal(summarizeCostSplit(null), '');
  assert.deepEqual(buildPriorIssues(null), []);
});

test('summarizeCostSplit sums fertilizer/pesticide arrays + scalar costs, omits zeros', () => {
  const s = summarizeCostSplit({
    seedTotalCostInr: 1200,
    fertilizersUsed: [{ costInr: 500 }, { costInr: 300 }],
    pesticidesUsed: [{ costInr: 400 }],
    laborCostInr: 600,
    machineryCostInr: 0,
    otherCostInr: 0,
  });
  assert.equal(s, 'Seed ₹1200, Fertilizer ₹800, Pesticide ₹400, Labour ₹600');
});

test('buildPriorIssues dedupes (case-insensitive) across events + spray targets', () => {
  const issues = buildPriorIssues([
    { observedEvents: [{ type: 'Aphids' }, { type: 'frost' }], pesticidesUsed: [{ targetPestOrDisease: 'aphids' }] },
    { observedEvents: [{ type: 'Rust' }], pesticidesUsed: [{ targetPestOrDisease: 'Rust' }] },
  ]);
  assert.deepEqual(issues, ['Aphids', 'frost', 'Rust']);
});

test('buildHistory sorts oldest→newest and emits trends + priorIssues', () => {
  const h = buildHistory([
    { seasonLabel: 'Rabi 25', sowingDate: '2025-11-01', harvestYieldQuintal: 22, netProfitInr: 18000, totalInputCostInr: 12000, observedEvents: [{ type: 'Blight' }] },
    { seasonLabel: 'Kharif 24', sowingDate: '2024-06-15', harvestYieldQuintal: 18, netProfitInr: 9000, totalInputCostInr: 11000 },
  ]);
  assert.deepEqual(h.yieldTrend.map((x) => x.value), [18, 22]); // chronological
  assert.deepEqual(h.profitTrend.map((x) => x.label), ['Kharif 24', 'Rabi 25']);
  assert.deepEqual(h.priorIssues, ['Blight']);
});
