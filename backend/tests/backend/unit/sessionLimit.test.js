/**
 * Unit tests for the concurrent-session cap (enforceSessionLimit).
 *
 * A "session" is a refresh-token lineage (one active head per family). Creating
 * sessions beyond the cap must evict the OLDEST, revoking their whole lineage.
 */
import { enforceSessionLimit } from '../../../src/utils/jwt.js';
import { ENV } from '../../../src/config/env.js';
import { prisma, createTestUser, cleanupTestData } from '../../fixtures/setup.js';

afterAll(async () => {
  await cleanupTestData();
});

async function seedSession(userId, idx) {
  // Distinct, increasing createdAt so "oldest" is unambiguous (idx 0 = oldest).
  return prisma.refreshToken.create({
    data: {
      token:     `sess-${userId}-${idx}`,
      userId,
      familyId:  `fam-${userId}-${idx}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(1_700_000_000_000 + idx * 1000),
    },
    select: { familyId: true },
  });
}

test('evicts the oldest sessions when the cap is exceeded', async () => {
  const { user } = await createTestUser();
  const cap = ENV.MAX_CONCURRENT_SESSIONS;
  const total = cap + 2;

  for (let i = 0; i < total; i++) await seedSession(user.id, i);

  // Pre-condition: all sessions are active heads.
  const before = await prisma.refreshToken.count({ where: { userId: user.id, rotatedAt: null } });
  expect(before).toBe(total);

  const evicted = await enforceSessionLimit(user.id);
  expect(evicted).toBe(2);

  const remaining = await prisma.refreshToken.findMany({
    where: { userId: user.id },
    select: { familyId: true },
  });
  expect(remaining).toHaveLength(cap);

  const fams = remaining.map((r) => r.familyId);
  // The two oldest lineages are gone…
  expect(fams).not.toContain(`fam-${user.id}-0`);
  expect(fams).not.toContain(`fam-${user.id}-1`);
  // …and the newest survive.
  expect(fams).toContain(`fam-${user.id}-${total - 1}`);
});

test('does nothing when under the cap', async () => {
  const { user } = await createTestUser();
  await seedSession(user.id, 0);
  const evicted = await enforceSessionLimit(user.id);
  expect(evicted).toBe(0);
});

test('a cap of 0 means unlimited (no eviction)', async () => {
  const { user } = await createTestUser();
  for (let i = 0; i < 3; i++) await seedSession(user.id, i);
  const evicted = await enforceSessionLimit(user.id, 0);
  expect(evicted).toBe(0);
  const count = await prisma.refreshToken.count({ where: { userId: user.id } });
  expect(count).toBe(3);
});
