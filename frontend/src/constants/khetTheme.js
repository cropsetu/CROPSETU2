// ─────────────────────────────────────────────────────────────────────────────
// CropSetu auth theme — exact port of the Lovable design system (dharti-connect-hub).
// oklch tokens from src/styles.css converted to sRGB hex. Used only by the
// pre-login / phone / OTP auth screens so it doesn't disturb the app-wide palette.
// ─────────────────────────────────────────────────────────────────────────────

export const KHET = {
  // ── Core tokens (light theme) ──────────────────────────────────────────────
  background:          '#f9fdf6',  // oklch(0.99 0.01 130)
  foreground:          '#06210d',  // oklch(0.22 0.05 150)
  card:                '#ffffff',
  cardForeground:      '#06210d',
  primary:             '#005f21',  // deep forest green — oklch(0.42 0.13 150)
  primaryForeground:   '#f4fbed',  // oklch(0.98 0.02 130)
  primaryGlow:         '#31aa40',  // oklch(0.65 0.18 145)
  secondary:           '#e3f5da',
  secondaryForeground: '#003311',
  muted:               '#edf5e7',
  mutedForeground:     '#57685a',
  accent:              '#c9f2c0',
  accentForeground:    '#003508',
  gold:                '#e0af3b',
  destructive:         '#df2225',
  border:              '#d7e1d5',
  input:               '#e4efe2',
  ring:                '#25873e',
  white:               '#ffffff',

  // ── Gradient stops (use with expo-linear-gradient) ─────────────────────────
  // --gradient-primary: 135deg
  gradPrimary:   ['#005f21', '#008935'],
  // --gradient-surface: 160deg
  gradSurface:   ['#f8fef4', '#e1f6dc'],
  // --gradient-hero: 180deg, transparent -> dark -> very dark (overlay on hero img)
  gradHero:      ['rgba(0,36,3,0)', 'rgba(0,36,3,0.55)', 'rgba(0,24,3,0.96)'],
  gradHeroLocs:  [0, 0.45, 1],
};

// ── Fonts (loaded in App.js via @expo-google-fonts) ──────────────────────────
export const KFONT = {
  display:        'Fraunces_400Regular',           // serif display
  displayItalic:  'Fraunces_400Regular_Italic',
  displaySemi:    'Fraunces_600SemiBold',
  displayBold:    'Fraunces_700Bold',
  sans:           'PlusJakartaSans_400Regular',
  sansMed:        'PlusJakartaSans_500Medium',
  sansSemi:       'PlusJakartaSans_600SemiBold',
  sansBold:       'PlusJakartaSans_700Bold',
  sansExtra:      'PlusJakartaSans_800ExtraBold',
};

// ── Shadows (RN translations of --shadow-elegant / --shadow-soft) ────────────
export const KSHADOW = {
  elegant: {
    shadowColor: '#0e3a20',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.35,
    shadowRadius: 26,
    elevation: 12,
  },
  soft: {
    shadowColor: '#0e3a20',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
};
