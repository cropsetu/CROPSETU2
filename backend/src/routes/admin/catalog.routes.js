/**
 * Admin Catalog — categories, products, reviews.
 *   /api/v1/admin/categories     CRUD (multilingual name + icon/color/sortOrder/isActive)
 *   /api/v1/admin/products       GET list / GET :id / PATCH (approve/isActive/isFeatured/stock/price)
 *                                / DELETE (soft → isActive=false)
 *   /api/v1/admin/reviews        GET list / DELETE (abuse removal)
 *
 * Mounted as three sibling routers by the admin index. ADMIN gate applied by parent.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendCreated, sendServerError, sendNotFound } from '../../utils/response.js';
import { sanitizeSearch } from '../../utils/sanitizeSearch.js';
import { stripHtml } from '../../utils/encrypt.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';

// Multilingual Category name columns (schema-exact).
const CAT_LANGS = ['nameHi', 'nameMr', 'nameTa', 'nameKn', 'nameMl', 'nameTe', 'nameBn', 'nameGu', 'namePa'];

// ── Categories ────────────────────────────────────────────────────────────────
export const categoriesRouter = Router();

categoriesRouter.get('/', async (_req, res) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return sendSuccess(res, { items: categories });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load categories');
  }
});

const categoryBody = [
  body('name').optional().isString().trim().isLength({ min: 1, max: 80 }),
  body('icon').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('color').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('sortOrder').optional().isInt({ min: 0, max: 9999 }),
  body('isActive').optional().isBoolean(),
  ...CAT_LANGS.map((l) => body(l).optional({ nullable: true }).isString().isLength({ max: 80 })),
];

function pickCategoryData(b) {
  const data = {};
  for (const k of ['name', 'icon', 'color', 'sortOrder', 'isActive', ...CAT_LANGS]) {
    if (b[k] !== undefined) data[k] = typeof b[k] === 'string' ? stripHtml(b[k]) : b[k];
  }
  return data;
}

categoriesRouter.post('/', [body('name').isString().trim().isLength({ min: 1, max: 80 }), ...categoryBody], validate, async (req, res) => {
  try {
    const data = pickCategoryData(req.body);
    const created = await prisma.category.create({ data });
    await adminAudit(req, ADMIN_ACTIONS.CATEGORY_CREATE, 'Category', created.id, { after: { name: created.name } });
    return sendCreated(res, created);
  } catch (err) {
    if (err?.code === 'P2002') return sendServerError(res, Object.assign(new Error('A category with that name already exists'), { expose: true }), 'Duplicate category', 409);
    return sendServerError(res, err, 'Failed to create category');
  }
});

categoriesRouter.patch('/:id', [param('id').isUUID(), ...categoryBody], validate, async (req, res) => {
  try {
    const before = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!before) return sendNotFound(res, 'Category');
    const data = pickCategoryData(req.body);
    const updated = await prisma.category.update({ where: { id: req.params.id }, data });
    await adminAudit(req, ADMIN_ACTIONS.CATEGORY_UPDATE, 'Category', updated.id, { before: { name: before.name, isActive: before.isActive }, after: { name: updated.name, isActive: updated.isActive } });
    return sendSuccess(res, updated);
  } catch (err) {
    if (err?.code === 'P2002') return sendServerError(res, Object.assign(new Error('A category with that name already exists'), { expose: true }), 'Duplicate category', 409);
    return sendServerError(res, err, 'Failed to update category');
  }
});

categoriesRouter.delete('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const cat = await prisma.category.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, _count: { select: { products: true } } } });
    if (!cat) return sendNotFound(res, 'Category');
    if (cat._count.products > 0) {
      return sendServerError(res, Object.assign(new Error('Category has products; deactivate it instead of deleting'), { expose: true }), 'Category not empty', 409);
    }
    await prisma.category.delete({ where: { id: req.params.id } });
    await adminAudit(req, ADMIN_ACTIONS.CATEGORY_DELETE, 'Category', cat.id, { before: { name: cat.name } });
    return sendSuccess(res, { id: cat.id, deleted: true });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete category');
  }
});

// ── Products ──────────────────────────────────────────────────────────────────
export const productsRouter = Router();

// Express-validator chain for the shared product filters (list + export reuse it).
export const productFilterValidators = [
  query('categoryId').optional().isUUID(),
  query('sellerId').optional().isUUID(),
  query('isActive').optional().isBoolean(),
  query('isFeatured').optional().isBoolean(),
  query('search').optional().isString().isLength({ max: 100 }),
];

// Build the Prisma `where` for the product list from the filter query params.
// Shared by GET /products and the CSV export so they always select the SAME set.
export function buildProductWhere(q) {
  const where = {};
  if (q.categoryId) where.categoryId = q.categoryId;
  if (q.sellerId) where.sellerId = q.sellerId;
  if (q.isActive !== undefined) where.isActive = q.isActive === 'true';
  if (q.isFeatured !== undefined) where.isFeatured = q.isFeatured === 'true';
  const search = sanitizeSearch(q.search);
  if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];
  return where;
}

productsRouter.get(
  '/',
  [...productFilterValidators, query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = buildProductWhere(req.query);

      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.product, {
        where, cursor, limit,
        include: { category: { select: { id: true, name: true } }, seller: { select: { id: true, name: true } } },
      });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load products');
    }
  },
);

productsRouter.get('/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { category: { select: { id: true, name: true } }, seller: { select: { id: true, name: true } }, _count: { select: { reviews: true, orderItems: true } } },
    });
    if (!product) return sendNotFound(res, 'Product');
    return sendSuccess(res, product);
  } catch (err) {
    return sendServerError(res, err, 'Failed to load product');
  }
});

productsRouter.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('isActive').optional().isBoolean(),
    body('isFeatured').optional().isBoolean(),
    body('stock').optional().isInt({ min: 0, max: 1_000_000 }),
    body('price').optional().isFloat({ min: 0 }),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.product.findUnique({ where: { id: req.params.id }, select: { id: true, isActive: true, isFeatured: true, stock: true, price: true } });
      if (!before) return sendNotFound(res, 'Product');
      const data = {};
      for (const k of ['isActive', 'isFeatured', 'stock']) if (req.body[k] !== undefined) data[k] = req.body[k];
      if (req.body.price !== undefined) data.price = req.body.price;
      if (!Object.keys(data).length) return sendServerError(res, Object.assign(new Error('No updatable fields provided'), { expose: true }), 'Nothing to update', 400);

      const updated = await prisma.product.update({ where: { id: req.params.id }, data, select: { id: true, isActive: true, isFeatured: true, stock: true, price: true } });
      await adminAudit(req, ADMIN_ACTIONS.PRODUCT_UPDATE, 'Product', updated.id, { before, after: updated, metadata: { reason: req.body.reason ?? null } });
      return sendSuccess(res, updated);
    } catch (err) {
      return sendServerError(res, err, 'Failed to update product');
    }
  },
);

// Soft removal: deactivate (Product has no deletedAt; orderItems FK is RESTRICT,
// so a hard delete on an ordered product would fail — deactivation is the safe op).
productsRouter.delete('/:id', [param('id').isUUID(), body('reason').optional().isString().trim().isLength({ max: 500 })], validate, async (req, res) => {
  try {
    const before = await prisma.product.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, isActive: true } });
    if (!before) return sendNotFound(res, 'Product');
    await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
    await adminAudit(req, ADMIN_ACTIONS.PRODUCT_DELETE, 'Product', before.id, { before: { isActive: before.isActive }, after: { isActive: false }, metadata: { reason: req.body.reason ?? null, mode: 'soft-deactivate' } });
    return sendSuccess(res, { id: before.id, isActive: false });
  } catch (err) {
    return sendServerError(res, err, 'Failed to remove product');
  }
});

// ── Reviews ───────────────────────────────────────────────────────────────────
export const reviewsRouter = Router();

reviewsRouter.get(
  '/',
  [query('productId').optional().isUUID(), query('userId').optional().isUUID(), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const where = {};
      if (req.query.productId) where.productId = req.query.productId;
      if (req.query.userId) where.userId = req.query.userId;
      const { cursor, limit } = listParams(req);
      const page = await keysetList(prisma.review, {
        where, cursor, limit,
        include: { user: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } },
      });
      return sendSuccess(res, { items: page.items }, 200, { hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load reviews');
    }
  },
);

reviewsRouter.delete('/:id', [param('id').isUUID(), body('reason').optional().isString().trim().isLength({ max: 500 })], validate, async (req, res) => {
  try {
    const before = await prisma.review.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true, productId: true, rating: true } });
    if (!before) return sendNotFound(res, 'Review');
    await prisma.review.delete({ where: { id: req.params.id } });
    await adminAudit(req, ADMIN_ACTIONS.REVIEW_DELETE, 'Review', before.id, { before, metadata: { reason: req.body.reason ?? null } });
    return sendSuccess(res, { id: before.id, deleted: true });
  } catch (err) {
    return sendServerError(res, err, 'Failed to delete review');
  }
});
