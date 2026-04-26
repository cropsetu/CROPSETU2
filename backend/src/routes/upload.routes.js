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

const router = Router();

router.post('/image', authenticate, async (req, res) => {
  const { base64 } = req.body;
  if (!base64 || typeof base64 !== 'string') {
    return sendError(res, 'base64 image data is required', 400);
  }

  // Accept any image type — frontend always compresses to JPEG before sending.
  // Cloudinary handles format conversion server-side as a safety net.
  if (base64.startsWith('data:') && !base64.startsWith('data:image/')) {
    return sendError(res, 'Only image files are allowed', 400);
  }

  // Dev fallback when Cloudinary is not configured
  if (!ENV.CLOUDINARY_CLOUD_NAME) {
    console.warn('[Upload] Cloudinary not configured — returning placeholder URL');
    return sendSuccess(res, { url: 'https://placehold.co/400x400/E65100/fff?text=Product' });
  }

  // Guard: base64 string length → ~75% of raw bytes; 8 MB raw = ~10.9 MB base64
  // Reject anything that would decode to more than 8 MB to match multer's limit.
  const MAX_BASE64_LEN = Math.ceil(8 * 1024 * 1024 * 4 / 3); // ≈ 10,923,008 chars

  try {
    // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;

    if (raw.length > MAX_BASE64_LEN) {
      return sendError(res, 'Image exceeds 8 MB limit', 413);
    }

    const buffer = Buffer.from(raw, 'base64');

    // Double-check decoded size (padding can cause slight over-estimate above)
    if (buffer.length > 8 * 1024 * 1024) {
      return sendError(res, 'Image exceeds 8 MB limit', 413);
    }

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
