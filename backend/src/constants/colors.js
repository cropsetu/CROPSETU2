// ─────────────────────────────────────────────────────────────────────────────
// FarmEasy Design System — Color Tokens
// 8px spacing grid · 4-level elevation · 5-step radius scale
// ─────────────────────────────────────────────────────────────────────────────

// ── Raw palette ───────────────────────────────────────────────────────────────
const PALETTE = {
  // Forest Green (primary brand — AgriStore, logo)
  green900: '#0D2B1D',
  green800: '#1B5E20',  // vivid forest green (updated)
  green700: '#2E7D32',
  green600: '#388E3C',
  green500: '#43A047',
  green400: '#66BB6A',
  green300: '#A5D6A7',
  green200: '#C8E6C9',
  green100: '#E8F5E9',
  green50:  '#F1F8E9',

  // Deep Indigo (navigation, UI accents)
  indigo900: '#1A237E',
  indigo800: '#283593',
  indigo700: '#303F9F',
  indigo600: '#3949AB',
  indigo500: '#3F51B5',
  indigo100: '#C5CAE9',
  indigo50:  '#E8EAF6',

  // Harvest Orange (CTA buttons, FABs, action accents)
  orange700: '#BF360C',
  orange600: '#D84315',
  orange500: '#E65100',  // primary CTA
  orange400: '#F4511E',
  orange300: '#FF7043',
  orange100: '#FFCCBC',
  orange50:  '#FBE9E7',

  // Teal (AI/tech, Rent section)
  teal700: '#00695C',
  teal600: '#00796B',
  teal500: '#00897B',
  teal400: '#26A69A',
  teal100: '#B2DFDB',
  teal50:  '#E0F2F1',

  // Sky Blue (Weather section)
  sky700: '#0277BD',
  sky600: '#0288D1',
  sky500: '#039BE5',
  sky100: '#B3E5FC',
  sky50:  '#E1F5FE',

  // Earth Brown (Animal Trade section)
  brown700: '#4E342E',
  brown600: '#5D4037',
  brown500: '#6D4C41',
  brown100: '#D7CCC8',
  brown50:  '#EFEBE9',

  // Gold (ratings, badges, special)
  gold500: '#F59E0B',
  gold400: '#FBBF24',
  gold100: '#FEF3C7',

  // Warm neutrals (earthy paper tones)
  cream50:  '#FDFBF7',
  cream100: '#F7F4EE',  // warm app background
  cream200: '#EDE8DA',  // chat parchment background
  cream300: '#E0D9CC',

  // Pure neutrals
  gray900: '#1C1917',  // warm near-black
  gray800: '#292524',
  gray700: '#44403C',
  gray600: '#57534E',
  gray500: '#78716C',  // warm gray
  gray400: '#A8A29E',
  gray300: '#D6D3D1',
  gray200: '#E7E5E4',
  gray100: '#F5F5F4',
  gray50:  '#FAFAF9',
  white:   '#FFFFFF',

  // Semantic status
  red600:  '#DC2626',
  red500:  '#EF4444',
  red100:  '#FEE2E2',
  yellow500: '#EAB308',
  yellow100: '#FEF9C3',
  blue500: '#3B82F6',
  blue100: '#DBEAFE',
};

// ── Semantic tokens ────────────────────────────────────────────────────────────
export const COLORS = {
  // ── Brand (AgriStore, logo, nav) ─────────────────────────────────────────
  primary:       '#2D9162',          // medium sage green (clean, not too dark)
  primaryMedium: '#278C5E',          // slightly deeper
  primaryLight:  '#38A874',          // lighter
  primaryPale:   '#E2F5EC',          // very light mint
  primarySoft:   '#F0FAF5',          // near-white mint

  // ── CTA / Action (harvest orange — primary buttons, FABs) ────────────────
  cta:           PALETTE.orange500,  // #E65100
  ctaDark:       PALETTE.orange600,  // #D84315
  ctaLight:      PALETTE.orange300,  // #FF7043
  ctaPale:       PALETTE.orange50,   // #FBE9E7

  // ── Section-specific accents ─────────────────────────────────────────────
  teal:          PALETTE.teal500,    // #00897B rent/machinery
  tealDark:      PALETTE.teal700,    // #00695C
  tealPale:      PALETTE.teal50,     // #E0F2F1
  skyBlue:       PALETTE.sky600,     // #0288D1 weather
  skyBluePale:   PALETTE.sky50,      // #E1F5FE
  earthBrown:    PALETTE.brown500,   // #6D4C41 animal trade
  earthPale:     PALETTE.brown50,    // #EFEBE9

  // ── Gold (ratings, badges) ────────────────────────────────────────────────
  gold:          PALETTE.gold500,    // #F59E0B
  goldPale:      PALETTE.gold100,    // #FEF3C7

  // Legacy accent alias (kept for compatibility)
  accent:        PALETTE.orange300,
  accentDark:    PALETTE.orange500,
  accentPale:    PALETTE.orange50,

  // ── Surfaces ──────────────────────────────────────────────────────────────
  background:    '#EEF8F4',          // light mint green page background
  surface:       PALETTE.white,      // #FFFFFF card / sheet
  surfaceRaised: '#F5FCF9',          // slightly elevated mint
  surfaceSunken: '#E8F5EE',          // inset / input bg

  // ── Text (warm neutrals — WCAG AA on white/surface) ─────────────────────
  textDark:      PALETTE.gray900,    // #1C1917 warm near-black
  textBody:      PALETTE.gray700,    // #44403C
  textMedium:    PALETTE.gray500,    // #78716C warm gray
  textLight:     PALETTE.gray400,    // #A8A29E
  textDisabled:  PALETTE.gray300,    // #D6D3D1
  textWhite:     PALETTE.white,
  textPrimary:   PALETTE.green800,

  // ── Borders & dividers ────────────────────────────────────────────────────
  border:        PALETTE.gray200,    // #E7E5E4
  borderMedium:  PALETTE.gray300,    // #D6D3D1
  divider:       PALETTE.gray100,    // #F5F5F4
  borderGreen:   PALETTE.green200,   // #C8E6C9

  // ── Status ────────────────────────────────────────────────────────────────
  success:       '#2D9162',
  successLight:  '#E2F5EC',
  warning:       PALETTE.yellow500,
  warningLight:  PALETTE.yellow100,
  error:         PALETTE.red500,
  errorLight:    PALETTE.red100,
  info:          PALETTE.teal500,
  infoLight:     PALETTE.teal100,

  // ── Interactive inputs ────────────────────────────────────────────────────
  inputBg:       PALETTE.cream50,    // #FDFBF7
  inputBorder:   PALETTE.gray200,
  inputFocus:    PALETTE.green700,

  // ── Misc (legacy, keep for compatibility) ─────────────────────────────────
  shadow:        '#00000018',
  overlay:       '#00000060',
  tabActive:     '#2D9162',
  tabInactive:   PALETTE.gray400,
  cardShadow:    '#00000010',
};

// ── Elevation (shadow tokens) ─────────────────────────────────────────────────
export const SHADOWS = {
  none: {},
  xs: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  greenGlow: {
    shadowColor: '#2D9162',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  orangeGlow: {
    shadowColor: '#E65100',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 3,
  },
};

// ── Typography scale (8-step, 1.25 ratio) ────────────────────────────────────
export const TYPE = {
  // Font sizes
  size: {
    xs:   11,
    sm:   13,
    base: 15,
    md:   17,
    lg:   20,
    xl:   24,
    xxl:  28,
    hero: 36,
  },
  // Font weights (React Native string values)
  weight: {
    regular: '400',
    medium:  '500',
    semibold:'600',
    bold:    '700',
    black:   '900',
  },
  // Line heights
  leading: {
    tight:  1.2,
    normal: 1.5,
    loose:  1.75,
  },
};

// ── Spacing scale (8px grid) ──────────────────────────────────────────────────
export const SPACE = {
  px:  1,
  0.5: 4,
  1:   8,
  1.5: 12,
  2:   16,
  2.5: 20,
  3:   24,
  4:   32,
  5:   40,
  6:   48,
  8:   64,
};

// ── Border radius scale ───────────────────────────────────────────────────────
export const RADIUS = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  28,
  full: 999,
};
