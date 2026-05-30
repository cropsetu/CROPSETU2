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
 *   Results include a `distanceKm` field when lat/lng provided.
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import prisma from '../config/db.js';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, paginationMeta } from '../utils/response.js';
import { haversineKm, attachDistance } from '../utils/geo.js';
import { stripHtml } from '../utils/encrypt.js';

// [FIX] Validate GPS coordinates are within Earth bounds
function validateCoords(lat, lng) {
  if (lat != null && (lat < -90 || lat > 90)) return false;
  if (lng != null && (lng < -180 || lng > 180)) return false;
  return true;
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

/**
 * Build a bounding-box Prisma where clause for a geo-radius query.
 * Bounding box is a fast SQL pre-filter; Haversine post-filter trims the corners.
 */
function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  return {
    lat: { gte: lat - latDelta, lte: lat + latDelta },
    lng: { gte: lng - lngDelta, lte: lng + lngDelta },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — list
// ─────────────────────────────────────────────────────────────────────────────

router.get('/machinery', optionalAuth, async (req, res) => {
  const page     = Math.max(parseInt(req.query.page  || '1'),  1);
  const limit    = Math.min(parseInt(req.query.limit || '20'), 50);
  const { category, district, search, available } = req.query;
  const userLat  = req.query.lat    ? parseFloat(req.query.lat)    : null;
  const userLng  = req.query.lng    ? parseFloat(req.query.lng)    : null;
  const radiusKm = req.query.radius ? parseFloat(req.query.radius) : 50; // default 50 km
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

  // Bounding-box pre-filter when user location provided.
  // Always include listings with null coordinates so existing data is never hidden.
  if (userLat !== null && userLng !== null) {
    const box    = boundingBox(userLat, userLng, radiusKm);
    const geoOr  = { OR: [{ lat: null }, { lat: box.lat, lng: box.lng }] };
    where.AND    = where.AND ? [...where.AND, geoOr] : [geoOr];
  }

  // For distance-sorted queries we can't paginate purely in SQL, so we fetch
  // all matching (within bbox), sort by distance, then slice.
  const isDistanceQuery = userLat !== null && userLng !== null;

  // [FIX #10] Cap distance queries to prevent OOM when fetching all records
  const GEO_FETCH_CAP = 500;

  let items, total;
  if (isDistanceQuery) {
    const all = await prisma.machineryListing.findMany({
      where,
      orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
      take: GEO_FETCH_CAP,
      select: {
        id: true, name: true, category: true, brand: true, horsePower: true,
        pricePerHour: true, pricePerDay: true, pricePerAcre: true,
        images: true, videos: true, location: true, district: true,
        available: true, availableFrom: true, availableTo: true,
        rating: true, ratingCount: true, ageYears: true, mileageHours: true,
        features: true, ownerName: true, lat: true, lng: true,
        owner: { select: { id: true, name: true, avatar: true } },
        bookings: {
          where: { status: { in: ['CONFIRMED', 'ACTIVE'] }, endDate: { gte: startOfToday } },
          select: { startDate: true, endDate: true },
        },
      },
    });
    const sorted = attachDistance(all, userLat, userLng, radiusKm);
    total = sorted.length;
    items = sorted.slice((page - 1) * limit, page * limit);
  } else {
    [items, total] = await Promise.all([
      prisma.machineryListing.findMany({
        where,
        orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, name: true, category: true, brand: true, horsePower: true,
          pricePerHour: true, pricePerDay: true, pricePerAcre: true,
          images: true, videos: true, location: true, district: true,
          available: true, availableFrom: true, availableTo: true,
          rating: true, ratingCount: true, ageYears: true, mileageHours: true,
          features: true, ownerName: true, lat: true, lng: true,
          owner: { select: { id: true, name: true, avatar: true } },
          bookings: {
            where: { status: { in: ['CONFIRMED', 'ACTIVE'] }, endDate: { gte: startOfToday } },
            select: { startDate: true, endDate: true },
          },
        },
      }),
      prisma.machineryListing.count({ where }),
    ]);
  }

  // Attach a listing-level booked indicator and drop the raw bookings array.
  items = items.map(({ bookings, ...rest }) => ({
    ...rest,
    bookedStatus: deriveBookedStatus(bookings, startOfToday),
  }));

  return sendSuccess(res, items, 200, paginationMeta(total, page, limit));
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
  const item = await prisma.machineryListing.findUnique({
    where: { id: req.params.id },
    include: {
      owner: { select: { id: true, name: true, avatar: true, phone: true } },
      bookings: {
        where: { status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] } },
        select: { startDate: true, endDate: true, status: true },
        orderBy: { startDate: 'asc' },
      },
    },
  });
  if (!item || item.status === 'INACTIVE') return sendNotFound(res, 'Machinery listing not found');

  const result = { ...item };
  // [FIX #18] Only expose owner phone to authenticated users
  if (req.user) {
    result.ownerPhone = item.ownerPhone || item.owner?.phone || null;
  } else {
    result.ownerPhone = null;
    if (result.owner) result.owner = { id: result.owner.id, name: result.owner.name, avatar: result.owner.avatar };
  }
  return sendSuccess(res, result);
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — availability (booked date ranges for a calendar)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/machinery/:id/availability', async (req, res) => {
  const { year, month } = req.query;
  let where = {
    machineryListingId: req.params.id,
    status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] },
  };

  if (year && month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10) - 1;
    const rangeStart = new Date(y, m, 1);
    const rangeEnd   = new Date(y, m + 2, 0);
    where.OR = [
      { startDate: { gte: rangeStart, lte: rangeEnd } },
      { endDate:   { gte: rangeStart, lte: rangeEnd } },
      { startDate: { lte: rangeStart }, endDate: { gte: rangeEnd } },
    ];
  }

  const bookings = await prisma.booking.findMany({
    where,
    select: { startDate: true, endDate: true, status: true },
    orderBy: { startDate: 'asc' },
  });
  return sendSuccess(res, bookings);
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — create listing
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/machinery',
  authenticate,
  [
    body('name').trim().notEmpty().withMessage('Equipment name is required'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('pricePerDay').isFloat({ min: 1 }).withMessage('pricePerDay must be positive'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('district').trim().notEmpty().withMessage('District is required'),
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
        state:        stripHtml((state || req.user.state || 'Maharashtra').trim()),
        lat:          parsedLat,
        lng:          parsedLng,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        availableTo:   availableTo   ? new Date(availableTo)   : null,
        ownerName:    ownerName?.trim()  || req.user.name || null,
        ownerPhone:   ownerPhone?.trim() || req.user.phone || null,
      },
    });

    return sendCreated(res, listing);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — update listing
// ─────────────────────────────────────────────────────────────────────────────

router.put('/machinery/:id', authenticate, async (req, res) => {
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
      } else {
        data[key] = req.body[key];
      }
    }
  }

  // Validate the resulting availability window (merge incoming changes over existing).
  const effFrom = data.availableFrom !== undefined ? data.availableFrom : listing.availableFrom;
  const effTo   = data.availableTo   !== undefined ? data.availableTo   : listing.availableTo;
  if (!validateDateWindow(effFrom, effTo)) {
    return sendError(res, 'availableTo must be on or after availableFrom', 400);
  }

  const updated = await prisma.machineryListing.update({ where: { id: req.params.id }, data });
  return sendSuccess(res, updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// MACHINERY — soft delete
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/machinery/:id', authenticate, async (req, res) => {
  const listing = await prisma.machineryListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return sendNotFound(res, 'Listing not found');
  if (listing.ownerId !== req.user.id) return sendForbidden(res, 'Not your listing');

  await prisma.machineryListing.update({
    where: { id: req.params.id },
    data:  { status: 'INACTIVE' },
  });
  return sendSuccess(res, { message: 'Listing removed' });
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — list
// ─────────────────────────────────────────────────────────────────────────────

router.get('/labour', optionalAuth, async (req, res) => {
  const page   = Math.max(parseInt(req.query.page  || '1'),  1);
  const limit  = Math.min(parseInt(req.query.limit || '20'), 50);
  const { district, skill, search, available } = req.query;
  const userLat  = req.query.lat    ? parseFloat(req.query.lat)    : null;
  const userLng  = req.query.lng    ? parseFloat(req.query.lng)    : null;
  const radiusKm = req.query.radius ? parseFloat(req.query.radius) : 50;
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

  if (userLat !== null && userLng !== null) {
    const box   = boundingBox(userLat, userLng, radiusKm);
    const geoOr = { OR: [{ lat: null }, { lat: box.lat, lng: box.lng }] };
    where.AND   = where.AND ? [...where.AND, geoOr] : [geoOr];
  }

  const isDistanceQuery = userLat !== null && userLng !== null;

  const SELECT = {
    id: true, name: true, leader: true, groupName: true, skills: true,
    pricePerDay: true, pricePerHour: true, groupSize: true,
    image: true, images: true, location: true, district: true,
    available: true, availableFrom: true, availableTo: true,
    rating: true, ratingCount: true, experience: true,
    lat: true, lng: true,
    provider: { select: { id: true, name: true, avatar: true } },
    bookings: {
      where: { status: { in: ['CONFIRMED', 'ACTIVE'] }, endDate: { gte: startOfToday } },
      select: { startDate: true, endDate: true },
    },
  };

  let items, total;
  if (isDistanceQuery) {
    const all = await prisma.labourListing.findMany({
      where,
      orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
      take: 500, // [FIX #10] Cap to prevent OOM
      select: SELECT,
    });
    const sorted = attachDistance(all, userLat, userLng, radiusKm);
    total = sorted.length;
    items = sorted.slice((page - 1) * limit, page * limit);
  } else {
    [items, total] = await Promise.all([
      prisma.labourListing.findMany({
        where,
        orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: SELECT,
      }),
      prisma.labourListing.count({ where }),
    ]);
  }

  // Attach a listing-level booked indicator and drop the raw bookings array.
  items = items.map(({ bookings, ...rest }) => ({
    ...rest,
    bookedStatus: deriveBookedStatus(bookings, startOfToday),
  }));

  return sendSuccess(res, items, 200, paginationMeta(total, page, limit));
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
  const item = await prisma.labourListing.findUnique({
    where: { id: req.params.id },
    include: {
      provider: { select: { id: true, name: true, avatar: true, phone: true } },
      bookings: {
        where: { status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] } },
        select: { startDate: true, endDate: true, status: true },
        orderBy: { startDate: 'asc' },
      },
    },
  });
  if (!item || item.status === 'INACTIVE') return sendNotFound(res, 'Labour listing not found');

  const result = { ...item };
  // [FIX] Only expose provider phone to authenticated users (same as machinery FIX #18)
  if (req.user) {
    result.phone = item.phone || item.provider?.phone || null;
  } else {
    result.phone = null;
    if (result.provider) result.provider = { id: result.provider.id, name: result.provider.name, avatar: result.provider.avatar };
  }
  return sendSuccess(res, result);
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — availability
// ─────────────────────────────────────────────────────────────────────────────

router.get('/labour/:id/availability', async (req, res) => {
  const { year, month } = req.query;
  let where = {
    labourListingId: req.params.id,
    status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] },
  };

  if (year && month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10) - 1;
    const rangeStart = new Date(y, m, 1);
    const rangeEnd   = new Date(y, m + 2, 0);
    where.OR = [
      { startDate: { gte: rangeStart, lte: rangeEnd } },
      { endDate:   { gte: rangeStart, lte: rangeEnd } },
      { startDate: { lte: rangeStart }, endDate: { gte: rangeEnd } },
    ];
  }

  const bookings = await prisma.booking.findMany({
    where,
    select: { startDate: true, endDate: true, status: true },
    orderBy: { startDate: 'asc' },
  });
  return sendSuccess(res, bookings);
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — create listing
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/labour',
  authenticate,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('skills').isArray({ min: 1 }).withMessage('At least one skill required'),
    body('pricePerDay').isFloat({ min: 1 }).withMessage('pricePerDay must be positive'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('district').trim().notEmpty().withMessage('District is required'),
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
        phone:        phone?.trim() || req.user.phone || null,
        location:     stripHtml(location.trim()),
        district:     stripHtml(district.trim()),
        state:        (state || req.user.state || 'Maharashtra').trim(),
        lat:          lat  != null ? parseFloat(lat)  : null,
        lng:          lng  != null ? parseFloat(lng)  : null,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        availableTo:   availableTo   ? new Date(availableTo)   : null,
      },
    });

    return sendCreated(res, listing);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — update
// ─────────────────────────────────────────────────────────────────────────────

router.put('/labour/:id', authenticate, async (req, res) => {
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
      } else {
        data[key] = req.body[key];
      }
    }
  }

  // Validate the resulting availability window (merge incoming changes over existing).
  const effFrom = data.availableFrom !== undefined ? data.availableFrom : listing.availableFrom;
  const effTo   = data.availableTo   !== undefined ? data.availableTo   : listing.availableTo;
  if (!validateDateWindow(effFrom, effTo)) {
    return sendError(res, 'availableTo must be on or after availableFrom', 400);
  }

  const updated = await prisma.labourListing.update({ where: { id: req.params.id }, data });
  return sendSuccess(res, updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// LABOUR — soft delete
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/labour/:id', authenticate, async (req, res) => {
  const listing = await prisma.labourListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return sendNotFound(res, 'Listing not found');
  if (listing.providerId !== req.user.id) return sendForbidden(res, 'Not your listing');

  await prisma.labourListing.update({
    where: { id: req.params.id },
    data:  { status: 'INACTIVE' },
  });
  return sendSuccess(res, { message: 'Listing removed' });
});

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
      orderBy: { createdAt: 'desc' },
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

  return sendSuccess(res, items, 200, paginationMeta(total, page, limit));
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

router.put('/bookings/:id/approve', authenticate, async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: {
      machineryListing: { select: { ownerId: true, name: true } },
      labourListing:    { select: { providerId: true, name: true } },
    },
  });
  if (!booking) return sendNotFound(res, 'Booking not found');

  const isOwner = booking.machineryListing?.ownerId    === req.user.id
               || booking.labourListing?.providerId === req.user.id;
  if (!isOwner) return sendForbidden(res, 'Not your listing');

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

  return sendSuccess(res, updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — reject (owner declines a pending booking)
// ─────────────────────────────────────────────────────────────────────────────

router.put('/bookings/:id/reject', authenticate, async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: {
      machineryListing: { select: { ownerId: true, name: true } },
      labourListing:    { select: { providerId: true, name: true } },
    },
  });
  if (!booking) return sendNotFound(res, 'Booking not found');

  const isOwner = booking.machineryListing?.ownerId    === req.user.id
               || booking.labourListing?.providerId === req.user.id;
  if (!isOwner) return sendForbidden(res, 'Not your listing');

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
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        machineryListing: { select: { id: true, name: true, images: true, location: true } },
        labourListing:    { select: { id: true, name: true, image: true,  location: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return sendSuccess(res, items, 200, paginationMeta(total, page, limit));
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — create
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/bookings',
  authenticate,
  [
    body('startDate').isISO8601().withMessage('startDate must be a valid date'),
    body('endDate').isISO8601().withMessage('endDate must be a valid date'),
    body('days').isInt({ min: 1 }).withMessage('days must be at least 1'),
    // [FIX #6] totalAmount is now optional — server calculates it from listing price
    body('totalAmount').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    const {
      machineryListingId, labourListingId,
      startDate, endDate, days, hours, workerCount, notes,
    } = req.body;

    if (!machineryListingId && !labourListingId) {
      return sendError(res, 'Either machineryListingId or labourListingId is required', 400);
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);

    if (end < start) return sendError(res, 'endDate must be after startDate', 400);

    // [FIX #1] Wrap conflict check + booking create in a Serializable transaction
    // to prevent double-booking when concurrent requests hit the same slot.
    try {
      const booking = await prisma.$transaction(async (tx) => {
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
            throw Object.assign(new Error('Machinery listing not available'), { statusCode: 400 });
          }

          // Owners cannot book their own listing
          if (listing.ownerId === req.user.id) {
            throw Object.assign(new Error('You cannot book your own listing'), { statusCode: 403 });
          }

          // Booking must lie within the listing's availability window
          if (!withinAvailability(startDate, endDate, listing.availableFrom, listing.availableTo)) {
            throw Object.assign(new Error("Selected dates are outside this listing's availability window"), { statusCode: 400 });
          }

          const conflict = await tx.booking.findFirst({ where: conflictWhere });
          if (conflict) {
            throw Object.assign(new Error('Machinery is already booked for these dates'), { statusCode: 409 });
          }

          // [FIX #6] Server-calculate totalAmount from listing price
          serverAmount = parseInt(days) * listing.pricePerDay;
        }

        if (labourListingId) {
          conflictWhere.labourListingId = labourListingId;
          const listing = await tx.labourListing.findUnique({ where: { id: labourListingId } });
          if (!listing || listing.status !== 'ACTIVE') {
            throw Object.assign(new Error('Labour listing not available'), { statusCode: 400 });
          }

          // Providers cannot book their own listing
          if (listing.providerId === req.user.id) {
            throw Object.assign(new Error('You cannot book your own listing'), { statusCode: 403 });
          }

          // Booking must lie within the listing's availability window
          if (!withinAvailability(startDate, endDate, listing.availableFrom, listing.availableTo)) {
            throw Object.assign(new Error("Selected dates are outside this listing's availability window"), { statusCode: 400 });
          }

          const conflict = await tx.booking.findFirst({ where: conflictWhere });
          if (conflict) {
            throw Object.assign(new Error('Worker is already booked for these dates'), { statusCode: 409 });
          }

          // [FIX #6] Server-calculate totalAmount from listing price
          const wc = workerCount != null ? parseInt(workerCount) : 1;
          serverAmount = parseInt(days) * listing.pricePerDay * wc;
        }

        return tx.booking.create({
          data: {
            userId:             req.user.id,
            machineryListingId: machineryListingId || null,
            labourListingId:    labourListingId    || null,
            startDate:          start,
            endDate:            end,
            days:               parseInt(days),
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
      });

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
      const status = err.statusCode || 500;
      return sendError(res, err.message || 'Booking failed', status);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — detail
// ─────────────────────────────────────────────────────────────────────────────

router.get('/bookings/:id', authenticate, async (req, res) => {
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: {
      machineryListing: true,
      labourListing:    true,
    },
  });
  if (!booking) return sendNotFound(res, 'Booking not found');
  return sendSuccess(res, booking);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKINGS — cancel
// ─────────────────────────────────────────────────────────────────────────────

router.put('/bookings/:id/cancel', authenticate, async (req, res) => {
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!booking) return sendNotFound(res, 'Booking not found');
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
