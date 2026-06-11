// ─────────────────────────────────────────────────────────────────────────────
// <PrimaryButton/> — the single harvest-gold focal action
// ─────────────────────────────────────────────────────────────────────────────
// • Enabled→disabled is a real COLOUR change (gold → muted sand), not opacity,
//   so the difference survives bright sunlight and colour-blind vision.
// • Loading keeps the exact same box (full-width, fixed min height) → zero
//   layout shift; only the inner content swaps to spinner + label.
// • Press = scale 0.98 spring + light haptic, both skipped under reduce-motion.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo } from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';
import { useAuthTheme } from '../theme';
import { Haptics } from '../../../../utils/haptics';
import { SPRINGS } from '../../../../components/ui/motion';
import { s, vs } from '../../../../utils/responsive';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * @param {object}   props
 * @param {string}   props.label            Visible button text.
 * @param {string}  [props.loadingLabel]    Text shown while `loading` (defaults to label).
 * @param {() => void} props.onPress
 * @param {boolean} [props.loading]         Spinner + locked, but keeps width.
 * @param {boolean} [props.disabled]
 * @param {React.ComponentType} [props.Icon] lucide icon rendered after the label.
 * @param {string}  [props.testID]
 */
export default function PrimaryButton({
  label,
  loadingLabel,
  onPress,
  loading = false,
  disabled = false,
  Icon,
  testID,
}) {
  const theme = useAuthTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();

  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // A disabled OR busy button must not animate or fire haptics/handlers.
  const inert = disabled || loading;

  const onPressIn = useCallback(() => {
    if (inert || reduceMotion) return;
    scale.value = withSpring(0.98, SPRINGS.snappy);
  }, [inert, reduceMotion, scale]);

  const onPressOut = useCallback(() => {
    if (reduceMotion) return;
    scale.value = withSpring(1, SPRINGS.snappy);
  }, [reduceMotion, scale]);

  const handlePress = useCallback(() => {
    if (inert) return;
    Haptics.light();            // tactile confirmation on tap
    onPress?.();
  }, [inert, onPress]);

  return (
    <AnimatedPressable
      style={[styles.btn, disabled && styles.btnDisabled, animStyle]}
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={inert}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={loading ? loadingLabel || label : label}
      accessibilityState={{ disabled, busy: loading }}
      // Visual height can shrink on small phones, but the touch target never does.
      hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
    >
      {/* Both layers occupy the same cell; we cross-fade by toggling opacity so
          the button's measured size is identical in every state. */}
      <View style={[styles.content, loading && styles.hidden]}>
        <Text style={[styles.label, disabled && styles.labelDisabled]} numberOfLines={1}>
          {label}
        </Text>
        {Icon ? (
          <Icon
            size={s(20)}
            color={disabled ? theme.onAccentDisabled : theme.onAccent}
            strokeWidth={2.5}
            style={styles.icon}
          />
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingLayer} accessibilityElementsHidden>
          <ActivityIndicator color={theme.onAccent} />
          <Text style={styles.label} numberOfLines={1}>
            {loadingLabel || label}
          </Text>
        </View>
      ) : null}
    </AnimatedPressable>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    btn: {
      minHeight: Math.max(vs(54), t.tap + 6),
      borderRadius: t.radius.pill,
      backgroundColor: t.accent,
      paddingHorizontal: s(t.space.lg),
      paddingVertical: vs(t.space.base),
      justifyContent: 'center',
      alignItems: 'center',
      ...t.shadow.cta,
    },
    // Distinct *colour*, flattened elevation — reads as "off", not faded.
    btnDisabled: {
      backgroundColor: t.accentDisabledBg,
      ...t.shadow.none,
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(t.space.sm),
    },
    // Keep the resting content mounted (so width is stable) but invisible.
    hidden: { opacity: 0 },
    loadingLayer: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s(t.space.sm),
    },
    label: { ...t.text.button, color: t.onAccent, textAlign: 'center' },
    labelDisabled: { color: t.onAccentDisabled },
    icon: { marginTop: 1 },
  });
}
