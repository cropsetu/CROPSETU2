/**
 * Mandi Price Service — data.gov.in integration
 *
 * Primary: data.gov.in /resource/current-daily-price-various-commodities-various-centres
 * Fallback: Serve latest cached records from DB with stale timestamp warning
 *
 * Cache strategy:
 *   - DB cache for 4 hours (expiresAt field)
 *   - L1 in-memory for 30 min per commodity+state query
 *
 * NEVER show fabricated prices. If both live and cache are unavailable,
 * return an error. Always show source + timestamp.
 *
 * data.gov.in API key (free, 1000 req/day):
 *   Set DATA_GOV_API_KEY in .env
 *   Get at: https://data.gov.in
 */
import axios from 'axios';
import prisma from '../config/db.js';
import { ENV } from '../config/env.js';
import { sanitizeSearch } from '../utils/sanitizeSearch.js';
import logger from '../utils/logger.js';

const DATA_GOV_BASE     = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';
const CACHE_TTL_MS      = 4 * 60 * 60 * 1000;  // 4 hours
const MEM_TTL_MS        = 30 * 60 * 1000;        // 30 min
const MAX_MEM_ENTRIES   = 200;

// ── L1: in-memory ─────────────────────────────────────────────────────────────
const _mem = new Map();
function memGet(k) {
  const e = _mem.get(k);
  if (!e || Date.now() > e.exp) { _mem.delete(k); return null; }
  return e.data;
}
function memSet(k, data) {
  if (_mem.size >= MAX_MEM_ENTRIES) { const first = _mem.keys().next().value; _mem.delete(first); }
  _mem.set(k, { data, exp: Date.now() + MEM_TTL_MS });
}

// ── State name normaliser (data.gov.in uses slightly different spellings) ─────
const STATE_NAME_MAP = {
  'Jammu and Kashmir':                        'Jammu And Kashmir',
  'Dadra and Nagar Haveli and Daman and Diu': 'Dadra And Nagar Haveli And Daman And Diu',
  'Andaman and Nicobar Islands':              'Andaman And Nicobar',
};
// UTs/states with no agricultural mandi data on data.gov.in
const NO_MANDI_STATES = new Set([
  'Ladakh', 'Lakshadweep',
  'Andaman and Nicobar Islands',
  'Dadra and Nagar Haveli and Daman and Diu',
]);
function normaliseState(s) { return STATE_NAME_MAP[s] || s; }

// ── Commodity name normaliser (API uses different names) ─────────────────────
const COMMODITY_MAP = {
  soybean: 'Soyabean',     soybeans: 'Soyabean',
  tomato: 'Tomato',        onion: 'Onion',
  cotton: 'Cotton',        wheat: 'Wheat',
  maize: 'Maize',          rice: 'Rice',
  gram: 'Gram',            tur: 'Arhar/Tur',
  arhar: 'Arhar/Tur',      groundnut: 'Groundnut',
  sugarcane: 'Sugarcane',  potato: 'Potato',
  bajra: 'Bajra',          jowar: 'Jowar',
  sunflower: 'Sunflower Seed',
};
function normaliseCommodity(name) {
  return COMMODITY_MAP[name?.toLowerCase()] || name;
}

// ── Log API health ────────────────────────────────────────────────────────────
async function logHealth(status, endpoint, responseTimeMs, errorMessage = null, payloadSizeBytes = null) {
  await prisma.aPIHealthLog.create({
    data: { source: 'data_gov_in', endpoint, status, responseTimeMs, payloadSizeBytes, errorMessage },
  }).catch(e => console.warn('[MandiPrice] Health log write failed: %s', e.message));
}

// ── Parse data.gov.in's DD/MM/YYYY arrival_date ──────────────────────────────
// data.gov.in returns dates in Indian format "01/06/2026" (1 June 2026).
// JS's `new Date("01/06/2026")` interprets it as Jan 6 (American MM/DD/YYYY)
// — wrong by months. Parse the parts explicitly.
function parseArrivalDate(raw) {
  if (!raw) return new Date();
  // Common formats: "DD/MM/YYYY", "DD-MM-YYYY", or already-ISO "YYYY-MM-DD".
  const ddmm = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
  const m = String(raw).match(ddmm);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  }
  // Fallback: trust the input (ISO format or already-parsed Date).
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date() : d;
}

// ── Fetch one page from data.gov.in ──────────────────────────────────────────
async function _fetchPage(commodity, state, offset = 0) {
  if (!ENV.DATA_GOV_API_KEY) throw new Error('DATA_GOV_API_KEY not configured');
  const apiCommodity = normaliseCommodity(commodity);
  const t0 = Date.now();
  const response = await axios.get(DATA_GOV_BASE, {
    params: {
      'api-key':            ENV.DATA_GOV_API_KEY,
      format:               'json',
      limit:                500,   // max per call (registered key); demo key caps at 10
      offset,
      'filters[commodity]': apiCommodity,
      'filters[state]':     normaliseState(state),   // API is case-sensitive — lowercase 's'
    },
    timeout: 12000,
    headers: { 'User-Agent': 'FarmEasy/1.0 (farmeasy.app)' },
  });
  const elapsed = Date.now() - t0;
  await logHealth('success', DATA_GOV_BASE, elapsed, null,
    JSON.stringify(response.data).length).catch(() => {});
  return (response.data?.records || []).map(r => ({
    commodity:   r.commodity   || apiCommodity,
    commodityHi: null,
    variety:     r.variety     || null,
    market:      r.market      || r.Market    || '',
    district:    r.district    || r.District  || '',
    state:       r.state       || r.State     || state,
    minPrice:    parseFloat(r.min_price   || r.MinPrice   || 0),
    maxPrice:    parseFloat(r.max_price   || r.MaxPrice   || 0),
    modalPrice:  parseFloat(r.modal_price || r.ModalPrice || 0),
    arrivalQty:  parseFloat(r.arrival_qty || r.ArrivalQty || 0) || null,
    priceDate:   parseArrivalDate(r.arrival_date),
    source:      'data.gov.in',
    fetchedAt:   new Date(),
    expiresAt:   new Date(Date.now() + CACHE_TTL_MS),
  }));
}

// ── Paginate through ALL state-level records (up to MAX_PAGES pages) ──────────
const MAX_PAGES     = 10;
const PAGE_SIZE     = 500;

async function fetchFromDataGovIn(commodity, state) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await _fetchPage(commodity, state, page * PAGE_SIZE);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;   // last page — no more records
  }
  return all;
}

// ── Persist to DB ───────────────────────────────────────────────────────────
// Chunked, deduplicated, set-based.
//
// The previous implementation was `prisma.mandiPrice.upsert({ where: { id:
// 'dummy-will-not-match' } })` in an awaited loop. A Prisma upsert whose `where`
// matches nothing CREATES the row rather than throwing, so:
//   - the `.catch()` below it, which held the only real dedup logic, had never
//     run a single time;
//   - every sync re-INSERTED the whole fetched state list as new rows into a
//     table with no unique constraint. One state fetch is up to 10 pages x 500
//     records, and the same (commodity, market, priceDate) came back on every
//     refresh, so the table grew by hundreds of copies of the same day's prices;
//   - it did so one awaited round trip at a time, holding a pool connection per
//     record, fire-and-forget AFTER the response had already been sent.
//
// `skipDuplicates` emits ON CONFLICT DO NOTHING, which is satisfied by the
// unique index created in prisma/manual/mandi_prices_dedup.sql. THAT MIGRATION
// MUST BE APPLIED FIRST — without the index there is no conflict to skip and
// duplicates simply return, though nothing breaks.
const PERSIST_CHUNK = 500;

// Exported for tests: the in-batch dedup below is the half of the fix that no
// database can verify for us (the unique index covers the cross-batch half).
export async function persistToDB(records) {
  if (!Array.isArray(records) || !records.length) return;

  // De-duplicate WITHIN the batch first. data.gov.in returns the same mandi more
  // than once in a single response often enough to matter.
  //
  // NOT because it would error: ON CONFLICT DO NOTHING tolerates repeats inside
  // one INSERT (only DO UPDATE raises "cannot affect row a second time"). It is
  // because SOMETHING has to choose which copy wins, and letting Postgres pick
  // arbitrarily would make the stored price depend on feed ordering. Choosing
  // here — freshest by fetchedAt, the same rule the dedup migration uses — keeps
  // the two halves of this fix in agreement, shrinks what goes on the wire, and
  // makes the paired UPDATE below deterministic.
  const byKey = new Map();
  for (const r of records) {
    const key = [r.commodity, r.variety || '', r.market, r.district, r.state,
                 r.priceDate instanceof Date ? r.priceDate.toISOString() : String(r.priceDate)].join('|');
    const prev = byKey.get(key);
    // Keep the freshest, matching the migration's tie-break.
    if (!prev || (r.fetchedAt ?? 0) >= (prev.fetchedAt ?? 0)) byKey.set(key, r);
  }
  const unique = [...byKey.values()];

  for (let i = 0; i < unique.length; i += PERSIST_CHUNK) {
    const chunk = unique.slice(i, i + PERSIST_CHUNK);
    try {
      await prisma.mandiPrice.createMany({ data: chunk, skipDuplicates: true });
      await updateRevisedPrices(chunk);
    } catch (e) {
      logger.warn('[MandiPrice] persist chunk failed (%d rows): %s', chunk.length, e.message);
    }
  }
}

/**
 * Apply data.gov.in's REVISIONS to rows we already hold.
 *
 * `skipDuplicates` alone would make the first fetch of a day permanent: the feed
 * revises a day's modal/min/max as more arrivals are reported, and without this
 * the 06:00 numbers would still be on screen at 18:00. The old duplicate-inserting
 * code got this right by accident — each revision arrived as a NEW row and the
 * read path sorts newest-first — so dropping it silently would trade a storage
 * bug for a correctness one, on the screen farmers use to decide when to sell.
 *
 * One set-based UPDATE per chunk, joined on the natural key. It matches the
 * unique index's COALESCE treatment of `variety` so both halves agree, and it is
 * independent of that index existing — this still works before the migration is
 * applied.
 *
 * The inequality predicate keeps it cheap: mandi_prices carries SEVEN indexes
 * (five @@index, the primary key, and the natural-key unique the dedup migration
 * adds), so every rewritten row costs seven index updates. Touching unchanged
 * rows on every sync would be pure write amplification.
 */
async function updateRevisedPrices(rows) {
  if (!rows.length) return;
  await prisma.$executeRaw`
    UPDATE mandi_prices m
       SET "minPrice"   = v.min_price,
           "maxPrice"   = v.max_price,
           "modalPrice" = v.modal_price,
           "arrivalQty" = v.arrival_qty,
           "fetchedAt"  = v.fetched_at,
           "expiresAt"  = v.expires_at
      FROM (
        SELECT * FROM unnest(
          ${rows.map((r) => r.commodity)}::text[],
          ${rows.map((r) => r.variety ?? '')}::text[],
          ${rows.map((r) => r.market)}::text[],
          ${rows.map((r) => r.district)}::text[],
          ${rows.map((r) => r.state)}::text[],
          ${rows.map((r) => r.priceDate)}::timestamptz[],
          ${rows.map((r) => Number(r.minPrice) || 0)}::numeric[],
          ${rows.map((r) => Number(r.maxPrice) || 0)}::numeric[],
          ${rows.map((r) => Number(r.modalPrice) || 0)}::numeric[],
          ${rows.map((r) => (r.arrivalQty == null ? null : Number(r.arrivalQty)))}::double precision[],
          ${rows.map((r) => r.fetchedAt)}::timestamptz[],
          ${rows.map((r) => r.expiresAt)}::timestamptz[]
        ) AS t(commodity, variety, market, district, state, price_date,
               min_price, max_price, modal_price, arrival_qty, fetched_at, expires_at)
      ) v
     WHERE m.commodity = v.commodity
       AND COALESCE(m.variety, '') = v.variety
       AND m.market = v.market
       AND m.district = v.district
       AND m.state = v.state
       AND m."priceDate" = v.price_date
       AND (m."modalPrice" IS DISTINCT FROM v.modal_price
         OR m."minPrice"   IS DISTINCT FROM v.min_price
         OR m."maxPrice"   IS DISTINCT FROM v.max_price)
  `;
}

// ── DB lookup helper ──────────────────────────────────────────────────────────
async function queryDB(commodity, state, district, withinDays = 90) {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  // Strip LIKE wildcards from every value before it reaches a `contains` filter
  // so a crafted commodity/state/district can't force a pathological ILIKE scan.
  const safeCommodity = sanitizeSearch(normaliseCommodity(commodity)) || '';
  const safeState     = sanitizeSearch(state) || '';
  const safeDistrict  = sanitizeSearch(district);
  const where = {
    commodity: { contains: safeCommodity, mode: 'insensitive' },
    state:     { contains: safeState, mode: 'insensitive' },
    priceDate: { gte: since },
  };
  if (safeDistrict) where.district = { contains: safeDistrict, mode: 'insensitive' };
  const rows = await prisma.mandiPrice.findMany({
    where, orderBy: { priceDate: 'desc' }, take: 300,
  });
  // District query returned too few. The first query already pushed the
  // district filter into SQL (`district contains`), so `rows` IS the
  // district-matching subset — no need to re-fetch the whole state and filter
  // it in memory. If that subset is still usable, return it directly;
  // otherwise broaden to state level (dropping the district where-clause) and
  // let the DB return only those rows.
  if (rows.length < 5 && district) {
    if (rows.length >= 3) return rows;
    delete where.district;
    return prisma.mandiPrice.findMany({
      where, orderBy: { priceDate: 'desc' }, take: 300,
    });
  }
  return rows;
}

// ── Merge today's live rows with last-7-day DB rows ──────────────────────────
// Small mandis report weekly, not daily, so today's data.gov.in response
// usually misses them. Surface them by merging with DB rows from the past
// week. Dedupe by (market name + district) — same physical mandi may appear
// in both sets — and keep the freshest priceDate per mandi. Sort newest
// reports first, then by highest modal price.
function mergeAndDedupe(todays, historical) {
  const byMandi = new Map();
  const keyOf = r => `${(r.market || '').toLowerCase().trim()}|${(r.district || '').toLowerCase().trim()}`;
  for (const r of [...todays, ...historical]) {
    if (!r?.market) continue;
    const k = keyOf(r);
    const existing = byMandi.get(k);
    if (!existing || new Date(r.priceDate) > new Date(existing.priceDate)) {
      byMandi.set(k, r);
    }
  }
  return [...byMandi.values()].sort((a, b) => {
    const dt = new Date(b.priceDate) - new Date(a.priceDate);
    if (dt !== 0) return dt;
    return (b.modalPrice || 0) - (a.modalPrice || 0);
  });
}

// ── Main: get prices ───────────────────────────────────────────────────────────
// Strategy:
//   1. DB cache check — but only trust it if we have ENOUGH records (≥8 for
//      district queries). A handful of seeded records shouldn't block a live call.
//   2. Live API — ALWAYS fetches at STATE level (no district filter) so we get
//      ALL mandis in the state in one call. We then filter by district in memory
//      and persist everything to DB so future district queries are fast.
//   3. Stale DB fallback — up to 90 days old.
// ─────────────────────────────────────────────────────────────────────────────
export async function getMandiPrices(commodity, state, district = null) {
  if (NO_MANDI_STATES.has(state)) {
    return { data: [], stale: false, source: 'unavailable' };
  }

  const key = `${commodity.toLowerCase()}|${state.toLowerCase()}|${district || ''}`;
  const cached = memGet(key);
  if (cached) return { data: cached, stale: false, source: 'cache' };

  // How many records we need before trusting the DB cache
  const MIN_FRESH = district ? 8 : 3;

  // ── 1. DB cache ──────────────────────────────────────────────────────────────
  const freshRows = await queryDB(commodity, state, district, 1).catch(() => []);
  if (freshRows.length >= MIN_FRESH) {
    memSet(key, freshRows);
    return { data: freshRows, stale: false, source: 'db-cache',
      cachedAt: freshRows[0].fetchedAt?.toISOString() };
  }

  // ── 2. Live data.gov.in — fetch full state, filter by district in memory ─────
  if (ENV.DATA_GOV_API_KEY) {
    try {
      // Always fetch at STATE level — one call covers every district
      const allState = await fetchFromDataGovIn(commodity, state);

      if (allState.length > 0) {
        // Persist everything (all districts) so future requests hit DB cache
        persistToDB(allState).catch(() => {});

        // Filter to the requested district (if any)
        const result = district
          ? allState.filter(r =>
              r.district?.toLowerCase().includes(district.toLowerCase())
            )
          : allState;

        // If district filter gave nothing fall back to full state list
        const todaysRows = (result.length > 0) ? result : allState;

        // ── Merge with last 7 days from DB to surface small mandis that
        //    report weekly (not daily). Dedupe by market name, keeping the
        //    freshest row per mandi. data.gov.in's "Current Daily Price"
        //    only contains today's submissions; small mandis disappear from
        //    it on the days they don't report. The DB has been silently
        //    accumulating historical rows via persistToDB on every fetch.
        const historicalRows = await queryDB(commodity, state, district, 7).catch(() => []);
        const data = mergeAndDedupe(todaysRows, historicalRows);

        memSet(key, data);
        return { data, stale: false, source: 'data.gov.in+db-7d',
          fetchedAt: new Date().toISOString(),
          total: data.length,
          districtFiltered: district ? result.length : null };
      }
    } catch (err) {
      const status = err.response?.status === 429
        ? 'rate_limited'
        : (err.code === 'ECONNABORTED' ? 'timeout' : 'failure');
      await logHealth(status, DATA_GOV_BASE, null,
        err.message?.slice(0, 200)).catch(() => {});
      console.warn('[MandiPrice] data.gov.in failed:', err.message);
    }
  } else {
    console.warn('[MandiPrice] DATA_GOV_API_KEY not set — serving from DB only');
  }

  // ── 3. Stale DB fallback ─────────────────────────────────────────────────────
  const staleRows = await queryDB(commodity, state, district, 90).catch(() => []);
  if (staleRows.length > 0) {
    memSet(key, staleRows);
    return { data: staleRows, stale: true, source: 'db-seeded',
      cachedAt: staleRows[0].fetchedAt?.toISOString() };
  }

  return { data: [], stale: false, source: 'unavailable' };
}

// ── Price trend (7/30 days) for a commodity+market ────────────────────────────
export async function getPriceTrend(commodity, market, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Strip LIKE wildcards before the values reach a `contains` filter (ReDoS-style
  // ILIKE DoS guard) — defense-in-depth even though callers also sanitize.
  const safeCommodity = sanitizeSearch(normaliseCommodity(commodity)) || '';
  const safeMarket    = sanitizeSearch(market) || '';
  // Bounded, and ordered NEWEST-FIRST to make the bound safe.
  //
  // `market` is a `contains` match, so it does not narrow to one market the way
  // the endpoint's contract implies — `?market=a` matches nearly every market
  // name in the country. Measured on an Agmarknet-shaped dataset (400 markets
  // reporting one commodity daily for a year): 146,000 rows, a 15.2 MB
  // response, and then 146,000 Decimals summed on the event loop for the stats.
  //
  // The cap is applied to a DESCENDING scan and reversed afterwards, which is
  // the part that matters. Capping an ascending scan would drop the NEWEST
  // rows — the ones "current price" and the 7-day average are computed from —
  // so a truncated window would quietly report last year's price as today's.
  // Dropping the oldest instead just shortens the chart.
  const take = Math.min(days * MAX_ROWS_PER_DAY, TREND_MAX_ROWS);
  const records = await prisma.mandiPrice.findMany({
    where: {
      commodity: { contains: safeCommodity, mode: 'insensitive' },
      market:    { contains: safeMarket, mode: 'insensitive' },
      priceDate: { gte: since },
    },
    orderBy: [{ priceDate: 'desc' }],
    take,
    select:  { priceDate: true, modalPrice: true, minPrice: true, maxPrice: true, arrivalQty: true },
  });
  records.reverse(); // chart wants oldest-first
  return records;
}

// One market reports one price per commodity per day, so a legitimate series is
// one row per day. The multiplier leaves room for the several varieties a market
// can report for the same commodity on the same day, and the ceiling stops a
// 365-day request from being large even when the `contains` match is wide.
const MAX_ROWS_PER_DAY = 4;
const TREND_MAX_ROWS   = 1000;
export const TREND_ROW_CAP = TREND_MAX_ROWS;

// ── District → APMC mandi names (used by /nearby endpoint) ──────────────────
// Covers all major agricultural districts across India (data.gov.in market names)
const DISTRICT_MANDIS = {
  // ── Maharashtra ──
  'pune':         ['Pune', 'Pimpri', 'Shirur', 'Junnar', 'Baramati', 'Indapur', 'Khed', 'Manchar', 'Talegaon Dabhade'],
  'nashik':       ['Nashik', 'Lasalgaon', 'Igatpuri', 'Yeola', 'Manmad', 'Nandgaon', 'Sinnar', 'Kalwan', 'Chandwad'],
  'ahmednagar':   ['Ahmednagar', 'Shrirampur', 'Rahata', 'Sangamner', 'Nevasa', 'Kopargaon', 'Shevgaon', 'Pathardi', 'Parner', 'Akole', 'Jamkhed', 'Karjat', 'Nagar'],
  'aurangabad':   ['Aurangabad', 'Gangapur', 'Paithan', 'Vaijapur', 'Sillod', 'Kannad', 'Phulambri', 'Soegaon'],
  'latur':        ['Latur', 'Udgir', 'Nilanga', 'Ausa', 'Chakur', 'Deoni', 'Renapur', 'Ahmedpur'],
  'solapur':      ['Solapur', 'Pandharpur', 'Barshi', 'Mohol', 'Mangalvedha', 'Karmala', 'Madha', 'Malshiras'],
  'kolhapur':     ['Kolhapur', 'Ichalkaranji', 'Sangli', 'Miraj', 'Kagal', 'Hatkanangale', 'Gadhinglaj', 'Radhanagari'],
  'jalgaon':      ['Jalgaon', 'Bhusawal', 'Pachora', 'Amalner', 'Jamner', 'Muktainagar', 'Chalisgaon', 'Yawal', 'Erandol'],
  'amravati':     ['Amravati', 'Akola', 'Washim', 'Daryapur', 'Anjangaon', 'Achalpur', 'Chandur Bazar', 'Morshi'],
  'nagpur':       ['Nagpur', 'Wardha', 'Yavatmal', 'Kamptee', 'Hingna', 'Katol', 'Savner', 'Narkhed', 'Ramtek'],
  'satara':       ['Satara', 'Karad', 'Wai', 'Phaltan', 'Koregaon', 'Khatav', 'Mahabaleshwar'],
  'sangli':       ['Sangli', 'Miraj', 'Islampur', 'Vita', 'Tasgaon', 'Palus', 'Kavthe Mahankal'],
  'osmanabad':    ['Osmanabad', 'Tuljapur', 'Omerga', 'Paranda', 'Kallam', 'Washi'],
  'nanded':       ['Nanded', 'Bhokar', 'Deglur', 'Hadgaon', 'Kinwat', 'Loha', 'Mukhed'],
  'beed':         ['Beed', 'Ambejogai', 'Parli', 'Kaij', 'Georai', 'Ashti', 'Patoda'],
  'parbhani':     ['Parbhani', 'Pathri', 'Gangakhed', 'Manwath', 'Jintur', 'Selu'],
  'hingoli':      ['Hingoli', 'Basmath', 'Kalamnuri', 'Sengaon'],
  'buldhana':     ['Buldhana', 'Khamgaon', 'Malkapur', 'Mehkar', 'Shegaon', 'Chikhli', 'Nandura'],
  'dhule':        ['Dhule', 'Shirpur', 'Sakri', 'Sindkheda'],
  'nandurbar':    ['Nandurbar', 'Shahada', 'Taloda', 'Nawapur'],
  'ratnagiri':    ['Ratnagiri', 'Chiplun', 'Khed', 'Sangameshwar', 'Dapoli'],
  'raigad':       ['Alibag', 'Panvel', 'Pen', 'Mahad', 'Roha'],
  'thane':        ['Thane', 'Bhiwandi', 'Kalyan', 'Wada'],

  // ── Punjab ──
  'ludhiana':     ['Ludhiana', 'Khanna', 'Jagraon', 'Raikot', 'Samrala', 'Machhiwara'],
  'amritsar':     ['Amritsar', 'Tarn Taran', 'Patti', 'Ajnala'],
  'jalandhar':    ['Jalandhar', 'Nakodar', 'Shahkot', 'Phillaur'],
  'patiala':      ['Patiala', 'Rajpura', 'Nabha', 'Sangrur', 'Fatehgarh Sahib'],
  'bathinda':     ['Bathinda', 'Mansa', 'Rampura Phul', 'Goniana', 'Sardulgarh'],
  'sangrur':      ['Sangrur', 'Sunam', 'Dirba', 'Malerkotla', 'Dhuri'],
  'moga':         ['Moga', 'Nihal Singh Wala', 'Baghapurana', 'Dharamkot'],
  'ferozepur':    ['Ferozepur', 'Zira', 'Fazilka', 'Jalalabad', 'Guru Har Sahai'],
  'hoshiarpur':   ['Hoshiarpur', 'Garhshankar', 'Dasuya', 'Mukerian'],
  'gurdaspur':    ['Gurdaspur', 'Batala', 'Pathankot', 'Dera Baba Nanak'],

  // ── Uttar Pradesh ──
  'lucknow':      ['Lucknow', 'Barabanki', 'Unnao', 'Hardoi'],
  'agra':         ['Agra', 'Firozabad', 'Mainpuri', 'Etawah', 'Mathura'],
  'mathura':      ['Mathura', 'Vrindavan', 'Baldeo', 'Mat'],
  'varanasi':     ['Varanasi', 'Mirzapur', 'Jaunpur', 'Bhadohi', 'Ghazipur'],
  'meerut':       ['Meerut', 'Hapur', 'Ghaziabad', 'Bulandshahr', 'Baghpat'],
  'kanpur':       ['Kanpur', 'Kanpur Dehat', 'Farrukhabad', 'Etawah'],
  'allahabad':    ['Prayagraj', 'Kaushambi', 'Pratapgarh', 'Fatehpur'],
  'bareilly':     ['Bareilly', 'Pilibhit', 'Shahjahanpur', 'Budaun'],
  'muzaffarnagar':['Muzaffarnagar', 'Shamli', 'Saharanpur', 'Bijnor'],
  'gorakhpur':    ['Gorakhpur', 'Deoria', 'Kushinagar', 'Maharajganj'],
  'moradabad':    ['Moradabad', 'Rampur', 'Amroha', 'Sambhal'],

  // ── Madhya Pradesh ──
  'indore':       ['Indore', 'Mhow', 'Dewas', 'Rau', 'Sanwer', 'Pithampur'],
  'bhopal':       ['Bhopal', 'Sehore', 'Vidisha', 'Berasia', 'Ashta'],
  'ujjain':       ['Ujjain', 'Ratlam', 'Nagda', 'Shajapur', 'Agar', 'Badnagar'],
  'jabalpur':     ['Jabalpur', 'Katni', 'Narsinghpur', 'Mandla', 'Seoni'],
  'gwalior':      ['Gwalior', 'Bhind', 'Morena', 'Datia', 'Shivpuri'],
  'sagar':        ['Sagar', 'Damoh', 'Tikamgarh', 'Chhatarpur', 'Panna'],
  'hoshangabad':  ['Hoshangabad', 'Harda', 'Itarsi', 'Pipariya', 'Sohagpur'],
  'chhindwara':   ['Chhindwara', 'Seoni', 'Betul', 'Amla', 'Sausar'],
  'rewa':         ['Rewa', 'Satna', 'Sidhi', 'Shahdol', 'Singrauli'],

  // ── Rajasthan ──
  'jaipur':       ['Jaipur', 'Chomu', 'Sambhar', 'Phulera', 'Shahpura', 'Bassi'],
  'jodhpur':      ['Jodhpur', 'Pali', 'Barmer', 'Jalore', 'Nagaur', 'Sojat'],
  'kota':         ['Kota', 'Bundi', 'Jhalawar', 'Baran', 'Ramganj Mandi'],
  'ajmer':        ['Ajmer', 'Beawar', 'Kishangarh', 'Makrana', 'Nasirabad'],
  'bikaner':      ['Bikaner', 'Nokha', 'Lunkaransar', 'Kolayat'],
  'udaipur':      ['Udaipur', 'Chittorgarh', 'Bhilwara', 'Banswara', 'Rajsamand'],
  'alwar':        ['Alwar', 'Bhiwadi', 'Rajgarh', 'Behror', 'Tijara'],
  'sikar':        ['Sikar', 'Fatehpur', 'Laxmangarh', 'Neem Ka Thana'],
  'nagaur':       ['Nagaur', 'Merta', 'Ladnu', 'Kuchaman', 'Didwana'],
  'sriganganagar':['Sri Ganganagar', 'Hanumangarh', 'Anupgarh', 'Suratgarh', 'Raisinghnagar'],

  // ── Karnataka ──
  'bangalore':    ['Bangalore (Yeshwanthpur)', 'Anekal', 'Doddaballapur', 'Devanahalli', 'Ramanagara'],
  'mysore':       ['Mysore', 'Nanjangud', 'T Narasipur', 'Hunsur', 'Periyapatna'],
  'hubli':        ['Hubli', 'Dharwad', 'Gadag', 'Haveri', 'Ron', 'Nargund'],
  'davangere':    ['Davangere', 'Channagiri', 'Harihar', 'Jagalur', 'Harapanahalli'],
  'bellary':      ['Ballari', 'Hospet', 'Sandur', 'Siruguppa', 'Hagaribommanahalli'],
  'bidar':        ['Bidar', 'Basavakalyan', 'Humanabad', 'Aurad'],
  'gulbarga':     ['Kalaburagi', 'Sedam', 'Shahapur', 'Afzalpur', 'Jewargi'],
  'shimoga':      ['Shimoga', 'Sagar', 'Shikaripura', 'Bhadravathi', 'Hosanagara'],
  'tumkur':       ['Tumkur', 'Tiptur', 'Madhugiri', 'Kunigal', 'Pavagada'],
  'hassan':       ['Hassan', 'Arsikere', 'Holenarasipur', 'Channarayapatna', 'Sakleshpur'],
  'chitradurga':  ['Chitradurga', 'Hiriyur', 'Challakere', 'Holalkere'],
  'kolar':        ['Kolar', 'KGF', 'Bangarpet', 'Malur', 'Chintamani'],

  // ── Andhra Pradesh ──
  'kurnool':      ['Kurnool', 'Adoni', 'Nandyal', 'Atmakur', 'Dhone', 'Yemmiganur'],
  'guntur':       ['Guntur', 'Tenali', 'Narasaraopet', 'Sattenapalle', 'Mangalagiri'],
  'krishna':      ['Vijayawada', 'Machilipatnam', 'Nuzvid', 'Jaggaiahpet', 'Gudivada'],
  'anantapur':    ['Anantapur', 'Hindupur', 'Guntakal', 'Gooty', 'Tadipatri', 'Madakasira'],
  'kadapa':       ['Kadapa', 'Proddatur', 'Rajampet', 'Pulivendla', 'Jammalamadugu'],
  'nellore':      ['Nellore', 'Gudur', 'Kavali', 'Atmakur', 'Kandukur'],
  'visakhapatnam':['Visakhapatnam', 'Bheemunipatnam', 'Paderu', 'Narsipatnam'],

  // ── Telangana ──
  'hyderabad':    ['Hyderabad', 'Bowenpally', 'Gaddiannaram', 'Mirchowk', 'Kothapet'],
  'warangal':     ['Warangal', 'Hanamkonda', 'Jangaon', 'Narsampet', 'Mahbubabad'],
  'karimnagar':   ['Karimnagar', 'Ramagundam', 'Siricilla', 'Jagityal', 'Metpalli'],
  'nizamabad':    ['Nizamabad', 'Armoor', 'Bodhan', 'Kamareddy'],
  'nalgonda':     ['Nalgonda', 'Miryalaguda', 'Suryapet', 'Kodad', 'Huzurnagar'],
  'medak':        ['Medak', 'Sangareddy', 'Zahirabad', 'Siddipet', 'Gajwel'],

  // ── Gujarat ──
  'ahmedabad':    ['Ahmedabad', 'Bavla', 'Dholka', 'Viramgam', 'Daskroi', 'Sanand'],
  'surat':        ['Surat', 'Navsari', 'Bardoli', 'Bulsar', 'Valsad'],
  'vadodara':     ['Vadodara', 'Anand', 'Karjan', 'Dabhoi', 'Sinor', 'Padra'],
  'rajkot':       ['Rajkot', 'Morbi', 'Gondal', 'Jetpur', 'Jasdan', 'Kotda Sangani'],
  'anand':        ['Anand', 'Vallabh Vidyanagar', 'Petlad', 'Khambhat', 'Borsad'],
  'mehsana':      ['Mehsana', 'Unjha', 'Visnagar', 'Kadi', 'Patan', 'Sidhpur'],
  'banaskantha':  ['Palanpur', 'Deesa', 'Dhanera', 'Vadgam', 'Vav'],
  'surendranagar':['Surendranagar', 'Wadhwan', 'Halvad', 'Limbdi', 'Dhrangadhra'],
  'bhavnagar':    ['Bhavnagar', 'Palitana', 'Mahuva', 'Talaja', 'Gariadhar'],
  'amreli':       ['Amreli', 'Savarkundla', 'Rajula', 'Dhari', 'Babra'],
  'junagadh':     ['Junagadh', 'Keshod', 'Mangrol', 'Veraval', 'Visavadar'],

  // ── Haryana ──
  'karnal':       ['Karnal', 'Panipat', 'Kaithal', 'Kurukshetra', 'Pundri', 'Nilokheri'],
  'hisar':        ['Hisar', 'Sirsa', 'Fatehabad', 'Hansi', 'Barwala', 'Tohana'],
  'rohtak':       ['Rohtak', 'Jhajjar', 'Sonipat', 'Bahadurgarh', 'Gohana'],
  'ambala':       ['Ambala', 'Yamuna Nagar', 'Panchkula', 'Naraingarh', 'Mulana'],
  'bhiwani':      ['Bhiwani', 'Charkhi Dadri', 'Loharu', 'Siwani'],
  'gurgaon':      ['Gurugram', 'Manesar', 'Rewari', 'Pataudi', 'Farukhnagar'],
  'faridabad':    ['Faridabad', 'Ballabhgarh', 'Palwal', 'Hathin'],

  // ── Bihar ──
  'patna':        ['Patna', 'Patna Sahib', 'Danapur', 'Barh', 'Mokama', 'Bikram'],
  'muzaffarpur':  ['Muzaffarpur', 'Sitamarhi', 'Sheohar', 'Vaishali', 'Hajipur'],
  'gaya':         ['Gaya', 'Nawada', 'Aurangabad', 'Arwal', 'Jehanabad'],
  'bhagalpur':    ['Bhagalpur', 'Banka', 'Munger', 'Lakhisarai', 'Begusarai'],
  'darbhanga':    ['Darbhanga', 'Madhubani', 'Samastipur', 'Begusarai'],
  'nalanda':      ['Nalanda', 'Bihar Sharif', 'Hilsa', 'Rajgir', 'Islampur'],

  // ── West Bengal ──
  'kolkata':      ['Kolkata', 'Howrah', 'Badu', 'Baruipur', 'Narendrapur'],
  'bardhaman':    ['Bardhaman', 'Asansol', 'Durgapur', 'Kalna', 'Katwa'],
  'murshidabad':  ['Berhampore', 'Lalgola', 'Raghunathganj', 'Domkal', 'Jiaganj'],
  'nadia':        ['Krishnanagar', 'Nabadwip', 'Ranaghat', 'Kalyani', 'Chapra'],
  '24parganas':   ['Barasat', 'Basirhat', 'Diamond Harbour', 'Kakdwip'],
  'hooghly':      ['Chinsurah', 'Serampore', 'Chandannagar', 'Uttarpara', 'Arambag'],

  // ── Tamil Nadu ──
  'chennai':      ['Chennai', 'Koyambedu', 'Tambaram', 'Ambattur'],
  'coimbatore':   ['Coimbatore', 'Tiruppur', 'Erode', 'Pollachi', 'Mettupalayam'],
  'madurai':      ['Madurai', 'Dindigul', 'Theni', 'Virudhunagar', 'Sivakasi'],
  'salem':        ['Salem', 'Namakkal', 'Rasipuram', 'Attur', 'Omalur'],
  'thanjavur':    ['Thanjavur', 'Kumbakonam', 'Pattukottai', 'Papanasam', 'Orathanadu'],
  'tirunelveli':  ['Tirunelveli', 'Thoothukudi', 'Sankarankovil', 'Ambasamudram'],
  'vellore':      ['Vellore', 'Ranipet', 'Ambur', 'Vaniyambadi', 'Gudiyatham'],

  // ── Odisha ──
  'cuttack':      ['Cuttack', 'Jajpur', 'Jagatsinghpur', 'Kendrapara', 'Nayagarh'],
  'bhubaneswar':  ['Bhubaneswar', 'Khurda', 'Puri', 'Berhampur', 'Balugaon'],
  'sambalpur':    ['Sambalpur', 'Jharsuguda', 'Bargarh', 'Padampur', 'Deogarh'],
  'rayagada':     ['Rayagada', 'Koraput', 'Nabarangapur', 'Malkangiri'],
  'balasore':     ['Balasore', 'Bhadrak', 'Mayurbhanj', 'Baripada', 'Rairangpur'],

  // ── Chhattisgarh ──
  'raipur':       ['Raipur', 'Durg', 'Bhilai', 'Rajnandgaon', 'Bilaspur', 'Korba'],
  'bilaspur':     ['Bilaspur', 'Mungeli', 'Korba', 'Janjgir', 'Champa'],
  'bastar':       ['Jagdalpur', 'Kondagaon', 'Sukma', 'Dantewada', 'Bijapur'],
};

export function getNearbyMandiNames(district) {
  const key = (district || '').toLowerCase().replace(/[\s.]/g, '');
  // Direct match first
  if (DISTRICT_MANDIS[key]) return DISTRICT_MANDIS[key];
  // Partial match
  for (const [k, v] of Object.entries(DISTRICT_MANDIS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return [];
}
