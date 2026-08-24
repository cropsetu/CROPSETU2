/**
 * BootScreen — what the seller sees before the app is ready.
 *
 * Shown while fonts load and while the stored session is being restored. The
 * original was a bare white-on-green ActivityIndicator with no text, which is
 * indistinguishable from a hang; this states what is happening and is announced
 * to screen readers.
 *
 * It is parchment, not a saturated splash. Two reasons:
 *   - the app it opens into is parchment, so a dark splash means a jarring
 *     white flash on every single cold start
 *   - it lets `<StatusBar style="dark" />` be correct from the very first
 *     frame; a screen that renders before the providers mount can't
 *     coordinate a status bar style with the rest of the app
 *
 * It runs BEFORE `useFonts` resolves, so it must survive Fraunces and Jakarta
 * being unavailable — every text style here falls back to the system font
 * gracefully, and nothing depends on a glyph's exact width.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { C, R, SP, T } from '../theme';

export default function BootScreen({ label }) {
  return (
    <View
      style={s.root}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      accessibilityLabel={label || 'Loading KrushiSarva Seller'}
    >
      <View style={s.mark}>
        <Text style={s.markTxt}>CS</Text>
      </View>

      <Text style={s.brand}>KrushiSarva</Text>
      <View style={s.ruleRow}>
        <View style={s.ruleSeg} />
        <Text style={s.kicker}>Seller</Text>
        <View style={s.ruleSeg} />
      </View>

      <ActivityIndicator size="small" color={C.brand} style={{ marginTop: SP.xxxl }} />
      {label ? <Text style={s.label}>{label}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.xxl,
    backgroundColor: C.bg,
  },
  mark: {
    width: 78, height: 78, borderRadius: R.lg,
    backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.xl,
    shadowColor: C.brand,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
    elevation: 8,
  },
  markTxt: { ...T.title, fontSize: 30, lineHeight: 36, color: C.onBrand },
  brand: { ...T.title, color: C.text },

  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.sm },
  ruleSeg: { width: 26, height: 1, backgroundColor: C.borderStrong },
  kicker: { ...T.micro, color: C.brandInk, textTransform: 'uppercase', letterSpacing: 2.4 },

  label: { ...T.caption, color: C.textMuted, marginTop: SP.lg, textAlign: 'center' },
});
