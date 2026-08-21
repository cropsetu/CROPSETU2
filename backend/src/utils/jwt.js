/**
 * JWT utilities — access tokens (HS256) + refresh tokens (DB-backed).
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ENV } from '../config/env.js';
import prisma from '../config/db.js';

const JWT_ISSUER   = 'cropsetu-backend';
const JWT_AUDIENCE = 'cropsetu-mobile';

// ── Access Tokens ─────────────────────────────────────────────────────────────

/**
 * Sign an access token. The token embeds the user's `tokenVersion` as `tv`;
 * authenticate() rejects a token whose `tv` is behind the user's current
 * version — that's how a security-sensitive change (e.g. phone change) revokes
 * every previously issued token.
 *
 * Each token also carries a unique `jti` (JWT ID) so an individual token can be
 * revoked on a single-device logout via the Redis denylist (see
 * services/tokenDenylist.service.js) without disturbing the user's other
 * sessions — which a tokenVersion bump would.
 */
export function signAccessToken({ sub, role, tokenVersion = 0 }) {
  return jwt.sign({ sub, role, tv: tokenVersion }, ENV.JWT_SECRET, {
    expiresIn: ENV.JWT_EXPIRES_IN,
    algorithm: 'HS256',
    issuer:    JWT_ISSUER,
    audience:  JWT_AUDIENCE,
    jwtid:     crypto.randomUUID(),
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ENV.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer:     JWT_ISSUER,
    audience:   JWT_AUDIENCE,
  });
}

/**
 * Increment a user's token version, invalidating every access token issued
 * before this call. Pass a transaction client to bump atomically with the
 * change that triggered it. Returns the new version.
 */
export async function bumpTokenVersion(userId, client = prisma) {
  const updated = await client.user.update({
    where:  { id: userId },
    data:   { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  return updated.tokenVersion;
}

// ── Refresh Tokens (DB-backed, rotating with reuse detection) ─────────────────
//
// Every refresh issues a brand-new token and spends the old one (rotation).
// Tokens are linked by `familyId` into a lineage. If a token that was already
// rotated is presented again, that means it leaked (the legit client and an
// attacker both hold a copy) — we revoke the entire family, forcing a fresh
// sign-in and cutting off the attacker's chain.

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Idle timeout: how long a token stays valid without being refreshed. Slides
// forward on every rotation, so an active session never hits it.
function idleTtlMs() {
  return ENV.SESSION_IDLE_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;
}

// Absolute timeout: hard cap on a session's total lifetime from first login.
function absoluteTtlMs() {
  return ENV.SESSION_ABSOLUTE_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Mint a refresh token. Starts a new family unless `familyId` is supplied
 * (rotation continues the predecessor's lineage); `sessionStartedAt` is carried
 * across rotations so the absolute timeout is anchored to the original login.
 * Returns the raw token.
 */
export async function createRefreshToken(userId, familyId = null, sessionStartedAt = null, client = prisma) {
  const raw = crypto.randomBytes(48).toString('hex');
  const now = Date.now();
  const expiresAt = new Date(now + idleTtlMs()); // idle window (sliding)

  await client.refreshToken.create({
    data: {
      token:    hashToken(raw),
      userId,
      familyId: familyId || crypto.randomUUID(),
      sessionStartedAt: sessionStartedAt || new Date(now),
      expiresAt,
    },
  });

  return raw;
}


/**
 * Atomically spend `record` and mint its successor.
 *
 * These were two separate statements. If the mint failed — a pool timeout, a
 * stalled primary — the token was left spent with no successor in existence, so
 * the client could never recover: every later attempt presented an already-
 * rotated token and tripped reuse detection. A transaction makes it all-or-
 * nothing, so a failed mint rolls the claim back and the token stays usable.
 *
 * `updateMany` with `rotatedAt: null` in the predicate is what serialises two
 * concurrent refreshes: exactly one gets count === 1.
 *
 * @returns {Promise<string|null>} the successor's raw token, or null if another
 *   caller claimed this rotation first.
 */
async function claimAndMint(record, startedAt) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.refreshToken.updateMany({
      where: { id: record.id, rotatedAt: null },
      data:  { rotatedAt: new Date() },
    });
    if (claim.count === 0) return null;
    return createRefreshToken(record.userId, record.familyId, startedAt, tx);
  });
}

// Revoke an entire lineage. Guards against a null familyId (legacy tokens
// minted before rotation lineages existed) deleting unrelated rows.
async function revokeFamily(record) {
  if (record.familyId) {
    await prisma.refreshToken.deleteMany({ where: { familyId: record.familyId } });
  } else {
    await prisma.refreshToken.delete({ where: { id: record.id } }).catch(() => {});
  }
}

/**
 * Rotate a refresh token. Returns:
 *   { status: 'ok', refreshToken, familyId } — rotated, successor issued
 *   { status: 'invalid' }                    — unknown or expired token
 *   { status: 'reuse', familyId }            — token already spent → family burned
 */
export async function rotateRefreshToken(rawToken, userId = null) {
  // The token hash is unique, so it alone identifies the row (cookie path has no
  // userId). When a userId is supplied (mobile body path) we scope by it too as
  // a defence-in-depth check.
  const record = await prisma.refreshToken.findFirst({
    where: userId ? { token: hashToken(rawToken), userId } : { token: hashToken(rawToken) },
  });

  if (!record) return { status: 'invalid' };

  // Reuse: a spent (already-rotated) token is being replayed → leak. Burn it all.
  //
  // NOTE: a lost response can also land here — rotation commits before the reply
  // is written, so a client that never received the successor will re-present a
  // token the server already spent, and that is indistinguishable from theft at
  // this layer. A short "rotation leeway" (recover when the successor is still
  // unspent) is the standard mitigation, but it deliberately weakens the
  // property asserted by `rotation issues a new token and replaying the old one
  // burns the whole family` in tests/backend/api/auth.api.test.js, so it is not
  // taken unilaterally. The client side avoids provoking this instead: see the
  // 5xx handling in shared/services/api.js performRefresh().
  if (record.rotatedAt) {
    await revokeFamily(record);
    return { status: 'reuse', familyId: record.familyId, userId: record.userId };
  }

  const now = Date.now();

  // Idle timeout: the token lapsed without being refreshed in time.
  if (record.expiresAt <= new Date(now)) {
    await revokeFamily(record);
    return { status: 'expired' };
  }

  // Absolute timeout: the session has lived longer than its hard cap from the
  // original login, regardless of how active it's been.
  const startedAt = record.sessionStartedAt ?? record.createdAt;
  if (startedAt && now - new Date(startedAt).getTime() > absoluteTtlMs()) {
    await revokeFamily(record);
    return { status: 'expired' };
  }

  // Claim the rotation and mint the successor as ONE transaction, so the token
  // is never spent without a successor existing. The loser of a concurrent race
  // gets null and is treated as reuse of an already-spent token.
  // Successor inherits the session start so the absolute cap stays anchored.
  const refreshToken = await claimAndMint(record, startedAt);
  if (!refreshToken) {
    await revokeFamily(record);
    return { status: 'reuse', familyId: record.familyId, userId: record.userId };
  }

  return { status: 'ok', refreshToken, familyId: record.familyId, userId: record.userId };
}

/**
 * Revoke the lineage of the presented token (used on logout). Returns whether a
 * matching token was found.
 */
export async function revokeRefreshTokenByRaw(userId, rawToken) {
  const record = await prisma.refreshToken.findFirst({
    where:  { token: hashToken(rawToken), userId },
    select: { id: true, familyId: true },
  });
  if (!record) return false;
  await revokeFamily(record);
  return true;
}

export async function revokeAllRefreshTokens(userId) {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}

/**
 * Enforce the concurrent-session cap for a user. Call right AFTER minting a new
 * session's refresh token (on login). Each active (unrotated, unexpired) token
 * is one live session — exactly one per family — so when the count exceeds the
 * cap we evict the oldest sessions, revoking each one's whole lineage. Returns
 * the number of sessions evicted. A cap of 0 (or less) means unlimited.
 */
export async function enforceSessionLimit(userId, max = ENV.MAX_CONCURRENT_SESSIONS) {
  if (!max || max <= 0) return 0;

  const heads = await prisma.refreshToken.findMany({
    where:   { userId, rotatedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' }, // oldest first
    select:  { id: true, familyId: true },
  });

  if (heads.length <= max) return 0;

  const evict     = heads.slice(0, heads.length - max);
  const familyIds = evict.map((h) => h.familyId).filter(Boolean);
  const looseIds  = evict.filter((h) => !h.familyId).map((h) => h.id);

  if (familyIds.length) {
    await prisma.refreshToken.deleteMany({ where: { familyId: { in: familyIds } } });
  }
  if (looseIds.length) {
    await prisma.refreshToken.deleteMany({ where: { id: { in: looseIds } } });
  }

  return evict.length;
}
