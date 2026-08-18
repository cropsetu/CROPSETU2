/**
 * The Account → Notifications mute, and the one thing it must never silence.
 *
 * Before this pass the switch was a bare `useState(true)` in ProfileScreen: it
 * moved, and nothing else happened. A farmer who turned alerts off kept getting
 * them, with no way to tell the control was decorative.
 *
 * Now it writes `User.notificationsEnabled`, and delivery consults it. The rule
 * that matters most is the exception: SECURITY notifications — new-device
 * sign-in, location anomaly, OTP lockout — ignore the mute completely. Those
 * alerts are how a person discovers their account is being taken over, and
 * whoever is holding the phone must not be able to switch them off from a
 * settings screen.
 */
import { jest } from '@jest/globals';

const notificationCreate = jest.fn(() => Promise.resolve({}));
const userFindUnique     = jest.fn();
const pushTokenFindMany  = jest.fn(() => Promise.resolve([]));

jest.unstable_mockModule('../../../src/config/db.js', () => ({
  default: {
    notification: { create: notificationCreate },
    user:         { findUnique: userFindUnique },
    pushToken:    { findMany: pushTokenFindMany },
  },
}));

const { deliverUserNotification, NOTIFICATION_CATEGORIES } =
  await import('../../../src/services/push.service.js');

const base = { userId: 'u1', type: 'ORDER_UPDATE', title: 'T', body: 'B' };

beforeEach(() => {
  notificationCreate.mockClear();
  pushTokenFindMany.mockClear();
  userFindUnique.mockReset();
});

/** Token lookup happening at all is the observable proof a push was attempted. */
const pushAttempted = () => pushTokenFindMany.mock.calls.length > 0;

describe('activity notifications respect the mute', () => {
  test('muted user gets no device push', async () => {
    userFindUnique.mockResolvedValue({ notificationsEnabled: false });
    await deliverUserNotification(base);
    expect(pushAttempted()).toBe(false);
  });

  test('unmuted user does get one', async () => {
    userFindUnique.mockResolvedValue({ notificationsEnabled: true });
    await deliverUserNotification(base);
    expect(pushAttempted()).toBe(true);
  });

  test('the in-app inbox row is written either way', async () => {
    // Muting silences the interruption, not the record — so re-enabling later
    // does not leave a hole in the farmer's notification history.
    userFindUnique.mockResolvedValue({ notificationsEnabled: false });
    await deliverUserNotification(base);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  test('ACTIVITY is the default category when none is given', async () => {
    userFindUnique.mockResolvedValue({ notificationsEnabled: false });
    await deliverUserNotification(base);           // no category passed
    expect(pushAttempted()).toBe(false);
  });
});

describe('security notifications cannot be silenced', () => {
  test('a muted user STILL receives a security alert', async () => {
    userFindUnique.mockResolvedValue({ notificationsEnabled: false });
    await deliverUserNotification({
      ...base, type: 'SYSTEM', category: NOTIFICATION_CATEGORIES.SECURITY,
    });
    expect(pushAttempted()).toBe(true);
  });

  test('the preference is not even read for a security alert', async () => {
    userFindUnique.mockResolvedValue({ notificationsEnabled: false });
    await deliverUserNotification({
      ...base, category: NOTIFICATION_CATEGORIES.SECURITY,
    });
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});

describe('the preference check fails OPEN', () => {
  test('a DB error delivers the notification rather than swallowing it', async () => {
    // Losing "your order is out for delivery" because a preference read blipped
    // is a worse outcome than one unwanted push.
    userFindUnique.mockRejectedValue(new Error('connection reset'));
    await deliverUserNotification(base);
    expect(pushAttempted()).toBe(true);
  });

  test('a missing user row is treated as not-muted', async () => {
    userFindUnique.mockResolvedValue(null);
    await deliverUserNotification(base);
    expect(pushAttempted()).toBe(true);
  });
});
