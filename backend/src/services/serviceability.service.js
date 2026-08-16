/**
 * PIN-code serviceability — "will this seller deliver to 413102, and by when?"
 *
 * ── What it replaces ─────────────────────────────────────────────────────────
 * Delivery availability was inferred from `sellScope` plus a district string
 * compared case-insensitively (see buyBox.listingGeoWhere). That answers "is this
 * offer eligible to appear", which is a DISCOVERY question. It cannot answer the
 * question a buyer actually asks at checkout — will it reach my PIN code, and
 * when — so the app answered it with a "Delivery — coming soon" placeholder and
 * the cart charged a flat fee regardless.
 *
 * ── Design ───────────────────────────────────────────────────────────────────
 * A seller declares SellerServiceArea rows. Resolution is most-specific-first:
 *
 *   1. exact pincode          413102
 *   2. 3-digit prefix         413…      (a sorting region ≈ a district)
 *   3. district / state row   for sellers who think in revenue geography
 *   4. no rows at all         → serviceable, with the platform default ETA
 *
 * Step 4 is the compatibility guarantee: today NO seller has rows, so every
 * seller stays serviceable everywhere exactly as before, and each one becomes
 * precise the moment they configure their areas. `shop.serviceability.strict`
 * decides whether a seller who HAS configured areas is hard-blocked outside them.
 *
 * Never returns coordinates, and never exposes a seller's full area list to a
 * buyer — only the decision for the one PIN code that was asked about.
 */
import prisma from '../config/db.js';
import { getSetting } from './settings.service.js';
import { cachedListing } from '../utils/listingCache.js';

export const NS_SERVICEABILITY = 'agristore:serviceability';
const SERVICEABILITY_TTL = 300;

/** Indian PIN codes are exactly six digits and never start with 0. */
export function isValidPincode(value) {
  return typeof value === 'string' && /^[1-9][0-9]{5}$/.test(value.trim());
}

export function normalizePincode(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return isValidPincode(s) ? s : null;
}

/**
 * The non-null identity of the area a SellerServiceArea row covers.
 *
 * See the `matchKey` comment on the model: a unique index over nullable columns
 * does not constrain anything in Postgres, and Prisma cannot express a
 * compound-unique lookup containing a null. One deterministic string solves both.
 * Most specific wins, matching the resolution order in pickRow().
 */
export function serviceAreaMatchKey({ pincode, pincodePrefix, district, state }) {
  if (pincode) return `pin:${String(pincode).trim()}`;
  if (pincodePrefix) return `pre:${String(pincodePrefix).trim()}`;
  if (district) return `dist:${String(district).trim().toLowerCase()}`;
  if (state) return `state:${String(state).trim().toLowerCase()}`;
  return null;
}

async function defaults() {
  const [min, max, strict] = await Promise.all([
    getSetting('shop.serviceability.defaultEtaMinDays'),
    getSetting('shop.serviceability.defaultEtaMaxDays'),
    getSetting('shop.serviceability.strict'),
  ]);
  return {
    etaMinDays: Number(min) || 3,
    etaMaxDays: Number(max) || 7,
    strict: strict === true,
  };
}

/**
 * Pick the most specific matching row.
 *
 * Specificity order is exact pincode > prefix > district > state, and NOT
 * "cheapest" or "fastest": a seller who wrote a slow, expensive rule for one
 * pincode meant it, and silently upgrading them to their own broader rule would
 * quote a delivery date they never promised.
 */
function pickRow(rows, { pincode, district, state }) {
  const prefix = pincode ? pincode.slice(0, 3) : null;
  const byRank = (r) => {
    if (r.pincode && r.pincode === pincode) return 0;
    if (r.pincodePrefix && prefix && r.pincodePrefix === prefix) return 1;
    if (r.district && district && r.district.toLowerCase() === district.toLowerCase()) return 2;
    if (r.state && state && r.state.toLowerCase() === state.toLowerCase()) return 3;
    return 99;
  };
  let best = null;
  let bestRank = 99;
  for (const r of rows) {
    const rank = byRank(r);
    if (rank < bestRank) { best = r; bestRank = rank; }
  }
  return bestRank === 99 ? null : best;
}

/**
 * Resolve serviceability for several sellers against one PIN code, in ONE query.
 *
 * @param {{sellerIds: string[], pincode: string, district?: string, state?: string}} args
 * @returns {Promise<Map<string, {serviceable:boolean, etaMinDays:number, etaMaxDays:number,
 *                               surcharge:string, codAvailable:boolean, pickupAvailable:boolean,
 *                               source:'exact'|'prefix'|'region'|'default'|'unconfigured'}>>}
 */
export async function resolveServiceability({ sellerIds = [], pincode, district = null, state = null }) {
  const out = new Map();
  const ids = [...new Set(sellerIds.filter(Boolean))];
  if (!ids.length) return out;

  const cfg = await defaults();
  const pin = normalizePincode(pincode);

  // No / invalid PIN code: everyone is "unknown but allowed", with the default
  // ETA. An unparseable PIN must never silently block a checkout.
  if (!pin) {
    for (const id of ids) {
      out.set(id, {
        serviceable: true, etaMinDays: cfg.etaMinDays, etaMaxDays: cfg.etaMaxDays,
        surcharge: '0.00', codAvailable: true, pickupAvailable: false, source: 'default',
      });
    }
    return out;
  }

  const prefix = pin.slice(0, 3);

  // ONE query for every seller in the cart. Narrowed by the geography predicates
  // so it reads only the handful of rows that could possibly match, rather than
  // a seller's entire area list.
  const rows = await prisma.sellerServiceArea.findMany({
    where: {
      sellerId: { in: ids },
      isActive: true,
      OR: [
        { pincode: pin },
        { pincodePrefix: prefix },
        ...(district ? [{ district: { equals: district, mode: 'insensitive' } }] : []),
        ...(state ? [{ state: { equals: state, mode: 'insensitive' } }] : []),
      ],
    },
    select: {
      sellerId: true, pincode: true, pincodePrefix: true, district: true, state: true,
      etaMinDays: true, etaMaxDays: true, surcharge: true, codAvailable: true, pickupAvailable: true,
    },
  });

  // Which sellers have configured ANY areas — the difference between "does not
  // deliver here" and "has not told us where they deliver". Only the first is a
  // block; treating the second as one would take every current seller offline.
  const configured = new Set(
    (await prisma.sellerServiceArea.groupBy({
      by: ['sellerId'],
      where: { sellerId: { in: ids }, isActive: true },
    })).map((r) => r.sellerId),
  );

  const bySeller = new Map();
  for (const r of rows) {
    if (!bySeller.has(r.sellerId)) bySeller.set(r.sellerId, []);
    bySeller.get(r.sellerId).push(r);
  }

  for (const id of ids) {
    const match = pickRow(bySeller.get(id) || [], { pincode: pin, district, state });
    if (match) {
      const source = match.pincode === pin ? 'exact' : match.pincodePrefix === prefix ? 'prefix' : 'region';
      out.set(id, {
        serviceable: true,
        etaMinDays: match.etaMinDays,
        etaMaxDays: match.etaMaxDays,
        surcharge: String(match.surcharge ?? '0.00'),
        codAvailable: match.codAvailable,
        pickupAvailable: match.pickupAvailable,
        source,
      });
    } else if (configured.has(id)) {
      // The seller told us where they deliver, and this is not one of those
      // places. `strict` decides whether that blocks or merely warns.
      out.set(id, {
        serviceable: !cfg.strict,
        etaMinDays: cfg.etaMinDays,
        etaMaxDays: cfg.etaMaxDays,
        surcharge: '0.00',
        codAvailable: true,
        pickupAvailable: false,
        source: 'default',
      });
    } else {
      out.set(id, {
        serviceable: true,
        etaMinDays: cfg.etaMinDays,
        etaMaxDays: cfg.etaMaxDays,
        surcharge: '0.00',
        codAvailable: true,
        pickupAvailable: false,
        source: 'unconfigured',
      });
    }
  }
  return out;
}

/**
 * Buyer-facing PIN check for a single product, used by the product page before
 * anything is in the cart. Cached — the answer depends only on (product, pin).
 *
 * Returns the BEST offer's promise, since that is the offer the page is showing.
 */
export async function checkProductServiceability({ productId, pincode }) {
  const pin = normalizePincode(pincode);
  if (!pin) return { valid: false, reason: 'INVALID_PINCODE' };

  const { data } = await cachedListing(NS_SERVICEABILITY, `${productId}:${pin}`, SERVICEABILITY_TTL, async () => {
    const listings = await prisma.sellerListing.findMany({
      where: { variant: { productId }, status: 'ACTIVE', stockQty: { gt: 0 } },
      select: { sellerId: true, seller: { select: { name: true } } },
      take: 50,
    });
    if (!listings.length) return { data: { valid: true, serviceable: false, reason: 'NO_SELLERS' } };

    const map = await resolveServiceability({ sellerIds: listings.map((l) => l.sellerId), pincode: pin });
    const options = listings
      .map((l) => ({ sellerName: l.seller?.name || null, ...map.get(l.sellerId) }))
      .filter((o) => o.serviceable);

    if (!options.length) return { data: { valid: true, serviceable: false, reason: 'NOT_SERVICEABLE' } };

    // The fastest seller who will actually come here.
    const best = options.reduce((a, b) => (b.etaMaxDays < a.etaMaxDays ? b : a));
    return {
      data: {
        valid: true,
        serviceable: true,
        etaMinDays: best.etaMinDays,
        etaMaxDays: best.etaMaxDays,
        codAvailable: options.some((o) => o.codAvailable),
        pickupAvailable: options.some((o) => o.pickupAvailable),
        sellerCount: options.length,
      },
    };
  });

  return data;
}
