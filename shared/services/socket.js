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
import { getValidAccessToken } from './api';

// Server-side auth rejections (backend socket middleware). Distinguished from
// transient network errors so we only stop retrying on a truly dead session.
const AUTH_ERROR_MESSAGES = new Set(['Invalid token', 'Authentication required']);

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

    // If the server rejects auth, the auto-reconnect's auth callback will already
    // attempt a refresh. But if the session is truly dead (refresh fails →
    // getValidAccessToken resolves null), stop the infinite retry loop instead of
    // hammering the server with a token we can't renew. Transient/network errors
    // are left alone so normal reconnection still works.
    socket.on('connect_error', async (err) => {
      if (!AUTH_ERROR_MESSAGES.has(err?.message)) return;
      const fresh = await getValidAccessToken().catch(() => null);
      if (!fresh) {
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
