/**
 * Expo push token registration (claude.md §45).
 *
 * The server half of push has been complete for a long time: push.service.js
 * chunks through expo-server-sdk, offloads to the BullMQ notifications queue,
 * writes the in-app Notification row, deletes tokens Expo reports as
 * DeviceNotRegistered, and honours User.notificationsEnabled. The endpoint to
 * register a token has existed at POST /users/me/push-token since the beginning.
 *
 * Nothing ever called it. Neither app depended on `expo-notifications`, so
 * `push_tokens` had zero rows and `deliverUserNotification` hit
 * `if (!messages.length) return;` on every single call — Expo was never
 * contacted and no push has ever been sent. This module is the missing half.
 *
 * It is deliberately dumb and defensive. Push is an enhancement: a farmer whose
 * device refuses permission, whose Play Services are broken, or who is on web
 * must still get a working app. Every failure path here logs in development and
 * resolves, never throws.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import api from './api';

const DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

/** Remembered across calls so a re-render or a refocus does not re-POST. */
let lastRegisteredToken = null;

/** Test-only: forget the memo so cases do not leak into each other. */
export function _resetPushRegistration() {
  lastRegisteredToken = null;
}

/**
 * The EAS project id Expo needs to mint a token.
 *
 * Required since SDK 48: without it getExpoPushTokenAsync throws rather than
 * returning null. The farmer app has one in app.json; the seller app does NOT,
 * and that is an account-level action (create an EAS project) rather than
 * something code can work around. Returning null here makes that a clean,
 * logged no-op instead of a crash on launch.
 */
function projectId() {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId
    || Constants?.easConfig?.projectId
    || null
  );
}

/**
 * Ask for permission and return the Expo push token, or null.
 *
 * Null is a normal outcome, not an error: web, a simulator, a denied prompt, or
 * a missing project id all land here.
 */
async function acquireToken() {
  if (Platform.OS === 'web') return null;

  // Never re-prompt. Asking again after a denial is both useless (the OS
  // suppresses it) and a good way to make someone uninstall the app.
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') {
    if (DEV) console.log('[push] permission not granted — skipping registration');
    return null;
  }

  const id = projectId();
  if (!id) {
    if (DEV) console.warn('[push] no EAS projectId in app config — cannot mint a token');
    return null;
  }

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  return data || null;
}

/**
 * Register this device for push, if it can be.
 *
 * Call it after login and whenever the signed-in user changes. Safe to call
 * repeatedly: the token is memoised, so a re-render costs nothing.
 *
 * @returns {Promise<string|null>} the token registered, or null if push is
 *   unavailable on this device — callers should not branch on it.
 */
export async function registerForPushNotifications() {
  try {
    // Android delivers nothing without a channel. Created before the token is
    // requested so the very first push has somewhere to land.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'KrushiSarva',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const token = await acquireToken();
    if (!token) return null;

    // The token is stable per install, so re-POSTing it on every foreground is
    // pure noise. The server upsert is idempotent either way — this saves the
    // round trip, not correctness.
    if (token === lastRegisteredToken) return token;

    await api.post('/users/me/push-token', {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    lastRegisteredToken = token;
    if (DEV) console.log('[push] registered', token.slice(0, 24) + '…');
    return token;
  } catch (err) {
    // Deliberately swallowed. Push is an enhancement; a farmer whose device
    // cannot register must still get a fully working app.
    if (DEV) console.warn('[push] registration failed:', err?.message);
    return null;
  }
}

/**
 * Forget the memo so the next registration re-POSTs.
 *
 * Call on logout. The token belongs to the DEVICE, but the row maps it to a
 * user: whoever logs in next must claim it, or their pushes would be delivered
 * to the previous user's row. The server's upsert reassigns `userId` on
 * conflict, which is exactly this case — but only if we actually send it again.
 */
export function forgetPushRegistration() {
  lastRegisteredToken = null;
}
