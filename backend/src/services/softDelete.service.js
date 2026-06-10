/**
 * Soft-delete (archive) utility with a built-in audit trail.
 *
 * Archiving a resource leaves the row in the DB but hides it from normal reads.
 * Done with a bare `prisma.x.update(...)` there is no record of WHO archived
 * WHAT and WHEN — which hampers dispute resolution and compliance. This module
 * is the single place that performs an archive/restore, so every such action is
 * written to the AuditLog (RESOURCE_ARCHIVE / RESOURCE_RESTORE) with the actor
 * and a timestamp, and is therefore queryable later.
 *
 * Each archivable resource declares how it flips between archived and active
 * (different models use different conventions: a status enum, an isActive flag,
 * an isArchived flag, or a deletedAt tombstone). Add a new resource by adding
 * one entry to ARCHIVE_SPECS — the audit hook then comes for free.
 */
import prisma from '../config/db.js';
import { auditAction, auditLog, AUDIT_ACTIONS } from './audit.service.js';

// patch builders are functions so per-call values (e.g. a fresh tombstone
// timestamp) are evaluated at archive time, not at module load.
export const ARCHIVE_SPECS = {
  AIConversation:    { model: () => prisma.aIConversation,    archive: () => ({ isArchived: true }),     restore: () => ({ isArchived: false }) },
  VoiceConversation: { model: () => prisma.voiceConversation, archive: () => ({ isArchived: true }),     restore: () => ({ isArchived: false }) },
  AnimalListing:     { model: () => prisma.animalListing,     archive: () => ({ status: 'INACTIVE' }),    restore: () => ({ status: 'ACTIVE' }) },
  MachineryListing:  { model: () => prisma.machineryListing,  archive: () => ({ status: 'INACTIVE' }),    restore: () => ({ status: 'ACTIVE' }) },
  LabourListing:     { model: () => prisma.labourListing,     archive: () => ({ status: 'INACTIVE' }),    restore: () => ({ status: 'ACTIVE' }) },
  Post:              { model: () => prisma.post,              archive: () => ({ deletedAt: new Date() }), restore: () => ({ deletedAt: null }) },
  Product:           { model: () => prisma.product,           archive: () => ({ isActive: false }),       restore: () => ({ isActive: true }) },
  Farm:              { model: () => prisma.farm,              archive: () => ({ isActive: false }),       restore: () => ({ isActive: true }) },
};

function specFor(entity) {
  const spec = ARCHIVE_SPECS[entity];
  if (!spec) throw new Error(`softDelete: unknown archivable entity "${entity}"`);
  return spec;
}

/**
 * Emit the archive/restore audit event. Best-effort — auditing must never break
 * the operation it records (mirrors the auditAction call-site convention). Used
 * internally by archiveResource/restoreResource, and exported for call sites
 * that must do the state change inside their own transaction (e.g. a product
 * delete that also clears carts) and so can't use archiveResource directly.
 *
 * `actor` is either an Express `req` (actor/ip/requestId pulled off it) or a
 * plain `{ userId, ip?, requestId? }` for service-layer callers without a req.
 */
export function auditArchiveEvent(actor, { mode, entity, entityId, before = null, after = null, metadata = null }) {
  const action = mode === 'restore' ? AUDIT_ACTIONS.RESOURCE_RESTORE : AUDIT_ACTIONS.RESOURCE_ARCHIVE;
  const isReq = actor && typeof actor === 'object' && 'user' in actor;
  const p = isReq
    ? auditAction(actor, { action, entity, entityId, before, after, metadata })
    : auditLog({ userId: actor?.userId, action, entity, entityId, before, after, ip: actor?.ip || null, requestId: actor?.requestId || null, metadata });
  return p.catch(() => {});
}

async function applyArchiveState(req, entity, id, mode, { metadata = null } = {}) {
  const spec = specFor(entity);
  const data = spec[mode]();
  const updated = await spec.model().update({ where: { id }, data });
  // Awaited so the audit row is committed before we return — this is a
  // compliance trail, so the event must be durable, not best-effort. The
  // .catch() inside auditArchiveEvent still keeps a failed audit insert from
  // breaking the archive operation itself.
  await auditArchiveEvent(req, { mode, entity, entityId: id, after: data, metadata });
  return updated;
}

/** Soft-delete (archive) a resource and record a RESOURCE_ARCHIVE audit event. */
export function archiveResource(req, entity, id, opts = {}) {
  return applyArchiveState(req, entity, id, 'archive', opts);
}

/** Restore a previously archived resource and record a RESOURCE_RESTORE event. */
export function restoreResource(req, entity, id, opts = {}) {
  return applyArchiveState(req, entity, id, 'restore', opts);
}
