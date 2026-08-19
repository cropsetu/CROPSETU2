/**
 * Referential integrity on the FK-less money rails.
 *
 * SellerLedgerEntry, Payout and Dispute point at users through bare String
 * scalars with no foreign key — a deliberate trade so the models could be added
 * additively and `prisma db push` stays the deploy path. The database therefore
 * cannot refuse a payout to a user id that never existed, nor stop a user
 * deletion orphaning one that did.
 *
 * Both halves of the replacement guarantee are asserted here, because each
 * covers a case the other cannot: write-time validation stops NEW orphans, and
 * only the sweep finds rows orphaned AFTER they were written.
 */
import { createTestUser, createTestSeller, cleanupTestData, prisma } from '../../fixtures/setup.js';
import {
  assertUsersExist, findOrphanedReferences,
} from '../../../src/services/referentialIntegrity.service.js';
import { generatePayoutForPeriod } from '../../../src/services/settlement.service.js';

const GHOST = '00000000-0000-4000-8000-000000000000';
const PERIOD_FROM = new Date('2026-03-01T00:00:00.000Z');
const PERIOD_TO = new Date('2026-03-31T23:59:59.000Z');

const touched = [];

afterAll(async () => {
  await prisma.payout.deleteMany({ where: { sellerId: { in: [...touched, GHOST] } } });
  await prisma.sellerLedgerEntry.deleteMany({ where: { sellerId: { in: [...touched, GHOST] } } });
  await prisma.dispute.deleteMany({ where: { raisedBy: { in: [...touched, GHOST] } } });
  await cleanupTestData();
}, 30000);

describe('assertUsersExist — the write-time half', () => {
  test('passes for real users', async () => {
    const user = await createTestUser();
    touched.push(user.user.id);
    await expect(assertUsersExist([user.user.id], 'payout')).resolves.toBeUndefined();
  });

  test('null and undefined references are skipped, so optional columns need no special case', async () => {
    await expect(assertUsersExist([null, undefined], 'dispute')).resolves.toBeUndefined();
    await expect(assertUsersExist([], 'dispute')).resolves.toBeUndefined();
  });

  test('a missing user is a client-safe 400 naming what could not be written', async () => {
    const err = await assertUsersExist([GHOST], 'payout').catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.expose).toBe(true);
    expect(err.code).toBe('UNKNOWN_USER_REFERENCE');
    expect(err.missing).toEqual([GHOST]);
    expect(err.message).toMatch(/payout/i);
  });

  test('one bad id among several is still refused', async () => {
    const user = await createTestUser();
    touched.push(user.user.id);
    await expect(assertUsersExist([user.user.id, GHOST], 'dispute')).rejects.toMatchObject({
      statusCode: 400, missing: [GHOST],
    });
  });
});

describe('the payout path refuses an unknown seller', () => {
  test('no payout row is created for a user id that does not exist', async () => {
    // Without this the ledger would carry a balance for a phantom seller, and the
    // money would be owed to nobody.
    await expect(generatePayoutForPeriod(GHOST, PERIOD_FROM, PERIOD_TO, null))
      .rejects.toMatchObject({ statusCode: 400, expose: true });

    expect(await prisma.payout.count({ where: { sellerId: GHOST } })).toBe(0);
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: GHOST } })).toBe(0);
  });
});

describe('findOrphanedReferences — the half write-time checks cannot cover', () => {
  test('a payout orphaned by a later user deletion is reported', async () => {
    const seller = await createTestSeller();
    const sellerId = seller.user.id;
    touched.push(sellerId);

    await prisma.payout.create({
      data: { sellerId, amount: 500, status: 'PENDING', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO },
    });
    await prisma.sellerLedgerEntry.create({
      data: { sellerId, type: 'SALE', amount: 500, balanceAfter: 500 },
    });

    // Clean at first: the row was written while the seller existed, which is
    // exactly why write-time validation cannot catch what happens next.
    const before = await findOrphanedReferences();
    expect(before.byModel.find((m) => m.orphans?.some((o) => o.userId === sellerId))).toBeUndefined();

    await prisma.sellerProfile.deleteMany({ where: { userId: sellerId } });
    await prisma.user.delete({ where: { id: sellerId } });

    const after = await findOrphanedReferences();
    const payoutRow = after.byModel.find((m) => m.model === 'Payout' && m.column === 'sellerId');
    expect(payoutRow).toBeDefined();
    expect(payoutRow.orphans.map((o) => o.userId)).toContain(sellerId);

    const ledgerRow = after.byModel.find((m) => m.model === 'SellerLedgerEntry' && m.column === 'sellerId');
    expect(ledgerRow.orphans.map((o) => o.userId)).toContain(sellerId);

    expect(after.total).toBeGreaterThanOrEqual(2);
  });

  test('the report never deletes what it finds', async () => {
    // An orphan may be an accounting problem or an erasure request honoured
    // correctly. Deleting it automatically destroys the evidence needed to tell
    // those apart, so the sweep is strictly read-only.
    const beforeCount = await prisma.payout.count();
    await findOrphanedReferences();
    expect(await prisma.payout.count()).toBe(beforeCount);
  });

  test('rows are counted per missing user, not per row scanned', async () => {
    const seller = await createTestSeller();
    const sellerId = seller.user.id;
    touched.push(sellerId);

    for (const amount of [10, 20, 30]) {
      await prisma.sellerLedgerEntry.create({
        data: { sellerId, type: 'ADJUSTMENT', amount, balanceAfter: amount },
      });
    }
    await prisma.sellerProfile.deleteMany({ where: { userId: sellerId } });
    await prisma.user.delete({ where: { id: sellerId } });

    const report = await findOrphanedReferences();
    const row = report.byModel.find((m) => m.model === 'SellerLedgerEntry' && m.column === 'sellerId');
    const orphan = row.orphans.find((o) => o.userId === sellerId);
    // One missing user, three rows behind it — an operator needs both numbers.
    expect(orphan.rows).toBe(3);
  });
});
