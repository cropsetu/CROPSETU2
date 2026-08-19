/**
 * Animal-listing read model — what leaves the server, and what never does.
 *
 * Two things drove this module out of the route file:
 *
 *  1. PRIVACY. `GET /animals` and `GET /animals/:id` used to return the whole
 *     Prisma row, which meant every caller — including unauthenticated ones —
 *     received the seller's exact `lat`/`lng` (a farmer's home to ~1 m) and, on
 *     the detail route, their phone number. Scraping the marketplace produced a
 *     mailing list. Projection now happens in ONE place, on the way out, so a
 *     new field cannot leak by being added to the model.
 *
 *  2. PAYLOAD SIZE. The grid needs 12 fields; the detail screen needs 30. Ship
 *     one shape to both and the list response carries every description and
 *     full-resolution image URL for 20 rows.
 *
 * Distance is deliberately coarse. Exact metres from three known points locate a
 * seller precisely, so the public `distanceKm` is rounded to whole kilometres
 * (floored at 1) — accurate enough for "is this worth the trip?", useless for
 * triangulation.
 */
import prisma from '../config/db.js';
import { thumbnailsFor, IMAGE_WIDTHS } from '../utils/imageVariants.js';

/** Cache namespace for public animal listings (see utils/listingCache.js). */
export const NS_ANIMALS = 'animals:listings';
/** Short TTL — a marketplace must feel live; this only absorbs request bursts. */
export const ANIMALS_TTL_SEC = 30;

/** Days a new listing stays live before it needs renewing. */
const LISTING_TTL_DAYS = 45;

/** Columns the 2-column grid actually renders. */
export const LIST_SELECT = {
  id: true, animal: true, breed: true, age: true, gender: true, weight: true,
  price: true, milkYield: true, images: true, tags: true, verified: true,
  status: true, sellerLocation: true, createdAt: true, sellerId: true,
  vaccinated: true, healthCertificate: true, negotiable: true,
  ageMonths: true, weightKg: true, milkYieldLpd: true,
  lat: true, lng: true, // consumed to compute distance, then stripped
  seller: { select: { id: true, name: true, avatar: true, kycStatus: true } },
};

/** Everything the detail screen shows. Still no lat/lng or phone on the way out. */
export const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true, updatedAt: true, viewCount: true, expiresAt: true,
  pregnant: true, lactating: true,
  seller: {
    select: {
      id: true, name: true, avatar: true, kycStatus: true, createdAt: true,
      isOnline: true, lastSeenAt: true,
    },
  },
};

/**
 * Verification is a SERVER fact, never a client claim. A listing counts as
 * verified only when an admin flipped `AnimalListing.verified` (see
 * admin/listings.routes.js); the seller's KYC state is surfaced separately as a
 * softer "ID verified" signal so the UI can distinguish the two.
 */
function verificationOf(row) {
  return {
    listingVerified: row.verified === true,
    sellerIdVerified: row.seller?.kycStatus === 'VERIFIED',
    level: row.verified === true ? 'VERIFIED'
      : row.seller?.kycStatus === 'VERIFIED' ? 'ID_VERIFIED'
        : 'UNVERIFIED',
  };
}

/** Whole kilometres, minimum 1 — see the note on coarseness at the top. */
export function coarseDistanceKm(km) {
  if (km == null || !Number.isFinite(km)) return null;
  return Math.max(1, Math.round(km));
}

/**
 * Project a row for the list endpoint. `distanceKm` comes from the SQL geo pass
 * (already in km) and is coarsened here so every exit point rounds identically.
 */
export function toPublicListing(row, distanceKm = null) {
  if (!row) return null;
  const { lat, lng, seller, ...rest } = row;
  return {
    ...rest,
    // Card-sized derived URLs. `images` stays so an older app build that reads
    // it keeps working — it just also gets the cheap variants now.
    thumbnails: thumbnailsFor(row.images, IMAGE_WIDTHS.card),
    distanceKm: coarseDistanceKm(distanceKm),
    hasCoords: lat != null && lng != null,
    seller: seller ? { id: seller.id, name: seller.name, avatar: seller.avatar } : null,
    verification: verificationOf(row),
  };
}

/**
 * Project a row for the detail endpoint. `sellerListingCount` is passed in by
 * the route (one COUNT, not an N+1 per row) and `isOwner` unlocks nothing
 * sensitive here — the phone still lives behind /animals/:id/contact.
 */
export function toPublicDetail(row, { distanceKm = null, sellerListingCount = null, isFavourite = false } = {}) {
  const base = toPublicListing(row, distanceKm);
  if (!base) return null;
  return {
    ...base,
    images: Array.isArray(row.images) ? row.images : [],
    sellerListingCount,
    isFavourite,
    // Contact details are NOT here. The client calls /animals/:id/contact, which
    // requires auth, is rate limited, and is audit logged.
    contactAvailable: true,
  };
}

/**
 * Ids the viewer must not see: everyone they blocked, plus everyone who blocked
 * them (a block hides both directions, so a blocked buyer cannot keep browsing
 * and re-contacting through a second listing).
 *
 * Returns an empty array for anonymous callers. Never throws — a Redis/DB blip
 * must degrade to "show everything", not to a broken marketplace.
 */
export async function blockedUserIds(viewerId) {
  if (!viewerId) return [];
  try {
    const rows = await prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set();
    for (const r of rows) ids.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
    return [...ids];
  } catch {
    return [];
  }
}

/** True when `a` has blocked `b` or `b` has blocked `a`. */
export async function isBlockedBetween(a, b) {
  if (!a || !b) return false;
  const hit = await prisma.userBlock.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { id: true },
  });
  return !!hit;
}

/** Expiry stamp for a newly created or renewed listing. */
export function listingExpiry(from = new Date()) {
  return new Date(from.getTime() + LISTING_TTL_DAYS * 86_400_000);
}

/**
 * Take stale listings out of the public feed.
 *
 * INACTIVE, not deleted: the row stays, the seller still sees it under My
 * Listings, and one tap on Renew brings it back. A hard delete would lose the
 * chat history attached to it. Rows with no `expiresAt` (created before the
 * column existed and not yet backfilled) are left alone rather than guessed at.
 *
 * @returns {Promise<number>} how many listings were expired
 */
export async function expireStaleAnimalListings(now = new Date()) {
  const { count } = await prisma.animalListing.updateMany({
    where: { status: 'ACTIVE', expiresAt: { not: null, lt: now } },
    data: { status: 'INACTIVE' },
  });
  if (count > 0) {
    // The public list cache still shows them; orphan every entry.
    const { bumpListingVersion } = await import('../utils/listingCache.js');
    await bumpListingVersion(NS_ANIMALS).catch(() => {});
  }
  return count;
}

/**
 * Obvious-duplicate detection for the post-ad flow.
 *
 * Not fraud scoring (contentFraud.service.js already does that) — this catches
 * the far more common accident: the farmer taps Publish, the response is slow on
 * a village connection, they tap again, and the marketplace now shows the same
 * buffalo twice. Same seller + same animal + same breed + same price within the
 * window is that case with high confidence.
 *
 * @returns {Promise<{id:string, createdAt:Date}|null>} the existing listing, if any
 */
export async function findRecentDuplicate({ sellerId, animal, breed, price, windowMinutes = 60 }) {
  if (!sellerId || !animal) return null;
  const since = new Date(Date.now() - windowMinutes * 60_000);
  return prisma.animalListing.findFirst({
    where: {
      sellerId,
      status: 'ACTIVE',
      createdAt: { gte: since },
      animal: { equals: animal, mode: 'insensitive' },
      breed: { equals: breed || '', mode: 'insensitive' },
      price: price != null ? Number(price) : undefined,
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}
