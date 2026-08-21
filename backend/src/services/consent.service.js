/**
 * Consent Service — capture & retrieve DPDP §5 consent proof.
 *
 * Storage is append-only (one immutable ConsentRecord row per grant/withdraw).
 * The EFFECTIVE consent for a (user, purpose) is the most recent row, computed
 * by reduceEffectiveConsents(). This preserves a full, demonstrable history
 * while still answering "does this user currently consent to X?".
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import {
  CONSENT_POLICY_VERSION,
  REQUIRED_SIGNUP_PURPOSES,
  isValidPurpose,
} from '../constants/consent.js';

/**
 * Reduce an append-only list of consent rows to the latest state per purpose.
 * Pure + exported for unit testing. Input rows need { purpose, granted,
 * policyVersion, createdAt }. Returns a map: purpose -> latest record.
 */
export function reduceEffectiveConsents(rows) {
  const latest = {};
  for (const r of rows) {
    const cur = latest[r.purpose];
    if (!cur || new Date(r.createdAt) > new Date(cur.createdAt)) {
      latest[r.purpose] = r;
    }
  }
  return latest;
}

/**
 * Record one consent action (grant or withdraw) as a new immutable row.
 * Captures proof (policy version, ip, user-agent, method) and a timestamp.
 */
export async function recordConsent({
  userId, purpose, granted,
  policyVersion = CONSENT_POLICY_VERSION,
  method = 'api', ip = null, userAgent = null, metadata = null,
}) {
  if (!isValidPurpose(purpose)) {
    throw new Error(`Unknown consent purpose: ${purpose}`);
  }
  return prisma.consentRecord.create({
    data: {
      userId,
      purpose,
      granted: Boolean(granted),
      policyVersion,
      method,
      ip,
      userAgent,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}

/**
 * Record several consents in one batch (e.g. the required set at signup).
 * `purposes` is an array of purpose strings; all are granted with the same proof.
 */
async function recordConsents({ userId, purposes, granted = true, policyVersion = CONSENT_POLICY_VERSION, method = 'api', ip = null, userAgent = null, metadata = null }) {
  const valid = purposes.filter(isValidPurpose);
  if (!valid.length) return { count: 0 };
  return prisma.consentRecord.createMany({
    data: valid.map((purpose) => ({
      userId,
      purpose,
      granted: Boolean(granted),
      policyVersion,
      method,
      ip,
      userAgent,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })),
  });
}

/**
 * Effective consent state for a user: purpose -> latest record.
 *
 * The latest row PER PURPOSE is picked in SQL. This used to read every consent
 * row the user had ever written and reduce them in JavaScript — and the table is
 * append-only by design (that is what makes it DPDP §5 proof), so the cost of
 * answering "may we send this farmer a promotion?" grew with how long they had
 * been a customer and how often they had changed their mind. There are about a
 * dozen purposes; a two-year account that had toggled a few of them read
 * hundreds of rows into Node to produce a dozen answers, and parsed a Date for
 * every one of them on the way.
 *
 * DISTINCT ON is bounded by the number of purposes instead. The predicate is
 * `userId = $1`, which the existing @@index([userId, purpose]) serves, so the
 * scan was never the expensive part — the transfer and the reduce were.
 *
 * `id DESC` is a tiebreaker, not decoration: two rows written in the same
 * transaction share a createdAt, and without it which one counts as current
 * would be whatever order the heap happened to return. For a record of consent
 * that has to be defensible, "it depends" is not an acceptable answer.
 *
 * reduceEffectiveConsents stays exported and unit-tested: it is the same rule,
 * and keeping it is what lets the two be compared.
 */
export async function getEffectiveConsents(userId) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON ("purpose") *
    FROM "consent_records"
    WHERE "userId" = ${userId}
    ORDER BY "purpose", "createdAt" DESC, "id" DESC
  `;
  const latest = {};
  for (const r of rows) latest[r.purpose] = r;
  return latest;
}

/** True only if the user's latest record for `purpose` is a grant. */
export async function hasConsent(userId, purpose) {
  const row = await prisma.consentRecord.findFirst({
    where:   { userId, purpose },
    orderBy: { createdAt: 'desc' },
  });
  return Boolean(row?.granted);
}

/** Full append-only history (proof trail) for a user, newest first. */
export async function getConsentHistory(userId) {
  return prisma.consentRecord.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Capture the required signup consents. Best-effort: a failure here must not
 * block account creation, but it is logged loudly so it can be reconciled.
 */
export async function captureSignupConsent({ userId, policyVersion = CONSENT_POLICY_VERSION, ip = null, userAgent = null, purposes = REQUIRED_SIGNUP_PURPOSES }) {
  try {
    await recordConsents({
      userId,
      purposes,
      granted: true,
      policyVersion,
      method: 'signup',
      ip,
      userAgent,
    });
  } catch (err) {
    logger.error({ err, userId }, '[consent] failed to capture signup consent');
  }
}
