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
import { bumpListingVersion } from '../../utils/listingCache.js';
import { invalidateBuyBox } from '../../services/buyBox.service.js';
import { findCatalogDuplicate, normalizeProductKey } from '../../services/catalogMatch.service.js';
import { requireScope, ADMIN_SCOPES } from '../../middleware/admin.js';

// Admin product mutations never invalidated the storefront cache —
// bumpListingVersion('agristore:products') was only ever called from
// agristore.routes.js. Without this, an admin edit stays invisible for up to the
// 60 s TTL and reads as "the save did nothing".
async function invalidateStorefront() {
  await Promise.all([bumpListingVersion('agristore:products'), invalidateBuyBox()]);
}

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

// Scope gate lives HERE, not on the parent's `/products` mount. Four routers share
// that prefix, and requireScope answers with 403 rather than next('router'), so a
// gate at the mount runs for every /products/* URL and the first one wins — which
// made Catalog QC unreachable for CONTENT_MODERATOR and this router unreachable for
// CMS_EDITOR. Gating inside each router keeps every check scoped to its own paths.
productsRouter.use(requireScope(ADMIN_SCOPES.CMS_EDITOR));

// Express-validator chain for the shared product filters (list + export reuse it).
export const productFilterValidators = [
  query('categoryId').optional().isUUID(),
  query('sellerId').optional().isUUID(),
  query('isActive').optional().isBoolean(),
  query('isFeatured').optional().isBoolean(),
  query('status').optional().isIn(['PENDING_QC', 'APPROVED', 'REJECTED', 'MERGED']),
  query('search').optional().isString().isLength({ max: 100 }),
];

// Build the Prisma `where` for the product list from the filter query params.
// Shared by GET /products and the CSV export so they always select the SAME set.
export function buildProductWhere(q) {
  const where = {};
  if (q.categoryId) where.categoryId = q.categoryId;
  // "products by this seller" is now "products this seller has an OFFER on" —
  // sellerId is not a product column any more. The legacy branch keeps
  // pre-backfill rows findable.
  if (q.sellerId) {
    where.OR = [
      { variants: { some: { listings: { some: { sellerId: q.sellerId } } } } },
      { sellerId: q.sellerId, variants: { none: {} } }, // DUAL-READ
    ];
  }
  if (q.status) where.status = q.status;
  if (q.isActive !== undefined) where.isActive = q.isActive === 'true';
  if (q.isFeatured !== undefined) where.isFeatured = q.isFeatured === 'true';
  const search = sanitizeSearch(q.search);
  if (search) {
    const searchOr = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
    // Don't clobber the sellerId OR — AND them together.
    if (where.OR) { where.AND = [{ OR: where.OR }, { OR: searchOr }]; delete where.OR; }
    else where.OR = searchOr;
  }
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

// Create a catalog product directly from the admin panel. Admin-created products
// have a null sellerId (they belong to no seller). Images are Cloudinary URLs the
// client already uploaded via POST /upload/image.
productsRouter.post(
  '/',
  [
    body('name').isString().trim().isLength({ min: 1, max: 200 }).withMessage('Product name is required'),
    body('nameHi').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('nameMr').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('categoryId').isUUID().withMessage('A valid category is required'),
    body('price').isFloat({ gt: 0 }).withMessage('Price must be greater than 0'),
    body('mrp').optional({ nullable: true }).isFloat({ min: 0 }),
    body('unit').optional({ nullable: true }).isString().isLength({ max: 32 }),
    body('stock').optional().isInt({ min: 0, max: 1_000_000 }),
    body('description').optional({ nullable: true }).isString().isLength({ max: 5000 }),
    body('images').optional().isArray({ max: 10 }),
    body('images.*').optional().isString().isLength({ max: 1000 }),
    body('tags').optional().isArray({ max: 30 }),
    body('tags.*').optional().isString().isLength({ max: 60 }),
    body('highlights').optional().isArray({ max: 30 }),
    body('highlights.*').optional().isString().isLength({ max: 200 }),
    body('brand').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('manufacturer').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('countryOfOrigin').optional({ nullable: true }).isString().isLength({ max: 80 }),
    body('subcategory').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('minOrderQty').optional().isInt({ min: 1, max: 1_000_000 }),
    body('sellScope').optional({ nullable: true }).isString().isLength({ max: 32 }),
    body('district').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('state').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('taluka').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('village').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('isActive').optional().isBoolean(),
    body('isFeatured').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const b = req.body;

      // Category must exist (FK is required); fail with a clear 400 if not.
      const category = await prisma.category.findUnique({ where: { id: b.categoryId }, select: { id: true } });
      if (!category) {
        return sendServerError(res, Object.assign(new Error('Selected category does not exist'), { expose: true }), 'Invalid category', 400);
      }

      const cleanStr = (v) => (typeof v === 'string' ? stripHtml(v) : v);
      const cleanArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map(cleanStr) : []);

      // The admin create path had NO duplicate check at all — it did not even call
      // the fraud heuristic the seller path used. An admin adding a product a
      // Kendra already listed produced exactly the split catalogue this project
      // exists to remove, so it runs the same cross-seller gate.
      // `force: true` lets an admin override deliberately (they can see the
      // candidates and merge afterwards); a seller has no such escape hatch.
      if (!b.force) {
        const dup = await findCatalogDuplicate({
          categoryId: b.categoryId, brand: b.brand, manufacturer: b.manufacturer,
          name: b.name, modelNumber: b.modelNumber,
        });
        if (dup.duplicate) {
          return sendServerError(
            res,
            Object.assign(new Error('A matching product is already in the catalogue. Add a seller offer to it, or re-submit with force=true to create it anyway.'), { expose: true }),
            'Duplicate product',
            409,
          );
        }
      }

      const data = {
        sellerId: null, // admin-created products belong to no seller
        categoryId: b.categoryId,
        name: cleanStr(b.name),
        // Admin-authored entries are trusted; they do not queue for QC.
        status: 'APPROVED',
        normalizedKey: normalizeProductKey({
          categoryId: b.categoryId, brand: b.brand, manufacturer: b.manufacturer, name: b.name,
        }),
        price: Number(b.price),
        stock: b.stock !== undefined ? b.stock : 0,
        unit: b.unit ? cleanStr(b.unit) : 'kg',
        minOrderQty: b.minOrderQty !== undefined ? b.minOrderQty : 1,
        sellScope: b.sellScope ? cleanStr(b.sellScope) : 'district',
        images: cleanArr(b.images),
        tags: cleanArr(b.tags),
        highlights: cleanArr(b.highlights),
        isActive: b.isActive !== undefined ? b.isActive : true,
        isFeatured: b.isFeatured !== undefined ? b.isFeatured : false,
      };
      // Optional scalar fields — only set when provided (keep Prisma defaults/nulls otherwise).
      for (const k of ['nameHi', 'nameMr', 'description', 'brand', 'manufacturer', 'countryOfOrigin', 'subcategory', 'district', 'state', 'taluka', 'village']) {
        if (b[k] !== undefined && b[k] !== null && b[k] !== '') data[k] = cleanStr(b[k]);
      }
      if (b.mrp !== undefined && b.mrp !== null && b.mrp !== '') data.mrp = Number(b.mrp);

      const created = await prisma.$transaction(async (tx) => {
        const p = await tx.product.create({
          data,
          include: { category: { select: { id: true, name: true } }, seller: { select: { id: true, name: true } } },
        });
        // Every catalog row needs at least one sellable unit, or no seller can
        // ever attach an offer to it. Admin rows carry price/stock columns that
        // are meaningless (nobody sells them) — the variant is what makes the row
        // usable once a Kendra does.
        await tx.productVariant.create({
          data: {
            productId: p.id,
            unit: data.unit || 'kg',
            attributes: {},
            isDefault: true,
          },
        });
        return p;
      });
      await invalidateStorefront();
      await adminAudit(req, ADMIN_ACTIONS.PRODUCT_CREATE, 'Product', created.id, { after: { name: created.name, price: created.price, categoryId: created.categoryId } });
      return sendCreated(res, created);
    } catch (err) {
      if (err?.code === 'P2003') return sendServerError(res, Object.assign(new Error('Selected category does not exist'), { expose: true }), 'Invalid category', 400);
      return sendServerError(res, err, 'Failed to create product');
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
      await invalidateStorefront();
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
    // Removing a CATALOG row now takes every seller's offer on it offline too —
    // the row is shared, so the decision is about the product, not about one
    // Kendra. Offers are set INACTIVE (recoverable) rather than deleted.
    await prisma.$transaction([
      prisma.product.update({ where: { id: req.params.id }, data: { isActive: false, status: 'REJECTED' } }),
      prisma.sellerListing.updateMany({ where: { variant: { productId: req.params.id } }, data: { status: 'INACTIVE' } }),
      prisma.cartItem.deleteMany({ where: { listing: { variant: { productId: req.params.id } } } }),
    ]);
    await invalidateStorefront();
    await adminAudit(req, ADMIN_ACTIONS.PRODUCT_DELETE, 'Product', before.id, { before: { isActive: before.isActive }, after: { isActive: false, status: 'REJECTED' }, metadata: { reason: req.body.reason ?? null, mode: 'soft-deactivate' } });
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
