/**
 * RadialGauge — 270° arc gauge for a single value against a range, with
 * zone-based colouring. Used for soil pH / N / P / K (colour by *Rating).
 *
 * <RadialGauge value={6.8} min={3} max={9} label="pH" decimals={1}
 *   zones={[{upTo:5.5,color:DANGER},{upTo:7.5,color:SUCCESS},{upTo:9,color:WARN}]} />
 */
import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COSMIC, CT } from '../../screens/FarmProfile/theme/cosmicTheme';
import { clamp, describeArc, useDraw } from './_svgMath';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const START = 135;
const SWEEP = 270;

export default function RadialGauge({
  value,
  min = 0,
  max = 100,
  label,
  unit = '',
  zones = [],
  size = 92,
  strokeWidth = 9,
  decimals = 0,
  color: colorProp,
  style,
}) {
  const has = value != null && !isNaN(Number(value));
  const v = has ? Number(value) : min;
  const frac = clamp((v - min) / (max - min || 1), 0, 1);

  const color =
    colorProp ||
    (zones.find((z) => v <= z.upTo)?.color) ||
    (zones[zones.length - 1]?.color) ||
    COSMIC.PRIMARY;

  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const trackD = describeArc(cx, cy, r, START, START + SWEEP);
  const sweepDeg = SWEEP * frac;
  const valueD = sweepDeg > 0.5 ? describeArc(cx, cy, r, START, START + sweepDeg) : '';
  const arcLen = (Math.PI / 180) * sweepDeg * r;

  const draw = useDraw(720, 80, frac);
  const dashoffset = draw.interpolate({ inputRange: [0, 1], outputRange: [arcLen, 0] });

  return (
    <View style={[styles.wrap, style]}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Path d={trackD} stroke={COSMIC.SURFACE_LO} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
          {has && valueD ? (
            <AnimatedPath
              d={valueD}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${arcLen} ${arcLen + 1}`}
              strokeDashoffset={dashoffset}
            />
          ) : null}
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Text style={[styles.value, { color }]} numberOfLines={1} adjustsFontSizeToFit>
            {has ? v.toFixed(decimals) : '—'}
          </Text>
          {!!unit && has && <Text style={styles.unit}>{unit}</Text>}
        </View>
      </View>
      {!!label && <Text style={styles.label} numberOfLines={1}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 19, fontFamily: CT.family.extra, color: COSMIC.TEXT },
  unit: { fontSize: 9, fontFamily: CT.family.medium, color: COSMIC.TEXT_3, marginTop: -1 },
  label: { ...CT.styles.labelXS, color: COSMIC.TEXT_3, marginTop: 2, fontFamily: CT.family.semibold },
});
