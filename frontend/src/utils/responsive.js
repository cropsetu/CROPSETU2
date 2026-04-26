/**
 * Responsive Scaling Utilities — FarmEasy
 *
 * Base design: 390dp wide (iPhone 14 / Pixel 7-class)
 *
 * Usage:
 *   import { s, vs, fs, ms, HIT } from '../utils/responsive';
 *
 *   // Horizontal dimensions (width, horizontal padding/margin, border-radius)
 *   { width: s(48), paddingHorizontal: s(16) }
 *
 *   // Vertical dimensions (height, vertical padding/margin)
 *   { height: vs(56), paddingVertical: vs(12) }
 *
 *   // Font sizes — scales gently so text stays readable
 *   { fontSize: fs(15) }
 *
 *   // Moderate scale — icons, avatars (scales less aggressively)
 *   { width: ms(40), height: ms(40) }
 *
 *   // Touch target — ensures minimum 48dp tap area
 *   <TouchableOpacity hitSlop={HIT} style={{ minHeight: s(48) }}>
 */
import { Dimensions, PixelRatio, Platform } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Design base (iPhone 14 / mid-range Android)
const BASE_W = 390;
const BASE_H = 844;

const scaleX = SCREEN_W / BASE_W;
const scaleY = SCREEN_H / BASE_H;

/**
 * Horizontal scale — for widths, horizontal padding, margins, border-radius.
 * Rounds to nearest pixel for crisp rendering.
 */
export function s(size) {
  return PixelRatio.roundToNearestPixel(size * scaleX);
}

/**
 * Vertical scale — for heights, vertical padding, top/bottom spacing.
 */
export function vs(size) {
  return PixelRatio.roundToNearestPixel(size * scaleY);
}

/**
 * Moderate scale — scales less aggressively (50% of the delta).
 * Good for icons, avatars, and elements that shouldn't vary too much.
 */
export function ms(size, factor = 0.5) {
  return PixelRatio.roundToNearestPixel(size + (scaleX - 1) * size * factor);
}

/**
 * Font scale — gentle scaling so text stays readable on all devices.
 * Uses moderate scaling (30% of the delta) to prevent oversizing on tablets
 * or undersizing on small phones.
 */
export function fs(size) {
  return PixelRatio.roundToNearestPixel(size + (scaleX - 1) * size * 0.3);
}

/**
 * Minimum touch target (Material Design = 48dp).
 * Use as hitSlop on small touchables.
 */
export const MIN_TAP = 48;

export const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

/**
 * Screen dimensions (static snapshot at app launch).
 */
export const SCREEN = { W: SCREEN_W, H: SCREEN_H };

/**
 * isSmallDevice — true for screens narrower than 360dp (budget Androids).
 */
export const isSmallDevice = SCREEN_W < 360;

/**
 * isLargeDevice — true for screens wider than 430dp (Plus/Max/tablets).
 */
export const isLargeDevice = SCREEN_W > 430;
