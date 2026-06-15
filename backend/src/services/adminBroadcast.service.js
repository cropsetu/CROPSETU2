/**
 * Admin broadcast — fan a Notification out to a targeted audience.
 *
 * Targeting is by district / state / role / crop (FarmDetail.cropTypes). Delivery
 * reuses push.service.sendPushToUser (DB Notification row + Expo push, enqueued).
 *
 * Recipients are HARD-CAPPED (MAX_RECIPIENTS): a single broadcast can never fan
 * out unbounded work. `estimate()` returns the true matching count so the UI can
 * preview the audience and the caller can see when the cap truncated delivery.
 */
import prisma from '../config/db.js';
import { sendPushToUser } from './push.service.js';
import { getSetting } from './settings.service.js';

// Hard safety ceiling on a single broadcast's fan-out. The runtime
// `broadcast.maxRecipients` AppSetting may LOWER this (ops tuning) but can never
// raise it above the ceiling — unbounded fan-out stays impossible.
export const MAX_RECIPIENTS = 5000;

/** Build the User where-clause for an audience filter (active users only). */
export function audienceWhere({ district, state, role, crop } = {}) {
  const where = { isActive: true };
  if (role) where.role = role;
  if (district) where.district = { equals: district, mode: 'insensitive' };
  if (state) where.state = { equals: state, mode: 'insensitive' };
  if (crop) where.farmDetail = { cropTypes: { has: crop } };
  return where;
}

/** Count the users a filter targets (for the audience preview). */
export function estimateAudience(filters) {
  return prisma.user.count({ where: audienceWhere(filters) });
}

/**
 * Send a notification to everyone matching `filters`.
 *
 * Delivery is enqueued per-recipient (push.service.sendPushToUser). `failed`
 * counts enqueue failures we can observe synchronously — best-effort, since the
 * actual Expo push happens later in a worker. When `log` is true a BroadcastLog
 * row is persisted with the estimated/sent/failed counts so the history view has
 * real numbers; `sentBy`/`templateKey` are recorded on that row for provenance.
 *
 * @returns {{ estimated:number, sent:number, failed:number, capped:boolean, logId:string|null }}
 */
export async function broadcastNotification({ filters, type = 'SYSTEM', title, body, data = {}, log = false, sentBy = null, templateKey = null }) {
  const configured = await getSetting('broadcast.maxRecipients').catch(() => MAX_RECIPIENTS);
  const cap = Math.max(1, Math.min(Number(configured) || MAX_RECIPIENTS, MAX_RECIPIENTS));
  const estimated = await estimateAudience(filters);
  const recipients = await prisma.user.findMany({
    where: audienceWhere(filters),
    select: { id: true },
    take: cap,
  });

  // Enqueue each delivery; a rejected enqueue is a best-effort "failed" signal.
  const results = await Promise.allSettled(
    recipients.map(({ id }) => sendPushToUser({ userId: id, type, title, body, data })),
  );
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  const capped = estimated > recipients.length;

  let logId = null;
  if (log) {
    // History row — best-effort; a failed log write must never break the send.
    const row = await prisma.broadcastLog
      .create({
        data: {
          sentBy: sentBy ?? null,
          filters: filters ?? {},
          title,
          body,
          templateKey: templateKey ?? null,
          estimated,
          sent,
          failed,
        },
        select: { id: true },
      })
      .catch(() => null);
    logId = row?.id ?? null;
  }

  return { estimated, sent, failed, capped, logId };
}
