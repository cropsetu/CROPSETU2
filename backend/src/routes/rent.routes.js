/**
 * Rent Routes — Machinery & Labour marketplace
 *
 * Machinery:
 *   GET    /rent/machinery               list (paginated, filterable, distance-aware)
 *   GET    /rent/machinery/my            my listings (auth)
 *   GET    /rent/machinery/:id           detail
 *   GET    /rent/machinery/:id/availability  booked date ranges
 *   POST   /rent/machinery               create listing (auth)
 *   PUT    /rent/machinery/:id           update (auth, owner)
 *   DELETE /rent/machinery/:id           soft-delete (auth, owner)
 *
 * Labour:
 *   GET    /rent/labour                  list
 *   GET    /rent/labour/my               my listings (auth)
 *   GET    /rent/labour/:id              detail
 *   GET    /rent/labour/:id/availability booked date ranges
 *   POST   /rent/labour                  create listing (auth)
 *   PUT    /rent/labour/:id              update (auth, owner)
 *   DELETE /rent/labour/:id              soft-delete (auth, owner)
 *
 * Bookings:
 *   GET    /rent/bookings                my bookings (auth)
 *   POST   /rent/bookings                create booking (auth)
 *   GET    /rent/bookings/:id            detail (auth)
 *   PUT    /rent/bookings/:id/cancel     cancel (auth)
 *
 * Distance filtering (for all list endpoints):
 *   ?lat=18.9750&lng=73.8260&radius=10   → only listings within 10 km
 *   ?radius=all                          → keep distance sort + distanceKm, no ceiling
 *   ?strict=true                         → exclude listings that have no coordinates
 *   ?sort=distance|price|rating          → explicit ordering
 *   Results include a `distanceKm` field when lat/lng provided.
 *
 * All four are optional and default to the historical behaviour: radius 50 km,
 * coordinate-less listings included and sorted last, distance sort when lat/lng
 * are present and rating sort when they are not.
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { validate } from '../middleware/validate.js';
import { maxLen } from '../middleware/textLength.js';
import { rateLimiter, clientIp } from '../middleware/rateLimit.js';
import { idempotency } from '../middleware/idempotency.js';
import { sanitizeSearch } from '../utils/sanitizeSearch.js';
import prisma from '../config/db.js';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendServerError, paginationMeta, parsePageSize } from '../utils/response.js';
import { D } from '../utils/money.js';
import { geoPageIds, haversineKm } from '../utils/geo.js';
import { Prisma } from '@prisma/client';
import { stripHtml } from '../utils/encrypt.js';
import { archiveResource } from '../services/softDelete.service.js';
import { auditLog } from '../services/audit.service.js';
import { cachedListing, bumpListingVersion } from '../utils/listingCache.js';
import { withSerializableRetry } from '../utils/txRetry.js';
import {
  NS_MACHINERY, NS_LABOUR, RENT_TTL_SEC,
  MACHINERY_LIST_SELECT, MACHINERY_DETAIL_SELECT,
  LABOUR_LIST_SELECT, LABOUR_DETAIL_SELECT,
  toPublicMachinery, toPublicLabour, redactBookingContacts,
  daysBetweenInclusive, hasBookingRelationship,
} from '../services/rentListing.service.js';

// ── Rate limits ──────────────────────────────────────────────────────────────
// Redis-backed and shared across instances, keyed on the authenticated user
// (falling back to the trust-proxy-resolved IP). Set well above what a farmer
// browsing or listing actually does — these bound scrapers and spam.

const browseLimit = rateLimiter({
  windowMs: 60_000,
  max: 120,
  prefix: 'rent:browse',
  key: (req) => req.user?.id || clientIp(req),
  message: 'Too many searches. Please wait a moment and try again.',
});

const rentWriteLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  prefix: 'rent:write',
  key: (req) => req.user?.id || clientIp(req),
  message: 'Too many changes. Please wait a few minutes and try again.',
});

const listingCreateLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 15,
  prefix: 'rent:create',
  key: (req) => req.user?.id || clientIp(req),
  message: 'You have posted a lot of listings recently. Please try again later.',
});

const bookingLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 25,
  prefix: 'rent:booking',
  key: (req) => req.user?.id || clientIp(req),
  message: 'Too many booking requests. Please try again later.',
});

// Contact reveal is the scraping surface — the only route to a phone number —
// so it is the tightest limit here and every call is audited.
const contactLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  prefix: 'rent:contact',
  key: (req) => req.user?.id || clientIp(req),
  message: 'You have viewed a lot of contact numbers. Please try again later.',
});

const idemBooking = idempotency('rent_booking');

/** Pretty Indian phone label for the contact-reveal response. */
function prettyPhone(p) {
  if (!p) return null;
  const d = String(p).replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : String(p);
}

/**
 * The lister's own name and phone, from their account.
 *
 * `authenticate` only puts `{ id, role }` on req.user, so the old
 * `ownerPhone || req.user.phone` fallback could never fire — the client's value
 * was the ONLY source, and a listing could advertise a stranger's number. One
 * small select fixes both that and the `ownerName` fallback, which was silently
 * null for the same reason.
 */
async function listerIdentity(userId) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, phone: true, state: true },
  });
  return { name: u?.name || null, phone: u?.phone || null, state: u?.state || null };
}

/**
 * Normalise a phone number a lister typed for their own listing.
 *
 * A lister may only publish their OWN account number. Anything else — a rival's
 * number, a random one — falls back to their own, so a listing cannot be used
 * to make someone else's phone ring all season with no trace back to the author.
 */
function ownPhoneOnly(supplied, accountPhone) {
  const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(-10);
  if (!supplied) return accountPhone || null;
  return digits(supplied) === digits(accountPhone) ? accountPhone : (accountPhone || null);
}

// [FIX] Validate GPS coordinates are within Earth bounds
function validateCoords(lat, lng) {
  if (lat != null && (lat < -90 || lat > 90)) return false;
  if (lng != null && (lng < -180 || lng > 180)) return false;
  return true;
}

// ── Optional list-query knobs (shared by /machinery and /labour) ─────────────
// Each parses to the historical default when absent or unparseable, so an
// existing caller that sends none of them gets exactly the old behaviour.

const SORT_MODES = ['distance', 'price', 'rating'];

// 50 km when absent (the long-standing default); null means "no ceiling" and is
// requested with ?radius=all. A non-numeric value falls back to the default
// rather than reaching the query as NaN.
function parseRadius(raw) {
  if (raw == null || raw === '') return 50;
  if (String(raw).toLowerCase() === 'all') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

// Opt-in only. `requireCoords` is accepted as an alias so the flag reads well
// from either side (the client asks for coordinates; the query asks for rigour).
function parseStrict(q) {
  return q.strict === 'true' || q.requireCoords === 'true';
}

// Explicit sort wins; otherwise distance when we can measure it, rating when we
// cannot — which is what each branch already did implicitly.
function parseSort(raw, isDistanceQuery) {
  if (SORT_MODES.includes(raw)) {
    // Distance ordering is meaningless without an origin.
    if (raw === 'distance' && !isDistanceQuery) return 'rating';
    return raw;
  }
  return isDistanceQuery ? 'distance' : 'rating';
}

// Non-geo ordering for the same three modes. 'distance' never reaches here —
// parseSort has already downgraded it to 'rating'.
//
// `id` is the final tiebreaker on every ordering. Without it, rows sharing a
// rating (which is 0 for every listing until someone reviews it — i.e. almost
// all of them) came back in whatever order the executor chose, so offset page 2
// could repeat a row page 1 already showed and skip another entirely.
function nonGeoOrderBy(sort) {
  if (sort === 'price') return [{ pricePerDay: 'asc' }, { rating: 'desc' }, { id: 'desc' }];
  return [{ rating: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
}

/**
 * Booked-date ranges for a listing's calendar.
 *
 * Shared by both availability routes. Three things it fixes: the month window
 * is validated (an unparseable ?year= produced `new Date(NaN, …)` and a filter
 * that silently matched nothing), the result is bounded (it was an unbounded
 * findMany over every booking a listing has ever had), and a listing with no
 * month specified only returns FUTURE bookings — a calendar has no use for last
 * season's.
 */
async function bookedRanges(where, { year, month }) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10) - 1;
  const validMonth = Number.isInteger(y) && y >= 2000 && y <= 2100 && Number.isInteger(m) && m >= 0 && m <= 11;

  if (validMonth) {
    const rangeStart = new Date(y, m, 1);
    const rangeEnd   = new Date(y, m + 2, 0);
    where.OR = [
      { startDate: { gte: rangeStart, lte: rangeEnd } },
      { endDate:   { gte: rangeStart, lte: rangeEnd } },
      { startDate: { lte: rangeStart }, endDate: { gte: rangeEnd } },
    ];
  } else {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    where.endDate = { gte: today };
  }

  return prisma.booking.findMany({
    where,
    select: { startDate: true, endDate: true, status: true },
    orderBy: { startDate: 'asc' },
    take: 200, // a year of back-to-back weekly bookings and then some
  });
}

// Availability window: when both ends are given, the end must not precede the start.
// Either side may be blank (open-ended / ongoing availability).
function validateDateWindow(from, to) {
  if (!from || !to) return true;
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return false;
  return t >= f;
}

// A booking must fall entirely inside the listing's availability window.
// Compared at day granularity (YYYY-MM-DD) to avoid timezone drift.
function withinAvailability(startDate, endDate, from, to) {
  const s = String(startDate).slice(0, 10);
  const e = String(endDate).slice(0, 10);
  if (from && s < new Date(from).toISOString().slice(0, 10)) return false;
  if (to   && e > new Date(to).toISOString().slice(0, 10))   return false;
  return true;
}

// Derive a listing-level booked indicator from its confirmed/active bookings.
//   'BOOKED'   → a confirmed booking covers today (in use right now)
//   'RESERVED' → a confirmed booking is upcoming (reserved for future dates)
//   null       → no confirmed/active bookings ahead
function deriveBookedStatus(bookings, startOfToday) {
  if (!bookings || bookings.length === 0) return null;
  let upcoming = false;
  for (const b of bookings) {
    const s = new Date(b.startDate); s.setHours(0, 0, 0, 0);
    const e = new Date(b.endDate);   e.setHours(23, 59, 59, 999);
    if (startOfToday >= s && startOfToday <= e) return 'BOOKED';
    if (s > startOfToday) upcoming = true;
  }
  return upcoming ? 'RESERVED' : null;
}

const router = Router();
router.param('id', uuidParamGuard); // machinery / labour / booking ids — reject non-UUIDs with 400

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — list
// ─────────────────────────────────────────────────────────────────────────────

router.get('/machinery', optionalAuth, browseLimit, async (req, res) => {
  try {
  const page     = Math.max(parseInt(req.query.page  || '1'),  1);
  const limit    = parsePageSize(req.query.limit, 20, 50);
  const { category, available } = req.query;
  const district = sanitizeSearch(req.query.district); // strip LIKE wildcards / cap length
  const search   = sanitizeSearch(req.query.search);
  const userLat  = req.query.lat    ? parseFloat(req.query.lat)    : null;
  const userLng  = req.query.lng    ? parseFloat(req.query.lng)    : null;
  const radiusKm = parseRadius(req.query.radius); // 50 km default, null = no ceiling
  const strict   = parseStrict(req.query);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

  const where = { status: 'ACTIVE' };
  if (category && category !== 'all') where.category = category;
  if (district)  where.district = { contains: district, mode: 'insensitive' };
  if (available === 'true') where.available = true;
  if (search) {
    where.OR = [
      { name:        { contains: search, mode: 'insensitive' } },
      { brand:       { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { location:    { contains: search, mode: 'insensitive' } },
    ];
  }

  const isDistanceQuery = userLat !== null && userLng !== null;
  const sort = parseSort(req.query.sort, isDistanceQuery);

  // lat/lng are selected so distance can be computed, then stripped on the way
  // out by toPublicMachinery — they never reach a client.
  const listingSelect = {
    ...MACHINERY_LIST_SELECT,
    bookings: {
      where: { status: { in: ['CONFIRMED', 'ACTIVE'] }, endDate: { gte: startOfToday } },
      select: { startDate: true, endDate: true },
    },
  };

  const identity = JSON.stringify([
    'machinery', category || '', district || '', available || '', search || '',
    sort, strict, page, limit,
    // Coordinates are bucketed into ~1 km cells for the CACHE KEY: neighbours
    // share an entry instead of each minting their own, and the key itself
    // never records a precise position.
    isDistanceQuery ? Math.round(userLat * 100) / 100 : '',
    isDistanceQuery ? Math.round(userLng * 100) / 100 : '',
    isDistanceQuery ? (radiusKm ?? 'all') : '',
  ]);

  const load = async () => {
    let items;
    let total;
    if (isDistanceQuery) {
      // Push the bounding box, Haversine circle, distance sort and LIMIT/OFFSET
      // down to SQL so only THIS page's rows load (memory bounded by `limit`, not
      // a 500-row buffer). geoPageIds returns the page's ordered ids; we then
      // hydrate just those with the full select (incl. bookings).
      const filters = [Prisma.sql`status = 'ACTIVE'`];
      if (category && category !== 'all') filters.push(Prisma.sql`category = ${category}`);
      if (district)              filters.push(Prisma.sql`district ILIKE '%' || ${district} || '%'`);
      if (available === 'true')  filters.push(Prisma.sql`available = true`);
      if (search) {
        filters.push(Prisma.sql`(name ILIKE '%' || ${search} || '%'
          OR brand ILIKE '%' || ${search} || '%'
          OR description ILIKE '%' || ${search} || '%'
          OR location ILIKE '%' || ${search} || '%')`);
      }
      const { ids, distById, total: geoTotal } = await geoPageIds(prisma, {
        tableSql: Prisma.raw('"machinery_listings"'),
        whereSql: Prisma.join(filters, ' AND '),
        lat: userLat, lng: userLng, radiusKm,
        offset: (page - 1) * limit, limit,
        strict, sort,
      });
      total = geoTotal;
      const rows = ids.length
        ? await prisma.machineryListing.findMany({ where: { id: { in: ids } }, select: listingSelect })
        : [];
      const byId = new Map(rows.map(r => [r.id, r]));
      // Preserve the SQL distance ordering.
      items = ids.map((id) => {
        const row = byId.get(id);
        if (!row) return null;
        const { bookings, ...rest } = row;
        return toPublicMachinery(rest, {
          distanceKm: distById.get(id),
          bookedStatus: deriveBookedStatus(bookings, startOfToday),
        });
      }).filter(Boolean);
    } else {
      const [rows, count] = await Promise.all([
        prisma.machineryListing.findMany({
          where,
          orderBy: nonGeoOrderBy(sort),
          skip: (page - 1) * limit,
          take: limit,
          select: listingSelect,
        }),
        prisma.machineryListing.count({ where }),
      ]);
      total = count;
      items = rows.map(({ bookings, ...rest }) => toPublicMachinery(rest, {
        bookedStatus: deriveBookedStatus(bookings, startOfToday),
      }));
    }
    return { data: items, meta: { ...paginationMeta(total, page, limit), sort, hasMore: page * limit < total } };
  };

  const { data, meta, cached } = await cachedListing(NS_MACHINERY, identity, RENT_TTL_SEC, load);
  res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
  return sendSuccess(res, data, 200, meta);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load machinery listings');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — my listings
// ─────────────────────────────────────────────────────────────────────────────

// [FIX #17] Add pagination to /my listings
router.get('/machinery/my', authenticate, async (req, res) => {
  const page  = Math.max(parseInt(req.query.page  || '1'),  1);
  const limit = Math.min(parseInt(req.query.limit || '20'), 50);
  const [items, total] = await Promise.all([
    prisma.machineryListing.findMany({
      where:   { ownerId: req.user.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.machineryListing.count({ where: { ownerId: req.user.id, status: 'ACTIVE' } }),
  ]);
  return sendSuccess(res, items, 200, paginationMeta(total, page, limit));
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — detail
// ─────────────────────────────────────────────────────────────────────────────

router.get('/machinery/:id', optionalAuth, async (req, res) => {
  try {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const item = await prisma.machineryListing.findUnique({
      where: { id: req.params.id },
      select: {
        ...MACHINERY_DETAIL_SELECT,
        bookings: {
          where: { status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] }, endDate: { gte: startOfToday } },
          select: { startDate: true, endDate: true, status: true },
          orderBy: { startDate: 'asc' },
          take: 200,
        },
      },
    });
    if (!item || item.status === 'INACTIVE') return sendNotFound(res, 'Machinery listing not found');

    // Distance is computed from the CALLER'S coordinates and returned coarsened;
    // the listing's own lat/lng are stripped by toPublicMachinery.
    const { bookings, ...rest } = item;
    const lat = req.query.lat ? parseFloat(req.query.lat) : null;
    const lng = req.query.lng ? parseFloat(req.query.lng) : null;
    const distanceKm = (Number.isFinite(lat) && Number.isFinite(lng) && item.lat != null && item.lng != null)
      ? haversineKm(lat, lng, item.lat, item.lng)
      : null;

    return sendSuccess(res, {
      ...toPublicMachinery(rest, { distanceKm, bookedStatus: deriveBookedStatus(bookings, startOfToday) }),
      bookedRanges: bookings,
      // `ownerPhone` is deliberately absent. It used to be handed to any
      // signed-in caller, so one OTP account could walk the catalogue and
      // harvest every owner's number. It now comes from /machinery/:id/contact,
      // which is rate limited and audited.
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load listing');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — availability (booked date ranges for a calendar)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/machinery/:id/availability', async (req, res) => {
  try {
    const bookings = await bookedRanges({
      machineryListingId: req.params.id,
      status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] },
    }, req.query);
    return sendSuccess(res, bookings);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load availability');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY / LABOUR — contact reveal
// ─────────────────────────────────────────────────────────────────────────────
// Renting needs a phone call, so the number is available — but only to a signed-in
// caller, at most 30 times an hour, and every release is recorded. That is the
// difference between "farmers can reach each other" and "the marketplace is a
// downloadable phone directory". The number itself is never written to the log.

async function revealContact(req, res, { kind }) {
  const isMachinery = kind === 'machinery';
  const listing = isMachinery
    ? await prisma.machineryListing.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, ownerId: true, ownerName: true, ownerPhone: true, owner: { select: { name: true, phone: true } } },
    })
    : await prisma.labourListing.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, providerId: true, leader: true, phone: true, provider: { select: { name: true, phone: true } } },
    });

  if (!listing || listing.status === 'INACTIVE') return sendNotFound(res, 'Listing not found');

  const person = isMachinery ? listing.owner : listing.provider;
  const phone = (isMachinery ? listing.ownerPhone : listing.phone) || person?.phone || null;

  auditLog({
    userId: req.user.id,
    action: 'RENT_CONTACT_REVEAL',
    entity: isMachinery ? 'MachineryListing' : 'LabourListing',
    entityId: listing.id,
    ip: clientIp(req),
    requestId: req.id,
    metadata: { ownerId: isMachinery ? listing.ownerId : listing.providerId },
  }).catch(() => {});

  return sendSuccess(res, {
    listingId: listing.id,
    ownerId: isMachinery ? listing.ownerId : listing.providerId,
    ownerName: (isMachinery ? listing.ownerName : listing.leader) || person?.name || null,
    phone,
    phoneLabel: prettyPhone(phone),
    // True when the caller already has a booking here, so the client can skip
    // the "share my number?" nudge for an existing relationship.
    hasBooking: await hasBookingRelationship(
      req.user.id,
      isMachinery ? { machineryListingId: listing.id } : { labourListingId: listing.id },
    ),
  });
}

router.get('/machinery/:id/contact', authenticate, contactLimit, (req, res) =>
  revealContact(req, res, { kind: 'machinery' }).catch((err) =>
    sendServerError(res, err, 'Could not fetch contact details')));

// Per-field character caps for listing free-text — bound DB row size and reject
// oversized payloads with 400. Shared by each resource's create + update routes.
const MACHINERY_TEXT_LIMITS = {
  name: 150, category: 80, description: 5000, brand: 100, fuelType: 40,
  location: 150, district: 120, state: 120, ownerName: 120,
};
const LABOUR_TEXT_LIMITS = {
  name: 150, leader: 120, groupName: 120, experience: 200, description: 5000,
  languages: 200, location: 150, district: 120, state: 120,
};

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — create listing
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/machinery',
  authenticate,
  listingCreateLimit,
  [
    body('name').trim().notEmpty().withMessage('Equipment name is required'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('pricePerDay').isFloat({ min: 1 }).withMessage('pricePerDay must be positive'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('district').trim().notEmpty().withMessage('District is required'),
    ...maxLen(MACHINERY_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    const {
      name, category, description, brand, ageYears, mileageHours,
      horsePower, fuelType, features, pricePerHour, pricePerDay, pricePerAcre,
      images, videos, location, district, state,
      availableFrom, availableTo, ownerName, ownerPhone,
      lat, lng,
    } = req.body;

    // [FIX] Validate GPS coordinates
    const parsedLat = lat != null ? parseFloat(lat) : null;
    const parsedLng = lng != null ? parseFloat(lng) : null;
    if (!validateCoords(parsedLat, parsedLng)) {
      return sendError(res, 'Invalid GPS coordinates', 400);
    }

    if (!validateDateWindow(availableFrom, availableTo)) {
      return sendError(res, 'availableTo must be on or after availableFrom', 400);
    }

    const me = await listerIdentity(req.user.id);

    // [FIX] Sanitize all text fields to prevent stored XSS
    const listing = await prisma.machineryListing.create({
      data: {
        ownerId:      req.user.id,
        name:         stripHtml(name.trim()),
        category:     category.trim().toLowerCase(),
        description:  stripHtml(description?.trim()) || null,
        brand:        stripHtml(brand?.trim())        || null,
        ageYears:     ageYears     != null ? parseFloat(ageYears)     : null,
        mileageHours: mileageHours != null ? parseInt(mileageHours)   : null,
        horsePower:   stripHtml(horsePower?.trim())   || null,
        fuelType:     stripHtml(fuelType?.trim())     || null,
        features:     Array.isArray(features) ? features.map(f => typeof f === 'string' ? stripHtml(f) : f) : [],
        pricePerHour: pricePerHour != null ? parseFloat(pricePerHour) : null,
        pricePerDay:  parseFloat(pricePerDay),
        pricePerAcre: pricePerAcre != null ? parseFloat(pricePerAcre) : null,
        images:       Array.isArray(images) ? images : [],
        videos:       Array.isArray(videos) ? videos : [],
        location:     stripHtml(location.trim()),
        district:     stripHtml(district.trim()),
        state:        stripHtml((state || me.state || 'Maharashtra').trim()),
        lat:          parsedLat,
        lng:          parsedLng,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        availableTo:   availableTo   ? new Date(availableTo)   : null,
        ownerName:    stripHtml(ownerName?.trim()) || me.name || null,
        // A lister may only publish THEIR OWN number. This was written straight
        // from the body, so a listing could advertise a rival's phone and make
        // it ring all season — free harassment with no trace back to the author.
        ownerPhone:   ownPhoneOnly(ownerPhone, me.phone),
      },
    });

    bumpListingVersion(NS_MACHINERY).catch(() => {});
    return sendCreated(res, listing);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — update listing
// ─────────────────────────────────────────────────────────────────────────────

/** Free-text keys that must be HTML-stripped whichever route writes them. */
const MACHINERY_TEXT_KEYS = new Set(['name', 'category', 'description', 'brand', 'horsePower', 'fuelType', 'location', 'district', 'state', 'ownerName']);
const LABOUR_TEXT_KEYS = new Set(['name', 'leader', 'groupName', 'experience', 'description', 'location', 'district', 'state']);

router.put('/machinery/:id', authenticate, rentWriteLimit, maxLen(MACHINERY_TEXT_LIMITS), validate, async (req, res) => {
  try {
  const listing = await prisma.machineryListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return sendNotFound(res, 'Listing not found');
  if (listing.ownerId !== req.user.id) return sendForbidden(res, 'Not your listing');

  const allowed = [
    'name','category','description','brand','ageYears','mileageHours','horsePower',
    'fuelType','features','pricePerHour','pricePerDay','pricePerAcre',
    'images','videos','location','district','state',
    'availableFrom','availableTo','ownerName','ownerPhone','available',
    'lat', 'lng',
  ];

  const data = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === 'availableFrom' || key === 'availableTo') {
        data[key] = req.body[key] ? new Date(req.body[key]) : null;
      } else if (['ageYears','pricePerHour','pricePerDay','pricePerAcre','lat','lng'].includes(key)) {
        data[key] = req.body[key] != null ? parseFloat(req.body[key]) : null;
      } else if (key === 'mileageHours') {
        data[key] = req.body[key] != null ? parseInt(req.body[key]) : null;
      } else if (key === 'ownerPhone') {
        // Same rule as create: your own number or nothing.
        data[key] = ownPhoneOnly(req.body[key], (await listerIdentity(req.user.id)).phone);
      } else if (MACHINERY_TEXT_KEYS.has(key)) {
        // CREATE stripped HTML from every text field; UPDATE did not, so the
        // edit form was an open door to the stored XSS the create path closed.
        data[key] = typeof req.body[key] === 'string' ? stripHtml(req.body[key].trim()) : req.body[key];
      } else if (key === 'features') {
        data[key] = Array.isArray(req.body[key])
          ? req.body[key].map((f) => (typeof f === 'string' ? stripHtml(f) : f))
          : [];
      } else {
        data[key] = req.body[key];
      }
    }
  }

  if (!validateCoords(data.lat ?? listing.lat, data.lng ?? listing.lng)) {
    return sendError(res, 'Invalid GPS coordinates', 400);
  }

  // Validate the resulting availability window (merge incoming changes over existing).
  const effFrom = data.availableFrom !== undefined ? data.availableFrom : listing.availableFrom;
  const effTo   = data.availableTo   !== undefined ? data.availableTo   : listing.availableTo;
  if (!validateDateWindow(effFrom, effTo)) {
    return sendError(res, 'availableTo must be on or after availableFrom', 400);
  }

  const updated = await prisma.machineryListing.update({ where: { id: req.params.id }, data });
  bumpListingVersion(NS_MACHINERY).catch(() => {});
  return sendSuccess(res, updated);
  } catch (err) {
    return sendServerError(res, err, 'Failed to update listing');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — soft delete
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/machinery/:id', authenticate, rentWriteLimit, async (req, res) => {
  const listing = await prisma.machineryListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return sendNotFound(res, 'Listing not found');
  if (listing.ownerId !== req.user.id) return sendForbidden(res, 'Not your listing');

  // archiveResource flips status→INACTIVE and records a RESOURCE_ARCHIVE event.
  await archiveResource(req, 'MachineryListing', listing.id);
  bumpListingVersion(NS_MACHINERY).catch(() => {});
  return sendSuccess(res, { message: 'Listing removed' });
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — list
// ─────────────────────────────────────────────────────────────────────────────

router.get('/labour', optionalAuth, browseLimit, async (req, res) => {
  try {
  const page   = Math.max(parseInt(req.query.page  || '1'),  1);
  const limit  = parsePageSize(req.query.limit, 20, 50);
  const { skill, available } = req.query;
  const district = sanitizeSearch(req.query.district); // strip LIKE wildcards / cap length
  const search   = sanitizeSearch(req.query.search);
  const userLat  = req.query.lat    ? parseFloat(req.query.lat)    : null;
  const userLng  = req.query.lng    ? parseFloat(req.query.lng)    : null;
  const radiusKm = parseRadius(req.query.radius); // 50 km default, null = no ceiling
  const strict   = parseStrict(req.query);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

  const where = { status: 'ACTIVE' };
  if (district) where.district = { contains: district, mode: 'insensitive' };
  if (available === 'true') where.available = true;
  if (skill)    where.skills = { has: skill };
  if (search) {
    where.OR = [
      { name:        { contains: search, mode: 'insensitive' } },
      { leader:      { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { location:    { contains: search, mode: 'insensitive' } },
    ];
  }

  const isDistanceQuery = userLat !== null && userLng !== null;
  const sort = parseSort(req.query.sort, isDistanceQuery);

  const SELECT = {
    ...LABOUR_LIST_SELECT,
    bookings: {
      where: { status: { in: ['CONFIRMED', 'ACTIVE'] }, endDate: { gte: startOfToday } },
      select: { startDate: true, endDate: true },
    },
  };

  const identity = JSON.stringify([
    'labour', skill || '', district || '', available || '', search || '',
    sort, strict, page, limit,
    isDistanceQuery ? Math.round(userLat * 100) / 100 : '',
    isDistanceQuery ? Math.round(userLng * 100) / 100 : '',
    isDistanceQuery ? (radiusKm ?? 'all') : '',
  ]);

  const load = async () => {
    let items;
    let total;
    if (isDistanceQuery) {
      // Geo + circle + distance sort + pagination pushed to SQL — only this page's
      // rows load (memory bounded by `limit`, not the old 500-row buffer).
      const filters = [Prisma.sql`status = 'ACTIVE'`];
      if (district)             filters.push(Prisma.sql`district ILIKE '%' || ${district} || '%'`);
      if (available === 'true') filters.push(Prisma.sql`available = true`);
      if (skill)                filters.push(Prisma.sql`${skill} = ANY(skills)`);
      if (search) {
        filters.push(Prisma.sql`(name ILIKE '%' || ${search} || '%'
          OR leader ILIKE '%' || ${search} || '%'
          OR description ILIKE '%' || ${search} || '%'
          OR location ILIKE '%' || ${search} || '%')`);
      }
      const { ids, distById, total: geoTotal } = await geoPageIds(prisma, {
        tableSql: Prisma.raw('"labour_listings"'),
        whereSql: Prisma.join(filters, ' AND '),
        lat: userLat, lng: userLng, radiusKm,
        offset: (page - 1) * limit, limit,
        strict, sort,
      });
      total = geoTotal;
      const rows = ids.length
        ? await prisma.labourListing.findMany({ where: { id: { in: ids } }, select: SELECT })
        : [];
      const byId = new Map(rows.map(r => [r.id, r]));
      items = ids.map((id) => {
        const row = byId.get(id);
        if (!row) return null;
        const { bookings, ...rest } = row;
        return toPublicLabour(rest, {
          distanceKm: distById.get(id),
          bookedStatus: deriveBookedStatus(bookings, startOfToday),
        });
      }).filter(Boolean);
    } else {
      const [rows, count] = await Promise.all([
        prisma.labourListing.findMany({
          where,
          orderBy: nonGeoOrderBy(sort),
          skip: (page - 1) * limit,
          take: limit,
          select: SELECT,
        }),
        prisma.labourListing.count({ where }),
      ]);
      total = count;
      items = rows.map(({ bookings, ...rest }) => toPublicLabour(rest, {
        bookedStatus: deriveBookedStatus(bookings, startOfToday),
      }));
    }
    return { data: items, meta: { ...paginationMeta(total, page, limit), sort, hasMore: page * limit < total } };
  };

  const { data, meta, cached } = await cachedListing(NS_LABOUR, identity, RENT_TTL_SEC, load);
  res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
  return sendSuccess(res, data, 200, meta);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load worker listings');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — my listings
// ─────────────────────────────────────────────────────────────────────────────

// [FIX #17] Add pagination to /my listings
router.get('/labour/my', authenticate, async (req, res) => {
  const page  = Math.max(parseInt(req.query.page  || '1'),  1);
  const limit = Math.min(parseInt(req.query.limit || '20'), 50);
  const [items, total] = await Promise.all([
    prisma.labourListing.findMany({
      where:   { providerId: req.user.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.labourListing.count({ where: { providerId: req.user.id, status: 'ACTIVE' } }),
  ]);
  return sendSuccess(res, items, 200, paginationMeta(total, page, limit));
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — detail
// ─────────────────────────────────────────────────────────────────────────────

router.get('/labour/:id', optionalAuth, async (req, res) => {
  try {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const item = await prisma.labourListing.findUnique({
      where: { id: req.params.id },
      select: {
        ...LABOUR_DETAIL_SELECT,
        bookings: {
          where: { status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] }, endDate: { gte: startOfToday } },
          select: { startDate: true, endDate: true, status: true },
          orderBy: { startDate: 'asc' },
          take: 200,
        },
      },
    });
    if (!item || item.status === 'INACTIVE') return sendNotFound(res, 'Labour listing not found');

    const { bookings, ...rest } = item;
    const lat = req.query.lat ? parseFloat(req.query.lat) : null;
    const lng = req.query.lng ? parseFloat(req.query.lng) : null;
    const distanceKm = (Number.isFinite(lat) && Number.isFinite(lng) && item.lat != null && item.lng != null)
      ? haversineKm(lat, lng, item.lat, item.lng)
      : null;

    return sendSuccess(res, {
      ...toPublicLabour(rest, { distanceKm, bookedStatus: deriveBookedStatus(bookings, startOfToday) }),
      bookedRanges: bookings,
      // `phone` is deliberately absent — see /labour/:id/contact.
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load listing');
  }
});

router.get('/labour/:id/contact', authenticate, contactLimit, (req, res) =>
  revealContact(req, res, { kind: 'labour' }).catch((err) =>
    sendServerError(res, err, 'Could not fetch contact details')));

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — availability
// ─────────────────────────────────────────────────────────────────────────────

router.get('/labour/:id/availability', async (req, res) => {
  try {
    const bookings = await bookedRanges({
      labourListingId: req.params.id,
      status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] },
    }, req.query);
    return sendSuccess(res, bookings);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load availability');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — create listing
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/labour',
  authenticate,
  listingCreateLimit,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('skills').isArray({ min: 1 }).withMessage('At least one skill required'),
    body('pricePerDay').isFloat({ min: 1 }).withMessage('pricePerDay must be positive'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('district').trim().notEmpty().withMessage('District is required'),
    ...maxLen(LABOUR_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    const {
      name, leader, groupName, skills, experience, description, languages,
      pricePerDay, pricePerHour, groupSize, image, images, videos, phone,
      location, district, state, availableFrom, availableTo,
      lat, lng,
    } = req.body;

    // [FIX] Validate GPS coordinates
    const parsedLat = lat != null ? parseFloat(lat) : null;
    const parsedLng = lng != null ? parseFloat(lng) : null;
    if (!validateCoords(parsedLat, parsedLng)) {
      return sendError(res, 'Invalid GPS coordinates', 400);
    }

    if (!validateDateWindow(availableFrom, availableTo)) {
      return sendError(res, 'availableTo must be on or after availableFrom', 400);
    }

    const me = await listerIdentity(req.user.id);

    // [FIX] Sanitize all text fields to prevent stored XSS
    const listing = await prisma.labourListing.create({
      data: {
        providerId:   req.user.id,
        name:         stripHtml(name.trim()),
        leader:       stripHtml(leader?.trim())      || null,
        groupName:    stripHtml(groupName?.trim())   || null,
        skills:       Array.isArray(skills) ? skills.map(s => typeof s === 'string' ? stripHtml(s) : s) : [],
        experience:   stripHtml(experience?.trim())  || null,
        description:  stripHtml(description?.trim()) || null,
        languages:    Array.isArray(languages) ? languages : [],
        pricePerDay:  parseFloat(pricePerDay),
        pricePerHour: pricePerHour != null ? parseFloat(pricePerHour) : null,
        groupSize:    groupSize    != null ? parseInt(groupSize)       : 1,
        image:        image        || null,
        images:       Array.isArray(images) ? images : [],
        videos:       Array.isArray(videos) ? videos : [],
        // Same rule as machinery: a lister may only publish their own number.
        phone:        ownPhoneOnly(phone, me.phone),
        location:     stripHtml(location.trim()),
        district:     stripHtml(district.trim()),
        state:        stripHtml((state || me.state || 'Maharashtra').trim()),
        lat:          parsedLat,
        lng:          parsedLng,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        availableTo:   availableTo   ? new Date(availableTo)   : null,
      },
    });

    bumpListingVersion(NS_LABOUR).catch(() => {});
    return sendCreated(res, listing);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — update
// ─────────────────────────────────────────────────────────────────────────────

router.put('/labour/:id', authenticate, rentWriteLimit, maxLen(LABOUR_TEXT_LIMITS), validate, async (req, res) => {
  try {
  const listing = await prisma.labourListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return sendNotFound(res, 'Listing not found');
  if (listing.providerId !== req.user.id) return sendForbidden(res, 'Not your listing');

  const allowed = [
    'name','leader','groupName','skills','experience','description','languages',
    'pricePerDay','pricePerHour','groupSize','image','images','videos','phone',
    'location','district','state','availableFrom','availableTo','available',
    'lat', 'lng',
  ];

  const data = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === 'availableFrom' || key === 'availableTo') {
        data[key] = req.body[key] ? new Date(req.body[key]) : null;
      } else if (['pricePerDay','pricePerHour','lat','lng'].includes(key)) {
        data[key] = req.body[key] != null ? parseFloat(req.body[key]) : null;
      } else if (key === 'groupSize') {
        data[key] = req.body[key] != null ? parseInt(req.body[key]) : 1;
      } else if (key === 'phone') {
        data[key] = ownPhoneOnly(req.body[key], (await listerIdentity(req.user.id)).phone);
      } else if (LABOUR_TEXT_KEYS.has(key)) {
        // CREATE sanitised these; UPDATE did not — the edit form was the way
        // back in for the stored XSS the create path already blocked.
        data[key] = typeof req.body[key] === 'string' ? stripHtml(req.body[key].trim()) : req.body[key];
      } else if (key === 'skills') {
        data[key] = Array.isArray(req.body[key])
          ? req.body[key].map((s) => (typeof s === 'string' ? stripHtml(s) : s))
          : [];
      } else {
        data[key] = req.body[key];
      }
    }
  }

  if (!validateCoords(data.lat ?? listing.lat, data.lng ?? listing.lng)) {
    return sendError(res, 'Invalid GPS coordinates', 400);
  }

  // Validate the resulting availability window (merge incoming changes over existing).
  const effFrom = data.availableFrom !== undefined ? data.availableFrom : listing.availableFrom;
  const effTo   = data.availableTo   !== undefined ? data.availableTo   : listing.availableTo;
  if (!validateDateWindow(effFrom, effTo)) {
    return sendError(res, 'availableTo must be on or after availableFrom', 400);
  }

  const updated = await prisma.labourListing.update({ where: { id: req.params.id }, data });
  bumpListingVersion(NS_LABOUR).catch(() => {});
  return sendSuccess(res, updated);
  } catch (err) {
    return sendServerError(res, err, 'Failed to update listing');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — soft delete
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/labour/:id', authenticate, rentWriteLimit, async (req, res) => {
  const listing = await prisma.labourListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return sendNotFound(res, 'Listing not found');
  if (listing.providerId !== req.user.id) return sendForbidden(res, 'Not your listing');

  // archiveResource flips status→INACTIVE and records a RESOURCE_ARCHIVE event.
  await archiveResource(req, 'LabourListing', listing.id);
  bumpListingVersion(NS_LABOUR).catch(() => {});
  return sendSuccess(res, { message: 'Listing removed' });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — ownership guard
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for "who may touch this booking", so every per-booking
// read/mutation authorizes the same way (no IDOR via inconsistent checks). The
// only parties to a booking are the RENTER (booking.userId) and the LISTING
// OWNER (machinery.ownerId / labour.providerId) — bookings are private to them.
//
// Returns null when the booking does not exist (caller responds 404). Otherwise
// returns the booking plus the caller's relationship flags. Callers decide which
// flag authorizes their specific action and respond 403 when none apply.
async function loadBookingForCaller(bookingId, user) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      machineryListing: true,
      labourListing:    true,
    },
  });
  if (!booking) return null;

  const isRenter = booking.userId === user.id;
  const isOwner  = booking.machineryListing?.ownerId    === user.id
                || booking.labourListing?.providerId === user.id;

  return { booking, isRenter, isOwner };
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — received (owner sees requests on their listings)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/bookings/received', authenticate, async (req, res) => {
  const page  = Math.max(parseInt(req.query.page || '1'), 1);
  const limit = Math.min(parseInt(req.query.limit || '30'), 50);
  const { status } = req.query;

  const where = {
    OR: [
      { machineryListing: { ownerId:    req.user.id } },
      { labourListing:    { providerId: req.user.id } },
    ],
  };
  if (status) where.status = status.toUpperCase();

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user:             { select: { id: true, name: true, phone: true, avatar: true } },
        machineryListing: { select: { id: true, name: true, images: true, location: true } },
        labourListing:    { select: { id: true, name: true, image:  true, location: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  // A request is not yet a relationship. The renter's number reached the owner
  // the instant a PENDING request arrived, so anyone could surface a stranger's
  // phone by requesting their listing and never following through. Numbers are
  // exchanged once the booking is CONFIRMED — the point at which both sides
  // have agreed to deal.
  const redacted = items.map((b) => redactBookingContacts(b, req.user.id));
  return sendSuccess(res, redacted, 200, paginationMeta(total, page, limit));
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — pending count (badge for owner's notification bell)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/bookings/received/pending-count', authenticate, async (req, res) => {
  const count = await prisma.booking.count({
    where: {
      status: 'PENDING',
      OR: [
        { machineryListing: { ownerId:    req.user.id } },
        { labourListing:    { providerId: req.user.id } },
      ],
    },
  });
  return sendSuccess(res, { count });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — approve (owner confirms a pending booking)
// ─────────────────────────────────────────────────────────────────────────────

router.put('/bookings/:id/approve', authenticate, rentWriteLimit, async (req, res) => {
  const ctx = await loadBookingForCaller(req.params.id, req.user);
  if (!ctx) return sendNotFound(res, 'Booking not found');
  // Approving is the listing owner's action — not the renter's.
  if (!ctx.isOwner) return sendForbidden(res, 'Not your listing');
  const { booking } = ctx;

  if (booking.status !== 'PENDING')
    return sendError(res, 'Only pending bookings can be approved', 400);

  const updated = await prisma.booking.update({
    where: { id: req.params.id },
    data:  { status: 'CONFIRMED' },
  });

  // Notify the customer that their booking was approved
  const listingName = booking.machineryListing?.name || booking.labourListing?.name || 'Listing';
  await prisma.notification.create({
    data: {
      userId: booking.userId,
      type:   'BOOKING_UPDATE',
      title:  'Booking Approved!',
      body:   `Your booking for "${listingName}" has been confirmed by the owner.`,
      data:   { bookingId: booking.id },
    },
  }).catch(() => {});

  // bookedStatus is baked into the cached list payload, so a state change
  // has to orphan both catalogues or the grid keeps advertising a machine
  // that is now reserved.
  Promise.all([bumpListingVersion(NS_MACHINERY), bumpListingVersion(NS_LABOUR)]).catch(() => {});

  return sendSuccess(res, updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — reject (owner declines a pending booking)
// ─────────────────────────────────────────────────────────────────────────────

router.put('/bookings/:id/reject', authenticate, rentWriteLimit, async (req, res) => {
  const ctx = await loadBookingForCaller(req.params.id, req.user);
  if (!ctx) return sendNotFound(res, 'Booking not found');
  // Rejecting is the listing owner's action — not the renter's.
  if (!ctx.isOwner) return sendForbidden(res, 'Not your listing');
  const { booking } = ctx;

  if (booking.status !== 'PENDING')
    return sendError(res, 'Only pending bookings can be rejected', 400);

  const updated = await prisma.booking.update({
    where: { id: req.params.id },
    data:  { status: 'CANCELLED' },
  });

  // Notify the customer that their booking was rejected
  const listingName = booking.machineryListing?.name || booking.labourListing?.name || 'Listing';
  await prisma.notification.create({
    data: {
      userId: booking.userId,
      type:   'BOOKING_UPDATE',
      title:  'Booking Not Approved',
      body:   `Your booking request for "${listingName}" was declined by the owner.`,
      data:   { bookingId: booking.id },
    },
  }).catch(() => {});

  return sendSuccess(res, updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — my bookings
// ─────────────────────────────────────────────────────────────────────────────

router.get('/bookings', authenticate, async (req, res) => {
  const page  = Math.max(parseInt(req.query.page || '1'), 1);
  const limit = Math.min(parseInt(req.query.limit || '20'), 50);
  const { status, type } = req.query;

  const where = { userId: req.user.id };
  if (status) where.status = status.toUpperCase();
  if (type === 'machinery') where.machineryListingId = { not: null };
  if (type === 'labour')    where.labourListingId    = { not: null };

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      // `id` tiebreaker — two bookings created in the same millisecond (or with
      // the same createdAt after a bulk import) otherwise ordered arbitrarily,
      // so page 2 could repeat one and drop another.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        machineryListing: { select: { id: true, name: true, images: true, location: true, ownerPhone: true } },
        labourListing:    { select: { id: true, name: true, image: true,  location: true, phone: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  // The owner's number rides along only once the booking is CONFIRMED — at
  // which point the renter genuinely needs it to arrange the handover.
  const redacted = items.map((b) => redactBookingContacts(b, req.user.id));
  return sendSuccess(res, redacted, 200, paginationMeta(total, page, limit));
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — create
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/bookings',
  authenticate,
  bookingLimit,
  idemBooking,
  [
    body('startDate').isISO8601().withMessage('startDate must be a valid date'),
    body('endDate').isISO8601().withMessage('endDate must be a valid date'),
    // `days` is still accepted for backward compatibility but is IGNORED — see
    // the note below. It is validated only so an old client's payload does not
    // suddenly 400.
    body('days').optional().isInt({ min: 1 }),
    // [FIX #6] totalAmount is now optional — server calculates it from listing price
    body('totalAmount').optional().isFloat({ min: 0 }),
    body('workerCount').optional().isInt({ min: 1, max: 500 }),
    body('hours').optional().isInt({ min: 1, max: 24 }),
    body('notes').optional().trim().isLength({ max: 1000 }),
  ],
  validate,
  async (req, res) => {
    const {
      machineryListingId, labourListingId,
      startDate, endDate, hours, workerCount, notes,
    } = req.body;

    if (!machineryListingId && !labourListingId) {
      return sendError(res, 'Either machineryListingId or labourListingId is required', 400);
    }
    if (machineryListingId && labourListingId) {
      return sendError(res, 'A booking is for either machinery or a worker, not both', 400);
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);

    if (end < start) return sendError(res, 'endDate must be after startDate', 400);

    // The billed day count is DERIVED from the date range, never taken from the
    // client. `days` used to come straight off the request and multiply the
    // daily rate, so a booking for 1–30 January with days:1 blocked the machine
    // for a month and charged for one day. The range is the only thing both
    // sides can verify, so it is the only thing that decides the price.
    const days = daysBetweenInclusive(start, end);
    if (days > 365) return sendError(res, 'A booking cannot be longer than a year', 400);

    // [FIX #1] Wrap conflict check + booking create in a Serializable transaction
    // to prevent double-booking when concurrent requests hit the same slot.
    //
    // The isolation level is what makes double-booking impossible; the retry is
    // what makes losing that race survivable. Ten clients hitting one slot all
    // read "no conflict" and all try to insert, so Postgres aborts nine with
    // SQLSTATE 40001 — and without a replay every one of those nine answered
    // 500 "Booking failed", which is both wrong (nothing failed on the server)
    // and harmful (a 5xx is what the mobile client retries, so the losers came
    // straight back). Replaying re-reads the slot and returns the truthful 409.
    //
    // tests/backend/load/booking-concurrency.test.js asserts exactly this and
    // had never once executed: the phone factory it provisions its ten racers
    // with collided on `users.phone` before the first request was ever sent.
    try {
      const booking = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        const conflictWhere = {
          status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] },
          OR: [
            { startDate: { gte: start, lte: end } },
            { endDate:   { gte: start, lte: end } },
            { startDate: { lte: start }, endDate: { gte: end } },
          ],
        };

        let serverAmount = 0;

        if (machineryListingId) {
          conflictWhere.machineryListingId = machineryListingId;
          const listing = await tx.machineryListing.findUnique({ where: { id: machineryListingId } });
          if (!listing || listing.status !== 'ACTIVE') {
            throw Object.assign(new Error('Machinery listing not available'), { statusCode: 400, expose: true });
          }

          // Owners cannot book their own listing
          if (listing.ownerId === req.user.id) {
            throw Object.assign(new Error('You cannot book your own listing'), { statusCode: 403, expose: true });
          }

          // Booking must lie within the listing's availability window
          if (!withinAvailability(startDate, endDate, listing.availableFrom, listing.availableTo)) {
            throw Object.assign(new Error("Selected dates are outside this listing's availability window"), { statusCode: 400, expose: true });
          }

          const conflict = await tx.booking.findFirst({ where: conflictWhere });
          if (conflict) {
            throw Object.assign(new Error('Machinery is already booked for these dates'), { statusCode: 409, expose: true });
          }

          // [FIX #6] Server-calculate totalAmount from listing price (exact Decimal)
          serverAmount = D(listing.pricePerDay).times(days).toDecimalPlaces(2);
        }

        if (labourListingId) {
          conflictWhere.labourListingId = labourListingId;
          const listing = await tx.labourListing.findUnique({ where: { id: labourListingId } });
          if (!listing || listing.status !== 'ACTIVE') {
            throw Object.assign(new Error('Labour listing not available'), { statusCode: 400, expose: true });
          }

          // Providers cannot book their own listing
          if (listing.providerId === req.user.id) {
            throw Object.assign(new Error('You cannot book your own listing'), { statusCode: 403, expose: true });
          }

          // Booking must lie within the listing's availability window
          if (!withinAvailability(startDate, endDate, listing.availableFrom, listing.availableTo)) {
            throw Object.assign(new Error("Selected dates are outside this listing's availability window"), { statusCode: 400, expose: true });
          }

          const conflict = await tx.booking.findFirst({ where: conflictWhere });
          if (conflict) {
            throw Object.assign(new Error('Worker is already booked for these dates'), { statusCode: 409, expose: true });
          }

          // [FIX #6] Server-calculate totalAmount from listing price (exact Decimal)
          const wc = workerCount != null ? parseInt(workerCount) : 1;
          serverAmount = D(listing.pricePerDay).times(days).times(wc).toDecimalPlaces(2);
        }

        return tx.booking.create({
          data: {
            userId:             req.user.id,
            machineryListingId: machineryListingId || null,
            labourListingId:    labourListingId    || null,
            startDate:          start,
            endDate:            end,
            days,   // derived from the date range, not the request body
            hours:              hours != null ? parseInt(hours) : null,
            workerCount:        workerCount != null ? parseInt(workerCount) : 1,
            totalAmount:        serverAmount,
            notes:              notes?.trim() || null,
            status:             'PENDING',
          },
          include: {
            machineryListing: { select: { name: true, ownerName: true, ownerPhone: true } },
            labourListing:    { select: { name: true, phone: true } },
          },
        });
      }, {
        isolationLevel: 'Serializable', // prevents concurrent double-bookings
      }));

      // Notify the listing owner (fire-and-forget, outside the critical transaction)
      const listingName  = booking.machineryListing?.name || booking.labourListing?.name || 'your listing';
      const ownerIdQuery = machineryListingId
        ? prisma.machineryListing.findUnique({ where: { id: machineryListingId }, select: { ownerId: true } })
        : prisma.labourListing.findUnique({    where: { id: labourListingId },    select: { providerId: true } });

      ownerIdQuery.then(async (rec) => {
        const ownerId = rec?.ownerId || rec?.providerId;
        if (!ownerId || ownerId === req.user.id) return;
        await prisma.notification.create({
          data: {
            userId: ownerId,
            type:   'BOOKING_UPDATE',
            title:  'New Booking Request',
            body:   `Someone wants to rent "${listingName}" — tap to review the request.`,
            data:   { bookingId: booking.id },
          },
        });
      }).catch(() => {});

      return sendCreated(res, booking);
    } catch (err) {
      return sendServerError(res, err, 'Booking failed. Please try again.');
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — detail
// ─────────────────────────────────────────────────────────────────────────────

router.get('/bookings/:id', authenticate, async (req, res) => {
  const ctx = await loadBookingForCaller(req.params.id, req.user);
  if (!ctx) return sendNotFound(res, 'Booking not found');
  // Both parties to the booking may view it: the renter and the listing owner.
  // Anyone else is forbidden — prevents IDOR on booking detail.
  if (!ctx.isRenter && !ctx.isOwner) {
    return sendForbidden(res, 'You are not authorized to view this booking');
  }
  // The full listing rows were returned verbatim, so the renter saw the owner's
  // ownerPhone (and the listing's exact coordinates) on a booking the owner had
  // not yet accepted. Both are held back until CONFIRMED.
  return sendSuccess(res, redactBookingContacts(ctx.booking, req.user.id));
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — cancel
// ─────────────────────────────────────────────────────────────────────────────

router.put('/bookings/:id/cancel', authenticate, rentWriteLimit, async (req, res) => {
  const ctx = await loadBookingForCaller(req.params.id, req.user);
  if (!ctx) return sendNotFound(res, 'Booking not found');
  // Cancelling is the renter's action. The listing owner declines via /reject,
  // so they are not authorized here.
  if (!ctx.isRenter) {
    return sendForbidden(res, 'You are not authorized to cancel this booking');
  }
  const { booking } = ctx;
  if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
    return sendError(res, `Cannot cancel a ${booking.status.toLowerCase()} booking`, 400);
  }

  const updated = await prisma.booking.update({
    where: { id: req.params.id },
    data:  { status: 'CANCELLED' },
  });
  return sendSuccess(res, updated);
});

export default router;
