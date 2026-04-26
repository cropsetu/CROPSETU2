/**
 * GlassCard — white card used for every data section in MyFarm.
 *
 * Minimalist: solid white, 1-px soft border, subtle shadow. No blur.
 *
 * Variants:
 *   plain    — default white card
 *   raised   — stronger shadow, for active / floating surfaces
 *   bordered — thicker 1.5-px border (primary actionable cards)
 *   flat     — no border (use inside another GlassCard)
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { COSMIC, CR, GLOW } from '../theme/cosmicTheme';

export default function GlassCard({
  children,
  variant = 'plain',
  glow,                // 'green' | 'gold' | 'red' | 'soft' | 'subtle'
  style,
  padding = 14,
  radius = CR.lg,
}) {
  const v = VARIANTS[variant] || VARIANTS.plain;
  const glowStyle = glow ? GLOW[glow] : GLOW.subtle;

  return (
    <View
      style={[
        styles.card,
        v.card,
        { borderRadius: radius, padding },
        glowStyle,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const VARIANTS = {
  plain: {
    card: {
      backgroundColor: COSMIC.SURFACE,
      borderWidth: 1,
      borderColor: COSMIC.BORDER,
    },
  },
  raised: {
    card: {
      backgroundColor: COSMIC.SURFACE,
      borderWidth: 1,
      borderColor: COSMIC.BORDER,
    },
  },
  bordered: {
    card: {
      backgroundColor: COSMIC.SURFACE,
      borderWidth: 1.5,
      borderColor: COSMIC.BORDER_HI,
    },
  },
  flat: {
    card: {
      backgroundColor: COSMIC.SURFACE_HI,
      borderWidth: 0,
    },
  },
};

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
