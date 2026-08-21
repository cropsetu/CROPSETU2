/**
 * `authenticate()` must not answer 401 when the DATABASE is what failed.
 *
 * The middleware validates every request against the live account, so a Prisma
 * outage makes it impossible to tell a good token from a revoked one. Failing
 * closed is right; saying "401" is not. 401 is the client's cue to
 * refresh-and-replay (shared/services/api.js), and a failed refresh used to
 * destroy the refresh token — so a brief Postgres stall became: every in-flight
 * request 401s, every client refreshes, each refresh costs five more statements
 * against the database that is already failing, the refresh fails too, and the
 * session is wiped. Thousands of farmers back at SMS OTP from one transient
 * fault.
 *
 * 503 is the honest answer — neither authorised nor rejected, because we could
 * not tell — and it is the status the client must NOT treat as a dead session.
 *
 * prisma is module-mocked (as in refundAbuse.service.test.js) so the failure is
 * injectable without a database.
 */
import { jest } from '@jest/globals';

const findUnique = jest.fn();
jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { user: { findUnique } },
}));

const denylisted = jest.fn();
jest.unstable_mockModule('../../../src/services/tokenDenylist.service.js', () => ({
  isAccessTokenDenylisted: denylisted,
}));

const { authenticate } = await import('../../../src/middleware/auth.js');
const { signAccessToken } = await import('../../../src/utils/jwt.js');

/** Capture whatever the middleware sends, without an HTTP server. */
function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function reqWith(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

/** Run the middleware and report which exit it took. */
async function run(token) {
  const res = fakeRes();
  let nexted = false;
  await authenticate(reqWith(token), res, () => { nexted = true; });
  return { res, nexted };
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
let token;

beforeAll(() => {
  token = signAccessToken({ sub: USER_ID, role: 'FARMER', tokenVersion: 0 });
});

beforeEach(() => {
  findUnique.mockReset();
  denylisted.mockReset().mockResolvedValue(false);
});

describe('authenticate — database unavailable', () => {
  test('answers 503, not 401, when the users lookup throws', async () => {
    findUnique.mockRejectedValue(new Error('Connection pool timeout'));
    const { res, nexted } = await run(token);

    expect(res.statusCode).toBe(503);
    expect(nexted).toBe(false); // still fails closed — the request never runs
  });

  test('sets a Retry-After long enough for a failover to finish', async () => {
    findUnique.mockRejectedValue(new Error('ECONNREFUSED'));
    const { res } = await run(token);

    const after = Number(res.headers['Retry-After']);
    expect(Number.isInteger(after)).toBe(true);
    expect(after).toBeGreaterThanOrEqual(5); // a 2 s retry is certain to fail again
    expect(after).toBeLessThanOrEqual(15);
  });

  test('Retry-After is jittered, so clients do not return in lockstep', async () => {
    findUnique.mockRejectedValue(new Error('ECONNREFUSED'));

    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const { res } = await run(token);
      seen.add(res.headers['Retry-After']);
    }
    // A constant would schedule every client that hit the stall to come back at
    // the same instant — the thundering herd this status exists to avoid.
    expect(seen.size).toBeGreaterThan(1);
  });

  test('the message does not blame the token', async () => {
    findUnique.mockRejectedValue(new Error('boom'));
    const { res } = await run(token);

    const message = res.body?.error?.message ?? '';
    expect(message).toMatch(/unavailable/i);
    expect(message).not.toMatch(/sign in|expired|invalid/i);
  });
});

describe('authenticate — genuine rejections still 401', () => {
  test('deactivated account', async () => {
    findUnique.mockResolvedValue({ tokenVersion: 0, isActive: false });
    const { res, nexted } = await run(token);

    expect(res.statusCode).toBe(401);
    expect(nexted).toBe(false);
  });

  test('missing account', async () => {
    findUnique.mockResolvedValue(null);
    const { res } = await run(token);
    expect(res.statusCode).toBe(401);
  });

  test('tokenVersion bumped behind the token', async () => {
    findUnique.mockResolvedValue({ tokenVersion: 3, isActive: true });
    const { res } = await run(token);
    expect(res.statusCode).toBe(401);
  });

  test('denylisted jti short-circuits before the database is touched', async () => {
    denylisted.mockResolvedValue(true);
    const { res } = await run(token);

    expect(res.statusCode).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  test('malformed token', async () => {
    const { res } = await run('not-a-jwt');
    expect(res.statusCode).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('authenticate — happy path is unchanged', () => {
  test('valid token and live account calls next()', async () => {
    findUnique.mockResolvedValue({ tokenVersion: 0, isActive: true });
    const { res, nexted } = await run(token);

    expect(nexted).toBe(true);
    expect(res.statusCode).toBeNull();
  });
});
