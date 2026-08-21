/**
 * A device token must not outlive the app it belongs to (claude.md §45).
 *
 * Expo answers every send with one TICKET per message. That reply was discarded
 * entirely, so a token whose app has been uninstalled — or whose token has
 * rotated — stayed in push_tokens forever, and every future notification to that
 * farmer built a message for a device that could never receive one. Expo's own
 * guidance is to delete a token the moment it reports DeviceNotRegistered.
 *
 * The asymmetry these pin: DeviceNotRegistered is about the DEVICE and the token
 * goes. Everything else Expo can return — MessageTooBig, MessageRateExceeded,
 * InvalidCredentials — is about the SEND, and deleting a live farmer's token
 * over a transient send problem is worse than a lost push.
 */
import { jest } from '@jest/globals';

const findMany = jest.fn();
const deleteMany = jest.fn();
const notificationCreate = jest.fn().mockResolvedValue({});
const userFindUnique = jest.fn().mockResolvedValue({ notificationsEnabled: true });

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: {
    pushToken:    { findMany, deleteMany },
    notification: { create: notificationCreate },
    user:         { findUnique: userFindUnique },
  },
}));

const sendPushNotificationsAsync = jest.fn();
jest.unstable_mockModule('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken(t) { return typeof t === 'string' && t.startsWith('ExponentPushToken'); }
    chunkPushNotifications(messages) { return [messages]; }
    sendPushNotificationsAsync(...a) { return sendPushNotificationsAsync(...a); }
  },
}));

jest.unstable_mockModule('../../../src/queue/jobQueue.js', () => ({
  enqueue: jest.fn(), QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
}));

const { deliverUserNotification } = await import('../../../src/services/push.service.js');

const tok = (n) => `ExponentPushToken[device-${n}]`;
const ok = () => ({ status: 'ok', id: 'ticket-1' });
const err = (error, message = 'nope') => ({ status: 'error', message, details: { error } });

const deliver = () => deliverUserNotification({
  userId: 'u1', type: 'SYSTEM', title: 'hello', body: 'world',
});

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([{ token: tok(1) }, { token: tok(2) }, { token: tok(3) }]);
  deleteMany.mockReset().mockResolvedValue({ count: 1 });
  sendPushNotificationsAsync.mockReset();
});

describe('DeviceNotRegistered', () => {
  it('deletes exactly the token Expo says is gone', async () => {
    sendPushNotificationsAsync.mockResolvedValue([ok(), err('DeviceNotRegistered'), ok()]);

    await deliver();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    // Index 1 of the ticket array is index 1 of the chunk — the SECOND device.
    expect(deleteMany.mock.calls[0][0]).toEqual({ where: { token: { in: [tok(2)] } } });
  });

  it('deletes every dead token in one statement, not one each', async () => {
    sendPushNotificationsAsync.mockResolvedValue([
      err('DeviceNotRegistered'), ok(), err('DeviceNotRegistered'),
    ]);

    await deliver();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany.mock.calls[0][0].where.token.in.sort()).toEqual([tok(1), tok(3)]);
  });
});

describe('every other error is about the send, not the device', () => {
  it.each(['MessageTooBig', 'MessageRateExceeded', 'InvalidCredentials', undefined])(
    'does NOT delete a token on %s',
    async (reason) => {
      sendPushNotificationsAsync.mockResolvedValue([ok(), err(reason), ok()]);
      await deliver();
      expect(deleteMany).not.toHaveBeenCalled();
    },
  );
});

describe('nothing here may break a notification', () => {
  it('touches nothing when every ticket is fine', async () => {
    sendPushNotificationsAsync.mockResolvedValue([ok(), ok(), ok()]);
    await deliver();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('survives a send that throws outright', async () => {
    sendPushNotificationsAsync.mockRejectedValue(new Error('network down'));
    await expect(deliver()).resolves.toBeUndefined();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('survives a prune that fails', async () => {
    sendPushNotificationsAsync.mockResolvedValue([err('DeviceNotRegistered'), ok(), ok()]);
    deleteMany.mockRejectedValue(new Error('pool timeout'));
    await expect(deliver()).resolves.toBeUndefined();
  });

  it('still writes the in-app row, which the mute and the push never gate', async () => {
    sendPushNotificationsAsync.mockResolvedValue([ok(), ok(), ok()]);
    await deliver();
    expect(notificationCreate).toHaveBeenCalled();
  });

  it('does not call Expo at all when the user has no usable token', async () => {
    findMany.mockResolvedValue([{ token: 'not-an-expo-token' }]);
    await deliver();
    expect(sendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
