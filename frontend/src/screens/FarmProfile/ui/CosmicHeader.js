/**
 * CosmicHeader — minimal header bar drawn inside the screen canvas.
 *
 * Props:
 *   title        — main heading (required)
 *   subtitle     — optional second line
 *   onBack       — callback for back chevron (defaults to navigation.goBack)
 *   right        — custom right-side element (e.g. edit button)
 *   transparent  — skip the subtle bg underlay (default false)
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COSMIC, CT } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

export default function CosmicHeader({
  title,
  subtitle,
  onBack,
  right,
  transparent = false,
  tight = false,
  style,
}) {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    Haptics.light?.();
    if (onBack) return onBack();
    if (nav.canGoBack()) nav.goBack();
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + (tight ? 2 : 6) }, !transparent && styles.wrapBg, style]}>
      <View style={styles.row}>
        <Pressable
          onPress={handleBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.55 }]}
        >
          <Ionicons name="chevron-back" size={22} color={COSMIC.TEXT} />
        </Pressable>

        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>

        <View style={styles.rightWrap}>{right || null}</View>
      </View>

      {!transparent && <View style={styles.hairline} />}
    </View>
  );
}

/** Small icon button to drop into the `right` slot. */
CosmicHeader.IconButton = function HeaderIconButton({ icon, onPress, accessibilityLabel, badge }) {
  return (
    <Pressable
      onPress={() => { Haptics.light?.(); onPress && onPress(); }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.55 }]}
    >
      <Ionicons name={icon} size={18} color={COSMIC.TEXT} />
      {badge != null && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 6,
    paddingHorizontal: 10,
  },
  wrapBg: {
    backgroundColor: COSMIC.SURFACE,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    gap: 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: COSMIC.TEXT,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: COSMIC.TEXT_3,
    marginTop: 1,
  },
  rightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hairline: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: COSMIC.BORDER,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COSMIC.ACCENT,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 9,
    color: COSMIC.INVERSE,
    fontFamily: 'Inter_800ExtraBold',
  },
});
