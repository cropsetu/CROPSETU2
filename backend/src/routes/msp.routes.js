/**
 * MSP Tracker Routes
 *
 * GET /api/v1/msp/rates?season=kharif&year=2025-26    — all MSP rates for a season
 * GET /api/v1/msp/rates/:commodity                    — single commodity MSP detail
 * GET /api/v1/msp/compare/:commodity                  — MSP vs latest mandi price
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';
import prisma from '../config/db.js';

const router = Router();

// Current season default helper
function currentSeasonYear() {
  const m = new Date().getMonth() + 1; // 1-12
  const y = new Date().getFullYear();
  // Kharif: Jun-Nov. Rabi: Nov-Apr.
  if (m >= 6 && m <= 11) return { season: 'kharif', year: `${y}-${String(y + 1).slice(2)}` };
  if (m >= 12) return { season: 'rabi', year: `${y}-${String(y + 1).slice(2)}` };
  return { season: 'rabi', year: `${y - 1}-${String(y).slice(2)}` };
}

// ── GET /api/v1/msp/rates ─────────────────────────────────────────────────────
router.get('/rates', authenticate, async (req, res) => {
  if (!await isEnabled('msp_tracker')) return sendError(res, 'MSP Tracker अभी उपलब्ध नहीं है।', 503);

  const { season, year } = { ...currentSeasonYear(), ...req.query };

  const rates = await prisma.mSPRate.findMany({
    where:   { season, year },
    orderBy: { commodity: 'asc' },
  });

  if (!rates.length) return sendError(res, `No MSP rates found for ${season} ${year}`, 404);

  return sendSuccess(res, rates, 200, {
    season, year,
    source:    'CACP / Ministry of Agriculture & Farmers Welfare, GoI',
    disclaimer: 'MSP rates are official Government of India prices. Actual procurement depends on state agency and location.',
    updatedAt: new Date().toISOString(),
  });
});

// ── GET /api/v1/msp/rates/:commodity ─────────────────────────────────────────
router.get('/rates/:commodity', authenticate, async (req, res) => {
  if (!await isEnabled('msp_tracker')) return sendError(res, 'MSP Tracker अभी उपलब्ध नहीं है।', 503);

  const commodity = decodeURIComponent(req.params.commodity);
  const rates = await prisma.mSPRate.findMany({
    where:   { commodity: { contains: commodity, mode: 'insensitive' } },
    orderBy: [{ year: 'desc' }, { season: 'asc' }],
  });

  if (!rates.length) return sendError(res, 'Commodity not found in MSP database', 404);

  // Build 3-year trend if multiple years exist
  const trend = rates.map(r => ({
    season: r.season, year: r.year, mspPrice: r.mspPrice,
    change: r.previousYearMSP ? Math.round(r.mspPrice - r.previousYearMSP) : null,
    changePercent: r.increasePercent,
  }));

  return sendSuccess(res, { current: rates[0], trend, source: 'CACP / GoI' });
});

// ── GET /api/v1/msp/compare/:commodity ───────────────────────────────────────
// Compares the current MSP with latest mandi price for the commodity
router.get('/compare/:commodity', authenticate, async (req, res) => {
  if (!await isEnabled('msp_tracker')) return sendError(res, 'MSP Tracker अभी उपलब्ध नहीं है।', 503);

  const commodity = decodeURIComponent(req.params.commodity);
  const state     = req.query.state || req.user?.state || 'Maharashtra';

  const { season, year } = currentSeasonYear();

  // Get MSP
  const msp = await prisma.mSPRate.findFirst({
    where: { commodity: { contains: commodity, mode: 'insensitive' }, season, year },
  });

  // Get latest mandi price for this commodity + state (within last 7 days)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const mandi = await prisma.mandiPrice.findFirst({
    where: {
      commodity: { contains: commodity, mode: 'insensitive' },
      state:     { contains: state, mode: 'insensitive' },
      priceDate: { gte: since },
    },
    orderBy: { priceDate: 'desc' },
  });

  if (!msp && !mandi) return sendError(res, 'No data found for this commodity', 404);

  const mandiModal = mandi?.modalPrice || null;
  const mspPrice   = msp?.mspPrice    || null;

  let signal = null;
  let signalHi = null;
  if (mandiModal && mspPrice) {
    if (mandiModal >= mspPrice * 1.1) { signal = 'ABOVE_MSP'; signalHi = 'मंडी भाव MSP से काफी ज्यादा — बेचने का अच्छा समय'; }
    else if (mandiModal >= mspPrice)  { signal = 'AT_MSP';    signalHi = 'मंडी भाव MSP के पास है — सरकारी खरीद जांचें'; }
    else                              { signal = 'BELOW_MSP'; signalHi = 'मंडी भाव MSP से कम! सरकारी उपार्जन केंद्र पर बेचें'; }
  }

  return sendSuccess(res, {
    commodity: msp?.commodity || mandi?.commodity || commodity,
    commodityHi: msp?.commodityHi || null,
    msp: msp ? { price: mspPrice, season, year, procurementAgency: msp.procurementAgency } : null,
    mandi: mandi ? {
      modalPrice: mandiModal, minPrice: mandi.minPrice, maxPrice: mandi.maxPrice,
      market: mandi.market, district: mandi.district, state: mandi.state,
      priceDate: mandi.priceDate,
    } : null,
    priceDiffFromMSP: (mandiModal && mspPrice) ? Math.round(mandiModal - mspPrice) : null,
    priceDiffPercent: (mandiModal && mspPrice) ? Math.round(((mandiModal - mspPrice) / mspPrice) * 100) : null,
    signal,
    signalHi,
    source: 'CACP / GoI (MSP) + data.gov.in (Mandi)',
    disclaimer: 'यह सिर्फ AI का अनुमान है। अपने स्थानीय मंडी की जांच जरूर करें।',
    updatedAt: new Date().toISOString(),
  });
});

export default router;
