/**
 * Soil Health Routes
 *
 * POST /api/v1/soil/manual            — manual entry of soil test parameters
 * GET  /api/v1/soil/reports           — farmer's saved soil reports
 * GET  /api/v1/soil/reports/:id       — single report detail
 * GET  /api/v1/soil/recommendation    — fertilizer recommendation for a crop + soil report
 * DELETE /api/v1/soil/reports/:id     — delete report
 *
 * Data sources:
 *   Rating thresholds: ICAR Soil Health Card norms (DAC&FW, GoI)
 *   Fertilizer recommendations: ICAR / MPKV Rahuri, Maharashtra
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';
import prisma from '../config/db.js';

const router = Router();

// ── ICAR Soil Health Card rating thresholds ───────────────────────────────────
function rateSoilParam(param, value) {
  if (value === null || value === undefined || isNaN(value)) return null;
  const v = parseFloat(value);
  switch (param) {
    case 'ph':
      if (v < 5.5)  return { rating: 'acidic',       ratingHi: 'अम्लीय',      color: '#E74C3C', advice: 'Apply lime 1-2 t/acre to raise pH' };
      if (v <= 6.5) return { rating: 'slightly_acidic', ratingHi: 'थोड़ा अम्लीय', color: '#F39C12', advice: 'Suitable for most crops. Minor lime needed.' };
      if (v <= 7.5) return { rating: 'optimal',       ratingHi: 'उपयुक्त',      color: '#2ECC71', advice: 'Optimal pH for most crops.' };
      if (v <= 8.5) return { rating: 'alkaline',      ratingHi: 'क्षारीय',      color: '#F39C12', advice: 'Apply gypsum 200-400 kg/acre + organic matter' };
      return                { rating: 'highly_alkaline', ratingHi: 'अत्यधिक क्षारीय', color: '#E74C3C', advice: 'Apply gypsum 400+ kg/acre. Consult soil expert.' };
    case 'organicCarbon':
      if (v < 0.5)  return { rating: 'low',    ratingHi: 'कम',     color: '#E74C3C', advice: 'Apply FYM 4-5 t/acre. Green manuring recommended.' };
      if (v <= 0.75)return { rating: 'medium',  ratingHi: 'मध्यम',  color: '#F39C12', advice: 'Apply FYM 2-3 t/acre annually.' };
      return                { rating: 'high',   ratingHi: 'अच्छा',  color: '#2ECC71', advice: 'Good organic matter. Maintain with FYM.' };
    case 'nitrogen': // Available N (kg/ha)
      if (v < 280)  return { rating: 'low',    ratingHi: 'कम',     color: '#E74C3C', advice: 'Increase nitrogen fertilizer by 25%' };
      if (v <= 560) return { rating: 'medium',  ratingHi: 'मध्यम',  color: '#F39C12', advice: 'Apply standard N dose per crop recommendation' };
      return                { rating: 'high',   ratingHi: 'अच्छा',  color: '#2ECC71', advice: 'Reduce N fertilizer by 25%. Avoid excess.' };
    case 'phosphorus': // Available P (kg/ha)
      if (v < 11)   return { rating: 'low',    ratingHi: 'कम',     color: '#E74C3C', advice: 'Apply extra SSP/DAP — 25% more than standard dose' };
      if (v <= 22)  return { rating: 'medium',  ratingHi: 'मध्यम',  color: '#F39C12', advice: 'Apply standard P dose' };
      return                { rating: 'high',   ratingHi: 'अच्छा',  color: '#2ECC71', advice: 'Reduce P application by 25%' };
    case 'potassium': // Available K (kg/ha)
      if (v < 110)  return { rating: 'low',    ratingHi: 'कम',     color: '#E74C3C', advice: 'Apply MOP/SOP as per crop dose + extra 20%' };
      if (v <= 280) return { rating: 'medium',  ratingHi: 'मध्यम',  color: '#F39C12', advice: 'Apply standard K dose' };
      return                { rating: 'high',   ratingHi: 'अच्छा',  color: '#2ECC71', advice: 'Reduce K application by 25%' };
    case 'ec': // dS/m
      if (v < 0.5)  return { rating: 'low',    ratingHi: 'कम',     color: '#2ECC71', advice: 'Good. No salinity issues.' };
      if (v <= 1.0) return { rating: 'medium',  ratingHi: 'मध्यम',  color: '#F39C12', advice: 'Slight salinity. Monitor. Leach with good water.' };
      return                { rating: 'high',   ratingHi: 'अधिक',   color: '#E74C3C', advice: 'High salinity. Gypsum application + leaching needed.' };
    case 'zinc': // ppm
      if (v < 0.6)  return { rating: 'low',    ratingHi: 'कम',     color: '#E74C3C', advice: 'Apply Zinc Sulphate 25 kg/acre as basal + 0.5% foliar spray' };
      return                { rating: 'sufficient', ratingHi: 'पर्याप्त', color: '#2ECC71', advice: 'Adequate zinc.' };
    case 'boron': // ppm
      if (v < 0.5)  return { rating: 'low',    ratingHi: 'कम',     color: '#E74C3C', advice: 'Apply Borax 2 kg/acre basal or 0.2% foliar spray at flowering' };
      return                { rating: 'sufficient', ratingHi: 'पर्याप्त', color: '#2ECC71', advice: 'Adequate boron.' };
    case 'sulphur': // ppm
      if (v < 10)   return { rating: 'low',    ratingHi: 'कम',     color: '#E74C3C', advice: 'Apply Gypsum 100-200 kg/acre or SSP as sulphur source' };
      return                { rating: 'sufficient', ratingHi: 'पर्याप्त', color: '#2ECC71', advice: 'Adequate sulphur.' };
    default:
      return { rating: 'recorded', ratingHi: 'दर्ज', color: '#95A5A6', advice: '' };
  }
}

// ── Fertilizer recommendation engine ─────────────────────────────────────────
async function generateFertilizerRec(soilRecord, cropName, areaAcres) {
  const { nitrogen, phosphorus, potassium, ph, organicCarbon, zinc, sulphur } = soilRecord;

  const crop = await prisma.cropMaster.findFirst({
    where: { name: { equals: cropName, mode: 'insensitive' } },
  });

  const recs = [];

  // Base fertilizer from crop master schedule
  const baseFert = crop?.fertilizerSchedule?.[0]?.fertilizers || [
    { name: 'DAP', quantityPerAcre: 50, unit: 'kg' },
    { name: 'MOP', quantityPerAcre: 25, unit: 'kg' },
    { name: 'Urea', quantityPerAcre: 30, unit: 'kg' },
  ];

  // Adjust based on soil ratings
  const nRating  = nitrogen   ? rateSoilParam('nitrogen',  nitrogen)?.rating   : 'medium';
  const pRating  = phosphorus ? rateSoilParam('phosphorus', phosphorus)?.rating : 'medium';
  const kRating  = potassium  ? rateSoilParam('potassium',  potassium)?.rating  : 'medium';

  const adjustFactor = { low: 1.25, medium: 1.0, high: 0.75 };

  for (const f of baseFert) {
    const baseQty = f.quantityPerAcre * areaAcres;
    let factor = 1.0;
    if (f.name === 'DAP')  factor = adjustFactor[pRating] || 1.0;
    if (f.name === 'MOP')  factor = adjustFactor[kRating] || 1.0;
    if (f.name === 'Urea') factor = adjustFactor[nRating] || 1.0;

    recs.push({
      name:      f.name,
      qty:       Math.round(baseQty * factor),
      unit:      f.unit || 'kg',
      soilAdjusted: factor !== 1.0,
      adjustment:   factor > 1 ? '+25% (low soil level)' : factor < 1 ? '-25% (high soil level)' : 'standard dose',
    });
  }

  // Micro-nutrient additions
  if (zinc !== null && zinc < 0.6) {
    recs.push({ name: 'Zinc Sulphate 21%', qty: Math.round(25 * areaAcres), unit: 'kg', soilAdjusted: true, adjustment: 'Added: Zinc deficiency detected' });
  }
  if (sulphur !== null && sulphur < 10) {
    recs.push({ name: 'Gypsum', qty: Math.round(150 * areaAcres), unit: 'kg', soilAdjusted: true, adjustment: 'Added: Sulphur deficiency detected' });
  }
  if (ph !== null && ph < 5.5) {
    recs.push({ name: 'Agricultural Lime', qty: Math.round(800 * areaAcres), unit: 'kg', soilAdjusted: true, adjustment: 'Added: Acidic soil — pH correction' });
  }
  if (organicCarbon !== null && organicCarbon < 0.5) {
    recs.push({ name: 'FYM (Farm Yard Manure)', qty: Math.round(2000 * areaAcres), unit: 'kg', soilAdjusted: true, adjustment: 'Added: Low organic carbon' });
  }

  return recs;
}

// ── POST /api/v1/soil/manual ──────────────────────────────────────────────────
router.post('/manual', authenticate, async (req, res) => {
  if (!await isEnabled('soil_health')) return sendError(res, 'मिट्टी जांच सेवा अभी उपलब्ध नहीं है।', 503);

  const {
    fieldName, testDate, sampleId,
    nitrogen, phosphorus, potassium, ph, ec,
    organicCarbon, zinc, iron, manganese, copper, boron, sulphur,
  } = req.body;

  // At least one parameter must be provided
  const hasData = [nitrogen, phosphorus, potassium, ph, ec, organicCarbon, zinc, iron, manganese, copper, boron, sulphur]
    .some(v => v !== undefined && v !== null && v !== '');
  if (!hasData) return sendError(res, 'At least one soil parameter is required', 400);

  // Build ratings
  const ratings = {};
  const params  = { nitrogen, phosphorus, potassium, ph, ec, organicCarbon, zinc, iron, manganese, copper, boron, sulphur };
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') {
      ratings[key] = rateSoilParam(key, val);
    }
  }

  const record = await prisma.soilHealthRecord.create({
    data: {
      userId:        req.user.id,
      fieldName:     fieldName?.trim() || null,
      testDate:      testDate ? new Date(testDate) : null,
      sampleId:      sampleId?.trim() || null,
      nitrogen:      nitrogen      ? parseFloat(nitrogen)      : null,
      phosphorus:    phosphorus    ? parseFloat(phosphorus)    : null,
      potassium:     potassium     ? parseFloat(potassium)     : null,
      ph:            ph            ? parseFloat(ph)            : null,
      ec:            ec            ? parseFloat(ec)            : null,
      organicCarbon: organicCarbon ? parseFloat(organicCarbon) : null,
      zinc:          zinc          ? parseFloat(zinc)          : null,
      iron:          iron          ? parseFloat(iron)          : null,
      manganese:     manganese     ? parseFloat(manganese)     : null,
      copper:        copper        ? parseFloat(copper)        : null,
      boron:         boron         ? parseFloat(boron)         : null,
      sulphur:       sulphur       ? parseFloat(sulphur)       : null,
      ratings,
      inputMethod:   'manual',
    },
  });

  // Overall soil health score (% of "optimal" or "high" ratings)
  const ratingValues = Object.values(ratings).filter(Boolean);
  const goodCount    = ratingValues.filter(r => ['optimal', 'high', 'sufficient', 'low_ec'].includes(r.rating)).length;
  const healthScore  = ratingValues.length ? Math.round((goodCount / ratingValues.length) * 100) : null;

  return sendSuccess(res, {
    ...record,
    healthScore,
    source:    'स्रोत: ICAR Soil Health Card norms',
    updatedAt: new Date().toISOString(),
  }, 201);
});

// ── GET /api/v1/soil/reports ──────────────────────────────────────────────────
router.get('/reports', authenticate, async (req, res) => {
  if (!await isEnabled('soil_health')) return sendError(res, 'मिट्टी जांच सेवा अभी उपलब्ध नहीं है।', 503);

  const reports = await prisma.soilHealthRecord.findMany({
    where:   { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, fieldName: true, testDate: true, sampleId: true, ph: true, nitrogen: true, organicCarbon: true, ratings: true, inputMethod: true, createdAt: true },
  });

  return sendSuccess(res, reports, 200, { total: reports.length });
});

// ── GET /api/v1/soil/reports/:id ─────────────────────────────────────────────
router.get('/reports/:id', authenticate, async (req, res) => {
  const report = await prisma.soilHealthRecord.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!report) return sendError(res, 'Soil report not found', 404);
  return sendSuccess(res, report);
});

// ── GET /api/v1/soil/recommendation ──────────────────────────────────────────
router.get('/recommendation', authenticate, async (req, res) => {
  if (!await isEnabled('soil_health')) return sendError(res, 'मिट्टी जांच सेवा अभी उपलब्ध नहीं है।', 503);

  const { soilId, crop, area = 1, unit = 'acre' } = req.query;
  if (!soilId) return sendError(res, 'soilId is required', 400);
  if (!crop)   return sendError(res, 'crop is required', 400);

  const report = await prisma.soilHealthRecord.findFirst({ where: { id: soilId, userId: req.user.id } });
  if (!report) return sendError(res, 'Soil report not found', 404);

  const areaAcres = parseFloat(area) * (unit === 'hectare' ? 2.47105 : unit === 'bigha' ? 0.619 : 1);

  const fertilizers = await generateFertilizerRec(report, crop, areaAcres);

  // Update report with recommendations
  await prisma.soilHealthRecord.update({
    where: { id: report.id },
    data:  { recommendations: [{ crop, area: areaAcres, unit: 'acre', fertilizers }] },
  }).catch(() => {});

  return sendSuccess(res, {
    soilId, crop, area: parseFloat(area), unit, areaAcres: parseFloat(areaAcres.toFixed(2)),
    fertilizers,
    soilRatings: report.ratings,
    generalAdvice: [
      report.ph && parseFloat(report.ph) < 5.5 ? '⚠️ pH बहुत कम है — पहले चूना डालें, फिर खाद।' : null,
      report.organicCarbon && parseFloat(report.organicCarbon) < 0.5 ? '⚠️ जैविक कार्बन कम है — गोबर खाद + हरी खाद जरूर डालें।' : null,
      '✅ मिट्टी जांच के अनुसार खाद की मात्रा समायोजित की गई है।',
    ].filter(Boolean),
    disclaimer: 'यह सुझाव ICAR मानकों पर आधारित है। कृपया स्थानीय कृषि विस्तार अधिकारी से भी सलाह लें।',
    source:     'ICAR Soil Health Card Norms + MPKV Rahuri Package of Practices',
  });
});

// ── DELETE /api/v1/soil/reports/:id ──────────────────────────────────────────
router.delete('/reports/:id', authenticate, async (req, res) => {
  const report = await prisma.soilHealthRecord.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!report) return sendError(res, 'Soil report not found', 404);
  await prisma.soilHealthRecord.delete({ where: { id: report.id } });
  return sendSuccess(res, { deleted: true });
});

export default router;
