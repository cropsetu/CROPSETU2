/**
 * Agri-chemical compliance — the sale gate.
 *
 * ── What existed before ──────────────────────────────────────────────────────
 * Nothing. A pesticide was a `products` row in a category called "Crop
 * Protection" and was sold by exactly the same code path as a hand trowel. There
 * was no licence check, no batch, no expiry, no recall, no way for an
 * administrator to stop a sale in one state, and the product page rendered a
 * hard-coded "CropSetu Verified · Quality Check" line under every item.
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * One function, `evaluateSaleEligibility`, consulted at three points:
 *
 *   add-to-cart   refuse early, with a reason the farmer can act on
 *   quote         so a blocked line is visible before the payment sheet opens
 *   checkout      inside the Serializable transaction — the authoritative check
 *
 * It answers one question per (listing, buyer) pair: may this be sold, right now,
 * to this person, in this place. Five independent reasons it may not be:
 *
 *   1. the product's compliance record is not APPROVED
 *   2. the seller holds no valid licence for the product's regulated class
 *   3. every live batch behind the offer is expired / too close to expiry
 *   4. the product, batch or seller is under an active recall
 *   5. an administrator has blocked it — by product, seller, category, batch,
 *      state or district
 *
 * ── Two rules this file exists to enforce ────────────────────────────────────
 * NOTHING HERE IS HARD-CODED. Which classes need a licence, how much shelf life
 * is enough, whether enforcement is on at all — every one is an admin setting,
 * because they are regulatory answers that change and must not need a redeploy.
 *
 * NOTHING HERE AUTHORS AGRONOMIC CONTENT. Dosage, target pests, approved crops,
 * storage, first aid and precautions are transcribed from the approved
 * manufacturer label into ProductCompliance and returned verbatim. When a label
 * section is missing this returns null and the app says so. It never generates,
 * infers, or substitutes advice, and it never suggests mixing two products.
 */
import prisma from '../config/db.js';
import { getSetting } from './settings.service.js';
import { cachedListing, bumpListingVersion } from '../utils/listingCache.js';
import logger from '../utils/logger.js';

export const NS_SALEBLOCKS = 'agristore:saleblocks';
const SALEBLOCKS_TTL = 120;

/** Machine-readable refusal codes. The app maps each to a distinct message. */
export const COMPLIANCE_CODES = {
  NOT_APPROVED: 'COMPLIANCE_NOT_APPROVED',
  SELLER_UNLICENSED: 'SELLER_UNLICENSED',
  LICENCE_EXPIRED: 'SELLER_LICENCE_EXPIRED',
  EXPIRED_STOCK: 'EXPIRED_STOCK',
  SHELF_LIFE_TOO_SHORT: 'SHELF_LIFE_TOO_SHORT',
  RECALLED: 'PRODUCT_RECALLED',
  BLOCKED: 'SALE_BLOCKED',
  BATCH_REQUIRED: 'BATCH_REQUIRED',
};

async function complianceConfig() {
  const [enabled, requireLicenceKinds, requireApproval, blockExpired, minShelfLife, expiryAlertDays, safetyNotice] =
    await Promise.all([
      getSetting('compliance.enabled'),
      getSetting('compliance.requireLicenceKinds'),
      getSetting('compliance.requireApprovalBeforePublish'),
      getSetting('compliance.blockExpiredSale'),
      getSetting('compliance.minShelfLifeDaysDefault'),
      getSetting('compliance.expiryAlertDays'),
      getSetting('compliance.safetyNotice'),
    ]);

  return {
    enabled: enabled !== false,
    licenceKinds: new Set(Array.isArray(requireLicenceKinds) ? requireLicenceKinds : []),
    requireApproval: requireApproval !== false,
    blockExpired: blockExpired !== false,
    minShelfLifeDays: Number(minShelfLife) || 0,
    expiryAlertDays: Number(expiryAlertDays) || 45,
    safetyNotice: typeof safetyNotice === 'string' ? safetyNotice : '',
  };
}

export async function invalidateSaleBlocks() {
  await bumpListingVersion(NS_SALEBLOCKS);
}

/**
 * Active sale blocks, cached.
 *
 * Loaded WHOLE rather than queried per line: a marketplace has a handful of live
 * blocks at any time, and the alternative is one query per cart line on the
 * hottest write path in the app. The cache is bumped on every block write, so a
 * newly-created block takes effect on the next request, not in two minutes.
 */
async function activeBlocks() {
  const { data } = await cachedListing(NS_SALEBLOCKS, 'all', SALEBLOCKS_TTL, async () => ({
    data: await prisma.saleBlock.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        id: true, scope: true, productId: true, sellerId: true, categoryId: true,
        batchNumber: true, state: true, district: true, publicMessage: true,
      },
      take: 5000,
    }),
  }));
  return data;
}

const ci = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/** Does any active block cover this (product, seller, place)? */
function matchBlock(blocks, { productId, sellerId, categoryId, state, district, batchNumbers = [] }) {
  for (const b of blocks) {
    switch (b.scope) {
      case 'PRODUCT':  if (b.productId === productId) return b; break;
      case 'SELLER':   if (b.sellerId === sellerId) return b; break;
      case 'CATEGORY': if (b.categoryId === categoryId) return b; break;
      case 'BATCH':    if (b.batchNumber && batchNumbers.includes(b.batchNumber)) return b; break;
      // A geography block may be narrowed to one product or one seller; an
      // unnarrowed one stops the whole class of sale in that place, which is what
      // a state-level restriction actually means.
      case 'STATE':
        if (ci(b.state, state) && (!b.productId || b.productId === productId) && (!b.sellerId || b.sellerId === sellerId)) return b;
        break;
      case 'DISTRICT':
        if (ci(b.district, district) && (!b.productId || b.productId === productId) && (!b.sellerId || b.sellerId === sellerId)) return b;
        break;
      default: break;
    }
  }
  return null;
}

const daysBetween = (a, b) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

/** Batch states that can contribute sellable stock. Everything else is held. */
const SELLABLE_BATCH_STATES = new Set(['ACTIVE', 'EXPIRING_SOON']);

/**
 * Evaluate whether a set of listings may be sold to a buyer, in one pass.
 *
 * Batched by design: a cart has n lines and this must not become n × 5 queries on
 * the checkout path. Five queries total, regardless of cart size.
 *
 * @param {object} args
 * @param {Array<{listingId:string, sellerId:string, productId:string, categoryId?:string, quantity?:number}>} args.lines
 * @param {{state?:string, district?:string}} [args.buyer]
 * @param {Date} [args.now]
 * @returns {Promise<Map<string, {allowed:boolean, code?:string, message?:string, batch?:object}>>} keyed by listingId
 */
export async function evaluateSaleEligibility({ lines = [], buyer = {}, now = new Date() }) {
  const result = new Map();
  if (!lines.length) return result;

  const cfg = await complianceConfig();
  const allow = (listingId, extra = {}) => result.set(listingId, { allowed: true, ...extra });

  if (!cfg.enabled) {
    for (const l of lines) allow(l.listingId);
    return result;
  }

  const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
  const sellerIds  = [...new Set(lines.map((l) => l.sellerId).filter(Boolean))];
  const listingIds = [...new Set(lines.map((l) => l.listingId).filter(Boolean))];

  const [compliances, licences, batches, recalls, blocks] = await Promise.all([
    prisma.productCompliance.findMany({
      where: { productId: { in: productIds } },
      select: {
        productId: true, regulatedKind: true, status: true, requiresBatch: true,
        requiresExpiry: true, minShelfLifeDays: true, labelVersion: true,
        registrationValidTo: true,
      },
    }),
    sellerIds.length
      ? prisma.sellerLicence.findMany({
          where: { sellerId: { in: sellerIds } },
          select: { sellerId: true, kind: true, status: true, validTo: true },
        })
      : [],
    listingIds.length
      // ALL statuses, not just the sellable ones. Filtering to ACTIVE here made
      // an offer whose only lot had expired look like an offer with NO lot, so
      // the refusal came back as BATCH_REQUIRED ("this seller has not recorded a
      // batch") when the truth was EXPIRED_STOCK. Same block either way, but the
      // seller reading it would go and re-enter a batch that is already there.
      // Classification happens below, on the full set.
      ? prisma.productBatch.findMany({
          where: { listingId: { in: listingIds } },
          select: { listingId: true, batchNumber: true, expiryDate: true, quantity: true, status: true },
          orderBy: { expiryDate: 'asc' },
        })
      : [],
    productIds.length
      ? prisma.productRecall.findMany({
          where: { productId: { in: productIds }, isActive: true },
          select: { productId: true, batchNumber: true, sellerId: true, reason: true, advice: true },
        })
      : [],
    activeBlocks(),
  ]);

  const complianceByProduct = new Map(compliances.map((c) => [c.productId, c]));
  const licenceBySeller = new Map();
  for (const l of licences) licenceBySeller.set(`${l.sellerId}:${l.kind}`, l);
  const batchesByListing = new Map();
  for (const b of batches) {
    if (!batchesByListing.has(b.listingId)) batchesByListing.set(b.listingId, []);
    batchesByListing.get(b.listingId).push(b);
  }

  for (const line of lines) {
    const { listingId, sellerId, productId, categoryId } = line;
    const lineBatches = batchesByListing.get(listingId) || [];
    const batchNumbers = lineBatches.map((b) => b.batchNumber);

    // (5) Administrative blocks apply to EVERY product, regulated or not — that
    // is the point of a block. Checked first so an operator's stop-sale wins over
    // every other consideration.
    const block = matchBlock(blocks, {
      productId, sellerId, categoryId,
      state: buyer.state, district: buyer.district,
      batchNumbers,
    });
    if (block) {
      result.set(listingId, {
        allowed: false,
        code: COMPLIANCE_CODES.BLOCKED,
        message: block.publicMessage || 'This product is not available for sale in your area right now.',
      });
      continue;
    }

    const compliance = complianceByProduct.get(productId);
    const kind = compliance?.regulatedKind || 'NONE';

    // Not a regulated product → nothing further to check.
    if (!compliance || kind === 'NONE') { allow(listingId); continue; }

    // (4) Recalls, narrowed to the batch and/or the seller when the recall was.
    const recall = recalls.find((r) =>
      r.productId === productId
      && (!r.sellerId || r.sellerId === sellerId)
      && (!r.batchNumber || batchNumbers.includes(r.batchNumber)));
    if (recall) {
      result.set(listingId, {
        allowed: false,
        code: COMPLIANCE_CODES.RECALLED,
        message: 'This product has been recalled and cannot be ordered. If you have already bought it, please follow the recall notice.',
        advice: recall.advice || null,
      });
      continue;
    }

    // (1) Compliance approval.
    if (cfg.requireApproval && compliance.status !== 'APPROVED') {
      result.set(listingId, {
        allowed: false,
        code: COMPLIANCE_CODES.NOT_APPROVED,
        message: 'This product is awaiting compliance approval and cannot be ordered yet.',
      });
      continue;
    }

    // (2) Seller licence for this class.
    if (cfg.licenceKinds.has(kind)) {
      const lic = licenceBySeller.get(`${sellerId}:${kind}`);
      if (!lic || lic.status !== 'APPROVED') {
        result.set(listingId, {
          allowed: false,
          code: COMPLIANCE_CODES.SELLER_UNLICENSED,
          message: 'This seller is not licensed to sell this product. Please choose another seller.',
        });
        continue;
      }
      if (lic.validTo && lic.validTo < now) {
        result.set(listingId, {
          allowed: false,
          code: COMPLIANCE_CODES.LICENCE_EXPIRED,
          message: "This seller's licence for this product has expired. Please choose another seller.",
        });
        continue;
      }
    }

    // (3) Expiry. Only enforced when the product's own record says batches are
    // required — a product whose compliance record does not track batches has
    // nothing to check, and inventing a block for it would take stock offline.
    if (compliance.requiresBatch && cfg.blockExpired) {
      if (!lineBatches.length) {
        result.set(listingId, {
          allowed: false,
          code: COMPLIANCE_CODES.BATCH_REQUIRED,
          message: 'This seller has not recorded a batch for this product, so it cannot be sold. Please choose another seller.',
        });
        continue;
      }

      const minShelf = Math.max(Number(compliance.minShelfLifeDays) || 0, cfg.minShelfLifeDays);
      // A lot is sellable only if it is in a sellable STATE and has enough shelf
      // life left. QUARANTINED / RECALLED / DAMAGED lots are held and never count.
      const sellable = lineBatches.filter((b) => {
        if (!SELLABLE_BATCH_STATES.has(b.status)) return false;
        if (b.quantity <= 0) return false;
        if (!b.expiryDate) return !compliance.requiresExpiry;
        return daysBetween(b.expiryDate, now) >= minShelf;
      });

      if (!sellable.length) {
        // Three different situations, three different things for the seller to
        // do about it. Collapsing them into one message is how "your stock has
        // expired" gets read as "you forgot to enter a batch".
        const anyUnexpired = lineBatches.some(
          (b) => SELLABLE_BATCH_STATES.has(b.status) && b.quantity > 0 && b.expiryDate && b.expiryDate > now,
        );
        const anyHeld = lineBatches.some((b) => b.status === 'QUARANTINED' || b.status === 'RECALLED');

        if (anyHeld && !anyUnexpired) {
          result.set(listingId, {
            allowed: false,
            code: COMPLIANCE_CODES.BLOCKED,
            message: "This seller's stock of this product is on hold and cannot be sold. Please choose another seller.",
          });
          continue;
        }

        result.set(listingId, {
          allowed: false,
          code: anyUnexpired ? COMPLIANCE_CODES.SHELF_LIFE_TOO_SHORT : COMPLIANCE_CODES.EXPIRED_STOCK,
          message: anyUnexpired
            ? `This seller's remaining stock expires too soon to be sold (at least ${minShelf} days of shelf life is required). Please choose another seller.`
            : "This seller's stock of this product has expired and cannot be sold. Please choose another seller.",
        });
        continue;
      }

      // Dispatch the earliest-expiring sellable lot — FEFO, so short-dated stock
      // clears first instead of ageing into a write-off.
      allow(listingId, { batch: sellable[0], labelVersion: compliance.labelVersion || null });
      continue;
    }

    allow(listingId, { labelVersion: compliance.labelVersion || null });
  }

  return result;
}

/**
 * Turn the eligibility map into quote issues.
 * Blocking, always: a compliance refusal is never advisory.
 */
export function complianceIssuesFrom(eligibility, linesByListing = new Map()) {
  const issues = [];
  for (const [listingId, verdict] of eligibility) {
    if (verdict.allowed) continue;
    issues.push({
      code: 'COMPLIANCE_BLOCKED',
      reason: verdict.code,
      listingId,
      productName: linesByListing.get(listingId)?.name || null,
      message: verdict.message,
    });
  }
  return issues;
}

/**
 * The buyer-facing safety panel for a regulated product.
 *
 * Returns ONLY what a reviewer approved, verbatim, plus the platform's standing
 * notice. Missing sections come back null so the app can say "not supplied by
 * the manufacturer" rather than filling the gap. There is deliberately no
 * fallback text, no derived dosage, and no combination advice of any kind.
 */
export async function getProductSafetyPanel(productId) {
  const [compliance, cfg] = await Promise.all([
    prisma.productCompliance.findUnique({
      where: { productId },
      select: {
        regulatedKind: true, status: true, activeIngredient: true, formulation: true,
        concentration: true, registrationNumber: true, registrationAuthority: true,
        registrationValidTo: true, approvedCrops: true, targetPests: true,
        dosageText: true, safetyEquipment: true, storageInstructions: true,
        firstAidText: true, precautionText: true, labelVersion: true,
        requiresBatch: true, requiresExpiry: true,
      },
    }),
    complianceConfig(),
  ]);

  if (!compliance || compliance.regulatedKind === 'NONE') return null;

  return {
    regulatedKind: compliance.regulatedKind,
    approved: compliance.status === 'APPROVED',
    activeIngredient: compliance.activeIngredient || null,
    formulation: compliance.formulation || null,
    concentration: compliance.concentration || null,
    registrationNumber: compliance.registrationNumber || null,
    registrationAuthority: compliance.registrationAuthority || null,
    registrationValidTo: compliance.registrationValidTo || null,
    // Label-approved lists. The app renders exactly these and must not present
    // them as a recommendation for the farmer's specific crop or situation.
    approvedCrops: compliance.approvedCrops?.length ? compliance.approvedCrops : null,
    targetPests: compliance.targetPests?.length ? compliance.targetPests : null,
    dosageText: compliance.dosageText || null,
    safetyEquipment: compliance.safetyEquipment?.length ? compliance.safetyEquipment : null,
    storageInstructions: compliance.storageInstructions || null,
    firstAidText: compliance.firstAidText || null,
    precautionText: compliance.precautionText || null,
    labelVersion: compliance.labelVersion || null,
    // Everything above is transcribed from the approved label. This flag tells
    // the app to say so, out loud, next to it.
    sourcedFromApprovedLabel: true,
    safetyNotice: cfg.safetyNotice || null,
  };
}

/**
 * Does publishing this product require compliance approval first?
 * Used by the QC path so a regulated product cannot go live on catalog QC alone.
 */
export async function requiresComplianceApproval(product) {
  const cfg = await complianceConfig();
  if (!cfg.enabled || !cfg.requireApproval) return false;

  const category = product.categoryId
    ? await prisma.category.findUnique({ where: { id: product.categoryId }, select: { isRegulated: true } })
    : null;
  if (!category?.isRegulated) {
    const compliance = await prisma.productCompliance.findUnique({
      where: { productId: product.id },
      select: { regulatedKind: true },
    });
    return !!compliance && compliance.regulatedKind !== 'NONE';
  }
  return true;
}

/**
 * Batch expiry sweep. Marks lots EXPIRING_SOON / EXPIRED and reports what
 * changed so the caller can alert admins and sellers.
 *
 * Runs on a schedule; safe to run repeatedly (both updates are idempotent).
 */
export async function sweepBatchExpiry({ now = new Date() } = {}) {
  const cfg = await complianceConfig();
  const soonCutoff = new Date(now.getTime() + cfg.expiryAlertDays * 86_400_000);

  try {
    const [expired, expiringSoon] = await prisma.$transaction([
      prisma.productBatch.updateMany({
        where: { status: { in: ['ACTIVE', 'EXPIRING_SOON'] }, expiryDate: { lt: now } },
        data: { status: 'EXPIRED' },
      }),
      prisma.productBatch.updateMany({
        where: { status: 'ACTIVE', expiryDate: { gte: now, lte: soonCutoff } },
        data: { status: 'EXPIRING_SOON' },
      }),
    ]);

    if (expired.count) await invalidateSaleBlocks();
    return { expired: expired.count, expiringSoon: expiringSoon.count };
  } catch (err) {
    logger.error({ err }, '[Compliance] batch expiry sweep failed');
    return { expired: 0, expiringSoon: 0, error: true };
  }
}

/**
 * Who bought a recalled batch.
 *
 * Reads order_items, which carries a FROZEN batchNumber — that snapshot is the
 * only reason this question is answerable at all. Live inventory says nothing
 * about what shipped six weeks ago.
 */
export async function findAffectedBuyers({ productId, batchNumber = null, sellerId = null, limit = 5000 }) {
  const items = await prisma.orderItem.findMany({
    where: {
      productId,
      ...(batchNumber ? { batchNumber } : {}),
      ...(sellerId ? { sellerId } : {}),
      status: { notIn: ['CANCELLED'] },
    },
    select: {
      id: true, orderId: true, batchNumber: true, quantity: true,
      order: { select: { userId: true, createdAt: true } },
    },
    take: limit,
  });

  const byUser = new Map();
  for (const i of items) {
    const uid = i.order?.userId;
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, { userId: uid, orderIds: new Set(), units: 0 });
    const rec = byUser.get(uid);
    rec.orderIds.add(i.orderId);
    rec.units += i.quantity;
  }

  return [...byUser.values()].map((r) => ({
    userId: r.userId,
    orderIds: [...r.orderIds],
    units: r.units,
  }));
}
