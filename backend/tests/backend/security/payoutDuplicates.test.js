/**
 * Seller payouts must be a single, unrepeatable action.
 *
 * The finding: model Payout carried no @@unique, so two rows could exist for the
 * same seller over the same settlement window — a double payout one retried
 * admin click or one duplicated cron run away. Real money, no way to notice
 * except by reading the ledger.
 *
 * Three layers are asserted here, deliberately including the DATABASE one: the
 * constraint is declared in schema.prisma and applied by `prisma db push`, so a
 * schema that was edited but never pushed looks identical in code review and
 * fails only in production. The first test talks to the database directly for
 * exactly that reason.
 */
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { createTestSeller, cleanupTestData, prisma } from '../../fixtures/setup.js';
import { generatePayoutForPeriod } from '../../../src/services/settlement.service.js';

const PERIOD_FROM = new Date('2026-01-01T00:00:00.000Z');
const PERIOD_TO = new Date('2026-01-31T23:59:59.000Z');

const sellerIds = [];

/** A seller with `amount` of settled sales inside the window. */
async function sellerWithSales(amount = 1000) {
  const seller = await createTestSeller();
  sellerIds.push(seller.user.id);
  await prisma.sellerLedgerEntry.create({
    data: {
      sellerId: seller.user.id,
      type: 'SALE',
      amount,
      balanceAfter: amount,
      createdAt: new Date('2026-01-15T00:00:00.000Z'),
      note: 'test sale',
    },
  });
  return seller.user.id;
}

afterAll(async () => {
  // Neither table is covered by cleanupTestData's cascade (sellerId is a loose
  // scalar, not a relation), so a leaked payout would silently net the NEXT
  // run's payable down to zero and read as a mystery "nothing payable".
  await prisma.payout.deleteMany({ where: { sellerId: { in: sellerIds } } });
  await prisma.sellerLedgerEntry.deleteMany({ where: { sellerId: { in: sellerIds } } });
  await cleanupTestData();
}, 30000);

describe('the database itself refuses a duplicate payout', () => {
  test('a second row for the same (seller, periodFrom, periodTo) violates the unique', async () => {
    const sellerId = await sellerWithSales();
    const row = {
      sellerId, amount: 100, status: 'PENDING', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO,
    };

    await prisma.payout.create({ data: row });

    // Asserted against the DB, not the Prisma schema file: `db push` is the
    // deploy path, so "declared" and "applied" are genuinely different states.
    let err;
    try { await prisma.payout.create({ data: { ...row, amount: 250 } }); }
    catch (e) { err = e; }

    expect(err).toBeInstanceOf(PrismaClientKnownRequestError);
    expect(err.code).toBe('P2002');

    expect(await prisma.payout.count({ where: { sellerId } })).toBe(1);
  });

  test('the same seller CAN be paid for a different window', async () => {
    const sellerId = await sellerWithSales();
    await prisma.payout.create({
      data: { sellerId, amount: 100, status: 'PENDING', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO },
    });
    await prisma.payout.create({
      data: {
        sellerId, amount: 100, status: 'PENDING',
        periodFrom: new Date('2026-02-01T00:00:00.000Z'),
        periodTo: new Date('2026-02-28T23:59:59.000Z'),
      },
    });
    // The constraint must bound repetition, not stop a seller ever being paid again.
    expect(await prisma.payout.count({ where: { sellerId } })).toBe(2);
  });
});

describe('generatePayoutForPeriod is idempotent per settlement window', () => {
  test('a sequential retry is refused as "nothing payable", not paid twice', async () => {
    const sellerId = await sellerWithSales(1000);

    const first = await generatePayoutForPeriod(sellerId, PERIOD_FROM, PERIOD_TO, null);
    expect(Number(first.payout.amount)).toBeGreaterThan(0);

    // The retry nets the already-raised payout out of the payable, so it never
    // reaches the constraint at all — this is the admin-double-click path.
    await expect(generatePayoutForPeriod(sellerId, PERIOD_FROM, PERIOD_TO, null))
      .rejects.toThrow(/nothing payable/i);

    expect(await prisma.payout.count({ where: { sellerId } })).toBe(1);
  });

  test('two concurrent generations produce exactly one payout, and the loser gets a 409', async () => {
    // The duplicated-cron case named in the finding. Both callers read
    // priorPayouts = 0 before either commits, so netting cannot help and the
    // unique constraint is the only thing left.
    const sellerId = await sellerWithSales(1000);

    const results = await Promise.allSettled([
      generatePayoutForPeriod(sellerId, PERIOD_FROM, PERIOD_TO, null),
      generatePayoutForPeriod(sellerId, PERIOD_FROM, PERIOD_TO, null),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.payout.count({ where: { sellerId } })).toBe(1);

    // A 500 here would read as a transient failure and invite the retry that
    // must not happen, so the refusal is explicit and client-safe.
    const [rejected] = results.filter((r) => r.status === 'rejected');
    expect(rejected.reason.statusCode).toBeGreaterThanOrEqual(400);
    expect(rejected.reason.statusCode).toBeLessThan(500);
    expect(rejected.reason.expose).toBe(true);
  });

  test('the losing generation leaves no orphan ledger entry behind', async () => {
    const sellerId = await sellerWithSales(1000);

    await Promise.allSettled([
      generatePayoutForPeriod(sellerId, PERIOD_FROM, PERIOD_TO, null),
      generatePayoutForPeriod(sellerId, PERIOD_FROM, PERIOD_TO, null),
    ]);

    // The payout row and its debit are written in one transaction, so a rolled
    // back payout must not leave the seller debited for money never sent.
    const debits = await prisma.sellerLedgerEntry.count({ where: { sellerId, type: 'PAYOUT' } });
    expect(debits).toBe(1);
  });
});
