import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { ENV } from '../config/env.js';
import prisma from '../config/db.js';

/**
 * Sign a short-lived access token (15 min by default).
 */
export function signAccessToken(payload) {
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: ENV.JWT_EXPIRES_IN });
}

/**
 * Verify an access token. Throws on invalid/expired.
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, ENV.JWT_SECRET);
}

/**
 * Create a hashed refresh token, store in DB, return raw token string.
 */
export async function createRefreshToken(userId) {
  const raw = uuidv4();
  const hashed = await bcrypt.hash(raw, 10);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ENV.REFRESH_TOKEN_EXPIRES_DAYS);

  await prisma.refreshToken.create({
    data: { token: hashed, userId, expiresAt },
  });

  return raw;
}

/**
 * Validate a raw refresh token against stored hashes for a user.
 * Returns the RefreshToken record if valid, null otherwise.
 */
export async function validateRefreshToken(userId, rawToken) {
  const tokens = await prisma.refreshToken.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
  });

  for (const record of tokens) {
    const match = await bcrypt.compare(rawToken, record.token);
    if (match) return record;
  }
  return null;
}

/**
 * Delete a specific refresh token record (logout).
 */
export async function revokeRefreshToken(tokenId) {
  await prisma.refreshToken.delete({ where: { id: tokenId } }).catch(() => {});
}

/**
 * Delete all refresh tokens for a user (logout all devices).
 */
export async function revokeAllRefreshTokens(userId) {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}
