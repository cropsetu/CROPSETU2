/**
 * Chat Context Service — Builds farm-aware context for FarmMind AI chat.
 *
 * Performance: all DB queries run in parallel via Promise.all where possible.
 * Worst case: 2 sequential rounds (farmer lookup → parallel farm+cycles).
 */
import prisma from '../config/db.js';

const EMPTY_CTX = (farmer) => ({
  farmer: { name: farmer.name, language: farmer.language, district: farmer.district, state: farmer.state },
  farm: null, soil: null, weather: null, activeCycles: [], recentCycles: [],
});

export async function buildFarmerChatContext(farmerId) {
  const farmer = await prisma.user.findUnique({
    where: { id: farmerId },
    select: { id: true, name: true, language: true, district: true, state: true, farmingExperienceYrs: true, activeFarmId: true, totalFarms: true, totalLandAcres: true },
  });
  if (!farmer) return null;

  let farmId = farmer.activeFarmId;
  if (!farmId) {
    const first = await prisma.farm.findFirst({ where: { farmerId, isActive: true }, select: { id: true } });
    farmId = first?.id;
  }
  if (!farmId) return EMPTY_CTX(farmer);

  // Run farm detail + both cycle queries in parallel (3 queries, 1 round-trip)
  const [farm, activeCycles, recentCycles] = await Promise.all([
    prisma.farm.findUnique({
      where: { id: farmId },
      select: {
        id: true, farmName: true, farmAlias: true, village: true, taluka: true,
        district: true, state: true, landSizeAcres: true, landSizeHectares: true,
        soilType: true, irrigationSystem: true, waterSources: true,
        soilReports: {
          where: { isLatest: true }, take: 1,
          select: { ph: true, phRating: true, nitrogen: true, nitrogenRating: true, phosphorus: true, phosphorusRating: true, potassium: true, potassiumRating: true, organicCarbon: true, organicCarbonRating: true, testDate: true },
        },
      },
    }),
    prisma.farmCropCycle.findMany({
      where: { farmId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' },
      select: { cropName: true, variety: true, areaAllocatedAcres: true, sowingDate: true, growthStage: true },
    }),
    prisma.farmCropCycle.findMany({
      where: { farmId, status: 'COMPLETED' }, orderBy: { updatedAt: 'desc' }, take: 2,
      select: { cropName: true, seasonLabel: true, harvestYieldQuintal: true, netProfitInr: true },
    }),
  ]);

  const soil = farm?.soilReports?.[0] || null;

  return {
    farmer: { name: farmer.name, language: farmer.language, experience: farmer.farmingExperienceYrs, district: farmer.district, state: farmer.state },
    farm: farm ? { id: farm.id, name: farm.farmName || farm.farmAlias, village: farm.village, taluka: farm.taluka, district: farm.district, state: farm.state, landSizeAcres: farm.landSizeAcres, soilType: farm.soilType, irrigationSystem: farm.irrigationSystem, waterSources: farm.waterSources } : null,
    soil: soil ? { ph: soil.ph, phRating: soil.phRating, nitrogenRating: soil.nitrogenRating, phosphorusRating: soil.phosphorusRating, potassiumRating: soil.potassiumRating, organicCarbonRating: soil.organicCarbonRating } : null,
    weather: null,
    activeCycles: activeCycles.map(c => ({ cropName: c.cropName, variety: c.variety, areaAcres: c.areaAllocatedAcres, growthStage: c.growthStage })),
    recentCycles: recentCycles.map(c => ({ label: c.seasonLabel, cropName: c.cropName, yieldQuintal: c.harvestYieldQuintal, netProfitInr: c.netProfitInr })),
  };
}
