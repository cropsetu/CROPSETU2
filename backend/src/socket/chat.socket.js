/**
 * Socket.io Handler — FarmEasy
 * Handles: Animal Trade chats, Group chats, Direct Messages, Online presence.
 *
 * ─── Events client → server ───────────────────────────────────────────────────
 *  Animal Trade:
 *   join_chat       { chatId }
 *   send_message    { chatId, text }
 *   mark_read       { chatId }
 *
 *  Group Chat:
 *   join_group      { groupId }
 *   leave_group     { groupId }
 *   group_message   { groupId, text, imageUrl? }
 *   group_typing    { groupId, isTyping }
 *
 *  Direct Messages:
 *   dm_send         { receiverId, text, imageUrl? }
 *   dm_typing       { receiverId, isTyping }
 *   dm_read         { senderId }
 *
 * ─── Events server → client ───────────────────────────────────────────────────
 *  new_message, chat_history
 *  group_new_message, group_history, group_typing_update
 *  dm_new_message, dm_typing_update, dm_read_receipt
 *  user_online, user_offline
 *  error
 */
import { verifyAccessToken } from '../utils/jwt.js';
import prisma from '../config/db.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';
import { createConnectionLimiter, onLimited } from './socketRateLimit.js';
import { ConnectionRegistry } from './connectionLimiter.js';
import { cancelVoiceStream, cancelVoiceStreamsForUser } from '../services/voiceStream.registry.js';

// Per-user socket cap (SCALE-5). One registry per process; entries are dropped
// as users' last sockets disconnect, so it stays bounded.
const connections = new ConnectionRegistry({ maxPerUser: ENV.SOCKET_MAX_CONN_PER_USER });

export function registerChatSocket(io) {
  // ── Auth middleware ─────────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyAccessToken(token);
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;

    // Connection cap (SCALE-5): refuse a new socket once this user is at the
    // per-instance limit, BEFORE joining rooms / marking online / wiring events.
    // The socket was not tracked, so disconnecting it leaves no residue.
    if (!connections.tryAdd(userId, socket.id)) {
      logger.warn('[Socket] user %s at connection cap (%d) — refusing socket %s',
        userId, connections.maxPerUser, socket.id);
      socket.emit('error', { message: 'Connection limit reached. Close another session and try again.' });
      socket.disconnect(true);
      return;
    }

    // Per-connection rate limiting (SCALE-9): throttle burst emitters so a single
    // client can't flood DB writes / broadcast fan-out. `allow(category)` returns
    // false once this socket exceeds its token-bucket budget for that category.
    const allow = createConnectionLimiter();

    // Auto-join personal room for DMs
    socket.join(`user:${userId}`);

    // Mark user online
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: true, lastSeenAt: new Date() },
    }).catch(() => {});

    // No presence broadcast. `io.emit` reaches EVERY socket in the fleet (the
    // Redis adapter republishes it to every node), so it cost O(connections)
    // per connect/disconnect — the only O(N²)-shaped behaviour in the system.
    // Nothing consumed it: no client in frontend/, seller-app/, admin/ or
    // shared/ ever registered a `user_online`/`user_offline` handler. The row
    // above still records presence, and the REST endpoints that actually
    // surface it (animalListing.service.js, user.routes.js) read it from there.

    // ── Animal Trade Chat ──────────────────────────────────────────────────────
    onLimited(socket, allow, 'join_chat', 'join', async ({ chatId }) => {
      if (!chatId) return;
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, OR: [{ sellerId: userId }, { buyerId: userId }] },
      });
      if (!chat) { socket.emit('error', { message: 'Chat not found' }); return; }
      socket.join(chatId);
      const messages = await prisma.chatMessage.findMany({
        where: { chatId }, orderBy: { createdAt: 'asc' }, take: 50,
      });
      socket.emit('chat_history', messages);
    });

    onLimited(socket, allow, 'send_message', 'message', async ({ chatId, text, clientMsgId }) => {
      if (!chatId || !text?.trim()) return;
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, OR: [{ sellerId: userId }, { buyerId: userId }] },
      });
      if (!chat) return;
      // [FIX] Sanitize chat message text to prevent stored XSS
      const safeText = text.trim().replace(/<[^>]*>/g, '').substring(0, 2000);
      // A socket that drops mid-send is resent by the client on reconnect. The
      // client stamps each send attempt with a clientMsgId, so the retry lands
      // on the unique (chatId, clientMsgId) index instead of duplicating the
      // message — we then re-broadcast the row that already exists so the
      // sender's optimistic bubble still resolves.
      const cmid = clientMsgId ? String(clientMsgId).slice(0, 64) : null;
      let message;
      try {
        message = await prisma.chatMessage.create({
          data: { chatId, senderId: userId, text: safeText, clientMsgId: cmid },
        });
      } catch (err) {
        if (err?.code !== 'P2002' || !cmid) throw err;
        message = await prisma.chatMessage.findUnique({
          where: { chatId_clientMsgId: { chatId, clientMsgId: cmid } },
        });
        if (!message) return;
        socket.emit('new_message', { ...message, chatId });
        return; // already broadcast when it was first stored
      }
      await prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }).catch(() => {});
      const payload = { ...message, chatId };
      io.to(chatId).emit('new_message', payload);
      // Also reach each participant's user room so an inbox screen (which
      // doesn't join chat rooms) can update its row in real time.
      io.to(`user:${chat.buyerId}`).emit('new_message', payload);
      io.to(`user:${chat.sellerId}`).emit('new_message', payload);
    });

    onLimited(socket, allow, 'mark_read', 'read', async ({ chatId }) => {
      if (!chatId) return;
      await prisma.chatMessage.updateMany({
        where: { chatId, readAt: null, NOT: { senderId: userId } },
        data: { readAt: new Date() },
      });
      io.to(chatId).emit('messages_read', { chatId, userId });
    });

    // ── Group Chat ──────────────────────────────────────────────────────────────
    onLimited(socket, allow, 'join_group', 'join', async ({ groupId }) => {
      if (!groupId) return;
      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!member) { socket.emit('error', { message: 'Not a group member' }); return; }
      socket.join(`group:${groupId}`);
      const messages = await prisma.groupMessage.findMany({
        where: { groupId },
        include: { sender: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      socket.emit('group_history', messages.reverse());
    });

    onLimited(socket, allow, 'leave_group_room', 'join', ({ groupId }) => {
      socket.leave(`group:${groupId}`);
    });

    onLimited(socket, allow, 'group_message', 'message', async ({ groupId, text, imageUrl }) => {
      if (!groupId || (!text?.trim() && !imageUrl)) return;
      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!member) return;

      const sender = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, avatar: true },
      });

      const [message] = await prisma.$transaction([
        prisma.groupMessage.create({
          data: { groupId, senderId: userId, text: text?.trim() || null, imageUrl: imageUrl || null },
        }),
        prisma.group.update({
          where: { id: groupId },
          data: { lastMessage: text?.trim() || '📷 Photo', lastMessageAt: new Date() },
        }),
      ]);

      io.to(`group:${groupId}`).emit('group_new_message', { ...message, sender });
    });

    onLimited(socket, allow, 'group_typing', 'typing', ({ groupId, isTyping }) => {
      if (!groupId) return;
      socket.to(`group:${groupId}`).emit('group_typing_update', { groupId, userId, isTyping });
    });

    // ── Direct Messages ─────────────────────────────────────────────────────────
    onLimited(socket, allow, 'dm_send', 'message', async ({ receiverId, text, imageUrl }) => {
      if (!receiverId || (!text?.trim() && !imageUrl)) return;
      if (receiverId === userId) return;

      // [FIX] Sanitize DM text to prevent stored XSS
      const safeText = text ? text.trim().replace(/<[^>]*>/g, '').substring(0, 2000) : null;
      const message = await prisma.directMessage.create({
        data: { senderId: userId, receiverId, text: safeText, imageUrl: imageUrl || null },
      });
      const sender = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, avatar: true },
      });
      io.to(`user:${receiverId}`).emit('dm_new_message', { ...message, sender });
      socket.emit('dm_new_message', { ...message, sender });
    });

    onLimited(socket, allow, 'dm_typing', 'typing', ({ receiverId, isTyping }) => {
      if (!receiverId) return;
      io.to(`user:${receiverId}`).emit('dm_typing_update', { senderId: userId, isTyping });
    });

    onLimited(socket, allow, 'dm_read', 'read', async ({ senderId: msgSenderId }) => {
      if (!msgSenderId) return;
      await prisma.directMessage.updateMany({
        where: { senderId: msgSenderId, receiverId: userId, readAt: null },
        data: { readAt: new Date() },
      });
      io.to(`user:${msgSenderId}`).emit('dm_read_receipt', { by: userId });
    });

    // ── Voice streaming cancel ────────────────────────────────────────────────
    // Client left the voice screen mid-reply — terminate the background pipeline
    // (stops generation, TTS, audio emits, and refunds the credit hold). Honoured
    // unconditionally (not rate-limited): it only flips an in-memory flag, and
    // dropping it would leave audio playing.
    // cancelVoiceStream is async (it publishes to Redis so the replica actually
    // running the pipeline sees the cancel). Nothing here needs the result, but
    // the rejection has to go somewhere or a Redis blip becomes an unhandled
    // rejection that takes the process down.
    socket.on('voice:cancel', ({ streamId } = {}) => {
      if (!streamId) return;
      cancelVoiceStream(`${userId}:${streamId}`)
        .catch(err => logger.warn('[VoiceStream] cancel failed: %s', err?.message));
    });

    // ── Disconnect ──────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      // Always release the tracked handle first so the per-user count can't drift.
      connections.remove(userId, socket.id);
      // Only flip presence to offline once the user's LAST socket is gone —
      // otherwise closing one of several tabs would mark them offline everywhere.
      if (connections.countFor(userId) === 0) {
        // A farmer who walks out of coverage never emits voice:cancel — the socket
        // just dies. Without this the background pipeline ran to completion for an
        // audience of nobody: full Gemini generation plus a per-sentence Sarvam TTS
        // bill. The room-occupancy check in runVoiceStreamPipeline refunds the
        // credit hold, but only AFTER all that spend has already happened, so it
        // fixes the ledger and not the leak. A disconnect carries no streamId,
        // which is why the registry tracks live streams per user.
        await cancelVoiceStreamsForUser(userId)
          .catch(err => logger.warn('[VoiceStream] disconnect cancel failed: %s', err?.message));
        await prisma.user.update({
          where: { id: userId },
          data: { isOnline: false, lastSeenAt: new Date() },
        }).catch(() => {});
        // No presence broadcast on disconnect either — see the connect handler.
      }
    });
  });
}
