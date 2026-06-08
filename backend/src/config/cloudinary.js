import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import streamifier from 'streamifier';
import { ENV } from './env.js';

cloudinary.config({
  cloud_name: ENV.CLOUDINARY_CLOUD_NAME,
  api_key:    ENV.CLOUDINARY_API_KEY,
  api_secret: ENV.CLOUDINARY_API_SECRET,
});

// ── Global media compression ────────────────────────────────────────────────
// These are applied as Cloudinary *incoming* transformations, meaning the
// COMPRESSED result is what gets stored — the heavy original is discarded.
// That keeps storage + bandwidth low even when a user uploads a large file.
//
// Every image/video in the app is uploaded through the helpers in this file
// (uploadBuffer / uploadFiles / uploadVideoBuffer), so changing the numbers
// here changes compression app-wide. One place, global effect.
export const MEDIA_COMPRESSION = {
  image: {
    maxWidth: 1080,        // cap longest edge — plenty for phone screens
    quality: 'auto:eco',   // aggressive perceptual compression
    format: 'jpg',         // also normalises HEIC/PNG → jpg
  },
  video: {
    maxWidth: 1280,
    maxHeight: 720,        // cap at 720p — big saving vs 1080p/4K phone video
    quality: 'auto:eco',
    videoCodec: 'h264',    // widely compatible + efficient
    bitRate: '2m',         // ~2 Mbps ceiling bounds the stored size
    format: 'mp4',
  },
};

// Store files in memory, then stream to Cloudinary manually
const memoryStorage = multer.memoryStorage();

/**
 * Returns multer middleware that stores files in memory.
 * After this runs, call uploadFiles(req.files, folder) to push to Cloudinary.
 */
export function createUploader(maxFiles = 5) {
  return multer({
    storage: memoryStorage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per file (frontend compresses before upload)
    fileFilter: (_req, file, cb) => {
      // Accept any image type — frontend compresses + converts to JPEG before sending.
      // Cloudinary also handles server-side format conversion as a safety net.
      if (!file.mimetype?.startsWith('image/')) {
        return cb(new Error('Only image files are allowed'));
      }
      cb(null, true);
    },
  }).array('images', maxFiles);
}

/**
 * Creates a multer middleware for a SINGLE file upload.
 * Accepts any field name — frontend sends 'file', 'image', or 'avatar'.
 */
export function createAvatarUploader() {
  return multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB for avatar (frontend compresses to ~200KB)
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype?.startsWith('image/')) {
        return cb(new Error('Only image files are allowed'));
      }
      cb(null, true);
    },
  }).any(); // Accept any field name — frontend sends 'file', onboarding may send 'avatar'
}

/**
 * Upload a single buffer to Cloudinary. Returns the secure URL.
 */
export function uploadBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Cloudinary upload timed out')), 55000);

    const C = MEDIA_COMPRESSION.image;
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `farmeasy/${folder}`,
        // Incoming transformation → the compressed JPEG is what gets stored.
        // Also converts HEIC/HEIF/PNG → jpg automatically.
        format: C.format,
        transformation: [{ width: C.maxWidth, crop: 'limit', quality: C.quality }],
      },
      (err, result) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

/**
 * Upload all req.files buffers to Cloudinary. Returns array of secure URLs.
 * Returns [] silently if Cloudinary is not configured (safe in dev).
 */
export async function uploadFiles(files = [], folder) {
  if (!files.length) return [];
  if (!ENV.CLOUDINARY_CLOUD_NAME) {
    console.warn('[Cloudinary] Not configured — skipping upload');
    return [];
  }
  return Promise.all(files.map((f) => uploadBuffer(f.buffer, folder)));
}

/**
 * Upload a video buffer to Cloudinary. Returns the secure URL.
 */
export function uploadVideoBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    if (!buffer || buffer.length < 4) {
      return reject(new Error('Invalid video buffer'));
    }

    const timer = setTimeout(() => reject(new Error('Cloudinary video upload timed out')), 110000);

    const C = MEDIA_COMPRESSION.video;
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:        `farmeasy/${folder}`,
        resource_type: 'video',
        // Incoming transformation re-encodes BEFORE storing, so a 100 MB phone
        // clip is stored as a compact 720p / h264 / ~2 Mbps mp4 instead.
        format: C.format,
        transformation: [{
          width: C.maxWidth, height: C.maxHeight, crop: 'limit',
          quality: C.quality, video_codec: C.videoCodec, bit_rate: C.bitRate,
        }],
      },
      (err, result) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ── Private (authenticated) storage for KYC / ID documents ───────────────────
// Regular uploads above use the default `type: 'upload'`, which serves assets
// from the PUBLIC CDN — anyone with the URL can fetch them. KYC documents (ID
// proofs) must NOT be public. These helpers upload with `type: 'authenticated'`
// so the asset is never reachable via a plain URL: it can only be delivered
// through a short-lived SIGNED url (see signedPrivateUrl). We persist the
// Cloudinary `public_id` (an opaque storage reference), never a public URL, so
// access always has to go back through the signing + authz path.

/** Default lifetime of a KYC signed URL. Short by design — re-sign on demand. */
export const KYC_SIGNED_URL_TTL_SEC = 5 * 60; // 5 minutes

/**
 * Upload a single buffer PRIVATELY. Returns the Cloudinary `public_id`
 * (a reference, NOT a fetchable URL).
 */
export function uploadPrivateBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Cloudinary upload timed out')), 55000);

    const C = MEDIA_COMPRESSION.image;
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:        `farmeasy/${folder}`,
        type:          'authenticated', // private — not served from the public CDN
        format:        C.format,
        transformation: [{ width: C.maxWidth, crop: 'limit', quality: C.quality }],
      },
      (err, result) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(result.public_id);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

/**
 * Upload all req.files buffers privately. Returns an array of `public_id`s.
 * Throws if Cloudinary is not configured — KYC must never silently no-op into
 * an empty/plaintext state (unlike best-effort public media uploads).
 */
export async function uploadPrivateFiles(files = [], folder) {
  if (!files.length) return [];
  if (!ENV.CLOUDINARY_CLOUD_NAME) {
    throw new Error('Cloudinary is not configured — cannot store KYC documents securely');
  }
  return Promise.all(files.map((f) => uploadPrivateBuffer(f.buffer, folder)));
}

/**
 * Generate a short-lived SIGNED, EXPIRING URL for a privately-stored asset.
 * Uses Cloudinary's private_download_url, whose signature includes the
 * `expires_at` timestamp — so the URL stops working once it lapses, and any
 * tampering invalidates the signature. A plain/public request for an
 * authenticated asset (no signature) is rejected by Cloudinary (401).
 *
 * NOTE: `cloudinary.url({ sign_url, expires_at })` does NOT bind the expiry
 * into the signature (it produces a non-expiring URL), which is why we use
 * private_download_url here instead.
 *
 * Uploads are normalised to JPEG (see MEDIA_COMPRESSION.image.format), so the
 * stored asset format is 'jpg'.
 */
export function signedPrivateUrl(
  publicId,
  { expiresInSec = KYC_SIGNED_URL_TTL_SEC, resourceType = 'image', format = 'jpg' } = {},
) {
  if (!publicId) return null;
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type:          'authenticated',
    expires_at:    Math.floor(Date.now() / 1000) + expiresInSec,
  });
}

export function createVideoUploader() {
  return multer({
    storage: memoryStorage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
    fileFilter: (_req, file, cb) => {
      if (!/video\/(mp4|mov|avi|quicktime|x-msvideo)/.test(file.mimetype)) {
        return cb(new Error('Only MP4, MOV, AVI videos are allowed'));
      }
      cb(null, true);
    },
  }).single('video');
}

// ── Asset deletion (used by account erasure / right-to-erasure) ──────────────

/**
 * Extract the Cloudinary public_id from a stored secure_url.
 * Returns null for non-Cloudinary strings. Our uploads carry no delivery-time
 * transformations, so the path is simply
 *   /<cloud>/<resource_type>/<type>/v<version>/<folder>/<name>.<ext>
 */
export function publicIdFromUrl(url) {
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com')) return null;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const typeIdx = parts.findIndex((p) => ['upload', 'authenticated', 'private', 'fetch'].includes(p));
    if (typeIdx === -1) return null;
    // Drop everything up to and including the delivery type, plus the version.
    const rest = parts.slice(typeIdx + 1).filter((p) => !/^v\d+$/.test(p));
    if (!rest.length) return null;
    return rest.join('/').replace(/\.[^/.]+$/, ''); // strip file extension
  } catch {
    return null;
  }
}

/**
 * Best-effort delete of a single asset by public_id. Never throws — erasure
 * must continue even if one asset is already gone or Cloudinary is unreachable.
 * Returns true on confirmed delete.
 */
export async function destroyAsset(publicId, { resourceType = 'image', type = 'upload' } = {}) {
  if (!publicId || !ENV.CLOUDINARY_CLOUD_NAME) return false;
  try {
    const res = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type,
      invalidate: true, // purge CDN cache too
    });
    return res?.result === 'ok' || res?.result === 'not found';
  } catch (err) {
    console.warn(`[Cloudinary] destroy failed for ${publicId}: ${err.message}`);
    return false;
  }
}

export { cloudinary };
