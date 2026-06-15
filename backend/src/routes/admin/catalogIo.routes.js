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

// Hard ceiling on a single export so a crafted filter can't stream the whole DB.
const EXPORT_ROW_CAP = 50_000;
// Bound the upload + the number of rows a single import may carry.
const IMPORT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB CSV
const IMPORT_MAX_ROWS = 10_000;

// CSV columns (work-item contract). The 9 multilingual name columns are emitted in
// full for a stable round-trip format, but only the names the Product model
// actually has (name / nameHi / nameMr) are populated on export and applied on
// import — the other 7 are format-only placeholders (see PRODUCT_LANG_COLS).
const EXPORT_COLUMNS = [
  'id', 'name',
  'nameHi', 'nameMr', 'nameTa', 'nameKn', 'nameMl', 'nameTe', 'nameBn', 'nameGu', 'namePa',
  'price', 'mrp', 'unit', 'stock', 'categoryId', 'isActive', 'isFeatured',
];
// Multilingual name columns the Product schema actually stores (additive-only: the
// model has nameHi/nameMr today). Import writes only these; export populates only these.
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
          price: true, mrp: true, unit: true, stock: true,
          categoryId: true, isActive: true, isFeatured: true,
        },
      });

      const lines = [toCsvRow(EXPORT_COLUMNS)];
      for (const p of products) {
        lines.push(toCsvRow(EXPORT_COLUMNS.map((col) => {
          switch (col) {
            case 'price': return p.price == null ? '' : Number(p.price);
            case 'mrp': return p.mrp == null ? '' : Number(p.mrp);
            // Language columns the schema doesn't store → blank placeholder.
            case 'nameTa': case 'nameKn': case 'nameMl':
            case 'nameTe': case 'nameBn': case 'nameGu': case 'namePa': return '';
            default: return p[col];
          }
        })));
      }
      const body = '﻿' + lines.join('\r\n') + '\r\n'; // BOM → Excel reads UTF-8

      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="products-${stamp}.csv"`);
      res.setHeader('X-Export-Count', String(products.length));
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
 * Validate + normalise one parsed CSV row into a Prisma product payload.
 * Returns { ok:true, mode:'create'|'update', id?, data } or { ok:false, errors:[…] }.
 * `categoriesById` / `categoriesByName` are lookup maps for category resolution.
 */
function normaliseRow(row, { categoriesById, categoriesByName }) {
  const errors = [];
  const data = {};

  const name = String(row.name ?? '').trim();
  const hasId = !blank(row.id);
  const mode = hasId ? 'update' : 'create';

  // name — required on create; optional on update (only updates if present).
  if (mode === 'create' && !name) errors.push('name is required');
  if (name) {
    if (name.length > 200) errors.push('name must be ≤ 200 chars');
    else data.name = name;
  }

  // multilingual names the schema stores (others ignored).
  for (const col of PRODUCT_LANG_COLS) {
    if (!blank(row[col])) {
      const v = String(row[col]).trim();
      if (v.length > 200) errors.push(`${col} must be ≤ 200 chars`);
      else data[col] = v;
    }
  }

  // price — required on create.
  if (!blank(row.price)) {
    const n = Number(row.price);
    if (!Number.isFinite(n) || n < 0) errors.push('price must be a number ≥ 0');
    else data.price = n;
  } else if (mode === 'create') {
    errors.push('price is required');
  }

  // mrp — optional.
  if (!blank(row.mrp)) {
    const n = Number(row.mrp);
    if (!Number.isFinite(n) || n < 0) errors.push('mrp must be a number ≥ 0');
    else data.mrp = n;
  }

  // unit — optional string.
  if (!blank(row.unit)) {
    const u = String(row.unit).trim();
    if (u.length > 20) errors.push('unit must be ≤ 20 chars');
    else data.unit = u;
  }

  // stock — optional non-negative int.
  if (!blank(row.stock)) {
    const n = Number(row.stock);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) errors.push('stock must be an integer 0–1,000,000');
    else data.stock = n;
  }

  // isActive / isFeatured — optional booleans.
  for (const col of ['isActive', 'isFeatured']) {
    if (!blank(row[col])) {
      const b = toBool(row[col]);
      if (b === null) errors.push(`${col} must be true/false`);
      else data[col] = b;
    }
  }

  // category — match by id (UUID) or by name. Required on create.
  let categoryId;
  if (!blank(row.categoryId)) {
    const cid = String(row.categoryId).trim();
    if (categoriesById.has(cid)) categoryId = cid;
    else if (categoriesByName.has(cid.toLowerCase())) categoryId = categoriesByName.get(cid.toLowerCase());
    else errors.push(`categoryId "${cid}" matches no category (by id or name)`);
  }
  if (categoryId) data.categoryId = categoryId;
  else if (mode === 'create') errors.push('categoryId (id or category name) is required');

  if (errors.length) return { ok: false, errors };
  return { ok: true, mode, id: hasId ? String(row.id).trim() : undefined, data };
}

export const productsImportRouter = Router();

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
      // Existing ids referenced by update rows — so an unknown id is reported, not thrown.
      const updateIds = [...new Set(rows.filter((r) => !blank(r.id)).map((r) => String(r.id).trim()))];
      const existing = updateIds.length
        ? await prisma.product.findMany({ where: { id: { in: updateIds } }, select: { id: true } })
        : [];
      const existingIds = new Set(existing.map((p) => p.id));

      const rowErrors = [];
      const ops = []; // { row, mode, id?, data }
      let created = 0;
      let updated = 0;

      for (const row of rows) {
        const norm = normaliseRow(row, { categoriesById, categoriesByName });
        if (!norm.ok) { rowErrors.push({ row: row._line, errors: norm.errors }); continue; }
        if (norm.mode === 'update' && !existingIds.has(norm.id)) {
          rowErrors.push({ row: row._line, errors: [`no product with id "${norm.id}"`] });
          continue;
        }
        ops.push(norm);
        if (norm.mode === 'create') created++; else updated++;
      }

      const summary = {
        commit,
        totalRows: rows.length,
        created,
        updated,
        errored: rowErrors.length,
        rowErrors,
      };

      // DRY-RUN: report what WOULD happen, write nothing.
      if (!commit) {
        return sendSuccess(res, { ...summary, applied: false });
      }

      // COMMIT: apply every valid op atomically (partial-success across rows is
      // bounded — either the whole valid set lands or none does).
      await prisma.$transaction(
        ops.map((op) =>
          op.mode === 'update'
            ? prisma.product.update({ where: { id: op.id }, data: op.data })
            : prisma.product.create({ data: op.data }),
        ),
      );

      // entityId is non-null in the AuditLog schema; a bulk import touches many
      // products, so use a stable synthetic id ('bulk') for the batch row.
      await adminAudit(req, ADMIN_ACTIONS.PRODUCT_IMPORT, 'Product', 'bulk', {
        after: { created, updated },
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
      const page = await keysetList(prisma.product, {
        where: { stock: { lte: effective }, isActive: true },
        cursor, limit,
        include: {
          category: { select: { id: true, name: true } },
          seller: { select: { id: true, name: true } },
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
