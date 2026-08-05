/**
 * Motion Primitives — Reanimated v3 spring configs, AppPressable, useReducedMotion
 *
 * Every interactive animation in the app uses these shared configs.
 * All animations run on the UI thread via worklets — no JS thread involvement.
 */
import { useEffect, useCallback } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Easing,
  runOnJS,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { Haptics } from '../../utils/haptics';

// ── Spring Configs ───────────────────────────────────────────────────────────
// Physics-based, not duration-based. Every user-triggered motion uses springs.

export const SPRINGS = {
  /** Snappy tap feedback — buttons, chips, toggles */
  snappy:  { damping: 15, stiffness: 300, mass: 0.8 },

  /** Natural card/sheet movement */
  natural: { damping: 20, stiffness: 180, mass: 1 },

  /** Heavy modal, full-screen sheet */
  heavy:   { damping: 26, stiffness: 120, mass: 1.2 },

  /** Bouncy delight — success tick, heart pop */
  bouncy:  { damping: 10, stiffness: 220, mass: 0.9 },

  /** Gentle — entry animations, layout transitions */
  gentle:  { damping: 18, stiffness: 140, mass: 1 },
};

// ── Reduced Motion ───────────────────────────────────────────────────────────

let _reducedMotion = false;

// Subscribe at module load — always up to date
AccessibilityInfo.isReduceMotionEnabled?.()?.then?.(v => { _reducedMotion = !!v; });
AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => { _reducedMotion = !!v; });

/** Returns current reduced motion preference (sync, safe for worklets via runOnJS) */
export function isReducedMotion() {
  return _reducedMotion;
}

/**
 * Returns a spring or a timing config depending on reduced motion.
 * Reduced motion → 200ms crossfade. Normal → spring with given config.
 */
export function motionSpring(config = SPRINGS.snappy) {
  if (_reducedMotion) {
    return { duration: 200, easing: Easing.out(Easing.quad) };
  }
  return config;
}

// ── Entering / Exiting for reduced motion ────────────────────────────────────

export function enterAnimation(index = 0) {
  if (_reducedMotion) {
    return FadeIn.duration(200);
  }
  return FadeIn.duration(300).delay(Math.min(index * 50, 250))
    .springify().damping(18).stiffness(140);
}

// ── AppPressable ─────────────────────────────────────────────────────────────
// Single press primitive for the entire app.
// - iOS: scale + opacity spring feedback
// - Android: native ripple + scale
// - Disabled: no animation, no haptic
// - Feedback starts on pressIn (≤16ms), not onPress

export function AppPressable({
  children,
  onPress,
  onLongPress,
  disabled = false,
  haptic = 'light',
  scaleValue = 0.97,
  style,
  android_ripple,
  testID,
  accessibilityLabel,
  accessibilityRole = 'button',
  hitSlop,
  ...rest
}) {
  const scale = useSharedValue(1);
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: interpolate(pressed.value, [0, 1], [1, 0.92]),
  }));

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    scale.value = withSpring(scaleValue, SPRINGS.snappy);
    pressed.value = withSpring(1, SPRINGS.snappy);
  }, [disabled, scaleValue]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRINGS.snappy);
    pressed.value = withSpring(0, SPRINGS.snappy);
  }, []);

  const handlePress = useCallback(() => {
    if (disabled) return;
    if (haptic && Haptics[haptic]) Haptics[haptic]();
    onPress?.();
  }, [disabled, haptic, onPress]);

  const handleLongPress = useCallback(() => {
    if (disabled) return;
    if (Haptics.medium) Haptics.medium();
    onLongPress?.();
  }, [disabled, onLongPress]);

  const ripple = Platform.OS === 'android' && !disabled
    ? (android_ripple || { color: 'rgba(0,0,0,0.08)', borderless: false, foreground: true })
    : undefined;

  return (
    <Animated.View style={[animatedStyle, disabled && { opacity: 0.4 }]}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        disabled={disabled}
        android_ripple={ripple}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        hitSlop={hitSlop}
        style={style}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ── AnimatedCard ─────────────────────────────────────────────────────────────
// Card with press-in scale + entry animation. Used for product/animal/machinery cards.

export function AnimatedCard({
  children,
  onPress,
  index = 0,
  scaleValue = 0.97,
  style,
  testID,
  accessibilityLabel,
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(scaleValue, SPRINGS.snappy);
  }, [scaleValue]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRINGS.snappy);
  }, []);

  const handlePress = useCallback(() => {
    Haptics.light();
    onPress?.();
  }, [onPress]);

  return (
    <Animated.View
      entering={enterAnimation(index)}
      style={[animatedStyle, style]}
    >
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={{ flex: 1 }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ── HeartButton ──────────────────────────────────────────────────────────────
// Like/favorite with physics-based pop animation.

export function HeartButton({ liked, onToggle, size = 16 }) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    // Heart pops: 1 → 0.8 → 1.2 → 1 (snappy spring chain)
    scale.value = withSpring(0.8, { ...SPRINGS.snappy, stiffness: 400 }, () => {
      scale.value = withSpring(1.2, SPRINGS.bouncy, () => {
        scale.value = withSpring(1, SPRINGS.snappy);
      });
    });
    Haptics.light();
    onToggle?.();
  }, [onToggle]);

  // Import Ionicons at usage site — this component just handles animation
  return { animatedStyle, handlePress, scale };
}
