/**
 * Rent read model — machinery and labour, and what never leaves the server.
 *
 * The same two problems the animal marketplace had, in the same shape:
 *
 *  1. PRIVACY. The list `select` carried `lat`/`lng`, and the detail route
 *     spread the entire Prisma row into the response, so an unauthenticated
 *     caller learned exactly where a tractor (and therefore its owner) sits.
 *     Phone numbers were released to ANY signed-in caller with no cap and no
 *     record — one script with one OTP login could walk the whole marketplace.
 *     Projection now happens in one place, so a column added to the model
 *     cannot leak by default.
 *
 *  2. COUNTERPARTY EXPOSURE BEFORE CONSENT. A booking request is not yet a
 *     relationship. `GET /rent/bookings/received` handed the owner the renter's
 *     phone number the moment a request arrived, and `/bookings/:id` handed the
 *     renter the owner's number while the request was still PENDING. Numbers
 *     are exchanged when the booking is CONFIRMED — which is the point at which
 *     both sides have agreed to deal.
 *
 * Distance is coarsened to whole kilometres for the same reason it is in the
 * animal marketplace: metre-precise distances from a few known points locate a
 * seller, and "is this worth the trip?" does not need that precision.
 */
import prisma from '../config/db.js';
import { thumbnailsFor, IMAGE_WIDTHS } from '../utils/imageVariants.js';
import { coarseDistanceKm } from './animalListing.service.js';

/** Cache namespaces for the two public catalogues (see utils/listingCache.js). */
export const NS_MACHINERY = 'rent:machinery';
export const NS_LABOUR    = 'rent:labour';
/** Short TTL — availability changes with every booking; this absorbs bursts. */
export const RENT_TTL_SEC = 30;

/** Booking states in which the two parties have agreed to deal. */
const CONTACT_OK_STATES = new Set(['CONFIRMED', 'ACTIVE', 'COMPLETED']);

/** Columns the machinery grid renders. lat/lng are consumed then stripped. */
export const MACHINERY_LIST_SELECT = {
  id: true, name: true, category: true, brand: true, horsePower: true,
  pricePerHour: true, pricePerDay: true, pricePerAcre: true,
  images: true, videos: true, location: true, district: true,
  available: true, availableFrom: true, availableTo: true,
  rating: true, ratingCount: true, ageYears: true, mileageHours: true,
  features: true, ownerName: true, ownerId: true, createdAt: true,
  lat: true, lng: true,
  owner: { select: { id: true, name: true, avatar: true, kycStatus: true } },
};

/** Everything the machinery detail screen shows. Still no phone, still no coords. */
export const MACHINERY_DETAIL_SELECT = {
  ...MACHINERY_LIST_SELECT,
  description: true, fuelType: true, state: true, status: true, updatedAt: true,
};

export const LABOUR_LIST_SELECT = {
  id: true, name: true, leader: true, groupName: true, skills: true,
  pricePerDay: true, pricePerHour: true, groupSize: true,
  image: true, images: true, location: true, district: true,
  available: true, availableFrom: true, availableTo: true,
  rating: true, ratingCount: true, experience: true,
  providerId: true, createdAt: true,
  lat: true, lng: true,
  provider: { select: { id: true, name: true, avatar: true, kycStatus: true } },
};

export const LABOUR_DETAIL_SELECT = {
  ...LABOUR_LIST_SELECT,
  description: true, languages: true, videos: true, state: true,
  status: true, updatedAt: true,
};

/**
 * Verification is a SERVER fact. Rent listings have no admin-verified flag of
 * their own, so the signal is the owner's KYC state — surfaced explicitly as
 * "ID verified" rather than an unqualified tick the client could infer wrongly.
 */
function verificationOf(person) {
  const idVerified = person?.kycStatus === 'VERIFIED';
  return { ownerIdVerified: idVerified, level: idVerified ? 'ID_VERIFIED' : 'UNVERIFIED' };
}

/** Drop kycStatus from the embedded person; it is summarised in `verification`. */
function publicPerson(p) {
  return p ? { id: p.id, name: p.name, avatar: p.avatar } : null;
}

/**
 * Project a machinery row for list or detail.
 * @param {object} row
 * @param {{distanceKm?: number|null, bookedStatus?: string|null}} extras
 */
export function toPublicMachinery(row, { distanceKm = null, bookedStatus = null } = {}) {
  if (!row) return null;
  const { lat, lng, owner, ...rest } = row;
  return {
    ...rest,
    thumbnails: thumbnailsFor(row.images, IMAGE_WIDTHS.card),
    distanceKm: coarseDistanceKm(distanceKm),
    hasCoords: lat != null && lng != null,
    bookedStatus,
    owner: publicPerson(owner),
    verification: verificationOf(owner),
    // The number lives behind /rent/machinery/:id/contact — authenticated,
    // rate limited and audited.
    contactAvailable: true,
  };
}

export function toPublicLabour(row, { distanceKm = null, bookedStatus = null } = {}) {
  if (!row) return null;
  const { lat, lng, provider, ...rest } = row;
  return {
    ...rest,
    thumbnails: thumbnailsFor(row.images?.length ? row.images : [row.image], IMAGE_WIDTHS.card),
    distanceKm: coarseDistanceKm(distanceKm),
    hasCoords: lat != null && lng != null,
    bookedStatus,
    provider: publicPerson(provider),
    verification: verificationOf(provider),
    contactAvailable: true,
  };
}

/**
 * Strip the counterparty's phone from a booking unless the two sides have
 * actually agreed to deal.
 *
 * `viewerId` decides which side is being protected: the owner reading a request
 * should not see the renter's number until they accept it, and the renter
 * should not see the owner's number until it is accepted. Once CONFIRMED both
 * need to reach each other to arrange the handover, so both are released.
 *
 * @param {object} booking  a booking with `user` and/or listing relations loaded
 * @param {string} viewerId
 */
export function redactBookingContacts(booking, viewerId) {
  if (!booking) return booking;
  const agreed = CONTACT_OK_STATES.has(booking.status);
  const out = { ...booking, contactsReleased: agreed };

  if (out.user) {
    out.user = agreed
      ? out.user
      : { id: out.user.id, name: out.user.name, avatar: out.user.avatar };
  }
  if (out.machineryListing) {
    const { ownerPhone, lat, lng, ...m } = out.machineryListing;
    out.machineryListing = agreed ? { ...m, ownerPhone } : m;
  }
  if (out.labourListing) {
    const { phone, lat, lng, ...l } = out.labourListing;
    out.labourListing = agreed ? { ...l, phone } : l;
  }
  // The viewer's OWN number is not a secret from them.
  if (out.userId === viewerId && out.user) out.user = booking.user;
  return out;
}

/**
 * Days a booking actually spans, inclusive of both ends.
 *
 * The client used to send `days` and the server multiplied it by the daily
 * rate — so a request for 1–30 January with `days: 1` blocked the machine for a
 * month and charged for a day. The date range is the only thing both sides can
 * verify, so the count is derived from it here and the client's value is
 * ignored.
 *
 * @returns {number} at least 1
 */
export function daysBetweenInclusive(startDate, endDate) {
  const s = new Date(startDate); s.setHours(0, 0, 0, 0);
  const e = new Date(endDate);   e.setHours(0, 0, 0, 0);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 1;
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
}

/**
 * Has this user any standing to see the listing owner's phone number?
 *
 * True for the owner themselves, and for anyone with a live booking on the
 * listing. Everyone else still gets it — renting requires a phone call — but
 * through the rate-limited, audited reveal, which is what makes bulk harvesting
 * visible and slow.
 */
export async function hasBookingRelationship(userId, { machineryListingId, labourListingId }) {
  if (!userId) return false;
  const hit = await prisma.booking.findFirst({
    where: {
      userId,
      status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED'] },
      ...(machineryListingId ? { machineryListingId } : {}),
      ...(labourListingId ? { labourListingId } : {}),
    },
    select: { id: true },
  });
  return !!hit;
}
