/**
 * Crop-cycle scoping and mass assignment (claude.md §71 sweep, MyFarm).
 *
 * Two defects with the same root: an id or a field taken from the client and
 * trusted. `requireCycleOwner` guards /cycles/:cycleId — it does NOT guard
 * /farms/:farmId/cycles, and it says nothing about which COLUMNS a farmer may
 * write on a cycle that genuinely is theirs.
 */
import { jest } from '@jest/globals';

const findMany = jest.fn().mockResolvedValue([]);
const count = jest.fn().mockResolvedValue(0);
const update = jest.fn().mockResolvedValue({});
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { farmCropCycle: { findMany, count, update } },
}));
jest.unstable_mockModule('../../../src/services/farmPrediction.service.js', () => ({
  generateForCycle: jest.fn().mockResolvedValue(null),
}));

const { listCropCycles, updateCropCycle } =
  await import('../../../src/services/cropCycle.service.js');

beforeEach(() => {
  findMany.mockClear(); count.mockClear(); update.mockClear();
});

describe('listing a farm\'s cycles is scoped to the caller', () => {
  it('filters by farmerId as well as farmId', async () => {
    // Without this a farmer holding another farmer's farm id could read their
    // whole cropping history — what they grow, on how much land, what they
    // spent on seed and what they sold it for. In a marketplace where those
    // farmers may be bidding against each other, that is commercial
    // information, not just private.
    await listCropCycles('farm-1', 'me', {}, { page: 1, limit: 20 });

    expect(findMany.mock.calls[0][0].where).toMatchObject({ farmId: 'farm-1', farmerId: 'me' });
    // The COUNT must be scoped identically, or pagination reports a total the
    // caller is not allowed to see.
    expect(count.mock.calls[0][0].where).toMatchObject({ farmId: 'farm-1', farmerId: 'me' });
  });

  it('keeps the caller scope even with filters applied', async () => {
    await listCropCycles('farm-1', 'me', { season: 'KHARIF', year: '2026', status: 'ACTIVE' }, {});
    expect(findMany.mock.calls[0][0].where.farmerId).toBe('me');
  });
});

describe('updating a cycle is limited to fields a farmer may set', () => {
  const dataOf = () => update.mock.calls[0][0].data;

  it('refuses to re-parent the cycle onto another farm', async () => {
    // The `where` is scoped to the caller, so this was never a way to touch
    // someone ELSE's row — it was a way to move your own row onto their farm,
    // where it then appears in their cycle list and their financial summary.
    await updateCropCycle('c1', 'me', { cropName: 'Cotton', farmId: 'someone-elses-farm' });
    expect(dataOf()).not.toHaveProperty('farmId');
    expect(dataOf().cropName).toBe('Cotton');
  });

  it('refuses to hand the cycle to another farmer', async () => {
    await updateCropCycle('c1', 'me', { notes: 'x', farmerId: 'someone-else' });
    expect(dataOf()).not.toHaveProperty('farmerId');
  });

  it('refuses DERIVED financials, which computeFinancials owns', async () => {
    // Accepting these means the numbers a farmer reads stop being reconcilable
    // with the entries underneath them.
    await updateCropCycle('c1', 'me', {
      laborCostInr: 500,
      grossIncomeInr: 999999, netProfitInr: 999999,
      profitPerAcreInr: 999999, totalInputCostInr: 0,
    });
    const d = dataOf();
    expect(d.laborCostInr).toBe(500);            // a cost the farmer really enters
    for (const derived of ['grossIncomeInr', 'netProfitInr', 'profitPerAcreInr', 'totalInputCostInr']) {
      expect(d).not.toHaveProperty(derived);
    }
  });

  it('refuses harvest and sale columns, which have their own endpoints', async () => {
    await updateCropCycle('c1', 'me', { harvestYieldKg: 1, saleTotalRevenueInr: 1 });
    expect(dataOf()).not.toHaveProperty('harvestYieldKg');
    expect(dataOf()).not.toHaveProperty('saleTotalRevenueInr');
  });

  it('still coerces the numbers and dates it does accept', async () => {
    await updateCropCycle('c1', 'me', { areaAllocatedAcres: '2.5', sowingDate: '2026-06-01' });
    expect(dataOf().areaAllocatedAcres).toBe(2.5);
    expect(dataOf().sowingDate).toBeInstanceOf(Date);
  });

  it('still scopes the write itself to the caller', async () => {
    await updateCropCycle('c1', 'me', { notes: 'x' });
    expect(update.mock.calls[0][0].where).toEqual({ id: 'c1', farmerId: 'me' });
  });
});
