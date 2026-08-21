/**
 * Admin Community — posts, comments, groups.
 *   /api/v1/admin/posts     GET (incl. soft-deleted) / PATCH (isPinned, restore) / DELETE (soft-delete)
 *   /api/v1/admin/comments  GET / DELETE
 *   /api/v1/admin/groups    GET / PATCH (isPublic, name, description)
 *
 * ADMIN gate applied by the parent router. Mutations audited. Post deletion is a
 * soft-delete (deletedAt tombstone) — matching the app's Post.deletedAt model.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { sanitizeSearch } from '../../utils/sanitizeSearch.js';
import { stripHtml } from '../../utils/encrypt.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';

// ── Posts ─────────────────────────────────────────────────────────────────────
export const postsRouter = Router();

postsRouter.get(
  '/',
  [query('category').optional().isString().isLength({ max: 60 }), query('includeDeleted').optional().isBoolean(), query('search').optional().isString().isLength({ max: 100 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.includeDeleted !== 'true') where.deletedAt = null;
      if (req.query.category) where.category = req.query.category;
      const search = sanitizeSearch(req.query.search);
      if (search) where.OR = [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.post, { where, cursor, limit, include: { author: { select: { id: true, name: true } } } });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load posts');
    }
  },
);

postsRouter.patch(
  '/:id',
  [param('id').isUUID(), body('isPinned').optional().isBoolean(), body('restore').optional().isBoolean(), body('reason').optional().isString().trim().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, isPinned: true, deletedAt: true } });
      if (!before) return sendNotFound(res, 'Post');
      const data = {};
      if (req.body.isPinned !== undefined) data.isPinned = req.body.isPinned;
      if (req.body.restore === true) data.deletedAt = null;
      if (!Object.keys(data).length) return sendServerError(res, Object.assign(new Error('Provide isPinned or restore'), { expose: true }), 'Nothing to update', 400);
      const updated = await prisma.post.update({ where: { id: req.params.id }, data, select: { id: true, isPinned: true, deletedAt: true } });
      await adminAudit(req, ADMIN_ACTIONS.POST_UPDATE, 'Post', updated.id, { before, after: updated, metadata: { reason: req.body.reason ?? null } });
      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update post');
    }
  },
);

postsRouter.delete('/:id', [param('id').isUUID(), body('reason').optional().isString().trim().isLength({ max: 500 })], validate, async (req, res) => {
  try {
    const before = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, deletedAt: true } });
    if (!before) return sendNotFound(res, 'Post');
    if (before.deletedAt) return sendSuccess(res, { id: before.id, deletedAt: before.deletedAt, alreadyDeleted: true });
    const updated = await prisma.post.update({ where: { id: req.params.id }, data: { deletedAt: new Date() }, select: { id: true, deletedAt: true } });
    await adminAudit(req, ADMIN_ACTIONS.POST_DELETE, 'Post', updated.id, { after: { deletedAt: updated.deletedAt }, metadata: { reason: req.body.reason ?? null, mode: 'soft-delete' } });
    return sendSuccess(res, updated);
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete post');
  }
});

// ── Comments ──────────────────────────────────────────────────────────────────
export const commentsRouter = Router();

commentsRouter.get(
  '/',
  [query('postId').optional().isUUID(), query('authorId').optional().isUUID(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.postId) where.postId = req.query.postId;
      if (req.query.authorId) where.authorId = req.query.authorId;
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.comment, { where, cursor, limit, include: { author: { select: { id: true, name: true } }, post: { select: { id: true, title: true } } } });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load comments');
    }
  },
);

commentsRouter.delete('/:id', [param('id').isUUID(), body('reason').optional().isString().trim().isLength({ max: 500 })], validate, async (req, res) => {
  try {
    const before = await prisma.comment.findUnique({ where: { id: req.params.id }, select: { id: true, postId: true, authorId: true } });
    if (!before) return sendNotFound(res, 'Comment');

    // This never worked, and it did damage every time it was tried.
    //
    // It was the ARRAY form of $transaction with `.catch(() => {})` on the
    // second element. A PrismaPromise is lazy; attaching .catch() materialises
    // it, so the decrement RAN IMMEDIATELY and outside the transaction, and the
    // array was then left holding a plain Promise, which $transaction refuses
    // with "All elements of the array need to be Prisma Client promises".
    //
    // So the request 500'd, the comment stayed, and commentCount went down by
    // one. Reproduced: 3 -> 2 with the comment still present. An admin clicking
    // delete five times on a spam comment left it there and the post's count
    // five lower.
    //
    // The interactive form runs the whole thing inside one transaction and
    // rolls back as a unit.
    const removed = await prisma.$transaction(async (tx) => {
      // Replies go with the parent. Comment.parent is an optional relation with
      // no onDelete, so Prisma's default is SetNull — deleting a parent would
      // have PROMOTED its replies to top-level comments, leaving answers to
      // removed content standing on their own as if they were original posts.
      // For a moderation action that is the wrong outcome; a thread is one unit.
      const replies = await tx.comment.deleteMany({ where: { parentId: before.id } });
      await tx.comment.delete({ where: { id: before.id } });

      const total = replies.count + 1;
      // GREATEST(0, …) because commentCount has already been corrupted by every
      // previous failed attempt on this post, and a negative count would render
      // as "-3 comments".
      await tx.$executeRaw`
        UPDATE "posts" SET "commentCount" = GREATEST(0, "commentCount" - ${total})
        WHERE id = ${before.postId}
      `;
      return total;
    });

    await adminAudit(req, ADMIN_ACTIONS.COMMENT_DELETE, 'Comment', before.id, {
      before, metadata: { reason: req.body.reason ?? null, removed },
    });
    return sendSuccess(res, { id: before.id, deleted: true, removed });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete comment');
  }
});

// ── Groups ────────────────────────────────────────────────────────────────────
export const groupsRouter = Router();

groupsRouter.get(
  '/',
  [query('search').optional().isString().isLength({ max: 100 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      const search = sanitizeSearch(req.query.search);
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.group, { where, cursor, limit, include: { createdBy: { select: { id: true, name: true } }, _count: { select: { members: true } } } });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load groups');
    }
  },
);

groupsRouter.patch(
  '/:id',
  [param('id').isUUID(), body('isPublic').optional().isBoolean(), body('name').optional().isString().trim().isLength({ min: 1, max: 120 }), body('description').optional({ nullable: true }).isString().isLength({ max: 1000 }), body('reason').optional().isString().trim().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.group.findUnique({ where: { id: req.params.id }, select: { id: true, isPublic: true, name: true } });
      if (!before) return sendNotFound(res, 'Group');
      const data = {};
      if (req.body.isPublic !== undefined) data.isPublic = req.body.isPublic;
      if (req.body.name !== undefined) data.name = stripHtml(req.body.name);
      if (req.body.description !== undefined) data.description = req.body.description ? stripHtml(req.body.description) : null;
      if (!Object.keys(data).length) return sendServerError(res, Object.assign(new Error('Nothing to update'), { expose: true }), 'Nothing to update', 400);
      const updated = await prisma.group.update({ where: { id: req.params.id }, data, select: { id: true, isPublic: true, name: true } });
      await adminAudit(req, ADMIN_ACTIONS.GROUP_UPDATE, 'Group', updated.id, { before, after: updated, metadata: { reason: req.body.reason ?? null } });
      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update group');
    }
  },
);
