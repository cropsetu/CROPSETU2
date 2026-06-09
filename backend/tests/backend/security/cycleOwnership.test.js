/**
 * Authorization tests for the crop-cycle ownership guard (requireCycleOwner).
 *
 * Every /cycles/:cycleId* route (read, update, delete, sub-resource writes) runs
 * this guard. Acceptance for this finding: a request targeting another farmer's
 * cycle is rejected with 403 — not silently allowed, and not leaked as 404/500.
 *
 * prisma is module-mocked so the guard can be exercised without a database.
 */
import { jest } from '@jest/globals';

const findUnique = jest.fn();
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { farmCropCycle: { findUnique } },
}));

// Import AFTER the mock is registered so the route module binds to the fake prisma.
const { requireCycleOwner } = await import('../../../src/routes/farmCropCycle.routes.js');

function mockRes() {
  const res = { statusCode: null, body: null, req: { id: 'req-1' } };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const VALID_ID = '11111111-1111-1111-1111-111111111111';
const run = async (cycleId, userId) => {
  const req = { params: { cycleId }, user: { id: userId } };
  const res = mockRes();
  let nextErr; let nexted = false;
  await requireCycleOwner(req, res, (err) => { nexted = true; nextErr = err; });
  return { res, nexted, nextErr };
};

beforeEach(() => findUnique.mockReset());

describe('requireCycleOwner', () => {
  test("another farmer's cycle → 403, handler never runs", async () => {
    findUnique.mockResolvedValue({ farmerId: 'owner-1' });
    const { res, nexted } = await run(VALID_ID, 'attacker-2');
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(nexted).toBe(false);
  });

  test('the owning farmer → next() (handler proceeds)', async () => {
    findUnique.mockResolvedValue({ farmerId: 'owner-1' });
    const { res, nexted, nextErr } = await run(VALID_ID, 'owner-1');
    expect(nexted).toBe(true);
    expect(nextErr).toBeUndefined();
    expect(res.statusCode).toBeNull();
  });

  test('non-existent cycle → 404 (not 403, not leaked)', async () => {
    findUnique.mockResolvedValue(null);
    const { res, nexted } = await run(VALID_ID, 'someone');
    expect(res.statusCode).toBe(404);
    expect(nexted).toBe(false);
  });

  test('malformed id is deferred to per-route validation (next, no DB hit)', async () => {
    const { res, nexted } = await run('not-a-uuid', 'someone');
    expect(nexted).toBe(true);
    expect(res.statusCode).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  test('DB error is handed to the error handler, never silently allowed', async () => {
    findUnique.mockRejectedValue(new Error('connection lost'));
    const { res, nexted, nextErr } = await run(VALID_ID, 'someone');
    expect(nexted).toBe(true);          // next(err) was called…
    expect(nextErr).toBeInstanceOf(Error); // …with the error (not next() with no arg)
    expect(res.statusCode).toBeNull();  // request was NOT allowed through to a handler
  });
});
