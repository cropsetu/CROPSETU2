/**
 * Re-authentication of ESTABLISHED sockets (RT-02, second half).
 *
 * The handshake is the only place a socket's credentials are ever checked, and a
 * socket is not a request: once open it stays open. So a ban, a logout-all, a
 * KYC role flip or a DPDP erasure lands on the victim's NEXT handshake — which
 * for a phone left on a shelf may be tomorrow — while the live socket keeps
 * carrying AI and voice turns that spend provider money.
 *
 * Acceptance: a revoked user's live socket is closed within one sweep, a valid
 * user's is left strictly alone, and a sweep that cannot reach its dependencies
 * disconnects NOBODY. That last one is the important asymmetry — the handshake
 * fails closed, this fails open, because refusing a new connection is
 * recoverable in seconds and tearing down every live one is not.
 */
import { jest } from '@jest/globals';

const findMany = jest.fn();
const isAccessTokenDenylisted = jest.fn();
const isRedisHealthy = jest.fn();

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: { user: { findMany } },
}));
jest.unstable_mockModule('../../../src/config/redis.js', () => ({
  default: {},
  isRedisHealthy,
}));
jest.unstable_mockModule('../../../src/services/tokenDenylist.service.js', () => ({
  isAccessTokenDenylisted,
}));

const { sweepOnce, startSocketReauth, stopSocketReauth, reauthStats, _resetReauthStats } =
  await import('../../../src/socket/socketReauth.js');

/** A connected socket, as socket.io's namespace map would hold it. */
function sock(id, userId, { jti = `jti-${id}`, tv = 1 } = {}) {
  return {
    id,
    userId,
    data: { auth: { jti, tv } },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

/** A minimal `io` exposing Namespace.sockets as a Map, like socket.io 4.x. */
function fakeIo(sockets) {
  const map = new Map(sockets.map((s) => [s.id, s]));
  return { of: () => ({ sockets: map }) };
}

beforeEach(() => {
  findMany.mockReset();
  isAccessTokenDenylisted.mockReset().mockResolvedValue(false);
  isRedisHealthy.mockReset().mockReturnValue(true);
  _resetReauthStats();
  stopSocketReauth();
});

describe('who gets evicted', () => {
  it('closes the socket of a deactivated account', async () => {
    const s = sock('s1', 'u1');
    findMany.mockResolvedValue([{ id: 'u1', tokenVersion: 1, isActive: false }]);

    const res = await sweepOnce(fakeIo([s]));

    expect(res).toEqual({ checked: 1, evicted: 1 });
    expect(s.disconnect).toHaveBeenCalledWith(true);
    expect(s.emit).toHaveBeenCalledWith('error', expect.objectContaining({
      message: expect.stringMatching(/sign in again/i),
    }));
  });

  it('closes the socket of a user whose tokenVersion has moved on', async () => {
    // Role change, KYC flip, team scope change, logout-all.
    const s = sock('s1', 'u1', { tv: 1 });
    findMany.mockResolvedValue([{ id: 'u1', tokenVersion: 2, isActive: true }]);

    expect((await sweepOnce(fakeIo([s]))).evicted).toBe(1);
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });

  it('closes a socket whose access token was denylisted', async () => {
    const s = sock('s1', 'u1', { jti: 'revoked' });
    findMany.mockResolvedValue([{ id: 'u1', tokenVersion: 1, isActive: true }]);
    isAccessTokenDenylisted.mockImplementation(async (j) => j === 'revoked');

    expect((await sweepOnce(fakeIo([s]))).evicted).toBe(1);
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });

  it('closes a socket whose user row has disappeared entirely', async () => {
    // DPDP erasure. findMany returning nothing for an id we asked about IS the
    // answer, not an unknown.
    const s = sock('s1', 'gone');
    findMany.mockResolvedValue([]);

    expect((await sweepOnce(fakeIo([s]))).evicted).toBe(1);
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('who does not', () => {
  it('leaves a perfectly valid socket completely alone', async () => {
    const s = sock('s1', 'u1', { tv: 4 });
    findMany.mockResolvedValue([{ id: 'u1', tokenVersion: 4, isActive: true }]);

    expect((await sweepOnce(fakeIo([s])))).toEqual({ checked: 1, evicted: 0 });
    expect(s.disconnect).not.toHaveBeenCalled();
    expect(s.emit).not.toHaveBeenCalled();
  });

  it('evicts only the revoked user when others share the sweep', async () => {
    const ok1 = sock('s1', 'u1');
    const bad = sock('s2', 'u2');
    const ok2 = sock('s3', 'u3');
    findMany.mockResolvedValue([
      { id: 'u1', tokenVersion: 1, isActive: true },
      { id: 'u2', tokenVersion: 1, isActive: false },
      { id: 'u3', tokenVersion: 1, isActive: true },
    ]);

    expect((await sweepOnce(fakeIo([ok1, bad, ok2]))).evicted).toBe(1);
    expect(bad.disconnect).toHaveBeenCalled();
    expect(ok1.disconnect).not.toHaveBeenCalled();
    expect(ok2.disconnect).not.toHaveBeenCalled();
  });

  it('does nothing at all when nobody is connected', async () => {
    expect(await sweepOnce(fakeIo([]))).toEqual({ checked: 0, evicted: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('failing open — the asymmetry with the handshake', () => {
  it('disconnects NOBODY when the database lookup fails', async () => {
    // The handshake refuses a connection it cannot validate. This must not,
    // or one Postgres stall becomes a fleet-wide realtime outage.
    const s = sock('s1', 'u1');
    findMany.mockRejectedValue(new Error('pool timeout'));

    const res = await sweepOnce(fakeIo([s]));

    expect(res.skipped).toBe('db');
    expect(res.evicted).toBe(0);
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('still evicts on DB-backed grounds when Redis is down', async () => {
    // The denylist half is skipped, exactly as it is on the HTTP path; the
    // tokenVersion and isActive checks do not need Redis.
    isRedisHealthy.mockReturnValue(false);
    const s = sock('s1', 'u1');
    findMany.mockResolvedValue([{ id: 'u1', tokenVersion: 9, isActive: true }]);

    expect((await sweepOnce(fakeIo([s]))).evicted).toBe(1);
    expect(isAccessTokenDenylisted).not.toHaveBeenCalled();
  });

  it('continues the sweep when the denylist check itself throws', async () => {
    isAccessTokenDenylisted.mockRejectedValue(new Error('redis gone'));
    const s = sock('s1', 'u1');
    findMany.mockResolvedValue([{ id: 'u1', tokenVersion: 1, isActive: true }]);

    const res = await sweepOnce(fakeIo([s]));
    expect(res.evicted).toBe(0);       // no grounds without the denylist
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('survives a socket that dies while being evicted', async () => {
    const s = sock('s1', 'u1');
    s.disconnect.mockImplementation(() => { throw new Error('already gone'); });
    findMany.mockResolvedValue([{ id: 'u1', tokenVersion: 1, isActive: false }]);

    await expect(sweepOnce(fakeIo([s]))).resolves.toMatchObject({ evicted: 1 });
  });
});

describe('cost', () => {
  it('asks the database once per SWEEP, not once per socket', async () => {
    // Ten sockets, three users: one query naming three ids.
    const sockets = [
      sock('a', 'u1'), sock('b', 'u1'), sock('c', 'u1'), sock('d', 'u2'),
      sock('e', 'u2'), sock('f', 'u2'), sock('g', 'u3'), sock('h', 'u3'),
      sock('i', 'u3'), sock('j', 'u3'),
    ];
    findMany.mockResolvedValue([
      { id: 'u1', tokenVersion: 1, isActive: true },
      { id: 'u2', tokenVersion: 1, isActive: true },
      { id: 'u3', tokenVersion: 1, isActive: true },
    ]);

    await sweepOnce(fakeIo(sockets));

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.id.in.sort()).toEqual(['u1', 'u2', 'u3']);
  });

  it('ignores sockets that never authenticated', async () => {
    const anon = { id: 'x', data: {}, emit: jest.fn(), disconnect: jest.fn() };
    expect(await sweepOnce(fakeIo([anon]))).toEqual({ checked: 0, evicted: 0 });
  });
});

describe('lifecycle', () => {
  it('start is idempotent and stop really stops', () => {
    const io = fakeIo([]);
    startSocketReauth(io, { intervalMs: 60_000 });
    startSocketReauth(io, { intervalMs: 60_000 });
    expect(reauthStats().running).toBe(true);

    stopSocketReauth();
    expect(reauthStats().running).toBe(false);
  });

  it('counts what it has done, for the ops surface', async () => {
    const s = sock('s1', 'u1');
    findMany.mockResolvedValue([{ id: 'u1', tokenVersion: 1, isActive: false }]);
    await sweepOnce(fakeIo([s]));
    expect(reauthStats()).toMatchObject({ sweeps: 1, evictedSinceBoot: 1 });
  });
});
