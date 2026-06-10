/**
 * Crop Cycle Service — Per-farm, per-season crop records with full input/output tracking.
 */
import prisma from '../config/db.js';
import { generateForCycle } from './farmPrediction.service.js';
import { D, sumD } from '../utils/money.js';

// Fire-and-forget AI insight refresh — never blocks the write response.
function refreshInsights(cycleId, farmerId) {
  generateForCycle(cycleId, farmerId).catch(() => {});
}

function seasonLabel(season, year) { return `${season.charAt(0)}${season.slice(1).toLowerCase()} ${year}`; }

const ACTIVITY_TYPES = [
  'LAND_PREP', 'SOWING', 'IRRIGATION', 'FERTILIZER', 'SPRAY', 'SCOUT',
  'WEEDING', 'PRUNING', 'HARVEST', 'SALE', 'EXPENSE', 'INCOME',
];

const arr = (a) => (Array.isArray(a) ? a : []);
// Sum {amountInr} log entries exactly (returns a Decimal).
const sumAmt = (a) => sumD(a, (x) => x?.amountInr);

/**
 * Live financials. Labour/other costs come from the itemised laborLogs/
 * expenseLogs arrays when present, else fall back to the scalar columns (so
 * cycles created before the v2 loggers still total correctly). Gross income
 * = sale revenue + any extra incomeLogs.
 */
export function computeFinancials(cycle) {
  // All money math in Decimal — plain +/* would concatenate or drift (see money.js).
  const seedCost = D(cycle.seedTotalCostInr);
  const fertCost = sumD(cycle.fertilizersUsed, (f) => f.costInr);
  const pestCost = sumD(cycle.pesticidesUsed, (p) => p.costInr);
  const laborCost = arr(cycle.laborLogs).length ? sumAmt(cycle.laborLogs) : D(cycle.laborCostInr);
  const otherCost = arr(cycle.expenseLogs).length ? sumAmt(cycle.expenseLogs) : D(cycle.otherCostInr);
  const machineryCost = D(cycle.machineryCostInr);
  const totalInput = seedCost.plus(fertCost).plus(pestCost).plus(laborCost).plus(machineryCost).plus(otherCost);
  const gross = D(cycle.saleTotalRevenueInr).plus(sumAmt(cycle.incomeLogs));
  const net = gross.minus(totalInput);
  const area = D(cycle.areaAllocatedAcres || 1);
  return {
    totalInputCostInr: totalInput.toDecimalPlaces(2),
    grossIncomeInr:    gross.toDecimalPlaces(2),
    netProfitInr:      net.toDecimalPlaces(2),
    profitPerAcreInr:  net.div(area).toDecimalPlaces(2),
  };
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
  const updated = await prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { observedEvents: [...existing, newEntry] } });
  if (['high', 'critical'].includes((entry.severity || '').toLowerCase())) refreshInsights(cycleId, farmerId);
  return updated;
}

/** Generic activity log (land-prep, sowing, scout, weeding, pruning, …). */
export async function addActivity(cycleId, farmerId, entry) {
  const type = String(entry.type || '').toUpperCase();
  if (!ACTIVITY_TYPES.includes(type)) throw new Error(`Unknown activity type: ${entry.type}`);
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { activities: true } });
  if (!cycle) return null;
  const existing = arr(cycle.activities);
  const newEntry = {
    id: crypto.randomUUID(),
    type,
    date: entry.date || new Date().toISOString(),
    title: entry.title || null,
    notes: entry.notes || null,
    photoUrl: entry.photoUrl || null,
    voiceUrl: entry.voiceUrl || null,
    fields: entry.fields && typeof entry.fields === 'object' ? entry.fields : {},
  };
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { activities: [...existing, newEntry] } });
}

/** Append a labour-cost log entry. */
export async function addLaborLog(cycleId, farmerId, entry) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { laborLogs: true } });
  if (!cycle) return null;
  const existing = arr(cycle.laborLogs);
  const newEntry = {
    id: crypto.randomUUID(),
    date: entry.date || new Date().toISOString(),
    task: entry.task || null,
    workers: entry.workers != null ? parseInt(entry.workers, 10) : null,
    wageInr: entry.wageInr != null ? parseFloat(entry.wageInr) : null,
    amountInr: entry.amountInr != null ? parseFloat(entry.amountInr) : null,
    notes: entry.notes || null,
  };
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { laborLogs: [...existing, newEntry] } });
}

/** Append a miscellaneous expense log entry (diesel, machinery hire, etc.). */
export async function addExpenseLog(cycleId, farmerId, entry) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { expenseLogs: true } });
  if (!cycle) return null;
  const existing = arr(cycle.expenseLogs);
  const newEntry = {
    id: crypto.randomUUID(),
    date: entry.date || new Date().toISOString(),
    category: entry.category || 'other',
    amountInr: entry.amountInr != null ? parseFloat(entry.amountInr) : null,
    vendor: entry.vendor || null,
    notes: entry.notes || null,
  };
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { expenseLogs: [...existing, newEntry] } });
}

/** Append a non-sale income log entry (intercrop, subsidy, residue sale, …). */
export async function addIncomeLog(cycleId, farmerId, entry) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId }, select: { incomeLogs: true } });
  if (!cycle) return null;
  const existing = arr(cycle.incomeLogs);
  const newEntry = {
    id: crypto.randomUUID(),
    date: entry.date || new Date().toISOString(),
    source: entry.source || 'other',
    amountInr: entry.amountInr != null ? parseFloat(entry.amountInr) : null,
    notes: entry.notes || null,
  };
  return prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { incomeLogs: [...existing, newEntry] } });
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
  const updated = await prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: {
    saleSoldQuantityKg: qty, salePricePerKgInr: price, saleTotalRevenueInr: D(qty).times(D(price)).toDecimalPlaces(2),
    saleBuyerType: data.buyerType, saleBuyerName: data.buyerName, saleDate: data.saleDate ? new Date(data.saleDate) : new Date(), saleMandiName: data.mandiName,
  }});
  refreshInsights(cycleId, farmerId);
  return updated;
}

export async function completeCycle(cycleId, farmerId) {
  const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId } });
  if (!cycle) return null;
  const updated = await prisma.farmCropCycle.update({ where: { id: cycleId, farmerId }, data: { status: 'COMPLETED', ...computeFinancials(cycle) } });
  refreshInsights(cycleId, farmerId);
  return updated;
}

export async function getCycleFinancials(cycleId) {
  const cycle = await prisma.farmCropCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return null;
  const fin = computeFinancials(cycle);
  const ferts = arr(cycle.fertilizersUsed);
  const pests = arr(cycle.pesticidesUsed);
  const seedCost = D(cycle.seedTotalCostInr);
  const fertilizerCost = sumD(ferts, (f) => f.costInr);
  const pesticideCost = sumD(pests, (p) => p.costInr);
  const laborCost = arr(cycle.laborLogs).length ? sumAmt(cycle.laborLogs) : D(cycle.laborCostInr);
  const machineryCost = D(cycle.machineryCostInr);
  const otherCost = arr(cycle.expenseLogs).length ? sumAmt(cycle.expenseLogs) : D(cycle.otherCostInr);
  const area = D(cycle.areaAllocatedAcres || 1);
  const totalInput = D(fin.totalInputCostInr);

  return {
    ...fin,
    seedCost,
    fertilizerCost,
    pesticideCost,
    laborCost,
    machineryCost,
    otherCost,
    revenue: fin.grossIncomeInr,
    // Per-acre economics + return on input cost (all exact Decimal math)
    perAcre: {
      costPerAcre: totalInput.div(area).toDecimalPlaces(2),
      revenuePerAcre: D(fin.grossIncomeInr).div(area).toDecimalPlaces(2),
      profitPerAcre: fin.profitPerAcreInr,
    },
    roiPct: totalInput.gt(0) ? D(fin.netProfitInr).div(totalInput).times(100).toDecimalPlaces(2) : null,
    // Breakdown for the donut chart (matches cosmic chart colours; >0 only)
    costBreakdown: [
      { label: 'Seed', value: seedCost, color: '#65A30D' },
      { label: 'Fertilizer', value: fertilizerCost, color: '#00897B' },
      { label: 'Pesticide', value: pesticideCost, color: '#7B1FA2' },
      { label: 'Labour', value: laborCost, color: '#0288D1' },
      { label: 'Machinery', value: machineryCost, color: '#6D4C41' },
      { label: 'Other', value: otherCost, color: '#78716C' },
    ].filter(c => c.value.gt(0)),
  };
}
