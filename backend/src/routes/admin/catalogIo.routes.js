/**
 * Admin Catalog bulk I/O + low-stock alerts (scope: CMS_EDITOR).
 *
 *   GET  /api/v1/admin/products/export   stream a CSV of the CURRENTLY-FILTERED
 *                                        products (same filters as GET /products).
 *                                        Bounded to EXPORT_ROW_CAP rows. No PII.
 *   POST /api/v1/admin/products/import   multipart CSV upload → parse → validate.
 *                                        DRY-RUN by default ({created,updated,
 *                                        errored,rowErrors}); ?commit=true applies
 *                                        in a transaction (upsert by id else create;
 *                                        category by id or name) + audits.
 *   GET  /api/v1/admin/inventory/alerts  products with stock ≤ threshold (default
 *                                        getSetting('catalog.lowStockThreshold')),
 *                                        keyset, with category + seller summary.
 *
 * Mounted behind requireScope(CMS_EDITOR) by the admin index; the ADMIN gate +
 * RBAC scope are enforced by the parent router. Mutations (a committed import) are
 * audited via adminAudit + ADMIN_ACTIONS.PRODUCT_IMPORT.
 */
import { Router } from 'express';
import multer from 'multer';
import { query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { adminAudit, listParams } from './_helpers.js';
import { ADMIN_ACTIONS } from '../../services/audit.service.js';
import { getSetting } from '../../services/settings.service.js';
import { productFilterValidators, buildProductWhere } from './catalog.routes.js';
import { normalizeProductKey, normalizeProductName } from '../../services/catalogMatch.service.js';
import { bumpListingVersion } from '../../utils/listingCache.js';
import { invalidateBuyBox } from '../../services/buyBox.service.js';
import { requireScope, ADMIN_SCOPES } from '../../middleware/admin.js';

// Hard ceiling on a single export so a crafted filter can't stream the whole DB.
const EXPORT_ROW_CAP = 50_000;
// Bound the upload + the number of rows a single import may carry.
const IMPORT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB CSV
const IMPORT_MAX_ROWS = 10_000;

// ── CSV shape after the CATALOG SPLIT ────────────────────────────────────────
// The old format was ONE FLAT ROW PER PRODUCT carrying price / mrp / unit / stock.
// That shape cannot represent the data any more: one catalog entry now has many
// pack sizes, and each pack size has many sellers' offers at different prices.
// Exporting it flat would silently pick one seller's numbers and present them as
// the product's.
//
// New shape: ONE ROW PER OFFER, with the catalog and variant columns repeated.
// A product with no offers yet still exports one row (offer columns blank), so a
// round-trip never loses a catalog entry. Three id columns make the levels
// explicit, and each level has a NATURAL KEY fallback for hand-authored files.
const CATALOG_COLS = ['productId', 'name', 'nameHi', 'nameMr', 'brand', 'manufacturer', 'modelNumber', 'categoryId', 'subcategory', 'productStatus'];
const VARIANT_COLS = ['variantId', 'unit', 'packSize', 'gtin', 'sku'];
const OFFER_COLS   = ['listingId', 'sellerId', 'sellingPrice', 'mrp', 'stockQty', 'dispatchSlaDays', 'minOrderQty', 'sellScope', 'district', 'state', 'listingStatus'];
const EXPORT_COLUMNS = [...CATALOG_COLS, ...VARIANT_COLS, ...OFFER_COLS];

// Multilingual name columns the Product schema actually stores.
const PRODUCT_LANG_COLS = ['nameHi', 'nameMr'];

// ── tiny RFC-4180-ish CSV helpers (no new dependency) ────────────────────────────
function escapeCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvRow(cells) {
  return cells.map(escapeCell).join(',');
}

/**
 * Parse CSV text into an array of objects keyed by the header row. Handles quoted
 * fields, escaped quotes ("") and embedded commas/newlines. Returns { headers, rows }
 * where each row also carries `_line` (1-based data-row number) for error reporting.
 */
function parseCsv(text) {
  // Strip a UTF-8 BOM if present (Excel adds one) and normalise newlines.
  const src = text.replace(/^﻿/, '');
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let sawAny = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; sawAny = true; continue; }
    if (ch === ',') { record.push(field); field = ''; sawAny = true; continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') { record.push(field); records.push(record); record = []; field = ''; sawAny = false; continue; }
    field += ch; sawAny = true;
  }
  // Flush a trailing field/record with no final newline.
  if (sawAny || field !== '' || record.length) { record.push(field); records.push(record); }

  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const cols = records[r];
    // Skip fully-blank trailing lines.
    if (cols.length === 1 && cols[0].trim() === '') continue;
    const obj = { _line: r };
    headers.forEach((h, idx) => { obj[h] = cols[idx] ?? ''; });
    rows.push(obj);
  }
  return { headers, rows };
}

// ── number/bool coercion for parsed cells ────────────────────────────────────────
const blank = (v) => v == null || String(v).trim() === '';
function toBool(v) {
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return null; // unknown → caller treats as invalid
}

// ── Export ───────────────────────────────────────────────────────────────────────
export const productsCsvRouter = Router();

// CMS_EDITOR gate applied here, not on the shared `/products` mount — see the note
// in catalog.routes.js productsRouter. It must be PATH-SCOPED: this router is
// mounted at /products, so an unscoped .use() would still fire for /products/qc/*
// and re-create the cross-blocking bug one level down.
productsCsvRouter.use('/export', requireScope(ADMIN_SCOPES.CMS_EDITOR));

productsCsvRouter.get(
  '/export',
  [...productFilterValidators],
  validate,
  async (req, res) => {
    try {
      const where = buildProductWhere(req.query);
      const products = await prisma.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: EXPORT_ROW_CAP,
        select: {
          id: true, name: true, nameHi: true, nameMr: true,
          brand: true, manufacturer: true, modelNumber: true,
          categoryId: true, subcategory: true, status: true,
          variants: {
            select: {
              id: true, unit: true, attributes: true, gtin: true, sku: true,
              listings: {
                select: {
                  id: true, sellerId: true, sellingPrice: true, mrp: true, stockQty: true,
                  dispatchSlaDays: true, minOrderQty: true, sellScope: true,
                  district: true, state: true, status: true,
                },
                orderBy: { sellingPrice: 'asc' },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      const catalogCells = (p) => [
        p.id, p.name, p.nameHi ?? '', p.nameMr ?? '', p.brand ?? '', p.manufacturer ?? '',
        p.modelNumber ?? '', p.categoryId, p.subcategory ?? '', p.status,
      ];
      const variantCells = (v) => (v
        ? [v.id, v.unit, v.attributes?.packSize ?? '', v.gtin ?? '', v.sku ?? '']
        : ['', '', '', '', '']);
      const offerCells = (l) => (l
        ? [l.id, l.sellerId, Number(l.sellingPrice), l.mrp == null ? '' : Number(l.mrp),
           l.stockQty, l.dispatchSlaDays, l.minOrderQty, l.sellScope,
           l.district ?? '', l.state ?? '', l.status]
        : ['', '', '', '', '', '', '', '', '', '', '']);

      const lines = [toCsvRow(EXPORT_COLUMNS)];
      let rowCount = 0;
      for (const p of products) {
        if (!p.variants.length) {
          lines.push(toCsvRow([...catalogCells(p), ...variantCells(null), ...offerCells(null)]));
          rowCount++;
          continue;
        }
        for (const v of p.variants) {
          if (!v.listings.length) {
            lines.push(toCsvRow([...catalogCells(p), ...variantCells(v), ...offerCells(null)]));
            rowCount++;
            continue;
          }
          for (const l of v.listings) {
            lines.push(toCsvRow([...catalogCells(p), ...variantCells(v), ...offerCells(l)]));
            rowCount++;
          }
        }
      }
      const body = '﻿' + lines.join('\r\n') + '\r\n'; // BOM → Excel reads UTF-8

      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="products-${stamp}.csv"`);
      res.setHeader('X-Export-Count', String(rowCount));
      res.setHeader('X-Export-Products', String(products.length));
      res.setHeader('X-Export-Capped', products.length >= EXPORT_ROW_CAP ? 'true' : 'false');
      return res.status(200).send(body);
    } catch (err) {
      return sendServerError(res, err, 'Failed to export products');
    }
  },
);

// ── Import (dry-run by default; ?commit=true applies) ────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'].includes(file.mimetype)
      || /\.csv$/i.test(file.originalname || '');
    cb(null, ok);
  },
}).single('file');

// Wrap multer so its errors (oversize / wrong field) are JSON, not a 500 stack.
function uploadCsv(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'CSV exceeds the 5 MB limit' : (err.message || 'Upload failed');
    return sendServerError(res, Object.assign(new Error(msg), { expose: true, statusCode: 400 }), msg, 400);
  });
}

/**
 * Validate + normalise one parsed CSV row into the three levels it now describes.
 *
 * Returns { ok:true, product, variant, offer } or { ok:false, errors:[…] }.
 * `variant` and `offer` are null when the row does not carry those columns, so a
 * catalog-only file still imports.
 */
function normaliseRow(row, { categoriesById, categoriesByName }) {
  const errors = [];
  const str = (v, max, label) => {
    const s = String(v ?? '').trim();
    if (s.length > max) { errors.push(`${label} must be ≤ ${max} chars`); return null; }
    return s || null;
  };

  // ── catalog level ───────────────────────────────────────────────────────────
  const productId = blank(row.productId) ? null : String(row.productId).trim();
  const name = str(row.name, 200, 'name');
  if (!productId && !name) errors.push('name is required when productId is blank');

  let categoryId = null;
  if (!blank(row.categoryId)) {
    const cid = String(row.categoryId).trim();
    if (categoriesById.has(cid)) categoryId = cid;
    else if (categoriesByName.has(cid.toLowerCase())) categoryId = categoriesByName.get(cid.toLowerCase());
    else errors.push(`categoryId "${cid}" matches no category (by id or name)`);
  }
  if (!productId && !categoryId) errors.push('categoryId (id or category name) is required for a new product');

  const product = {
    id: productId,
    name,
    brand: str(row.brand, 120, 'brand'),
    manufacturer: str(row.manufacturer, 200, 'manufacturer'),
    modelNumber: str(row.modelNumber, 80, 'modelNumber'),
    subcategory: str(row.subcategory, 120, 'subcategory'),
    categoryId,
    status: blank(row.productStatus) ? null : String(row.productStatus).trim().toUpperCase(),
  };
  for (const col of PRODUCT_LANG_COLS) product[col] = str(row[col], 200, col);
  if (product.status && !['PENDING_QC', 'APPROVED', 'REJECTED'].includes(product.status)) {
    errors.push('productStatus must be PENDING_QC, APPROVED or REJECTED (MERGED is set by the merge tool, never by import)');
  }

  // ── variant level ───────────────────────────────────────────────────────────
  const hasVariant = !blank(row.variantId) || !blank(row.unit) || !blank(row.gtin) || !blank(row.packSize) || !blank(row.sku);
  const variant = hasVariant ? {
    id: blank(row.variantId) ? null : String(row.variantId).trim(),
    unit: str(row.unit, 20, 'unit') || 'kg',
    packSize: str(row.packSize, 40, 'packSize'),
    gtin: str(row.gtin, 20, 'gtin'),
    sku: str(row.sku, 80, 'sku'),
  } : null;

  // ── offer level ─────────────────────────────────────────────────────────────
  const hasOffer = !blank(row.listingId) || !blank(row.sellerId) || !blank(row.sellingPrice);
  let offer = null;
  if (hasOffer) {
    const num = (v, label, { int = false, min = 0 } = {}) => {
      if (blank(v)) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || (int && !Number.isInteger(n))) {
        errors.push(`${label} must be ${int ? 'an integer' : 'a number'} ≥ ${min}`);
        return null;
      }
      return n;
    };
    offer = {
      id: blank(row.listingId) ? null : String(row.listingId).trim(),
      sellerId: blank(row.sellerId) ? null : String(row.sellerId).trim(),
      sellingPrice: num(row.sellingPrice, 'sellingPrice', { min: 0.01 }),
      mrp: num(row.mrp, 'mrp'),
      stockQty: num(row.stockQty, 'stockQty', { int: true }),
      dispatchSlaDays: num(row.dispatchSlaDays, 'dispatchSlaDays', { int: true }),
      minOrderQty: num(row.minOrderQty, 'minOrderQty', { int: true, min: 1 }),
      sellScope: str(row.sellScope, 32, 'sellScope'),
      district: str(row.district, 120, 'district'),
      state: str(row.state, 120, 'state'),
      status: blank(row.listingStatus) ? null : String(row.listingStatus).trim().toUpperCase(),
    };
    if (!offer.sellerId) errors.push('sellerId is required on an offer row');
    if (!offer.id && offer.sellingPrice == null) errors.push('sellingPrice is required on a new offer row');
    if (offer.status && !['ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'BLOCKED'].includes(offer.status)) {
      errors.push('listingStatus must be ACTIVE, INACTIVE, OUT_OF_STOCK or BLOCKED');
    }
    if (!variant) errors.push('an offer row must also identify its variant (variantId, or unit/packSize)');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, product, variant, offer };
}

export const productsImportRouter = Router();

// CMS_EDITOR gate, path-scoped for the same reason as productsCsvRouter above.
productsImportRouter.use('/import', requireScope(ADMIN_SCOPES.CMS_EDITOR));

productsImportRouter.post(
  '/import',
  uploadCsv,
  [query('commit').optional().isBoolean()],
  validate,
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return sendServerError(res, Object.assign(new Error('No CSV file uploaded (field "file")'), { expose: true, statusCode: 400 }), 'No file', 400);
      }
      const commit = String(req.query.commit) === 'true';
      const { headers, rows } = parseCsv(req.file.buffer.toString('utf8'));

      if (!headers.length) {
        return sendServerError(res, Object.assign(new Error('CSV is empty or has no header row'), { expose: true, statusCode: 400 }), 'Empty CSV', 400);
      }
      if (rows.length > IMPORT_MAX_ROWS) {
        return sendServerError(res, Object.assign(new Error(`CSV has too many rows (max ${IMPORT_MAX_ROWS})`), { expose: true, statusCode: 400 }), 'Too many rows', 400);
      }

      // Category lookup maps (id + lower-cased name → id) for resolution.
      const categories = await prisma.category.findMany({ select: { id: true, name: true } });
      const categoriesById = new Map(categories.map((c) => [c.id, c.id]));
      const categoriesByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

      const rowErrors = [];
      const ops = [];
      for (const row of rows) {
        const norm = normaliseRow(row, { categoriesById, categoriesByName });
        if (!norm.ok) rowErrors.push({ row: row._line, errors: norm.errors });
        else ops.push({ line: row._line, ...norm });
      }

      // ── Resolution, dry-run and commit share ONE code path ─────────────────
      // Re-importing an export used to create duplicates: rows were matched ONLY
      // by an explicit UUID, so any hand-edited or id-less row created a fresh
      // product every time. Each level now falls back to a NATURAL KEY:
      //   product → normalizedKey (category|brand|manufacturer|name)
      //   variant → gtin, else (productId, unit + packSize)
      //   offer   → (sellerId, variantId), the table's own unique
      // so the same file imported twice is idempotent.
      const stats = { productsCreated: 0, productsUpdated: 0, variantsCreated: 0, variantsUpdated: 0, offersCreated: 0, offersUpdated: 0 };
      const plan = [];

      const productKeyOf = (p, fallbackCategoryId) => normalizeProductKey({
        categoryId: p.categoryId || fallbackCategoryId,
        brand: p.brand, manufacturer: p.manufacturer, name: p.name,
      });

      for (const op of ops) {
        try {
          // 1. product
          let existingProduct = null;
          if (op.product.id) {
            existingProduct = await prisma.product.findUnique({ where: { id: op.product.id }, select: { id: true, categoryId: true } });
            if (!existingProduct) { rowErrors.push({ row: op.line, errors: [`no product with id "${op.product.id}"`] }); continue; }
          } else {
            existingProduct = await prisma.product.findFirst({
              where: { normalizedKey: productKeyOf(op.product, null), status: { not: 'MERGED' } },
              select: { id: true, categoryId: true },
              orderBy: { createdAt: 'asc' },
            });
          }
          const resolvedCategoryId = op.product.categoryId || existingProduct?.categoryId;

          // 2. variant
          let existingVariant = null;
          if (op.variant) {
            if (op.variant.id) {
              existingVariant = await prisma.productVariant.findUnique({ where: { id: op.variant.id }, select: { id: true, productId: true } });
              if (!existingVariant) { rowErrors.push({ row: op.line, errors: [`no variant with id "${op.variant.id}"`] }); continue; }
            } else if (op.variant.gtin) {
              existingVariant = await prisma.productVariant.findUnique({ where: { gtin: op.variant.gtin }, select: { id: true, productId: true } });
            }
            if (!existingVariant && existingProduct) {
              const siblings = await prisma.productVariant.findMany({
                where: { productId: existingProduct.id },
                select: { id: true, productId: true, unit: true, attributes: true },
              });
              existingVariant = siblings.find((v) =>
                normalizeProductName(v.unit) === normalizeProductName(op.variant.unit) &&
                normalizeProductName(v.attributes?.packSize ?? '') === normalizeProductName(op.variant.packSize ?? ''),
              ) || null;
            }
          }

          // 3. offer
          let existingOffer = null;
          if (op.offer) {
            if (op.offer.id) {
              existingOffer = await prisma.sellerListing.findUnique({ where: { id: op.offer.id }, select: { id: true } });
              if (!existingOffer) { rowErrors.push({ row: op.line, errors: [`no listing with id "${op.offer.id}"`] }); continue; }
            } else if (existingVariant) {
              existingOffer = await prisma.sellerListing.findUnique({
                where: { sellerId_variantId: { sellerId: op.offer.sellerId, variantId: existingVariant.id } },
                select: { id: true },
              });
            }
          }

          if (existingProduct) stats.productsUpdated++; else stats.productsCreated++;
          if (op.variant) { if (existingVariant) stats.variantsUpdated++; else stats.variantsCreated++; }
          if (op.offer)   { if (existingOffer)   stats.offersUpdated++;   else stats.offersCreated++; }

          plan.push({ ...op, existingProduct, existingVariant, existingOffer, resolvedCategoryId });
        } catch (err) {
          rowErrors.push({ row: op.line, errors: [err.message] });
        }
      }

      const summary = {
        commit,
        totalRows: rows.length,
        ...stats,
        // Kept for older admin UI builds that read created/updated.
        created: stats.productsCreated,
        updated: stats.productsUpdated,
        errored: rowErrors.length,
        rowErrors,
      };

      // DRY-RUN: report what WOULD happen, write nothing.
      if (!commit) return sendSuccess(res, { ...summary, applied: false });

      // COMMIT: one transaction. Rows are applied in order because a later row may
      // depend on a product a previous row created (an export puts every offer for
      // one product on consecutive lines), so this is a sequential loop rather
      // than the array form of $transaction.
      await prisma.$transaction(async (tx) => {
        const productIdByKey = new Map();

        for (const p of plan) {
          // product
          let productId = p.existingProduct?.id;
          const key = productKeyOf(p.product, p.resolvedCategoryId);
          if (!productId && productIdByKey.has(key)) productId = productIdByKey.get(key);

          const productData = {};
          for (const f of ['name', 'brand', 'manufacturer', 'modelNumber', 'subcategory', ...PRODUCT_LANG_COLS]) {
            if (p.product[f] !== null && p.product[f] !== undefined) productData[f] = p.product[f];
          }
          if (p.product.categoryId) productData.categoryId = p.product.categoryId;
          if (p.product.status) productData.status = p.product.status;

          if (productId) {
            if (Object.keys(productData).length) {
              productData.normalizedKey = key;
              await tx.product.update({ where: { id: productId }, data: productData });
            }
          } else {
            const createdP = await tx.product.create({
              data: {
                ...productData,
                categoryId: p.resolvedCategoryId,
                name: p.product.name,
                normalizedKey: key,
                status: p.product.status || 'APPROVED',
                images: [], tags: [], highlights: [],
              },
              select: { id: true },
            });
            productId = createdP.id;
          }
          productIdByKey.set(key, productId);

          // variant
          let variantId = p.existingVariant?.id;
          if (p.variant) {
            const attributes = p.variant.packSize ? { packSize: p.variant.packSize } : {};
            if (variantId) {
              await tx.productVariant.update({
                where: { id: variantId },
                data: {
                  unit: p.variant.unit,
                  ...(p.variant.packSize ? { attributes } : {}),
                  ...(p.variant.gtin ? { gtin: p.variant.gtin } : {}),
                  ...(p.variant.sku ? { sku: p.variant.sku } : {}),
                },
              });
            } else {
              const createdV = await tx.productVariant.create({
                data: {
                  productId, unit: p.variant.unit, attributes,
                  gtin: p.variant.gtin, sku: p.variant.sku,
                },
                select: { id: true },
              });
              variantId = createdV.id;
            }
          }

          // offer
          if (p.offer && variantId) {
            const offerData = {};
            if (p.offer.sellingPrice    != null) offerData.sellingPrice    = p.offer.sellingPrice;
            if (p.offer.mrp             != null) offerData.mrp             = p.offer.mrp;
            if (p.offer.stockQty        != null) offerData.stockQty        = p.offer.stockQty;
            if (p.offer.dispatchSlaDays != null) offerData.dispatchSlaDays = p.offer.dispatchSlaDays;
            if (p.offer.minOrderQty     != null) offerData.minOrderQty     = p.offer.minOrderQty;
            if (p.offer.sellScope)               offerData.sellScope       = p.offer.sellScope;
            if (p.offer.district !== null)       offerData.district        = p.offer.district;
            if (p.offer.state    !== null)       offerData.state           = p.offer.state;
            if (p.offer.status)                  offerData.status          = p.offer.status;

            if (p.existingOffer) {
              await tx.sellerListing.update({ where: { id: p.existingOffer.id }, data: offerData });
            } else {
              await tx.sellerListing.create({
                data: {
                  ...offerData,
                  sellerId: p.offer.sellerId,
                  variantId,
                  sellingPrice: p.offer.sellingPrice,
                  stockQty: p.offer.stockQty ?? 0,
                },
              });
            }
          }
        }
      }, { timeout: 120_000 });

      await Promise.all([bumpListingVersion('agristore:products'), invalidateBuyBox()]);

      // entityId is non-null in the AuditLog schema; a bulk import touches many
      // products, so use a stable synthetic id ('bulk') for the batch row.
      await adminAudit(req, ADMIN_ACTIONS.PRODUCT_IMPORT, 'Product', 'bulk', {
        after: stats,
        metadata: { totalRows: rows.length, errored: rowErrors.length, filename: req.file.originalname ?? null },
      });

      return sendSuccess(res, { ...summary, applied: true });
    } catch (err) {
      return sendServerError(res, err, 'Failed to import products');
    }
  },
);

// ── Low-stock inventory alerts ───────────────────────────────────────────────────
export const inventoryRouter = Router();

inventoryRouter.get(
  '/alerts',
  [query('threshold').optional().isInt({ min: 0, max: 1_000_000 }), query('limit').optional().isInt({ min: 1, max: 100 })],
  validate,
  async (req, res) => {
    try {
      const threshold = req.query.threshold !== undefined
        ? parseInt(req.query.threshold, 10)
        : Number(await getSetting('catalog.lowStockThreshold'));
      const effective = Number.isFinite(threshold) ? threshold : 10;

      const { cursor, limit } = listParams(req);
      // Stock is a property of an OFFER now, not of the catalog row — "this
      // product is low on stock" is not a statement anyone can make when three
      // Kendras stock it independently. The alert is per seller listing.
      const page = await keysetList(prisma.sellerListing, {
        where: { stockQty: { lte: effective }, status: { in: ['ACTIVE', 'OUT_OF_STOCK'] } },
        cursor, limit,
        include: {
          seller: { select: { id: true, name: true, phone: true } },
          variant: {
            select: {
              id: true, unit: true, attributes: true,
              product: {
                select: {
                  id: true, name: true, brand: true,
                  category: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      });
      return sendSuccess(res, { items: page.items, threshold: effective }, 200, {
        hasMore: page.hasMore, nextCursor: page.nextCursor, count: page.items.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load low-stock alerts');
    }
  },
);
