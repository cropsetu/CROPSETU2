/**
 * The monthly free-credit refill must grant a month's credits once (claude.md §53).
 *
 * getOrCreateCredits runs on EVERY AI request. The refill used to be a
 * read-then-write — `if (now >= credit.freeRefillDate) { update(...) }` — so on
 * the first of the month every request that arrived before the first one
 * committed read the same stale date, all passed the check, and all
 * incremented. Opening the app with three screens each firing an AI call
 * granted the month three times over. Measured against a real database:
 * ten concurrent requests produced 1000 credits instead of 100.
 *
 * The fix puts freeRefillDate in the WHERE, so the date itself is the lock.
 */
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../../../src/services/aiCredit.service.js', import.meta.url), 'utf8');
const refill = src.slice(src.indexOf('const now = new Date();'), src.indexOf('return credit;'));

describe('the refill is a compare-and-set', () => {
  test('the date is part of the WHERE, not only the if', () => {
    // This is the whole fix. Without the predicate, every concurrent caller's
    // update matches and every one of them increments.
    expect(refill).toMatch(/where:\s*\{\s*userId,\s*freeRefillDate:\s*\{\s*lte:\s*now\s*\}\s*\}/);
  });

  test('uses updateMany, so a lost race reports zero rows instead of throwing', () => {
    // `update` on a compound where would throw when it matches nothing, turning
    // a perfectly ordinary lost race into a failed AI request.
    expect(refill).toMatch(/updateMany\(/);
    expect(refill).toMatch(/const \{ count \} =/);
  });

  test('moves the date forward in the same statement that grants', () => {
    // Granting and re-dating have to be one write, or the window reopens
    // between them.
    const stmt = refill.slice(refill.indexOf('updateMany('), refill.indexOf('credit = await'));
    expect(stmt).toMatch(/balance:\s*\{\s*increment:\s*grant\s*\}/);
    expect(stmt).toMatch(/freeRefillDate:\s*getNextRefillDate\(\)/);
  });

  test('only the winner writes a ledger row', () => {
    // Logging on a lost race would put a grant in the ledger that never reached
    // a balance — the ledger is the thing an ops query would trust.
    const idx = refill.indexOf('aICreditTransaction.create');
    const guard = refill.lastIndexOf('if (count > 0)', idx);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(idx);
  });

  test('re-reads the row after the conditional write', () => {
    // updateMany returns a count, not the row, and the caller needs the balance.
    expect(refill).toMatch(/credit = await prisma\.aICredit\.findUnique/);
  });
});
