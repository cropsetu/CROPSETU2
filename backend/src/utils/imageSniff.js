/**
 * Magic-byte sniffing for uploaded images.
 *
 * Every upload path used to trust the content type the CLIENT declared — the
 * `data:image/png;base64,` prefix on a JSON body, or the `Content-Type` header
 * on a multipart part. Both are attacker-authored strings, so "is this an
 * image?" was answered by the same party asking to store the file. Worse, the
 * base64 route skipped the check entirely when the payload carried no `data:`
 * prefix at all, which the surrounding code explicitly anticipates.
 *
 * The bytes are the only honest evidence. This reads the leading signature and
 * ignores whatever the caller claimed.
 *
 * SVG is rejected BY NAME rather than by simply falling off the allowlist: it is
 * a genuine image format that a caller can reasonably expect to work, and it is
 * also a script-bearing XML document. Anything serving it inline (a CDN with the
 * wrong Content-Disposition, a future `<img>`-to-`<object>` change, a direct link
 * pasted into a browser) turns a stored asset into stored XSS. The specific
 * message stops it being reported as a mystery rejection.
 */

/** Formats we are willing to store. Cloudinary re-encodes all three to JPEG. */
const ALLOWED = new Set(['jpeg', 'png', 'webp']);

const startsWithBytes = (buf, bytes, offset = 0) => {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
};

/**
 * Identify a buffer by its leading bytes.
 *
 * Returns a lowercase format name for everything it recognises, INCLUDING formats
 * we refuse to store — the caller needs the name to explain the refusal — or
 * `null` when the bytes match nothing known.
 *
 * @param {Buffer} buffer
 * @returns {?string} 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'svg' | 'heic' | 'tiff' | null
 */
export function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  // JPEG — SOI marker followed by any segment marker.
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  // PNG — 8-byte signature, deliberately including the CRLF/EOF trap bytes.
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // WebP — RIFF container whose form type is WEBP. Both halves matter: 'RIFF'
  // alone is also WAV and AVI.
  if (startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  if (startsWithBytes(buffer, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWithBytes(buffer, [0x42, 0x4d])) return 'bmp';
  // TIFF — little- and big-endian byte-order marks.
  if (startsWithBytes(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(buffer, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'tiff';
  }
  // HEIC/HEIF — ISO-BMFF `ftyp` box at offset 4, brand at offset 8.
  if (startsWithBytes(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }

  // SVG is text, so there is no fixed signature — sniff the opening markup past
  // any BOM or leading whitespace. Bounded to the first 1 KB: a real SVG declares
  // itself immediately, and scanning further would just be work done on behalf of
  // a payload that is being rejected anyway.
  const head = buffer.subarray(0, 1024).toString('latin1').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';

  return null;
}

/**
 * Throw unless the buffer really is a storable image.
 *
 * Errors are marked `expose` so the route's catch block can pass the reason
 * straight to the client — a rejected upload is only actionable if the user is
 * told which format to send.
 *
 * @param {Buffer} buffer
 * @throws {Error} statusCode 400 / expose
 */
export function assertUploadableImage(buffer) {
  const kind = sniffImageType(buffer);

  if (kind === 'svg') {
    throw Object.assign(
      new Error('SVG images are not accepted. Please upload a JPEG, PNG or WebP.'),
      { statusCode: 400, expose: true, sniffed: 'svg' },
    );
  }
  if (!kind) {
    throw Object.assign(
      new Error('That file is not a valid image. Please upload a JPEG, PNG or WebP.'),
      { statusCode: 400, expose: true, sniffed: null },
    );
  }
  if (!ALLOWED.has(kind)) {
    throw Object.assign(
      new Error(`${kind.toUpperCase()} images are not accepted. Please upload a JPEG, PNG or WebP.`),
      { statusCode: 400, expose: true, sniffed: kind },
    );
  }

  return kind;
}
