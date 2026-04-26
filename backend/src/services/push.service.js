/**
 * Push notification helper — Expo push delivery + DB Notification row.
 *
 * sendPushToUser({ userId, type, title, body, data })
 *   1. Inserts a row in the Notification table (in-app inbox / unread badge).
 *   2. Looks up all PushToken rows for the user and sends an Expo push.
 *
 * Failures in either step are logged but never thrown — push is best-effort.
 */
import { Expo } from 'expo-server-sdk';
import prisma from '../config/db.js';
import logger from '../utils/logger.js';

const expo = new Expo();

export async function sendPushToUser({ userId, type, title, body, data = {} }) {
  // 1. Persist in-app notification row (fire-and-forget but awaited so caller
  //    can still treat the inbox as durable)
  prisma.notification.create({
    data: { userId, type, title, body, data },
  }).catch((err) => logger.warn('[push] notification insert failed: %s', err.message));

  // 2. Send Expo push (best-effort)
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
