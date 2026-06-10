/**
 * Animal Trade Routes
 * GET    /api/v1/animals             ?animal&search&minPrice&maxPrice&page&limit
 * GET    /api/v1/animals/:id
 * POST   /api/v1/animals             (auth, multipart)
 * PUT    /api/v1/animals/:id         (auth, owner)
 * DELETE /api/v1/animals/:id         (auth, owner)
 * GET    /api/v1/animals/my          (auth) — my listings
 * GET    /api/v1/animals/chats/my    (auth) — every chat the current user is in
 * GET    /api/v1/animals/:id/chats              (auth) — chat list for a listing
 * POST   /api/v1/animals/:id/chat               (auth) — initiate chat
 * GET    /api/v1/animals/chats/:chatId/messages (auth) — message history
 * POST   /api/v1/animals/chats/:chatId/messages (auth) — { text } send a message
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { validate } from '../middleware/validate.js';
import { maxLen } from '../middleware/textLength.js';
import { sanitizeSearch } from '../utils/sanitizeSearch.js';
import { createUploader, uploadFiles } from '../config/cloudinary.js';
import prisma from '../config/db.js';
import {
  sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendServerError, paginationMeta, parsePageSize,
} from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';
import { haversineKm } from '../utils/geo.js';
import { archiveResource } from '../services/softDelete.service.js';

const router = Router();
router.param('id', uuidParamGuard);     // animal listing id
router.param('chatId', uuidParamGuard); // animal chat id
const imageUpload = createUploader(8);

// ── Chat inbox (must be registered BEFORE /:id to win path matching) ─────────
// GET /chats/my — every chat the current user is part of (as buyer OR seller),
// across ALL their animal listings. Used to render the "Chat with Seller"
// inbox launched from AnimalTradeHome.
router.get('/chats/my', authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const chats = await prisma.chat.findMany({
      where: { OR: [{ buyerId: me }, { sellerId: me }] },
      include: {
        listing: {
          select: { id: true, animal: true, breed: true, images: true, price: true, status: true },
        },
        buyer:  { select: { id: true, name: true, avatar: true } },
        seller: { select: { id: true, name: true, avatar: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
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
    console.error('[animals GET /chats/my] failed:', err?.message, err?.stack);
    return sendError(res, 'Failed to load chats', 500);
  }
});

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
    const { animal, minPrice, maxPrice, lat, lng, radius } = req.query;
    const search   = sanitizeSearch(req.query.search);   // strip LIKE wildcards / cap length
    const district = sanitizeSearch(req.query.district);

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

// Per-field character caps for animal-listing free-text — bound DB row size and
// reject oversized payloads with 400. Shared by create + update.
const ANIMAL_TEXT_LIMITS = {
  animal: 80, breed: 80, age: 40, weight: 40, milkYield: 80,
  sellerLocation: 200, description: 5000,
};

router.post(
  '/',
  authenticate,
  (req, res, next) => {
    console.log('[animals POST] hit — user:', req.user?.id, 'content-type:', req.headers['content-type']);
    imageUpload(req, res, (err) => {
      if (err) {
        console.error('[animals POST] multer error:', err.message);
        return sendError(res, err.message, 400);
      }
      console.log('[animals POST] multer ok — body keys:', Object.keys(req.body || {}), 'files:', (req.files || []).length);
      next();
    });
  },
  [
    body('animal').notEmpty().withMessage('animal required').trim(),
    body('breed').notEmpty().withMessage('breed required').trim(),
    body('age').notEmpty().withMessage('age required').trim(),
    body('gender').isIn(['MALE', 'FEMALE']).withMessage('gender must be MALE or FEMALE'),
    body('weight').notEmpty().withMessage('weight required').trim(),
    body('price').isFloat({ gt: 0 }).withMessage('price must be a positive number'),
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
      let images = [];
      try {
        images = await uploadFiles(req.files || [], 'animals');
        console.log('[animals POST] cloudinary uploaded', images.length, 'of', (req.files || []).length, 'files');
        if ((req.files || []).length > 0 && images.length === 0) {
          console.warn('[animals POST] WARNING: files received but Cloudinary returned 0 URLs — CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET likely missing in .env');
        }
      } catch (uploadErr) {
        console.error('[animals POST] cloudinary upload failed:', uploadErr?.message);
        return sendError(res, 'Image upload failed. Please try smaller images or a different format.', 400);
      }
      const { animal, breed, age, gender, weight, price, milkYield, description, sellerLocation, tags, lat, lng } = req.body;

      // Multer sends repeated fields as an array, but a single value comes as a string.
      const tagsArr = Array.isArray(tags) ? tags : (tags ? [tags] : []);

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

      const listing = await prisma.animalListing.create({
        data: {
          sellerId: req.user.id,
          animal, breed, age,
          gender,
          weight,
          price: parseFloat(price),
          milkYield: milkYield || null,
          description: description || null,
          sellerLocation: resolvedLocation,
          images,
          tags: tagsArr,
          lat:  lat  ? parseFloat(lat)  : null,
          lng:  lng  ? parseFloat(lng)  : null,
        },
      });

      console.log('[animals POST] created listing', listing.id, 'for user', req.user.id);
      return sendCreated(res, listing);
    } catch (err) {
      console.error('[animals POST] create failed:', err?.code, err?.message);
      console.error(err?.stack);
      return sendError(res, err?.message || 'Failed to create listing. Please try again.', 500);
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
  maxLen(ANIMAL_TEXT_LIMITS), // runs after multer populates req.body from the multipart form
  validate,
  async (req, res) => {
    const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return sendNotFound(res, 'Animal listing');
    if (listing.sellerId !== req.user.id) {
      console.warn('[animals PUT] forbidden — listing.seller', listing.sellerId, 'user', req.user.id);
      return sendForbidden(res);
    }

    const { animal, breed, age, gender, weight, price, milkYield, description, sellerLocation, tags, status, lat, lng, existingImages } = req.body;
    let newImages = [];
    try {
      newImages = await uploadFiles(req.files || [], 'animals');
    } catch (err) {
      console.error('[animals PUT] cloudinary upload failed:', err?.message);
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
        ...(tags           && { tags: Array.isArray(tags) ? tags : [tags] }),
        ...(status         && { status }),
        ...(mergedImages   && { images: mergedImages }),
        ...(lat  != null && lat  !== '' && { lat:  parseFloat(lat)  }),
        ...(lng  != null && lng  !== '' && { lng:  parseFloat(lng)  }),
      },
    });

    console.log('[animals PUT] updated', listing.id, 'images:', updated.images?.length);
    return sendSuccess(res, updated);
  }
);

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const listing = await prisma.animalListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return sendNotFound(res, 'Animal listing');
    if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      console.warn('[animals DELETE] forbidden — listing.seller', listing.sellerId, 'user', req.user.id, 'role', req.user.role);
      return sendForbidden(res);
    }

    // archiveResource flips status→INACTIVE and records a RESOURCE_ARCHIVE event.
    await archiveResource(req, 'AnimalListing', listing.id);

    console.log('[animals DELETE] soft-deleted', listing.id);
    return sendSuccess(res, { deleted: true });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete listing. Please try again.', 500);
  }
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

// GET /chats/:chatId/messages — paginated history. Marks counterpart's
// unread messages as read AND broadcasts `messages_read` so the other side
// sees ✓✓ in real time even when only HTTP polling is in use.
router.get('/chats/:chatId/messages', authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const { chat, error } = await getMyChat(req.params.chatId, me);
    if (error === 'notfound')  return sendNotFound(res, 'Chat');
    if (error === 'forbidden') return sendForbidden(res);

    const page  = Math.max(parseInt(req.query.page  || '1', 10),  1) || 1;
    const limit = parsePageSize(req.query.limit, 50, 100); // bound page size (also NaN-safe)

    const messages = await prisma.chatMessage.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, senderId: true, text: true, imageUrl: true, readAt: true, createdAt: true },
    });

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

    return sendSuccess(res, messages);
  } catch (err) {
    console.error('[chats GET messages] failed:', err?.message);
    return sendError(res, 'Failed to load messages', 500);
  }
});

// POST /chats/:chatId/messages — { text } — send a message. Bumps the chat's
// updatedAt AND emits `new_message` on the socket bus so subscribers (the
// counterpart's open ChatScreen) receive it instantly.
router.post('/chats/:chatId/messages', authenticate, [
  body('text').trim().isLength({ min: 1, max: 2000 }).withMessage('text required (1-2000 chars)'),
], validate, async (req, res) => {
  try {
    const me = req.user.id;
    const { chat, error } = await getMyChat(req.params.chatId, me);
    if (error === 'notfound')  return sendNotFound(res, 'Chat');
    if (error === 'forbidden') return sendForbidden(res);

    const text = stripHtml(req.body.text);

    const [message] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { chatId: chat.id, senderId: me, text },
        select: { id: true, senderId: true, text: true, imageUrl: true, readAt: true, createdAt: true },
      }),
      prisma.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } }),
    ]);

    // Broadcast on the socket bus so all open views update in real time:
    //   - chat.id room          → live ChatScreens already in this conversation
    //   - user:<buyerId> room   → buyer's MyAnimalChats inbox row
    //   - user:<sellerId> room  → seller's MyAnimalChats inbox row
    const io = req.app.get('io');
    if (io) {
      const payload = { ...message, chatId: chat.id };
      io.to(chat.id).emit('new_message', payload);
      io.to(`user:${chat.buyerId}`).emit('new_message', payload);
      io.to(`user:${chat.sellerId}`).emit('new_message', payload);
    }

    return sendCreated(res, message);
  } catch (err) {
    console.error('[chats POST message] failed:', err?.message);
    return sendError(res, 'Failed to send message', 500);
  }
});

export default router;
