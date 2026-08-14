/**
 * Derived image URLs for listing cards.
 *
 * Uploads are stored at up to 1080 px (see MEDIA_COMPRESSION in config/cloudinary.js).
 * The animal grid renders those at roughly 180 px wide, so every card was pulling
 * a ~150–300 KB photo to paint a thumbnail — 20 cards ≈ 4 MB on a 2G connection
 * before the first row is even readable.
 *
 * Cloudinary derives sizes from the URL path, so a thumbnail costs no upload, no
 * API call and no extra storage: inserting `f_auto,q_auto:eco,w_240,c_limit`
 * after `/upload/` yields a ~10–20 KB WebP/AVIF (f_auto picks the best format the
 * requesting client accepts). The transform is generated on the FIRST request and
 * CDN-cached from then on.
 *
 * Non-Cloudinary URLs (seed data, external links) are returned untouched, so a
 * listing whose images live elsewhere still renders — just without the saving.
 */

/** Widths we generate. `card` feeds the 2-column grid, `detail` the hero. */
export const IMAGE_WIDTHS = { card: 320, detail: 1080 };

const CLOUDINARY_UPLOAD = /(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/i;

/**
 * Build a derived URL at `width` for a Cloudinary image.
 *
 * `c_limit` only ever scales DOWN — an image already narrower than the target is
 * served as-is instead of being upscaled into a blurry, larger file.
 *
 * @param {string} url    stored secure_url
 * @param {number} width  target width in px
 * @returns {string} the derived URL, or the input unchanged when it is not a
 *                   Cloudinary upload URL / not a string
 */
export function imageVariant(url, width) {
  if (typeof url !== 'string') return url;
  const m = CLOUDINARY_UPLOAD.exec(url);
  if (!m) return url;
  const [, prefix, rest] = m;
  // Don't stack a second transform onto a URL that already carries ours.
  if (/^f_auto,q_auto/.test(rest)) return url;
  return `${prefix}f_auto,q_auto:eco,w_${width},c_limit/${rest}`;
}

/**
 * Card-sized variants for a listing's image array. Returns [] for anything that
 * isn't an array of http(s) strings, so a malformed `images` column can never
 * put a null into a FlatList.
 */
export function thumbnailsFor(images, width = IMAGE_WIDTHS.card) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .map((u) => imageVariant(u, width));
}
