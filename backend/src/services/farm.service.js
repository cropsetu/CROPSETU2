/**
 * Farm Service — CRUD for multi-farm management.
 */
import prisma from '../config/db.js';
import { D } from '../utils/money.js';

export function acresToHectares(a) { return a ? Math.round(a * 0.4047 * 1000) / 1000 : null; }
export function acresToGunta(a) { return a ? Math.round(a * 40 * 100) / 100 : null; }

async function nextFarmNumber(farmerId, tx = prisma) {
  const last = await tx.farm.findFirst({ where: { farmerId }, orderBy: { farmNumber: 'desc' }, select: { farmNumber: true } });
  return (last?.farmNumber || 0) + 1;
}

export async function syncFarmerStats(farmerId, tx = prisma) {
  const agg = await tx.farm.aggregate({ where: { farmerId, isActive: true }, _count: true, _sum: { landSizeAcres: true } });
  await tx.user.update({ where: { id: farmerId }, data: { totalFarms: agg._count, totalLandAcres: agg._sum.landSizeAcres || 0 } });
}

export async function createFarm(farmerId, data) {
  return prisma.$transaction(async (tx) => {
    const num = await nextFarmNumber(farmerId, tx);
    const acres = parseFloat(data.landSizeAcres);
    const farm = await tx.farm.create({
      data: {
        farmerId, farmNumber: num,
        farmAlias: data.farmAlias || `Farm ${num}`,
        farmName: data.farmName || null, farmNameMr: data.farmNameMr || null, farmNameHi: data.farmNameHi || null,
        addressLine1: data.addressLine1, village: data.village, taluka: data.taluka,
        district: data.district, state: data.state || 'Maharashtra', pincode: data.pincode,
        latitude: data.latitude ? parseFloat(data.latitude) : null,
        longitude: data.longitude ? parseFloat(data.longitude) : null,
        landSizeAcres: acres, landSizeHectares: acresToHectares(acres), landSizeGunta: acresToGunta(acres),
        landOwnership: data.landOwnership || 'OWNED',
        soilType: data.soilType || 'UNKNOWN', soilColor: data.soilColor,
        irrigationSystem: data.irrigationSystem || 'RAINFED',
        waterSources: data.waterSources || [],
        borewellDepthFt: data.borewellDepthFt ? parseFloat(data.borewellDepthFt) : null,
        hasElectricity: data.hasElectricity === true,
        electricityHrsDaily: data.electricityHrsDaily ? parseFloat(data.electricityHrsDaily) : null,
        hasGreenhouse: data.hasGreenhouse === true, hasColdStorage: data.hasColdStorage === true,
        hasFarmPond: data.hasFarmPond === true, hasSolarPump: data.hasSolarPump === true,
        ownedMachinery: data.ownedMachinery || [], nearbyMandis: data.nearbyMandis || null,
      },
    });
    await syncFarmerStats(farmerId, tx);
    const farmer = await tx.user.findUnique({ where: { id: farmerId }, select: { activeFarmId: true } });
    if (!farmer.activeFarmId) await tx.user.update({ where: { id: farmerId }, data: { activeFarmId: farm.id } });
    return farm;
  });
}

export async function listFarms(farmerId) {
  return prisma.farm.findMany({
    where: { farmerId, isActive: true },
    orderBy: { farmNumber: 'asc' },
    include: { _count: { select: { cropCycles: { where: { status: 'ACTIVE' } }, soilReports: true } } },
  });
}

export async function getFarmDetail(farmId, farmerId) {
  return prisma.farm.findFirst({
    where: { id: farmId, farmerId, isActive: true },
    include: {
      cropCycles: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } },
      soilReports: { where: { isLatest: true }, take: 1 },
      weatherHistory: true,
      _count: { select: { cropCycles: true, soilReports: true, predictions: true } },
    },
  });
}

export async function updateFarm(farmId, farmerId, data) {
  if (data.landSizeAcres !== undefined) {
    data.landSizeAcres = parseFloat(data.landSizeAcres);
    data.landSizeHectares = acresToHectares(data.landSizeAcres);
    data.landSizeGunta = acresToGunta(data.landSizeAcres);
  }
  for (const f of ['latitude', 'longitude', 'borewellDepthFt', 'electricityHrsDaily']) {
    if (data[f] !== undefined) data[f] = data[f] !== null ? parseFloat(data[f]) : null;
  }
  return prisma.$transaction(async (tx) => {
    const farm = await tx.farm.update({ where: { id: farmId, farmerId }, data });
    if (data.landSizeAcres !== undefined) await syncFarmerStats(farmerId, tx);
    return farm;
  });
}

export async function deleteFarm(farmId, farmerId) {
  return prisma.$transaction(async (tx) => {
    await tx.farm.update({ where: { id: farmId, farmerId }, data: { isActive: false } });
    const farmer = await tx.user.findUnique({ where: { id: farmerId }, select: { activeFarmId: true } });
    if (farmer.activeFarmId === farmId) {
      const next = await tx.farm.findFirst({ where: { farmerId, isActive: true, id: { not: farmId } }, select: { id: true } });
      await tx.user.update({ where: { id: farmerId }, data: { activeFarmId: next?.id || null } });
    }
    await syncFarmerStats(farmerId, tx);
  });
}

export async function setActiveFarm(farmerId, farmId) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, farmerId, isActive: true }, select: { id: true } });
  if (!farm) return null;
  await prisma.user.update({ where: { id: farmerId }, data: { activeFarmId: farmId } });
  return farm;
}

export async function getFarmInsights(farmerId, farmId, { limit = 5, type } = {}) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, farmerId, isActive: true }, select: { id: true } });
  if (!farm) return null;
  return prisma.farmerPrediction.findMany({
    where: {
      farmId,
      isStale: false,
      ...(type ? { predictionType: type } : {}),
      OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20),
    select: {
      id: true, predictionType: true, output: true,
      explanationEn: true, explanationMr: true, explanationHi: true,
      actionItems: true, confidence: true, createdAt: true, cropCycleId: true,
    },
  });
}

export async function getFarmFinancialSummary(farmerId, farmId, { season, year } = {}) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, farmerId, isActive: true }, select: { id: true } });
  if (!farm) return null;

  const currentYear = new Date().getFullYear();
  const yr = parseInt(year, 10) || currentYear;
  const where = { farmId };
  if (season && ['KHARIF', 'RABI', 'ZAID', 'PERENNIAL'].includes(season)) where.season = season;
  if (!season || season !== 'YTD') where.year = yr;

  const cycles = await prisma.farmCropCycle.findMany({
    where,
    select: {
      id: true, cropName: true, season: true, year: true, status: true,
      areaAllocatedAcres: true,
      totalInputCostInr: true, laborCostInr: true, machineryCostInr: true, otherCostInr: true,
      grossIncomeInr: true, netProfitInr: true, profitPerAcreInr: true,
    },
    orderBy: { sowingDate: 'desc' },
  });

  // Sum money columns (Decimal) exactly — plain += would string-concatenate.
  const totals = cycles.reduce((acc, c) => {
    const cost = D(c.totalInputCostInr).plus(c.laborCostInr).plus(c.machineryCostInr).plus(c.otherCostInr);
    acc.grossIncome = acc.grossIncome.plus(D(c.grossIncomeInr));
    acc.totalCost = acc.totalCost.plus(cost);
    acc.netProfit = acc.netProfit.plus(D(c.netProfitInr));
    acc.areaSum += c.areaAllocatedAcres || 0;
    return acc;
  }, { grossIncome: D(0), totalCost: D(0), netProfit: D(0), areaSum: 0 });

  const profitPerAcre = totals.areaSum > 0 ? totals.netProfit.div(totals.areaSum).toDecimalPlaces(2) : 0;

  return {
    season: season || 'YTD',
    year: yr,
    totals: {
      grossIncomeInr: totals.grossIncome.toDecimalPlaces(2),
      totalCostInr: totals.totalCost.toDecimalPlaces(2),
      netProfitInr: totals.netProfit.toDecimalPlaces(2),
      profitPerAcreInr: profitPerAcre,
      totalAreaAcres: Math.round(totals.areaSum * 100) / 100,
      cycleCount: cycles.length,
    },
    byCycle: cycles.map((c) => ({
      cycleId: c.id,
      cropName: c.cropName,
      season: c.season,
      year: c.year,
      status: c.status,
      areaAcres: c.areaAllocatedAcres,
      grossIncomeInr: c.grossIncomeInr || 0,
      totalCostInr: (c.totalInputCostInr || 0) + (c.laborCostInr || 0) + (c.machineryCostInr || 0) + (c.otherCostInr || 0),
      netProfitInr: c.netProfitInr || 0,
      profitPerAcreInr: c.profitPerAcreInr || 0,
    })),
  };
}
