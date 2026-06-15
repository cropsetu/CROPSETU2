/**
 * StageTimelineBar — 8-stage crop phenology bar.
 *
 * Stages (in order): PLANNING · LAND_PREP · SOWING · VEGETATIVE · FLOWERING
 *                    · FRUITING · MATURITY · HARVESTED
 *
 * Current stage gets a glow and filled dot; past stages are green-tinted;
 * future stages are muted. Width responsive — collapses labels below the
 * dots on narrow screens.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { COSMIC, CR, CT, GLOW } from '../theme/cosmicTheme';
import { ActivityIcon } from '../../../components/ActivityIcons';

// Stages that have a clean, recognisable activity illustration. Stages without
// a matching ActivityIcon (Plan/Prep/Fruit/Mature) keep the plain dot.
const STAGE_ACTIVITY = {
  SOWING:    'SOWING',
  HARVESTED: 'HARVEST',
};

const STAGES = [
  { key: 'PLANNING',   label: 'Plan' },
  { key: 'LAND_PREP',  label: 'Prep' },
  { key: 'SOWING',     label: 'Sow' },
  { key: 'VEGETATIVE', label: 'Grow' },
  { key: 'FLOWERING',  label: 'Flower' },
  { key: 'FRUITING',   label: 'Fruit' },
  { key: 'MATURITY',   label: 'Mature' },
  { key: 'HARVESTED',  label: 'Harvest' },
];

export default function StageTimelineBar({ currentStage = 'PLANNING', das = null, style }) {
  const currentIdx = Math.max(0, STAGES.findIndex((s) => s.key === currentStage));

  return (
    <View style={[styles.wrap, style]}>
      {das != null && (
        <Text style={styles.das}>Day {das} after sowing</Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {STAGES.map((s, i) => {
          const isPast    = i < currentIdx;
          const isCurrent = i === currentIdx;
          const dotStyle = isCurrent
            ? [styles.dot, styles.dotCurrent, GLOW.green]
            : isPast
            ? [styles.dot, styles.dotPast]
            : [styles.dot, styles.dotFuture];

          const activityType = STAGE_ACTIVITY[s.key];

          return (
            <View key={s.key} style={styles.step}>
              <View style={styles.connectorRow}>
                <View style={[styles.connector, i === 0 && { opacity: 0 }, (isPast || isCurrent) && styles.connectorActive]} />
                <View style={dotStyle}>
                  {isCurrent && <View style={styles.dotInner} />}
                </View>
                <View style={[styles.connector, i === STAGES.length - 1 && { opacity: 0 }, isPast && styles.connectorActive]} />
                {/* Tiny realistic icon for stages that map cleanly to an activity;
                    absolutely centred so it never shifts the dot/connector geometry. */}
                {activityType && (
                  <View pointerEvents="none" style={styles.stageIcon}>
                    <ActivityIcon type={activityType} size={16} animated={false} />
                  </View>
                )}
              </View>
              <Text style={[styles.label, isCurrent && styles.labelCurrent, isPast && styles.labelPast]} numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const DOT = 10;
const CONN_H = 1.5;

const styles = StyleSheet.create({
  wrap: { paddingVertical: 4 },
  das: {
    fontSize: 11,
    color: COSMIC.TEXT_2,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    marginBottom: 6,
    marginLeft: 2,
  },
  row: { alignItems: 'center', paddingHorizontal: 2 },
  step: { alignItems: 'center', minWidth: 48 },
  connectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 48,
  },
  stageIcon: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    flex: 1,
    height: CONN_H,
    backgroundColor: COSMIC.BORDER,
  },
  connectorActive: { backgroundColor: COSMIC.PRIMARY },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotFuture:  { borderColor: COSMIC.BORDER_HI, backgroundColor: COSMIC.SURFACE },
  dotPast:    { borderColor: COSMIC.PRIMARY,  backgroundColor: COSMIC.PRIMARY },
  dotCurrent: {
    borderColor: COSMIC.PRIMARY_LT,
    backgroundColor: COSMIC.PRIMARY,
    width: DOT + 4,
    height: DOT + 4,
    borderRadius: (DOT + 4) / 2,
  },
  dotInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COSMIC.INVERSE,
  },
  label: {
    fontSize: 10,
    color: COSMIC.MUTED,
    marginTop: 4,
    fontFamily: 'PlusJakartaSans_500Medium',
  },
  labelCurrent: { color: COSMIC.PRIMARY, fontFamily: 'PlusJakartaSans_700Bold' },
  labelPast: { color: COSMIC.TEXT_2 },
});
