/**
 * Per-user ceilings for anything that reaches Cloudinary (AI-08).
 *
 * Lives here rather than in upload.routes.js because /upload/* is not the only
 * door: community posts, group avatars, animal listings and profile photos all
 * call `uploadFiles` on their own routes. Limiting only /upload/* would have
 * left five unbounded paths to the same billed account, so the ceiling has to be
 * a shared control rather than one route's local concern.
 *
 * Keyed on the USER, not the IP. Rural carriers CGNAT aggressively, so an IP
 * bucket punishes a whole village for one abuser and simultaneously lets that
 * abuser hide among them. Every consumer mounts `authenticate` first, so
 * `req.user.id` is present; a request without one is passed through, because the
 * route's own auth will reject it a moment later and inventing a null-key bucket
 * would collapse every anonymous caller into one shared counter.
 *
 * Tiered by persona rather than exempting one:
 *   ADMIN  — uncapped. An operator clearing a moderation queue must not be
 *            throttled by a farmer's ceiling.
 *   SELLER — its own higher tier. The seller app uploads 5 images per product,
 *            so the farmer ceiling would stall a first-time catalogue halfway
 *            through and break the workflow that app exists for.
 *   others — the farmer tier.
 */
import { rateLimiter } from './rateLimit.js';
import { ENV } from '../config/env.js';

const WINDOW_MS = 60 * 60 * 1000;

function build(max, prefix) {
  return rateLimiter({
    windowMs: WINDOW_MS,
    max,
    prefix,
    key: (req) => req.user?.id || null,
    message: 'Upload limit reached. Please try again later.',
  });
}

function tiered(farmerMax, sellerMax, prefix) {
  const farmerLimit = build(farmerMax, prefix);
  const sellerLimit = build(sellerMax, `${prefix}:seller`);
  return (req, res, next) => {
    const role = req.user?.role;
    if (role === 'ADMIN') return next();
    return (role === 'SELLER' ? sellerLimit : farmerLimit)(req, res, next);
  };
}

/** Mount BEFORE any multer/uploader middleware, so a refusal never buffers the body. */
export const imageUploadLimit = tiered(
  ENV.UPLOAD_IMAGE_MAX_PER_HOUR,
  ENV.UPLOAD_IMAGE_MAX_PER_HOUR_SELLER,
  'upload:image',
);

export const videoUploadLimit = tiered(
  ENV.UPLOAD_VIDEO_MAX_PER_HOUR,
  ENV.UPLOAD_VIDEO_MAX_PER_HOUR_SELLER,
  'upload:video',
);
