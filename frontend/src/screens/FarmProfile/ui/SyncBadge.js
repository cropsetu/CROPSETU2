/**
 * SyncBadge — illustrated online/offline indicator.
 *
 * When synced: cloud-check in green, "Synced · 2 min ago"
 * When offline: hand-drawn cloud with dashed outline, "Will sync when online"
 * When syncing: spinning ring, "Syncing…"
 *
 * Sits top-right on MyFarmHome header. Also used in nudge cards.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COSMIC, CR, CT } from '../theme/cosmicTheme';

export default function SyncBadge({ status = 'synced', lastSyncedText, compact = false }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status !== 'syncing') { spin.setValue(0); return; }
    const anim = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, [status]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const cfg = CFG[status] || CFG.synced;

  return (
    <View style={[styles.badge, cfg.bg, compact && styles.compact]}>
      {status === 'syncing' ? (
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="sync" size={compact ? 12 : 14} color={cfg.color} />
        </Animated.View>
      ) : (
        <Ionicons name={cfg.icon} size={compact ? 12 : 14} color={cfg.color} />
      )}
      {!compact && (
        <Text style={[styles.text, { color: cfg.color }]} numberOfLines={1}>
          {status === 'synced' ? (lastSyncedText || 'Synced') : cfg.label}
        </Text>
      )}
    </View>
  );
}

const CFG = {
  synced:  { icon: 'cloud-done-outline',     color: COSMIC.PRIMARY, bg: { backgroundColor: COSMIC.PRIMARY_SOFT, borderColor: COSMIC.PRIMARY + '33' }, label: 'Synced' },
  syncing: { icon: 'sync',                   color: COSMIC.ACCENT,  bg: { backgroundColor: COSMIC.ACCENT_SOFT,  borderColor: COSMIC.ACCENT + '33' }, label: 'Syncing…' },
  offline: { icon: 'cloud-offline-outline',  color: COSMIC.WARN,    bg: { backgroundColor: COSMIC.WARN_SOFT,    borderColor: COSMIC.WARN + '33' },   label: 'Offline' },
  error:   { icon: 'alert-circle-outline',   color: COSMIC.DANGER,  bg: { backgroundColor: COSMIC.DANGER_SOFT,  borderColor: COSMIC.DANGER + '33' }, label: 'Retry' },
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CR.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  compact: {
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  text: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
});
