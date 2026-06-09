/**
 * Login risk / fraud signals — account-takeover detection.
 *
 * OTP brute-force is already blocked by the per-phone lockout (otpLockout.service)
 * plus the OTP send/verify rate limits. This module covers the *other* half:
 * flagging a SUCCESSFUL login that looks risky — coming from a device or network
 * the account hasn't used recently — so it lands in the audit trail and the owner
 * can be alerted. It never blocks (the OTP is the auth factor); it only flags.
 *
 * Signal source is the existing AuditLog AUTH_LOGIN history (ip column + the
 * userAgent recorded in metadata). No schema change required.
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { sendPushToUser } from './push.service.js';

const LOOKBACK_DAYS = 90;
const HISTORY_LIMIT = 50;

/**
 * Coarse device fingerprint from a User-Agent: lowercase and drop version
 * numbers so a routine app/browser version bump doesn't read as a new device.
 */
export function deviceKey(ua) {
  if (!ua || typeof ua !== 'string') return null;
  return ua.toLowerCase().replace(/[\d.]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
}

/**
 * Assess ATO risk for a successful login by comparing the current IP + device
 * against the user's recent successful-login history. Pure read; NEVER throws —
 * auth must not break if risk scoring fails (fails open as non-risky).
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {string|null} p.ip
 * @param {string|null} p.userAgent
 * @returns {Promise<{risky:boolean, signals:string[], notify:boolean, firstLogin:boolean}>}
 */
export async function assessLoginRisk({ userId, ip, userAgent }) {
  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const prior = await prisma.auditLog.findMany({
      where:   { userId, action: 'AUTH_LOGIN', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take:    HISTORY_LIMIT,
      select:  { ip: true, metadata: true },
    });

    // No prior successful login → this is the baseline; nothing to compare to.
    if (!prior.length) return { risky: false, signals: [], notify: false, firstLogin: true };

    const knownIps = new Set(prior.map((p) => p.ip).filter(Boolean));
    const knownDevices = new Set();
    for (const p of prior) {
      let ua = null;
      try { ua = JSON.parse(p.metadata || '{}')?.userAgent; } catch { /* ignore */ }
      const k = deviceKey(ua);
      if (k) knownDevices.add(k);
    }

    const signals = [];
    if (ip && !knownIps.has(ip)) signals.push('new_ip');
    const dk = deviceKey(userAgent);
    // Only flag a new device when we actually have device history to compare to
    // (older logins predating device capture would otherwise always look "new").
    if (dk && knownDevices.size && !knownDevices.has(dk)) signals.push('new_device');

    return {
      risky:  signals.length > 0,
      signals,
      // Alert the owner on the strong signal (device change); a bare IP change is
      // common on mobile/CGNAT, so it's audit-flagged but not push-notified.
      notify: signals.includes('new_device'),
      firstLogin: false,
    };
  } catch (err) {
    logger.warn('[LoginRisk] assessment failed, treating as non-risky: %s', err.message);
    return { risky: false, signals: [], notify: false, firstLogin: false };
  }
}

/** Best-effort security alert to the account owner about a flagged login. Never throws. */
export async function notifyRiskyLogin(userId, signals) {
  try {
    const where = signals.includes('new_device') && signals.includes('new_ip')
      ? 'a new device and location'
      : signals.includes('new_device') ? 'a new device' : 'a new location';
    await sendPushToUser({
      userId,
      type:  'SYSTEM',
      title: 'New sign-in to your account',
      body:  `We noticed a sign-in from ${where}. If this was you, no action is needed. If not, secure your account right away.`,
      data:  { kind: 'risky_login', signals },
    });
  } catch (err) {
    logger.warn('[LoginRisk] alert failed: %s', err.message);
  }
}
