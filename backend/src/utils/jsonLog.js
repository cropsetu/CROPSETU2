/**
 * Append-only JSON log columns on FarmCropCycle — safely.
 *
 * A crop cycle keeps four running logs (`activities`, `laborLogs`,
 * `expenseLogs`, `incomeLogs`) as JSON arrays on the row. Appending to them was
 * a read-modify-write in application code:
 *
 *     const { laborLogs } = await findFirst(...)          // read
 *     await update({ data: { laborLogs: [...laborLogs, e] } })  // write
 *
 * Two problems that has, both of which bite exactly when a farmer is busiest:
 *
 *  1. LOST UPDATES. Two entries submitted close together — a double tap, an
 *     offline queue flushing, or simply logging an expense on the phone while
 *     the tablet syncs — both read the same array and both write their own
 *     version of it. One entry silently disappears. There is no error, no
 *     retry, and the farmer only notices at the end of the season when the
 *     costs do not add up.
 *
 *  2. UNBOUNDED GROWTH. Nothing capped the array. A perennial crop logged daily
 *     runs to thousands of entries; every append rewrites the whole column
 *     (O(n) per write, O(n²) across a season) and every read of the cycle drags
 *     the lot along.
 *
 * The fix is one atomic statement. Postgres's `jsonb ||` concatenation happens
 * inside a single UPDATE, so concurrent appends serialise on the row lock and
 * neither is lost, and the cap is enforced in the same WHERE clause rather than
 * in a racy pre-check.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { stripHtml } from './encrypt.js';

/**
 * Columns this helper may write. Interpolated into SQL as identifiers, so the
 * whitelist is what keeps that safe — a caller can never pass a column name
 * derived from a request.
 */
export const LOG_COLUMNS = Object.freeze({
  activities:  { cap: 2000 },
  laborLogs:   { cap: 2000 },
  expenseLogs: { cap: 2000 },
  incomeLogs:  { cap: 1000 },
  // The four field logs. These appended with `[...existing, newEntry]` — a read,
  // a spread and a write, so two entries recorded at once lost one of them, and
  // neither was capped. Both problems are the ones appendJsonLog already solves,
  // so they use it now rather than a second implementation.
  //
  // A farmer standing in a field on a weak connection, tapping again because the
  // first attempt looked like it had not worked, is the ordinary case here — not
  // an edge one. Losing the entry they just typed is the exact failure the
  // atomic append was written for.
  fertilizersUsed: { cap: 2000 },
  pesticidesUsed:  { cap: 2000 },
  irrigationLogs:  { cap: 2000 },
  observedEvents:  { cap: 2000 },
});

/** Per-entry text caps. Bound the row and keep one entry from dwarfing the log. */
const TEXT_CAP = 500;
/** `fields` is a free-form bag on activity entries — bound its shape too. */
const MAX_FIELD_KEYS = 30;
const MAX_FIELD_VALUE = 500;

/** Trim, strip HTML, cap. Returns null for anything empty. */
export function cleanText(value, cap = TEXT_CAP) {
  if (value == null) return null;
  const s = stripHtml(String(value)).trim().slice(0, cap);
  return s || null;
}

/**
 * Sanitise the free-form `fields` bag on an activity entry.
 *
 * It was stored verbatim, so a client could park an arbitrary object of any
 * size on the row — and any string in it was rendered later without ever having
 * been stripped. Keys are capped in count, values in length, and nested objects
 * are flattened to their JSON text rather than kept as an unbounded tree.
 */
export function cleanFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  const out = {};
  for (const [k, v] of Object.entries(fields).slice(0, MAX_FIELD_KEYS)) {
    const key = String(k).slice(0, 60);
    if (v == null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string') out[key] = cleanText(v, MAX_FIELD_VALUE);
    else out[key] = cleanText(JSON.stringify(v), MAX_FIELD_VALUE);
  }
  return out;
}

/** An ISO date string, or now. Rejects unparseable input rather than storing it. */
export function cleanDate(value) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** A finite non-negative number, or null. */
export function cleanAmount(value, max = 1e11) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Atomically append one entry to a cycle's JSON log column.
 *
 * Ownership (`farmerId`) is part of the WHERE clause, so a cycle belonging to
 * someone else simply matches no row — the check cannot be skipped by a caller
 * forgetting to make it.
 *
 * @param {string} cycleId
 * @param {string} farmerId
 * @param {keyof LOG_COLUMNS} column
 * @param {object} entry  already sanitised by the caller
 * @returns {Promise<{ok:true, entry:object} | {ok:false, reason:'notfound'|'full'}>}
 */
export async function appendJsonLog(cycleId, farmerId, column, entry) {
  const spec = LOG_COLUMNS[column];
  if (!spec) throw new Error(`appendJsonLog: unknown column ${column}`);
  const col = Prisma.raw(`"${column}"`); // safe: key came from the frozen whitelist

  // One statement: the cap check and the append share the row lock, so two
  // concurrent appends cannot both see "not full" and both write.
  const updated = await prisma.$queryRaw`
    UPDATE "farm_crop_cycles"
       SET ${col} = ${col} || ${JSON.stringify([entry])}::jsonb,
           "updatedAt" = NOW()
     WHERE "id" = ${cycleId}
       AND "farmerId" = ${farmerId}
       AND jsonb_array_length(${col}) < ${spec.cap}
    RETURNING "id"`;

  if (updated.length > 0) return { ok: true, entry };

  // Nothing updated: either the cycle is not this farmer's (or is gone), or the
  // log is at its ceiling. Distinguish so the caller can answer 404 vs 409 —
  // "your log is full" and "no such cycle" need very different UI.
  const exists = await prisma.farmCropCycle.findFirst({
    where: { id: cycleId, farmerId },
    select: { id: true },
  });
  return { ok: false, reason: exists ? 'full' : 'notfound' };
}

/**
 * Read one page of a log column, newest first, without loading the whole array.
 *
 * The cycle detail response used to carry every entry ever logged. `jsonb_path_query`
 * slices in the database, so a farmer with 1,800 irrigation entries downloads 30.
 *
 * @returns {Promise<{items:any[], total:number}|null>} null when not found/not owned
 */
export async function readJsonLogPage(cycleId, farmerId, column, { offset = 0, limit = 30 } = {}) {
  const spec = LOG_COLUMNS[column];
  if (!spec) throw new Error(`readJsonLogPage: unknown column ${column}`);
  const col = Prisma.raw(`"${column}"`);
  const take = Math.min(Math.max(1, limit), 100);
  const skip = Math.max(0, offset);

  const rows = await prisma.$queryRaw`
    SELECT jsonb_array_length(${col}) AS total,
           COALESCE(
             (SELECT jsonb_agg(e ORDER BY ord DESC)
                FROM jsonb_array_elements(${col}) WITH ORDINALITY AS t(e, ord)
               WHERE ord <= jsonb_array_length(${col}) - ${skip}
                 AND ord >  jsonb_array_length(${col}) - ${skip} - ${take}),
             '[]'::jsonb
           ) AS items
      FROM "farm_crop_cycles"
     WHERE "id" = ${cycleId} AND "farmerId" = ${farmerId}`;

  if (rows.length === 0) return null;
  return { items: rows[0].items ?? [], total: Number(rows[0].total ?? 0) };
}
