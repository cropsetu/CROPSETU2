// ─────────────────────────────────────────────────────────────────────────────
// CropSetu · Auth Design Tokens
// ─────────────────────────────────────────────────────────────────────────────
// A small, named token set for the phone-login experience. Light AND dark are
// fully defined here so the screens respect the system color scheme with zero
// per-component branching. Nothing below is a "magic number" — components only
// ever read from the theme object returned by `useAuthTheme()`.
//
// Brand language:
//   • Primary   — agricultural greens (deep field green + fresh leaf green)
//   • Secondary — warm earth / soil neutral
//   • Accent    — a single harvest gold, reserved for the primary CTA only
//
// Device scaling (s/vs/fs/ms) is applied where tokens are *consumed*, so the
// raw scale here stays readable and documentable (see README).
// ─────────────────────────────────────────────────────────────────────────────
import { useColorScheme } from 'react-native';
import React, { createContext, useContext, useMemo } from 'react';
import { fs } from '../../../utils/responsive';

// Inter family names exactly as registered in App.js via @expo-google-fonts.
const FONT = {
  regular:  'Inter_400Regular',
  medium:   'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold:     'Inter_700Bold',
  black:    'Inter_800ExtraBold',
};

// ── Mode-independent scales ─────────────────────────────────────────────────
// One source of truth for rhythm. Everything aligns to a 4px sub-grid.
const SPACE = { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40 };
const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 };

// Motion durations (ms). Springs come from the shared motion.js; these cover the
// duration-based focus/colour transitions the brief calls out (150–250ms).
const MOTION = { fast: 150, base: 200, slow: 280 };

// Minimum interactive target. Material/iOS both land near 48dp; we never go below.
const TAP = 48;

// Typographic ramp — raw sizes; scaled with fs() when turned into styles below.
// size · lineHeight · family · letterSpacing
const RAMP = {
  display:    { size: 30, lineHeight: 36, family: FONT.black,    weight: '800', spacing: -0.4 },
  title:      { size: 22, lineHeight: 28, family: FONT.bold,     weight: '700', spacing: -0.2 },
  subtitle:   { size: 16, lineHeight: 23, family: FONT.regular,  weight: '400', spacing: 0 },
  label:      { size: 14, lineHeight: 18, family: FONT.semibold, weight: '600', spacing: 0.1 },
  body:       { size: 16, lineHeight: 24, family: FONT.regular,  weight: '400', spacing: 0 },
  bodyStrong: { size: 16, lineHeight: 24, family: FONT.semibold, weight: '600', spacing: 0 },
  button:     { size: 17, lineHeight: 22, family: FONT.bold,     weight: '700', spacing: 0.2 },
  helper:     { size: 13, lineHeight: 18, family: FONT.medium,   weight: '500', spacing: 0 },
  caption:    { size: 12, lineHeight: 16, family: FONT.medium,   weight: '500', spacing: 0.2 },
  otpDigit:   { size: 26, lineHeight: 30, family: FONT.bold,     weight: '700', spacing: 0 },
  dialCode:   { size: 17, lineHeight: 22, family: FONT.bold,     weight: '700', spacing: 0.2 },
  phone:      { size: 18, lineHeight: 24, family: FONT.semibold, weight: '600', spacing: 1.5 },
};

// Turn a ramp entry into a ready-to-spread RN text style, applying gentle font
// scaling. fontFamily already encodes the weight; fontWeight is kept only as a
// graceful fallback (react-native-web / missing font).
function toTextStyle(r) {
  return {
    fontFamily: r.family,
    fontSize: fs(r.size),
    lineHeight: fs(r.lineHeight),
    fontWeight: r.weight,
    letterSpacing: r.spacing,
  };
}
const TEXT = Object.fromEntries(Object.entries(RAMP).map(([k, v]) => [k, toTextStyle(v)]));

// ── Palettes ────────────────────────────────────────────────────────────────
// Semantic keys are identical across modes so components never branch on scheme.
// Contrast targets WCAG AA for UI / body text and AAA for the largest copy.
const LIGHT = {
  mode: 'light',
  statusBar: 'light',                       // light icons over the dark green hero

  // Hero backdrop — the deep field-green the light card floats on (60% of canvas)
  heroGradient: ['#15663F', '#0F4E30', '#0A3A24'],
  screenBg: '#15663F',
  onHero: '#FFFFFF',
  onHeroDim: '#CFE6DA',

  // Surfaces
  surface: '#FFFFFF',                        // the card
  surfaceAlt: '#F2F8F4',                     // input rest background
  surfaceFocus: '#FFFFFF',                   // input focused background

  // Brand greens
  primary: '#15663F',
  primaryDim: '#1E875A',
  leaf: '#3FAE78',                           // fresh-leaf highlight (trust, dots)
  primaryWash: '#E2F2EA',                    // pale tint behind header icons

  // Secondary warm-earth neutral
  earth: '#7C6A58',
  earthWash: '#F1ECE5',

  // Borders / dividers
  border: '#CFE3D7',
  borderStrong: '#E3EAE5',
  borderFocus: '#15663F',

  // Accent — harvest gold, CTA only. Dark text on gold = AAA, ideal in sunlight.
  accent: '#F2A20C',
  accentPressed: '#D98C00',
  accentDisabledBg: '#E6DBC4',               // a *different colour*, not just opacity
  onAccent: '#27170A',
  onAccentDisabled: '#A2987F',

  // Text
  textPrimary: '#16241C',
  textSecondary: '#566159',
  textTertiary: '#7E8A82',
  textPlaceholder: '#9AA8A0',

  // Status — success / error each pair colour with an icon + text in the UI
  success: '#1B7A4B',
  successBg: '#E2F5EC',
  successBorder: '#A7DCC2',
  onSuccessBg: '#0E5733',

  error: '#D14343',
  errorBg: '#FCEBEB',
  errorBorder: '#F3C9C9',
  onErrorBg: '#A62828',

  // Misc
  overlay: 'rgba(8,24,16,0.55)',
  focusGlow: '#15663F',
};

const DARK = {
  mode: 'dark',
  statusBar: 'light',

  heroGradient: ['#0B2418', '#0A1C13', '#06120C'],
  screenBg: '#0B2418',
  onHero: '#EAF3EE',
  onHeroDim: '#9FBBAD',

  surface: '#11211A',
  surfaceAlt: '#16291F',
  surfaceFocus: '#1B3026',

  primary: '#3FAE78',
  primaryDim: '#2E8C5E',
  leaf: '#56C68D',
  primaryWash: '#15291F',

  earth: '#B8A795',
  earthWash: '#1C2620',

  border: '#274135',
  borderStrong: '#22382D',
  borderFocus: '#3FAE78',

  accent: '#FBBF24',
  accentPressed: '#E2A610',
  accentDisabledBg: '#3A3320',
  onAccent: '#201503',
  onAccentDisabled: '#7E7458',

  textPrimary: '#EAF3EE',
  textSecondary: '#A9BBB1',
  textTertiary: '#7E938A',
  textPlaceholder: '#67786E',

  success: '#43C088',
  successBg: '#10271C',
  successBorder: '#2C5C43',
  onSuccessBg: '#9FE3C0',

  error: '#F0807F',
  errorBg: '#2A1515',
  errorBorder: '#5A2A2A',
  onErrorBg: '#F4A6A5',

  overlay: 'rgba(0,0,0,0.62)',
  focusGlow: '#3FAE78',
};

// Elevation reads differently per mode — soft drop shadow on light, almost none
// on dark (shadows are invisible on near-black; we lean on the border instead).
function shadowsFor(mode) {
  if (mode === 'dark') {
    return {
      card: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 20, elevation: 8 },
      cta:  { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4,  shadowRadius: 10, elevation: 6 },
      none: { shadowColor: 'transparent', elevation: 0 },
    };
  }
  return {
    card: { shadowColor: '#0A3A24', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 6 },
    cta:  { shadowColor: '#B5780A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 10, elevation: 5 },
    none: { shadowColor: 'transparent', elevation: 0 },
  };
}

/**
 * Build the full theme object for a given color scheme.
 * @param {'light'|'dark'} scheme
 */
export function makeTheme(scheme) {
  const palette = scheme === 'dark' ? DARK : LIGHT;
  return Object.freeze({
    ...palette,
    space: SPACE,
    radius: RADIUS,
    motion: MOTION,
    tap: TAP,
    font: FONT,
    text: TEXT,
    ramp: RAMP,
    shadow: shadowsFor(palette.mode),
  });
}

// Optional override channel: a provider can force a scheme app-wide (the demo's
// light/dark toggle, or a host that pins one brand mode). `null` = follow OS.
const ThemeOverrideContext = createContext(null);

/**
 * AuthThemeProvider — forces a scheme for everything beneath it.
 * @param {{scheme?: 'light'|'dark'|null, children: React.ReactNode}} props
 */
export function AuthThemeProvider({ scheme = null, children }) {
  return <ThemeOverrideContext.Provider value={scheme}>{children}</ThemeOverrideContext.Provider>;
}

/**
 * useAuthTheme — resolves the active theme.
 * Resolution order: explicit `override` arg → context override → OS scheme →
 * light. Memoised so downstream style factories only recompute on a real flip.
 *
 * @param {'light'|'dark'} [override]
 */
export function useAuthTheme(override) {
  const system = useColorScheme();             // 'light' | 'dark' | null
  const forced = useContext(ThemeOverrideContext);
  const scheme = override || forced || system || 'light';
  return useMemo(() => makeTheme(scheme), [scheme]);
}

export { FONT, SPACE, RADIUS, MOTION, RAMP, TAP };
