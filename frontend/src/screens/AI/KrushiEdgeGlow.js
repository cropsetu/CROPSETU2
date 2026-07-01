/**
 * KrushiEdgeGlow — Siri-style animated gradient glow around the screen edges.
 *
 * A full-screen, non-interactive overlay (pointerEvents="none") that paints a
 * soft gradient bloom on all four edges and gently "breathes". The colour shifts
 * with the assistant's state so the farmer can tell at a glance whether Krushi is
 * listening (green), thinking (amber) or speaking (blue) — no buttons, no chrome.
 *
 * Props:
 *   phase   'idle' | 'recording' | 'processing' | 'speaking' | 'saving' | 'done' | 'cancelled' | 'error'
 *   visible boolean — mount/animate only while the assistant is active
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: W, height: H } = Dimensions.get('window');
const EDGE = 130;   // how far the bloom reaches inward from each edge

// Two-stop gradient per state (outer → transparent inward).
const PHASE_COLORS = {
  recording:  ['#34D399', '#059669'],
  processing: ['#FBBF24', '#F59E0B'],
  speaking:   ['#38BDF8', '#6366F1'],
  saving:     ['#38BDF8', '#6366F1'],
  done:       ['#34D399', '#10B981'],
  cancelled:  ['#94A3B8', '#64748B'],
  error:      ['#F87171', '#EF4444'],
  idle:       ['#34D399', '#0EA5E9'],
};

function withAlpha(hex, aa) {
  // hex '#RRGGBB' + 2-char alpha → '#RRGGBBAA'
  return `${hex}${aa}`;
}

export default function KrushiEdgeGlow({ phase = 'recording', visible = true }) {
  const breathe = useRef(new Animated.Value(0)).current; // 0..1 opacity/scale pulse
  const [c0, c1] = PHASE_COLORS[phase] || PHASE_COLORS.idle;

  useEffect(() => {
    if (!visible) return undefined;
    // Faster pulse while listening/speaking, slower while thinking.
    const dur = phase === 'processing' ? 1100 : 780;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, phase, breathe]);

  if (!visible) return null;

  const opacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const outer = withAlpha(c0, 'F2');   // ~95% at the very edge
  const mid   = withAlpha(c1, '55');   // ~33% partway in
  const clear = withAlpha(c1, '00');   // transparent inward

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap, { opacity }]}>
      <LinearGradient colors={[outer, mid, clear]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={[styles.edge, { top: 0, left: 0, right: 0, height: EDGE }]} />
      <LinearGradient colors={[clear, mid, outer]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={[styles.edge, { bottom: 0, left: 0, right: 0, height: EDGE }]} />
      <LinearGradient colors={[outer, mid, clear]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={[styles.edge, { top: 0, bottom: 0, left: 0, width: EDGE }]} />
      <LinearGradient colors={[clear, mid, outer]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={[styles.edge, { top: 0, bottom: 0, right: 0, width: EDGE }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 50 },
  edge: { position: 'absolute' },
});
