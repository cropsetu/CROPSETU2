/**
 * Button — the single press primitive for the seller app.
 *
 * SHAPE: every button is a pill. Inputs and chips are 14px-radius rectangles,
 * cards are 24. Holding those three apart is what keeps a screen from looking
 * like four component libraries stacked on top of each other, and it means a
 * seller can tell "this is pressable" from shape alone at arm's length.
 *
 * COLOUR: only `primary` and `danger` are filled. Everything else is paper
 * with a border, because a screen where five things are solid orange has no
 * primary action at all. `secondary` uses `C.brandInk` rather than `C.brand`
 * for its text — pure #E65100 is 3.4:1 on parchment and fails as body text.
 *
 * Guarantees every caller gets for free:
 *   - a touch target ≥48dp (WCAG 2.2 AA; the old inline TouchableOpacitys were
 *     as small as 22dp, which is unusable with wet or gloved hands)
 *   - `accessibilityRole` / `accessibilityState` so screen readers announce
 *     "button, disabled" or "button, busy" correctly
 *   - a loading state that BLOCKS re-entry — the old save buttons only dimmed,
 *     so a double-tap could fire two POSTs and create two products
 *   - press feedback that disappears under Reduce Motion
 *   - haptics on native, silently skipped on web
 */
import React, { useCallback, useRef } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Haptics } from '@krushisarva/shared/utils/haptics';
import { C, E, HIT, R, SP, T, alpha } from '../../theme';
import { usePressScale } from '../../hooks/useMotion';

const VARIANTS = {
  primary:   { bg: C.brand,         fg: C.onBrand,   border: 'transparent',            elevate: true },
  secondary: { bg: C.surface,       fg: C.brandInk,  border: alpha(C.brand, 0.45) },
  neutral:   { bg: C.surfaceSunken, fg: C.textBody,  border: C.border },
  ghost:     { bg: 'transparent',   fg: C.brandInk,  border: 'transparent' },
  danger:    { bg: C.dangerBold,    fg: C.onBrand,   border: 'transparent' },
  dangerSoft:{ bg: C.dangerPale,    fg: C.danger,    border: alpha(C.danger, 0.3) },
  success:   { bg: C.successBold,   fg: C.onBrand,   border: 'transparent' },
};

const SIZES = {
  sm: { minHeight: HIT.minCompact, paddingH: SP.lg,  gap: SP.xs, text: T.buttonSm, icon: 16, radius: R.pill },
  md: { minHeight: HIT.min + 2,    paddingH: SP.xl,  gap: SP.sm, text: T.button,   icon: 18, radius: R.pill },
  lg: { minHeight: 56,             paddingH: SP.xxl, gap: SP.md, text: T.button,   icon: 20, radius: R.pill },
};

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  haptic = 'light',
  style,
  textStyle,
  accessibilityLabel,
  accessibilityHint,
  testID,
  children,
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const sz = SIZES[size] || SIZES.md;
  const { scale, onPressIn, onPressOut } = usePressScale();

  const inert = disabled || loading;

  // Guard against the double-fire window between the tap and `loading` turning
  // true — on a slow render that gap is long enough to land two taps.
  const busy = useRef(false);

  const handlePress = useCallback(() => {
    if (inert || busy.current) return;
    busy.current = true;
    if (haptic && Haptics[haptic]) Haptics[haptic]();
    try {
      const result = onPress?.();
      if (result && typeof result.finally === 'function') {
        result.finally(() => { busy.current = false; });
        return;
      }
    } catch (e) {
      busy.current = false;
      throw e;
    }
    // Sync handler: release on the next tick so one tap can't become two.
    setTimeout(() => { busy.current = false; }, 350);
  }, [inert, haptic, onPress]);

  const content = children ?? (
    <>
      {icon && !loading ? <Ionicons name={icon} size={sz.icon} color={v.fg} /> : null}
      {loading ? <ActivityIndicator size="small" color={v.fg} /> : null}
      {label ? (
        <Text style={[sz.text, { color: v.fg }, textStyle]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {iconRight && !loading ? <Ionicons name={iconRight} size={sz.icon} color={v.fg} /> : null}
    </>
  );

  return (
    <Animated.View
      style={[
        fullWidth && styles.fullWidth,
        { transform: [{ scale }] },
        inert && styles.inert,
        style,
      ]}
    >
      <Pressable
        onPress={handlePress}
        onPressIn={inert ? undefined : onPressIn}
        onPressOut={inert ? undefined : onPressOut}
        disabled={inert}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inert, busy: loading }}
        android_ripple={
          Platform.OS === 'android' && !inert
            ? { color: alpha(v.fg, 0.14), borderless: false, foreground: true }
            : undefined
        }
        style={[
          styles.base,
          {
            minHeight: sz.minHeight,
            paddingHorizontal: sz.paddingH,
            gap: sz.gap,
            borderRadius: sz.radius,
            backgroundColor: v.bg,
            borderColor: v.border,
            borderWidth: v.border === 'transparent' ? 0 : 1.5,
          },
          v.elevate && !inert && E.brand,
        ]}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}

/**
 * IconButton — a square, icon-only action. Always ≥44dp even when the glyph is
 * 16px, because the tap area is what matters, not the drawing. Corners are
 * `R.md` rather than a circle by default: a rounded square sits in a row of
 * inputs and chips without looking like a stray bubble. Pass `buttonStyle` to
 * make it round where round is right (the FAB, an avatar action).
 */
export function IconButton({
  icon,
  onPress,
  size = 20,
  color = C.textBody,
  background = 'transparent',
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  /** Outer wrapper (positioning, shadow). */
  style,
  /** The pressable box itself — use this to override the 44dp default size. */
  buttonStyle,
  testID,
  haptic = 'light',
}) {
  const { scale, onPressIn, onPressOut } = usePressScale({ to: 0.92 });

  const handlePress = useCallback(() => {
    if (disabled) return;
    if (haptic && Haptics[haptic]) Haptics[haptic]();
    onPress?.();
  }, [disabled, haptic, onPress]);

  return (
    <Animated.View style={[{ transform: [{ scale }] }, disabled && styles.inert, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={disabled ? undefined : onPressIn}
        onPressOut={disabled ? undefined : onPressOut}
        disabled={disabled}
        testID={testID}
        hitSlop={HIT.slop}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        android_ripple={
          Platform.OS === 'android' && !disabled
            ? { color: alpha(color, 0.18), borderless: true, radius: 24 }
            : undefined
        }
        style={[styles.iconBtn, { backgroundColor: background }, buttonStyle]}
      >
        <Ionicons name={icon} size={size} color={color} />
      </Pressable>
    </Animated.View>
  );
}

/**
 * PressableRow — a full-width tappable row (settings lists, cards). Separate
 * from Button so it doesn't inherit button padding, but keeps the same
 * accessibility contract. The pressed tint is warm, matching the parchment
 * rather than greying it out.
 */
export function PressableRow({
  onPress,
  children,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  accessibilityState,
  disabled = false,
  haptic = 'light',
  testID,
}) {
  const handlePress = useCallback(() => {
    if (disabled) return;
    if (haptic && Haptics[haptic]) Haptics[haptic]();
    onPress?.();
  }, [disabled, haptic, onPress]);

  // Without an onPress it is not interactive — don't advertise it as a button.
  if (!onPress) {
    return <View style={style} accessible accessibilityLabel={accessibilityLabel}>{children}</View>;
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, ...accessibilityState }}
      android_ripple={
        Platform.OS === 'android' && !disabled
          ? { color: alpha(C.brand, 0.1), foreground: true }
          : undefined
      }
      style={({ pressed }) => [
        style,
        pressed && Platform.OS !== 'android' && { backgroundColor: alpha(C.brand, 0.06) },
        disabled && styles.inert,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fullWidth: { alignSelf: 'stretch' },
  inert: { opacity: 0.45 },
  iconBtn: {
    width: HIT.minCompact,
    height: HIT.minCompact,
    borderRadius: R.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
