/**
 * Chat Context Service — Builds farm-aware context for FarmMind AI chat.
 *
 * Performance: all DB queries run in parallel via Promise.all where possible.
 * Worst case: 2 sequential rounds (farmer lookup → parallel farm+cycles).
 */
import prisma from "../config/db.js";
import {
  summarizeFertilizers,
  summarizePesticides,
  summarizeIrrigation,
  summarizeEvents,
  summarizeCostSplit,
  buildHistory,
} from "../utils/farmHistory.server.js";

const EMPTY_CTX = (farmer) => ({
  farmer: {
    name: farmer.name,
    language: farmer.language,
    district: farmer.district,
    state: farmer.state,
  },
  farm: null,
  soil: null,
  weather: null,
  activeCycles: [],
  recentCycles: [],
});

export async function buildFarmerChatContext(farmerId) {
  const farmer = await prisma.user.findUnique({
    where: { id: farmerId },
    select: {
      id: true,
      name: true,
      language: true,
      district: true,
      state: true,
      farmingExperienceYrs: true,
      activeFarmId: true,
      totalFarms: true,
      totalLandAcres: true,
    },
  });
  if (!farmer) return null;

  let farmId = farmer.activeFarmId;
  if (!farmId) {
    const first = await prisma.farm.findFirst({
      where: { farmerId, isActive: true },
      select: { id: true },
    });
    farmId = first?.id;
  }
  if (!farmId) return EMPTY_CTX(farmer);

  // Run farm detail + both cycle queries in parallel (3 queries, 1 round-trip)
  const [farm, activeCycles, recentCycles] = await Promise.all([
    prisma.farm.findUnique({
      where: { id: farmId },
      select: {
        id: true,
        farmName: true,
        farmAlias: true,
        village: true,
        taluka: true,
        district: true,
        state: true,
        landSizeAcres: true,
        landSizeHectares: true,
        soilType: true,
        irrigationSystem: true,
        waterSources: true,
        soilReports: {
          where: { isLatest: true },
          take: 1,
          select: {
            ph: true,
            phRating: true,
            nitrogen: true,
            nitrogenRating: true,
            phosphorus: true,
            phosphorusRating: true,
            potassium: true,
            potassiumRating: true,
            organicCarbon: true,
            organicCarbonRating: true,
            testDate: true,
          },
        },
      },
    }),
    prisma.farmCropCycle.findMany({
      where: { farmId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: {
        cropName: true,
        variety: true,
        areaAllocatedAcres: true,
        sowingDate: true,
        growthStage: true,
        season: true,
        year: true,
        seasonLabel: true,
        seedName: true,
        seedBrand: true,
        seedSource: true,
        isHybrid: true,
        isOrganic: true,
        seedTotalCostInr: true,
        fertilizersUsed: true,
        pesticidesUsed: true,
        irrigationLogs: true,
        observedEvents: true,
        totalInputCostInr: true,
        laborCostInr: true,
        machineryCostInr: true,
        otherCostInr: true,
        harvestYieldQuintal: true,
        grossIncomeInr: true,
        netProfitInr: true,
        profitPerAcreInr: true,
      },
    }),
    prisma.farmCropCycle.findMany({
      where: { farmId, status: "COMPLETED" },
      orderBy: { updatedAt: "desc" },
      take: 4,
      select: {
        cropName: true,
        variety: true,
        seasonLabel: true,
        season: true,
        year: true,
        areaAllocatedAcres: true,
        sowingDate: true,
        harvestYieldQuintal: true,
        harvestQualityGrade: true,
        totalInputCostInr: true,
        netProfitInr: true,
        profitPerAcreInr: true,
        fertilizersUsed: true,
        pesticidesUsed: true,
        observedEvents: true,
      },
    }),
  ]);

  const soil = farm?.soilReports?.[0] || null;

  return {
    farmer: {
      name: farmer.name,
      language: farmer.language,
      experience: farmer.farmingExperienceYrs,
      district: farmer.district,
      state: farmer.state,
    },
    farm: farm
      ? {
          id: farm.id,
          name: farm.farmName || farm.farmAlias,
          village: farm.village,
          taluka: farm.taluka,
          district: farm.district,
          state: farm.state,
          landSizeAcres: farm.landSizeAcres,
          soilType: farm.soilType,
          irrigationSystem: farm.irrigationSystem,
          waterSources: farm.waterSources,
        }
      : null,
    soil: soil
      ? {
          ph: soil.ph,
          phRating: soil.phRating,
          nitrogenRating: soil.nitrogenRating,
          phosphorusRating: soil.phosphorusRating,
          potassiumRating: soil.potassiumRating,
          organicCarbonRating: soil.organicCarbonRating,
        }
      : null,
    weather: null,
    activeCycles: activeCycles.map((c) => ({
      cropName: c.cropName,
      variety: c.variety,
      areaAcres: c.areaAllocatedAcres,
      growthStage: c.growthStage,
      seasonLabel:
        c.seasonLabel || [c.season, c.year].filter(Boolean).join(" "),
      // itemised history (compact strings the LLM can read directly)
      fertilizerHistory: summarizeFertilizers(c.fertilizersUsed),
      pesticideHistory: summarizePesticides(c.pesticidesUsed),
      irrigationSummary: summarizeIrrigation(c.irrigationLogs),
      eventsSummary: summarizeEvents(c.observedEvents),
      costSplit: summarizeCostSplit(c),
      totalCostInr: c.totalInputCostInr,
      netProfitInr: c.netProfitInr,
      profitPerAcreInr: c.profitPerAcreInr,
    })),
    recentCycles: recentCycles.map((c) => ({
      label: c.seasonLabel || [c.season, c.year].filter(Boolean).join(" "),
      cropName: c.cropName,
      areaAcres: c.areaAllocatedAcres,
      yieldQuintal: c.harvestYieldQuintal,
      qualityGrade: c.harvestQualityGrade,
      totalCostInr: c.totalInputCostInr,
      netProfitInr: c.netProfitInr,
      profitPerAcreInr: c.profitPerAcreInr,
    })),
    history: buildHistory(recentCycles),
  };
}
