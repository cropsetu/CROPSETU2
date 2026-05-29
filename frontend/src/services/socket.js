/**
 * Frontend socket.io client wrapper.
 *
 *   const socket = await connectSocket();
 *   socket.on('new_message', (m) => ...);
 *   socket.emit('join_chat', { chatId });
 *
 * The token is read from secure storage on every connect attempt so it's
 * always the latest. Reconnects automatically. Call resetSocket() on logout.
 *
 * Backend events (see backend/src/socket/chat.socket.js):
 *   - new_message     { id, chatId, senderId, text, ... }
 *   - messages_read   { chatId, userId }
 *   - chat_history    [messages]
 *   - user_online / user_offline
 */
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../constants/config';
import { getAccessToken } from './api';

let socket = null;
let connectPromise = null;

export function getSocket() {
  return socket;
}

export async function connectSocket() {
  if (socket?.connected) return socket;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const token = await getAccessToken();
    if (!token) {
      connectPromise = null;
      throw new Error('No access token — log in first');
    }
    if (socket) socket.disconnect();
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
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
