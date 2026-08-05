/**
 * Haptic feedback — cross-platform wrapper around expo-haptics.
 *
 * Uses the Taptic Engine on iOS (proper haptic grades) and
 * Vibration API on Android (best-effort approximation).
 *
 * Every call is fire-and-forget — a failed haptic must never
 * block or crash the UI thread.
 */
import * as ExpoHaptics from 'expo-haptics';
import { Platform } from 'react-native';

function safe(fn) {
  try { fn(); } catch { /* haptic failure is non-fatal */ }
}

export const Haptics = {
  /** Light tap — primary buttons, chip select, toggle */
  light() {
    safe(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light));
  },

  /** Medium tap — long-press menu open, drag start */
  medium() {
    safe(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium));
  },

  /** Heavy tap — destructive action confirm */
  heavy() {
    safe(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Heavy));
  },

  /** Selection tick — tab switch, picker change, toggle */
  selection() {
    safe(() => ExpoHaptics.selectionAsync());
  },

  /** Success — order placed, listing approved, upload complete */
  success() {
    safe(() => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success));
  },

  /** Error — validation failed, payment declined */
  error() {
    safe(() => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error));
  },

  /** Warning — approaching limit, low stock */
  warning() {
    safe(() => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning));
  },

  /** Alias for light — general tap feedback */
  tap() {
    safe(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light));
  },

  /** Navigation transition haptic */
  navigation() {
    safe(() => ExpoHaptics.selectionAsync());
  },
};
