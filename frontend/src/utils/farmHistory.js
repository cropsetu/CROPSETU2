/**
 * farmHistory.js — turn a MyFarm crop-cycle's structured logs into compact,
 * human-readable strings for the AI crop-scan pipeline.
 *
 * The FastAPI pipeline consumes free-form text for `fertilizer_history`,
 * `recent_pesticide_used`, and a new `farm_history` block (irrigation schedule
 * + seed + observed pest/disease events). Entry shapes mirror what
 * backend/src/services/cropCycle.service.js writes into the JSON columns.
 *
 * All functions are defensive: any missing/empty input yields '' so a scan
 * with sparse logs never breaks. We cap each list to the most recent few
 * entries to keep the LLM prompt small.
 */

const MAX_ENTRIES = 6;

// ISO date -> "20 Jun" (silently degrades to '' on bad input).
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function recent(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(-MAX_ENTRIES);
}

/** "Urea 50kg (Vegetative, 20 Jun); DAP 25kg (1 Jul)" */
export function summarizeFertilizers(arr) {
  return recent(arr)
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
export function summarizePesticides(arr) {
  return recent(arr)
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
export function summarizeIrrigation(arr) {
  return recent(arr)
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
export function summarizeEvents(arr) {
  return recent(arr)
    .map((e) => {
      const type = e?.type || 'event';
      const sev = e?.severity ? `, ${e.severity}` : '';
      const date = fmtDate(e?.date);
      return `${type}${sev}` + (date ? ` (${date})` : '');
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * Build the multi-line `farm_history` block: the parts of the cycle that have
 * no dedicated AI param (seed, irrigation schedule, observed events, timeline).
 * Fertilizer + pesticide go into their own params via the summarize* helpers.
 * Returns '' when there's nothing useful to report.
 */
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

  if (farm?.waterSources?.length) lines.push(`- Water sources: ${farm.waterSources.join(', ')}`);

  return lines.join('\n');
}

const sumCost = (a, key) => (Array.isArray(a) ? a : []).reduce((s, x) => s + (Number(x?.[key]) || 0), 0);

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
    .map(([label, v]) => `${label} ₹${Math.round(Number(v))}`)
    .join(', ');
}

/**
 * Deduped pests/diseases/weather events across cycles (observedEvents.type +
 * pesticidesUsed.target). Powers the "What FarmMind knows about my farm"
 * preview. Case-insensitive dedupe, original casing kept, capped at 8.
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
  for (const c of (Array.isArray(cycles) ? cycles : [])) {
    for (const e of (Array.isArray(c?.observedEvents) ? c.observedEvents : [])) add(e?.type);
    for (const p of (Array.isArray(c?.pesticidesUsed) ? c.pesticidesUsed : [])) add(p?.targetPestOrDisease);
  }
  return out.slice(0, 8);
}
