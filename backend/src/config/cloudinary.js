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

export { cloudinary };
