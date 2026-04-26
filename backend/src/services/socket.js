/**
 * Socket.IO client service for FarmEasy real-time features.
 * Singleton pattern — one connection across the whole app.
 *
 * Security notes
 * ──────────────
 * • URL is pulled from config.js — never hardcode IPs here.
 * • In production config.js resolves to wss:// (encrypted WebSocket).
 * • console.log/warn are intentionally absent — socket IDs are
 *   semi-sensitive session identifiers and must not appear in device logs.
 * • Call resetSocket() on logout so the old authenticated socket cannot
 *   receive events for a subsequent user in the same process.
 */
import { io } from 'socket.io-client';
import { getAccessToken } from './api';
import { SOCKET_URL } from '../constants/config';

let socket = null;

export function getSocket() {
  return socket;
}

export async function connectSocket() {
  if (socket?.connected) return socket;

  const token = await getAccessToken();
  if (!token) return null;

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });

  return socket;
}

/**
 * Gracefully close and destroy the socket.
 * Must be called on logout to prevent the old session leaking events
 * to a new user who logs in without a full app restart.
 */
export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/** Alias used by AuthContext on logout. */
export const resetSocket = disconnectSocket;
