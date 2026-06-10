/**
 * Tests for computeFinancials() in src/services/cropCycle.service.js —
 * verifies itemised laborLogs/expenseLogs/incomeLogs override the scalar
 * columns, that the scalar fallback still works for legacy cycles, and that
 * incomeLogs add to gross income.
 *
 * Run:  node --test src/__tests__/cropCycleFinancials.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeFinancials } from '../services/cropCycle.service.js';

// computeFinancials returns exact Prisma.Decimal values (money is stored as
// DECIMAL); coerce to Number for numeric assertions.
const n = (d) => Number(d);

test('legacy cycle (scalar costs, no log arrays) totals correctly', () => {
  const fin = computeFinancials({
    areaAllocatedAcres: 2,
    seedTotalCostInr: 1000,
    fertilizersUsed: [{ costInr: 500 }],
    pesticidesUsed: [{ costInr: 300 }],
    laborCostInr: 1200,
    machineryCostInr: 800,
    otherCostInr: 200,
    saleTotalRevenueInr: 6000,
  });
  assert.equal(n(fin.totalInputCostInr), 4000); // 1000+500+300+1200+800+200
  assert.equal(n(fin.grossIncomeInr), 6000);
  assert.equal(n(fin.netProfitInr), 2000);
  assert.equal(n(fin.profitPerAcreInr), 1000);
});

test('itemised laborLogs/expenseLogs override scalar columns', () => {
  const fin = computeFinancials({
    areaAllocatedAcres: 1,
    seedTotalCostInr: 0,
    laborCostInr: 9999,   // ignored because laborLogs present
    otherCostInr: 9999,   // ignored because expenseLogs present
    laborLogs: [{ amountInr: 600 }, { amountInr: 400 }],
    expenseLogs: [{ amountInr: 250 }],
    saleTotalRevenueInr: 0,
  });
  assert.equal(n(fin.totalInputCostInr), 1250); // 1000 labour + 250 expense
});

test('incomeLogs add to sale revenue for gross income', () => {
  const fin = computeFinancials({
    areaAllocatedAcres: 1,
    saleTotalRevenueInr: 5000,
    incomeLogs: [{ amountInr: 1500 }, { amountInr: 500 }],
  });
  assert.equal(n(fin.grossIncomeInr), 7000);
  assert.equal(n(fin.netProfitInr), 7000);
});
