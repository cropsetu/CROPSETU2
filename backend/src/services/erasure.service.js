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
