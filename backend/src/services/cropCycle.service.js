/**
 * Crop Cycle Service — Per-farm, per-season crop records with full input/output tracking.
 */
import prisma from "../config/db.js";
import { generateForCycle } from "./farmPrediction.service.js";
import { D, sumD } from "../utils/money.js";
import {
  appendJsonLog, readJsonLogPage, cleanText, cleanFields, cleanDate, cleanAmount,
} from "../utils/jsonLog.js";

/**
 * Only accept an http(s) media URL. `photoUrl` / `voiceUrl` were stored
 * verbatim, so a `javascript:` or `data:` value could be written into the farm
 * log and then handed to whatever renders it.
 */
function cleanUrl(value) {
  if (typeof value !== "string") return null;
  const s = value.trim().slice(0, 500);
  return /^https?:\/\//i.test(s) ? s : null;
}

// Fire-and-forget AI insight refresh — never blocks the write response.
function refreshInsights(cycleId, farmerId) {
  generateForCycle(cycleId, farmerId).catch(() => {});
}

function seasonLabel(season, year) {
  return `${season.charAt(0)}${season.slice(1).toLowerCase()} ${year}`;
}

const ACTIVITY_TYPES = [
  "LAND_PREP",
  "SOWING",
  "IRRIGATION",
  "FERTILIZER",
  "SPRAY",
  "SCOUT",
  "WEEDING",
  "PRUNING",
  "HARVEST",
  "SALE",
  "EXPENSE",
  "INCOME",
  "OTHER", // custom / user-defined activity (title carries the farmer's own label)
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
  const laborCost = arr(cycle.laborLogs).length
    ? sumAmt(cycle.laborLogs)
    : D(cycle.laborCostInr);
  const otherCost = arr(cycle.expenseLogs).length
    ? sumAmt(cycle.expenseLogs)
    : D(cycle.otherCostInr);
  const machineryCost = D(cycle.machineryCostInr);
  const totalInput = seedCost
    .plus(fertCost)
    .plus(pestCost)
    .plus(laborCost)
    .plus(machineryCost)
    .plus(otherCost);
  const gross = D(cycle.saleTotalRevenueInr).plus(sumAmt(cycle.incomeLogs));
  const net = gross.minus(totalInput);
  const area = D(cycle.areaAllocatedAcres || 1);
  return {
    totalInputCostInr: totalInput.toDecimalPlaces(2),
    grossIncomeInr: gross.toDecimalPlaces(2),
    netProfitInr: net.toDecimalPlaces(2),
    profitPerAcreInr: net.div(area).toDecimalPlaces(2),
  };
}

export async function createCropCycle(farmerId, farmId, data) {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, farmerId, isActive: true },
    select: { id: true, landSizeAcres: true },
  });
  if (!farm) return null;
  // Tagged exposable so the farmer is told WHICH constraint they hit. A plain
  // Error reaches sendServerError, which only forwards a message when
  // `expose === true` — so this arrived as "Could not create crop cycle.", and
  // someone allocating 3 acres on a 2-acre farm had no way to know that was the
  // problem. `expose`/`statusCode` is the convention used at ~64 other throw
  // sites in this codebase.
  if (data.areaAllocatedAcres > farm.landSizeAcres)
    throw Object.assign(
      new Error(`Area ${data.areaAllocatedAcres} exceeds farm size ${farm.landSizeAcres} acres`),
      { statusCode: 400, expose: true },
    );

  return prisma.farmCropCycle.create({
    data: {
      farmerId,
      farmId,
      season: data.season,
      year: parseInt(data.year),
      seasonLabel: seasonLabel(data.season, data.year),
      cropName: data.cropName,
      cropNameMr: data.cropNameMr,
      cropNameHi: data.cropNameHi,
      cropCategory: data.cropCategory || null,
      variety: data.variety || null,
      isHybrid: data.isHybrid === true,
      isOrganic: data.isOrganic === true,
      areaAllocatedAcres: parseFloat(data.areaAllocatedAcres),
      sowingDate: data.sowingDate ? new Date(data.sowingDate) : null,
      expectedHarvestDate: data.expectedHarvestDate
        ? new Date(data.expectedHarvestDate)
        : null,
      growthStage: data.growthStage || "PLANNING",
      seedName: data.seedName,
      seedBrand: data.seedBrand,
      seedSource: data.seedSource,
      seedQuantityKg: data.seedQuantityKg
        ? parseFloat(data.seedQuantityKg)
        : null,
      seedCostPerKgInr: data.seedCostPerKgInr
        ? parseFloat(data.seedCostPerKgInr)
        : null,
      seedTotalCostInr: data.seedTotalCostInr
        ? parseFloat(data.seedTotalCostInr)
        : null,
      // Pre-seeding capture (the guided "Crop Plan" flow). Columns already exist
      // in FarmCropCycle, so no migration is needed — we just persist them here.
      seedTreatment: data.seedTreatment || null,
      seedTreatmentProduct: data.seedTreatmentProduct || null,
      seedPurchaseDate: data.seedPurchaseDate
        ? new Date(data.seedPurchaseDate)
        : null,
      // Field history / rotation + prep plan are free-text (no dedicated column).
      notes: data.notes || null,
    },
  });
}

/**
 * Cycles for a farm, newest first.
 *
 * Two things this does that it did not before. It PAGINATES — a farm with ten
 * years of history returned every cycle, and each cycle carries four log arrays,
 * so the response grew without bound. And it omits those arrays from the LIST
 * shape entirely: the cards render a crop name, a season and a stage, so
 * shipping every irrigation entry ever logged was pure weight. The detail route
 * and /cycles/:id/logs/:column serve them.
 *
 * @returns {Promise<{rows: object[], total: number}>}
 */
export async function listCropCycles(farmId, farmerId, filters = {}, { page = 1, limit = 20 } = {}) {
  // Scoped to the CALLER, not just to the farm.
  //
  // This was `where = { farmId }` with the id taken straight from the URL, and
  // the route has no ownership guard of its own — requireCycleOwner only covers
  // /cycles/:cycleId, not /farms/:farmId/cycles. So any authenticated farmer
  // holding another farmer's farm id could read their whole cropping history:
  // what they grow, how much land they put to it, what they spent on seed and
  // what they sold it for. In a marketplace where those same farmers may be
  // bidding against each other, that is commercially sensitive, not just private.
  const where = { farmId, farmerId };
  if (filters.season) where.season = filters.season;
  if (filters.year) where.year = parseInt(filters.year);
  if (filters.status) where.status = filters.status;

  const [rows, total] = await Promise.all([
    prisma.farmCropCycle.findMany({
      where,
      // `id` tiebreaker — cycles created in the same import share a createdAt
      // and would otherwise reorder between pages.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, farmId: true, season: true, year: true, seasonLabel: true,
        cropName: true, cropNameMr: true, cropNameHi: true, cropCategory: true,
        variety: true, isHybrid: true, isOrganic: true, areaAllocatedAcres: true,
        sowingDate: true, expectedHarvestDate: true, actualHarvestDate: true,
        growthStage: true, currentStageUpdatedAt: true, status: true,
        harvestYieldKg: true, saleTotalRevenueInr: true,
        createdAt: true, updatedAt: true,
      },
    }),
    prisma.farmCropCycle.count({ where }),
  ]);
  return { rows, total };
}

export async function getCropCycleDetail(cycleId) {
  return prisma.farmCropCycle.findUnique({
    where: { id: cycleId },
    include: {
      farm: {
        select: {
          farmName: true,
          farmAlias: true,
          landSizeAcres: true,
          district: true,
        },
      },
      predictions: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

/**
 * Fields a farmer may set on their own crop cycle.
 *
 * An ALLOWLIST, because `data` used to be the request body handed straight to
 * prisma.update. The `where` is correctly scoped to the caller, so this was
 * never a way to touch someone else's row — but it was a way to write any column
 * on your own, and three of those matter:
 *
 *   farmId    re-parents the cycle onto ANOTHER farmer's farm, where it then
 *             shows up in their cycle list and their financial summary.
 *   farmerId  hands the cycle to someone else outright.
 *   grossIncomeInr / netProfitInr / profitPerAcreInr / totalInputCostInr
 *             are DERIVED by computeFinancials() from the logged costs and
 *             sales. Letting the client post them directly means the numbers a
 *             farmer sees, and any aggregate built on them, stop being
 *             reconcilable with the entries underneath.
 *
 * Growth stage, harvest and sale have their own endpoints that derive values and
 * timestamp transitions, so they are deliberately not here either.
 */
const CYCLE_UPDATABLE = new Set([
  // identity of the crop, as the farmer described it
  'cropName', 'cropNameMr', 'cropNameHi', 'cropCategory', 'variety',
  'isHybrid', 'isOrganic', 'season', 'year', 'seasonLabel',
  // planting
  'areaAllocatedAcres', 'sowingDate', 'expectedHarvestDate', 'actualHarvestDate',
  // seed
  'seedName', 'seedBrand', 'seedSource', 'seedQuantityKg', 'seedCostPerKgInr',
  'seedTotalCostInr', 'seedTreatment', 'seedTreatmentProduct', 'seedPurchaseDate',
  'seedReceiptUrl',
  // costs the farmer enters by hand
  'laborCostInr', 'machineryCostInr', 'otherCostInr',
  // free-form
  'notes', 'photos', 'status',
]);

export async function updateCropCycle(cycleId, farmerId, rawData) {
  const data = {};
  for (const [k, v] of Object.entries(rawData || {})) {
    if (CYCLE_UPDATABLE.has(k)) data[k] = v;
  }

  for (const f of [
    "areaAllocatedAcres",
    "seedQuantityKg",
    "seedCostPerKgInr",
    "seedTotalCostInr",
    "laborCostInr",
    "machineryCostInr",
    "otherCostInr",
  ]) {
    if (data[f] !== undefined)
      data[f] = data[f] !== null ? parseFloat(data[f]) : null;
  }
  for (const f of ["sowingDate", "expectedHarvestDate", "actualHarvestDate"]) {
    if (data[f] !== undefined) data[f] = data[f] ? new Date(data[f]) : null;
  }
  return prisma.farmCropCycle.update({
    where: { id: cycleId, farmerId },
    data,
  });
}

export async function deleteCropCycle(cycleId, farmerId) {
  // deleteMany scopes by farmerId so a user can only delete their own cycle.
  // FarmerPrediction.cropCycle is onDelete: SetNull, so there's no FK conflict.
  const result = await prisma.farmCropCycle.deleteMany({
    where: { id: cycleId, farmerId },
  });
  return result.count > 0;
}

export async function advanceGrowthStage(cycleId, farmerId, stage) {
  return prisma.farmCropCycle.update({
    where: { id: cycleId, farmerId },
    data: { growthStage: stage, currentStageUpdatedAt: new Date() },
  });
}

export async function addFertilizer(cycleId, farmerId, entry) {
  const newEntry = {
    id: crypto.randomUUID(),
    applicationDate: entry.applicationDate || new Date().toISOString(),
    productName: entry.productName,
    productType: entry.productType || "chemical",
    quantityKg: entry.quantityKg ? parseFloat(entry.quantityKg) : null,
    costInr: entry.costInr ? parseFloat(entry.costInr) : null,
    applicationStage: entry.applicationStage,
    applicationMethod: entry.applicationMethod || "broadcast",
    notes: entry.notes,
  };
  const r = await appendJsonLog(cycleId, farmerId, "fertilizersUsed", newEntry);
  if (!r.ok) return r.reason === "full" ? { error: "full" } : null;
  return cycleAfterAppend(cycleId, farmerId);
}

export async function addPesticide(cycleId, farmerId, entry) {
  const newEntry = {
    id: crypto.randomUUID(),
    applicationDate: entry.applicationDate || new Date().toISOString(),
    productName: entry.productName,
    productType: entry.productType || "insecticide",
    activeIngredient: entry.activeIngredient,
    targetPestOrDisease: entry.targetPestOrDisease,
    quantityMl: entry.quantityMl ? parseFloat(entry.quantityMl) : null,
    costInr: entry.costInr ? parseFloat(entry.costInr) : null,
    sprayMethod: entry.sprayMethod || "knapsack",
    notes: entry.notes,
  };
  const r = await appendJsonLog(cycleId, farmerId, "pesticidesUsed", newEntry);
  if (!r.ok) return r.reason === "full" ? { error: "full" } : null;
  return cycleAfterAppend(cycleId, farmerId);
}

export async function addIrrigationLog(cycleId, farmerId, entry) {
  const newEntry = {
    date: entry.date || new Date().toISOString(),
    method: entry.method || "flood",
    durationHours: entry.durationHours ? parseFloat(entry.durationHours) : null,
    source: entry.source,
    weatherTemp: entry.weatherTemp,
    weatherRainfall: entry.weatherRainfall,
  };
  const r = await appendJsonLog(cycleId, farmerId, "irrigationLogs", newEntry);
  if (!r.ok) return r.reason === "full" ? { error: "full" } : null;
  return cycleAfterAppend(cycleId, farmerId);
}

export async function addObservedEvent(cycleId, farmerId, entry) {
  const newEntry = {
    date: entry.date || new Date().toISOString(),
    type: entry.type,
    severity: entry.severity || "moderate",
    notes: entry.notes,
    damageEstimatePct: entry.damageEstimatePct
      ? parseFloat(entry.damageEstimatePct)
      : null,
  };
  const r = await appendJsonLog(cycleId, farmerId, "observedEvents", newEntry);
  if (!r.ok) return r.reason === "full" ? { error: "full" } : null;
  const updated = await cycleAfterAppend(cycleId, farmerId);
  if (["high", "critical"].includes((entry.severity || "").toLowerCase()))
    refreshInsights(cycleId, farmerId);
  return updated;
}

/**
 * The four log appenders below all go through appendJsonLog, which does the
 * insert as ONE atomic `jsonb ||` UPDATE.
 *
 * They used to read the array, push onto it in JS, and write the whole thing
 * back. Two entries logged at the same moment — a double tap, an offline queue
 * flushing, the phone and the tablet both syncing — both read the same array
 * and both wrote their own version, so one silently vanished. Nothing errored;
 * the farmer just found their costs short at the end of the season.
 *
 * Each returns the refreshed cycle on success, `null` when the cycle is not the
 * caller's, or `{ error: 'full' }` when the log has hit its ceiling — the route
 * maps that to a 409 so the farmer is told, rather than the entry disappearing.
 */

/** Fetch the cycle to return after a successful append. */
async function cycleAfterAppend(cycleId, farmerId) {
  return prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId } });
}

/** Generic activity log (land-prep, sowing, scout, weeding, pruning, …). */
export async function addActivity(cycleId, farmerId, entry) {
  const type = String(entry.type || "").toUpperCase();
  if (!ACTIVITY_TYPES.includes(type))
    throw new Error(`Unknown activity type: ${entry.type}`);

  const newEntry = {
    id: crypto.randomUUID(),
    type,
    date: cleanDate(entry.date),
    title: cleanText(entry.title, 200),
    notes: cleanText(entry.notes),
    photoUrl: cleanUrl(entry.photoUrl),
    voiceUrl: cleanUrl(entry.voiceUrl),
    fields: cleanFields(entry.fields),
  };

  const r = await appendJsonLog(cycleId, farmerId, "activities", newEntry);
  if (!r.ok) return r.reason === "full" ? { error: "full" } : null;
  return cycleAfterAppend(cycleId, farmerId);
}

/** Append a labour-cost log entry. */
export async function addLaborLog(cycleId, farmerId, entry) {
  const workers = entry.workers != null ? parseInt(entry.workers, 10) : null;
  const newEntry = {
    id: crypto.randomUUID(),
    date: cleanDate(entry.date),
    task: cleanText(entry.task, 200),
    workers: Number.isFinite(workers) && workers > 0 && workers <= 10000 ? workers : null,
    wageInr: cleanAmount(entry.wageInr),
    amountInr: cleanAmount(entry.amountInr),
    notes: cleanText(entry.notes),
  };

  const r = await appendJsonLog(cycleId, farmerId, "laborLogs", newEntry);
  if (!r.ok) return r.reason === "full" ? { error: "full" } : null;
  return cycleAfterAppend(cycleId, farmerId);
}

/** Append a miscellaneous expense log entry (diesel, machinery hire, etc.). */
export async function addExpenseLog(cycleId, farmerId, entry) {
  const newEntry = {
    id: crypto.randomUUID(),
    date: cleanDate(entry.date),
    category: cleanText(entry.category, 60) || "other",
    amountInr: cleanAmount(entry.amountInr),
    vendor: cleanText(entry.vendor, 150),
    notes: cleanText(entry.notes),
  };

  const r = await appendJsonLog(cycleId, farmerId, "expenseLogs", newEntry);
  if (!r.ok) return r.reason === "full" ? { error: "full" } : null;
  return cycleAfterAppend(cycleId, farmerId);
}

/** Append a non-sale income log entry (intercrop, subsidy, residue sale, …). */
export async function addIncomeLog(cycleId, farmerId, entry) {
  const newEntry = {
    id: crypto.randomUUID(),
    date: cleanDate(entry.date),
    source: cleanText(entry.source, 60) || "other",
    amountInr: cleanAmount(entry.amountInr),
    notes: cleanText(entry.notes),
  };

  const r = await appendJsonLog(cycleId, farmerId, "incomeLogs", newEntry);
  if (!r.ok) return r.reason === "full" ? { error: "full" } : null;
  return cycleAfterAppend(cycleId, farmerId);
}

/** One page of a cycle's log, newest first — see utils/jsonLog.js. */
export async function getCycleLogPage(cycleId, farmerId, column, opts) {
  return readJsonLogPage(cycleId, farmerId, column, opts);
}

export async function recordHarvest(cycleId, farmerId, data) {
  const cycle = await prisma.farmCropCycle.findFirst({
    where: { id: cycleId, farmerId },
    select: { areaAllocatedAcres: true },
  });
  if (!cycle) return null;
  const yieldKg = parseFloat(data.yieldKg);
  return prisma.farmCropCycle.update({
    where: { id: cycleId, farmerId },
    data: {
      harvestYieldKg: yieldKg,
      harvestYieldQuintal: Math.round((yieldKg / 100) * 100) / 100,
      harvestYieldPerAcreKg:
        Math.round((yieldKg / (cycle.areaAllocatedAcres || 1)) * 100) / 100,
      harvestQualityGrade: data.qualityGrade,
      harvestMoisturePct: data.moisturePct
        ? parseFloat(data.moisturePct)
        : null,
      actualHarvestDate: data.harvestDate
        ? new Date(data.harvestDate)
        : new Date(),
      growthStage: "HARVESTED",
      currentStageUpdatedAt: new Date(),
    },
  });
}

export async function recordSale(cycleId, farmerId, data) {
  const qty = parseFloat(data.soldQuantityKg),
    price = parseFloat(data.pricePerKgInr);
  const updated = await prisma.farmCropCycle.update({
    where: { id: cycleId, farmerId },
    data: {
      saleSoldQuantityKg: qty,
      salePricePerKgInr: price,
      saleTotalRevenueInr: D(qty).times(D(price)).toDecimalPlaces(2),
      saleBuyerType: data.buyerType,
      saleBuyerName: data.buyerName,
      saleDate: data.saleDate ? new Date(data.saleDate) : new Date(),
      saleMandiName: data.mandiName,
    },
  });
  refreshInsights(cycleId, farmerId);
  return updated;
}

export async function completeCycle(cycleId, farmerId) {
  const cycle = await prisma.farmCropCycle.findFirst({
    where: { id: cycleId, farmerId },
  });
  if (!cycle) return null;
  const updated = await prisma.farmCropCycle.update({
    where: { id: cycleId, farmerId },
    data: { status: "COMPLETED", ...computeFinancials(cycle) },
  });
  refreshInsights(cycleId, farmerId);
  return updated;
}

export async function getCycleFinancials(cycleId) {
  const cycle = await prisma.farmCropCycle.findUnique({
    where: { id: cycleId },
  });
  if (!cycle) return null;
  const fin = computeFinancials(cycle);
  const ferts = arr(cycle.fertilizersUsed);
  const pests = arr(cycle.pesticidesUsed);
  const seedCost = D(cycle.seedTotalCostInr);
  const fertilizerCost = sumD(ferts, (f) => f.costInr);
  const pesticideCost = sumD(pests, (p) => p.costInr);
  const laborCost = arr(cycle.laborLogs).length
    ? sumAmt(cycle.laborLogs)
    : D(cycle.laborCostInr);
  const machineryCost = D(cycle.machineryCostInr);
  const otherCost = arr(cycle.expenseLogs).length
    ? sumAmt(cycle.expenseLogs)
    : D(cycle.otherCostInr);
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
    roiPct: totalInput.gt(0)
      ? D(fin.netProfitInr).div(totalInput).times(100).toDecimalPlaces(2)
      : null,
    // Breakdown for the donut chart (matches cosmic chart colours; >0 only)
    costBreakdown: [
      { label: "Seed", value: seedCost, color: "#65A30D" },
      { label: "Fertilizer", value: fertilizerCost, color: "#00897B" },
      { label: "Pesticide", value: pesticideCost, color: "#7B1FA2" },
      { label: "Labour", value: laborCost, color: "#0288D1" },
      { label: "Machinery", value: machineryCost, color: "#6D4C41" },
      { label: "Other", value: otherCost, color: "#78716C" },
    ].filter((c) => c.value.gt(0)),
  };
}
