/**
 * Community Groups Routes (WhatsApp-like)
 * GET    /api/v1/groups              ?district&city&search
 * POST   /api/v1/groups              create group
 * GET    /api/v1/groups/my           groups I'm a member of
 * GET    /api/v1/groups/:id
 * PUT    /api/v1/groups/:id          update (admin only)
 * POST   /api/v1/groups/:id/join
 * POST   /api/v1/groups/:id/leave
 * DELETE /api/v1/groups/:id/members/:userId  (admin only)
 * GET    /api/v1/groups/:id/messages ?cursor&limit
 * POST   /api/v1/groups/:id/messages
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import multer from 'multer';
import os from 'os';
import { authenticate } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { auditAction, AUDIT_ACTIONS } from '../services/audit.service.js';
import { validate } from '../middleware/validate.js';
import { createUploader, uploadFiles } from '../config/cloudinary.js';
import prisma from '../config/db.js';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, paginationMeta } from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';
import { sanitizeSearch } from '../utils/sanitizeSearch.js';

const router = Router();
router.param('id', uuidParamGuard);     // group id
router.param('userId', uuidParamGuard); // member user id
const avatarUpload = createUploader(1); // 1 image max for group avatar

// ── List groups (discover) ─────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { district, city } = req.query;
  const search = sanitizeSearch(req.query.search); // strip LIKE wildcards / cap length
  const page  = parseInt(req.query.page  || '1', 10);
  const limit = parseInt(req.query.limit || '20', 10);

  const where = { isPublic: true };
  if (district) where.district = { equals: district, mode: 'insensitive' };
  if (city)     where.city     = { equals: city, mode: 'insensitive' };
  if (search)   where.name     = { contains: search, mode: 'insensitive' };

  const [groups, total] = await Promise.all([
    prisma.group.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true, avatar: true } },
        members: { where: { userId: req.user.id }, select: { id: true, role: true } },
        _count: { select: { members: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.group.count({ where }),
  ]);

  const enriched = groups.map((g) => ({
    ...g,
    isMember: g.members.length > 0,
    myRole: g.members[0]?.role || null,
    memberCount: g._count.members,
    members: undefined,
    _count: undefined,
  }));

  return sendSuccess(res, enriched, 200, paginationMeta(total, page, limit));
});

// ── My groups ─────────────────────────────────────────────────────────────────
router.get('/my', authenticate, async (req, res) => {
  const memberships = await prisma.groupMember.findMany({
    where: { userId: req.user.id },
    include: {
      group: {
        include: {
          _count: { select: { members: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { sender: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { group: { lastMessageAt: 'desc' } },
  });

  const groups = memberships.map((m) => ({
    ...m.group,
    myRole: m.role,
    memberCount: m.group._count.members,
    lastMsg: m.group.messages[0] || null,
    messages: undefined,
    _count: undefined,
  }));

  return sendSuccess(res, groups);
});

// ── Create group ──────────────────────────────────────────────────────────────
router.post(
  '/',
  authenticate,
  (req, res, next) => avatarUpload(req, res, (err) => { if (err) return sendError(res, err.message, 400); next(); }),
  [
    body('name').trim().isLength({ min: 3, max: 60 }),
    body('description').optional().trim().isLength({ max: 300 }),
    body('isPublic').optional().isBoolean(),
    body('district').optional().trim(),
    body('city').optional().trim(),
  ],
  validate,
  async (req, res) => {
    const { name, description, isPublic, district, city } = req.body;
    const avatarUrls = await uploadFiles(req.files || [], 'groups');

    const group = await prisma.$transaction(async (tx) => {
      const g = await tx.group.create({
        data: {
          name, description,
          avatar: avatarUrls[0] || null,
          createdById: req.user.id,
          isPublic: isPublic !== false,
          district: district || req.user.district || null,
          city: city || req.user.city || null,
          memberCount: 1,
          lastMessageAt: new Date(),
        },
      });
      await tx.groupMember.create({
        data: { groupId: g.id, userId: req.user.id, role: 'ADMIN' },
      });
      return g;
    });

    return sendCreated(res, group);
  }
);

// ── Get single group ──────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { id: true, name: true, avatar: true } },
      members: {
        include: { user: { select: { id: true, name: true, avatar: true, statusQuote: true, isOnline: true, lastSeenAt: true } } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      },
    },
  });
  if (!group) return sendNotFound(res, 'Group');

  const myMembership = group.members.find((m) => m.userId === req.user.id);
  return sendSuccess(res, { ...group, isMember: !!myMembership, myRole: myMembership?.role || null });
});

// ── Update group (admin only) ─────────────────────────────────────────────────
router.put(
  '/:id',
  authenticate,
  (req, res, next) => avatarUpload(req, res, (err) => { if (err) return sendError(res, err.message, 400); next(); }),
  async (req, res) => {
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId: req.user.id } },
    });
    if (!membership || membership.role !== 'ADMIN') return sendForbidden(res, 'Only admin can update group');

    const { name, description, isPublic, district, city } = req.body;
    const avatarUrls = await uploadFiles(req.files || [], 'groups');

    const data = {};
    if (name)        data.name = name;
    if (description !== undefined) data.description = description;
    if (isPublic !== undefined)    data.isPublic = isPublic === 'true' || isPublic === true;
    if (district)    data.district = district;
    if (city)        data.city = city;
    if (avatarUrls[0]) data.avatar = avatarUrls[0];

    const group = await prisma.group.update({ where: { id: req.params.id }, data });
    return sendSuccess(res, group);
  }
);

// ── Join group ─────────────────────────────────────────────────────────────────
router.post('/:id/join', authenticate, async (req, res) => {
  const group = await prisma.group.findUnique({ where: { id: req.params.id } });
  if (!group) return sendNotFound(res, 'Group');

  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: group.id, userId: req.user.id } },
  });
  if (existing) return sendError(res, 'Already a member', 400);

  await prisma.$transaction([
    prisma.groupMember.create({ data: { groupId: group.id, userId: req.user.id, role: 'MEMBER' } }),
    prisma.group.update({ where: { id: group.id }, data: { memberCount: { increment: 1 } } }),
    // System message
    prisma.groupMessage.create({
      data: {
        groupId: group.id,
        senderId: req.user.id,
        text: `${req.user.name || 'A user'} joined the group`,
        type: 'system',
      },
    }),
  ]);

  return sendSuccess(res, { joined: true });
});

// ── Leave group ────────────────────────────────────────────────────────────────
router.post('/:id/leave', authenticate, async (req, res) => {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: req.user.id } },
  });
  if (!membership) return sendError(res, 'Not a member', 400);

  await prisma.$transaction([
    prisma.groupMember.delete({ where: { id: membership.id } }),
    prisma.group.update({ where: { id: req.params.id }, data: { memberCount: { decrement: 1 } } }),
    prisma.groupMessage.create({
      data: {
        groupId: req.params.id,
        senderId: req.user.id,
        text: `${req.user.name || 'A user'} left the group`,
        type: 'system',
      },
    }),
  ]);

  return sendSuccess(res, { left: true });
});

// ── Remove member (admin only) ─────────────────────────────────────────────────
router.delete('/:id/members/:userId', authenticate, async (req, res) => {
  const myMembership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: req.user.id } },
  });
  if (!myMembership || myMembership.role !== 'ADMIN') return sendForbidden(res, 'Only admin can remove members');

  await prisma.groupMember.deleteMany({
    where: { groupId: req.params.id, userId: req.params.userId },
  });

  // Audit the moderation action (admin removed a member from a group).
  auditAction(req, {
    action:   AUDIT_ACTIONS.GROUP_MEMBER_REMOVE,
    entity:   'Group',
    entityId: req.params.id,
    metadata: { removedUserId: req.params.userId, removedBy: req.user.id },
  }).catch(() => {});

  return sendSuccess(res, { removed: true });
});

// ── Get group messages (paginated, cursor-based) ───────────────────────────────
router.get('/:id/messages', authenticate, async (req, res) => {
  const isMember = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.id, userId: req.user.id } },
  });
  if (!isMember) return sendForbidden(res, 'Not a member of this group');

  const limit = parseInt(req.query.limit || '50', 10);
  const cursor = req.query.cursor; // message ID for pagination

  const messages = await prisma.groupMessage.findMany({
    where: { groupId: req.params.id },
    include: {
      sender: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  // Return in ascending order (oldest first)
  return sendSuccess(res, messages.reverse());
});

// ── Send group message ─────────────────────────────────────────────────────────
router.post(
  '/:id/messages',
  authenticate,
  [body('text').optional().trim(), body('imageUrl').optional().isURL()],
  validate,
  async (req, res) => {
    const isMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId: req.user.id } },
    });
    if (!isMember) return sendForbidden(res, 'Not a member of this group');

    const { text, imageUrl } = req.body;
    if (!text && !imageUrl) return sendError(res, 'text or imageUrl required', 400);
    if (text && text.length > 5000) return sendError(res, 'text too long (max 5000 chars)', 400);

    const safeText = text ? stripHtml(text) : null;
    const [message] = await prisma.$transaction([
      prisma.groupMessage.create({
        data: { groupId: req.params.id, senderId: req.user.id, text: safeText, imageUrl },
        include: { sender: { select: { id: true, name: true, avatar: true } } },
      }),
      prisma.group.update({
        where: { id: req.params.id },
        data: { lastMessage: safeText || '📷 Photo', lastMessageAt: new Date() },
      }),
    ]);

    return sendCreated(res, message);
  }
);

export default router;
