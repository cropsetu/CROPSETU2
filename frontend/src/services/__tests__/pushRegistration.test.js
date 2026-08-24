/**
 * Expo push registration (claude.md §45).
 *
 * The server half of push has been complete for a long time — chunked sends,
 * the BullMQ offload, the in-app Notification row, DeviceNotRegistered token
 * deletion. None of it ever ran: neither app depended on `expo-notifications`,
 * so `push_tokens` had zero rows and `deliverUserNotification` returned early on
 * every call. Not one push has ever been sent.
 *
 * What can be tested here is the LOGIC — permission handling, the project-id
 * requirement, memoisation, and the failure paths. What cannot is the native
 * side: whether a real device mints a token and whether a notification actually
 * arrives needs a device build, and is called out as unverified.
 */
import { jest } from '@jest/globals';

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();
const mockSetChannel = jest.fn();
const mockPost = jest.fn();

jest.mock('expo-notifications', () => ({
  __esModule: true,
  getPermissionsAsync: (...a) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a) => mockRequestPermissions(...a),
  getExpoPushTokenAsync: (...a) => mockGetToken(...a),
  setNotificationChannelAsync: (...a) => mockSetChannel(...a),
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-123' } } } },
}));
jest.mock('@krushisarva/shared/services/api', () => ({
  __esModule: true,
  default: { post: (...a) => mockPost(...a) },
}));

const { registerForPushNotifications, forgetPushRegistration, _resetPushRegistration } =
  require('@krushisarva/shared/services/pushRegistration');

const TOKEN = 'ExponentPushToken[abcdef1234567890]';

beforeEach(() => {
  jest.clearAllMocks();
  _resetPushRegistration();
  mockGetPermissions.mockResolvedValue({ status: 'granted' });
  mockRequestPermissions.mockResolvedValue({ status: 'granted' });
  mockGetToken.mockResolvedValue({ data: TOKEN });
  mockSetChannel.mockResolvedValue({});
  mockPost.mockResolvedValue({ data: { success: true } });
});

describe('registerForPushNotifications', () => {
  it('POSTs the token to the endpoint that already existed', async () => {
    const token = await registerForPushNotifications();
    expect(token).toBe(TOKEN);
    expect(mockPost).toHaveBeenCalledWith('/users/me/push-token',
      expect.objectContaining({ token: TOKEN }));
  });

  it('sends a platform the server validator accepts', async () => {
    // The endpoint validates `platform` against ios|android and 400s otherwise.
    await registerForPushNotifications();
    expect(['ios', 'android']).toContain(mockPost.mock.calls[0][1].platform);
  });

  it('does not re-prompt when permission was already granted', async () => {
    // Re-asking after a decision is useless — the OS suppresses it — and is a
    // good way to get an app uninstalled.
    await registerForPushNotifications();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('asks once when permission has not been decided', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    await registerForPushNotifications();
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
  });

  it('gives up quietly when permission is denied', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    const token = await registerForPushNotifications();
    expect(token).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('creates the Android channel BEFORE requesting a token', async () => {
    // Android delivers nothing without a channel, so it has to exist before the
    // first push can land.
    await registerForPushNotifications();
    expect(mockSetChannel).toHaveBeenCalled();
    expect(mockSetChannel.mock.invocationCallOrder[0])
      .toBeLessThan(mockGetToken.mock.invocationCallOrder[0]);
  });

  it('memoises, so a re-render or refocus does not re-POST', async () => {
    await registerForPushNotifications();
    await registerForPushNotifications();
    await registerForPushNotifications();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('re-POSTs after logout, so the next user claims the device', async () => {
    // The token belongs to the DEVICE but the row maps it to a user. Without
    // this, the next person to log in on a shared phone would have their pushes
    // delivered against the previous user's row.
    await registerForPushNotifications();
    forgetPushRegistration();
    await registerForPushNotifications();
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('never throws, whatever fails', async () => {
    // Push is an enhancement. A farmer whose device cannot register must still
    // get a fully working app.
    for (const boom of [mockGetPermissions, mockGetToken, mockPost]) {
      jest.clearAllMocks();
      _resetPushRegistration();
      mockGetPermissions.mockResolvedValue({ status: 'granted' });
      mockGetToken.mockResolvedValue({ data: TOKEN });
      mockPost.mockResolvedValue({});
      boom.mockRejectedValue(new Error('nope'));
      await expect(registerForPushNotifications()).resolves.toBeNull();
    }
  });

  it('produces a token matching the format the server validator requires', async () => {
    // The endpoint rejects anything not /^Expo(nent)?PushToken\[.+\]$/.
    const token = await registerForPushNotifications();
    expect(token).toMatch(/^Expo(nent)?PushToken\[.+\]$/);
  });
});

describe('without an EAS project id', () => {
  it('is a clean no-op rather than a crash', async () => {
    // getExpoPushTokenAsync THROWS without a projectId since SDK 48. The seller
    // app has no EAS project, so this is its real state until one is created —
    // an account-level action, not something code can work around.
    jest.resetModules();
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));
    const mod = require('@krushisarva/shared/services/pushRegistration');
    mod._resetPushRegistration();
    await expect(mod.registerForPushNotifications()).resolves.toBeNull();
  });
});
