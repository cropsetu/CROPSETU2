/**
 * Animal Trade Routes
 * GET    /api/v1/animals             ?animal&search&minPrice&maxPrice&page&limit
 * GET    /api/v1/animals/:id
 * POST   /api/v1/animals             (auth, multipart)
 * PUT    /api/v1/animals/:id         (auth, owner)
 * DELETE /api/v1/animals/:id         (auth, owner)
 * GET    /api/v1/animals/my          (auth) — my listings
 * GET    /api/v1/animals/:id/chats   (auth) — chat list for a listing
 * POST   /api/v1/animals/:id/chat    (auth) — initiate chat
 * GET    /api/v1/chats/:chatId/messages
 * POST   /api/v1/chats/:chatId/messages { text }
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createUploader, uploadFiles } from '../config/cloudinary.js';
import prisma from '../config/db.js';
import {
  sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, paginationMeta,
} from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';
import { haversineKm } from '../utils/geo.js';

const router = Router();
const imageUpload = createUploader(8);

// ── Listings ──────────────────────────────────────────────────────────────────
router.get(
  '/',
  optionalAuth,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('minPrice').optional().isFloat({ min: 0 }),
    query('maxPrice').optional().isFloat({ min: 0 }),
    query('lat').optional().isFloat(),
    query('lng').optional().isFloat(),
    query('radius').optional().isFloat({ min: 1, max: 500 }),
  ],
  validate,
  async (req, res) => {
    const page  = parseInt(req.query.page  || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const { animal, search, minPrice, maxPrice, district, lat, lng, radius } = req.query;

    const where = { status: 'ACTIVE' };
    if (animal)   where.animal = { equals: animal, mode: 'insensitive' };
    if (district) where.sellerLocation = { contains: district, mode: 'insensitive' };
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice);
      if (maxPrice) where.price.lte = parseFloat(maxPrice);
    }
    if (search) {
      where.OR = [
        { animal: { contains: search, mode: 'insensitive' } },
        { breed:  { contains: search, mode: 'insensitive' } },
        { sellerLocation: { contains: search, mode: 'insensitive' } },
      ];
    }

    // ── Distance filter (Haversine) ──────────────────────────────────────────
    let nearbyIds = null;
    if (lat && lng && radius) {
      const latF    = parseFloat(lat);
      const lngF    = parseFloat(lng);
      const radiusF = parseFloat(radius);
      const rows = await prisma.$queryRaw`
        SELECT id FROM animal_listings
        WHERE status = 'ACTIVE'
          AND lat IS NOT NULL AND lng IS NOT NULL
          AND (
            6371 * acos(
              LEAST(1.0,
                cos(radians(${latF})) * cos(radians(lat)) *
                cos(radians(lng) - radians(${lngF})) +
                sin(radians(${latF})) * sin(radians(lat))
              )
            )
          ) <= ${radiusF}
      `;
      nearbyIds = rows.map(r => r.id);
      if (nearbyIds.length > 0) {
        where.id = { in: nearbyIds };
      } else {
        // No results within radius — return empty immediately
        return sendSuccess(res, [], 200, paginationMeta(0, page, limit));
      }
    }

    const [listings, total] = await Promise.all([
      prisma.animalListing.findMany({
        where,
        include: {
          seller: { select: { id: true, name: true, avatar: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ verified: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.animalListing.count({ where }),
    ]);

    // Attach distance_km to each listing if coordinates were provided
    let result = listings;
    if (lat && lng) {
      const latF = parseFloat(lat);
      const lngF = parseFloat(lng);
      result = listings.map(l => {
        if (l.lat == null || l.lng == null) return l;
        const distKm = haversineKm(latF, lngF, l.lat, l.lng);
        return { ...l, distanceKm: Math.round(distKm * 10) / 10 };
      });
    }

    return sendSuccess(res, result, 200, paginationMeta(total, page, limit));
  }
);

// [FIX] Added pagination to prevent unbounded response
router.get('/my', authenticate, async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page  || '1'),  1);
    const limit = Math.min(parseInt(req.query.limit || '20'), 50);
    const where = { sellerId: req.user.id, status: { not: 'INACTIVE' } };
    const [listings, total] = await Promise.all([
      prisma.animalListing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.animalListing.count({ where }),
    ]);
    return sendSuccess(res, listings, 200, paginationMeta(total, page, limit));
  } catch (err) {
    return sendError(res, 'Failed to load listings', 500);
  }
});

router.get('/:id', async (req, res) => {
  const listing = await prisma.animalListing.findUnique({
    where: { id: req.params.id },
    include: {
      seller: { select: { id: true, name: true, avatar: true, phone: true } },
    },
  });
  if (!listing) return sendNotFound(res, 'Animal listing');

  // Increment view count (fire-and-forget)
  prisma.animalListing.update({
    where: { id: listing.id },
    data: { viewCount: { increment: 1 } },
  }).catch(() => {});

  return sendSuccess(res, listing);
});

router.post(
  '/',
  authenticate,
  (req, res, next) => imageUpload(req, res, (err) => {
    if (err) return sendError(res, err.message, 400);
    next();
  }),
  [
    body('animal').notEmpty().trim(),
    body('breed').notEmpty().trim(),
    body('age').notEmpty().trim(),
    body('gender').isIn(['MALE', 'FEMALE']),
    body('weight').notEmpty().trim(),
    body('price').isFloat({ min: 0 }),
    body('sellerLocation').notEmpty().trim(),
    body('tags').optional(),
    body('milkYield').optional().trim(),
    body('description').optional().trim(),
    body('lat').optional().isFloat({ min: -90,  max: 90  }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
  ],
  validate,
  async (req, res) => {
    try {
      let images = [];
      try {
        images = await uploadFiles(req.files || [], 'animals');
      } catch (uploadErr) {
        return sendError(res, 'Image upload failed. Please try smaller images or a different format.', 400);
      }
      const { animal, breed, age, gender, weight, price, milkYield, description, sellerLocation, tags, lat, lng } = req.body;

      // Multer sends repeated fields as an array, but a single value comes as a string.
      // Coerce to an array so Prisma's String[] column is always happy.
      const tagsArr = Array.isArray(tags) ? tags : (tags ? [tags] : []);

      const listing = await prisma.animalListing.create({
        data: {
          sellerId: req.user.id,
          animal, breed, age,
          gender: gender,
          weight,
          price: parseFloat(price),
          milkYield: milkYield || null,
          description,
          sellerLocation,
          images,
          tags: tagsArr,
          lat:  lat  != null ? parseFloat(lat)  : null,
          lng:  lng  != null ? parseFloat(lng)  : null,
        },
      });

      return sendCreated(res, listing);
    } catch (err) {
      return sendError(res, 'Failed to create listing. Please try again.', 500);
    }
  }
);

router.put(
  '/:id',
  authenticate,
  (req, res, next) => imageUpload(req, res, (err) => {
    if (err) return sendError(res, err.message, 400);
    next();
  }),
  async (req, res) => {
    const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return sendNotFound(res, 'Animal listing');
    if (listing.sellerId !== req.user.id) return sendForbidden(res);

    const { animal, breed, age, gender, weight, price, milkYield, description, sellerLocation, tags, status, lat, lng } = req.body;
    let newImages = [];
    try {
      newImages = await uploadFiles(req.files || [], 'animals');
    } catch {
      return sendError(res, 'Image upload failed. Please try smaller images.', 400);
    }

    const updated = await prisma.animalListing.update({
      where: { id: listing.id },
      data: {
        ...(animal         && { animal }),
        ...(breed          && { breed }),
        ...(age            && { age }),
        ...(gender         && { gender }),
        ...(weight         && { weight }),
        ...(price          && { price: parseFloat(price) }),
        ...(milkYield      !== undefined && { milkYield }),
        ...(description    !== undefined && { description }),
        ...(sellerLocation && { sellerLocation }),
        ...(tags           && { tags }),
        ...(status         && { status }),
        ...(newImages.length && { images: [...listing.images, ...newImages] }),
        ...(lat  != null && { lat:  parseFloat(lat)  }),
        ...(lng  != null && { lng:  parseFloat(lng)  }),
      },
    });

    return sendSuccess(res, updated);
  }
);

router.delete('/:id', authenticate, async (req, res) => {
  const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return sendNotFound(res, 'Animal listing');
  if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') return sendForbidden(res);

  await prisma.animalListing.update({
    where: { id: listing.id },
    data: { status: 'INACTIVE' },
  });

  return sendSuccess(res, { deleted: true });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
router.post('/:id/chat', authenticate, async (req, res) => {
  const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
  if (!listing || listing.status !== 'ACTIVE') return sendNotFound(res, 'Animal listing');
  if (listing.sellerId === req.user.id) return sendError(res, 'Cannot chat with yourself', 400);

  const chat = await prisma.chat.upsert({
    where: { listingId_buyerId: { listingId: listing.id, buyerId: req.user.id } },
    create: { listingId: listing.id, sellerId: listing.sellerId, buyerId: req.user.id },
    update: {},
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
  });

  return sendSuccess(res, chat);
});

router.get('/:id/chats', authenticate, async (req, res) => {
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
  });

  return sendSuccess(res, chats);
});

export default router;
