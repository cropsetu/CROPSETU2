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
import { sendSuccess, sendCreated, sendError, sendNotFound, parsePageSize } from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';

const router = Router();
router.param('userId', uuidParamGuard); // conversation-partner user id — reject non-UUIDs with 400

/**
 * Newest DM per conversation partner, as Map(partnerId → message).
 *
 * One LATERAL seek per partner id inside a single round trip, rather than one
 * `findFirst` per partner. `m.*` keeps the full column set so the response shape
 * is unchanged — row COUNT was the problem, not width.
 *
 * The partner id is derived in SQL: a DM row stores senderId/receiverId, so the
 * "other side" is whichever of the two is not `me`.
 */
async function lastDirectMessages(me, partnerIds) {
  if (!partnerIds.length) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT t.pid AS "partnerId", m.*
    FROM unnest(${partnerIds}::text[]) AS t(pid)
    CROSS JOIN LATERAL (
      SELECT * FROM "direct_messages"
      WHERE ("senderId" = ${me} AND "receiverId" = t.pid)
         OR ("senderId" = t.pid AND "receiverId" = ${me})
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 1
    ) m
  `;
  return new Map(rows.map((r) => [r.partnerId, r]));
}

/**
 * Unread count per partner for `me`, as Map(partnerId → count).
 *
 * Scoped to the partners actually being listed. An unscoped aggregate here would
 * be the §34/PERF-034 shape — cost proportional to every unread message on the
 * platform rather than to this inbox.
 */
async function unreadDirectCounts(me, partnerIds) {
  if (!partnerIds.length) return new Map();
  const rows = await prisma.directMessage.groupBy({
    by: ['senderId'],
    where: { senderId: { in: partnerIds }, receiverId: me, readAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.senderId, r._count._all]));
}

// ── All conversations (like WhatsApp home) ────────────────────────────────────
router.get('/conversations', authenticate, async (req, res) => {
  const userId = req.user.id;

  // Partners, by GROUP BY rather than `distinct`.
  //
  // Prisma does not push `distinct` into SQL — it emits a plain SELECT with no
  // DISTINCT and dedupes in the query engine, so the previous shape streamed
  // EVERY DM row this user has ever sent or received into the process just to
  // learn who they talked to. groupBy does the dedupe in Postgres.
  const [sent, received] = await Promise.all([
    prisma.directMessage.groupBy({ by: ['receiverId'], where: { senderId: userId } }),
    prisma.directMessage.groupBy({ by: ['senderId'], where: { receiverId: userId } }),
  ]);

  const partnerIds = [...new Set([
    ...sent.map((m) => m.receiverId),
    ...received.map((m) => m.senderId),
  ])].filter(Boolean);

  if (!partnerIds.length) return sendSuccess(res, []);

  // Three queries for the whole inbox, not three PER PARTNER.
  //
  // This route used to run `prisma.user.findUnique` + `findFirst` (last message)
  // + `count` (unread) inside a map over every partner — the textbook §15 shape,
  // and the same defect PERF-006 fixed for the animaltrade inbox, left in place
  // here. There is no `take` anywhere on this route, so partner count is
  // unbounded: a farmer with 40 DM partners cost 2 + 120 queries to open their
  // inbox.
  //
  // Same three-query shape as animaltrade's: a batched user fetch, one LATERAL
  // seek for the newest message per partner, and one scoped groupBy for unread
  // counts.
  const [partners, lastByPartner, unreadByPartner] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, name: true, avatar: true, statusQuote: true, isOnline: true, lastSeenAt: true },
    }),
    lastDirectMessages(userId, partnerIds),
    unreadDirectCounts(userId, partnerIds),
  ]);

  const conversations = partners.map((partner) => ({
    partner,
    lastMessage: lastByPartner.get(partner.id) || null,
    unreadCount: unreadByPartner.get(partner.id) || 0,
  }));

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
  const limit = parsePageSize(req.query.limit, 50, 100); // bound page size: avoid unbounded thread fetch
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
