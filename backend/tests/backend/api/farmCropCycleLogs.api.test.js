/**
 * MyFarm crop-cycle logs — concurrency, caps and sanitisation.
 *
 * The load-bearing test here is the concurrent-append one. The old
 * read-modify-write lost entries silently under exactly the conditions a farmer
 * creates all the time (double tap, an offline queue flushing, two devices),
 * and a lost expense is only discovered when the season's costs do not add up.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { getApp, createTestUser, cleanupTestData, prisma } from '../../fixtures/setup.js';

let app;
let farmer;
let cycle;

async function makeFarmAndCycle(farmerId) {
  const farm = await prisma.farm.create({
    data: {
      farmerId, farmNumber: 1, farmName: 'Test Farm',
      landSizeAcres: 5, district: 'Pune', state: 'Maharashtra',
    },
  });
  return prisma.farmCropCycle.create({
    data: {
      farmerId, farmId: farm.id,
      season: 'KHARIF', year: 2026, cropName: 'Soybean', areaAllocatedAcres: 2,
    },
  });
}

beforeAll(async () => { app = await getApp(); });
afterAll(async () => { await cleanupTestData(); await prisma.$disconnect(); });

beforeEach(async () => {
  await cleanupTestData();
  farmer = await createTestUser({ name: 'Farmer' });
  cycle = await makeFarmAndCycle(farmer.user.id);
});

const url = (suffix) => `/api/v1/cycles/${cycle.id}/${suffix}`;

describe('concurrent log appends', () => {
  it('keeps every entry when several land at once', async () => {
    // The exact shape that used to lose data: N appends in flight together,
    // each reading the array before any of them had written.
    const N = 12;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => request(app)
        .post(url('expense'))
        .set(farmer.headers)
        .send({ amountInr: 100 + i, category: 'diesel', notes: `entry ${i}` })),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);

    const row = await prisma.farmCropCycle.findUnique({
      where: { id: cycle.id }, select: { expenseLogs: true },
    });
    expect(row.expenseLogs).toHaveLength(N);
    // Every distinct amount survived — nothing was overwritten.
    const amounts = row.expenseLogs.map((e) => e.amountInr).sort((a, b) => a - b);
    expect(amounts).toEqual(Array.from({ length: N }, (_, i) => 100 + i));
  });

  it('keeps entries appended to different logs concurrently', async () => {
    await Promise.all([
      request(app).post(url('expense')).set(farmer.headers).send({ amountInr: 500 }),
      request(app).post(url('income')).set(farmer.headers).send({ amountInr: 900 }),
      request(app).post(url('labor')).set(farmer.headers).send({ amountInr: 300, workers: 4 }),
      request(app).post(url('activity')).set(farmer.headers).send({ type: 'WEEDING' }),
    ]);

    const row = await prisma.farmCropCycle.findUnique({ where: { id: cycle.id } });
    expect(row.expenseLogs).toHaveLength(1);
    expect(row.incomeLogs).toHaveLength(1);
    expect(row.laborLogs).toHaveLength(1);
    expect(row.activities).toHaveLength(1);
  });
});

describe('entry sanitisation', () => {
  it('strips HTML from free text instead of storing it', async () => {
    const res = await request(app).post(url('activity')).set(farmer.headers).send({
      type: 'SCOUT',
      title: '<script>alert(1)</script>Aphids',
      notes: '<img src=x onerror=alert(1)>on the lower leaves',
    });

    expect(res.status).toBe(200);
    const [entry] = res.body.data.activities;
    expect(entry.title).not.toContain('<script>');
    expect(entry.title).toContain('Aphids');
    expect(entry.notes).not.toContain('onerror');
  });

  it('rejects a non-http media URL', async () => {
    const res = await request(app).post(url('activity')).set(farmer.headers).send({
      type: 'SCOUT',
      photoUrl: 'javascript:alert(1)',
      voiceUrl: 'https://res.cloudinary.com/demo/video/upload/a.mp3',
    });

    const [entry] = res.body.data.activities;
    expect(entry.photoUrl).toBeNull();
    expect(entry.voiceUrl).toBe('https://res.cloudinary.com/demo/video/upload/a.mp3');
  });

  it('caps free text and the free-form fields bag', async () => {
    // ~32 KB — under the 100 KB global body limit, so it reaches the handler
    // and the PER-ENTRY caps are what has to stop it.
    const res = await request(app).post(url('activity')).set(farmer.headers).send({
      type: 'OTHER',
      notes: 'x'.repeat(5000),
      fields: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(800)])),
    });

    expect(res.status).toBe(200);
    const [entry] = res.body.data.activities;
    expect(entry.notes.length).toBeLessThanOrEqual(500);
    expect(Object.keys(entry.fields).length).toBeLessThanOrEqual(30);
    expect(Object.values(entry.fields)[0].length).toBeLessThanOrEqual(500);
  });

  it('rejects a payload too large to be a farm log at all', async () => {
    // The global 100 KB JSON limit is the outer guard — a megabyte of "notes"
    // never reaches the handler, so the row cannot be grown that way either.
    const res = await request(app).post(url('activity')).set(farmer.headers)
      .send({ type: 'OTHER', notes: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
  });

  it('drops an unparseable date and an out-of-range amount rather than storing them', async () => {
    const res = await request(app).post(url('expense')).set(farmer.headers).send({
      amountInr: 1, date: 'not-a-date',
    });
    const [entry] = res.body.data.expenseLogs;
    expect(Number.isNaN(new Date(entry.date).getTime())).toBe(false);

    const huge = await request(app).post(url('income')).set(farmer.headers)
      .send({ amountInr: 1e15 });
    expect(huge.body.data.incomeLogs[0].amountInr).toBeNull();
  });

  it('refuses an unknown activity type', async () => {
    const res = await request(app).post(url('activity')).set(farmer.headers)
      .send({ type: 'DEFINITELY_NOT_A_THING' });
    expect(res.status).toBe(400);
  });
});

describe('ownership', () => {
  it('will not let another farmer append to the cycle', async () => {
    const other = await createTestUser({ name: 'Other' });
    const res = await request(app).post(url('expense')).set(other.headers)
      .send({ amountInr: 100 });

    expect([403, 404]).toContain(res.status);
    const row = await prisma.farmCropCycle.findUnique({
      where: { id: cycle.id }, select: { expenseLogs: true },
    });
    expect(row.expenseLogs).toHaveLength(0);
  });

  it('requires authentication', async () => {
    expect((await request(app).post(url('expense')).send({ amountInr: 1 })).status).toBe(401);
  });
});

describe('log paging', () => {
  it('serves a page of the log newest-first without loading the whole array', async () => {
    for (let i = 0; i < 8; i++) {
      await request(app).post(url('expense')).set(farmer.headers)
        .send({ amountInr: i + 1, category: `cat${i}` });
    }

    const p1 = await request(app).get(`/api/v1/cycles/${cycle.id}/logs/expenseLogs`)
      .set(farmer.headers).query({ limit: 3 });

    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(3);
    expect(p1.body.meta.total).toBe(8);
    // Newest first: the last three appended, in reverse order.
    expect(p1.body.data.map((e) => e.category)).toEqual(['cat7', 'cat6', 'cat5']);

    const p2 = await request(app).get(`/api/v1/cycles/${cycle.id}/logs/expenseLogs`)
      .set(farmer.headers).query({ limit: 3, page: 2 });
    expect(p2.body.data.map((e) => e.category)).toEqual(['cat4', 'cat3', 'cat2']);
  });

  it('rejects a column that is not a log', async () => {
    const res = await request(app).get(`/api/v1/cycles/${cycle.id}/logs/seedCostPerKgInr`)
      .set(farmer.headers);
    expect(res.status).toBe(400);
  });
});

describe('cycle list', () => {
  it('paginates and omits the heavy log arrays from the card shape', async () => {
    const farm = await prisma.farm.findFirst({ where: { farmerId: farmer.user.id } });
    for (let i = 0; i < 4; i++) {
      await prisma.farmCropCycle.create({
        data: {
          farmerId: farmer.user.id, farmId: farm.id,
          season: 'RABI', year: 2025, cropName: `Wheat ${i}`, areaAllocatedAcres: 1,
        },
      });
    }

    const res = await request(app).get(`/api/v1/farms/${farm.id}/cycles`)
      .set(farmer.headers).query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(5); // 4 + the one from beforeEach
    // The list card does not need — and must not carry — every logged entry.
    expect(res.body.data[0].activities).toBeUndefined();
    expect(res.body.data[0].expenseLogs).toBeUndefined();
    expect(res.body.data[0].cropName).toBeTruthy();
  });

  it('does not repeat or skip a cycle across pages', async () => {
    const farm = await prisma.farm.findFirst({ where: { farmerId: farmer.user.id } });
    const at = new Date();
    for (let i = 0; i < 5; i++) {
      await prisma.farmCropCycle.create({
        data: {
          farmerId: farmer.user.id, farmId: farm.id, createdAt: at,
          season: 'ZAID', year: 2025, cropName: `Melon ${i}`, areaAllocatedAcres: 1,
        },
      });
    }

    const p1 = await request(app).get(`/api/v1/farms/${farm.id}/cycles`).set(farmer.headers).query({ limit: 3, page: 1 });
    const p2 = await request(app).get(`/api/v1/farms/${farm.id}/cycles`).set(farmer.headers).query({ limit: 3, page: 2 });
    const ids = [...p1.body.data, ...p2.body.data].map((c) => c.id);

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});
