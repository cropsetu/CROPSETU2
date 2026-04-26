#!/usr/bin/env node
/**
 * seedMandiData.js — Bulk pre-seed mandi price DB from data.gov.in
 *
 * Run once (or periodically) to populate mandi_prices for all major
 * commodity + state combinations, so the app works with 96%+ coverage
 * even with the 10-record demo API key.
 *
 * Usage:
 *   node scripts/seedMandiData.js            # seed all (slow, ~15 min)
 *   node scripts/seedMandiData.js --quick    # top 5 crops × 10 states only
 *   node scripts/seedMandiData.js --state Maharashtra --crop Onion
 *
 * The script calls FastAPI /agripredict/sync/trigger which runs in background.
 * Use --wait to poll until each sync completes before moving on.
 *
 * Requirements:
 *   - Node.js + fetch (Node ≥18)
 *   - FastAPI (CropGuard AI) must be running on port 8001
 *   - DATA_GOV_API_KEY set in .env
 */
import 'dotenv/config';
import { setTimeout as sleep } from 'timers/promises';

const AI_BASE  = process.env.AI_BACKEND_URL || 'http://localhost:8001';
const DELAY_MS = 2_000;   // polite gap between trigger calls (2 s)
const MAX_PAGES = 10;     // 10 pages × 1000 records = up to 10 000 records per combo

// ── Top agricultural commodities ──────────────────────────────────────────────
const ALL_CROPS = [
  'Tomato', 'Onion', 'Potato', 'Wheat', 'Rice',
  'Maize', 'Gram', 'Arhar/Tur', 'Soyabean', 'Cotton',
  'Groundnut', 'Mustard', 'Sunflower Seed', 'Bajra', 'Jowar',
  'Sugarcane', 'Brinjal', 'Cauliflower', 'Cabbage', 'Green Chilli',
];

const QUICK_CROPS = ['Tomato', 'Onion', 'Potato', 'Wheat', 'Soyabean'];

// ── 20 major agricultural states ─────────────────────────────────────────────
const ALL_STATES = [
  'Maharashtra', 'Punjab', 'Madhya Pradesh', 'Uttar Pradesh', 'Karnataka',
  'Andhra Pradesh', 'Rajasthan', 'Gujarat', 'Telangana', 'Tamil Nadu',
  'Bihar', 'West Bengal', 'Haryana', 'Odisha', 'Chhattisgarh',
  'Assam', 'Jharkhand', 'Kerala', 'Uttarakhand', 'Himachal Pradesh',
];

const QUICK_STATES = [
  'Maharashtra', 'Punjab', 'Madhya Pradesh', 'Uttar Pradesh',
  'Karnataka', 'Rajasthan', 'Gujarat', 'Andhra Pradesh', 'Telangana', 'Bihar',
];

// ── Arg parsing ───────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const quick  = args.includes('--quick');
const wait   = args.includes('--wait');
const si     = args.indexOf('--state');
const ci     = args.indexOf('--crop');
const onlyState = si >= 0 ? args[si + 1] : null;
const onlyCrop  = ci >= 0 ? args[ci + 1] : null;

const crops  = onlyCrop  ? [onlyCrop]  : (quick ? QUICK_CROPS  : ALL_CROPS);
const states = onlyState ? [onlyState] : (quick ? QUICK_STATES : ALL_STATES);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function triggerSync(commodity, state, maxPages = MAX_PAGES) {
  const resp = await fetch(`${AI_BASE}/agripredict/sync/trigger`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ commodity, state, district: null, max_pages: maxPages }),
  });
  if (resp.status === 202 || resp.status === 200) return true;
  const body = await resp.text().catch(() => '');
  console.warn(`  ⚠  ${commodity}/${state} → HTTP ${resp.status}: ${body.slice(0, 80)}`);
  return false;
}

async function waitForSync(commodity, state, timeoutS = 120) {
  const deadline = Date.now() + timeoutS * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    try {
      const resp = await fetch(
        `${AI_BASE}/agripredict/sync/status?commodity=${encodeURIComponent(commodity)}&state=${encodeURIComponent(state)}`,
      );
      const body = await resp.json();
      const status = body?.data?.status;
      if (status === 'completed') return true;
      if (status === 'failed')    return false;
    } catch {
      // FastAPI may be busy — keep waiting
    }
  }
  return false; // timeout
}

// ── Health check ──────────────────────────────────────────────────────────────
async function checkFastAPI() {
  try {
    const r = await fetch(`${AI_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const total    = crops.length * states.length;
let   done     = 0;
let   success  = 0;
let   skipped  = 0;

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║          FarmEasy — Mandi Data Bulk Seed                 ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`  Mode    : ${quick ? 'Quick' : 'Full'} (${crops.length} crops × ${states.length} states = ${total} combos)`);
console.log(`  FastAPI : ${AI_BASE}`);
console.log(`  Wait    : ${wait ? 'yes (slower, more reliable)' : 'no (fire-and-forget)'}`);
console.log('');

const healthy = await checkFastAPI();
if (!healthy) {
  console.error('✗ FastAPI service is not reachable at', AI_BASE);
  console.error('  Start it first:');
  console.error('    cd AI_CROP_DISESE_DETECTION');
  console.error('    .venv/bin/uvicorn main:app --port 8001 --reload');
  process.exit(1);
}
console.log('✓ FastAPI is running\n');

for (const state of states) {
  for (const crop of crops) {
    done++;
    const pct = Math.round((done / total) * 100);
    process.stdout.write(`  [${String(pct).padStart(3)}%] ${crop.padEnd(20)} ${state.padEnd(22)}  `);

    const ok = await triggerSync(crop, state);
    if (!ok) { console.log('SKIP'); skipped++; await sleep(DELAY_MS); continue; }

    if (wait) {
      const finished = await waitForSync(crop, state);
      console.log(finished ? 'OK  (waited)' : 'TIMEOUT');
      if (finished) success++;
    } else {
      console.log('queued');
      success++;
    }

    await sleep(DELAY_MS);
  }
}

console.log('');
console.log('─────────────────────────────────────────────────');
console.log(`  Triggered : ${success}`);
console.log(`  Skipped   : ${skipped}`);
console.log(`  Total     : ${total}`);
if (!wait) {
  console.log('');
  console.log('  Syncs are running in FastAPI background workers.');
  console.log('  Check progress: GET /api/v1/agripredict/sync/status');
  console.log('  Data will be available in DB within ~15 minutes.');
}
console.log('');
