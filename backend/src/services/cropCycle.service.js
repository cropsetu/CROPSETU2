/**
 * Crop Cycle Service — Per-farm, per-season crop records with full input/output tracking.
 */
import prisma from '../config/db.js';

function seasonLabel(season, year) { return `${season.charAt(0)}${season.slice(1).toLowerCase()} ${year}`; }

function computeFinancials(cycle) {
  const seedCost = cycle.seedTotalCostInr || 0;
  const fertCost = (Array.isArray(cycle.fertilizersUsed) ? cycle.fertilizersUsed : []).reduce((s, f) => s + (f.costInr || 0), 0);
  const pestCost = (Array.isArray(cycle.pesticidesUsed) ? cycle.pesticidesUsed : []).reduce((s, p) => s + (p.costInr || 0), 0);
  const totalInput = seedCost + fertCost + pestCost + (cycle.laborCostInr || 0) + (cycle.machineryCostInr || 0) + (cycle.otherCostInr || 0);
  const gross = cycle.saleTotalRevenueInr || 0;
  const net = gross - totalInput;
  const area = cycle.areaAllocatedAcres || 1;
  return { totalInputCostInr: totalInput, grossIncomeInr: gross, netProfitInr: net, profitPerAcreInr: Math.round((net / area) * 100) / 100 };
}

export async function createCropCycle(farmerId, farmId, data) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, farmerId, isActive: true }, select: { id: true, landSizeAcres: true } });
  if (!farm) return null;
  if (data.areaAllocatedAcres > farm.landSizeAcres) throw new Error(`Area ${data.areaAllocatedAcres} exceeds farm size ${farm.landSizeAcres} acres`);

  return prisma.farmCropCycle.create({
    data: {
      farmerId, farmId,
      season: data.season, year: parseInt(data.year), seasonLabel: seasonLabel(data.season, data.year),
      cropName: data.cropName, cropNameMr: data.cropNameMr, cropNameHi: data.cropNameHi,
      cropCategory: data.cropCategory || null, variety: data.variety || null,
      isHybrid: data.isHybrid === true, isOrganic: data.isOrganic === true,
      areaAllocatedAcres: parseFloat(data.areaAllocatedAcres),
      sowingDate: data.sowingDate ? new Date(data.sowingDate) : null,
      expectedHarvestDate: data.expectedHarvestDate ? new Date(data.expectedHarvestDate) : null,
      growthStage: data.growthStage || 'PLANNING',
      seedName: data.seedName, seedBrand: data.seedBrand, seedSource: data.seedSource,
      seedQuantityKg: data.seedQuantityKg ? parseFloat(data.seedQuantityKg) : null,
      seedCostPerKgInr: data.seedCostPerKgInr ? parseFloat(data.seedCostPerKgInr) : null,
      seedTotalCostInr: data.seedTotalCostInr ? parseFloat(data.seedTotalCostInr) : null,
    },
  });
}

export async function listCropCycles(farmId, filters = {}) {
  const where = { farmId };
  if (filters.season) where.season = filters.season;
  if (filters.year) where.year = parseInt(filters.year);
  if (filters.status) where.status = filters.status;
  return prisma.farmCropCycle.findMany({ where, orderBy: { createdAt: 'desc' } });
}

export async function getCropCycleDetail(cycleId) {
  return prisma.farmCropCycle.findUnique({
    where: { id: cycleId },
    include: { farm: { select: { farmName: true, farmAlias: true, landSizeAcres: true, district: true } }, predictions: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
}

export async function updateCropCycle(cycleId, farmerId, data) {
  for (const f of ['areaAllocatedAcres', 'seedQuantityKg', 'seedCostPerKgInr', 'seedTotalCostInr', 'laborCostInr', 'machineryCostInr', 'otherCostInr']) {
    if (data[f] !== undefined) data[f] = data[f] !== null ? parseFloat(data[f]) : null;
  }
  for (const f of ['sowingDate', 'expectedHarvestDate', 'actualHarvestDate']) {
    if (data[f] !== undefined) data[f] = data[f] ? new Date(data[f]) : null;
  }
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data });
}

export async function deleteCropCycle(cycleId, farmerId) {
  // deleteMany scopes by farmerId so a user can only delete their own cycle.
  // FarmerPrediction.cropCycle is onDelete: SetNull, so there's no FK conflict.
  const result = await prisma.farmCropCycle.deleteMany({ where: { id: cycleId, farmerId } });
  return result.count > 0;
}

export async function advanceGrowthStage(cycleId, farmerId, stage) {
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { growthStage: stage, currentStageUpdatedAt: new Date() } });
}

export async function addFertilizer(cycleId, farmerId, entry) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { fertilizersUsed: true } });
  if (!cycle) return null;
  const existing = Array.isArray(cycle.fertilizersUsed) ? cycle.fertilizersUsed : [];
  const newEntry = { id: crypto.randomUUID(), applicationDate: entry.applicationDate || new Date().toISOString(), productName: entry.productName, productType: entry.productType || 'chemical', quantityKg: entry.quantityKg ? parseFloat(entry.quantityKg) : null, costInr: entry.costInr ? parseFloat(entry.costInr) : null, applicationStage: entry.applicationStage, applicationMethod: entry.applicationMethod || 'broadcast', notes: entry.notes };
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { fertilizersUsed: [...existing, newEntry] } });
}

export async function addPesticide(cycleId, farmerId, entry) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { pesticidesUsed: true } });
  if (!cycle) return null;
  const existing = Array.isArray(cycle.pesticidesUsed) ? cycle.pesticidesUsed : [];
  const newEntry = { id: crypto.randomUUID(), applicationDate: entry.applicationDate || new Date().toISOString(), productName: entry.productName, productType: entry.productType || 'insecticide', activeIngredient: entry.activeIngredient, targetPestOrDisease: entry.targetPestOrDisease, quantityMl: entry.quantityMl ? parseFloat(entry.quantityMl) : null, costInr: entry.costInr ? parseFloat(entry.costInr) : null, sprayMethod: entry.sprayMethod || 'knapsack', notes: entry.notes };
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { pesticidesUsed: [...existing, newEntry] } });
}

export async function addIrrigationLog(cycleId, farmerId, entry) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { irrigationLogs: true } });
  if (!cycle) return null;
  const existing = Array.isArray(cycle.irrigationLogs) ? cycle.irrigationLogs : [];
  const newEntry = { date: entry.date || new Date().toISOString(), method: entry.method || 'flood', durationHours: entry.durationHours ? parseFloat(entry.durationHours) : null, source: entry.source, weatherTemp: entry.weatherTemp, weatherRainfall: entry.weatherRainfall };
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { irrigationLogs: [...existing, newEntry] } });
}

export async function addObservedEvent(cycleId, farmerId, entry) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { observedEvents: true } });
  if (!cycle) return null;
  const existing = Array.isArray(cycle.observedEvents) ? cycle.observedEvents : [];
  const newEntry = { date: entry.date || new Date().toISOString(), type: entry.type, severity: entry.severity || 'moderate', notes: entry.notes, damageEstimatePct: entry.damageEstimatePct ? parseFloat(entry.damageEstimatePct) : null };
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { observedEvents: [...existing, newEntry] } });
}

export async function recordHarvest(cycleId, farmerId, data) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { areaAllocatedAcres: true } });
  if (!cycle) return null;
  const yieldKg = parseFloat(data.yieldKg);
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: {
    harvestYieldKg: yieldKg, harvestYieldQuintal: Math.round((yieldKg / 100) * 100) / 100,
    harvestYieldPerAcreKg: Math.round((yieldKg / (cycle.areaAllocatedAcres || 1)) * 100) / 100,
    harvestQualityGrade: data.qualityGrade, harvestMoisturePct: data.moisturePct ? parseFloat(data.moisturePct) : null,
    actualHarvestDate: data.harvestDate ? new Date(data.harvestDate) : new Date(), growthStage: 'HARVESTED', currentStageUpdatedAt: new Date(),
  }});
}

export async function recordSale(cycleId, farmerId, data) {
  const qty = parseFloat(data.soldQuantityKg), price = parseFloat(data.pricePerKgInr);
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: {
    saleSoldQuantityKg: qty, salePricePerKgInr: price, saleTotalRevenueInr: Math.round(qty * price * 100) / 100,
    saleBuyerType: data.buyerType, saleBuyerName: data.buyerName, saleDate: data.saleDate ? new Date(data.saleDate) : new Date(), saleMandiName: data.mandiName,
  }});
}

export async function completeCycle(cycleId, farmerId) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId } });
  if (!cycle) return null;
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { status: 'COMPLETED', ...computeFinancials(cycle) } });
}

export async function getCycleFinancials(cycleId) {
  const cycle = await prisma.farmCropCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return null;
  const fin = computeFinancials(cycle);
  const ferts = Array.isArray(cycle.fertilizersUsed) ? cycle.fertilizersUsed : [];
  const pests = Array.isArray(cycle.pesticidesUsed) ? cycle.pesticidesUsed : [];
  return {
    ...fin,
    seedCost: cycle.seedTotalCostInr || 0,
    fertilizerCost: ferts.reduce((s, f) => s + (f.costInr || 0), 0),
    pesticideCost: pests.reduce((s, p) => s + (p.costInr || 0), 0),
    laborCost: cycle.laborCostInr || 0,
    machineryCost: cycle.machineryCostInr || 0,
    otherCost: cycle.otherCostInr || 0,
    revenue: cycle.saleTotalRevenueInr || 0,
    // Breakdown for pie chart
    costBreakdown: [
      { label: 'Seed', value: cycle.seedTotalCostInr || 0, color: '#4CAF50' },
      { label: 'Fertilizer', value: ferts.reduce((s, f) => s + (f.costInr || 0), 0), color: '#2196F3' },
      { label: 'Pesticide', value: pests.reduce((s, p) => s + (p.costInr || 0), 0), color: '#FF9800' },
      { label: 'Labour', value: cycle.laborCostInr || 0, color: '#9C27B0' },
      { label: 'Machinery', value: cycle.machineryCostInr || 0, color: '#795548' },
      { label: 'Other', value: cycle.otherCostInr || 0, color: '#607D8B' },
    ].filter(c => c.value > 0),
  };
}
