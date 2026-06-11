// ─────────────────────────────────────────────────────────────────────────────
// brandKit — shared CropSetu auth/profile design primitives
// ─────────────────────────────────────────────────────────────────────────────
// One source of truth for the "soft field-green" brand surface used by the login
// and account-profile screens: a themed palette (sourced entirely from the
// project design tokens in constants/colors.js), the serif display face, the
// decorative "neural leaf", and the small pill. Keeping these here means a theme
// change in colors.js flows to every brand surface automatically.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Svg, { Path, Line, Circle as SvgCircle } from 'react-native-svg';
import { COLORS } from '../../constants/colors';
import { s, vs, fs, ms } from '../../utils/responsive';

// High-contrast serif for the display headings (system fonts — no extra deps).
// Swap to a loaded Playfair Display family later for a pixel-exact match.
export const SERIF = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia, "Times New Roman", serif',
});

/** Translucent variant of a #RRGGBB token — used for soft brand-green tints. */
export function withAlpha(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Brand palette — every value is sourced from the project design tokens, so the
// auth + profile surfaces stay in lockstep with app theming. Keys are semantic
// (what each colour is for) for readability at the call site.
export const BRAND = {
  // Soft field-green canvas
  bgTop: COLORS.greenMistPale,    // #EEF7EE
  bgMid: COLORS.greenWash,        // #DCEFE5
  bgBot: COLORS.greenTint,        // #E4F4EC

  green: COLORS.primary,          // brand / icons            (#176B43)
  greenDeep: COLORS.primaryDark2, // deep green wordmark/fill  (#084C37)
  greenBright: COLORS.primaryMedium, // CTA gradient top       (#21865A)
  greenInk: COLORS.primary,       // CTA gradient bottom       (#176B43)
  greenMutedA: COLORS.mintLight,  // disabled CTA top          (#95D5B2)
  greenMutedB: COLORS.paleGreen,  // disabled CTA bottom       (#A5D6A7)

  pill: COLORS.primaryPale,       // light-green pill bg        (#DFF3EA)
  pillInk: COLORS.primary,        // pill text/icon

  headingDark: COLORS.textDark,   // display heading line 1     (#1C1917)
  headingGreen: COLORS.primary,   // display heading line 2

  textBody: COLORS.textMedium,    // gray subtitle / body       (#78716C)
  textHint: COLORS.textLight,     // placeholder / faint        (#A8A29E)
  label: COLORS.textMedium,

  white: COLORS.white,
  surface: COLORS.white,
  inputBorder: COLORS.greenPaleBorder, // #DDE8E0
  inputBg: COLORS.greenBreeze,    // near-white mint            (#F5FCF9)
  chipBg: COLORS.greenTint,       // #E4F4EC
  borderMed: COLORS.borderMedium, // #D6D3D1

  // Derived theme accents
  shadowGreen: COLORS.primaryDark2, // soft green elevation tint
  overlay: COLORS.overlay,           // modal scrim
  progressOff: COLORS.borderGreen,   // inactive progress segment (#C8E6C9)

  error: COLORS.error,            // #EF4444
  errorBg: COLORS.errorLight,     // #FEE2E2
  errorBorder: COLORS.redPale200, // #FFCDD2
  errorInk: COLORS.errorDark,     // #C62828
};

/** Soft field-green canvas gradient stops, for <LinearGradient colors={CANVAS}>. */
export const CANVAS = [BRAND.bgTop, BRAND.bgMid, BRAND.bgBot];

/** Soft green card elevation — spread into a white surface's style. */
export const CARD_SHADOW = {
  shadowColor: BRAND.shadowGreen,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 3,
};

// ── Decorative "neural leaf" — faint brand-green tech-leaf motif ─────────────
export function NeuralLeaf({ style }) {
  // Brand green at low opacity — tracks COLORS.primary via the palette.
  const stroke = withAlpha(BRAND.green, 0.16);
  const node = withAlpha(BRAND.green, 0.22);
  return (
    <View pointerEvents="none" style={[bk.leafWrap, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 200 260">
        <Path
          d="M100 8 C168 64 176 176 100 252 C24 176 32 64 100 8 Z"
          fill={withAlpha(BRAND.green, 0.10)}
        />
        <Line x1="100" y1="28" x2="100" y2="236" stroke={stroke} strokeWidth="2" />
        {[70, 105, 140, 175].map((y, i) => {
          const spread = 46 - i * 4;
          return (
            <React.Fragment key={y}>
              <Line x1="100" y1={y} x2={100 + spread} y2={y - 22} stroke={stroke} strokeWidth="1.5" />
              <Line x1="100" y1={y} x2={100 - spread} y2={y - 22} stroke={stroke} strokeWidth="1.5" />
              <SvgCircle cx={100 + spread} cy={y - 22} r="3.4" fill={node} />
              <SvgCircle cx={100 - spread} cy={y - 22} r="3.4" fill={node} />
            </React.Fragment>
          );
        })}
        <SvgCircle cx="100" cy="28" r="4" fill={node} />
      </Svg>
    </View>
  );
}

// ── Small light-green pill with a leading lucide icon ────────────────────────
export function BrandPill({ icon: Icon, label, style, tone = BRAND.pill, ink = BRAND.pillInk }) {
  return (
    <View style={[bk.pill, { backgroundColor: tone }, style]}>
      {Icon ? <Icon size={ms(14)} color={ink} strokeWidth={2.4} /> : null}
      <Text style={[bk.pillTxt, { color: ink }]} maxFontSizeMultiplier={1.3}>{label}</Text>
    </View>
  );
}

const bk = StyleSheet.create({
  leafWrap: {
    position: 'absolute',
    top: -vs(20),
    right: -s(40),
    width: s(300),
    height: vs(420),
    opacity: 0.9,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    alignSelf: 'flex-start',
    paddingHorizontal: s(12),
    paddingVertical: vs(7),
    borderRadius: 999,
  },
  pillTxt: { fontSize: fs(13), fontWeight: '700' },
});
