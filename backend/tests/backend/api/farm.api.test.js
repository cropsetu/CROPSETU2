/**
 * End-to-end API tests for the MyFarm module.
 *
 * Walks the full multi-farm + crop-cycle lifecycle exactly as the mobile
 * MyFarm screens drive it (frontend/src/services/farmApi.js):
 *
 *   farm CRUD  ->  set active farm  ->  create crop cycle  ->
 *   log fertilizer / pesticide / irrigation  ->  record harvest  ->
 *   record sale  ->  complete cycle  ->  read financials & summary  ->  delete
 *
 * Routes under test:
 *   /api/v1/farms/*               (farm.routes.js)
 *   /api/v1/farms/:id/cycles      (farmCropCycle.routes.js)
 *   /api/v1/cycles/:id/*          (farmCropCycle.routes.js)
 *
 * Cleanup is scoped to the users created here (Farm/FarmCropCycle/... all
 * cascade from the farmer relation), so this suite does NOT wipe the dev DB.
 */
import request from 'supertest';
import { getApp, createTestUser, prisma } from '../../fixtures/setup.js';
import { randomId } from '../../fixtures/factories.js';

const API = '/api/v1';

let app;
let farmer;   // owns the farms/cycles under test
let other;    // a second farmer, used for ownership-scoping checks

// Shared state threaded across the sequential lifecycle.
let farmAId;  // 5-acre farm, holds the lifecycle crop cycle
let farmBId;  // 10-acre farm, used for active-farm switching + delete
let cycleId;  // the crop cycle that goes through the full lifecycle

beforeAll(async () => {
  app = await getApp();
  farmer = await createTestUser();
  other = await createTestUser();
});

afterAll(async () => {
  const ids = [farmer?.user.id, other?.user.id].filter(Boolean);
  if (ids.length) {
    // Order matters: detach activeFarm, then children, then farms, then users.
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { activeFarmId: null } });
    await prisma.$transaction([
      prisma.farmerPrediction.deleteMany({ where: { farmerId: { in: ids } } }),
      prisma.farmWeatherHistory.deleteMany({ where: { farmerId: { in: ids } } }),
      prisma.farmSoilReport.deleteMany({ where: { farmerId: { in: ids } } }),
      prisma.farmCropCycle.deleteMany({ where: { farmerId: { in: ids } } }),
      prisma.farm.deleteMany({ where: { farmerId: { in: ids } } }),
      prisma.user.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }
  await prisma.$disconnect();
});

// ── Farm CRUD ──────────────────────────────────────────────────────────────
describe('Farm CRUD — POST/GET/PATCH/DELETE /api/v1/farms', () => {
  test('401 — listing farms without a token', async () => {
    const res = await request(app).get(`${API}/farms`);
    expect(res.status).toBe(401);
  });

  test('201 — create first farm (auto-becomes active)', async () => {
    const res = await request(app)
      .post(`${API}/farms`)
      .set(farmer.headers)
      .send({
        farmName: 'North Plot',
        village: 'Baramati',
        district: 'Pune',
        landSizeAcres: 5,
        soilType: 'BLACK_COTTON',
        irrigationSystem: 'DRIP',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const farm = res.body.data;
    expect(farm.id).toBeTruthy();
    expect(farm.farmNumber).toBe(1);
    expect(farm.farmAlias).toBe('Farm 1');
    expect(farm.landSizeAcres).toBe(5);
    expect(farm.landSizeHectares).toBeGreaterThan(0);   // derived
    expect(farm.landOwnership).toBe('OWNED');           // default
    expect(farm.soilType).toBe('BLACK_COTTON');
    expect(farm.irrigationSystem).toBe('DRIP');
    farmAId = farm.id;

    // First farm should be auto-set as the user's active farm.
    const u = await prisma.user.findUnique({ where: { id: farmer.user.id }, select: { activeFarmId: true } });
    expect(u.activeFarmId).toBe(farmAId);
  });

  test('400 — create farm missing required landSizeAcres', async () => {
    const res = await request(app)
      .post(`${API}/farms`)
      .set(farmer.headers)
      .send({ farmName: 'No Size' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('201 — create second farm (does not steal active)', async () => {
    const res = await request(app)
      .post(`${API}/farms`)
      .set(farmer.headers)
      .send({ farmName: 'South Plot', landSizeAcres: 10, soilType: 'RED', irrigationSystem: 'FLOOD' });
    expect(res.status).toBe(201);
    expect(res.body.data.farmNumber).toBe(2);
    farmBId = res.body.data.id;

    const u = await prisma.user.findUnique({ where: { id: farmer.user.id }, select: { activeFarmId: true } });
    expect(u.activeFarmId).toBe(farmAId); // unchanged
  });

  test('200 — list farms returns both with active-cycle counts', async () => {
    const res = await request(app).get(`${API}/farms`).set(farmer.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    const ids = res.body.data.map(f => f.id);
    expect(ids).toEqual(expect.arrayContaining([farmAId, farmBId]));
    expect(res.body.data[0]._count).toHaveProperty('cropCycles');
  });

  test('200 — get a single farm with relations', async () => {
    const res = await request(app).get(`${API}/farms/${farmAId}`).set(farmer.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(farmAId);
    expect(Array.isArray(res.body.data.cropCycles)).toBe(true);
    expect(Array.isArray(res.body.data.soilReports)).toBe(true);
  });

  test("404 — cannot read another farmer's farm (ownership scoped)", async () => {
    const res = await request(app).get(`${API}/farms/${farmAId}`).set(other.headers);
    expect(res.status).toBe(404);
  });

  test('404 — get farm with valid-but-unknown UUID', async () => {
    const res = await request(app).get(`${API}/farms/${randomId()}`).set(farmer.headers);
    expect(res.status).toBe(404);
  });

  test('400 — get farm with malformed id', async () => {
    const res = await request(app).get(`${API}/farms/not-a-uuid`).set(farmer.headers);
    expect(res.status).toBe(400);
  });

  test('200 — update farm size (recomputes hectares)', async () => {
    const res = await request(app)
      .patch(`${API}/farms/${farmAId}`)
      .set(farmer.headers)
      .send({ farmName: 'North Plot (updated)', landSizeAcres: 6 });
    expect(res.status).toBe(200);
    expect(res.body.data.landSizeAcres).toBe(6);
    expect(res.body.data.farmName).toBe('North Plot (updated)');
  });
});

// ── Active farm switching ────────────────────────────────────────────────────
describe('Active farm — POST /api/v1/farms/active', () => {
  test('200 — switch active farm to farm B', async () => {
    const res = await request(app)
      .post(`${API}/farms/active`)
      .set(farmer.headers)
      .send({ farmId: farmBId });
    expect(res.status).toBe(200);
    expect(res.body.data.activeFarmId).toBe(farmBId);

    const u = await prisma.user.findUnique({ where: { id: farmer.user.id }, select: { activeFarmId: true } });
    expect(u.activeFarmId).toBe(farmBId);
  });

  test('404 — set active to a farm that does not exist', async () => {
    const res = await request(app)
      .post(`${API}/farms/active`)
      .set(farmer.headers)
      .send({ farmId: randomId() });
    expect(res.status).toBe(404);
  });

  test('400 — set active with no farmId', async () => {
    const res = await request(app).post(`${API}/farms/active`).set(farmer.headers).send({});
    expect(res.status).toBe(400);
  });
});

// ── Crop cycle creation + validation ────────────────────────────────────────
describe('Crop cycle creation — POST /api/v1/farms/:id/cycles', () => {
  test('201 — create a Kharif cotton cycle', async () => {
    const res = await request(app)
      .post(`${API}/farms/${farmAId}/cycles`)
      .set(farmer.headers)
      .send({ cropName: 'Cotton', season: 'KHARIF', year: 2025, areaAllocatedAcres: 3, variety: 'Bt-Hybrid' });
    expect(res.status).toBe(201);
    const c = res.body.data;
    expect(c.id).toBeTruthy();
    expect(c.cropName).toBe('Cotton');
    expect(c.seasonLabel).toBe('Kharif 2025');
    expect(c.growthStage).toBe('PLANNING');
    expect(c.status).toBe('ACTIVE');
    expect(c.areaAllocatedAcres).toBe(3);
    cycleId = c.id;
  });

  test('400 — allocated area cannot exceed farm size', async () => {
    const res = await request(app)
      .post(`${API}/farms/${farmAId}/cycles`)
      .set(farmer.headers)
      .send({ cropName: 'Soybean', season: 'KHARIF', year: 2025, areaAllocatedAcres: 999 });
    expect(res.status).toBe(400);
    expect(String(res.body.error.message)).toMatch(/exceeds farm size/i);
  });

  test('400 — invalid season rejected by validation', async () => {
    const res = await request(app)
      .post(`${API}/farms/${farmAId}/cycles`)
      .set(farmer.headers)
      .send({ cropName: 'Wheat', season: 'MONSOON', year: 2025, areaAllocatedAcres: 2 });
    expect(res.status).toBe(400);
  });

  test('400 — missing cropName rejected by validation', async () => {
    const res = await request(app)
      .post(`${API}/farms/${farmAId}/cycles`)
      .set(farmer.headers)
      .send({ season: 'KHARIF', year: 2025, areaAllocatedAcres: 2 });
    expect(res.status).toBe(400);
  });

  test("404 — cannot create a cycle on another farmer's farm", async () => {
    const res = await request(app)
      .post(`${API}/farms/${farmAId}/cycles`)
      .set(other.headers)
      .send({ cropName: 'Cotton', season: 'KHARIF', year: 2025, areaAllocatedAcres: 1 });
    expect(res.status).toBe(404);
  });
});

// ── Activity logging ────────────────────────────────────────────────────────
describe('Activity logging — fertilizer / pesticide / irrigation', () => {
  test('200 — log a fertilizer application', async () => {
    const res = await request(app)
      .post(`${API}/cycles/${cycleId}/fertilizer`)
      .set(farmer.headers)
      .send({ productName: 'Urea', quantityKg: 50, costInr: 1500, applicationStage: 'VEGETATIVE' });
    expect(res.status).toBe(200);
    const ferts = res.body.data.fertilizersUsed;
    expect(Array.isArray(ferts)).toBe(true);
    expect(ferts.length).toBe(1);
    expect(ferts[0].productName).toBe('Urea');
    expect(ferts[0].costInr).toBe(1500);
    expect(ferts[0].id).toBeTruthy();
  });

  test('400 — fertilizer requires productName', async () => {
    const res = await request(app)
      .post(`${API}/cycles/${cycleId}/fertilizer`)
      .set(farmer.headers)
      .send({ quantityKg: 10 });
    expect(res.status).toBe(400);
  });

  test('200 — log a pesticide spray', async () => {
    const res = await request(app)
      .post(`${API}/cycles/${cycleId}/pesticide`)
      .set(farmer.headers)
      .send({ productName: 'Imidacloprid', costInr: 800, targetPestOrDisease: 'Aphids' });
    expect(res.status).toBe(200);
    expect(res.body.data.pesticidesUsed.length).toBe(1);
    expect(res.body.data.pesticidesUsed[0].costInr).toBe(800);
  });

  test('200 — log an irrigation event', async () => {
    const res = await request(app)
      .post(`${API}/cycles/${cycleId}/irrigation`)
      .set(farmer.headers)
      .send({ method: 'drip', durationHours: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.irrigationLogs.length).toBe(1);
    expect(res.body.data.irrigationLogs[0].method).toBe('drip');
  });

  test("404 — cannot log on another farmer's cycle", async () => {
    const res = await request(app)
      .post(`${API}/cycles/${cycleId}/fertilizer`)
      .set(other.headers)
      .send({ productName: 'DAP' });
    expect(res.status).toBe(404);
  });
});

// ── Harvest -> Sale -> Complete -> Financials ───────────────────────────────
describe('Harvest, sale, completion & financials', () => {
  test('200 — record harvest (derives per-acre + quintal, moves to HARVESTED)', async () => {
    const res = await request(app)
      .post(`${API}/cycles/${cycleId}/harvest`)
      .set(farmer.headers)
      .send({ yieldKg: 1200, qualityGrade: 'A' });
    expect(res.status).toBe(200);
    const c = res.body.data;
    expect(c.harvestYieldKg).toBe(1200);
    expect(c.harvestYieldQuintal).toBe(12);
    expect(c.harvestYieldPerAcreKg).toBe(400);   // 1200 / 3 acres
    expect(c.growthStage).toBe('HARVESTED');
  });

  test('400 — harvest requires yieldKg', async () => {
    const res = await request(app)
      .post(`${API}/cycles/${cycleId}/harvest`)
      .set(farmer.headers)
      .send({ qualityGrade: 'B' });
    expect(res.status).toBe(400);
  });

  test('200 — record sale (derives total revenue)', async () => {
    const res = await request(app)
      .post(`${API}/cycles/${cycleId}/sale`)
      .set(farmer.headers)
      .send({ soldQuantityKg: 1000, pricePerKgInr: 60, buyerType: 'MANDI', mandiName: 'Pune APMC' });
    expect(res.status).toBe(200);
    expect(res.body.data.saleTotalRevenueInr).toBe(60000); // 1000 * 60
  });

  test('200 — complete cycle recomputes P&L', async () => {
    const res = await request(app).post(`${API}/cycles/${cycleId}/complete`).set(farmer.headers);
    expect(res.status).toBe(200);
    const c = res.body.data;
    expect(c.status).toBe('COMPLETED');
    expect(c.totalInputCostInr).toBe(2300);    // 1500 fertilizer + 800 pesticide
    expect(c.grossIncomeInr).toBe(60000);
    expect(c.netProfitInr).toBe(57700);         // 60000 - 2300
  });

  test('200 — cycle financials breakdown for charts', async () => {
    const res = await request(app).get(`${API}/cycles/${cycleId}/financials`).set(farmer.headers);
    expect(res.status).toBe(200);
    const f = res.body.data;
    expect(f.fertilizerCost).toBe(1500);
    expect(f.pesticideCost).toBe(800);
    expect(f.revenue).toBe(60000);
    expect(f.netProfitInr).toBe(57700);
    // costBreakdown only includes non-zero buckets.
    const labels = f.costBreakdown.map(b => b.label);
    expect(labels).toEqual(expect.arrayContaining(['Fertilizer', 'Pesticide']));
    expect(labels).not.toContain('Seed');
  });

  test('200 — farm financial summary aggregates the season', async () => {
    const res = await request(app)
      .get(`${API}/farms/${farmAId}/financial-summary?year=2025`)
      .set(farmer.headers);
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.year).toBe(2025);
    expect(s.totals.cycleCount).toBe(1);
    expect(s.totals.grossIncomeInr).toBe(60000);
    expect(s.totals.totalCostInr).toBe(2300);
    expect(s.totals.netProfitInr).toBe(57700);
    expect(s.byCycle[0].cropName).toBe('Cotton');
  });
});

// ── Reads: list, detail, insights ───────────────────────────────────────────
describe('Crop cycle reads — list / detail / insights', () => {
  test('200 — list cycles for the farm', async () => {
    const res = await request(app).get(`${API}/farms/${farmAId}/cycles`).set(farmer.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.some(c => c.id === cycleId)).toBe(true);
  });

  test('200 — list cycles filtered by status=COMPLETED', async () => {
    const res = await request(app).get(`${API}/farms/${farmAId}/cycles?status=COMPLETED`).set(farmer.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.every(c => c.status === 'COMPLETED')).toBe(true);
    expect(res.body.data.some(c => c.id === cycleId)).toBe(true);
  });

  test('200 — cycle detail includes parent farm', async () => {
    const res = await request(app).get(`${API}/cycles/${cycleId}`).set(farmer.headers);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(cycleId);
    expect(res.body.data.farm).toBeTruthy();
    expect(Array.isArray(res.body.data.predictions)).toBe(true);
  });

  test('404 — cycle detail for unknown id', async () => {
    const res = await request(app).get(`${API}/cycles/${randomId()}`).set(farmer.headers);
    expect(res.status).toBe(404);
  });

  test('200 — farm insights (empty list when none predicted)', async () => {
    const res = await request(app).get(`${API}/farms/${farmAId}/insights`).set(farmer.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── Deletion + active-farm reassignment ─────────────────────────────────────
describe('Deletion — cycles & farms', () => {
  let throwawayCycleId;

  test('201 — create a throwaway cycle to delete', async () => {
    const res = await request(app)
      .post(`${API}/farms/${farmAId}/cycles`)
      .set(farmer.headers)
      .send({ cropName: 'Onion', season: 'RABI', year: 2025, areaAllocatedAcres: 1 });
    expect(res.status).toBe(201);
    throwawayCycleId = res.body.data.id;
  });

  test("404 — another farmer cannot delete the cycle", async () => {
    const res = await request(app).delete(`${API}/cycles/${throwawayCycleId}`).set(other.headers);
    expect(res.status).toBe(404);
  });

  test('200 — owner deletes the cycle, then it is gone', async () => {
    const del = await request(app).delete(`${API}/cycles/${throwawayCycleId}`).set(farmer.headers);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const get = await request(app).get(`${API}/cycles/${throwawayCycleId}`).set(farmer.headers);
    expect(get.status).toBe(404);
  });

  test('200 — delete active farm B reassigns active to farm A', async () => {
    // farm B is currently the active farm (set earlier).
    const del = await request(app).delete(`${API}/farms/${farmBId}`).set(farmer.headers);
    expect(del.status).toBe(200);

    const u = await prisma.user.findUnique({ where: { id: farmer.user.id }, select: { activeFarmId: true } });
    expect(u.activeFarmId).toBe(farmAId); // reassigned to the surviving farm

    const list = await request(app).get(`${API}/farms`).set(farmer.headers);
    expect(list.body.data.map(f => f.id)).not.toContain(farmBId); // soft-deleted, hidden
  });
});
