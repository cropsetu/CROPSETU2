/**
 * GlowButton — sleek primary/accent/danger button with soft shadow.
 *
 * Visual:
 *   • Gradient fill (leaf-green / orange CTA / red)
 *   • Subtle top-half white highlight for a clean shine (not overdone)
 *   • Soft drop shadow
 *   • 48 dp default height
 *
 * Variants: primary | accent | danger | ghost | glass
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COSMIC, GRADIENT, GLOW, CR, TAP } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

export default function GlowButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  haptic = true,
  size = 'md',
  full = false,
  style,
  textStyle,
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const sz = SIZES[size] || SIZES.md;
  const isDisabled = disabled || loading;

  const handle = () => {
    if (isDisabled) return;
    if (haptic) Haptics.light?.();
    onPress && onPress();
  };

  const inner = (
    <View style={[styles.row, { paddingHorizontal: sz.padH, paddingVertical: sz.padV, minHeight: sz.min }]}>
      {loading ? (
        <ActivityIndicator color={v.textColor} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={sz.icon} color={v.textColor} style={{ marginRight: label ? 6 : 0 }} /> : null}
          {label ? (
            <Text style={[styles.label, { color: v.textColor, fontSize: sz.font }, textStyle]} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
          {iconRight ? <Ionicons name={iconRight} size={sz.icon} color={v.textColor} style={{ marginLeft: 6 }} /> : null}
        </>
      )}
    </View>
  );

  return (
    <Pressable
      onPress={handle}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: sz.radius, opacity: isDisabled ? 0.55 : 1 },
        full && { alignSelf: 'stretch' },
        v.shadow,
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {v.gradient ? (
        <View style={[styles.fill, { borderRadius: sz.radius }]}>
          <LinearGradient
            colors={v.gradient}
            start={GRADIENT.start}
            end={GRADIENT.end}
            style={StyleSheet.absoluteFill}
          />
          {/* Subtle top highlight for a light "glossy" feel */}
          <LinearGradient
            colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[StyleSheet.absoluteFill, { height: '50%' }]}
            pointerEvents="none"
          />
          {inner}
        </View>
      ) : (
        <View style={[styles.fill, v.surface, { borderRadius: sz.radius }]}>
          {inner}
        </View>
      )}
    </Pressable>
  );
}

const VARIANTS = {
  primary: {
    gradient: GRADIENT.primary,
    textColor: COSMIC.INVERSE,
    shadow: GLOW.green,
  },
  accent: {
    gradient: GRADIENT.accent,
    textColor: COSMIC.INVERSE,
    shadow: GLOW.gold,
  },
  danger: {
    gradient: GRADIENT.danger,
    textColor: '#FFFFFF',
    shadow: GLOW.red,
  },
  ghost: {
    gradient: null,
    textColor: COSMIC.PRIMARY,
    surface: { backgroundColor: 'transparent', borderWidth: 1.2, borderColor: COSMIC.PRIMARY + '55' },
    shadow: null,
  },
  glass: {
    gradient: null,
    textColor: COSMIC.TEXT,
    surface: { backgroundColor: COSMIC.SURFACE, borderWidth: 1, borderColor: COSMIC.BORDER },
    shadow: GLOW.subtle,
  },
};

const SIZES = {
  sm: { padH: 12, padV: 8,  min: 36,        font: 13, icon: 16, radius: CR.md },
  md: { padH: 16, padV: 10, min: TAP.min,   font: 15, icon: 18, radius: CR.lg },
  lg: { padH: 18, padV: 12, min: 52,        font: 16, icon: 20, radius: CR.xl },
};

const styles = StyleSheet.create({
  base: {
    overflow: 'visible',
  },
  fill: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'PlusJakartaSans_700Bold',
    letterSpacing: 0.1,
  },
});
