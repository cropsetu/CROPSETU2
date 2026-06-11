/**
 * Device fingerprinting & multi-account detection (FRAUD-3).
 *
 * Records a (device, account) association each time a device is observed at
 * login or order, then detects when ONE device fingerprint backs many DISTINCT
 * accounts — the signature of a single actor running multiple accounts — and
 * surfaces the linked cluster for review (audit + a deduped FRAUD incident
 * listing the accounts). It NEVER blocks: linking is a review signal, not a gate.
 *
 * Strong identifier only. Linking keys on a hashed `X-Device-Id` (a stable
 * per-install id the client supplies), NOT the coarse User-Agent fingerprint the
 * velocity layer (FRAUD-1) uses: thousands of users share a UA string, so
 * UA-based "linking" would fabricate clusters of unrelated people. With no
 * X-Device-Id present, nothing is linked — the feature is fail-safe (no false
 * positives) and activates automatically once the client sends the header.
 *
 * Persistence (device_account_links) makes the linkage durable + queryable
 * (listDeviceClusters powers the admin review endpoint) and FK-cascades on
 * account deletion (DPDP erasure). Every function is best-effort and NEVER
 * throws — a fingerprinting failure must not break login or checkout.
 *
 * Overlaps COMP-10 (device fingerprinting into risk scoring).
 */
import crypto from "crypto";
import prisma from "../config/db.js";
import redis from "../config/redis.js";
import { ENV } from "../config/env.js";
import logger from "../utils/logger.js";
import { auditLog, AUDIT_ACTIONS } from "./audit.service.js";
import { reportSecurityEvent } from "./incident.service.js";

// How many accounts we list on a flagged cluster (bounds the query + payload).
const MAX_LINKED_ACCOUNTS = 100;
// One incident per device per day, even if it keeps reappearing across logins.
const INCIDENT_DEDUPE_TTL_SEC = 24 * 60 * 60;

/**
 * The STRONG device id used for account linking: a hash of the client's
 * X-Device-Id header, or null when it's absent/blank. Hashed (and length-capped
 * before hashing) so a raw/oversized header value is never used as a key, and so
 * it matches the X-Device-Id branch of velocity's deviceFingerprint() — the same
 * physical device yields the same id in both features.
 */
export function strongDeviceId(req) {
  const raw = req?.headers?.["x-device-id"];
  const id = typeof raw === "string" ? raw.trim().slice(0, 256) : "";
  if (!id) return null;
  return crypto.createHash("sha256").update(id).digest("hex").slice(0, 24);
}

/** Redis SET-NX dedupe so one device raises at most one incident per window. */
async function reserveIncidentSlot(fingerprint) {
  if (redis?.status !== "ready") return false;
  try {
    const r = await redis.set(
      `fraud:devicelink:inc:${fingerprint}`,
      "1",
      "EX",
      INCIDENT_DEDUPE_TTL_SEC,
      "NX",
    );
    return r === "OK";
  } catch (err) {
    logger.warn("[DeviceLink] incident dedupe failed: %s", err.message);
    return false;
  }
}

/** Audit + (deduped) incident for a flagged multi-account cluster. Never throws. */
async function flagMultiAccount({
  fingerprint,
  linkedUserIds,
  accountCount,
  context,
  ip,
}) {
  try {
    const metadata = {
      fingerprint,
      accountCount,
      linkedUserIds,
      context,
      lookbackDays: ENV.DEVICE_LINK.lookbackDays,
    };

    await auditLog({
      userId: "system",
      action: AUDIT_ACTIONS.FRAUD_MULTI_ACCOUNT_FLAG,
      entity: "Device",
      entityId: fingerprint,
      ip: ip || null,
      metadata,
    });

    // Deduped so a busy shared device doesn't reopen the same incident hourly.
    if (await reserveIncidentSlot(fingerprint)) {
      await reportSecurityEvent({
        title: "Multiple accounts linked to one device",
        description:
          `${accountCount} distinct accounts share one device within ` +
          `${ENV.DEVICE_LINK.lookbackDays} days (observed at ${context}). Possible single ` +
          `actor running multiple accounts — linked accounts routed for review.`,
        category: "FRAUD",
        severity: "MEDIUM",
        affectedUserIds: linkedUserIds,
        metadata,
      });
    }
  } catch (err) {
    logger.warn("[DeviceLink] flag side effects failed: %s", err.message);
  }
}

/**
 * Record a (device, account) observation and, if the device now backs enough
 * distinct accounts within the window, flag the cluster for review. Best-effort;
 * never throws. No-ops (returns null) without a strong device id or userId.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {?string} p.fingerprint — from strongDeviceId(req); null → skip linking
 * @param {?string} [p.ip]
 * @param {string}  p.context     — 'login' | 'order'
 * @returns {Promise<{fingerprint:string, accountCount:number, linkedUserIds:string[], flagged:boolean}|null>}
 */
export async function recordDeviceLink({
  userId,
  fingerprint,
  ip = null,
  context,
}) {
  if (!userId || !fingerprint) return null; // no strong device id → don't link

  try {
    const now = new Date();
    // Upsert the (device, account) link — bump recency/usage on repeat sightings.
    await prisma.deviceAccountLink.upsert({
      where: { fingerprint_userId: { fingerprint, userId } },
      create: { fingerprint, userId, lastIp: ip, lastContext: context },
      update: {
        lastSeenAt: now,
        seenCount: { increment: 1 },
        lastIp: ip,
        lastContext: context,
      },
    });

    // Distinct accounts on this device within the window. The @@unique(fingerprint,
    // userId) means one row per account, so the row set IS the distinct accounts.
    const since = new Date(
      Date.now() - ENV.DEVICE_LINK.lookbackDays * 24 * 60 * 60 * 1000,
    );
    const rows = await prisma.deviceAccountLink.findMany({
      where: { fingerprint, lastSeenAt: { gte: since } },
      select: { userId: true },
      take: MAX_LINKED_ACCOUNTS,
    });
    const linkedUserIds = rows.map((r) => r.userId);
    const accountCount = linkedUserIds.length;
    const flagged = accountCount >= ENV.DEVICE_LINK.flagAccounts;

    if (flagged)
      await flagMultiAccount({
        fingerprint,
        linkedUserIds,
        accountCount,
        context,
        ip,
      });

    return { fingerprint, accountCount, linkedUserIds, flagged };
  } catch (err) {
    logger.warn(
      "[DeviceLink] record failed (treating as no-op): %s",
      err.message,
    );
    return null;
  }
}

/**
 * Admin review query: device fingerprints that back ≥ minAccounts distinct
 * accounts within the lookback window, newest activity first. Powers
 * GET /admin/fraud/device-clusters. Never throws — returns [] on error.
 *
 * @param {object} [opts]
 * @param {number} [opts.minAccounts]
 * @param {number} [opts.lookbackDays]
 * @param {number} [opts.limit]
 * @returns {Promise<Array<{fingerprint:string, accountCount:number, accounts:Array<{userId:string,lastSeenAt:Date,seenCount:number,lastContext:?string}>}>>}
 */
export async function listDeviceClusters({
  minAccounts,
  lookbackDays,
  limit,
} = {}) {
  try {
    const min =
      Number.isFinite(minAccounts) && minAccounts >= 2
        ? minAccounts
        : ENV.DEVICE_LINK.flagAccounts;
    const days =
      Number.isFinite(lookbackDays) && lookbackDays > 0
        ? lookbackDays
        : ENV.DEVICE_LINK.lookbackDays;
    const take = Math.min(
      Number.isFinite(limit) && limit > 0 ? limit : 50,
      200,
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Fingerprints with ≥ min distinct accounts in the window (one row per account).
    const groups = await prisma.deviceAccountLink.groupBy({
      by: ["fingerprint"],
      where: { lastSeenAt: { gte: since } },
      _count: { userId: true },
      having: { userId: { _count: { gte: min } } },
      orderBy: { _count: { userId: "desc" } },
      take,
    });
    if (!groups.length) return [];

    const fingerprints = groups.map((g) => g.fingerprint);
    const links = await prisma.deviceAccountLink.findMany({
      where: { fingerprint: { in: fingerprints }, lastSeenAt: { gte: since } },
      select: {
        fingerprint: true,
        userId: true,
        lastSeenAt: true,
        seenCount: true,
        lastContext: true,
      },
      orderBy: { lastSeenAt: "desc" },
    });

    const byFingerprint = new Map();
    for (const l of links) {
      if (!byFingerprint.has(l.fingerprint))
        byFingerprint.set(l.fingerprint, []);
      byFingerprint.get(l.fingerprint).push({
        userId: l.userId,
        lastSeenAt: l.lastSeenAt,
        seenCount: l.seenCount,
        lastContext: l.lastContext,
      });
    }

    return groups.map((g) => ({
      fingerprint: g.fingerprint,
      accountCount: g._count.userId,
      accounts: byFingerprint.get(g.fingerprint) || [],
    }));
  } catch (err) {
    logger.warn("[DeviceLink] listDeviceClusters failed: %s", err.message);
    return [];
  }
}
