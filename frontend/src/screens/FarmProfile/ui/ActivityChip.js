/**
 * ActivityChip — colored icon pill representing a single activity type.
 *
 * Used in three places:
 *   1. ActivityTypePicker (full-screen grid — large variant)
 *   2. Activity feed rows (compact variant)
 *   3. Quick-add rails on MyFarmHome (medium variant)
 *
 * Colors come from ACTIVITY_TYPES in cosmicTheme.js so every screen
 * references the same palette — consistent visual vocabulary.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COSMIC, CR, CT, TAP, activityMeta } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

export default function ActivityChip({
  type,            // ActivityType enum key (e.g. 'IRRIGATION')
  label,
  onPress,
  size = 'md',     // 'sm' | 'md' | 'lg'
  active = false,
  style,
}) {
  const meta = activityMeta(type);
  const sz = SIZES[size] || SIZES.md;

  const handle = () => {
    if (!onPress) return;
    Haptics.light?.();
    onPress(type);
  };

  const tintBg = active ? meta.color : meta.color + '28';   // 28 ≈ 16% alpha
  const tintBorder = active ? meta.color : meta.color + '55';
  const iconColor = active ? COSMIC.INVERSE : meta.color;
  const textColor = active ? COSMIC.INVERSE : COSMIC.TEXT;

  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper
      onPress={handle}
      style={({ pressed }) => [
        styles.chip,
        { minHeight: sz.min, paddingHorizontal: sz.padH, paddingVertical: sz.padV, borderRadius: sz.radius },
        { backgroundColor: tintBg, borderColor: tintBorder, borderWidth: 1.5 },
        pressed && { transform: [{ scale: 0.97 }] },
        style,
      ]}
    >
      <View style={[styles.iconWrap, { width: sz.icon + 4, height: sz.icon + 4 }]}>
        <Ionicons name={meta.icon} size={sz.icon} color={iconColor} />
      </View>
      {label != null && (
        <Text
          style={[styles.label, { color: textColor, fontSize: sz.font, marginLeft: sz.iconGap }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Wrapper>
  );
}

/** Grid variant — used on the ActivityTypePicker screen. */
ActivityChip.Tile = function ActivityTile({ type, label, onPress, style }) {
  const meta = activityMeta(type);
  const handle = () => { Haptics.light?.(); onPress && onPress(type); };
  return (
    <Pressable
      onPress={handle}
      style={({ pressed }) => [
        tileStyles.tile,
        { backgroundColor: meta.color + '20', borderColor: meta.color + '55' },
        pressed && { transform: [{ scale: 0.96 }], backgroundColor: meta.color + '30' },
        style,
      ]}
    >
      <View style={[tileStyles.iconBubble, { backgroundColor: meta.color + '22', borderColor: meta.color + '66' }]}>
        <Ionicons name={meta.icon} size={20} color={meta.color} />
      </View>
      <Text style={tileStyles.label} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
};

const SIZES = {
  sm: { min: 30, padH: 8,  padV: 5, radius: CR.pill, icon: 13, font: 11, iconGap: 4 },
  md: { min: 36, padH: 11, padV: 6, radius: CR.pill, icon: 15, font: 13, iconGap: 6 },
  lg: { min: 44, padH: 14, padV: 9, radius: CR.xl,  icon: 18, font: 15, iconGap: 8 },
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
  },
});

const tileStyles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 82,
    borderWidth: 1.2,
    borderRadius: CR.lg,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    color: COSMIC.TEXT,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
});
