/**
 * DonutChart — segmented ring for cost-split / P&L breakdowns.
 *
 * <DonutChart
 *   segments={[{label:'Seed', value:1200, color:'#4CAF50'}, ...]}
 *   size={132} strokeWidth={20}
 *   centerValue="₹8.4k" centerLabel="Total cost" />
 *
 * Fed directly by getCycleFinancials().costBreakdown ([{label,value,color}]).
 * Empty/zero-safe: renders a soft track ring + center content.
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle, G, Defs, LinearGradient, Stop } from 'react-native-svg';
import { COSMIC, CT, GLOW } from '../../screens/FarmProfile/theme/cosmicTheme';
import { sumValues, useReveal } from './_svgMath';

let _uid = 0;

// Lighten a #rrggbb toward white for a top highlight stop.
function lighten(hex, amt = 0.32) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return `#${((1 << 24) + (mix(r) << 16) + (mix(g) << 8) + mix(b)).toString(16).slice(1)}`;
}

export default function DonutChart({
  segments = [],
  size = 128,
  strokeWidth = 20,
  centerValue,
  centerLabel,
  trackColor = COSMIC.SURFACE_LO,
  gapDeg = 2,
  style,
}) {
  const reveal = useReveal();
  const uid = useRef(`donut${++_uid}`).current;

  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;

  const clean = (segments || []).filter((s) => Number(s?.value) > 0);
  const total = sumValues(clean);
  const gapFrac = gapDeg / 360;

  let acc = 0;
  const arcs = total > 0 ? clean.map((s, i) => {
    const frac = Number(s.value) / total;
    const dash = Math.max(0, (frac - gapFrac) * C);
    const rotation = acc * 360 - 90; // start at 12 o'clock
    acc += frac;
    return { key: i, color: s.color || COSMIC.PRIMARY, dash, rotation, gid: `${uid}-${i}` };
  }) : [];

  return (
    <Animated.View style={[{ width: size, height: size }, reveal, style]}>
      <View style={[styles.shadow, { width: size, height: size, borderRadius: size / 2 }]}>
        <Svg width={size} height={size}>
          <Defs>
            {arcs.map((a) => (
              <LinearGradient key={a.gid} id={a.gid} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={lighten(a.color)} />
                <Stop offset="1" stopColor={a.color} />
              </LinearGradient>
            ))}
          </Defs>
          {/* track */}
          <Circle cx={cx} cy={cy} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
          {/* segments */}
          <G>
            {arcs.map((a) => (
              <Circle
                key={a.key}
                cx={cx}
                cy={cy}
                r={r}
                stroke={`url(#${a.gid})`}
                strokeWidth={strokeWidth}
                strokeLinecap="butt"
                fill="none"
                strokeDasharray={`${a.dash} ${C - a.dash}`}
                originX={cx}
                originY={cy}
                rotation={a.rotation}
              />
            ))}
          </G>
        </Svg>
      </View>
      {(centerValue != null || centerLabel != null) && (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          {centerValue != null && (
            <Text style={styles.centerValue} numberOfLines={1} adjustsFontSizeToFit>
              {centerValue}
            </Text>
          )}
          {centerLabel != null && (
            <Text style={styles.centerLabel} numberOfLines={1}>{centerLabel}</Text>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: { backgroundColor: 'transparent', ...GLOW.subtle },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  centerValue: { ...CT.styles.h3, color: COSMIC.TEXT, fontFamily: CT.family.extra },
  centerLabel: { ...CT.styles.labelXS, color: COSMIC.TEXT_3, marginTop: 2, textTransform: 'none', fontFamily: CT.family.medium, letterSpacing: 0 },
});
