/**
 * Animal Trade Routes
 *
 * Listings
 *   GET    /api/v1/animals                 public list — filters, sort, radius, cursor/page
 *   GET    /api/v1/animals/meta            master data (types, breeds, per-type form fields)
 *   GET    /api/v1/animals/my              (auth) my listings
 *   GET    /api/v1/animals/:id             public detail (no phone, no coordinates)
 *   GET    /api/v1/animals/:id/similar     nearby listings of the same animal
 *   GET    /api/v1/animals/:id/contact     (auth, rate limited, audited) reveal seller phone
 *   POST   /api/v1/animals                 (auth, multipart, idempotent)
 *   PUT    /api/v1/animals/:id             (auth, owner)
 *   PATCH  /api/v1/animals/:id/status      (auth, owner) available / sold / hidden
 *   POST   /api/v1/animals/:id/renew       (auth, owner) push out the expiry
 *   DELETE /api/v1/animals/:id             (auth, owner) soft delete
 *   POST   /api/v1/animals/:id/report      (auth) report a listing
 *   POST   /api/v1/animals/sellers/:sellerId/block    (auth) block / unblock a seller
 *   DELETE /api/v1/animals/sellers/:sellerId/block
 *
 * Chat
 *   GET    /api/v1/animals/chats/my                 (auth) inbox
 *   GET    /api/v1/animals/:id/chats                (auth, owner) chats on one listing
 *   POST   /api/v1/animals/:id/chat                 (auth) open/upsert a chat
 *   GET    /api/v1/animals/chats/:chatId/messages   (auth) newest-first cursor history
 *   POST   /api/v1/animals/chats/:chatId/messages   (auth) { text, clientMsgId? }
 *
 * Two invariants hold across every handler here:
 *   • The seller's exact lat/lng and phone number NEVER appear in a public
 *     response. Distance is coarsened to whole km; the phone is behind an
 *     authenticated, rate-limited, audit-logged reveal.
 *   • Ownership and verification are decided from the DATABASE row, never from
 *     anything the client sent.
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { Prisma } from '@prisma/client';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { validate } from '../middleware/validate.js';
import { maxLen } from '../middleware/textLength.js';
import { rateLimiter, clientIp } from '../middleware/rateLimit.js';
import { idempotency } from '../middleware/idempotency.js';
import { sanitizeSearch } from '../utils/sanitizeSearch.js';
import { createUploader, uploadFiles } from '../config/cloudinary.js';
import prisma from '../config/db.js';
import {
  sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendServerError,
  paginationMeta, parsePageSize,
} from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';
import { haversineKm, geoPageIds } from '../utils/geo.js';
import { archiveResource } from '../services/softDelete.service.js';
import { sendPushToUser } from '../services/push.service.js';
import { auditLog } from '../services/audit.service.js';
import { cachedListing, bumpListingVersion } from '../utils/listingCache.js';
import { normalizedColumns, searchGroups } from '../utils/animalNormalize.js';
import { getSetting } from '../services/settings.service.js';
import { ANIMAL_MASTER_DATA } from '../constants/animalMaster.js';
import logger from '../utils/logger.js';
import {
  NS_ANIMALS, ANIMALS_TTL_SEC, LIST_SELECT, DETAIL_SELECT,
  toPublicListing, toPublicDetail, blockedUserIds, isBlockedBetween,
  listingExpiry, findRecentDuplicate, coarseDistanceKm,
} from '../services/animalListing.service.js';

const router = Router();
router.param('id', uuidParamGuard);       // animal listing id
router.param('chatId', uuidParamGuard);   // animal chat id
router.param('sellerId', uuidParamGuard); // block/unblock target
const imageUpload = createUploader(6);    // 1–6 photos per the post-ad flow

// ── Rate limits ──────────────────────────────────────────────────────────────
// Every one of these is keyed on the authenticated user (falling back to the
// trust-proxy-resolved IP) and backed by Redis, so the cap is shared across
// instances and cannot be shed by reconnecting to another pod. The numbers are
// set well above what a farmer browsing or posting actually does — they exist to
// bound scrapers and spam, not to get in a real user's way.

const searchLimit = rateLimiter({
  windowMs: 60_000,
  max: 120,                              // 2 searches/sec sustained — debounce makes real use ~10/min
  prefix: 'animals:search',
  key: (req) => req.user?.id || clientIp(req),
  message: 'Too many searches. Please wait a moment and try again.',
});

const createLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 15,                               // 15 new listings/hour/seller
  prefix: 'animals:create',
  key: (req) => req.user?.id || clientIp(req),
  message: 'You have posted a lot of listings recently. Please try again later.',
});

const writeLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  prefix: 'animals:write',
  key: (req) => req.user?.id || clientIp(req),
  message: 'Too many changes. Please wait a few minutes and try again.',
});

// Contact reveal is the scraping surface: it is the only way to obtain a phone
// number, so it is the tightest limit on this router and every call is audited.
const contactLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,                               // 30 sellers/hour — a buyer contacts a handful
  prefix: 'animals:contact',
  key: (req) => req.user?.id || clientIp(req),
  message: 'You have viewed a lot of contact numbers. Please try again later.',
});

const messageLimit = rateLimiter({
  windowMs: 60_000,
  max: 30,                               // 30 messages/min — fast typing, not a flood
  prefix: 'animals:msg',
  key: (req) => req.user?.id || clientIp(req),
  message: 'You are sending messages too quickly. Please slow down.',
});

const reportLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  prefix: 'animals:report',
  key: (req) => req.user?.id || clientIp(req),
  message: 'Too many reports. Please try again later.',
});

const idemAnimalCreate = idempotency('animal_create');

// Pretty Indian phone label used when a chat participant has no name set.
function prettyPhone(p) {
  if (!p) return null;
  const d = String(p).replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : String(p);
}

/**
 * Sort keys accepted by the list endpoint, mapped to a Prisma orderBy.
 *
 * `id` is always the final tiebreaker: rows sharing a createdAt or a price
 * ordered arbitrarily between queries, so page 2 could repeat or skip a row that
 * page 1 already showed — the "duplicate listings while paginating" bug.
 */
const SORTS = {
  latest:     [{ createdAt: 'desc' }, { id: 'desc' }],
  price_asc:  [{ price: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
  price_desc: [{ price: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  // Relevance without a search term is meaningless; the resolver below falls
  // back to `latest`. With a term, verified listings float up first.
  relevance:  [{ verified: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  // nearest is handled by the SQL geo path and never reaches this table.
};

/** Public sort key → the ordering mode geoPageIds understands. */
const GEO_SORT = {
  nearest: 'distance',
  latest: 'recent',
  relevance: 'recent',
  price_asc: 'price',
  price_desc: 'price_desc',
};

function resolveSort(raw, { hasCoords, hasSearch }) {
  const key = String(raw || '').toLowerCase();
  if (key === 'nearest') return hasCoords ? 'nearest' : 'latest';
  if (key === 'relevance') return hasSearch ? 'relevance' : 'latest';
  if (SORTS[key]) return key;
  // Legacy client values from before server-side sorting existed.
  if (key === 'sortpricelow') return 'price_asc';
  if (key === 'sortpricehigh') return 'price_desc';
  if (key === 'sortlatest' || key === '') return 'latest';
  return 'latest';
}

/** Numeric query param → finite number, or null. Never NaN into a filter. */
function num(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function bool(raw) {
  if (raw === 'true' || raw === true) return true;
  if (raw === 'false' || raw === false) return false;
  return null;
}

/**
 * Build the Prisma `where` for the non-geo path.
 *
 * Search prefers the normalised `searchText` haystack (one trigram index, and it
 * carries the Marathi/English aliases). Rows that predate the backfill have a
 * NULL searchText, so they are still matched by the legacy per-column ILIKEs —
 * the marketplace stays complete during the rollout instead of appearing to lose
 * half its listings.
 */
function buildWhere(f) {
  const and = [{ status: f.status || 'ACTIVE' }];

  if (f.animal)   and.push({ animal: { equals: f.animal, mode: 'insensitive' } });
  if (f.breed)    and.push({ breed: { contains: f.breed, mode: 'insensitive' } });
  if (f.gender)   and.push({ gender: f.gender });
  if (f.district) and.push({ sellerLocation: { contains: f.district, mode: 'insensitive' } });
  if (f.verified === true)   and.push({ verified: true });
  if (f.vaccinated === true) and.push({ vaccinated: true });
  if (f.healthCertificate === true) and.push({ healthCertificate: true });
  if (f.blockedIds?.length)  and.push({ sellerId: { notIn: f.blockedIds } });

  if (f.minPrice != null || f.maxPrice != null) {
    and.push({ price: { ...(f.minPrice != null && { gte: f.minPrice }), ...(f.maxPrice != null && { lte: f.maxPrice }) } });
  }
  if (f.minAgeMonths != null || f.maxAgeMonths != null) {
    and.push({ ageMonths: { ...(f.minAgeMonths != null && { gte: f.minAgeMonths }), ...(f.maxAgeMonths != null && { lte: f.maxAgeMonths }) } });
  }
  if (f.minMilk != null) and.push({ milkYieldLpd: { gte: f.minMilk } });

  // Each group is one word of the query (OR'd with its Marathi/English
  // equivalents); the groups are AND'd, so "jersey cow" needs BOTH words rather
  // than returning every cow because one of them matched.
  for (const group of f.searchGroups || []) {
    and.push({
      OR: [
        ...group.map((term) => ({ searchText: { contains: term, mode: 'insensitive' } })),
        // Not yet backfilled → judge it on the original columns.
        {
          searchText: null,
          OR: group.flatMap((term) => ([
            { animal:         { contains: term, mode: 'insensitive' } },
            { breed:          { contains: term, mode: 'insensitive' } },
            { sellerLocation: { contains: term, mode: 'insensitive' } },
          ])),
        },
      ],
    });
  }

  return { AND: and };
}

// Enum comparisons in raw SQL need a typed literal, and the value must come
// from a fixed table — never interpolated from the request — so the SQL text
// itself stays constant regardless of input.
const STATUS_SQL = {
  ACTIVE:   Prisma.sql`status = 'ACTIVE'`,
  SOLD:     Prisma.sql`status = 'SOLD'`,
  INACTIVE: Prisma.sql`status = 'INACTIVE'`,
};
const GENDER_SQL = {
  MALE:   Prisma.sql`gender = 'MALE'`,
  FEMALE: Prisma.sql`gender = 'FEMALE'`,
};

/** The same predicate set as buildWhere(), as raw SQL for the geo path. */
function buildSqlFilters(f) {
  const filters = [STATUS_SQL[f.status] || STATUS_SQL.ACTIVE];

  if (f.animal)   filters.push(Prisma.sql`animal ILIKE ${f.animal}`);
  if (f.breed)    filters.push(Prisma.sql`breed ILIKE '%' || ${f.breed} || '%'`);
  if (f.gender && GENDER_SQL[f.gender]) filters.push(GENDER_SQL[f.gender]);
  if (f.district) filters.push(Prisma.sql`"sellerLocation" ILIKE '%' || ${f.district} || '%'`);
  if (f.verified === true)          filters.push(Prisma.sql`verified = true`);
  if (f.vaccinated === true)        filters.push(Prisma.sql`vaccinated = true`);
  if (f.healthCertificate === true) filters.push(Prisma.sql`"healthCertificate" = true`);
  if (f.blockedIds?.length) {
    filters.push(Prisma.sql`"sellerId" NOT IN (${Prisma.join(f.blockedIds)})`);
  }
  if (f.minPrice != null) filters.push(Prisma.sql`price >= ${f.minPrice}`);
  if (f.maxPrice != null) filters.push(Prisma.sql`price <= ${f.maxPrice}`);
  if (f.minAgeMonths != null) filters.push(Prisma.sql`"ageMonths" >= ${f.minAgeMonths}`);
  if (f.maxAgeMonths != null) filters.push(Prisma.sql`"ageMonths" <= ${f.maxAgeMonths}`);
  if (f.minMilk != null)      filters.push(Prisma.sql`"milkYieldLpd" >= ${f.minMilk}`);

  for (const group of f.searchGroups || []) {
    const perTerm = group.map((term) => Prisma.sql`(
      ("searchText" IS NOT NULL AND "searchText" ILIKE '%' || ${term} || '%')
      OR ("searchText" IS NULL AND (
        animal ILIKE '%' || ${term} || '%'
        OR breed ILIKE '%' || ${term} || '%'
        OR "sellerLocation" ILIKE '%' || ${term} || '%'))
    )`);
    filters.push(Prisma.sql`(${Prisma.join(perTerm, ' OR ')})`);
  }

  return Prisma.join(filters, ' AND ');
}

/** Parse the shared filter set out of the query string, once, safely. */
function parseFilters(req, blockedIds) {
  const rawSearch = sanitizeSearch(req.query.search);
  return {
    animal:   sanitizeSearch(req.query.animal, 60),
    breed:    sanitizeSearch(req.query.breed, 60),
    district: sanitizeSearch(req.query.district),
    gender:   ['MALE', 'FEMALE'].includes(req.query.gender) ? req.query.gender : null,
    minPrice: num(req.query.minPrice),
    maxPrice: num(req.query.maxPrice),
    minAgeMonths: num(req.query.minAgeMonths),
    maxAgeMonths: num(req.query.maxAgeMonths),
    minMilk:  num(req.query.minMilk),
    verified:          bool(req.query.verified),
    vaccinated:        bool(req.query.vaccinated),
    healthCertificate: bool(req.query.healthCertificate),
    // AND-of-OR groups: one group per query word, each carrying that word's
    // Marathi/English equivalents. Empty for a blank search.
    searchGroups: rawSearch ? searchGroups(rawSearch) : [],
    rawSearch,
    status: 'ACTIVE',
    blockedIds,
  };
}

// ── Chat inbox (must be registered BEFORE /:id to win path matching) ─────────
// GET /chats/my — every chat the current user is part of (as buyer OR seller),
// across ALL their animal listings. Used to render the "Chat with Seller"
// inbox launched from AnimalTradeHome.
router.get('/chats/my', authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const limit = parsePageSize(req.query.limit, 30, 100);
    const chats = await prisma.chat.findMany({
      where: { OR: [{ buyerId: me }, { sellerId: me }] },
      include: {
        listing: {
          select: { id: true, animal: true, breed: true, images: true, price: true, status: true },
        },
        // No `phone` here. The inbox renders a name (or a role label); handing
        // every chat partner's number to the client turned the inbox into a
        // contact dump that never required a deliberate reveal.
        buyer:  { select: { id: true, name: true, avatar: true } },
        seller: { select: { id: true, name: true, avatar: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { senderId: { not: me }, readAt: null } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    const rows = chats.map((c) => {
      const isBuyer = c.buyerId === me;
      const counterpart = isBuyer ? c.seller : c.buyer;
      const last = c.messages[0] || null;
      return {
        id: c.id,
        listingId: c.listingId,
        listing: c.listing,
        role: isBuyer ? 'buyer' : 'seller',
        counterpart,
        unreadCount: c._count?.messages ?? 0,
        lastMessage: last ? {
          text: last.text,
          imageUrl: last.imageUrl,
          createdAt: last.createdAt,
          mine: last.senderId === me,
        } : null,
        updatedAt: c.updatedAt,
      };
    });

    return sendSuccess(res, rows);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load chats');
  }
});

// ── Master data ──────────────────────────────────────────────────────────────
// Animal types, their breeds and which fields the post-ad form should ask for.
// Admin-editable at runtime (settings key `animals.masterData`) so a new breed
// does not need an app release. Cached hard on the client via ETag semantics
// upstream; here it is just a cheap settings read.
router.get('/meta', async (req, res) => {
  try {
    const data = await getSetting('animals.masterData');
    // A malformed override must not blank the post-ad form.
    const safe = data && Array.isArray(data.types) && data.types.length ? data : ANIMAL_MASTER_DATA;
    res.setHeader('Cache-Control', 'public, max-age=300');
    return sendSuccess(res, safe);
  } catch {
    return sendSuccess(res, ANIMAL_MASTER_DATA);
  }
});

// ── Listings ──────────────────────────────────────────────────────────────────
router.get(
  '/',
  optionalAuth,
  searchLimit,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('minPrice').optional().isFloat({ min: 0 }),
    query('maxPrice').optional().isFloat({ min: 0 }),
    query('minAgeMonths').optional().isInt({ min: 0, max: 600 }),
    query('maxAgeMonths').optional().isInt({ min: 0, max: 600 }),
    query('minMilk').optional().isFloat({ min: 0, max: 100 }),
    query('lat').optional().isFloat({ min: -90, max: 90 }),
    query('lng').optional().isFloat({ min: -180, max: 180 }),
    query('radius').optional().isFloat({ min: 1, max: 500 }),
    query('sort').optional().isString().isLength({ max: 20 }),
  ],
  validate,
  async (req, res) => {
    try {
      const page  = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
      const limit = parsePageSize(req.query.limit, 20, 50);
      const lat = num(req.query.lat);
      const lng = num(req.query.lng);
      const radius = num(req.query.radius);
      const hasCoords = lat != null && lng != null;

      // Blocked sellers are filtered in SQL, for the authenticated viewer only.
      const blockedIds = await blockedUserIds(req.user?.id);
      const f = parseFilters(req, blockedIds);
      const sort = resolveSort(req.query.sort, { hasCoords, hasSearch: !!f.rawSearch });

      // Personalised results (a viewer with blocks) must never be served from —
      // or written to — the shared public cache. Anonymous/unblocked traffic,
      // which is the overwhelming majority, still gets the cache.
      const cacheable = blockedIds.length === 0;
      const identity = JSON.stringify([
        f.animal || '', f.breed || '', f.district || '', f.gender || '',
        f.minPrice, f.maxPrice, f.minAgeMonths, f.maxAgeMonths, f.minMilk,
        f.verified, f.vaccinated, f.healthCertificate,
        f.rawSearch || '', sort, page, limit,
        // Coordinates are bucketed into ~1 km cells for the cache key: two
        // farmers in the same village share a cache entry instead of each
        // minting their own, and the key itself never records a precise home.
        hasCoords ? Math.round(lat * 100) / 100 : '',
        hasCoords ? Math.round(lng * 100) / 100 : '',
        hasCoords ? (radius ?? '') : '',
      ]);

      const load = async () => {
        let rows = [];
        let total = 0;
        let distById = null;

        if (hasCoords) {
          // Bounding box + Haversine circle + ordering + LIMIT/OFFSET all run in
          // Postgres. The previous implementation SELECTed every id inside the
          // radius, shipped them to Node, and fed them back as a `WHERE id IN
          // (…)` list — unbounded memory and a query that grew with the size of
          // the marketplace rather than the size of the page.
          const geo = await geoPageIds(prisma, {
            tableSql: Prisma.raw('"animal_listings"'),
            whereSql: buildSqlFilters(f),
            lat, lng,
            // `radius` absent = "All": distances are still computed (so the UI
            // keeps its km badges) but nothing is excluded for being far.
            radiusKm: radius ?? null,
            offset: (page - 1) * limit,
            limit,
            // A radius query must not silently include rows with no
            // coordinates — "within 25 km" has to mean it.
            strict: radius != null,
            // The chosen ordering is applied IN SQL, over the whole filtered
            // set. Re-sorting the returned page in JS would order the 20
            // nearest rows by price/date instead of returning the 20 cheapest
            // or newest within the radius — a subtly wrong answer that only
            // shows up once there are more listings than fit on a page.
            sort: GEO_SORT[sort] || 'distance',
            priceColSql: Prisma.sql`price`,
            ratingColSql: Prisma.sql`0`, // animal_listings has no rating column
          });
          total = geo.total;
          distById = geo.distById;
          const hydrated = geo.ids.length
            ? await prisma.animalListing.findMany({ where: { id: { in: geo.ids } }, select: LIST_SELECT })
            : [];
          const byId = new Map(hydrated.map((r) => [r.id, r]));
          rows = geo.ids.map((id) => byId.get(id)).filter(Boolean);
        } else {
          const where = buildWhere(f);
          [rows, total] = await Promise.all([
            prisma.animalListing.findMany({
              where,
              select: LIST_SELECT,
              skip: (page - 1) * limit,
              take: limit,
              orderBy: SORTS[sort] || SORTS.latest,
            }),
            prisma.animalListing.count({ where }),
          ]);
        }

        return {
          data: rows.map((r) => toPublicListing(r, distById ? distById.get(r.id) : null)),
          meta: {
            ...paginationMeta(total, page, limit),
            sort,
            // Lets the client show "showing 20 of 63 within 25 km" and decide
            // whether a "load more" is worth offering.
            hasMore: page * limit < total,
            appliedRadiusKm: hasCoords ? (radius ?? null) : null,
          },
        };
      };

      const { data, meta, cached } = cacheable
        ? await cachedListing(NS_ANIMALS, identity, ANIMALS_TTL_SEC, load)
        : { ...(await load()), cached: false };

      res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
      return sendSuccess(res, data, 200, meta);
    } catch (err) {
      return sendServerError(res, err, 'Failed to load animal listings');
    }
  },
);

// My listings — includes SOLD and expired rows, which the public list hides,
// because the seller needs to see and act on them.
router.get('/my', authenticate, async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = parsePageSize(req.query.limit, 20, 50);
    const where = { sellerId: req.user.id, status: { not: 'INACTIVE' } };
    const [listings, total] = await Promise.all([
      prisma.animalListing.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: { ...DETAIL_SELECT, _count: { select: { chats: true } } },
      }),
      prisma.animalListing.count({ where }),
    ]);
    const rows = listings.map((l) => ({
      ...toPublicDetail(l),
      chatCount: l._count?.chats ?? 0,
      isExpired: !!(l.expiresAt && l.expiresAt < new Date()),
    }));
    return sendSuccess(res, rows, 200, paginationMeta(total, page, limit));
  } catch (err) {
    return sendServerError(res, err, 'Failed to load listings');
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const listing = await prisma.animalListing.findUnique({
      where: { id: req.params.id },
      select: DETAIL_SELECT,
    });
    if (!listing) return sendNotFound(res, 'Animal listing');

    // A soft-deleted listing used to stay fetchable by id forever, so a shared
    // link kept working after the seller removed the ad. Only the owner and an
    // admin can see a non-ACTIVE row now.
    const isOwner = req.user?.id === listing.sellerId;
    const isAdmin = req.user?.role === 'ADMIN';
    if (listing.status === 'INACTIVE' && !isOwner && !isAdmin) {
      return sendNotFound(res, 'Animal listing');
    }
    if (!isOwner && await isBlockedBetween(req.user?.id, listing.sellerId)) {
      return sendNotFound(res, 'Animal listing');
    }

    const [sellerListingCount] = await Promise.all([
      prisma.animalListing.count({ where: { sellerId: listing.sellerId, status: 'ACTIVE' } }),
      // View counting is a write on a read path. Skip it for the owner (a seller
      // refreshing their own ad used to inflate its view count) and never let a
      // failure affect the response.
      isOwner ? Promise.resolve() : prisma.animalListing
        .update({ where: { id: listing.id }, data: { viewCount: { increment: 1 } } })
        .catch(() => {}),
    ]);

    // Distance is computed here from the caller's own coordinates and returned
    // coarsened; the listing's lat/lng are stripped by toPublicDetail.
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    const distanceKm = (lat != null && lng != null && listing.lat != null && listing.lng != null)
      ? haversineKm(lat, lng, listing.lat, listing.lng)
      : null;

    return sendSuccess(res, toPublicDetail(listing, { distanceKm, sellerListingCount }));
  } catch (err) {
    return sendServerError(res, err, 'Failed to load listing');
  }
});

// Similar animals — same type, other sellers, nearest first when we know where
// the viewer is. Small, cheap, and deliberately capped.
router.get('/:id/similar', optionalAuth, async (req, res) => {
  try {
    const base = await prisma.animalListing.findUnique({
      where: { id: req.params.id },
      select: { id: true, animal: true, sellerId: true, lat: true, lng: true, price: true },
    });
    if (!base) return sendNotFound(res, 'Animal listing');

    const blockedIds = await blockedUserIds(req.user?.id);
    const lat = num(req.query.lat) ?? base.lat;
    const lng = num(req.query.lng) ?? base.lng;
    const limit = parsePageSize(req.query.limit, 6, 12);

    const where = {
      status: 'ACTIVE',
      id: { not: base.id },
      animal: { equals: base.animal, mode: 'insensitive' },
      ...(blockedIds.length ? { sellerId: { notIn: blockedIds } } : {}),
    };

    if (lat != null && lng != null) {
      const geo = await geoPageIds(prisma, {
        tableSql: Prisma.raw('"animal_listings"'),
        whereSql: Prisma.sql`status = 'ACTIVE'::"ListingStatus" AND id <> ${base.id} AND animal ILIKE ${base.animal}
          ${blockedIds.length ? Prisma.sql`AND "sellerId" NOT IN (${Prisma.join(blockedIds)})` : Prisma.empty}`,
        lat, lng, radiusKm: 150, offset: 0, limit, strict: false,
        sort: 'distance', priceColSql: Prisma.sql`price`,
      });
      const rows = geo.ids.length
        ? await prisma.animalListing.findMany({ where: { id: { in: geo.ids } }, select: LIST_SELECT })
        : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      return sendSuccess(res, geo.ids.map((id) => toPublicListing(byId.get(id), geo.distById.get(id))).filter(Boolean));
    }

    const rows = await prisma.animalListing.findMany({
      where, select: LIST_SELECT, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return sendSuccess(res, rows.map((r) => toPublicListing(r)));
  } catch (err) {
    return sendServerError(res, err, 'Failed to load similar animals');
  }
});

/**
 * Reveal the seller's phone number.
 *
 * Deliberately a separate, authenticated call rather than a field on the detail
 * response: a number should only leave the server when a real signed-in buyer
 * takes a deliberate action, and every one of those moments is capped and
 * recorded. That is the difference between "farmers can call each other" and
 * "the marketplace is a scrapeable phone directory".
 */
router.get('/:id/contact', authenticate, contactLimit, async (req, res) => {
  try {
    const listing = await prisma.animalListing.findUnique({
      where: { id: req.params.id },
      select: { id: true, sellerId: true, status: true, seller: { select: { id: true, name: true, phone: true } } },
    });
    if (!listing || listing.status === 'INACTIVE') return sendNotFound(res, 'Animal listing');
    if (await isBlockedBetween(req.user.id, listing.sellerId)) {
      return sendForbidden(res, 'This seller is not available.');
    }

    // Audit trail: who asked for whose number, when. The number itself is never
    // written to the log — masking is the whole point of the reveal.
    auditLog({
      userId: req.user.id,
      action: 'ANIMAL_CONTACT_REVEAL',
      entity: 'AnimalListing',
      entityId: listing.id,
      ip: clientIp(req),
      requestId: req.id,
      metadata: { sellerId: listing.sellerId },
    }).catch(() => {});

    return sendSuccess(res, {
      listingId: listing.id,
      sellerId: listing.sellerId,
      sellerName: listing.seller?.name || null,
      phone: listing.seller?.phone || null,
      phoneLabel: prettyPhone(listing.seller?.phone),
    });
  } catch (err) {
    return sendServerError(res, err, 'Could not fetch contact details');
  }
});

// Per-field character caps for animal-listing free-text — bound DB row size and
// reject oversized payloads with 400. Shared by create + update.
const ANIMAL_TEXT_LIMITS = {
  animal: 80, breed: 80, age: 40, weight: 40, milkYield: 80,
  sellerLocation: 200, description: 5000,
};

/**
 * Reject uploads whose CONTENT does not match an image, regardless of what the
 * filename or the client-declared Content-Type says. multer's fileFilter only
 * sees the declared mimetype, which the client controls — a .php renamed to
 * .jpg passes it. These are the real magic bytes.
 */
const IMAGE_MAGIC = [
  { name: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'png',  bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'bmp',  bytes: [0x42, 0x4d] },
];

function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  for (const sig of IMAGE_MAGIC) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) return sig.name;
  }
  // RIFF....WEBP
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  // ftyp box → HEIC/HEIF (what an iPhone actually sends)
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii');
    if (/^(heic|heix|hevc|mif1|msf1|avif)/.test(brand)) return 'heic';
  }
  return null;
}

/** Validate every uploaded file before a single byte reaches Cloudinary. */
function validateUploads(files = []) {
  if (files.length > 6) return 'You can upload at most 6 photos.';
  for (const f of files) {
    if (!f.buffer || f.buffer.length === 0) return 'One of the photos is empty or corrupted.';
    if (f.buffer.length > 15 * 1024 * 1024) return 'Each photo must be under 15 MB.';
    if (!sniffImage(f.buffer)) {
      return 'One of the files is not a valid photo. Please upload JPG, PNG, WebP or HEIC images.';
    }
  }
  return null;
}

/**
 * Read the structured health/commercial flags out of the multipart body.
 * Multer gives strings, and older app builds send the same facts as `tags`
 * entries — both are accepted so an un-updated client keeps working.
 */
function flagsFromBody(body, tagsArr) {
  const tagHas = (needle) => tagsArr.some((t) => String(t).toLowerCase().includes(needle));
  const pick = (field, tagNeedle) => {
    const v = bool(body[field]);
    if (v !== null) return v;
    return tagHas(tagNeedle);
  };
  return {
    vaccinated:        pick('vaccinated', 'vaccinat'),
    healthCertificate: pick('healthCertificate', 'certificate'),
    negotiable:        pick('negotiable', 'negotiab'),
    pregnant:  bool(body.pregnant),
    lactating: bool(body.lactating),
  };
}

router.post(
  '/',
  authenticate,
  createLimit,
  idemAnimalCreate,
  (req, res, next) => {
    imageUpload(req, res, (err) => {
      if (err) {
        logger.warn('[animals POST] upload rejected: %s', err.message);
        return sendError(res, err.message, 400);
      }
      const problem = validateUploads(req.files || []);
      if (problem) return sendError(res, problem, 400);
      next();
    });
  },
  [
    body('animal').notEmpty().withMessage('animal required').trim(),
    body('breed').notEmpty().withMessage('breed required').trim(),
    body('age').notEmpty().withMessage('age required').trim(),
    body('gender').isIn(['MALE', 'FEMALE']).withMessage('gender must be MALE or FEMALE'),
    body('weight').notEmpty().withMessage('weight required').trim(),
    body('price').isFloat({ gt: 0, max: 100_000_000 }).withMessage('price must be a positive number'),
    body('sellerLocation').optional({ checkFalsy: true }).trim(),
    body('tags').optional(),
    body('milkYield').optional().trim(),
    body('description').optional().trim(),
    body('lat').optional({ checkFalsy: true }).isFloat({ min: -90,  max: 90  }).withMessage('lat invalid'),
    body('lng').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('lng invalid'),
    ...maxLen(ANIMAL_TEXT_LIMITS),
  ],
  validate,
  async (req, res) => {
    try {
      const { animal, breed, age, gender, weight, price, milkYield, description, sellerLocation, tags, lat, lng } = req.body;
      const priceNum = parseFloat(price);

      // Duplicate guard runs BEFORE the (slow, billable) Cloudinary upload, so a
      // double-tap on a village connection costs nothing and returns the ad the
      // farmer already posted instead of publishing it twice.
      const dupe = await findRecentDuplicate({ sellerId: req.user.id, animal, breed, price: priceNum });
      if (dupe) {
        logger.info('[animals POST] duplicate suppressed for user %s → %s', req.user.id, dupe.id);
        const existing = await prisma.animalListing.findUnique({ where: { id: dupe.id }, select: DETAIL_SELECT });
        res.setHeader('X-Duplicate-Suppressed', 'true');
        return sendSuccess(res, toPublicDetail(existing), 200);
      }

      let images = [];
      try {
        images = await uploadFiles(req.files || [], 'animals');
        if ((req.files || []).length > 0 && images.length === 0) {
          logger.warn('[animals POST] files received but Cloudinary returned 0 URLs — CLOUDINARY_* likely unset');
        }
      } catch (uploadErr) {
        logger.error('[animals POST] cloudinary upload failed: %s', uploadErr?.message);
        return sendError(res, 'Image upload failed. Please try smaller images or a different format.', 400);
      }

      // Multer sends repeated fields as an array, but a single value comes as a string.
      const tagsArr = Array.isArray(tags) ? tags : (tags ? [tags] : []);
      const flags = flagsFromBody(req.body, tagsArr);

      // Resolve location: form value → user profile → safe default ("India").
      // Schema has `sellerLocation String` (NOT NULL), so we always need *something*.
      let resolvedLocation = sellerLocation;
      if (!resolvedLocation) {
        const profile = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { village: true, taluka: true, district: true, city: true, state: true },
        });
        resolvedLocation = [
          profile?.village, profile?.taluka, profile?.district, profile?.city, profile?.state,
        ].filter(Boolean).join(', ') || 'India';
      }

      const base = {
        animal, breed, age, weight,
        milkYield: milkYield || null,
        description: description || null,
        sellerLocation: resolvedLocation,
        tags: tagsArr,
      };

      const listing = await prisma.animalListing.create({
        data: {
          sellerId: req.user.id,
          ...base,
          gender,
          price: priceNum,
          images,
          lat: lat ? parseFloat(lat) : null,
          lng: lng ? parseFloat(lng) : null,
          expiresAt: listingExpiry(),
          ...flags,
          // Derived columns (ageMonths / weightKg / milkYieldLpd / searchText).
          // `verified` is deliberately absent: only an admin can set it.
          ...normalizedColumns(base),
        },
        select: DETAIL_SELECT,
      });

      // The public list cache now describes a marketplace missing this listing.
      bumpListingVersion(NS_ANIMALS).catch(() => {});
      logger.info('[animals POST] created listing %s for user %s', listing.id, req.user.id);
      return sendCreated(res, toPublicDetail(listing));
    } catch (err) {
      return sendServerError(res, err, 'Failed to create listing. Please try again.');
    }
  },
);

router.put(
  '/:id',
  authenticate,
  writeLimit,
  (req, res, next) => imageUpload(req, res, (err) => {
    if (err) return sendError(res, err.message, 400);
    const problem = validateUploads(req.files || []);
    if (problem) return sendError(res, problem, 400);
    next();
  }),
  maxLen(ANIMAL_TEXT_LIMITS), // runs after multer populates req.body from the multipart form
  validate,
  async (req, res) => {
    try {
      const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
      if (!listing) return sendNotFound(res, 'Animal listing');
      if (listing.sellerId !== req.user.id) {
        logger.warn('[animals PUT] forbidden — listing %s not owned by %s', listing.id, req.user.id);
        return sendForbidden(res);
      }

      const {
        animal, breed, age, gender, weight, price, milkYield, description,
        sellerLocation, tags, status, lat, lng, existingImages,
      } = req.body;

      // Mass-assignment guard: `verified`, `sellerId`, `viewCount` and the
      // derived columns are never read from the body. A client that sends
      // verified=true simply has it ignored.
      if (status && !['ACTIVE', 'SOLD', 'INACTIVE'].includes(status)) {
        return sendError(res, 'Invalid status', 400);
      }

      let newImages = [];
      try {
        newImages = await uploadFiles(req.files || [], 'animals');
      } catch (err) {
        logger.error('[animals PUT] cloudinary upload failed: %s', err?.message);
        return sendError(res, 'Image upload failed. Please try smaller images.', 400);
      }

      // `existingImages` is the array of remote URLs the user kept after possibly
      // removing some. If sent, it REPLACES the current images list (combined
      // with any new uploads). If not sent, old behaviour: just append new ones.
      let mergedImages = null;
      if (existingImages !== undefined) {
        const kept = Array.isArray(existingImages)
          ? existingImages
          : (existingImages ? [existingImages] : []);
        mergedImages = [...kept, ...newImages];
      } else if (newImages.length) {
        mergedImages = [...listing.images, ...newImages];
      }
      if (mergedImages && mergedImages.length > 6) {
        return sendError(res, 'A listing can have at most 6 photos.', 400);
      }

      const tagsArr = tags ? (Array.isArray(tags) ? tags : [tags]) : null;
      const flags = flagsFromBody(req.body, tagsArr ?? listing.tags ?? []);

      // Recompute the derived columns from the POST-UPDATE values, so editing
      // "3 years" to "18 months" actually moves the row in an age filter.
      const merged = {
        animal: animal ?? listing.animal,
        breed: breed ?? listing.breed,
        age: age ?? listing.age,
        weight: weight ?? listing.weight,
        milkYield: milkYield !== undefined ? milkYield : listing.milkYield,
        description: description !== undefined ? description : listing.description,
        sellerLocation: sellerLocation ?? listing.sellerLocation,
        tags: tagsArr ?? listing.tags,
      };

      const updated = await prisma.animalListing.update({
        where: { id: listing.id },
        data: {
          ...(animal && { animal }),
          ...(breed && { breed }),
          ...(age && { age }),
          ...(gender && { gender }),
          ...(weight && { weight }),
          ...(price && { price: parseFloat(price) }),
          ...(milkYield !== undefined && { milkYield }),
          ...(description !== undefined && { description }),
          ...(sellerLocation && { sellerLocation }),
          ...(tagsArr && { tags: tagsArr }),
          ...(status && { status }),
          ...(mergedImages && { images: mergedImages }),
          ...(lat != null && lat !== '' && { lat: parseFloat(lat) }),
          ...(lng != null && lng !== '' && { lng: parseFloat(lng) }),
          ...flags,
          ...normalizedColumns(merged),
        },
        select: DETAIL_SELECT,
      });

      bumpListingVersion(NS_ANIMALS).catch(() => {});
      return sendSuccess(res, toPublicDetail(updated));
    } catch (err) {
      return sendServerError(res, err, 'Failed to update listing. Please try again.');
    }
  },
);

/**
 * Mark a listing available / sold / hidden without re-submitting the whole form.
 * The seller-app's "Mark as Sold" is a one-tap action; making it a full PUT
 * meant re-uploading the images to change one enum.
 */
router.patch(
  '/:id/status',
  authenticate,
  writeLimit,
  [body('status').isIn(['ACTIVE', 'SOLD', 'INACTIVE']).withMessage('status must be ACTIVE, SOLD or INACTIVE')],
  validate,
  async (req, res) => {
    try {
      const listing = await prisma.animalListing.findUnique({
        where: { id: req.params.id },
        select: { id: true, sellerId: true, status: true },
      });
      if (!listing) return sendNotFound(res, 'Animal listing');
      if (listing.sellerId !== req.user.id) return sendForbidden(res);

      const updated = await prisma.animalListing.update({
        where: { id: listing.id },
        data: {
          status: req.body.status,
          // Re-activating a listing restarts its clock; otherwise a listing
          // marked sold and back on sale would be instantly expired again.
          ...(req.body.status === 'ACTIVE' ? { expiresAt: listingExpiry(), lastRenewedAt: new Date() } : {}),
        },
        select: DETAIL_SELECT,
      });

      auditLog({
        userId: req.user.id, action: 'ANIMAL_STATUS_CHANGE', entity: 'AnimalListing',
        entityId: listing.id, before: { status: listing.status }, after: { status: req.body.status },
        ip: clientIp(req), requestId: req.id,
      }).catch(() => {});
      bumpListingVersion(NS_ANIMALS).catch(() => {});
      return sendSuccess(res, toPublicDetail(updated));
    } catch (err) {
      return sendServerError(res, err, 'Failed to update listing status');
    }
  },
);

/** Push out an expiring/expired listing by a fresh TTL. */
router.post('/:id/renew', authenticate, writeLimit, async (req, res) => {
  try {
    const listing = await prisma.animalListing.findUnique({
      where: { id: req.params.id },
      select: { id: true, sellerId: true },
    });
    if (!listing) return sendNotFound(res, 'Animal listing');
    if (listing.sellerId !== req.user.id) return sendForbidden(res);

    const updated = await prisma.animalListing.update({
      where: { id: listing.id },
      data: { status: 'ACTIVE', expiresAt: listingExpiry(), lastRenewedAt: new Date() },
      select: DETAIL_SELECT,
    });
    bumpListingVersion(NS_ANIMALS).catch(() => {});
    return sendSuccess(res, toPublicDetail(updated));
  } catch (err) {
    return sendServerError(res, err, 'Failed to renew listing');
  }
});

router.delete('/:id', authenticate, writeLimit, async (req, res) => {
  try {
    const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return sendNotFound(res, 'Animal listing');
    if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      logger.warn('[animals DELETE] forbidden — listing %s, user %s', listing.id, req.user.id);
      return sendForbidden(res);
    }

    // archiveResource flips status→INACTIVE and records a RESOURCE_ARCHIVE event.
    await archiveResource(req, 'AnimalListing', listing.id);
    bumpListingVersion(NS_ANIMALS).catch(() => {});

    return sendSuccess(res, { deleted: true });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete listing. Please try again.');
  }
});

// ── Report & block ───────────────────────────────────────────────────────────

const REPORT_REASONS = ['FRAUD', 'ALREADY_SOLD', 'WRONG_DETAILS', 'ABUSIVE', 'SPAM', 'OTHER'];

router.post(
  '/:id/report',
  authenticate,
  reportLimit,
  [
    body('reason').isIn(REPORT_REASONS).withMessage(`reason must be one of: ${REPORT_REASONS.join(', ')}`),
    body('details').optional().trim().isLength({ max: 1000 }),
  ],
  validate,
  async (req, res) => {
    try {
      const listing = await prisma.animalListing.findUnique({
        where: { id: req.params.id },
        select: { id: true, sellerId: true },
      });
      if (!listing) return sendNotFound(res, 'Animal listing');
      if (listing.sellerId === req.user.id) return sendError(res, 'You cannot report your own listing.', 400);

      // One report per (listing, reporter): tapping Report twice updates the
      // existing row rather than inflating the count.
      await prisma.listingReport.upsert({
        where: { listingId_reporterId: { listingId: listing.id, reporterId: req.user.id } },
        create: {
          listingId: listing.id, reporterId: req.user.id,
          reason: req.body.reason, details: stripHtml(req.body.details || '') || null,
        },
        update: { reason: req.body.reason, details: stripHtml(req.body.details || '') || null },
      });

      auditLog({
        userId: req.user.id, action: 'ANIMAL_LISTING_REPORT', entity: 'AnimalListing',
        entityId: listing.id, metadata: { reason: req.body.reason },
        ip: clientIp(req), requestId: req.id,
      }).catch(() => {});

      return sendCreated(res, { reported: true });
    } catch (err) {
      return sendServerError(res, err, 'Could not submit the report');
    }
  },
);

router.post('/sellers/:sellerId/block', authenticate, writeLimit, async (req, res) => {
  try {
    const target = req.params.sellerId;
    if (target === req.user.id) return sendError(res, 'You cannot block yourself.', 400);
    const exists = await prisma.user.findUnique({ where: { id: target }, select: { id: true } });
    if (!exists) return sendNotFound(res, 'Seller');

    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: req.user.id, blockedId: target } },
      create: { blockerId: req.user.id, blockedId: target, reason: stripHtml(req.body?.reason || '') || null },
      update: {},
    });
    return sendCreated(res, { blocked: true });
  } catch (err) {
    return sendServerError(res, err, 'Could not block this seller');
  }
});

router.delete('/sellers/:sellerId/block', authenticate, writeLimit, async (req, res) => {
  try {
    await prisma.userBlock.deleteMany({ where: { blockerId: req.user.id, blockedId: req.params.sellerId } });
    return sendSuccess(res, { blocked: false });
  } catch (err) {
    return sendServerError(res, err, 'Could not unblock this seller');
  }
});

// ── Chat ──────────────────────────────────────────────────────────────────────

router.post('/:id/chat', authenticate, async (req, res) => {
  try {
    const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
    if (!listing || listing.status === 'INACTIVE') return sendNotFound(res, 'Animal listing');
    if (listing.sellerId === req.user.id) return sendError(res, 'Cannot chat with yourself', 400);
    if (await isBlockedBetween(req.user.id, listing.sellerId)) {
      return sendForbidden(res, 'This seller is not available.');
    }

    const chat = await prisma.chat.upsert({
      where: { listingId_buyerId: { listingId: listing.id, buyerId: req.user.id } },
      create: { listingId: listing.id, sellerId: listing.sellerId, buyerId: req.user.id },
      update: {},
      select: { id: true, listingId: true, sellerId: true, buyerId: true, createdAt: true, updatedAt: true },
    });

    return sendSuccess(res, chat);
  } catch (err) {
    return sendServerError(res, err, 'Could not open the chat');
  }
});

router.get('/:id/chats', authenticate, async (req, res) => {
  try {
    const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return sendNotFound(res, 'Animal listing');
    if (listing.sellerId !== req.user.id) return sendForbidden(res);

    const chats = await prisma.chat.findMany({
      where: { listingId: listing.id },
      include: {
        buyer: { select: { id: true, name: true, avatar: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: parsePageSize(req.query.limit, 50, 100),
    });

    return sendSuccess(res, chats);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load chats');
  }
});

// ── Per-chat messages ────────────────────────────────────────────────────────
// Helper: load the chat and reject if `me` isn't a participant.
async function getMyChat(chatId, me) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, buyerId: true, sellerId: true, listingId: true },
  });
  if (!chat) return { error: 'notfound' };
  if (chat.buyerId !== me && chat.sellerId !== me) return { error: 'forbidden' };
  return { chat };
}

/**
 * GET /chats/:chatId/messages — history, newest first, cursor paginated.
 *
 * The old shape was `?page=N` over an ASC ordering, which meant page 1 was the
 * OLDEST 50 messages: opening a long conversation showed its beginning, and the
 * client compensated by asking for 100 messages on every 8-second poll. Paging
 * backwards from the newest message with a `before` cursor is what a chat
 * actually needs, and it is stable while new messages arrive.
 *
 * `page` is still honoured so an older app build keeps working unchanged.
 */
router.get('/chats/:chatId/messages', authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const { chat, error } = await getMyChat(req.params.chatId, me);
    if (error === 'notfound')  return sendNotFound(res, 'Chat');
    if (error === 'forbidden') return sendForbidden(res);

    const limit = parsePageSize(req.query.limit, 30, 100);
    const legacyPage = req.query.page != null && req.query.before == null;

    const select = {
      id: true, senderId: true, text: true, imageUrl: true, readAt: true,
      createdAt: true, clientMsgId: true,
    };

    let messages;
    let nextCursor = null;
    let hasMore = false;

    if (legacyPage) {
      const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
      messages = await prisma.chatMessage.findMany({
        where: { chatId: chat.id },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select,
      });
    } else {
      const before = req.query.before ? new Date(req.query.before) : null;
      const validBefore = before && !Number.isNaN(before.getTime()) ? before : null;
      // limit+1 detects a further page without a COUNT.
      const rows = await prisma.chatMessage.findMany({
        where: { chatId: chat.id, ...(validBefore ? { createdAt: { lt: validBefore } } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select,
      });
      hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null;
      // Return ASC so the client can append without reversing.
      messages = page.reverse();
    }

    // Mark counterpart's messages as read, then broadcast on the socket bus
    // so they can flip their ✓✓ instantly without polling.
    const toMark = await prisma.chatMessage.updateMany({
      where: { chatId: chat.id, senderId: { not: me }, readAt: null },
      data:  { readAt: new Date() },
    });
    if (toMark.count > 0) {
      const io = req.app.get('io');
      io?.to(chat.id).emit('messages_read', { chatId: chat.id, userId: me });
    }

    return sendSuccess(res, messages, 200, { hasMore, nextCursor, limit });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load messages');
  }
});

/**
 * POST /chats/:chatId/messages — { text, clientMsgId? }
 *
 * `clientMsgId` makes the send idempotent. Without it, a retry over a flaky link
 * (or the axios 401-refresh replay) posted the same sentence twice; with it, the
 * unique (chatId, clientMsgId) index turns the second insert into a conflict and
 * we return the message that already exists.
 */
router.post('/chats/:chatId/messages', authenticate, messageLimit, [
  body('text').trim().isLength({ min: 1, max: 2000 }).withMessage('text required (1-2000 chars)'),
  body('clientMsgId').optional().isString().isLength({ max: 64 }),
], validate, async (req, res) => {
  try {
    const me = req.user.id;
    const { chat, error } = await getMyChat(req.params.chatId, me);
    if (error === 'notfound')  return sendNotFound(res, 'Chat');
    if (error === 'forbidden') return sendForbidden(res);

    const other = me === chat.buyerId ? chat.sellerId : chat.buyerId;
    if (await isBlockedBetween(me, other)) {
      return sendForbidden(res, 'You can no longer message this user.');
    }

    const text = stripHtml(req.body.text);
    const clientMsgId = req.body.clientMsgId ? String(req.body.clientMsgId).slice(0, 64) : null;
    const msgSelect = {
      id: true, senderId: true, text: true, imageUrl: true, readAt: true,
      createdAt: true, clientMsgId: true,
    };

    // Replay of a message we already stored → return it verbatim, no second row,
    // no second push notification.
    if (clientMsgId) {
      const existing = await prisma.chatMessage.findUnique({
        where: { chatId_clientMsgId: { chatId: chat.id, clientMsgId } },
        select: msgSelect,
      });
      if (existing) {
        res.setHeader('Idempotent-Replay', 'true');
        return sendSuccess(res, existing, 200);
      }
    }

    // ChatMessage has no `sender` relation, so look the sender's profile up
    // directly — run it concurrently with the insert so it adds no latency.
    let message;
    let sender;
    try {
      const [[created], profile] = await Promise.all([
        prisma.$transaction([
          prisma.chatMessage.create({
            data: { chatId: chat.id, senderId: me, text, clientMsgId },
            select: msgSelect,
          }),
          prisma.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } }),
        ]),
        prisma.user.findUnique({ where: { id: me }, select: { name: true, avatar: true, phone: true } }),
      ]);
      message = created;
      sender = profile;
    } catch (e) {
      // Two retries raced past the read above; the unique index caught the
      // second. Return the winner rather than a 500.
      if (e?.code === 'P2002' && clientMsgId) {
        const existing = await prisma.chatMessage.findUnique({
          where: { chatId_clientMsgId: { chatId: chat.id, clientMsgId } },
          select: msgSelect,
        });
        if (existing) {
          res.setHeader('Idempotent-Replay', 'true');
          return sendSuccess(res, existing, 200);
        }
      }
      throw e;
    }

    // Who sent it, and who should be notified (the other participant).
    const senderRole  = me === chat.buyerId ? 'buyer' : 'seller';
    const recipientId = other;
    // Best label for the sender: real name → phone → (client adds role label).
    const senderLabel = (sender?.name && sender.name.trim())
      || prettyPhone(sender?.phone)
      || null;

    // Broadcast on the socket bus so all open views update in real time:
    //   - chat.id room          → live ChatScreens already in this conversation
    //   - user:<buyerId> room   → buyer's MyAnimalChats inbox row + in-app banner
    //   - user:<sellerId> room  → seller's MyAnimalChats inbox row + in-app banner
    const io = req.app.get('io');
    if (io) {
      const payload = {
        id: message.id, chatId: chat.id, senderId: me, text: message.text,
        imageUrl: message.imageUrl, readAt: message.readAt, createdAt: message.createdAt,
        clientMsgId: message.clientMsgId,
        senderName:   senderLabel,
        senderAvatar: sender?.avatar || null,
        senderRole,
        listingId: chat.listingId,
      };
      io.to(chat.id).emit('new_message', payload);
      io.to(`user:${chat.buyerId}`).emit('new_message', payload);
      io.to(`user:${chat.sellerId}`).emit('new_message', payload);
    }

    // OS-level push to the recipient (WhatsApp-style). Best-effort & async:
    // only delivers if they have a registered Expo push token, and never blocks
    // the response. Safe no-op until push tokens are registered by the app.
    if (recipientId) {
      const preview = text.length > 140 ? `${text.slice(0, 137)}…` : text;
      sendPushToUser({
        userId: recipientId,
        // NEW_MESSAGE is the valid NotificationType enum value; 'animal_chat' is not
        // in the enum and made prisma.notification.create() throw (recipient never
        // got notified). The kind:'animal_chat' tag below keeps the client routing.
        type:   'NEW_MESSAGE',
        title:  senderLabel || 'New message',
        body:   preview,
        data:   { kind: 'animal_chat', chatId: chat.id, listingId: chat.listingId, senderId: me },
      }).catch(() => { /* push is best-effort */ });
    }

    return sendCreated(res, message);
  } catch (err) {
    return sendServerError(res, err, 'Failed to send message');
  }
});

export default router;
