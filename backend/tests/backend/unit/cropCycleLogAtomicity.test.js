/**
 * Every crop-cycle field log appends ATOMICALLY (claude.md §71 sweep, MyFarm).
 *
 * Four of the eight logs used the atomic helper and four appended with
 * `[...existing, newEntry]` — a read, a spread and a write. Measured against a
 * real database: ten concurrent fertiliser entries stored FIVE. Half of what a
 * farmer typed, gone, with no error.
 *
 * A farmer standing in a field on a weak connection, tapping again because the
 * first attempt looked like it had not worked, is the ordinary case here rather
 * than an edge one — so the window was wide open in exactly the situation the
 * feature exists for. The read-modify-write versions also had no cap, so those
 * four arrays could grow without bound while the other four were capped.
 */
import { readFileSync } from 'fs';

const service = readFileSync(new URL('../../../src/services/cropCycle.service.js', import.meta.url), 'utf8');
const jsonLog = readFileSync(new URL('../../../src/utils/jsonLog.js', import.meta.url), 'utf8');

const FIELD_LOGS = ['fertilizersUsed', 'pesticidesUsed', 'irrigationLogs', 'observedEvents'];
const MONEY_LOGS = ['activities', 'laborLogs', 'expenseLogs', 'incomeLogs'];

describe('no log is appended by read-modify-write', () => {
  test('the spread-and-write pattern is gone entirely', () => {
    // The single assertion that would have caught this: any occurrence means
    // some log can lose a farmer's entry under concurrency.
    expect(service).not.toMatch(/\[\.\.\.existing,\s*newEntry\]/);
  });

  test.each([...FIELD_LOGS, ...MONEY_LOGS])('%s goes through appendJsonLog', (col) => {
    expect(service).toMatch(new RegExp(`appendJsonLog\\(cycleId, farmerId, "${col}"`));
  });
});

describe('every log column is capped', () => {
  test.each([...FIELD_LOGS, ...MONEY_LOGS])('%s has a cap', (col) => {
    // appendJsonLog refuses a column it has no spec for, so an uncapped column
    // is not merely unbounded — it would throw. The cap and the atomicity are
    // the same change.
    expect(jsonLog).toMatch(new RegExp(`${col}:\\s*\\{ cap: \\d+`));
  });
});

describe('the append contract is preserved', () => {
  test.each(FIELD_LOGS)('%s distinguishes "full" from "not yours"', (col) => {
    // 409 and 404 need very different UI: "your log is full" is actionable,
    // "no such cycle" is not.
    const fn = service.slice(service.indexOf(`appendJsonLog(cycleId, farmerId, "${col}"`));
    expect(fn.slice(0, 200)).toMatch(/r\.reason === "full" \? \{ error: "full" \} : null/);
  });

  test('observed events still refresh insights on a severe entry', () => {
    // This function did extra work after its write; converting it must not have
    // dropped that.
    const fn = service.slice(service.indexOf('export async function addObservedEvent'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/refreshInsights\(cycleId, farmerId\)/);
  });
});
