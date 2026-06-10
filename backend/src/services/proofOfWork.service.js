/**
 * Proof-of-work gate for OTP send — deters automated enumeration / bulk abuse.
 *
 * Under suspicion (an IP that has already sent more than the suspicion threshold
 * of OTPs in the window, but is still under the hard AUTH-1 cap), /send-otp
 * demands a solved hashcash-style proof of work before it will send. A human
 * sending one code never sees it; a bot blasting many numbers must burn real CPU
 * for every send, turning a cheap flood into an expensive one. Pairs with the
 * AUTH-1 rate limits (which cap absolute volume) and FE-10 (client cooldown).
 *
 * Challenges are HMAC-signed so verification is STATELESS (no per-challenge DB
 * row). Single-use is enforced via a short-lived Redis marker (in-memory
 * fallback) so one solved challenge can't unlock many sends.
 *
 * Config is held in a mutable object so it can be toggled at runtime/in tests
 * (configureProofOfWork). Disabled whenever the secret is empty — fail-safe.
 */
import crypto from 'crypto';
import redis from '../config/redis.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';
import { sendError } from '../utils/response.js';

let _config = {
  secret:     ENV.OTP_POW_SECRET,
  difficulty: ENV.OTP_POW_DIFFICULTY,
  threshold:  ENV.OTP_POW_SUSPICION_THRESHOLD,
  ttlMs:      ENV.OTP_POW_CHALLENGE_TTL_MS,
  windowMs:   ENV.OTP_RATE_LIMIT_WINDOW_MS,
};

/** Override config (runtime tuning / tests). Unspecified keys keep their value. */
export function configureProofOfWork(overrides = {}) {
  _config = { ..._config, ...overrides };
}

/** True when the gate is active (a signing secret is configured). */
export function isPowEnabled() {
  return !!_config.secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', _config.secret).update(payload).digest('hex');
}

/**
 * Issue a fresh challenge bound to `scope` (e.g. the client IP), so a challenge
 * solved for one scope can't be replayed from another.
 * @returns {{ challenge, difficulty, exp, sig }}
 */
export function issueChallenge(scope) {
  const challenge  = crypto.randomBytes(16).toString('hex');
  const difficulty = _config.difficulty;
  const exp        = Date.now() + _config.ttlMs;
  const sig        = sign(`${challenge}.${difficulty}.${exp}.${scope}`);
  return { challenge, difficulty, exp, sig };
}

/** Count leading zero BITS of a hex digest. */
export function leadingZeroBits(hex) {
  let bits = 0;
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (nibble === 0) { bits += 4; continue; }
    bits += Math.clz32(nibble) - 28; // leading zeros within the 4-bit nibble
    break;
  }
  return bits;
}

// ── Single-use marker ──────────────────────────────────────────────────────────
// In-memory fallback for when Redis is down. Hard-bounded so a high solve rate
// can't grow it without limit: prune expired first, then FIFO-evict the oldest
// if still over cap (expired-only pruning leaks when entries are all live).
const _usedMem = new Map(); // challenge -> expiry ms
const MEM_MAX_ENTRIES = 10000;

function memMarkUsed(challenge) {
  const now = Date.now();
  if (_usedMem.size >= MEM_MAX_ENTRIES) {
    for (const [k, exp] of _usedMem) if (exp <= now) _usedMem.delete(k);
    while (_usedMem.size >= MEM_MAX_ENTRIES) {
      const oldest = _usedMem.keys().next().value; // FIFO eviction
      _usedMem.delete(oldest);
    }
  }
  if ((_usedMem.get(challenge) || 0) > now) return false; // already used
  _usedMem.set(challenge, now + _config.ttlMs);
  return true;
}

async function markUsedOnce(challenge) {
  if (redis?.status === 'ready') {
    try {
      // Atomic set-if-absent with TTL: 'OK' on first use, null if it existed.
      const ok = await redis.set(`pow:used:${challenge}`, '1', 'PX', _config.ttlMs, 'NX');
      return ok === 'OK';
    } catch (err) {
      logger.warn('[PoW] redis single-use check failed, using memory: %s', err.message);
    }
  }
  return memMarkUsed(challenge);
}

/**
 * Verify a submitted solution against `scope`.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function verifySolution(sol, scope) {
  if (!sol || typeof sol !== 'object') return { ok: false, reason: 'missing' };
  const { challenge, difficulty, exp, sig, nonce } = sol;
  if (typeof challenge !== 'string' || typeof sig !== 'string'
      || !Number.isInteger(difficulty) || !Number.isInteger(exp) || nonce == null) {
    return { ok: false, reason: 'malformed' };
  }
  if (Date.now() > exp) return { ok: false, reason: 'expired' };
  // Don't accept a self-chosen weaker difficulty than we currently require.
  if (difficulty < _config.difficulty) return { ok: false, reason: 'too-easy' };

  // The signature proves WE issued this exact challenge for this scope.
  const expected = sign(`${challenge}.${difficulty}.${exp}.${scope}`);
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }

  // The work: sha256(challenge.nonce) must have `difficulty` leading zero bits.
  const hash = crypto.createHash('sha256').update(`${challenge}.${String(nonce)}`).digest('hex');
  if (leadingZeroBits(hash) < difficulty) return { ok: false, reason: 'insufficient-work' };

  // Single-use — block replaying one solved challenge across many sends.
  if (!(await markUsedOnce(challenge))) return { ok: false, reason: 'reused' };

  return { ok: true };
}

// ── Per-IP send counter (sliding window) used to decide "suspicion" ─────────────
// In-memory fallback (Redis preferred). Bounded two ways so a flood of unique
// IPs can't leak: keys whose window has fully aged out are dropped, and the key
// count is FIFO-capped.
let _seq = 0;
const _hitsMem = new Map(); // key -> sorted timestamps

function memPeek(key, now) {
  const cutoff = now - _config.windowMs;
  const hits = (_hitsMem.get(key) || []).filter((ts) => ts > cutoff);
  if (hits.length === 0) _hitsMem.delete(key); // reap idle IPs instead of leaking empties
  else _hitsMem.set(key, hits);
  return hits.length;
}
function memRecord(key, now) {
  if (!_hitsMem.has(key) && _hitsMem.size >= MEM_MAX_ENTRIES) {
    const oldest = _hitsMem.keys().next().value; // FIFO eviction under sustained load
    _hitsMem.delete(oldest);
  }
  const hits = _hitsMem.get(key) || [];
  hits.push(now);
  _hitsMem.set(key, hits);
}

async function peekSendCount(ip) {
  const key = `pow:otp:ip:${ip}`;
  const now = Date.now();
  if (redis?.status === 'ready') {
    try {
      await redis.zremrangebyscore(key, 0, now - _config.windowMs);
      return await redis.zcard(key);
    } catch (err) {
      logger.warn('[PoW] redis peek failed, using memory: %s', err.message);
    }
  }
  return memPeek(key, now);
}

async function recordSend(ip) {
  const key = `pow:otp:ip:${ip}`;
  const now = Date.now();
  if (redis?.status === 'ready') {
    try {
      await redis.multi().zadd(key, now, `${now}-${_seq++}`).pexpire(key, _config.windowMs).exec();
      return;
    } catch (err) {
      logger.warn('[PoW] redis record failed, using memory: %s', err.message);
    }
  }
  memRecord(key, now);
}

function parseSolution(req) {
  const raw = req.headers['x-otp-pow'] || req.body?.proofOfWork;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Express middleware: gate /send-otp behind proof-of-work once an IP looks
 * suspicious. Place this BEFORE the rate limiters so a challenge response doesn't
 * consume a rate-limit slot. No-op when disabled or when the IP is unresolvable.
 */
export async function otpPowGate(req, res, next) {
  if (!isPowEnabled()) return next();
  const ip = req.ip || req.socket?.remoteAddress;
  if (!ip) return next();

  const scope = `send-otp:${ip}`;
  try {
    const count = await peekSendCount(ip);

    // Below the suspicion threshold → let it through and record the send.
    if (count < _config.threshold) {
      await recordSend(ip);
      return next();
    }

    // Suspicious → require a valid, single-use proof of work.
    const sol = parseSolution(req);
    const result = sol ? await verifySolution(sol, scope) : { ok: false, reason: 'missing' };
    if (result.ok) {
      await recordSend(ip);
      return next();
    }

    res.setHeader('X-PoW-Required', '1');
    return sendError(
      res,
      'Please complete the verification challenge before requesting another code.',
      428, // Precondition Required
      { proofOfWork: issueChallenge(scope), reason: result.reason },
    );
  } catch (err) {
    // A gate failure must never lock legit users out — fail open. The AUTH-1
    // limiters downstream still cap absolute volume.
    logger.warn('[PoW] gate error, allowing request: %s', err.message);
    return next();
  }
}

/** Test-only: clear the in-memory suspicion + single-use stores. */
export function resetProofOfWorkStore() {
  _hitsMem.clear();
  _usedMem.clear();
}
