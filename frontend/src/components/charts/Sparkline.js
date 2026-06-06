/**
 * Sparkline — compact trend line with optional gradient area fill and an
 * end dot. Used for yield/profit trends and the 30-day mandi price trend.
 *
 * <Sparkline points={[120,140,135,160,158,180]} color={COSMIC.PRIMARY} fill />
 */
import React, { useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { COSMIC } from '../../screens/FarmProfile/theme/cosmicTheme';
import { buildLinePath, useDraw } from './_svgMath';

const AnimatedPath = Animated.createAnimatedComponent(Path);
let _uid = 0;

export default function Sparkline({
  points = [],
  width = 120,
  height = 40,
  color = COSMIC.PRIMARY,
  fill = true,
  showLastDot = true,
  strokeWidth = 2.5,
  style,
}) {
  const uid = useRef(`spark${++_uid}`).current;
  const { d, area, coords } = buildLinePath(points, width, height, strokeWidth + 1);

  // Approximate path length for the draw-on dashoffset.
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += Math.hypot(coords[i].x - coords[i - 1].x, coords[i].y - coords[i - 1].y);
  }
  const draw = useDraw(760, 60, coords.length);
  const dashoffset = draw.interpolate({ inputRange: [0, 1], outputRange: [len || 1, 0] });
  const last = coords[coords.length - 1];

  if (!d) return <View style={[{ width, height }, style]} />;

  return (
    <View style={[{ width, height }, style]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.22" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {fill && coords.length > 1 ? <Path d={area} fill={`url(#${uid})`} /> : null}
        {coords.length > 1 ? (
          <AnimatedPath
            d={d}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={`${len || 1} ${(len || 1) + 1}`}
            strokeDashoffset={dashoffset}
          />
        ) : null}
        {showLastDot && last ? (
          <>
            <Circle cx={last.x} cy={last.y} r={4.5} fill={color} opacity={0.18} />
            <Circle cx={last.x} cy={last.y} r={2.6} fill={color} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({});
