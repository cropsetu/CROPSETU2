/**
 * Account Erasure Service — DPDP Act §8 "Right to Erasure".
 *
 * Strategy (chosen): ANONYMIZE-IN-PLACE + DELETE-PERSONAL.
 *   • The User row is kept but every PII field is nulled/placeholdered, the
 *     phone becomes a unique non-loginable sentinel, the account is deactivated
 *     and tokenVersion is bumped to invalidate outstanding JWTs.
 *   • Purely-personal records (auth sessions, AI/voice/crop/farm/soil data,
 *     saved addresses, cart, notifications, seller-profile incl. bank+KYC) are
 *     HARD-DELETED. Most have ON DELETE CASCADE to their own children, which the
 *     DB enforces when the parent rows are removed.
 *   • Shared / transactional records that involve OTHER users or carry legal
 *     retention duties (orders, bookings, marketplace listings) are RETAINED but
 *     scrubbed of this user's PII and deactivated, reattributed to "Deleted
 *     User". This keeps buyers'/sellers' history and tax records intact.
 *   • Cloudinary assets owned by the user (avatar, KYC docs, crop-scan / soil /
 *     farm / voice media) are destroyed best-effort.
 *
 * Keeping the User row (rather than deleting it) deliberately avoids the ~25
 * relations that default to ON DELETE RESTRICT — those would otherwise block a
 * hard delete whenever the user has any order, listing, post, review or chat.
 *
 * Verification (OTP re-auth) and audit logging live in the route; this module is
 * the data-layer cascade and is safe to call only after the caller is verified.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { publicIdFromUrl, destroyAsset } from '../config/cloudinary.js';

export const ANON_NAME = 'Deleted User';

/**
 * Build the anonymized User-row patch. Pure + exported for unit testing.
 * Every PII field is cleared; the phone is replaced with a unique sentinel that
 * cannot be used to authenticate; tokenVersion is incremented to revoke JWTs.
 */
export function anonymizedUserFields(userId) {
  return {
    // phone is @unique and required — a per-id sentinel keeps the row valid,
    // frees the real number for re-registration, and cannot be logged into.
    phone:                  `deleted_${userId}`,
    name:                   ANON_NAME,
    avatar:                 null,
    statusQuote:            null,
    // location
    pincode:                null,
    district:               null,
    city:                   null,
    state:                  null,
    taluka:                 null,
    village:                null,
    lat:                    null,
    lng:                    null,
    // identity / financial / demographic PII
    gstNumber:              null,
    gstOptOut:              false,
    aadhaarLast4:           null,
    annualHouseholdIncome:  null,
    dateOfBirth:            null,
    isMinor:                false,
    guardianConsentAt:      null,
    dependents:             null,
    familySize:             null,
    education:              null,
    gender:                 null,
    preferredContactMethod: null,
    preferredMandi:         null,
    businessType:           null,
    // account state
    isActive:               false,
    isOnline:               false,
    activeFarmId:           null,
    tokenVersion:           { increment: 1 }, // invalidate any outstanding JWTs
  };
}

/** Normalise a stored media value (URL or raw public_id) into a deletable ref. */
function toRef(value, { type = 'upload', resourceType = 'image' } = {}) {
  if (!value || typeof value !== 'string') return null;
  // KYC docs are stored as raw public_ids (private/authenticated); everything
  // else is a secure_url we must parse the public_id out of.
  const publicId = publicIdFromUrl(value) ?? value;
  return publicId ? { publicId, type, resourceType } : null;
}

/**
 * Read every Cloudinary asset owned by the user from records that are about to
 * be deleted, so we can purge them after the DB transaction commits.
 */
async function collectMediaRefs(userId, avatar) {
  const refs = [];
  const push = (ref) => { if (ref) refs.push(ref); };

  push(toRef(avatar)); // profile avatar (public upload)

  const [sp, reports, soils, voices, farms, cycles, soilReports] = await Promise.all([
    prisma.sellerProfile.findUnique({ where: { userId }, select: { kycDocumentUrls: true } }),
    prisma.cropDiseaseReport.findMany({ where: { userId }, select: { imageUrls: true } }),
    prisma.soilHealthRecord.findMany({ where: { userId }, select: { scanImageUrl: true } }),
    prisma.voiceSession.findMany({ where: { userId }, select: { audioInputUrl: true, audioOutputUrl: true } }),
    prisma.farm.findMany({ where: { farmerId: userId }, select: { sevenTwelveImageUrl: true } }),
    prisma.farmCropCycle.findMany({ where: { farmerId: userId }, select: { photos: true, seedReceiptUrl: true } }),
    prisma.farmSoilReport.findMany({ where: { farmerId: userId }, select: { reportImageUrl: true, reportPdfUrl: true } }),
  ]);

  // KYC documents — stored privately (authenticated)
  for (const id of sp?.kycDocumentUrls || []) push(toRef(id, { type: 'authenticated' }));
  for (const r of reports)     for (const u of r.imageUrls || []) push(toRef(u));
  for (const s of soils)       push(toRef(s.scanImageUrl));
  for (const v of voices)    { push(toRef(v.audioInputUrl, { resourceType: 'video' })); push(toRef(v.audioOutputUrl, { resourceType: 'video' })); }
  for (const f of farms)       push(toRef(f.sevenTwelveImageUrl));
  for (const c of cycles)    { for (const p of c.photos || []) push(toRef(p)); push(toRef(c.seedReceiptUrl)); }
  for (const r of soilReports) { push(toRef(r.reportImageUrl)); push(toRef(r.reportPdfUrl)); }

  return refs;
}


/**
 * The FastAPI-owned scan tables that exist in THIS database.
 *
 * `ai_scan_diagnoses` and `ai_scan_feedback` are created by the AI service
 * through asyncpg (fastapi/persistence/diagnosis_repo.py) and are absent from
 * schema.prisma, so no Prisma delegate can reach them and no model-based delete
 * walks them. They carry a user_id next to image hashes and the full diagnosis
 * payload, which makes them personal data this service is meant to erase.
 *
 * A deployment where the AI service has never booted has neither table, and that
 * must not fail a farmer's erasure request — hence the probe rather than a
 * try/catch around the DELETE itself.
 *
 * `to_regclass` returns NULL instead of raising for an unknown name, which is
 * the whole reason it is used here.
 */
const AI_SCAN_TABLES = ['ai_scan_feedback', 'ai_scan_diagnoses'];

async function existingAiScanTables() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT c.name FROM unnest(${AI_SCAN_TABLES}::text[]) AS c(name)
      WHERE to_regclass('public.' || c.name) IS NOT NULL
    `;
    const found = rows.map((r) => r.name);
    const missing = AI_SCAN_TABLES.filter((t) => !found.includes(t));
    if (missing.length) {
      logger.warn('[erasure] AI scan table(s) absent, nothing to erase there: %s', missing.join(', '));
    }
    return found;
  } catch (err) {
    // Failing to ASK must not silently skip the delete: an erasure that quietly
    // leaves personal data behind is worse than one that fails and is retried.
    logger.error({ err }, '[erasure] could not determine AI scan tables');
    throw err;
  }
}

/**
 * Erase a user's account: delete personal data, anonymize shared records and
 * the user row, then purge Cloudinary assets. Returns a summary for auditing.
 * Idempotent-ish: a second call on an already-anonymized row is a no-op cascade.
 */
export async function eraseUserAccount(userId) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, phone: true, avatar: true },
  });
  if (!user) return { erased: false, reason: 'not_found' };

  // 1) Gather media to purge BEFORE the rows that reference it are deleted.
  const mediaRefs = await collectMediaRefs(userId, user.avatar);

  // 1b) Which FastAPI-owned tables actually exist here?
  //
  // Probed BEFORE the transaction, deliberately. Postgres aborts the ENTIRE
  // transaction on any failed statement, so a DELETE against a missing table
  // cannot be caught and stepped over — every statement after it fails with
  // 25P02 "current transaction is aborted" and the erasure dies. Asking first
  // costs one cheap query and keeps the transaction clean.
  const aiTables = await existingAiScanTables();

  // 2) All DB mutations in one transaction so erasure is all-or-nothing.
  await prisma.$transaction(async (tx) => {
    // ── Hard-delete purely-personal records ──────────────────────────────────
    // Auth / sessions
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.pushToken.deleteMany({ where: { userId } });
    await tx.otpSession.deleteMany({ where: { OR: [{ userId }, { phone: user.phone }] } });
    // Commerce-personal (not shared)
    await tx.cartItem.deleteMany({ where: { userId } });
    await tx.savedAddress.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.priceAlert.deleteMany({ where: { userId } });
    // Social reactions / memberships (content authored stays, reattributed)
    await tx.postLike.deleteMany({ where: { userId } });
    await tx.postBookmark.deleteMany({ where: { userId } });
    await tx.commentLike.deleteMany({ where: { userId } });
    await tx.groupMember.deleteMany({ where: { userId } });
    // AI / voice (note: acronym models map to aI* Prisma delegates)
    await tx.aIUsage.deleteMany({ where: { userId } });
    await tx.aICredit.deleteMany({ where: { userId } });          // cascades transactions
    await tx.aIConversation.deleteMany({ where: { userId } });    // cascades messages
    await tx.voiceSession.deleteMany({ where: { userId } });
    await tx.voiceConversation.deleteMany({ where: { userId } }); // cascades messages
    // Agronomy / crop personal data
    await tx.diseaseFeedback.deleteMany({ where: { userId } });
    await tx.cropDiseaseReport.deleteMany({ where: { userId } });
    await tx.cropReportShare.deleteMany({ where: { OR: [{ farmerId: userId }, { sellerId: userId }] } });
    await tx.plannerTask.deleteMany({ where: { userId } });
    await tx.schemeApplication.deleteMany({ where: { userId } });
    await tx.soilHealthRecord.deleteMany({ where: { userId } });
    await tx.irrigationLog.deleteMany({ where: { userId } });
    await tx.cropCalendar.deleteMany({ where: { userId } });      // cascades tasks
    // Farm data — children cascade from Farm; clear farm-scoped rows then farms
    await tx.farmCropCycle.deleteMany({ where: { farmerId: userId } });
    await tx.farmSoilReport.deleteMany({ where: { farmerId: userId } });
    await tx.farmWeatherHistory.deleteMany({ where: { farmerId: userId } });
    await tx.farmerPrediction.deleteMany({ where: { farmerId: userId } });
    await tx.farm.deleteMany({ where: { farmerId: userId } });
    await tx.farmDetail.deleteMany({ where: { userId } });
    // Seller financial PII (bank + Aadhaar/PAN + KYC references)
    await tx.sellerProfile.deleteMany({ where: { userId } });
    // Consent proof trail carries PII (IP/user-agent) — once the account is
    // erased there is no further processing to justify, so it is removed too.
    await tx.consentRecord.deleteMany({ where: { userId } });

    // ── Anonymize shared / transactional records (retained) ──────────────────
    // A departing seller's OFFERS come down; the shared CATALOG rows stay. Post
    // catalog-split, `products` is identity that other Kendras also sell against,
    // so deactivating it would take their live offers offline too. The offer is
    // the only thing that belongs to this user.
    await tx.sellerListing.updateMany({ where: { sellerId: userId }, data: { status: 'INACTIVE', stockQty: 0 } });
    await tx.cartItem.deleteMany({ where: { listing: { sellerId: userId } } });
    // DUAL-READ: pre-backfill rows still carry their offer on the product row.
    await tx.product.updateMany({ where: { sellerId: userId }, data: { isActive: false } });
    await tx.animalListing.updateMany({ where: { sellerId: userId }, data: { status: 'INACTIVE' } });
    await tx.machineryListing.updateMany({
      where: { ownerId: userId },
      data:  { status: 'INACTIVE', available: false, ownerName: null, ownerPhone: null },
    });
    await tx.labourListing.updateMany({
      where: { providerId: userId },
      data:  { status: 'INACTIVE', available: false, name: ANON_NAME, phone: null, leader: null, groupName: null },
    });
    // Orders/bookings retained for the counterparty + tax records, PII scrubbed.
    await tx.order.updateMany({ where: { userId }, data: { deliveryAddress: { redacted: true }, notes: null } });
    await tx.booking.updateMany({ where: { userId }, data: { notes: null } });

    // ── Tables Prisma does not know about ────────────────────────────────────
    // `ai_scan_diagnoses` and `ai_scan_feedback` are created by the FastAPI
    // service through asyncpg (persistence/diagnosis_repo.py) and are absent
    // from schema.prisma, so every model-based delete above walks straight past
    // them. They carry a `user_id` alongside image hashes and the full
    // diagnosis payload, which makes them personal data this service is
    // supposed to be erasing.
    //
    // Raw SQL because there is no delegate to call — parameterised, and inside
    // the SAME transaction as everything else, so an erasure either takes all
    // of it or none of it. `IF EXISTS`-style tolerance is handled by the catch:
    // a deployment where FastAPI has never booted has no such tables, and that
    // must not fail a farmer's erasure request.
    //
    // NOTE the rows written before the worker started copying user_id into the
    // task params carry user_id NULL, and nothing keyed on user_id can reach
    // them. Deleting those is a separate backfill decision, not something to do
    // silently here — see docs/performance/FINDINGS.md.
    for (const table of aiTables) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE user_id = $1`, userId);
    }

    // ── Anonymize the user row itself ────────────────────────────────────────
    await tx.user.update({ where: { id: userId }, data: anonymizedUserFields(userId) });
  }, { timeout: 30000, maxWait: 10000 });

  // 3) Purge Cloudinary assets (best-effort, never blocks erasure).
  let mediaDeleted = 0;
  for (const ref of mediaRefs) {
    // eslint-disable-next-line no-await-in-loop
    if (await destroyAsset(ref.publicId, { resourceType: ref.resourceType, type: ref.type })) mediaDeleted++;
  }
  if (mediaRefs.length && mediaDeleted < mediaRefs.length) {
    logger.warn({ userId, total: mediaRefs.length, deleted: mediaDeleted }, '[erasure] some Cloudinary assets were not confirmed deleted');
  }

  return { erased: true, mediaRefs: mediaRefs.length, mediaDeleted };
}
