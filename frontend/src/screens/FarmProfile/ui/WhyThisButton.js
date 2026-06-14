/**
 * WhyThisButton — small chip attached to every advisory card.
 *
 * Tapping it opens the InsightsWhy screen (or a callback) to show the
 * reasoning behind an AI recommendation. Spec Part 9.10 — trust is everything.
 */

import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COSMIC, CR, CT } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

export default function WhyThisButton({ onPress, label = 'Why this?', compact = false, style }) {
  const handle = () => { Haptics.light?.(); onPress && onPress(); };
  return (
    <Pressable
      onPress={handle}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.compact,
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Ionicons name="bulb-outline" size={compact ? 12 : 14} color={COSMIC.ACCENT} />
      <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-forward" size={compact ? 12 : 14} color={COSMIC.ACCENT} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CR.pill,
    backgroundColor: COSMIC.ACCENT_SOFT,
    borderWidth: 1,
    borderColor: COSMIC.ACCENT + '33',
    alignSelf: 'flex-start',
  },
  compact: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 2,
  },
  text: {
    color: COSMIC.ACCENT,
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  textCompact: {
    fontSize: 11,
  },
});
