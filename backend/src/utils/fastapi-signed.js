/**
 * Express → FastAPI signed fetch helper
 *
 * Every request to the FastAPI AI service is signed with an HMAC-SHA256
 * over the timestamp, method, path, and body-hash so the FastAPI Railway
 * URL cannot be hit directly from outside Express. The contract matches
 * fastapi/security/auth.py exactly — keep them in lockstep.
 *
 * Header contract
 *   X-Sig-Timestamp : <unix epoch seconds, as string>
 *   X-Sig-Signature : hex(HMAC-SHA256(secret, `${ts}.${METHOD}.${path}.${body_sha256}`))
 *   x-user-id       : optional, forwarded from req.user.id
 *   x-request-id    : optional, propagated by FastAPI in response headers
 *   Idempotency-Key : optional, client-supplied or generated upstream
 */
import crypto from 'crypto';
import { ENV } from '../config/env.js';
import logger from './logger.js';
import { fastapiBreaker, httpFailure } from '../resilience/breakers.js';

const AI_BACKEND     = ENV.AI_BACKEND_URL || 'http://localhost:8001';
const SHARED_SECRET  = ENV.AI_SHARED_SECRET || '';
const DEFAULT_TIMEOUT_MS = 90_000;

function _sign(method, path, bodyBuffer) {
  const ts       = Math.floor(Date.now() / 1000).toString();
  const bodyHash = crypto.createHash('sha256').update(bodyBuffer || Buffer.alloc(0)).digest('hex');
  // Sign over the PATH ONLY (no query string). FastAPI verifies with
  // request.url.path, which excludes the query — so a signed GET carrying a
  // ?query would otherwise mismatch and 401. Keep both sides path-only.
  const cleanPath = String(path).split('?')[0];
  const message  = `${ts}.${method.toUpperCase()}.${cleanPath}.${bodyHash}`;
  const signature = crypto
    .createHmac('sha256', SHARED_SECRET)
    .update(message)
    .digest('hex');
  return { ts, signature };
}

/**
 * POST a JSON body to FastAPI and return the parsed { success, data, ... } envelope.
 * Throws an Error with .status when FastAPI returns non-2xx.
 *
 * @param {string} path        e.g. '/ai/scan'
 * @param {object} body        JSON-serialisable payload
 * @param {object} [options]
 * @param {string} [options.userId]         Forwarded as x-user-id
 * @param {string} [options.requestId]      Forwarded as x-request-id
 * @param {string} [options.idempotencyKey] Forwarded as Idempotency-Key
 * @param {number} [options.timeoutMs]      Default 90s
 */
export async function postSignedJSON(path, body, options = {}) {
  const {
    userId,
    requestId,
    idempotencyKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const rawBody = Buffer.from(JSON.stringify(body || {}), 'utf-8');
  const { ts, signature } = _sign('POST', path, rawBody);

  // Circuit breaker: when FastAPI is repeatedly failing, short-circuit instead of
  // queueing more 90s calls behind a dead dependency. 4xx (e.g. 402 spend-cap)
  // are healthy-but-rejected and don't trip it (see httpFailure). Breaker timeout
  // is a backstop above the AbortController below.
  return fastapiBreaker().execute(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${AI_BACKEND}${path}`, {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'X-Sig-Timestamp': ts,
          'X-Sig-Signature': signature,
          ...(userId         ? { 'x-user-id':       userId }         : {}),
          ...(requestId      ? { 'x-request-id':    requestId }      : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body:   rawBody,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ detail: `FastAPI ${resp.status}` }));
        // Surface FastAPI's structured 402 detail (cap_usd, resets_at_utc, etc.)
        // FastAPI routes are inconsistent: HTTPException uses `detail`, while
        // some JSONResponse handlers (chat) use `error`. Fall back across both
        // so the real upstream reason isn't lost as a generic status string.
        const detail = errBody.detail ?? errBody.error;
        const err = new Error(
          typeof detail === 'string'
            ? detail
            : (detail?.message || detail?.code || errBody.error || `AI backend returned ${resp.status}`)
        );
        err.status = resp.status;
        err.detail = detail;
        throw err;
      }
      return await resp.json();
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`FastAPI ${path} timed out after ${timeoutMs}ms`);
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      throw err;
    }
  }, { isFailure: httpFailure, timeoutMs: timeoutMs + 5_000 });
}

/**
 * GET request to FastAPI. Same signing scheme over an empty body.
 */
export async function getSigned(path, options = {}) {
  const {
    userId,
    requestId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const { ts, signature } = _sign('GET', path, Buffer.alloc(0));

  return fastapiBreaker().execute(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${AI_BACKEND}${path}`, {
        method:  'GET',
        headers: {
          'X-Sig-Timestamp': ts,
          'X-Sig-Signature': signature,
          ...(userId    ? { 'x-user-id':    userId }    : {}),
          ...(requestId ? { 'x-request-id': requestId } : {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ detail: `FastAPI ${resp.status}` }));
        // FastAPI routes are inconsistent: HTTPException uses `detail`, while
        // some JSONResponse handlers (chat) use `error`. Fall back across both
        // so the real upstream reason isn't lost as a generic status string.
        const detail = errBody.detail ?? errBody.error;
        const err = new Error(
          typeof detail === 'string'
            ? detail
            : (detail?.message || detail?.code || errBody.error || `AI backend returned ${resp.status}`)
        );
        err.status = resp.status;
        err.detail = detail;
        throw err;
      }
      return await resp.json();
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`FastAPI ${path} timed out after ${timeoutMs}ms`);
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      throw err;
    }
  }, { isFailure: httpFailure, timeoutMs: timeoutMs + 5_000 });
}

/**
 * Convenience wrapper that preserves the existing callFastAPI() shape
 * (returns the inner .data field directly). Used to keep route handlers
 * minimally changed while migrating.
 */
export async function callFastAPI(path, body, userId, timeoutMs, requestId) {
  if (!SHARED_SECRET && process.env.NODE_ENV === 'production') {
    logger.warn('[FastAPI] AI_SHARED_SECRET not set — requests will be rejected if FastAPI enforces auth');
  }
  const envelope = await postSignedJSON(path, body, { userId, timeoutMs, requestId });
  return envelope?.data;
}

/**
 * Stream a signed POST to a FastAPI SSE endpoint, invoking onEvent(obj) for each
 * parsed `data:` JSON frame. Resolves when the stream ends.
 *
 * Deliberately bypasses the circuit breaker: it's a latency-optimisation path
 * (voice streaming) with a non-streaming fallback, and a long-lived stream doesn't
 * fit the breaker's per-call timeout model. Request signing is identical to a
 * normal POST — only the RESPONSE is streamed, so the HMAC contract is unchanged.
 *
 * @param {string}   path      e.g. '/ai/chat/stream'
 * @param {object}   body      JSON-serialisable payload
 * @param {object}   options   { userId, requestId, timeoutMs }
 * @param {(evt:object)=>void|Promise<void>} onEvent  called per SSE frame (awaited)
 */
export async function streamSignedSSE(path, body, options = {}, onEvent = () => {}) {
  const { userId, requestId, timeoutMs = 90_000 } = options;
  const rawBody = Buffer.from(JSON.stringify(body || {}), 'utf-8');
  const { ts, signature } = _sign('POST', path, rawBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${AI_BACKEND}${path}`, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'Accept':          'text/event-stream',
        'X-Sig-Timestamp': ts,
        'X-Sig-Signature': signature,
        ...(userId    ? { 'x-user-id':    userId }    : {}),
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body:   rawBody,
      signal: controller.signal,
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(`FastAPI ${path} stream ${resp.status}: ${errText.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }

    // Parse SSE frames (separated by a blank line) out of the byte stream.
    // An onEvent that THROWS (e.g. the caller cancelling) propagates out so the
    // catch below aborts the upstream request — that closes the read side and
    // tells FastAPI to stop generating, instead of letting it run to completion.
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of resp.body) {
      buf += decoder.decode(chunk, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;
        let parsed;
        try { parsed = JSON.parse(json); }
        catch { logger.warn('[FastAPI stream] dropping malformed frame'); continue; }
        // A throw from onEvent (e.g. caller cancellation) is intentional — let it
        // propagate to the catch below so the upstream request is aborted.
        await onEvent(parsed);
      }
    }
  } catch (err) {
    // Stop reading the upstream stream now (cancellation or a malformed frame).
    try { controller.abort(); } catch { /* ignore */ }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
