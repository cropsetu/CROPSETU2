/**
 * Mint real access tokens for seeded users so the load test can exercise
 * AUTHENTICATED routes without going through the OTP flow (which is itself
 * rate-limited to 5/hour/phone and would otherwise dominate the test).
 *
 * Usage:  node tests/backend/load/mint-tokens.mjs > tokens.json
 */
import 'dotenv/config';
import prisma from '../../../src/config/db.js';
import { signAccessToken } from '../../../src/utils/jwt.js';

const users = await prisma.user.findMany({
  where:  { isActive: true },
  select: { id: true, role: true, tokenVersion: true },
  take:   500,
});

const out = users.map((u) => ({
  id:    u.id,
  role:  u.role,
  token: signAccessToken({ sub: u.id, role: u.role, tokenVersion: u.tokenVersion ?? 0 }),
}));

const byRole = out.reduce((a, u) => { a[u.role] = (a[u.role] || 0) + 1; return a; }, {});
console.error(`[mint] ${out.length} tokens`, JSON.stringify(byRole));
process.stdout.write(JSON.stringify(out));
await prisma.$disconnect();
