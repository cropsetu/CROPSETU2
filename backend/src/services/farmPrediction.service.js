/**
 * farmPrediction.service.js — generate history-grounded FarmerPrediction rows
 * so getFarmInsights() returns real insights (replacing the client-side
 * heuristics). Rule-based and cheap; triggered opportunistically on sale /
 * cycle completion / a serious scouting find, throttled per farm.
 *
 * The rule engine (buildCyclePredictions) is a pure function — unit-tested
 * without a DB — and the DB wrapper persists its output, marking prior
 * predictions for the cycle stale so insights don't pile up.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';

const round = (n) => Math.round(Number(n) || 0);
const arr = (a) => (Array.isArray(a) ? a : []);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Deduped recurring pests/diseases across prior cycles (type + spray target). */
function recurringIssues(priors) {
  const seen = new Set();
  const out = [];
  for (const c of arr(priors)) {
    for (const e of arr(c.observedEvents)) { const s = (e?.type || '').trim(); if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); } }
    for (const p of arr(c.pesticidesUsed)) { const s = (p?.targetPestOrDisease || '').trim(); if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); } }
  }
  return out.slice(0, 5);
}

/**
 * Pure rule engine → array of prediction drafts (no DB fields).
 * @param cycle  the current FarmCropCycle
 * @param priors completed cycles of the same crop (most recent first)
 */
export function buildCyclePredictions(cycle, priors = []) {
  const out = [];
  const crop = cycle?.cropName || 'this crop';
  const area = Number(cycle?.areaAllocatedAcres) || 1;

  // 1) YIELD_FORECAST — average of prior harvest yields (quintals).
  const yields = arr(priors).map((c) => Number(c.harvestYieldQuintal)).filter((n) => n > 0);
  if (yields.length) {
    const expected = round(avg(yields));
    const confidence = Math.min(0.9, 0.5 + 0.1 * yields.length);
    out.push({
      predictionType: 'YIELD_FORECAST',
      output: { expectedQuintal: expected, basisCycles: yields.length },
      confidence,
      explanationEn: `Based on your last ${yields.length} ${crop} harvest(s), expect roughly ${expected} quintal this season.`,
      explanationHi: `आपकी पिछली ${yields.length} ${crop} फसलों के आधार पर इस मौसम में लगभग ${expected} क्विंटल की उम्मीद है।`,
      explanationMr: `तुमच्या मागील ${yields.length} ${crop} पिकांच्या आधारे या हंगामात अंदाजे ${expected} क्विंटल अपेक्षित आहे.`,
      actionItems: ['Plan storage/transport for the expected volume', 'Book buyers early if prices are favourable'],
    });
  }

  // 2) INCOME_FORECAST — average prior profit-per-acre × this cycle's area.
  const ppa = arr(priors).map((c) => Number(c.profitPerAcreInr)).filter((n) => !isNaN(n) && n !== 0);
  if (ppa.length) {
    const perAcre = round(avg(ppa));
    const projected = round(perAcre * area);
    out.push({
      predictionType: 'INCOME_FORECAST',
      output: { projectedNetProfitInr: projected, perAcreInr: perAcre, areaAcres: area },
      confidence: Math.min(0.85, 0.45 + 0.1 * ppa.length),
      explanationEn: `Your ${crop} averaged ₹${perAcre}/acre profit before — about ₹${projected} across ${area} acre(s) this cycle.`,
      explanationHi: `आपके ${crop} ने पहले औसतन ₹${perAcre}/एकड़ लाभ दिया — इस बार ${area} एकड़ में लगभग ₹${projected}।`,
      explanationMr: `तुमच्या ${crop} ने आधी सरासरी ₹${perAcre}/एकर नफा दिला — यावेळी ${area} एकरात अंदाजे ₹${projected}.`,
      actionItems: ['Track input costs to protect this margin', 'Compare mandi rates before selling'],
    });
  }

  // 3) PEST_RISK — recurring issues on this farm for this crop.
  const issues = recurringIssues(priors);
  if (issues.length) {
    out.push({
      predictionType: 'PEST_RISK',
      output: { recurringIssues: issues },
      confidence: Math.min(0.8, 0.4 + 0.1 * issues.length),
      explanationEn: `Watch for ${issues.join(', ')} — it has affected your ${crop} before. Scout weekly and act early.`,
      explanationHi: `${issues.join(', ')} से सावधान रहें — यह पहले आपके ${crop} को प्रभावित कर चुका है। साप्ताहिक निगरानी करें।`,
      explanationMr: `${issues.join(', ')} कडे लक्ष द्या — याने आधी तुमच्या ${crop} वर परिणाम केला आहे. दर आठवड्याला निरीक्षण करा.`,
      actionItems: ['Scout the field weekly', 'Keep recommended protection ready before peak risk'],
    });
  }

  return out;
}

/**
 * Generate + persist predictions for a cycle. Safe to call fire-and-forget;
 * never throws to the caller. Throttled to once / 6h per farm.
 */
export async function generateForCycle(cycleId, farmerId, { force = false } = {}) {
  try {
    const cycle = await prisma.farmCropCycle.findFirst({ where: { id: cycleId, farmerId } });
    if (!cycle) return [];

    if (!force) {
      const farm = await prisma.farm.findUnique({ where: { id: cycle.farmId }, select: { lastPredictionAt: true } });
      const last = farm?.lastPredictionAt ? new Date(farm.lastPredictionAt).getTime() : 0;
      if (Date.now() - last < 6 * 60 * 60 * 1000) return [];   // throttle
    }

    const priors = await prisma.farmCropCycle.findMany({
      where: { farmerId, cropName: cycle.cropName, status: 'COMPLETED', NOT: { id: cycleId } },
      orderBy: { updatedAt: 'desc' }, take: 5,
      select: { harvestYieldQuintal: true, profitPerAcreInr: true, observedEvents: true, pesticidesUsed: true },
    });

    const drafts = buildCyclePredictions(cycle, priors);
    if (!drafts.length) return [];

    const validUntil = cycle.expectedHarvestDate || new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      // retire previous insights for this cycle so the feed stays fresh
      prisma.farmerPrediction.updateMany({
        where: { cropCycleId: cycleId, isStale: false },
        data: { isStale: true },
      }),
      prisma.farmerPrediction.createMany({
        data: drafts.map((d) => ({
          farmerId, farmId: cycle.farmId, cropCycleId: cycleId,
          predictionType: d.predictionType,
          inputSnapshot: { cropName: cycle.cropName, area: cycle.areaAllocatedAcres, priorCount: priors.length },
          output: d.output,
          explanationEn: d.explanationEn, explanationHi: d.explanationHi, explanationMr: d.explanationMr,
          actionItems: d.actionItems || [],
          confidence: d.confidence ?? null,
          modelUsed: 'rules_v1',
          validUntil,
        })),
      }),
      prisma.farm.update({ where: { id: cycle.farmId }, data: { lastPredictionAt: new Date() } }),
    ]);

    return drafts;
  } catch (err) {
    logger.warn('[FarmPrediction] generateForCycle failed: %s', err.message);
    return [];
  }
}
