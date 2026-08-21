/**
 * Socket.IO handshake authentication (RT-02).
 *
 * The handshake used to verify the JWT SIGNATURE and nothing else, while the
 * HTTP path (middleware/auth.js) additionally checked the Redis jti denylist,
 * `isActive` and `tokenVersion`. A banned user, a logged-out user, or one whose
 * tokenVersion had been bumped could therefore still open a socket — and sockets
 * carry AI and voice turns that spend provider money, not only chat.
 *
 * Acceptance: the handshake enforces everything the HTTP middleware enforces,
 * AND distinguishes "your token is no good" from "we could not tell", because
 * the client's reaction to those two must differ. Answering the second like the
 * first turns one Postgres stall into a fleet-wide logout — the same incident
 * the HTTP path's 503-not-401 answer exists to prevent.
 */
import { jest } from '@jest/globals';

const findUnique = jest.fn();
const verifyAccessToken = jest.fn();
const isAccessTokenDenylisted = jest.fn();

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { user: { findUnique, update: jest.fn().mockResolvedValue({}) } },
}));
jest.unstable_mockModule('../../../src/utils/jwt.js', () => ({ verifyAccessToken }));
jest.unstable_mockModule('../../../src/services/tokenDenylist.service.js', () => ({
  isAccessTokenDenylisted,
}));

const { registerChatSocket, SOCKET_AUTH_ERRORS } =
  await import('../../../src/socket/chat.socket.js');

const GOOD = { sub: 'user-1', jti: 'jti-1', tv: 3, role: 'FARMER' };

/** Drive the registered io.use middleware once and report what it decided. */
async function handshake(auth = { token: 'a.b.c' }) {
  let middleware;
  registerChatSocket({
    use: (fn) => { middleware = fn; },
    on: () => {},
    to: () => ({ emit: () => {} }),
  });

  const socket = { handshake: { auth }, data: {} };
  let error;
  let passed = false;
  await middleware(socket, (err) => { if (err) error = err; else passed = true; });
  return { socket, error, passed };
}

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ tokenVersion: 3, isActive: true });
  verifyAccessToken.mockReset().mockReturnValue({ ...GOOD });
  isAccessTokenDenylisted.mockReset().mockResolvedValue(false);
});

describe('handshake — the checks HTTP already made', () => {
  it('admits a token that passes every check', async () => {
    const { passed, error, socket } = await handshake();
    expect(error).toBeUndefined();
    expect(passed).toBe(true);
    expect(socket.userId).toBe('user-1');
  });

  it('refuses a request with no token at all', async () => {
    const { error, passed } = await handshake({});
    expect(passed).toBe(false);
    expect(error.message).toBe(SOCKET_AUTH_ERRORS.MISSING);
    expect(findUnique).not.toHaveBeenCalled(); // no DB work for an anonymous probe
  });

  it('refuses a token whose signature does not verify', async () => {
    verifyAccessToken.mockImplementation(() => { throw new Error('bad sig'); });
    const { error } = await handshake();
    expect(error.message).toBe(SOCKET_AUTH_ERRORS.INVALID);
    expect(isAccessTokenDenylisted).not.toHaveBeenCalled();
  });

  it('refuses a verified token carrying no usable subject', async () => {
    verifyAccessToken.mockReturnValue({ jti: 'j', tv: 0 });
    const { error } = await handshake();
    expect(error.message).toBe(SOCKET_AUTH_ERRORS.INVALID);
    // Would otherwise reach Prisma with an undefined id and 500 instead.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('refuses a DEACTIVATED account — the ban now reaches sockets', async () => {
    findUnique.mockResolvedValue({ tokenVersion: 3, isActive: false });
    const { error, passed } = await handshake();
    expect(passed).toBe(false);
    expect(error.message).toBe(SOCKET_AUTH_ERRORS.INVALID);
  });

  it('refuses a token for a user that no longer exists', async () => {
    findUnique.mockResolvedValue(null);
    const { error } = await handshake();
    expect(error.message).toBe(SOCKET_AUTH_ERRORS.INVALID);
  });
});

describe('handshake — stale rather than dead', () => {
  it('refuses a bumped tokenVersion as STALE, not INVALID', async () => {
    // Role change, KYC flip, team scope change. The session is alive; this
    // particular token is behind. Telling the client "invalid" would make it
    // give up on a session it could have renewed.
    findUnique.mockResolvedValue({ tokenVersion: 4, isActive: true });
    const { error, passed } = await handshake();
    expect(passed).toBe(false);
    expect(error.message).toBe(SOCKET_AUTH_ERRORS.STALE);
  });

  it('refuses a denylisted jti as STALE', async () => {
    // Logging out one device revokes that access token while the refresh
    // lineage survives, so "re-mint and come back" is the honest instruction.
    // A client whose refresh genuinely fails stops anyway.
    isAccessTokenDenylisted.mockResolvedValue(true);
    const { error } = await handshake();
    expect(error.message).toBe(SOCKET_AUTH_ERRORS.STALE);
    expect(findUnique).not.toHaveBeenCalled(); // short-circuits before the DB, like HTTP
  });

  it('checks the denylist BEFORE the database, as the HTTP path does', async () => {
    isAccessTokenDenylisted.mockResolvedValue(true);
    await handshake();
    expect(isAccessTokenDenylisted).toHaveBeenCalledWith('jti-1');
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('handshake — a failed lookup is not a verdict', () => {
  it('answers UNAVAILABLE when the database lookup throws', async () => {
    findUnique.mockRejectedValue(new Error('pool timeout'));
    const { error, passed } = await handshake();
    expect(passed).toBe(false);
    // NOT one of the auth-failure strings: the client must retry rather than
    // destroy a session over a Postgres stall.
    expect(error.message).toBe(SOCKET_AUTH_ERRORS.UNAVAILABLE);
    expect(error.message).not.toBe(SOCKET_AUTH_ERRORS.INVALID);
    expect(error.message).not.toBe(SOCKET_AUTH_ERRORS.STALE);
  });

  it('still refuses the connection — failing closed on the socket itself', async () => {
    findUnique.mockRejectedValue(new Error('pool timeout'));
    const { socket, passed } = await handshake();
    expect(passed).toBe(false);
    expect(socket.userId).toBeUndefined();
  });

  it('fails OPEN on the denylist when Redis is down, exactly as HTTP does', async () => {
    // tokenDenylist.service.js swallows Redis errors and resolves false. The
    // tokenVersion and isActive checks are DB-backed and still apply, so this
    // is the same hole HTTP already has — not a new one.
    isAccessTokenDenylisted.mockResolvedValue(false);
    const { passed } = await handshake();
    expect(passed).toBe(true);
  });
});

describe('the reason strings are a client contract', () => {
  it('keeps the two the client already knew, and adds two more', () => {
    expect(SOCKET_AUTH_ERRORS.MISSING).toBe('Authentication required');
    expect(SOCKET_AUTH_ERRORS.INVALID).toBe('Invalid token');
    expect(SOCKET_AUTH_ERRORS.STALE).toBe('Token stale');
    expect(SOCKET_AUTH_ERRORS.UNAVAILABLE).toBe('Authentication unavailable');
  });

  it('stashes the token identity for the periodic re-check', async () => {
    const { socket } = await handshake();
    expect(socket.data.auth).toEqual({ jti: 'jti-1', tv: 3 });
  });
});
