/**
 * Idempotency middleware for non-idempotent AI POSTs (/ai/chat, /ai/voice).
 *
 * Mobile networks + the axios 401-refresh-and-replay make duplicate POSTs common.
 * Without this, a replay = a SECOND LLM call + a SECOND credit charge + a
 * duplicate persisted message. The client sends one `Idempotency-Key` per *send
 * action* (reused on the 401-replay); we cache the first successful response and
 * replay it verbatim for any duplicate, never re-calling the LLM or re-charging.
 *
 * Redis-backed (shared across instances), keyed by feature + userId + client key.
 * Fails OPEN (proceeds normally) when no key is sent or Redis is unavailable.
 */
import redis from '../config/redis.js';
import logger from '../utils/logger.js';
import { sendError } from '../utils/response.js';

const TTL_SEC = 86_400; // 24h — long enough to cover retries, short enough to bound storage

export function idempotency(feature) {
  return async (req, res, next) => {
    const clientKey = req.header('Idempotency-Key');
    // No key, or Redis not ready → no protection, just proceed (fail-open).
    if (!clientKey || redis?.status !== 'ready') return next();

    const key = `idem:${feature}:${req.user?.id || 'anon'}:${clientKey}`;

    // 1) Replay a completed response, or reject an in-flight duplicate.
    try {
      const prior = await redis.get(key);
      if (prior) {
        const rec = JSON.parse(prior);
        if (rec.status === 'COMPLETED') {
          res.setHeader('Idempotent-Replay', 'true');
          return res.status(rec.httpStatus || 200).json(rec.body);
        }
        return sendError(res, 'A duplicate request is still being processed. Please wait.', 409);
      }
    } catch (err) {
      logger.warn('[Idempotency] read failed, proceeding: %s', err.message);
      return next();
    }

    // 2) Claim the key atomically; if we lose the race, it's a concurrent duplicate.
    try {
      const ok = await redis.set(key, JSON.stringify({ status: 'IN_PROGRESS' }), 'EX', TTL_SEC, 'NX');
      if (ok !== 'OK') {
        return sendError(res, 'A duplicate request is still being processed. Please wait.', 409);
      }
    } catch (err) {
      logger.warn('[Idempotency] claim failed, proceeding: %s', err.message);
      return next();
    }

    // 3) Capture the handler's response. Cache only SUCCESS (2xx); on failure,
    //    release the claim so the client can legitimately retry.
    const origJson = res.json.bind(res);
    res.json = (body) => {
      const httpStatus = res.statusCode || 200;
      if (httpStatus >= 200 && httpStatus < 300) {
        redis.set(key, JSON.stringify({ status: 'COMPLETED', httpStatus, body }), 'EX', TTL_SEC)
          .catch((e) => logger.warn('[Idempotency] store failed: %s', e.message));
      } else {
        redis.del(key).catch(() => {});
      }
      return origJson(body);
    };
    return next();
  };
}
