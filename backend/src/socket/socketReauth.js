/**
 * Periodic re-authentication of ESTABLISHED sockets.
 *
 * The handshake (chat.socket.js) is the only place a socket's credentials are
 * ever checked. A socket is not a request: once it is open it stays open, so a
 * ban, a logout-all, a KYC role flip or a DPDP erasure lands on the victim's
 * NEXT handshake — which for a phone left on a kitchen shelf may be tomorrow.
 * Meanwhile that socket keeps delivering chat and, more expensively, keeps
 * carrying AI and voice turns that spend provider money.
 *
 * Why a sweep rather than pub/sub on the revocation itself: there are nine sites
 * that write `tokenVersion` and only two of them go through `bumpTokenVersion`
 * (utils/jwt.js). The other seven increment it inline, and the admin ban writes
 * `isActive` without touching tokenVersion at all. A publish hook inside the
 * helper would therefore miss ban, force-logout and erasure — the three that
 * matter most. A sweep asks the database what is true, so it cannot be bypassed
 * by a write site nobody remembered to instrument.
 *
 * Cost is one `findMany` over the distinct users connected to THIS process, plus
 * one pipelined Redis EXISTS per tick — not per socket, and not per user.
 *
 * Fails OPEN, deliberately, and in the opposite direction to the handshake. The
 * handshake refuses a connection it cannot validate; this must not disconnect
 * sockets it cannot validate, or one Postgres stall becomes a fleet-wide
 * realtime outage. Refusing a new connection is recoverable in seconds; tearing
 * down every live one is not.
 */
import prisma from '../config/db.js';
import redis, { isRedisHealthy } from '../config/redis.js';
import logger from '../utils/logger.js';
import { isAccessTokenDenylisted } from '../services/tokenDenylist.service.js';

// Long enough that the sweep is not itself load, short enough that a ban is not
// theatre. A revoked user keeps their socket for at most this long; every new
// connection they attempt is already refused by the handshake.
const DEFAULT_INTERVAL_MS = 60_000;

let _timer = null;
let _sweeps = 0;
let _evicted = 0;

/** Every currently-connected socket in this process, as [socket, userId] pairs. */
function connectedSockets(io) {
  // Namespace.sockets is a Map<socketId, Socket> in socket.io 4.x.
  const ns = io?.of?.('/');
  const map = ns?.sockets;
  if (!map || typeof map.forEach !== 'function') return [];
  const out = [];
  map.forEach((socket) => {
    if (socket?.userId) out.push(socket);
  });
  return out;
}

/**
 * One pass. Exported so a test can run it deterministically instead of waiting
 * on a timer.
 *
 * @returns {Promise<{checked:number, evicted:number, skipped?:string}>}
 */
export async function sweepOnce(io) {
  const sockets = connectedSockets(io);
  if (!sockets.length) return { checked: 0, evicted: 0 };

  const userIds = [...new Set(sockets.map((s) => s.userId))];

  let users;
  try {
    users = await prisma.user.findMany({
      where:  { id: { in: userIds } },
      select: { id: true, tokenVersion: true, isActive: true },
    });
  } catch (err) {
    // Fail open — see the header. A database blip must not disconnect anyone.
    logger.warn('[SocketReauth] user lookup failed, skipping sweep: %s', err.message);
    return { checked: 0, evicted: 0, skipped: 'db' };
  }

  const byId = new Map(users.map((u) => [u.id, u]));

  // The jti denylist, one pipeline for the whole tick. Skipped entirely when
  // Redis is unhealthy, which matches the handshake and the HTTP path: the
  // denylist fails open there too, and tokenVersion/isActive are DB-backed and
  // still evict.
  let denylisted = new Set();
  if (isRedisHealthy()) {
    const jtis = [...new Set(sockets.map((s) => s.data?.auth?.jti).filter(Boolean))];
    if (jtis.length) {
      try {
        const results = await Promise.all(jtis.map((jti) => isAccessTokenDenylisted(jti)));
        denylisted = new Set(jtis.filter((_, i) => results[i]));
      } catch (err) {
        logger.warn('[SocketReauth] denylist check failed, continuing without: %s', err.message);
      }
    }
  }

  let evicted = 0;
  for (const socket of sockets) {
    const user = byId.get(socket.userId);
    const auth = socket.data?.auth || {};

    // A user row that vanished mid-sweep is treated as gone, not as unknown:
    // findMany returning nothing for an id we asked about IS the answer.
    const gone     = !user || user.isActive === false;
    const bumped   = user && (auth.tv ?? 0) !== (user.tokenVersion ?? 0);
    const revoked  = auth.jti && denylisted.has(auth.jti);

    if (!gone && !bumped && !revoked) continue;

    evicted += 1;
    // Deliberately NOT enforcing payload.exp. Clients refresh over HTTP without
    // re-handshaking, so expiring on exp would force the whole fleet to
    // reconnect every fifteen minutes for no security gain.
    const reason = gone ? 'account inactive' : bumped ? 'session superseded' : 'token revoked';
    logger.warn('[SocketReauth] evicting socket %s for user %s — %s', socket.id, socket.userId, reason);
    try {
      socket.emit('error', { message: 'Session ended. Please sign in again.' });
      socket.disconnect(true);
    } catch { /* a socket that died on its own needs no eviction */ }
  }

  _sweeps += 1;
  _evicted += evicted;
  return { checked: sockets.length, evicted };
}

/** Begin sweeping. Idempotent. */
export function startSocketReauth(io, { intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (_timer) return;
  _timer = setInterval(() => {
    sweepOnce(io).catch((err) =>
      logger.warn('[SocketReauth] sweep errored: %s', err.message));
  }, intervalMs);
  // Must not hold the process open during a graceful shutdown.
  if (typeof _timer.unref === 'function') _timer.unref();
  logger.info('[SocketReauth] re-checking established sockets every %dms', intervalMs);
}

/** Stop sweeping (graceful shutdown, and between tests). */
export function stopSocketReauth() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

/** Counters for the Ops dashboard. */
export function reauthStats() {
  return { sweeps: _sweeps, evictedSinceBoot: _evicted, running: Boolean(_timer) };
}

/** Test helper. */
export function _resetReauthStats() {
  _sweeps = 0;
  _evicted = 0;
}
