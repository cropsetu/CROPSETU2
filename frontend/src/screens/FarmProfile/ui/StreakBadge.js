/**
 * StreakBadge — illustrated "Sincere Farmer — X day streak" token.
 *
 * Shows on MyFarmHome in the hero. Never shames a missed day — if
 * `resting` is true, badge shows a neutral "Take a rest day" state
 * rather than a red warning.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { COSMIC, GRADIENT, GLOW, CR, CT } from '../theme/cosmicTheme';

export default function StreakBadge({ days = 0, resting = false, compact = false }) {
  const earned = days >= 1;
  const lit    = days >= 7;
  const size   = compact ? 28 : 36;

  const gradientColors = resting
    ? [COSMIC.SURFACE_HI, COSMIC.SURFACE_LO]
    : lit
    ? GRADIENT.accent
    : earned
    ? ['#3DAA74', '#176B43']
    : [COSMIC.SURFACE_HI, COSMIC.SURFACE_LO];

  const label = resting
    ? 'Take a rest day 🌿'
    : days >= 30
    ? `Master farmer — ${days} days 🏆`
    : days >= 7
    ? `Sincere farmer — ${days} days 🔥`
    : days >= 3
    ? `Building a habit — ${days} days`
    : days === 1
    ? 'Logged 1 day — keep going!'
    : 'Log one activity to start a streak';

  return (
    <View style={[styles.row, { gap: compact ? 8 : 10 }]}>
      <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }, lit && !resting ? GLOW.gold : earned ? GLOW.green : null]}>
        <LinearGradient
          colors={gradientColors}
          start={GRADIENT.start}
          end={GRADIENT.end}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        />
        <FlameMark size={size * 0.55} muted={!earned || resting} />
        {earned && (
          <View style={styles.count}>
            <Text style={styles.countText}>{days}</Text>
          </View>
        )}
      </View>
      {!compact && (
        <Text style={styles.label} numberOfLines={2}>{label}</Text>
      )}
    </View>
  );
}

function FlameMark({ size = 30, muted = false }) {
  const fill = muted ? 'rgba(255,255,255,0.6)' : COSMIC.INVERSE;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <G>
        <Path
          d="M24 4 C22 10 18 14 18 19 C18 22 20 24 22 24 C20 26 16 29 16 34 C16 40 20 44 24 44 C28 44 32 40 32 34 C32 30 29 28 28 26 C30 25 32 22 32 18 C32 12 27 8 24 4 Z"
          fill={fill}
        />
        <Path
          d="M24 16 C23 19 21 21 21 24 C21 26 22 27 23 27 C22 28 20 30 20 33 C20 36 22 38 24 38 C26 38 28 36 28 33 C28 31 27 30 26 29 C27 28 28 26 28 24 C28 20 26 18 24 16 Z"
          fill={muted ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.45)'}
        />
      </G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
    overflow: 'visible',
  },
  count: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    backgroundColor: COSMIC.SURFACE,
    borderRadius: CR.pill,
    paddingHorizontal: 5,
    paddingVertical: 0,
    minWidth: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
  },
  countText: {
    color: COSMIC.TEXT,
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  label: {
    fontSize: 12,
    color: COSMIC.TEXT_2,
    flex: 1,
    fontFamily: 'PlusJakartaSans_500Medium',
  },
});
