/**
 * Refresh-token rotation must be all-or-nothing.
 *
 * The claim (stamping `rotatedAt`) and the mint (creating the successor) used to
 * be two separate statements. If the mint failed — a pool timeout, a stalled
 * primary — the presented token was left SPENT with no successor in existence,
 * so the client could never recover: every later attempt replayed an
 * already-rotated token, which is indistinguishable from theft, so the family
 * was burned and a HIGH-severity ACCOUNT_TAKEOVER incident filed for a farmer
 * whose only mistake was a bad moment on the network.
 *
 * Wrapping the pair in one transaction closes that window: a failed mint rolls
 * the claim back and the token stays usable.
 *
 * The reuse verdict itself is deliberately UNCHANGED — replaying a spent token
 * still burns the lineage. A "rotation leeway" that recovers from a lost
 * response is the standard mitigation for the residual case, but it weakens the
 * property asserted in tests/backend/api/auth.api.test.js, so it is a decision
 * for the owner rather than a silent change. The client avoids provoking it
 * instead (shared/services/api.js, `mayBeSpent`).
 */
import { jest } from '@jest/globals';

const findFirst  = jest.fn();
const updateMany = jest.fn();
const create     = jest.fn();
const deleteMany = jest.fn();
const del        = jest.fn();

// $transaction takes a callback and hands it a client. Passing a distinct mock
// surface through lets a test prove both halves ran on the TRANSACTIONAL client
// rather than escaping to the bare one.
const txClient = { refreshToken: { updateMany, create, findFirst, deleteMany, delete: del } };
const $transaction = jest.fn(async (fn) => fn(txClient));

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: {
    refreshToken: { findFirst, updateMany, create, deleteMany, delete: del },
    $transaction,
  },
}));

const { rotateRefreshToken } = await import('../../../src/utils/jwt.js');

const FAMILY = 'fam-1';
const USER   = 'user-1';

function tokenRow(over = {}) {
  return {
    id: 'row-1',
    userId: USER,
    familyId: FAMILY,
    rotatedAt: null,
    createdAt: new Date(Date.now() - 1_000),
    sessionStartedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
  create.mockResolvedValue({});
  deleteMany.mockResolvedValue({ count: 1 });
});

describe('rotation is atomic', () => {
  test('claim and mint run inside a single transaction', async () => {
    findFirst.mockResolvedValueOnce(tokenRow());

    const res = await rotateRefreshToken('raw-token', USER);

    expect(res.status).toBe('ok');
    expect(typeof res.refreshToken).toBe('string');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('a failed mint does not leave the token spent', async () => {
    findFirst.mockResolvedValueOnce(tokenRow());
    create.mockRejectedValueOnce(new Error('pool timeout'));

    // The transaction rejects, so the rotatedAt stamp rolls back with it. The
    // caller sees the failure rather than a token that is silently unusable.
    await expect(rotateRefreshToken('raw-token', USER)).rejects.toThrow(/pool timeout/i);
    expect(deleteMany).not.toHaveBeenCalled(); // nothing burned
  });

  test('the successor inherits the original session start', async () => {
    const started = new Date(Date.now() - 5 * 86_400_000);
    findFirst.mockResolvedValueOnce(tokenRow({ sessionStartedAt: started }));

    await rotateRefreshToken('raw-token', USER);

    // Anchoring the absolute cap to the first login is what stops an active
    // session from renewing itself forever.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sessionStartedAt: started, familyId: FAMILY }),
      }),
    );
  });
});

describe('reuse detection is unchanged', () => {
  test('replaying a spent token burns the whole family', async () => {
    findFirst.mockResolvedValueOnce(tokenRow({ rotatedAt: new Date(Date.now() - 5_000) }));

    const res = await rotateRefreshToken('raw-token', USER);

    expect(res.status).toBe('reuse');
    expect(res.familyId).toBe(FAMILY);
    expect(deleteMany).toHaveBeenCalledWith({ where: { familyId: FAMILY } });
  });

  test('losing a concurrent claim is treated as reuse', async () => {
    findFirst.mockResolvedValueOnce(tokenRow());
    updateMany.mockResolvedValueOnce({ count: 0 }); // another request won the race

    const res = await rotateRefreshToken('raw-token', USER);

    expect(res.status).toBe('reuse');
    expect(deleteMany).toHaveBeenCalled();
  });
});

describe('other verdicts', () => {
  test('unknown token is invalid, and nothing is burned', async () => {
    findFirst.mockResolvedValueOnce(null);

    expect((await rotateRefreshToken('nope', USER)).status).toBe('invalid');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  test('an idle-expired token burns the family', async () => {
    findFirst.mockResolvedValueOnce(tokenRow({ expiresAt: new Date(Date.now() - 1_000) }));

    const res = await rotateRefreshToken('raw-token', USER);
    expect(res.status).toBe('expired');
    expect(deleteMany).toHaveBeenCalled();
  });

  test('a session past its absolute cap burns the family', async () => {
    findFirst.mockResolvedValueOnce(
      tokenRow({ sessionStartedAt: new Date(Date.now() - 400 * 86_400_000) }),
    );

    const res = await rotateRefreshToken('raw-token', USER);
    expect(res.status).toBe('expired');
    expect(deleteMany).toHaveBeenCalled();
  });
});
