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

export function signAccessToken(payload) {
  return jwt.sign(payload, ENV.JWT_SECRET, {
    expiresIn: ENV.JWT_EXPIRES_IN,
    algorithm: 'HS256',
    issuer:    JWT_ISSUER,
    audience:  JWT_AUDIENCE,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ENV.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer:     JWT_ISSUER,
    audience:   JWT_AUDIENCE,
  });
}

// ── Refresh Tokens (DB-backed, rotatable) ─────────────────────────────────────

export async function createRefreshToken(userId) {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + ENV.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { token: hash, userId, expiresAt },
  });

  return raw;
}

export async function validateRefreshToken(userId, rawToken) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const record = await prisma.refreshToken.findFirst({
    where: { token: hash, userId, expiresAt: { gt: new Date() } },
  });
  return record || null;
}

export async function revokeRefreshToken(id) {
  await prisma.refreshToken.delete({ where: { id } }).catch(() => {});
}

export async function revokeAllRefreshTokens(userId) {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}
