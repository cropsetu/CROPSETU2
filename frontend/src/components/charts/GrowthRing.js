/**
 * GrowthRing — animated progress ring for a crop's growth stage, with the
 * days-after-sowing (DAS) and current stage in the centre.
 *
 * <GrowthRing currentStage="FLOWERING" das={62} size={120} />
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { COSMIC, CT } from '../../screens/FarmProfile/theme/cosmicTheme';
import { clamp, useDraw } from './_svgMath';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
let _uid = 0;

const DEFAULT_STAGES = [
  'PLANNING', 'LAND_PREP', 'SOWING', 'VEGETATIVE',
  'FLOWERING', 'FRUITING', 'MATURITY', 'HARVESTED',
];

const SHORT = {
  PLANNING: 'Planning', LAND_PREP: 'Land prep', SOWING: 'Sowing', VEGETATIVE: 'Vegetative',
  FLOWERING: 'Flowering', FRUITING: 'Fruiting', MATURITY: 'Maturity', HARVESTED: 'Harvested',
};

export default function GrowthRing({
  currentStage = 'PLANNING',
  das,
  stages = DEFAULT_STAGES,
  size = 120,
  strokeWidth = 12,
  label,
  style,
}) {
  const uid = useRef(`grow${++_uid}`).current;
  const idx = Math.max(0, stages.indexOf(currentStage));
  const frac = clamp(stages.length > 1 ? idx / (stages.length - 1) : 0, 0, 1);

  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;

  const draw = useDraw(820, 80, frac);
  const dashoffset = draw.interpolate({ inputRange: [0, 1], outputRange: [C, C * (1 - frac)] });

  const hasDas = das != null && !isNaN(Number(das));
  const stageLabel = label || SHORT[currentStage] || currentStage;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={COSMIC.PRIMARY_LT} />
            <Stop offset="1" stopColor={COSMIC.PRIMARY} />
          </LinearGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={r} stroke={COSMIC.SURFACE_LO} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={cx}
          cy={cy}
          r={r}
          stroke={`url(#${uid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${C} ${C}`}
          strokeDashoffset={dashoffset}
          originX={cx}
          originY={cy}
          rotation={-90}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        {hasDas ? (
          <>
            <Text style={styles.das}>{Math.round(Number(das))}</Text>
            <Text style={styles.dasUnit}>days</Text>
          </>
        ) : (
          <Text style={styles.stageOnly} numberOfLines={2}>{stageLabel}</Text>
        )}
      </View>
      {hasDas && <Text style={[styles.stageBadge]} numberOfLines={1}>{stageLabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  das: { fontSize: 26, fontFamily: CT.family.extra, color: COSMIC.TEXT },
  dasUnit: { fontSize: 10, fontFamily: CT.family.medium, color: COSMIC.TEXT_3, marginTop: -2 },
  stageOnly: { fontSize: 13, fontFamily: CT.family.bold, color: COSMIC.PRIMARY, textAlign: 'center', paddingHorizontal: 16 },
  stageBadge: {
    position: 'absolute', bottom: -6, alignSelf: 'center',
    fontSize: 10, fontFamily: CT.family.semibold, color: COSMIC.PRIMARY,
  },
});
