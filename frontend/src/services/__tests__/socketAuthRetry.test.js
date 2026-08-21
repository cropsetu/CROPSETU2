/**
 * What the socket client does when the server refuses its handshake.
 *
 * The handshake now enforces everything the HTTP path does — jti denylist,
 * isActive, tokenVersion — which means it can refuse a token that has NOT
 * expired. That is the case this file exists for.
 *
 * Before this change the rejection handler called getValidAccessToken, which
 * returns the CURRENT token untouched while it is more than 30 s from expiry.
 * So on a tokenVersion bump (role change, KYC flip, team scope change) it got
 * the same refused token back, read it as "session alive", and reconnected with
 * it — every 1–5 s, for the remaining fifteen minutes of the token's life, with
 * `reconnectionAttempts: Infinity`. Hardening the handshake without fixing this
 * would have turned every one of those attempts into a Redis read plus a
 * database query: a self-inflicted load amplifier, and the exact opposite of
 * what the hardening is for.
 */
// `mock`-prefixed so jest's hoisting of the factories can reference them.
const mockGetValidAccessToken = jest.fn();
const mockForceRefreshAccessToken = jest.fn();
const mockSockets = [];

jest.mock('@cropsetu/shared/services/api', () => ({
  getValidAccessToken: (...a) => mockGetValidAccessToken(...a),
  forceRefreshAccessToken: (...a) => mockForceRefreshAccessToken(...a),
}));

// socket.js reads SOCKET_URL from the shared config, which imports react-native
// and expo-constants. This jest config is deliberately the light one — node
// environment, no jest-expo preset — so the config module is stubbed rather than
// dragging a React Native runtime into a test about retry logic.
jest.mock('@cropsetu/shared/constants/config', () => ({
  SOCKET_URL: 'http://localhost:3001',
  API_BASE_URL: 'http://localhost:3001/api/v1',
}));

jest.mock('socket.io-client', () => {
  const { EventEmitter: EE } = require('events');
  return {
    io: () => {
      const s = new EE();
      s.connected = false;
      s.io = { opts: { reconnection: true } };
      s.disconnect = jest.fn();
      // Connect on the next tick. Without this every case waits out
      // connectSocket's 2 s slow-connect fallback, which would add ~14 s to a
      // suite that currently runs in half of one.
      setImmediate(() => { s.connected = true; s.emit('connect'); });
      mockSockets.push(s);
      return s;
    },
  };
});

const { connectSocket, resetSocket, getSocket } = require('@cropsetu/shared/services/socket');

/** Open a socket, then deliver one `connect_error` and let handlers settle. */
async function rejectWith(message) {
  mockGetValidAccessToken.mockResolvedValue('current.unexpired.token');
  await connectSocket();
  const s = mockSockets[mockSockets.length - 1];
  s.emit('connect_error', new Error(message));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return s;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSocket();
  mockSockets.length = 0;
});

describe('a token the server refused', () => {
  test('"Token stale" forces a NEW token rather than replaying the refused one', async () => {
    // The whole point: getValidAccessToken would hand back the same unexpired
    // token the server just rejected.
    mockForceRefreshAccessToken.mockResolvedValue('a.brand.new.token');
    const s = await rejectWith('Token stale');

    expect(mockForceRefreshAccessToken).toHaveBeenCalled();
    expect(s.io.opts.reconnection).toBe(true); // keeps trying, now with a usable token
    expect(getSocket()).not.toBeNull();
  });

  test('"Invalid token" also forces a refresh before giving up', async () => {
    mockForceRefreshAccessToken.mockResolvedValue('a.brand.new.token');
    const s = await rejectWith('Invalid token');
    expect(mockForceRefreshAccessToken).toHaveBeenCalled();
    expect(s.io.opts.reconnection).toBe(true);
  });

  test('a refresh that fails is the one honest end-of-session signal', async () => {
    mockForceRefreshAccessToken.mockResolvedValue(null);
    const s = await rejectWith('Token stale');

    expect(s.io.opts.reconnection).toBe(false); // stop the infinite loop
    expect(getSocket()).toBeNull();             // and drop the socket
  });

  test('a banned account stops retrying once its refresh is refused', async () => {
    mockForceRefreshAccessToken.mockResolvedValue(null);
    const s = await rejectWith('Invalid token');
    expect(s.io.opts.reconnection).toBe(false);
  });
});

describe('a server that could not tell', () => {
  test('"Authentication unavailable" never ends the session', async () => {
    // The DATABASE failed, not the token. Ending the session here would turn
    // one Postgres stall into a fleet-wide logout — the same incident the HTTP
    // path answers 503 rather than 401 to avoid.
    const s = await rejectWith('Authentication unavailable');

    expect(mockForceRefreshAccessToken).not.toHaveBeenCalled();
    expect(s.io.opts.reconnection).toBe(true);
    expect(getSocket()).not.toBeNull();
  });
});

describe('everything else is left to normal reconnection', () => {
  test('a transport error is not treated as an auth failure', async () => {
    const s = await rejectWith('xhr poll error');
    expect(mockForceRefreshAccessToken).not.toHaveBeenCalled();
    expect(s.io.opts.reconnection).toBe(true);
  });

  test('an error with no message at all does not end the session', async () => {
    mockGetValidAccessToken.mockResolvedValue('current.unexpired.token');
    await connectSocket();
    const s = mockSockets[mockSockets.length - 1];
    s.emit('connect_error', {});
    await new Promise((r) => setImmediate(r));

    expect(mockForceRefreshAccessToken).not.toHaveBeenCalled();
    expect(s.io.opts.reconnection).toBe(true);
  });
});
