/**
 * Admin Catalog QC + duplicate merge (CATALOG-SPLIT §7).
 *
 *   GET  /api/v1/admin/products/qc/queue        products awaiting review
 *   POST /api/v1/admin/products/qc/:id/approve  → APPROVED, seller's draft offers go live
 *   POST /api/v1/admin/products/qc/:id/reject   → REJECTED
 *   GET  /api/v1/admin/products/duplicates      near-miss report + live trigram scan
 *   POST /api/v1/admin/products/merge           fold one catalog row into another
 *
 * ── SCOPE: CONTENT_MODERATOR, not CMS_EDITOR ────────────────────────────────
 * Admin scope assignment for the catalogue is inconsistent today: products are
 * CMS_EDITOR while reviews, flags, disputes and every other moderation surface
 * are CONTENT_MODERATOR. QC is mounted under CONTENT_MODERATOR because it is a
 * MODERATION decision about seller-submitted content — the same judgement call as
 * the review queue and the ContentFlag fraud queue — not editorial authoring.
 * CMS_EDITOR keeps create / edit / CSV, which is authoring. The split is by what
 * the decision IS, so one operator's scope grant means one coherent thing.
 *
 * ── WHY A `status` ENUM AND NOT ANOTHER BOOLEAN ─────────────────────────────
 * `isActive` already meant three different things — seller pause, seller
 * soft-delete, admin toggle — and PENDING_QC would have been a fourth meaning on
 * the same flag, with no way to tell them apart. It is also NOT ModerationStatus
 * (shared with ContentFlag's queue; adding PENDING_QC would change that queue's
 * vocabulary) and NOT ContentFlag's shape: a flag is a REACTIVE SIDECAR that
 * exists only when a heuristic scores above a threshold, whereas QC is a state
 * every new product has. And resolveFlag() only ever updates the flag — it never
 * touches the Product — so there was no existing hook that turned a moderation
 * decision into a catalog state change. This is that hook.
 */
import { Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound, paginationMeta } from '../../utils/response.js';
import { stripHtml } from '../../utils/encrypt.js';
import { adminAudit } from './_helpers.js';
import { ADMIN_ACTIONS, AUDIT_ACTIONS } from '../../services/audit.service.js';
import { bumpListingVersion } from '../../utils/listingCache.js';
import { invalidateBuyBox } from '../../services/buyBox.service.js';
import { normalizeProductName } from '../../services/catalogMatch.service.js';
import logger from '../../utils/logger.js';
import { requireScope, ADMIN_SCOPES } from '../../middleware/admin.js';

export const productsQcRouter = Router();

// CONTENT_MODERATOR gate applied here rather than on the shared `/products` mount —
// see the note in catalog.routes.js productsRouter for why the mount-level gate
// cross-blocked this router. Scoped to this router's three path prefixes: an
// unscoped .use() would fire for every /products/* URL (this router is mounted at
// /products) and 403 the CMS_EDITOR-owned list/create/edit routes all over again.
// Keep this list in sync when adding a QC path.
productsQcRouter.use('/qc', requireScope(ADMIN_SCOPES.CONTENT_MODERATOR));
productsQcRouter.use('/duplicates', requireScope(ADMIN_SCOPES.CONTENT_MODERATOR));
productsQcRouter.use('/merge', requireScope(ADMIN_SCOPES.CONTENT_MODERATOR));

const NS_PRODUCTS = 'agristore:products';

/**
 * Admin product mutations never invalidated the storefront cache —
 * bumpListingVersion(NS_PRODUCTS) was only ever called from agristore.routes.js.
 * A QC approval that skipped it would leave the newly-approved product invisible
 * for up to the 60 s TTL, which reads to the seller as "approval did nothing".
 */
async function invalidateStorefront() {
  await Promise.all([bumpListingVersion(NS_PRODUCTS), invalidateBuyBox()]);
}

// ── QC queue ──────────────────────────────────────────────────────────────────
productsQcRouter.get(
  '/qc/queue',
  [
    query('status').optional().isIn(['PENDING_QC', 'APPROVED', 'REJECTED', 'MERGED']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const page  = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit || '25', 10) || 25, 100);
      const where = { status: req.query.status || 'PENDING_QC' };

      const [items, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            category: { select: { id: true, name: true } },
            variants: {
              select: {
                id: true, unit: true, attributes: true, gtin: true, sku: true,
                _count: { select: { listings: true } },
              },
            },
          },
          // Oldest first — a QC queue is a queue.
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.product.count({ where }),
      ]);

      // Who proposed it, and what near-duplicates the gate let through.
      const sellerIds = [...new Set(items.map((p) => p.createdBySellerId).filter(Boolean))];
      const sellers = sellerIds.length
        ? await prisma.user.findMany({
            where: { id: { in: sellerIds } },
            select: { id: true, name: true, phone: true, kycStatus: true, district: true },
          })
        : [];
      const sellerById = new Map(sellers.map((s) => [s.id, s]));
      for (const p of items) p.proposedBy = sellerById.get(p.createdBySellerId) || null;

      return sendSuccess(res, { items }, 200, paginationMeta(total, page, limit));
    } catch (err) {
      return sendServerError(res, err, 'Failed to load the QC queue');
    }
  },
);

productsQcRouter.post(
  '/qc/:id/approve',
  [param('id').isUUID(), body('reason').optional().isString().trim().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.product.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true, status: true, createdBySellerId: true },
      });
      if (!before) return sendNotFound(res, 'Product');
      if (before.status === 'MERGED') {
        return sendServerError(res, Object.assign(new Error('This product was merged into another and cannot be approved'), { expose: true }), 'Already merged', 409);
      }

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.product.update({
          where: { id: before.id },
          data: {
            status: 'APPROVED',
            qcReviewedBy: req.user.id,
            qcReviewedAt: new Date(),
            qcRejectionReason: null,
            isActive: true, // DUAL-READ: pre-split reads still consult this flag
          },
          select: { id: true, name: true, status: true },
        });

        // The seller's draft offers were held INACTIVE while the catalog entry was
        // in QC. Approval is what releases them — offers with stock go ACTIVE,
        // offers without go OUT_OF_STOCK so the seller sees why they are not live.
        const drafts = await tx.sellerListing.findMany({
          where: { variant: { productId: before.id }, status: 'INACTIVE' },
          select: { id: true, stockQty: true },
        });
        const live = drafts.filter((l) => l.stockQty > 0).map((l) => l.id);
        const empty = drafts.filter((l) => l.stockQty <= 0).map((l) => l.id);
        if (live.length)  await tx.sellerListing.updateMany({ where: { id: { in: live } },  data: { status: 'ACTIVE' } });
        if (empty.length) await tx.sellerListing.updateMany({ where: { id: { in: empty } }, data: { status: 'OUT_OF_STOCK' } });

        return { updated, activated: live.length };
      });

      await invalidateStorefront();
      await adminAudit(req, AUDIT_ACTIONS.PRODUCT_QC_APPROVE, 'Product', before.id, {
        before: { status: before.status },
        after: { status: 'APPROVED' },
        metadata: { reason: req.body.reason ?? null, proposedBy: before.createdBySellerId, offersActivated: result.activated },
      });

      return sendSuccess(res, { ...result.updated, offersActivated: result.activated });
    } catch (err) {
      return sendServerError(res, err, 'Failed to approve the product');
    }
  },
);

productsQcRouter.post(
  '/qc/:id/reject',
  [param('id').isUUID(), body('reason').isString().trim().isLength({ min: 3, max: 500 })],
  validate,
  async (req, res) => {
    try {
      const before = await prisma.product.findUnique({
        where: { id: req.params.id },
        select: { id: true, name: true, status: true, createdBySellerId: true },
      });
      if (!before) return sendNotFound(res, 'Product');

      const reason = stripHtml(req.body.reason);

      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: before.id },
          data: {
            status: 'REJECTED',
            qcReviewedBy: req.user.id,
            qcReviewedAt: new Date(),
            qcRejectionReason: reason,
            isActive: false, // DUAL-READ
          },
        });
        // Nothing may be sold against a rejected catalog entry.
        await tx.sellerListing.updateMany({
          where: { variant: { productId: before.id } },
          data: { status: 'INACTIVE' },
        });
        await tx.cartItem.deleteMany({ where: { listing: { variant: { productId: before.id } } } });
      });

      await invalidateStorefront();
      await adminAudit(req, AUDIT_ACTIONS.PRODUCT_QC_REJECT, 'Product', before.id, {
        before: { status: before.status },
        after: { status: 'REJECTED' },
        metadata: { reason, proposedBy: before.createdBySellerId },
      });

      return sendSuccess(res, { id: before.id, status: 'REJECTED', reason });
    } catch (err) {
      return sendServerError(res, err, 'Failed to reject the product');
    }
  },
);

// ── Duplicate review ──────────────────────────────────────────────────────────
/**
 * Two sources, deliberately combined:
 *   • catalog_split_near_miss — everything the BACKFILL refused to merge. This is
 *     the migration's manual-review deliverable.
 *   • a live trigram scan — duplicates created since, by sellers whose submission
 *     scored between the suggest and block thresholds.
 */
productsQcRouter.get(
  '/duplicates',
  [query('minSimilarity').optional().isFloat({ min: 0.3, max: 1 }), query('limit').optional().isInt({ min: 1, max: 200 })],
  validate,
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
      const minSim = Math.max(Number(req.query.minSimilarity) || 0.6, 0.3);

      let backfillReport = [];
      try {
        backfillReport = await prisma.$queryRaw`
          SELECT "id", "kind", "leftId", "rightId", "similarity", "leftLabel", "rightLabel", "note"
          FROM "catalog_split_near_miss"
          WHERE "resolvedAt" IS NULL
          ORDER BY "similarity" DESC NULLS LAST
          LIMIT ${limit}
        `;
      } catch {
        // The table only exists once the expand script has been applied. A fresh
        // dev DB has no migration history — an empty report is the right answer,
        // not a 500.
        backfillReport = [];
      }

      // `%` is the indexed prefilter (gin_trgm_ops has no <-> operator, so KNN
      // ordering is impossible here); similarity() orders the candidates after.
      const liveScan = await prisma.$queryRaw`
        SELECT DISTINCT ON (least(a."id", b."id"), greatest(a."id", b."id"))
          least(a."id", b."id")    AS "leftId",
          greatest(a."id", b."id") AS "rightId",
          similarity(a."name", b."name") AS "similarity",
          a."name" AS "leftLabel", a."brand" AS "leftBrand",
          b."name" AS "rightLabel", b."brand" AS "rightBrand",
          a."categoryId"
        FROM "products" a
        JOIN "products" b
          ON b."categoryId" = a."categoryId"
         AND b."id" <> a."id"
         AND b."name" % a."name"
         AND b."normalizedKey" <> a."normalizedKey"
        WHERE a."status" IN ('APPROVED', 'PENDING_QC')
          AND b."status" IN ('APPROVED', 'PENDING_QC')
          AND similarity(a."name", b."name") >= ${minSim}
        ORDER BY least(a."id", b."id"), greatest(a."id", b."id"), similarity(a."name", b."name") DESC
        LIMIT ${limit}
      `;

      return sendSuccess(res, {
        backfillReport,
        liveScan: liveScan.map((r) => ({ ...r, similarity: Number(r.similarity) })),
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load duplicate candidates');
    }
  },
);

/**
 * Fold `fromId` into `intoId`.
 *
 * LOSSLESS BY DESIGN. Nothing is deleted:
 *   • variants of `from` are matched to variants of `into` by normalised unit;
 *   • listings move to the matching variant when that seller has no offer there;
 *   • a seller who ALREADY has an offer on both would violate
 *     @@unique([sellerId, variantId]), so their `from` listing is set INACTIVE and
 *     left in place, its variant is re-parented onto `into`, and the conflict is
 *     written to catalog_split_near_miss for follow-up. Deleting one of a seller's
 *     two offers to make the merge tidy would destroy their price and stock;
 *   • reviews are repointed so ratings consolidate;
 *   • `from` becomes status MERGED with mergedIntoId set, so its id keeps
 *     resolving — cart_items, order_items, CropReportShare.recommendedProductIds,
 *     ContentFlag(entityType='Product') and AuditLog rows all reference it with
 *     NO foreign key, so deleting it would break them silently.
 */
productsQcRouter.post(
  '/merge',
  [
    body('fromId').isUUID(),
    body('intoId').isUUID(),
    body('reason').optional().isString().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    const { fromId, intoId } = req.body;
    if (fromId === intoId) {
      return sendServerError(res, Object.assign(new Error('A product cannot be merged into itself'), { expose: true }), 'Invalid merge', 400);
    }

    try {
      const [from, into] = await Promise.all([
        prisma.product.findUnique({ where: { id: fromId }, include: { variants: true } }),
        prisma.product.findUnique({ where: { id: intoId }, include: { variants: true } }),
      ]);
      if (!from) return sendNotFound(res, 'Source product');
      if (!into) return sendNotFound(res, 'Target product');
      if (into.status === 'MERGED') {
        return sendServerError(res, Object.assign(new Error('The target product has itself been merged into another. Merge into the surviving product instead.'), { expose: true }), 'Invalid merge target', 409);
      }

      const unitKey = (v) => normalizeProductName(v.unit) || 'unit';
      const targetByUnit = new Map(into.variants.map((v) => [unitKey(v), v]));

      const summary = await prisma.$transaction(async (tx) => {
        const moved = [];
        const conflicts = [];

        for (const vFrom of from.variants) {
          const vInto = targetByUnit.get(unitKey(vFrom));

          if (!vInto) {
            // No equivalent pack on the target — re-parent the whole variant.
            // Listing ids do not change, so carts and order history stay valid.
            await tx.productVariant.update({
              where: { id: vFrom.id },
              data: { productId: into.id, isDefault: false },
            });
            moved.push({ variantId: vFrom.id, mode: 'reparented' });
            continue;
          }

          const fromListings = await tx.sellerListing.findMany({
            where: { variantId: vFrom.id },
            select: { id: true, sellerId: true },
          });
          const existing = await tx.sellerListing.findMany({
            where: { variantId: vInto.id, sellerId: { in: fromListings.map((l) => l.sellerId) } },
            select: { sellerId: true },
          });
          const blocked = new Set(existing.map((l) => l.sellerId));

          const movable = fromListings.filter((l) => !blocked.has(l.sellerId)).map((l) => l.id);
          if (movable.length) {
            await tx.sellerListing.updateMany({
              where: { id: { in: movable } },
              data: { variantId: vInto.id },
            });
            moved.push({ variantId: vFrom.id, mode: 'listings-moved', count: movable.length });
          }

          const stuck = fromListings.filter((l) => blocked.has(l.sellerId));
          if (stuck.length) {
            await tx.sellerListing.updateMany({
              where: { id: { in: stuck.map((l) => l.id) } },
              data: { status: 'INACTIVE' },
            });
            conflicts.push(...stuck.map((l) => ({ listingId: l.id, sellerId: l.sellerId, variantId: vFrom.id })));
          }

          // Re-parent the now-empty (or conflict-only) variant so nothing dangles
          // under a MERGED product.
          await tx.productVariant.update({
            where: { id: vFrom.id },
            data: { productId: into.id, isDefault: false },
          });
        }

        // Consolidate reviews, then recompute the surviving product's rating.
        const repointed = await tx.review.updateMany({
          where: { productId: from.id },
          data: { productId: into.id },
        });
        const agg = await tx.review.aggregate({
          where: { productId: into.id },
          _avg: { rating: true },
          _count: { rating: true },
        });

        await tx.product.update({
          where: { id: into.id },
          data: {
            rating: agg._avg.rating || 0,
            ratingCount: agg._count.rating,
            viewCount: { increment: from.viewCount || 0 },
          },
        });

        await tx.product.update({
          where: { id: from.id },
          data: {
            status: 'MERGED',
            mergedIntoId: into.id,
            isActive: false, // DUAL-READ
            qcReviewedBy: req.user.id,
            qcReviewedAt: new Date(),
          },
        });

        return { moved, conflicts, reviewsRepointed: repointed.count };
      });

      // Conflicts go into the same report the backfill writes to, so the admin
      // has one place to work through unresolved duplicates.
      for (const c of summary.conflicts) {
        try {
          await prisma.$executeRaw`
            INSERT INTO "catalog_split_near_miss" ("id","kind","leftId","rightId","similarity","leftLabel","rightLabel","note")
            VALUES (md5(${c.listingId} || '|mergeconflict')::uuid::text, 'MERGE_CONFLICT', ${c.listingId}, ${into.id}, NULL,
                    ${from.name}, ${into.name},
                    'This seller already had an offer on the target product, so their duplicate offer was set INACTIVE rather than deleted. Decide which price and stock to keep.')
            ON CONFLICT ("id") DO NOTHING
          `;
        } catch (err) {
          logger.warn('[CatalogQC] could not record merge conflict: %s', err.message);
        }
      }

      await invalidateStorefront();
      await adminAudit(req, AUDIT_ACTIONS.PRODUCT_MERGE, 'Product', from.id, {
        before: { id: from.id, name: from.name, status: from.status },
        after: { status: 'MERGED', mergedIntoId: into.id },
        metadata: {
          intoId: into.id, intoName: into.name,
          reason: req.body.reason ?? null,
          ...summary,
        },
      });

      return sendSuccess(res, {
        mergedFrom: from.id,
        mergedInto: into.id,
        ...summary,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to merge the products');
    }
  },
);

/** Mark a near-miss row as handled so it drops out of the queue. */
productsQcRouter.post(
  '/duplicates/:id/resolve',
  [param('id').isUUID()],
  validate,
  async (req, res) => {
    try {
      await prisma.$executeRaw`
        UPDATE "catalog_split_near_miss" SET "resolvedAt" = now() WHERE "id" = ${req.params.id}
      `;
      await adminAudit(req, ADMIN_ACTIONS.PRODUCT_UPDATE, 'CatalogNearMiss', req.params.id, {
        after: { resolved: true },
      });
      return sendSuccess(res, { id: req.params.id, resolved: true });
    } catch (err) {
      return sendServerError(res, err, 'Failed to resolve the duplicate');
    }
  },
);

export default productsQcRouter;
