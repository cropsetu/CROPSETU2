/**
 * Direct Messaging Routes
 * GET  /api/v1/messages/conversations     — list all DM conversations
 * GET  /api/v1/messages/:userId           — messages with a specific user
 * POST /api/v1/messages/:userId           — send a DM
 * PUT  /api/v1/messages/:userId/read      — mark as read
 */
import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { validate } from '../middleware/validate.js';
import prisma from '../config/db.js';
import { sendSuccess, sendCreated, sendError, sendNotFound } from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';

const router = Router();
router.param('userId', uuidParamGuard); // conversation-partner user id — reject non-UUIDs with 400

// ── All conversations (like WhatsApp home) ────────────────────────────────────
router.get('/conversations', authenticate, async (req, res) => {
  const userId = req.user.id;

  // Get all users I've DMed or who've DMed me
  const sent = await prisma.directMessage.findMany({
    where: { senderId: userId },
    select: { receiverId: true, createdAt: true },
    distinct: ['receiverId'],
    orderBy: { createdAt: 'desc' },
  });

  const received = await prisma.directMessage.findMany({
    where: { receiverId: userId },
    select: { senderId: true, createdAt: true },
    distinct: ['senderId'],
    orderBy: { createdAt: 'desc' },
  });

  // Merge unique user IDs
  const partnerIds = [...new Set([
    ...sent.map((m) => m.receiverId),
    ...received.map((m) => m.senderId),
  ])];

  if (!partnerIds.length) return sendSuccess(res, []);

  // For each partner, get the last message + unread count
  const conversations = await Promise.all(
    partnerIds.map(async (partnerId) => {
      const [partner, lastMessage, unreadCount] = await Promise.all([
        prisma.user.findUnique({
          where: { id: partnerId },
          select: { id: true, name: true, avatar: true, statusQuote: true, isOnline: true, lastSeenAt: true },
        }),
        prisma.directMessage.findFirst({
          where: {
            OR: [
              { senderId: userId, receiverId: partnerId },
              { senderId: partnerId, receiverId: userId },
            ],
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.directMessage.count({
          where: { senderId: partnerId, receiverId: userId, readAt: null },
        }),
      ]);

      return { partner, lastMessage, unreadCount };
    })
  );

  // Sort by last message time and flatten for frontend
  const flat = conversations
    .filter((c) => c.partner)
    .sort((a, b) => new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0))
    .map((c) => ({
      partnerId:          c.partner.id,
      partnerName:        c.partner.name,
      partnerAvatar:      c.partner.avatar,
      partnerStatusQuote: c.partner.statusQuote,
      partnerOnline:      c.partner.isOnline,
      partnerLastSeen:    c.partner.lastSeenAt,
      lastMessage:        c.lastMessage,
      unreadCount:        c.unreadCount,
    }));

  return sendSuccess(res, flat);
});

// ── Get messages with a user ──────────────────────────────────────────────────
router.get('/:userId', authenticate, async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const cursor = req.query.cursor;

  const partner = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { id: true, name: true, avatar: true, statusQuote: true, isOnline: true, lastSeenAt: true },
  });
  if (!partner) return sendNotFound(res, 'User');

  const messages = await prisma.directMessage.findMany({
    where: {
      OR: [
        { senderId: req.user.id, receiverId: req.params.userId },
        { senderId: req.params.userId, receiverId: req.user.id },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  // Mark received messages as read
  await prisma.directMessage.updateMany({
    where: { senderId: req.params.userId, receiverId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  return sendSuccess(res, { partner, messages: messages.reverse() });
});

// ── Send a DM ─────────────────────────────────────────────────────────────────
router.post(
  '/:userId',
  authenticate,
  [
    body('text').optional().trim(),
    body('imageUrl').optional(),
  ],
  validate,
  async (req, res) => {
    const { text, imageUrl } = req.body;
    if (!text && !imageUrl) return sendError(res, 'text or imageUrl required', 400);
    if (text && text.length > 5000) return sendError(res, 'text too long (max 5000 chars)', 400);
    if (req.params.userId === req.user.id) return sendError(res, 'Cannot message yourself', 400);

    const receiver = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!receiver) return sendNotFound(res, 'User');

    const message = await prisma.directMessage.create({
      data: {
        senderId: req.user.id,
        receiverId: req.params.userId,
        text: text ? stripHtml(text) : null,
        imageUrl: imageUrl || null,
      },
    });

    return sendCreated(res, message);
  }
);

// ── Mark conversation as read ─────────────────────────────────────────────────
router.put('/:userId/read', authenticate, async (req, res) => {
  await prisma.directMessage.updateMany({
    where: { senderId: req.params.userId, receiverId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return sendSuccess(res, { read: true });
});

export default router;
