/**
 * farmHistory.server.js — server-side mirror of frontend/src/utils/farmHistory.js.
 *
 * Turns a FarmCropCycle's structured JSON logs (fertilizersUsed, pesticidesUsed,
 * irrigationLogs, observedEvents) + cost columns into compact, human-readable
 * strings and trend aggregates for the AI chat / diagnosis FARMER PROFILE block.
 *
 * Entry shapes match what backend/src/services/cropCycle.service.js writes.
 * Every function is defensive: missing/empty input → '' or [] so a sparse cycle
 * never breaks context building. (A shared cross-runtime package is deferred.)
 */

const MAX_ENTRIES = 6;

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const arr = (a) => (Array.isArray(a) ? a : []);
const recent = (a) => arr(a).slice(-MAX_ENTRIES);
const sumCost = (a, key) => arr(a).reduce((s, x) => s + (Number(x?.[key]) || 0), 0);
const fmtInr = (n) => (Number(n) > 0 ? `₹${Math.round(Number(n))}` : '');

/** "Urea 50kg (Vegetative, 20 Jun); DAP 25kg (1 Jul)" */
export function summarizeFertilizers(a) {
  return recent(a)
    .map((f) => {
      const name = f?.productName || 'fertilizer';
      const qty = f?.quantityKg != null ? `${f.quantityKg}kg` : '';
      const meta = [f?.applicationStage, fmtDate(f?.applicationDate)].filter(Boolean).join(', ');
      return [name, qty].filter(Boolean).join(' ') + (meta ? ` (${meta})` : '');
    })
    .filter(Boolean)
    .join('; ');
}

/** "Imidacloprid for Aphids 250ml (5 Jul); Mancozeb for Rust (12 Jul)" */
export function summarizePesticides(a) {
  return recent(a)
    .map((p) => {
      const name = p?.productName || 'pesticide';
      const target = p?.targetPestOrDisease ? ` for ${p.targetPestOrDisease}` : '';
      const qty = p?.quantityMl != null ? ` ${p.quantityMl}ml` : '';
      const date = fmtDate(p?.applicationDate);
      return `${name}${target}${qty}` + (date ? ` (${date})` : '');
    })
    .filter(Boolean)
    .join('; ');
}

/** "drip 2h (20 Jun); flood 4h (28 Jun)" */
export function summarizeIrrigation(a) {
  return recent(a)
    .map((i) => {
      const method = i?.method || 'irrigation';
      const dur = i?.durationHours != null ? ` ${i.durationHours}h` : '';
      const src = i?.source ? ` from ${i.source}` : '';
      const date = fmtDate(i?.date);
      return `${method}${dur}${src}` + (date ? ` (${date})` : '');
    })
    .filter(Boolean)
    .join('; ');
}

/** "frost (moderate, 12 Jul); pest_outbreak (severe, 18 Jul)" */
export function summarizeEvents(a) {
  return recent(a)
    .map((e) => {
      const type = e?.type || 'event';
      const sev = e?.severity ? `, ${e.severity}` : '';
      const date = fmtDate(e?.date);
      return `${type}${sev}` + (date ? ` (${date})` : '');
    })
    .filter(Boolean)
    .join('; ');
}

/** "Seed ₹1200, Fertilizer ₹800, Pesticide ₹400, Labour ₹600" (only >0 parts). */
export function summarizeCostSplit(cycle) {
  if (!cycle) return '';
  const parts = [
    ['Seed', cycle.seedTotalCostInr],
    ['Fertilizer', sumCost(cycle.fertilizersUsed, 'costInr')],
    ['Pesticide', sumCost(cycle.pesticidesUsed, 'costInr')],
    ['Labour', cycle.laborCostInr],
    ['Machinery', cycle.machineryCostInr],
    ['Other', cycle.otherCostInr],
  ];
  return parts
    .filter(([, v]) => Number(v) > 0)
    .map(([label, v]) => `${label} ${fmtInr(v)}`)
    .join(', ');
}

/** Multi-line per-cycle block (seed, sowing, irrigation, events, water). */
export function buildFarmHistory(cycle, farm) {
  if (!cycle) return '';
  const lines = [];

  const seedBits = [cycle.seedName, cycle.seedBrand, cycle.seedSource].filter(Boolean).join(', ');
  if (seedBits) lines.push(`- Seed: ${seedBits}${cycle.isHybrid ? ' (hybrid)' : ''}${cycle.isOrganic ? ' (organic)' : ''}`);

  const sowing = fmtDate(cycle.sowingDate);
  const season = cycle.seasonLabel || [cycle.season, cycle.year].filter(Boolean).join(' ');
  if (sowing || season) lines.push(`- Sown: ${sowing || 'unknown'}${season ? ` (${season})` : ''}`);

  const irr = summarizeIrrigation(cycle.irrigationLogs);
  if (irr) lines.push(`- Irrigation log: ${irr}`);

  const events = summarizeEvents(cycle.observedEvents);
  if (events) lines.push(`- Observed pest/disease/weather events: ${events}`);

  const cost = summarizeCostSplit(cycle);
  if (cost) lines.push(`- Cost so far: ${cost}`);

  if (farm?.waterSources?.length) lines.push(`- Water sources: ${farm.waterSources.join(', ')}`);

  return lines.join('\n');
}

/**
 * Deduped list of pests/diseases/weather events this farm has hit, across the
 * given cycles — drawn from observedEvents.type and pesticidesUsed.target.
 * Case-insensitive dedupe, original casing preserved. Capped at 8.
 */
export function buildPriorIssues(cycles) {
  const seen = new Set();
  const out = [];
  const add = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  for (const c of arr(cycles)) {
    for (const e of arr(c?.observedEvents)) add(e?.type);
    for (const p of arr(c?.pesticidesUsed)) add(p?.targetPestOrDisease);
  }
  return out.slice(0, 8);
}

/**
 * Multi-year trend aggregate from completed cycles. Input may be in any order;
 * we sort oldest→newest by sowingDate (fallback: as given). Each trend entry
 * is { label, value } so the prompt/UI can show a series.
 */
export function buildHistory(completedCycles) {
  const cycles = arr(completedCycles).slice();
  cycles.sort((a, b) => new Date(a?.sowingDate || 0) - new Date(b?.sowingDate || 0));
  const label = (c) => c?.seasonLabel || [c?.season, c?.year].filter(Boolean).join(' ') || c?.cropName || '';
  const num = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));

  return {
    yieldTrend: cycles.map((c) => ({ label: label(c), value: num(c?.harvestYieldQuintal) })).filter((x) => x.value != null),
    profitTrend: cycles.map((c) => ({ label: label(c), value: num(c?.netProfitInr) })).filter((x) => x.value != null),
    inputCostTrend: cycles.map((c) => ({ label: label(c), value: num(c?.totalInputCostInr) })).filter((x) => x.value != null),
    priorIssues: buildPriorIssues(cycles),
  };
}
