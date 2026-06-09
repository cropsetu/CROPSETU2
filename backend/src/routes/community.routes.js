/**
 * Community Routes
 * GET  /api/v1/community/posts          ?category&search&page&limit
 * GET  /api/v1/community/posts/:id
 * POST /api/v1/community/posts          (auth, multipart)
 * POST /api/v1/community/posts/:id/like (auth) — toggle
 * POST /api/v1/community/posts/:id/bookmark (auth) — toggle
 * GET  /api/v1/community/posts/:id/comments
 * POST /api/v1/community/posts/:id/comments { text, parentId? }
 * DELETE /api/v1/community/comments/:id
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { validate } from '../middleware/validate.js';
import { createUploader, uploadFiles } from '../config/cloudinary.js';
import prisma from '../config/db.js';
import {
  sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, paginationMeta,
} from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';
import { sanitizeSearch } from '../utils/sanitizeSearch.js';

const router = Router();
router.param('id', uuidParamGuard); // reject non-UUID :id with 400 before Prisma
const postImageUpload = createUploader(4);

// ── Posts ─────────────────────────────────────────────────────────────────────
router.get(
  '/posts',
  optionalAuth,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  validate,
  async (req, res) => {
    const page  = parseInt(req.query.page  || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const { category, scope, district, city } = req.query;
    const search = sanitizeSearch(req.query.search); // strip LIKE wildcards / cap length

    const where = {};
    if (category && category !== 'all') where.category = category;
    if (search) {
      where.OR = [
        { title:       { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags:        { has: search.toLowerCase() } },
      ];
    }

    // Location scope filter
    // scope=all → show all posts
    // scope=district&district=Ahmednagar → posts for that district + all-scope posts
    // scope=city&city=Sangamner → posts for that city + all-scope posts
    if (scope === 'district' && district) {
      where.AND = [{
        OR: [
          { scope: 'ALL' },
          { scope: 'DISTRICT', district: { equals: district, mode: 'insensitive' } },
        ],
      }];
    } else if (scope === 'city' && city) {
      where.AND = [{
        OR: [
          { scope: 'ALL' },
          { scope: 'DISTRICT', district: { equals: district, mode: 'insensitive' } },
          { scope: 'CITY', city: { equals: city, mode: 'insensitive' } },
        ],
      }];
    }

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, avatar: true } },
          ...(req.user && {
            likes:     { where: { userId: req.user.id }, select: { id: true } },
            bookmarks: { where: { userId: req.user.id }, select: { id: true } },
          }),
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.post.count({ where }),
    ]);

    // Flatten liked/bookmarked into boolean fields
    const enriched = posts.map((p) => ({
      ...p,
      liked:      p.likes?.length > 0,
      bookmarked: p.bookmarks?.length > 0,
      likes:      undefined,
      bookmarks:  undefined,
    }));

    return sendSuccess(res, enriched, 200, paginationMeta(total, page, limit));
  }
);

router.get('/posts/:id', optionalAuth, async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      ...(req.user && {
        likes:     { where: { userId: req.user.id }, select: { id: true } },
        bookmarks: { where: { userId: req.user.id }, select: { id: true } },
      }),
    },
  });
  if (!post) return sendNotFound(res, 'Post');

  prisma.post.update({ where: { id: post.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

  return sendSuccess(res, {
    ...post,
    liked:      post.likes?.length > 0,
    bookmarked: post.bookmarks?.length > 0,
    likes:      undefined,
    bookmarks:  undefined,
  });
});

router.post(
  '/posts',
  authenticate,
  (req, res, next) => postImageUpload(req, res, (err) => {
    if (err) return sendError(res, err.message, 400);
    next();
  }),
  [
    body('title').trim().isLength({ min: 5, max: 200 }),
    body('description').trim().isLength({ min: 10, max: 5000 }),
    body('category').isIn(['crop-tips', 'market', 'weather', 'pest-disease', 'success', 'general']),
    body('tags').optional().isArray(),
  ],
  validate,
  async (req, res) => {
    const { title, description, category, tags } = req.body;
    const images = await uploadFiles(req.files || [], 'community');

    const post = await prisma.post.create({
      data: {
        authorId: req.user.id,
        title: stripHtml(title), description: stripHtml(description), category,
        images,
        tags: tags || [],
      },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });

    return sendCreated(res, post);
  }
);

// ── Like toggle ───────────────────────────────────────────────────────────────
router.post('/posts/:id/like', authenticate, async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post) return sendNotFound(res, 'Post');

  const existing = await prisma.postLike.findUnique({
    where: { postId_userId: { postId: post.id, userId: req.user.id } },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.postLike.delete({ where: { id: existing.id } }),
      prisma.post.update({ where: { id: post.id }, data: { likeCount: { decrement: 1 } } }),
    ]);
    return sendSuccess(res, { liked: false });
  }

  await prisma.$transaction([
    prisma.postLike.create({ data: { postId: post.id, userId: req.user.id } }),
    prisma.post.update({ where: { id: post.id }, data: { likeCount: { increment: 1 } } }),
  ]);
  return sendSuccess(res, { liked: true });
});

// ── Saved (bookmarked) posts for the current user ────────────────────────────
router.get('/saved', authenticate, async (req, res) => {
  const page  = parseInt(req.query.page  || '1', 10);
  const limit = parseInt(req.query.limit || '20', 10);

  const [bookmarks, total] = await Promise.all([
    prisma.postBookmark.findMany({
      where: { userId: req.user.id },
      include: {
        post: {
          include: { author: { select: { id: true, name: true, avatar: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.postBookmark.count({ where: { userId: req.user.id } }),
  ]);

  const posts = bookmarks.map((b) => ({ ...b.post, bookmarked: true }));
  return sendSuccess(res, posts, 200, paginationMeta(total, page, limit));
});

// ── Bookmark toggle ───────────────────────────────────────────────────────────
router.post('/posts/:id/bookmark', authenticate, async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post) return sendNotFound(res, 'Post');

  const existing = await prisma.postBookmark.findUnique({
    where: { postId_userId: { postId: post.id, userId: req.user.id } },
  });

  if (existing) {
    await prisma.postBookmark.delete({ where: { id: existing.id } });
    return sendSuccess(res, { bookmarked: false });
  }

  await prisma.postBookmark.create({ data: { postId: post.id, userId: req.user.id } });
  return sendSuccess(res, { bookmarked: true });
});

// ── Comments ──────────────────────────────────────────────────────────────────
router.get('/posts/:id/comments', async (req, res) => {
  const comments = await prisma.comment.findMany({
    where: { postId: req.params.id, parentId: null },
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      replies: {
        include: { author: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return sendSuccess(res, comments);
});

router.post(
  '/posts/:id/comments',
  authenticate,
  [
    body('text').trim().isLength({ min: 1, max: 1000 }),
    body('parentId').optional().isUUID(),
  ],
  validate,
  async (req, res) => {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) return sendNotFound(res, 'Post');

    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: {
          postId: post.id,
          authorId: req.user.id,
          text: stripHtml(req.body.text),
          parentId: req.body.parentId || null,
        },
        include: { author: { select: { id: true, name: true, avatar: true } } },
      });
      await tx.post.update({ where: { id: post.id }, data: { commentCount: { increment: 1 } } });
      return c;
    });

    return sendCreated(res, comment);
  }
);

router.delete('/comments/:id', authenticate, async (req, res) => {
  const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
  if (!comment) return sendNotFound(res, 'Comment');
  if (comment.authorId !== req.user.id && req.user.role !== 'ADMIN') return sendForbidden(res);

  await prisma.comment.delete({ where: { id: comment.id } });
  await prisma.post.update({
    where: { id: comment.postId },
    data: { commentCount: { decrement: 1 } },
  }).catch(() => {});

  return sendSuccess(res, { deleted: true });
});

export default router;
