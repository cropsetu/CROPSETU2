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

    // Auto-join personal room for DMs
    socket.join(`user:${userId}`);

    // Mark user online
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: true, lastSeenAt: new Date() },
    }).catch(() => {});

    io.emit('user_online', { userId });

    // ── Animal Trade Chat ──────────────────────────────────────────────────────
    socket.on('join_chat', async ({ chatId }) => {
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

    socket.on('send_message', async ({ chatId, text }) => {
      if (!chatId || !text?.trim()) return;
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, OR: [{ sellerId: userId }, { buyerId: userId }] },
      });
      if (!chat) return;
      // [FIX] Sanitize chat message text to prevent stored XSS
      const safeText = text.trim().replace(/<[^>]*>/g, '').substring(0, 2000);
      const message = await prisma.chatMessage.create({
        data: { chatId, senderId: userId, text: safeText },
      });
      await prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }).catch(() => {});
      const payload = { ...message, chatId };
      io.to(chatId).emit('new_message', payload);
      // Also reach each participant's user room so an inbox screen (which
      // doesn't join chat rooms) can update its row in real time.
      io.to(`user:${chat.buyerId}`).emit('new_message', payload);
      io.to(`user:${chat.sellerId}`).emit('new_message', payload);
    });

    socket.on('mark_read', async ({ chatId }) => {
      if (!chatId) return;
      await prisma.chatMessage.updateMany({
        where: { chatId, readAt: null, NOT: { senderId: userId } },
        data: { readAt: new Date() },
      });
      io.to(chatId).emit('messages_read', { chatId, userId });
    });

    // ── Group Chat ──────────────────────────────────────────────────────────────
    socket.on('join_group', async ({ groupId }) => {
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

    socket.on('leave_group_room', ({ groupId }) => {
      socket.leave(`group:${groupId}`);
    });

    socket.on('group_message', async ({ groupId, text, imageUrl }) => {
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

    socket.on('group_typing', ({ groupId, isTyping }) => {
      if (!groupId) return;
      socket.to(`group:${groupId}`).emit('group_typing_update', { groupId, userId, isTyping });
    });

    // ── Direct Messages ─────────────────────────────────────────────────────────
    socket.on('dm_send', async ({ receiverId, text, imageUrl }) => {
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

    socket.on('dm_typing', ({ receiverId, isTyping }) => {
      if (!receiverId) return;
      io.to(`user:${receiverId}`).emit('dm_typing_update', { senderId: userId, isTyping });
    });

    socket.on('dm_read', async ({ senderId: msgSenderId }) => {
      if (!msgSenderId) return;
      await prisma.directMessage.updateMany({
        where: { senderId: msgSenderId, receiverId: userId, readAt: null },
        data: { readAt: new Date() },
      });
      io.to(`user:${msgSenderId}`).emit('dm_read_receipt', { by: userId });
    });

    // ── Disconnect ──────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { isOnline: false, lastSeenAt: new Date() },
      }).catch(() => {});
      io.emit('user_offline', { userId, lastSeenAt: new Date() });
    });
  });
}
