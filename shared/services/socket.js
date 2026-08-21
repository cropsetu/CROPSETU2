/**
 * Frontend socket.io client wrapper.
 *
 *   const socket = await connectSocket();
 *   socket.on('new_message', (m) => ...);
 *   socket.emit('join_chat', { chatId });
 *
 * The token is validated + refreshed client-side on every connect attempt (via
 * getValidAccessToken), so a near-expired/expired access token is renewed BEFORE
 * the handshake instead of being replayed until the server rejects it. The
 * socket.io `auth` callback re-runs this on every reconnect too. Call
 * resetSocket() on logout.
 *
 * Backend events (see backend/src/socket/chat.socket.js):
 *   - new_message     { id, chatId, senderId, text, ... }
 *   - messages_read   { chatId, userId }
 *   - chat_history    [messages]
 *   - user_online / user_offline
 */
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../constants/config';
import { getValidAccessToken, forceRefreshAccessToken } from './api';

// Server-side auth rejections (backend/src/socket/chat.socket.js —
// SOCKET_AUTH_ERRORS). Distinguished from transient network errors so we only
// stop retrying on a truly dead session.
//
// 'Token stale' means the handshake refused a token that has NOT expired: its
// jti was denylisted, or the user's tokenVersion moved because their role, KYC
// status or team scope changed. Only a forced refresh can clear that, which is
// why this list is answered with forceRefreshAccessToken rather than
// getValidAccessToken — the latter hands back the same unexpired token, which
// read as "session alive" and reconnected with it every 1-5s for the remaining
// fifteen minutes of the token's life.
const AUTH_ERROR_MESSAGES = new Set([
  'Invalid token',
  'Authentication required',
  'Token stale',
]);

// The server could not TELL whether the token was good — its database lookup
// failed. Not a session verdict, so it must not end the session: keep the normal
// reconnect/backoff running and leave the tokens alone. Treating this like an
// auth failure would turn one Postgres stall into a fleet-wide logout, which is
// exactly the incident the HTTP path's 503-not-401 answer exists to prevent.
const AUTH_RETRY_MESSAGES = new Set(['Authentication unavailable']);

let socket = null;
let connectPromise = null;

export function getSocket() {
  return socket;
}

export async function connectSocket() {
  if (socket?.connected) return socket;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    // Proactively validate/refresh before the first handshake so we never open
    // with a token that's already expired or about to.
    const token = await getValidAccessToken();
    if (!token) {
      connectPromise = null;
      throw new Error('No access token — log in first');
    }
    if (socket) socket.disconnect();
    socket = io(SOCKET_URL, {
      // Function form: socket.io invokes this before EVERY connect AND reconnect
      // attempt, so each handshake re-checks expiry and refreshes if needed —
      // the dead-token-until-rejected window is closed for reconnects too.
      auth: (cb) => {
        getValidAccessToken()
          .then((t) => cb({ token: t || null }))
          .catch(() => cb({ token: null }));
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    // Decide, per rejection, whether this session can continue at all.
    //
    // The auto-reconnect's auth callback re-runs getValidAccessToken on every
    // attempt, but that only helps when the token is EXPIRING. It cannot clear a
    // rejection of a token that is still perfectly unexpired, which is what a
    // denylisted jti or a bumped tokenVersion produces — so this handler forces
    // a genuinely new token, and treats "even a forced refresh failed" as the
    // one honest end-of-session signal. Transient/network errors, and the
    // server telling us it could not check, are left to normal reconnection.
    socket.on('connect_error', async (err) => {
      const message = err?.message;
      // The server could not validate, rather than validated-and-refused. Let
      // the normal reconnect loop handle it; do not touch the session.
      if (AUTH_RETRY_MESSAGES.has(message)) return;
      if (!AUTH_ERROR_MESSAGES.has(message)) return;

      // Force a NEW token. The auth callback above re-runs on every reconnect
      // attempt, but it uses getValidAccessToken, which returns the current
      // token unchanged while it is still unexpired — so on a jti/tokenVersion
      // rejection every retry would replay the token the server just refused.
      const fresh = await forceRefreshAccessToken().catch(() => null);
      if (!fresh) {
        // The session cannot be renewed. This is the only reliable "it is over"
        // signal the client has, and it is the same one whatever the server
        // said — which is why the reasons collapse to two categories.
        socket.io.opts.reconnection = false;
        resetSocket();
      }
    });

    // Resolve once connected, but don't reject on slow connects — callers
    // can attach listeners immediately; socket.io buffers emits.
    await new Promise((resolve) => {
      const onConnect = () => { socket.off('connect', onConnect); resolve(); };
      socket.on('connect', onConnect);
      setTimeout(resolve, 2000);   // resolve even if connect is slow; events still queue
    });
    connectPromise = null;
    return socket;
  })();

  return connectPromise;
}

export function resetSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  connectPromise = null;
}
