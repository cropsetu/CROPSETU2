/**
 * MiniBars — compact comparison bars with a zero baseline that supports
 * negative values (e.g. per-cycle profit/loss). Pure RN Views (crisp, cheap).
 *
 * <MiniBars bars={[{label:'Kh24', value:12000},{label:'Rb24', value:-3000}]}
 *   valueFormat={fmtInr} />
 */
import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COSMIC, CT, CR } from '../../screens/FarmProfile/theme/cosmicTheme';
import { useReveal } from './_svgMath';

export default function MiniBars({
  bars = [],
  height = 76,
  maxBars = 6,
  showValues = false,
  valueFormat = (v) => `${v}`,
  style,
}) {
  const reveal = useReveal();
  const data = (bars || []).slice(-maxBars);
  if (data.length === 0) return <View style={[{ height }, style]} />;

  const vals = data.map((b) => Number(b.value) || 0);
  const hasNeg = vals.some((v) => v < 0);
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const zoneUp = hasNeg ? height * 0.55 : height;
  const zoneDn = hasNeg ? height * 0.45 : 0;
  const baseTop = zoneUp; // y of the zero line from the top of the plot area

  return (
    <Animated.View style={[styles.wrap, reveal, style]}>
      <View style={[styles.plot, { height }]}>
        {hasNeg && <View style={[styles.zeroLine, { top: baseTop }]} />}
        {data.map((b, i) => {
          const v = vals[i];
          const pos = v >= 0;
          const px = Math.max(3, (Math.abs(v) / maxAbs) * (pos ? zoneUp : zoneDn) - 4);
          const color = b.color || (pos ? COSMIC.PRIMARY : COSMIC.DANGER);
          return (
            <View key={i} style={styles.col}>
              {showValues && pos && (
                <Text style={styles.valTop} numberOfLines={1}>{valueFormat(v)}</Text>
              )}
              <View style={{ height, justifyContent: 'flex-start', width: '100%', alignItems: 'center' }}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: px,
                      backgroundColor: color,
                      position: 'absolute',
                      top: pos ? baseTop - px : baseTop,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.labels}>
        {data.map((b, i) => (
          <Text key={i} style={styles.xLabel} numberOfLines={1}>{b.label}</Text>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  zeroLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: COSMIC.BORDER },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '62%', borderRadius: CR.sm, minHeight: 3 },
  valTop: { fontSize: 9, fontFamily: CT.family.semibold, color: COSMIC.TEXT_3 },
  labels: { flexDirection: 'row', gap: 8, marginTop: 5 },
  xLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontFamily: CT.family.medium, color: COSMIC.TEXT_3 },
});
