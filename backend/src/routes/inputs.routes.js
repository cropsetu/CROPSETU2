/**
 * Input Calculator Routes
 *
 * POST /api/v1/inputs/calculate   — calculate seed, fertilizer, pesticide quantities + costs
 * GET  /api/v1/inputs/price-list  — current input price reference list
 *
 * Uses CropMaster seed data for fertilizer schedules.
 * Prices sourced from APEDA / Maharashtra Agri Dept retail reference (2025).
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';
import prisma from '../config/db.js';

const router = Router();

// ── Reference input prices (₹/unit, Maharashtra retail, April 2025) ──────────
const INPUT_PRICES = {
  // Fertilizers
  'DAP':      { pricePerKg: 27,  unit: 'kg', nameHi: 'DAP (डाय अमोनियम फॉस्फेट)' },
  'Urea':     { pricePerKg: 5.5, unit: 'kg', nameHi: 'यूरिया' },
  'MOP':      { pricePerKg: 17,  unit: 'kg', nameHi: 'MOP (म्यूरेट ऑफ पोटाश)' },
  'SSP':      { pricePerKg: 8,   unit: 'kg', nameHi: 'SSP (सिंगल सुपर फॉस्फेट)' },
  'SOP':      { pricePerKg: 45,  unit: 'kg', nameHi: 'SOP (सल्फेट ऑफ पोटाश)' },
  'FYM':      { pricePerKg: 0.5, unit: 'kg', nameHi: 'गोबर खाद (FYM)' },
  'Gypsum':   { pricePerKg: 4,   unit: 'kg', nameHi: 'जिप्सम' },
  '0:52:34':  { pricePerKg: 90,  unit: 'kg', nameHi: 'मोनो पोटेशियम फॉस्फेट (MKP)' },
  // Seeds (avg per kg)
  'Hybrid Maize Seed':  { pricePerKg: 1200, unit: 'kg', nameHi: 'मक्का हाइब्रिड बीज' },
  'Soybean Seed':       { pricePerKg: 80,   unit: 'kg', nameHi: 'सोयाबीन बीज' },
  'Cotton Bt Seed':     { pricePerPacket: 900, unit: 'packet (450g)', nameHi: 'Bt कपास बीज (पैकेट)' },
  'Onion Seed':         { pricePerKg: 3000, unit: 'kg', nameHi: 'प्याज बीज' },
  'Tomato Hybrid Seed': { pricePerKg: 15000,unit: 'kg', nameHi: 'टमाटर हाइब्रिड बीज' },
  'Wheat Seed':         { pricePerKg: 35,   unit: 'kg', nameHi: 'गेहूँ बीज' },
  'Gram Seed':          { pricePerKg: 60,   unit: 'kg', nameHi: 'चना बीज' },
  'Tur Seed':           { pricePerKg: 120,  unit: 'kg', nameHi: 'तुअर बीज' },
  // Common pesticides
  'Mancozeb 75WP':         { pricePerKg: 180,  unit: 'kg', nameHi: 'मैनकोजेब' },
  'Imidacloprid 70WG':     { pricePerKg: 1800, unit: 'kg', nameHi: 'इमिडाक्लोप्रिड' },
  'Emamectin Benzoate 5SG':{ pricePerKg: 1200, unit: 'kg', nameHi: 'इमामेक्टिन बेंजोएट' },
  'Chlorpyrifos 20EC':     { pricePerL: 400,   unit: 'litre', nameHi: 'क्लोरपाइरीफॉस' },
  // Labour
  'Manual labour (1 day)': { pricePerUnit: 350, unit: 'person-day', nameHi: 'मजदूरी (प्रति दिन)' },
};

// ── Unit conversion helpers ───────────────────────────────────────────────────
const ACRE_TO_HECTARE = 0.404686;
const BIGHA_TO_ACRE   = 0.619;  // 1 bigha ≈ 0.619 acre (Mahrashtra / UP convention)
const GUNTHA_TO_ACRE  = 0.025;  // 40 guntha = 1 acre

function toAcres(area, unit) {
  switch (unit?.toLowerCase()) {
    case 'acre':    case 'acres':   return area;
    case 'hectare': case 'ha':      return area / ACRE_TO_HECTARE;
    case 'bigha':                   return area * BIGHA_TO_ACRE;
    case 'guntha':                  return area * GUNTHA_TO_ACRE;
    default:                        return area; // assume acres
  }
}

// ── POST /api/v1/inputs/calculate ────────────────────────────────────────────
router.post('/calculate', authenticate, async (req, res) => {
  if (!await isEnabled('input_calculator')) return sendError(res, 'इनपुट कैलकुलेटर अभी उपलब्ध नहीं है।', 503);

  const { crop, area, unit = 'acre', organic = false } = req.body;
  if (!crop)                     return sendError(res, 'crop is required', 400);
  if (!area || isNaN(parseFloat(area)) || parseFloat(area) <= 0) {
    return sendError(res, 'area (positive number) is required', 400);
  }

  const areaAcres = toAcres(parseFloat(area), unit);

  // Load crop master
  const cropMaster = await prisma.cropMaster.findFirst({
    where: { name: { equals: crop.trim(), mode: 'insensitive' } },
  });

  if (!cropMaster) return sendError(res, `Crop "${crop}" not found. Use /api/v1/crops to see supported crops.`, 404);

  const items     = [];
  let totalCost   = 0;

  // ── Seed cost ──────────────────────────────────────────────────────────────
  if (cropMaster.seedRate?.value) {
    const seedQty    = cropMaster.seedRate.value * areaAcres;
    const seedUnit   = cropMaster.seedRate.unit || 'kg/acre';
    const seedName   = `${cropMaster.nameHi} बीज`;
    const seedPriceRef = Object.entries(INPUT_PRICES).find(([k]) => k.toLowerCase().includes(crop.toLowerCase()) && k.toLowerCase().includes('seed'));
    const unitPrice  = seedPriceRef?.[1]?.pricePerKg || null;
    const cost       = unitPrice ? Math.round(unitPrice * seedQty) : null;
    if (cost) totalCost += cost;

    items.push({
      category:  'Seed / बीज',
      name:       seedName,
      quantity:   parseFloat(seedQty.toFixed(1)),
      unit:       seedUnit,
      unitPrice:  unitPrice ? `₹${unitPrice}/kg` : 'Market rate',
      cost:       cost,
      isOrganic:  false,
      note:       `Seed rate: ${cropMaster.seedRate.value} ${seedUnit}`,
    });
  }

  // ── Fertilizer cost ────────────────────────────────────────────────────────
  const fertSchedule = cropMaster.fertilizerSchedule || [];
  for (const stage of fertSchedule) {
    for (const fert of stage.fertilizers || []) {
      const qty    = fert.quantityPerAcre * areaAcres;
      const priceRef = INPUT_PRICES[fert.name];
      const unitPrice = priceRef?.pricePerKg || null;
      const cost   = unitPrice ? Math.round(unitPrice * qty) : null;
      if (cost) totalCost += cost;

      if (!organic || ['FYM', 'Gypsum', 'Jeevamrit'].some(o => fert.name.includes(o))) {
        items.push({
          category:  `Fertilizer / खाद (${stage.stage})`,
          name:       priceRef?.nameHi || fert.name,
          quantity:   parseFloat(qty.toFixed(1)),
          unit:       fert.unit || 'kg',
          unitPrice:  unitPrice ? `₹${unitPrice}/kg` : 'Market rate',
          cost,
          isOrganic:  false,
          applyAt:    stage.stage,
          stageDays:  stage.stageDays,
        });
      }
    }
  }

  // ── Labour estimate (generic) ──────────────────────────────────────────────
  // Approximate: sowing + weeding + harvesting ~15 person-days per acre
  const labourDays = Math.round(15 * areaAcres);
  const labourCost = labourDays * 350;
  totalCost += labourCost;
  items.push({
    category: 'Labour / मजदूरी',
    name:      'Farm labour (sowing + weeding + harvesting)',
    quantity:  labourDays,
    unit:      'person-days',
    unitPrice: '₹350/day',
    cost:      labourCost,
    isOrganic: false,
    note:      'Estimate — actual may vary by region and season',
  });

  // ── Pesticide estimate (generic) ───────────────────────────────────────────
  // Generic: ₹2000-₹5000/acre depending on crop risk
  const pesticideBudget = Math.round(areaAcres * (['cotton', 'tomato', 'grapes', 'pomegranate'].includes(crop.toLowerCase()) ? 5000 : 2500));
  totalCost += pesticideBudget;
  items.push({
    category: 'Pesticides / कीटनाशक',
    name:      'Fungicide + Insecticide budget',
    quantity:  areaAcres,
    unit:      'acre',
    unitPrice: `₹${['cotton', 'tomato'].includes(crop.toLowerCase()) ? 5000 : 2500}/acre`,
    cost:      pesticideBudget,
    isOrganic: false,
    note:      'Seasonal estimate. Actual depends on pest pressure.',
  });

  // ── Irrigation cost estimate ───────────────────────────────────────────────
  const irrigationCost = Math.round(areaAcres * 3000);
  totalCost += irrigationCost;
  items.push({
    category: 'Irrigation / सिंचाई',
    name:      'Electricity/diesel + water charges (season)',
    quantity:  areaAcres,
    unit:      'acre',
    unitPrice: '₹3,000/acre',
    cost:      irrigationCost,
    isOrganic: false,
    note:      'Estimate for borewell/canal. Rainfed crops: ₹0.',
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const costPerAcre   = Math.round(totalCost / areaAcres);
  const yieldRange    = cropMaster.varieties?.[0]?.yieldPerAcre || 'Varies by variety';

  return sendSuccess(res, {
    crop:       cropMaster.name,
    cropHi:     cropMaster.nameHi,
    area:       parseFloat(area),
    unit,
    areaAcres:  parseFloat(areaAcres.toFixed(2)),
    items,
    summary: {
      totalCost:  totalCost,
      costPerAcre,
      yieldRange,
      estimatedRevenue: null, // user should check mandi price for revenue
    },
    costBreakdown: {
      seed:       items.filter(i => i.category.includes('Seed')).reduce((s, i) => s + (i.cost || 0), 0),
      fertilizer: items.filter(i => i.category.includes('Fertilizer')).reduce((s, i) => s + (i.cost || 0), 0),
      labour:     labourCost,
      pesticide:  pesticideBudget,
      irrigation: irrigationCost,
    },
    disclaimer: 'यह अनुमानित लागत है। वास्तविक लागत स्थान, मौसम और बाजार भाव पर निर्भर करती है।',
    source:     'ICAR Package of Practices + Maharashtra Agri Dept input prices (April 2025)',
    updatedAt:  '2025-04',
  });
});

// ── GET /api/v1/inputs/price-list ─────────────────────────────────────────────
router.get('/price-list', authenticate, async (req, res) => {
  const list = Object.entries(INPUT_PRICES).map(([name, info]) => ({
    name,
    nameHi:      info.nameHi,
    price:       info.pricePerKg || info.pricePerL || info.pricePerUnit || info.pricePerPacket,
    unit:        info.unit,
    priceString: `₹${info.pricePerKg || info.pricePerL || info.pricePerUnit || info.pricePerPacket}/${info.unit}`,
  }));
  return sendSuccess(res, list, 200, {
    source:    'Maharashtra Agri Dept retail reference',
    updatedAt: 'April 2025',
    note:      'Prices are indicative. Actual prices vary by district and supplier.',
    noteHi:    'कीमतें संकेतात्मक हैं। असली कीमत आपके जिले और व्यापारी पर निर्भर करती है।',
  });
});

export default router;
