/**
 * Upload Routes
 * POST /upload/image  — accepts { base64: string } JSON → returns { url }
 * POST /upload/video  — accepts multipart video file  → returns { url }
 */
import { Router } from 'express';
import { uploadBuffer, uploadVideoBuffer, createVideoUploader } from '../config/cloudinary.js';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { ENV } from '../config/env.js';
import { assertUploadableImage } from '../utils/imageSniff.js';
import logger from '../utils/logger.js';

const router = Router();

router.post('/image', authenticate, async (req, res) => {
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

router.post('/video', authenticate, (req, res, next) => {
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

export default router;
