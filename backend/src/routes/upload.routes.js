/**
 * Upload Routes
 * POST /upload/image  — accepts { base64: string } JSON → returns { url }
 * POST /upload/video  — accepts multipart video file  → returns { url }
 */
import { Router } from 'express';
import { uploadBuffer, uploadVideoBuffer, createVideoUploader } from '../config/cloudinary.js';
import { authenticate } from '../middleware/auth.js';
import { imageUploadLimit, videoUploadLimit } from '../middleware/uploadLimit.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { ENV } from '../config/env.js';
import { assertUploadableImage } from '../utils/imageSniff.js';
import logger from '../utils/logger.js';

const router = Router();



router.post('/image', authenticate, imageUploadLimit, async (req, res) => {
  const { base64 } = req.body;
  if (!base64 || typeof base64 !== 'string') {
    return sendError(res, 'base64 image data is required', 400);
  }

  // Cheap early reject on the DECLARED type. Kept only because it costs nothing
  // and gives a clearer message for an obviously-wrong payload; it proves
  // nothing, since the prefix is written by the caller and can simply be omitted.
  // The real check is the magic-byte sniff below.
  if (base64.startsWith('data:') && !base64.startsWith('data:image/')) {
    return sendError(res, 'Only image files are allowed', 400);
  }

  // Guard: base64 string length → ~75% of raw bytes; 8 MB raw = ~10.9 MB base64
  // Reject anything that would decode to more than 8 MB to match multer's limit.
  const MAX_BASE64_LEN = Math.ceil(8 * 1024 * 1024 * 4 / 3); // ≈ 10,923,008 chars

  let buffer;
  try {
    // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;

    if (raw.length > MAX_BASE64_LEN) {
      return sendError(res, 'Image exceeds 8 MB limit', 413);
    }

    buffer = Buffer.from(raw, 'base64');

    // Double-check decoded size (padding can cause slight over-estimate above)
    if (buffer.length > 8 * 1024 * 1024) {
      return sendError(res, 'Image exceeds 8 MB limit', 413);
    }

    // WHAT THE BYTES ACTUALLY ARE. The declared content type is attacker-supplied
    // and the prefix check above is skipped entirely for a payload sent without
    // one, so this is the first point anything verifies the upload is an image.
    // It runs BEFORE the Cloudinary branch below on purpose: re-encoding on
    // upload does neutralise most payloads, but that mitigation disappears the
    // moment CLOUDINARY_CLOUD_NAME is unset, and a validation rule that depends
    // on deployment configuration is not a validation rule.
    assertUploadableImage(buffer);
  } catch (e) {
    if (e?.expose) {
      logger.warn({ userId: req.user?.id, sniffed: e.sniffed ?? null }, '[Upload] rejected a non-image payload');
      return sendError(res, e.message, e.statusCode || 400);
    }
    console.error('[Upload] decode error:', e.message);
    return sendError(res, 'Image upload failed', 500);
  }

  // Dev fallback when Cloudinary is not configured
  if (!ENV.CLOUDINARY_CLOUD_NAME) {
    console.warn('[Upload] Cloudinary not configured — returning placeholder URL');
    return sendSuccess(res, { url: 'https://placehold.co/400x400/E65100/fff?text=Product' });
  }

  try {
    const url = await uploadBuffer(buffer, 'products');
    return sendSuccess(res, { url });
  } catch (e) {
    console.error('[Upload] Cloudinary error:', e.message);
    return sendError(res, 'Image upload failed', 500);
  }
});

// ── POST /upload/video ────────────────────────────────────────────────────────
const videoUpload = createVideoUploader();

/**
 * Per-process ceiling on video uploads that are BUFFERING.
 *
 * multer uses memoryStorage, so an in-flight upload holds the entire file in
 * this process — up to the 100 MB `fileSize` limit, with a transient ~2x while
 * concat-stream joins the chunks. Measured with a local probe: five concurrent
 * 99 MB uploads took the process from 85 MB RSS to 1,073 MB, and ten took it to
 * 1,202 MB. A REJECTED oversize upload costs the same, because multer only
 * errors once it has read past the limit.
 *
 * The hourly rate limiter above does not help. It is a per-user COUNTER, not a
 * concurrency gate: twenty requests from one account in the same second are all
 * admitted. Nothing else in the path gates simultaneity either.
 *
 * Be honest about the bound, though. The scary version of this — "one account's
 * hourly allowance in parallel is 2 GB" — is not reachable, because memory only
 * accrues as bytes actually arrive and the socket timeout is 130 s. The real
 * ceiling is roughly attacker_uplink x 130 s, which from any cloud host is still
 * comfortably ~1 GB. That is enough to OOM a typical container, and because
 * these are Buffers they live in external/ArrayBuffer memory rather than the V8
 * old space, so --max-old-space-size would never see it coming. The failure mode
 * is the replica being killed, taking every other in-flight request and every
 * Socket.IO connection on it down too.
 *
 * SHED rather than queue: holding a request open to wait for a slot keeps its
 * socket, and would convert a memory problem into a connection problem.
 *
 * Per-process on purpose. The resource being protected is one process's memory,
 * so with N replicas the fleet ceiling is N x this. Do not "fix" that into a
 * Redis counter — it would add a network round trip and a fail-open question in
 * front of the one route whose whole problem is that it is already expensive.
 */
let videoInFlight = 0;

/** Test-only: lets the ceiling and the counter be asserted rather than assumed. */
export function videoInFlightCount() { return videoInFlight; }

// Exported for tests. The guard's whole risk is counter drift on abnormal exit
// paths — client aborts, multer rejects, handler throws — and those are far more
// reliably driven against a fake response than by racing real HTTP requests.
export function videoInFlightGuard(req, res, next) {
  if (videoInFlight >= ENV.UPLOAD_VIDEO_MAX_INFLIGHT) {
    logger.warn('[Upload] video shed — %d in flight at ceiling %d',
      videoInFlight, ENV.UPLOAD_VIDEO_MAX_INFLIGHT);
    res.setHeader('Retry-After', '10');
    return sendError(res, 'Too many video uploads in progress. Please try again in a moment.', 503);
  }
  videoInFlight += 1;
  // 'close' on the RESPONSE fires on every exit: success, handler throw, multer
  // reject, client abort mid-body, and socket-timeout destroy. `once` so a
  // double-fire cannot drive the counter negative — which would silently widen
  // the ceiling — and a missed decrement cannot ratchet it shut.
  res.once('close', () => { videoInFlight -= 1; });
  return next();
}

// Both guards run BEFORE multer on purpose: a rejected request must not first
// buffer a 100 MB video into this process's memory.
router.post('/video', authenticate, videoUploadLimit, videoInFlightGuard, (req, res, next) => {
  videoUpload(req, res, (err) => {
    if (err) return sendError(res, err.message || 'Video upload error', 400);
    next();
  });
}, async (req, res) => {
  if (!req.file) return sendError(res, 'video file is required', 400);

  if (!ENV.CLOUDINARY_CLOUD_NAME) {
    console.warn('[Upload] Cloudinary not configured — returning placeholder URL');
    return sendSuccess(res, { url: 'https://placehold.co/400x300/1A1A1A/fff?text=Video' });
  }

  try {
    const url = await uploadVideoBuffer(req.file.buffer, 'rent-videos');
    return sendSuccess(res, { url });
  } catch (e) {
    console.error('[Upload] Video Cloudinary error:', e.message);
    return sendError(res, 'Video upload failed', 500);
  }
});

// ── Known and deliberately NOT guarded: the image uploaders ──────────────────
// createUploader (config/cloudinary.js) is the same memoryStorage, used by
// animaltrade, community, user, groups and /upload/image, at 15 MB per file
// rather than 100 MB. They share the same absence of a concurrency gate.
//
// Left alone under §73. The exposure is ~7x smaller per request, those routes
// carry their own per-user hourly limits, and adding admission control to five
// more live paths to pre-empt a problem nobody has measured is a larger change
// than the one it protects against. Revisit if image upload ever shows up in a
// memory profile — the guard above is the shape to copy.
export default router;
