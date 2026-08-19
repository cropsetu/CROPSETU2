/**
 * Market Data Service — FarmMind
 *
 * NO AI / NO external LLM. Mandi prices are served as deterministic ESTIMATES
 * derived from embedded historical price ranges (PRICE_CONTEXT), clearly marked
 * `isFallback: true`, until a real mandi-price API (e.g. Agmarknet / data.gov.in)
 * is wired in. The previous Gemini price-generation was removed — it hallucinated
 * prices AND was expensive (it ran on every cache-warm tick, burning tokens 24/7).
 *
 * To plug in a real source later: replace the body of getMarketPrices() /
 * getExtendedForecast() with the API call; the cache
 * (L1 Map + L2 Redis) and the response shapes below can stay exactly as-is.
 */
import { singleFlight } from '../utils/singleFlight.js';
import { recordCacheHit, recordCacheMiss } from '../utils/cacheMetrics.js';
import redis from '../config/redis.js';
import logger from '../utils/logger.js';

// ── 30-min cache (stampede-guarded: single-flight + jittered TTL) ──────────────
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
// Hard cap on live keys so the cache can't grow without bound across many
// commodity/state combinations under sustained miss traffic. Eviction is FIFO
// (oldest insertion first), matching mandiPrice.service.js / weather.routes.js.
const MAX_MEM_ENTRIES = 500;
// ±10% TTL jitter. The startup seed (see server.js) populates ~50 commodity/state
// keys within a few seconds; without jitter they'd all expire at the same instant
// 30 min later and stampede in lockstep. Jitter spreads expiry over a window so
// recomputes are smeared out instead of synchronized.
const TTL_JITTER = 0.1;
function jitteredExp(ttl) {
  const jitter = ttl * TTL_JITTER * (Math.random() * 2 - 1); // ±10%
  return Date.now() + ttl + jitter;
}
function cacheGet(k) {
  const e = cache.get(k);
  if (!e || Date.now() > e.exp) { cache.delete(k); recordCacheMiss('market'); return null; }
  recordCacheHit('market');
  return e.data;
}
function cacheSet(k, data, ttl = CACHE_TTL) {
  if (!cache.has(k) && cache.size >= MAX_MEM_ENTRIES) {
    const oldest = cache.keys().next().value; // FIFO: drop the oldest insertion
    cache.delete(oldest);
  }
  cache.set(k, { data, exp: jitteredExp(ttl) });
}

// ── L2: shared Redis cache (CACHE-6 / CACHE-10) ────────────────────────────────
// The Map above is L1 — per process, lost on restart. Backing it with Redis makes
// the per-commodity result shared across the fleet: the first instance to compute
// a key populates Redis, and every other instance (and a restarted one) serves the
// repeat lookup from cache within the TTL instead of recomputing.
// Fail-open: any Redis unavailability degrades to the L1-only behaviour, never
// an error — the service always works.
const REDIS_READY = () => redis?.status === 'ready';
const RKEY = (k) => `market:${k}`;

// Jittered TTL in whole seconds (±10%) so keys the fleet populated together (e.g.
// the startup seed) don't all expire — and recompute in lockstep — at once.
function jitteredSec(ttlMs) {
  const jitter = ttlMs * TTL_JITTER * (Math.random() * 2 - 1);
  return Math.max(1, Math.round((ttlMs + jitter) / 1000));
}

async function redisGet(key) {
  if (!REDIS_READY()) return null;
  try {
    const hit = await redis.get(RKEY(key));
    if (hit) { recordCacheHit('market:redis'); return JSON.parse(hit); }
    recordCacheMiss('market:redis');
    return null;
  } catch { return null; } // treat any read error as a miss
}

async function redisSet(key, data, ttlMs = CACHE_TTL) {
  if (!REDIS_READY()) return;
  try { await redis.set(RKEY(key), JSON.stringify(data), 'EX', jitteredSec(ttlMs)); }
  catch (err) { logger.warn('[Market] Redis cache set failed for %s: %s', key, err.message); }
}

// ── Real historical price ranges (₹/quintal) used to ground the AI ────────────
const PRICE_CONTEXT = {
  // ── Staple vegetables
  Tomato:       { low: 400,   high: 5000,  avg: 2200, unit: 'quintal', notes: 'Highly volatile. Peaks Jun–Jul & Dec–Jan. Low in harvest season Oct–Nov.' },
  Onion:        { low: 600,   high: 8000,  avg: 2000, unit: 'quintal', notes: 'Very volatile. High Jun–Sep (lean season). Low at harvest Feb–Mar & Oct–Nov.' },
  Potato:       { low: 400,   high: 2500,  avg: 1200, unit: 'quintal', notes: 'Very volatile. Glut Feb–Apr at harvest in UP/Punjab.' },
  Brinjal:      { low: 300,   high: 1800,  avg: 800,  unit: 'quintal', notes: 'Moderate volatility. Available year-round. Peaks summer months.' },
  Cauliflower:  { low: 300,   high: 1500,  avg: 700,  unit: 'quintal', notes: 'Winter crop. Glut Dec–Feb in north India. Higher prices May–Sep.' },
  Cabbage:      { low: 200,   high: 900,   avg: 500,  unit: 'quintal', notes: 'Winter crop. Cheap Dec–Feb. Peaks Apr–Aug.' },
  Okra:         { low: 600,   high: 3000,  avg: 1400, unit: 'quintal', notes: 'Summer/Kharif crop. Peaks May–Jul. Scarce and costly in winter.' },
  'Bitter Gourd':{ low: 800,  high: 3500,  avg: 1800, unit: 'quintal', notes: 'Summer vegetable. High demand in summer, peaks May–Aug.' },
  Capsicum:     { low: 800,   high: 4000,  avg: 2000, unit: 'quintal', notes: 'High-value vegetable. Polyhouse grown year-round. Peaks winter.' },
  Cucumber:     { low: 300,   high: 1200,  avg: 700,  unit: 'quintal', notes: 'Summer crop. Cheap May–Aug, costly in winter.' },
  'Bottle Gourd':{ low: 300,  high: 1000,  avg: 600,  unit: 'quintal', notes: 'Summer vegetable. Plentiful Jun–Sep, scarce Dec–Feb.' },
  Pumpkin:      { low: 300,   high: 1000,  avg: 600,  unit: 'quintal', notes: 'Low-value vegetable. Prices relatively stable year-round.' },
  Carrot:       { low: 500,   high: 2200,  avg: 1200, unit: 'quintal', notes: 'Winter crop. Cheap Dec–Feb. Costly in summer. Punjab & HP dominant.' },
  Radish:       { low: 200,   high: 800,   avg: 400,  unit: 'quintal', notes: 'Winter crop. Cheap and plentiful Oct–Feb.' },
  Spinach:      { low: 400,   high: 1500,  avg: 800,  unit: 'quintal', notes: 'Cool-season leaf vegetable. Higher prices in summer.' },
  'Green Chilli':{ low: 1000, high: 8000,  avg: 3000, unit: 'quintal', notes: 'Very volatile. Peaks summer. Andhra & Karnataka major producers.' },
  Garlic:       { low: 2000,  high: 20000, avg: 8000, unit: 'quintal', notes: 'Very volatile. Harvest Apr–May. Peaks Oct–Feb. MP & Gujarat dominant.' },
  Ginger:       { low: 2000,  high: 18000, avg: 7000, unit: 'quintal', notes: 'Volatile. Harvest Oct–Dec. Used fresh & dry. Kerala, Karnataka, NE India.' },
  Coriander:    { low: 500,   high: 3000,  avg: 1500, unit: 'quintal', notes: 'Winter crop. Higher prices summer. Rajasthan major producer.' },
  Fenugreek:    { low: 3000,  high: 8000,  avg: 5000, unit: 'quintal', notes: 'Dual use: vegetable & spice. Rajasthan dominates production.' },
  Peas:         { low: 600,   high: 3000,  avg: 1500, unit: 'quintal', notes: 'Winter crop. Cheap Dec–Feb, costly rest of year.' },
  'Sweet Potato':{ low: 600,  high: 1800,  avg: 1000, unit: 'quintal', notes: 'Winter harvest. UP & Odisha dominant. Moderate price volatility.' },
  // ── Fruits
  Mango:        { low: 1500,  high: 7000,  avg: 3500, unit: 'quintal', notes: 'Summer fruit. Peak supply Apr–Jul. Very high demand. UP, Maharashtra, AP dominant.' },
  Banana:       { low: 600,   high: 2500,  avg: 1200, unit: 'quintal', notes: 'Year-round crop. Stable prices. Tamil Nadu, AP, Maharashtra dominant.' },
  Grapes:       { low: 2000,  high: 9000,  avg: 4000, unit: 'quintal', notes: 'Feb–May harvest in Nashik/Sangli. Export quality commands premium.' },
  Pomegranate:  { low: 3000,  high: 18000, avg: 7000, unit: 'quintal', notes: 'Oct–Feb & Jun–Jul seasons. Solapur & Nashik dominant. Export quality premium.' },
  Guava:        { low: 600,   high: 2500,  avg: 1200, unit: 'quintal', notes: 'Oct–Feb peak. UP, MP, Bihar dominant. Moderate price volatility.' },
  Papaya:       { low: 400,   high: 1800,  avg: 900,  unit: 'quintal', notes: 'Year-round. Seasonal peaks Aug–Oct. AP & Karnataka dominant.' },
  Watermelon:   { low: 200,   high: 800,   avg: 400,  unit: 'quintal', notes: 'Summer fruit Mar–Jun. Cheap at harvest, absent in winter.' },
  Muskmelon:    { low: 400,   high: 1500,  avg: 800,  unit: 'quintal', notes: 'Summer fruit Apr–Jun. UP, Rajasthan dominant.' },
  Orange:       { low: 1500,  high: 6000,  avg: 3000, unit: 'quintal', notes: 'Nov–Feb season. Nagpur (Maharashtra) dominant. Export quality premium.' },
  Lemon:        { low: 1000,  high: 10000, avg: 3500, unit: 'quintal', notes: 'Year-round but peaks summer. Very volatile in Apr–Jun heatwave.' },
  Apple:        { low: 3000,  high: 10000, avg: 6000, unit: 'quintal', notes: 'Aug–Oct harvest. HP & J&K dominant. High-value fruit.' },
  Sapota:       { low: 1500,  high: 4000,  avg: 2500, unit: 'quintal', notes: 'Nov–Jan peak. Karnataka, Gujarat dominant. Moderate volatility.' },
  Pineapple:    { low: 1500,  high: 4500,  avg: 2800, unit: 'quintal', notes: 'Apr–Jun peak. NE India, Kerala, West Bengal dominant.' },
  Litchi:       { low: 3000,  high: 10000, avg: 5000, unit: 'quintal', notes: 'May–Jun season only. Bihar dominant. Short window, high demand.' },
  Coconut:      { low: 1500,  high: 5000,  avg: 2800, unit: 'quintal', notes: 'Year-round. Kerala, Karnataka, TN dominant. Copra prices higher.' },
  // ── Cereals
  Wheat:        { low: 1900,  high: 2500,  avg: 2150, unit: 'quintal', notes: 'MSP-supported ~₹2275. Stable. Harvest Mar–Apr in Punjab/UP.' },
  Rice:         { low: 1800,  high: 3500,  avg: 2500, unit: 'quintal', notes: 'Stable due to PDS procurement. Kharif harvest Oct–Nov.' },
  Maize:        { low: 1400,  high: 2200,  avg: 1800, unit: 'quintal', notes: 'MSP ~₹1870. Kharif & Rabi. Poultry/ethanol demand.' },
  Bajra:        { low: 1700,  high: 2400,  avg: 2050, unit: 'quintal', notes: 'MSP ~₹2500. Kharif. Rajasthan, Gujarat dominant. Stable MSP floor.' },
  Jowar:        { low: 1800,  high: 2500,  avg: 2100, unit: 'quintal', notes: 'MSP ~₹3180. Kharif & Rabi. Karnataka, Maharashtra dominant.' },
  Barley:       { low: 1600,  high: 2000,  avg: 1800, unit: 'quintal', notes: 'Rabi crop. MSP ~₹1735. Stable. Malt industry demand.' },
  Ragi:         { low: 2500,  high: 3800,  avg: 3000, unit: 'quintal', notes: 'MSP ~₹3846. Karnataka & AP dominant. Demand rising for health food.' },
  // ── Pulses
  'Tur Dal':    { low: 5000,  high: 15000, avg: 7000, unit: 'quintal', notes: 'Very volatile. MSP ~₹7000. Kharif. Maharashtra, Karnataka dominant.' },
  Gram:         { low: 4000,  high: 7000,  avg: 5200, unit: 'quintal', notes: 'MSP ~₹5440. Rabi. MP, Rajasthan dominant. Stable MSP floor.' },
  Moong:        { low: 5000,  high: 9000,  avg: 7000, unit: 'quintal', notes: 'MSP ~₹8558. Summer & Kharif. Rajasthan dominant. High demand.' },
  Urad:         { low: 4500,  high: 9000,  avg: 6500, unit: 'quintal', notes: 'MSP ~₹7400. Kharif. MP, UP, Andhra dominant.' },
  Masoor:       { low: 3500,  high: 6000,  avg: 4500, unit: 'quintal', notes: 'MSP ~₹6425. Rabi. UP, MP dominant. Imported heavily.' },
  Peas:         { low: 600,   high: 3000,  avg: 1500, unit: 'quintal', notes: 'Winter crop. Cheap Dec–Feb. UP, Himachal dominant.' },
  // ── Oilseeds
  Soybean:      { low: 3500,  high: 5500,  avg: 4300, unit: 'quintal', notes: 'MSP ~₹4600. Kharif. Harvest Oct–Nov. MP & Maharashtra dominant.' },
  Groundnut:    { low: 4500,  high: 7500,  avg: 5800, unit: 'quintal', notes: 'MSP ~₹6783. Kharif. Gujarat dominant. High demand for oil.' },
  Sunflower:    { low: 4500,  high: 7500,  avg: 5600, unit: 'quintal', notes: 'MSP ~₹6760. Karnataka & AP dominant. Kharif & Rabi both.' },
  Mustard:      { low: 4500,  high: 7000,  avg: 5500, unit: 'quintal', notes: 'MSP ~₹5650. Rabi. Rajasthan, Haryana dominant. Stable MSP floor.' },
  Sesame:       { low: 8000,  high: 18000, avg: 12000, unit: 'quintal', notes: 'High-value oilseed. Kharif. Gujarat, Rajasthan dominant.' },
  Castor:       { low: 5000,  high: 8000,  avg: 6500, unit: 'quintal', notes: 'MSP ~₹6400. Kharif. Gujarat dominant (world\'s largest producer).' },
  // ── Cash crops
  Cotton:       { low: 5500,  high: 8500,  avg: 6800, unit: 'quintal', notes: 'MSP ~₹6620. Kharif. Peaks Dec–Feb. Gujarat, Maharashtra dominant.' },
  Sugarcane:    { low: 280,   high: 400,   avg: 340,  unit: 'quintal', notes: 'FRP ₹340/quintal FY2025. Government regulated. Stable.' },
  Jute:         { low: 4000,  high: 6000,  avg: 5000, unit: 'quintal', notes: 'MSP ~₹5050. Kharif. West Bengal & Assam dominant.' },
  // ── Spices
  Turmeric:     { low: 6000,  high: 25000, avg: 12000, unit: 'quintal', notes: 'Very volatile. Peaks Mar–Jun. Telangana & Maharashtra dominant.' },
  'Red Chilli': { low: 8000,  high: 30000, avg: 15000, unit: 'quintal', notes: 'Highly volatile. Andhra Pradesh (Guntur) dominant. Dry & green both.' },
  Cumin:        { low: 15000, high: 60000, avg: 30000, unit: 'quintal', notes: 'Extremely volatile. Rajasthan & Gujarat dominant. Export-driven.' },
  'Coriander Seeds':{ low: 5000, high: 15000, avg: 8000, unit: 'quintal', notes: 'Volatile. Rajasthan dominant. Dual use: spice & vegetable.' },
  Cardamom:     { low: 80000, high: 300000, avg: 150000, unit: 'quintal', notes: 'Very high value. Kerala & Karnataka dominant. Export-driven.' },
  'Black Pepper':{ low: 30000, high: 80000, avg: 50000, unit: 'quintal', notes: 'High-value spice. Kerala dominant. Import/export parity drives price.' },
  Ajwain:       { low: 8000,  high: 25000, avg: 15000, unit: 'quintal', notes: 'Rajasthan & Gujarat dominant. Medicinal demand driving prices.' },
  Fennel:       { low: 8000,  high: 22000, avg: 13000, unit: 'quintal', notes: 'Rajasthan & Gujarat dominant. Export demand.' },
};

// Major mandis per state
const STATE_MANDIS = {
  Maharashtra:      ['Nashik', 'Pune', 'Mumbai (Vashi)', 'Aurangabad', 'Kolhapur'],
  Punjab:           ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda'],
  UP:               ['Lucknow', 'Agra', 'Kanpur', 'Varanasi', 'Mathura'],
  Karnataka:        ['Bangalore (Yeshwanthpur)', 'Hubli', 'Mysore', 'Davangere', 'Bijapur'],
  'Andhra Pradesh': ['Kurnool', 'Guntur', 'Vijaywada', 'Tirupati', 'Kakinada'],
  Gujarat:          ['Ahmedabad', 'Surat', 'Rajkot', 'Vadodara', 'Anand'],
  Rajasthan:        ['Jaipur', 'Jodhpur', 'Kota', 'Bikaner', 'Ajmer'],
  MP:               ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain'],
};

// ── Main export ────────────────────────────────────────────────────────────────
export async function getMarketPrices(commodity = 'Tomato', state = 'Maharashtra', city = null) {
  const key = `${commodity}:${state}:${city || ''}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, fromCache: true };

  // Single-flight so concurrent misses on this key coalesce into one compute.
  return singleFlight(`mkt:${key}`, async () => {
    // L2 (shared Redis): another instance may already have this key cached.
    const l2 = await redisGet(key);
    if (l2) { cacheSet(key, l2); return { ...l2, fromCache: true }; }

    // NO AI: deterministic estimate from historical price context. Cache it like a
    // real result so behaviour/shape is unchanged; swap this line for a real
    // mandi-price API call when one is wired in.
    const result = buildFallback(commodity, state);
    cacheSet(key, result);
    await redisSet(key, result, CACHE_TTL);
    return result;
  });
}

// ── Extended multi-month forecast (3m / 6m / 12m) ─────────────────────────────
export async function getExtendedForecast(commodity = 'Tomato', state = 'Maharashtra', period = '3m') {
  const key = `ext:${commodity}:${state}:${period}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, fromCache: true };

  const periodMonths = { '3m': 3, '6m': 6, '12m': 12 }[period] || 3;
  const ctx  = PRICE_CONTEXT[commodity] || {};
  const now  = new Date();
  const EXT_TTL = 2 * 60 * 60 * 1000; // 2h — extended forecasts change slowly

  // Build array of future month labels
  const monthLabels = Array.from({ length: periodMonths }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    return d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
  });

  // NO AI: deterministic seasonal-wave estimate. Swap for a real API later.
  const result = buildExtendedFallback(commodity, state, period, periodMonths, monthLabels, ctx);
  cacheSet(key, result, EXT_TTL);
  await redisSet(key, result, EXT_TTL);
  return result;
}

// ── Synthetic extended forecast (deterministic seasonal wave) ─────────────────
function buildExtendedFallback(commodity, state, period, periodMonths, monthLabels, ctx) {
  const avg  = ctx.avg  || 2500;
  const low  = ctx.low  || Math.round(avg * 0.7);
  const high = ctx.high || Math.round(avg * 1.4);

  // Simulate a gentle seasonal wave over the period
  const forecast = monthLabels.map((month, i) => {
    const wave     = Math.sin((i / periodMonths) * Math.PI * 2);
    const avgPrice = Math.round(avg * (1 + wave * 0.12));
    return {
      month,
      avgPrice,
      minPrice: Math.round(avgPrice * 0.88),
      maxPrice: Math.round(avgPrice * 1.13),
      confidence: 60,
      trend: wave > 0.1 ? 'up' : wave < -0.1 ? 'down' : 'stable',
      keyDriver: 'Seasonal supply-demand pattern',
    };
  });

  const prices    = forecast.map(f => f.avgPrice);
  const bestIdx   = prices.indexOf(Math.max(...prices));
  const worstIdx  = prices.indexOf(Math.min(...prices));

  return {
    commodity, state, period, periodMonths,
    forecast,
    overallTrend: 'stable',
    bestMonthToSell:  forecast[bestIdx]?.month  || monthLabels[0],
    worstMonthToSell: forecast[worstIdx]?.month || monthLabels[monthLabels.length - 1],
    peakPriceMonth: forecast[bestIdx]?.month,
    peakPrice:      prices[bestIdx],
    lowPriceMonth:  forecast[worstIdx]?.month,
    lowPrice:       prices[worstIdx],
    reasoning: `${commodity} prices in ${state} typically range ₹${low.toLocaleString()}–₹${high.toLocaleString()}/quintal. Seasonal patterns suggest moderate volatility over this period. Monitor mandi arrivals and government procurement announcements closely.`,
    riskLevel: 'medium',
    factors: ['Seasonal supply cycles', 'Monsoon impact on arrivals', 'Government MSP/procurement policy'],
    sellingStrategy: `Sell in batches — target months when prices historically peak. Hold back 30–40% of produce for the higher-price window.`,
    isFallback: true,
    generatedAt: new Date().toISOString(),
  };
}

// ── Static price estimate (no external source) ────────────────────────────────
// Built dynamically from PRICE_CONTEXT so we never need to maintain a separate list
const FALLBACK_PRICES = Object.fromEntries(
  Object.entries(PRICE_CONTEXT).map(([crop, ctx]) => [
    crop,
    { current: ctx.avg, weekHigh: Math.round(ctx.avg * 1.15), weekLow: Math.round(ctx.avg * 0.85) },
  ])
);

function buildFallback(commodity, state) {
  const f = FALLBACK_PRICES[commodity] || { current: 2000, weekHigh: 2400, weekLow: 1700 };
  const mandis = STATE_MANDIS[state] || STATE_MANDIS['Maharashtra'];
  return {
    crop: commodity, unit: 'quintal',
    current: f.current, weekHigh: f.weekHigh, weekLow: f.weekLow,
    trend: 'stable', change: 0,
    forecast7d: Array.from({ length: 7 }, (_, i) => Math.round(f.current * (0.95 + i * 0.015))),
    insight: `${commodity} prices in ${state} are currently around ₹${f.current}/quintal. Check your local mandi for live rates.`,
    recommendation: 'hold',
    prices: mandis.slice(0, 3).map((m, i) => ({
      mandi: m, price: f.current + i * 100,
      minPrice: f.weekLow, maxPrice: f.weekHigh,
      dist: ['18 km', '42 km', '90 km'][i],
    })),
    lastUpdated: 'offline',
    source: 'fallback',
    isFallback: true,
  };
}

export const SUPPORTED_CROPS   = Object.keys(PRICE_CONTEXT);
export const SUPPORTED_STATES  = Object.keys(STATE_MANDIS);
