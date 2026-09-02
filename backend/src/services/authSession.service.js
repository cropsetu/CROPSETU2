/**
 * Session issuance for a phone number whose ownership has ALREADY been proven.
 *
 * The caller is responsible for the proof. Today two callers qualify:
 *   • /auth/verify-otp     — proof = our own bcrypt-hashed OTP matched
 *   • /auth/firebase-login — proof = a Google-signed Firebase ID token verified
 *
 * Everything after the proof is identical for both: find-or-create the user, mint
 * the access/refresh pair, cap concurrent sessions, and run the full fraud stack
 * (login risk, geo anomaly, velocity, device linking) with the same audit trail.
 *
 * Both callers share this ONE implementation — /verify-otp was refactored onto it
 * and holds no inline copy. A fix here lands on every login path; that is the
 * point of the extraction, and the reason not to re-inline it for either path.
 */
import prisma from '../config/db.js';
import { ENV } from '../config/env.js';
import { auditAuthEvent, AUTH_ACTIONS } from './audit.service.js';
import { assessLoginRisk, notifyRiskyLogin } from './loginRisk.service.js';
import { recordVelocity, deviceFingerprint, VELOCITY_ACTIONS } from './velocity.service.js';
import { flagVelocity } from '../middleware/velocityLimit.js';
import { recordDeviceLink, strongDeviceId } from './deviceLink.service.js';
import { assessLoginGeoAnomaly, flagGeoAnomaly } from './geoAnomaly.service.js';
import { resolveIpGeo } from './geoIp.service.js';
import { captureSignupConsent } from './consent.service.js';
import { signAccessToken, createRefreshToken, enforceSessionLimit } from '../utils/jwt.js';
import { wantsCookieAuth, setRefreshCookie, setCsrfCookie } from '../utils/cookies.js';
import { generateCsrfToken } from '../middleware/csrf.js';

// The exact projection /verify-otp uses. tokenVersion is needed to sign the
// access token and is stripped before the user object leaves the server.
const USER_SELECT = {
  id: true, phone: true, name: true, role: true, language: true,
  onboardingStep: true, activeFarmId: true, totalFarms: true, tokenVersion: true,
};

/**
 * @param {object}  args
 * @param {object}  args.req          Express request (IP, headers, device id)
 * @param {object}  args.res          Express response (cookie mode writes to it)
 * @param {string}  args.phone        Canonical 10-digit Indian mobile, already proven
 * @param {string=} args.name         Optional display name for a first-time signup
 * @param {string}  args.loginMethod  Audit tag, e.g. 'firebase' — records HOW ownership
 *                                    was proven so a compromised provider can be traced
 * @returns {Promise<{body: object, userId: string, isNewUser: boolean}>}
 */
export async function issueSessionForVerifiedPhone({ req, res, phone, name, loginMethod, providerUid }) {
  // Find-or-create. The phone column is unique, so this is the same
  // no-enumeration behaviour as the OTP path: one endpoint serves signup and
  // login, and the response never reveals which one happened beyond isNewUser.
  const existing = await prisma.user.findUnique({ where: { phone }, select: USER_SELECT });
  const isNewUser = !existing;

  let user = existing;
  if (isNewUser) {
    user = await prisma.user.create({
      data: { phone, name: name || null },
      select: USER_SELECT,
    });
    // [DPDP §5] Proof of the consents accepted on the signup screen.
    // Best-effort: logged but never blocks registration.
    await captureSignupConsent({
      userId:    user.id,
      ip:        req.ip,
      userAgent: req.headers['user-agent'] || null,
    });
  }

  const accessToken  = signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });
  const refreshToken = await createRefreshToken(user.id);

  // Cap concurrent sessions — a new login evicts the oldest beyond the limit.
  await enforceSessionLimit(user.id);

  // ── Fraud / ATO risk signals ────────────────────────────────────────────────
  // Assess BEFORE recording this login so it compares against prior events only.
  // A brand-new account is the baseline — never risky.
  const userAgent = req.headers['user-agent'] || null;
  const risk = isNewUser
    ? { risky: false, signals: [], notify: false }
    : await assessLoginRisk({ userId: user.id, ip: req.ip, userAgent });

  // ── Geo-anomaly login detection (FRAUD-4) ───────────────────────────────────
  // MUST run BEFORE writing this login's AUTH_LOGIN row so "previous" is genuinely
  // the prior one. Fails open — geo scoring must never block a login.
  let stepUp = false;
  let geo = { anomalous: false, reasons: [], currGeo: null };
  if (ENV.GEO_ANOMALY_ENABLED) {
    try {
      geo = isNewUser
        ? { anomalous: false, reasons: [], currGeo: await resolveIpGeo(req.ip) }
        : await assessLoginGeoAnomaly({ userId: user.id, ip: req.ip, at: Date.now() });
    } catch { /* fail open */ }
  }

  await auditAuthEvent(user.id, AUTH_ACTIONS.LOGIN, req.ip, {
    outcome: 'success', isNewUser, userAgent, loginMethod,
    ...(providerUid ? { providerUid } : {}),
    ...(geo.currGeo ? { geo: { country: geo.currGeo.country, lat: geo.currGeo.lat, lng: geo.currGeo.lng } } : {}),
  });

  if (risk.risky) {
    await auditAuthEvent(user.id, AUTH_ACTIONS.LOGIN_RISKY, req.ip, {
      signals: risk.signals, userAgent, loginMethod,
    });
    if (risk.notify) notifyRiskyLogin(user.id, risk.signals).catch(() => {});
  }

  if (geo.anomalous) {
    await auditAuthEvent(user.id, AUTH_ACTIONS.LOGIN_GEO_ANOMALY, req.ip, {
      reasons: geo.reasons, impliedSpeedKmh: geo.impliedSpeedKmh, distanceKm: geo.distanceKm,
      country: geo.currGeo?.country,
    });
    flagGeoAnomaly(user.id, geo, { ip: req.ip }).catch(() => {});
    if (geo.action === 'step_up') stepUp = true;
  }

  // ── Login velocity (FRAUD-1) — flag-only, never blocks a proven login ────────
  if (ENV.VELOCITY_ENABLED) {
    try {
      const velocity = await recordVelocity({
        action: VELOCITY_ACTIONS.LOGIN,
        identities: { user: user.id, device: deviceFingerprint(req), ip: req.ip },
      });
      if (velocity.flagged) flagVelocity(req, VELOCITY_ACTIONS.LOGIN, velocity, { actorId: user.id }).catch(() => {});
    } catch { /* never break login on a fraud-scoring glitch */ }
  }

  // ── Device link / multi-account detection (FRAUD-3) ──────────────────────────
  if (ENV.DEVICE_FINGERPRINT_ENABLED) {
    recordDeviceLink({ userId: user.id, fingerprint: strongDeviceId(req), ip: req.ip, context: 'login' })
      .catch(() => {});
  }

  // Don't leak the internal tokenVersion in the API response.
  const { tokenVersion: _tv, ...safeUser } = user;

  const body = { accessToken, isNewUser, user: safeUser };
  if (stepUp) body.stepUp = true;

  if (wantsCookieAuth(req)) {
    // Web: refresh token lives only in the httpOnly cookie, never in JS.
    setRefreshCookie(res, refreshToken);
    const csrf = generateCsrfToken();
    setCsrfCookie(res, csrf);
    body.csrfToken = csrf;
  } else {
    body.refreshToken = refreshToken; // mobile: body token → SecureStore
  }

  return { body, userId: user.id, isNewUser };
}
