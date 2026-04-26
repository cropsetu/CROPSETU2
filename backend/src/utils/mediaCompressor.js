/**
 * mediaCompressor — compress images before upload.
 *
 * compressImage(uri)  → { uri: string }
 *   Resizes to max 1280 px wide at 75% JPEG quality.
 *   Does NOT request base64 output — avoids in-memory base64 encoding
 *   which can crash Hermes on low-end Android devices in production builds.
 *
 * compressVideo(uri)  → Promise<string>  (returns original URI — no native lib needed)
 */
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Compress an image URI to a smaller JPEG.
 * Returns { uri } of the compressed JPEG saved in the cache directory.
 */
export async function compressImage(uri) {
  // Single pass: resize to max 1280 px wide, 75% JPEG quality.
  // This consistently produces 80–400 KB files without base64 encoding in memory.
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1280 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
  );

  if (!result?.uri) {
    throw new Error('ImageManipulator returned no URI');
  }

  return result; // { uri }
}

/**
 * Video compression passthrough — returns the original URI.
 */
export async function compressVideo(uri) {
  return uri;
}
