/**
 * VoiceWaveform — direct port of Lovable cosmic-chat-companion VoiceWaveform.tsx.
 * Vertical amplitude bars with harvest-gold → leaf-green vertical gradient.
 * Height of each bar = amplitude * (1 - distFromCenter*0.6) * 2 + rAF-driven jitter.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function VoiceWaveform({ amplitude = 0, bars = 28, height = 20 }) {
  const [jitter, setJitter] = useState(() => Array.from({ length: bars }, () => 0));
  const rafRef = useRef(null);

  useEffect(() => {
    const tick = () => {
      // rAF-driven random jitter keeps randomness out of render (React purity)
      setJitter(Array.from({ length: bars }, () => Math.random()));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [bars]);

  return (
    <View style={[styles.row, { height, gap: 3 }]}>
      {Array.from({ length: bars }).map((_, i) => {
        const distFromCenter = Math.abs(i - bars / 2) / (bars / 2);
        const h = Math.max(
          0.15,
          amplitude * (1 - distFromCenter * 0.6) * 2 + (jitter[i] ?? 0) * 0.15 * amplitude,
        );
        const pct = Math.min(100, h * 100);
        return (
          <View key={i} style={[styles.barWrap, { height: `${pct}%` }]}>
            <LinearGradient
              colors={['#F5B841', '#22C55E']}
              start={{ x: 0, y: 1 }}
              end={{ x: 0, y: 0 }}
              style={styles.bar}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  barWrap: {
    width: 2,
    borderRadius: 99,
    overflow: 'hidden',
  },
  bar: {
    flex: 1,
    width: '100%',
    borderRadius: 99,
  },
});
