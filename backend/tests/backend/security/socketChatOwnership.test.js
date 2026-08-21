/**
 * Authorization tests for the Socket.IO chat handlers.
 *
 * The repository had NO socket tests of any kind, which is how `mark_read` came
 * to be the one handler in chat.socket.js that took a chatId off the wire and
 * acted on it without checking the caller was in that chat — while its
 * neighbours `join_chat` and `send_message` both check.
 *
 * Acceptance: every handler that reads or writes a chat must first confirm the
 * authenticated user is that chat's buyer or seller.
 *
 * prisma is module-mocked, so this exercises the guards without a database.
 * There is no socket.io-client in this package, so rather than stand up a real
 * server the test drives `registerChatSocket` with a fake `io`/`socket` pair and
 * invokes the registered handlers directly — which is all that is needed, since
 * what is under test is the handler body, not the transport.
 */
import { jest } from '@jest/globals';

const findFirst  = jest.fn();
const updateMany = jest.fn();
const userUpdate = jest.fn();

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: {
    chat:        { findFirst },
    chatMessage: { updateMany, findMany: jest.fn().mockResolvedValue([]) },
    user:        { update: userUpdate },
  },
}));

const { registerChatSocket } = await import('../../../src/socket/chat.socket.js');

const OWNER    = 'owner-user-1';
const OUTSIDER = 'outsider-user-2';
const CHAT_ID  = 'chat-1';

/**
 * Register the socket handlers for one connected user and hand back the map of
 * event name → handler, plus the rooms the fake io emitted into.
 */
async function connectAs(userId) {
  const handlers = {};
  const emitted  = [];

  const socket = {
    id: `sock-${userId}`,
    handshake: { auth: { token: 't' } },
    userId,
    on:         (event, fn) => { handlers[event] = fn; },
    join:       () => {},
    emit:       () => {},
    disconnect: () => {},
  };

  let connectionHandler;
  const io = {
    use: () => {},
    on:  (event, fn) => { if (event === 'connection') connectionHandler = fn; },
    to:  (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  };

  registerChatSocket(io);
  // The auth middleware is bypassed deliberately: these tests are about what an
  // ALREADY-AUTHENTICATED user may do to a chat that is not theirs.
  await connectionHandler(socket);
  return { handlers, emitted };
}

beforeEach(() => {
  findFirst.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 0 });
  userUpdate.mockReset().mockResolvedValue({});
});

describe('mark_read ownership', () => {
  test('a chat the caller is not in is not marked read, and nothing is broadcast', async () => {
    // The membership lookup is scoped by buyerId/sellerId, so for an outsider
    // it finds nothing.
    findFirst.mockResolvedValue(null);

    const { handlers, emitted } = await connectAs(OUTSIDER);
    await handlers.mark_read({ chatId: CHAT_ID });

    // The write must not happen. Before the guard existed this cleared readAt
    // across a stranger's conversation, so the real recipient's unread badge
    // silently dropped to zero on messages they had never opened.
    expect(updateMany).not.toHaveBeenCalled();
    // And the caller's user id must not be announced into a room they were
    // never a member of.
    expect(emitted.filter((e) => e.event === 'messages_read')).toHaveLength(0);
  });

  test('the chat owner still marks their own chat read', async () => {
    findFirst.mockResolvedValue({ id: CHAT_ID });

    const { handlers, emitted } = await connectAs(OWNER);
    await handlers.mark_read({ chatId: CHAT_ID });

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [{ where, data }] = updateMany.mock.calls[0];
    expect(where.chatId).toBe(CHAT_ID);
    expect(where.readAt).toBeNull();
    // A participant marks the OTHER side's messages read, never their own.
    expect(where.NOT).toEqual({ senderId: OWNER });
    expect(data.readAt).toBeInstanceOf(Date);

    const read = emitted.filter((e) => e.event === 'messages_read');
    expect(read).toHaveLength(1);
    expect(read[0].room).toBe(CHAT_ID);
    expect(read[0].payload).toEqual({ chatId: CHAT_ID, userId: OWNER });
  });

  test('a missing chatId is ignored without touching the database', async () => {
    const { handlers } = await connectAs(OWNER);
    await handlers.mark_read({});
    expect(findFirst).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('the neighbouring handlers still check membership', () => {
  test('send_message drops a chat the caller is not in', async () => {
    findFirst.mockResolvedValue(null);
    const { handlers, emitted } = await connectAs(OUTSIDER);
    await handlers.send_message({ chatId: CHAT_ID, text: 'hello' });
    expect(emitted.filter((e) => e.event === 'new_message')).toHaveLength(0);
  });

  test('join_chat does not emit history for a chat the caller is not in', async () => {
    findFirst.mockResolvedValue(null);
    const emits = [];
    const handlers = {};
    const socket = {
      id: 'sock-x',
      handshake: { auth: { token: 't' } },
      userId: OUTSIDER,
      on: (event, fn) => { handlers[event] = fn; },
      join: () => {},
      emit: (event, payload) => emits.push({ event, payload }),
      disconnect: () => {},
    };
    let connectionHandler;
    registerChatSocket({
      use: () => {},
      on: (event, fn) => { if (event === 'connection') connectionHandler = fn; },
      to: () => ({ emit: () => {} }),
    });
    await connectionHandler(socket);

    await handlers.join_chat({ chatId: CHAT_ID });
    expect(emits.filter((e) => e.event === 'chat_history')).toHaveLength(0);
  });
});
