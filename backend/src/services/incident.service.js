/**
 * Security Incident Service — incident log + breach-notification tracking.
 *
 * Records security incidents (manual or auto-detected), maintains an append-only
 * timeline, and tracks the DPDP §8(6) duty to notify the Data Protection Board
 * and affected data principals. See docs/SECURITY_INCIDENT_RESPONSE.md for the
 * operational runbook this service supports.
 */
import prisma from "../config/db.js";
import logger from "../utils/logger.js";

// Practical SLA to notify once a breach requires it. DPDP requires notification
// "without delay"; we track an internal 72h target to drive the ops process.
export const NOTIFY_WINDOW_HOURS = 72;

// Categories that, by themselves, trigger the notification duty.
const NOTIFY_CATEGORIES = new Set([
  "DATA_BREACH",
  "PII_EXPOSURE",
  "ACCOUNT_TAKEOVER",
  "SYSTEM_COMPROMISE",
]);
// High-impact severities also trigger it regardless of category.
const NOTIFY_SEVERITIES = new Set(["HIGH", "CRITICAL"]);

/**
 * Decide whether an incident triggers the breach-notification duty and, if so,
 * the deadline. Pure + exported for testing.
 */
export function computeNotificationRequirement({
  category,
  severity,
  detectedAt = new Date(),
}) {
  const required =
    NOTIFY_CATEGORIES.has(category) || NOTIFY_SEVERITIES.has(severity);
  const notifyDueAt = required
    ? new Date(
        new Date(detectedAt).getTime() + NOTIFY_WINDOW_HOURS * 60 * 60 * 1000,
      )
    : null;
  return { required, notifyDueAt };
}

/** Human-friendly reference derived from the incident id (e.g. INC-1A2B3C4D). */
export function incidentReference(id) {
  return `INC-${String(id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/**
 * Record a new incident + an opening timeline entry. Returns the incident with
 * its computed reference.
 */
export async function recordIncident({
  title,
  description = null,
  category,
  severity,
  source = "manual",
  reportedById = null,
  detectedAt = new Date(),
  affectedUserIds = [],
  affectedUserCount = null,
  dataCategories = [],
  metadata = null,
}) {
  const { required, notifyDueAt } = computeNotificationRequirement({
    category,
    severity,
    detectedAt,
  });

  const incident = await prisma.securityIncident.create({
    data: {
      title,
      description,
      category,
      severity,
      source,
      reportedById,
      detectedAt,
      affectedUserIds,
      affectedUserCount: affectedUserCount ?? (affectedUserIds.length || null),
      dataCategories,
      notificationRequired: required,
      notifyDueAt,
      metadata: metadata ? JSON.stringify(metadata) : null,
      updates: {
        create: {
          authorId: reportedById,
          note: `Incident opened (${severity} ${category})${required ? " — breach notification REQUIRED" : ""}.`,
          statusTo: "OPEN",
        },
      },
    },
    include: { updates: true },
  });

  if (required) {
    logger.warn(
      { incidentId: incident.id, category, severity, notifyDueAt },
      "[Incident] Breach-notification REQUIRED — notify Board + affected users",
    );
  }
  return { ...incident, reference: incidentReference(incident.id) };
}

/**
 * Auto-log a system-detected security event. Best-effort: never throws (a
 * logging failure must not break the request that detected the event).
 */
export async function reportSecurityEvent(event) {
  try {
    return await recordIncident({ source: "system", ...event });
  } catch (err) {
    logger.error(
      { err, event: { category: event?.category, severity: event?.severity } },
      "[Incident] failed to auto-log security event",
    );
    return null;
  }
}

/** Add a timeline note; optionally transition status. */
export async function addIncidentUpdate({
  incidentId,
  authorId = null,
  note,
  statusTo = null,
}) {
  const incident = await prisma.securityIncident.findUnique({
    where: { id: incidentId },
    select: { status: true },
  });
  if (!incident) return null;

  const [update] = await prisma.$transaction([
    prisma.incidentUpdate.create({
      data: {
        incidentId,
        authorId,
        note,
        statusFrom: statusTo ? incident.status : null,
        statusTo,
      },
    }),
    ...(statusTo
      ? [
          prisma.securityIncident.update({
            where: { id: incidentId },
            data: { status: statusTo },
          }),
        ]
      : []),
  ]);
  return update;
}

/** Record that the Board or the affected users have been notified. */
export async function markNotified({
  incidentId,
  target,
  at = new Date(),
  authorId = null,
}) {
  const field = target === "board" ? "boardNotifiedAt" : "usersNotifiedAt";
  const label = target === "board" ? "Data Protection Board" : "affected users";
  await prisma.securityIncident.update({
    where: { id: incidentId },
    data: { [field]: at },
  });
  await addIncidentUpdate({
    incidentId,
    authorId,
    note: `Notified ${label} at ${new Date(at).toISOString()}.`,
  });
  return true;
}

/** List incidents (newest first), optionally filtered. */
export async function listIncidents({
  status,
  severity,
  category,
  limit = 100,
} = {}) {
  const where = {};
  if (status) where.status = status;
  if (severity) where.severity = severity;
  if (category) where.category = category;
  const rows = await prisma.securityIncident.findMany({
    where,
    orderBy: { detectedAt: "desc" },
    take: Math.min(limit, 500),
  });
  return rows.map((r) => ({ ...r, reference: incidentReference(r.id) }));
}

/** Full incident detail + timeline. */
export async function getIncident(id) {
  const incident = await prisma.securityIncident.findUnique({
    where: { id },
    include: { updates: { orderBy: { createdAt: "asc" } } },
  });
  if (!incident) return null;
  return { ...incident, reference: incidentReference(incident.id) };
}
