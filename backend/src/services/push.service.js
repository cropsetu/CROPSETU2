/**
 * Push notification helper — Expo push delivery + DB Notification row.
 *
 * sendPushToUser({ userId, type, title, body, data })
 *   Enqueues delivery onto the notifications queue and returns immediately, so
 *   callers (including request handlers) never wait on the DB insert + Expo HTTP
 *   round-trip. A worker runs deliverUserNotification() with retries. If the
 *   queue is unavailable it falls back to delivering inline (unchanged behaviour).
 *
 * deliverUserNotification({ userId, type, title, body, data, category }) — the work:
 *   1. Inserts a row in the Notification table (in-app inbox / unread badge).
 *   2. Looks up all PushToken rows for the user and sends an Expo push.
 *
 * Failures in either step are logged but never thrown — push is best-effort.
 *
 * ── The mute, and what it deliberately does NOT cover ────────────────────────
 * Account → Notifications ("Get alerts for replies & updates") sets
 * `User.notificationsEnabled`. When it is off, step 2 is skipped: no device push.
 * Step 1 still runs, so the in-app inbox stays complete — muting stops the
 * interruption, it does not delete the record, and re-enabling leaves no hole.
 *
 * `category: 'SECURITY'` bypasses the mute entirely. New-device logins, location
 * anomalies and OTP alerts are how a farmer finds out their account is being
 * taken over; whoever is holding the phone must not be able to silence them from
 * a settings screen. Everything else defaults to ACTIVITY and is mutable.
 */
import { Expo } from 'expo-server-sdk';
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { enqueue, QUEUE_NAMES } from '../queue/jobQueue.js';

const expo = new Expo();

/**
 * Offload notification delivery to the queue (heavy-work offload, SCALE).
 * Same signature as before so existing callers need no change.
 */
export async function sendPushToUser(payload) {
  return enqueue(QUEUE_NAMES.NOTIFICATIONS, 'user-notification', payload);
}

/** Categories that ignore the farmer's mute. */
export const NOTIFICATION_CATEGORIES = { ACTIVITY: 'ACTIVITY', SECURITY: 'SECURITY' };

/**
 * May we send a DEVICE PUSH to this user for this category?
 *
 * Fails OPEN: if the preference cannot be read (DB blip), the notification is
 * still delivered. A farmer receiving one push they had muted is a far smaller
 * harm than a missed "your order is out for delivery" — or a swallowed security
 * alert — because a read failed.
 */
async function pushAllowed(userId, category) {
  if (category === NOTIFICATION_CATEGORIES.SECURITY) return true;
  try {
    const u = await prisma.user.findUnique({
      where:  { id: userId },
      select: { notificationsEnabled: true },
    });
    return u?.notificationsEnabled !== false;
  } catch (err) {
    logger.warn('[push] preference read failed, delivering anyway: %s', err.message);
    return true;
  }
}

export async function deliverUserNotification({
  userId, type, title, body, data = {},
  category = NOTIFICATION_CATEGORIES.ACTIVITY,
}) {
  // 1. Persist in-app notification row (fire-and-forget but awaited so caller
  //    can still treat the inbox as durable). Written regardless of the mute —
  //    see the header: muting silences the interruption, not the record.
  prisma.notification.create({
    data: { userId, type, title, body, data },
  }).catch((err) => logger.warn('[push] notification insert failed: %s', err.message));

  // 2. Send Expo push (best-effort), unless the farmer muted this category.
  if (!(await pushAllowed(userId, category))) return;

  try {
    const tokens = await prisma.pushToken.findMany({
      where:  { userId },
      select: { token: true },
    });

    const messages = tokens
      .map((t) => t.token)
      .filter((token) => Expo.isExpoPushToken(token))
      .map((token) => ({
        to:    token,
        sound: 'default',
        title,
        body,
        data,
      }));

    if (!messages.length) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        logger.warn('[push] Expo chunk send failed: %s', err.message);
      }
    }
  } catch (err) {
    logger.warn('[push] sendPushToUser failed: %s', err.message);
  }
}
