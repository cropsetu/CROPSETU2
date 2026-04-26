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
  // ── Base ────────────────────────────────────────────────────────────────
  white:         PALETTE.white,      // #FFFFFF
  black:         '#000000',

  // ── Palette pass-through (for screens referencing raw palette) ─────────
  green800:      PALETTE.green800,   // #1B5E20
  green600:      PALETTE.green600,   // #388E3C
  green200:      PALETTE.green200,   // #C8E6C9
  orange100:     PALETTE.orange100,  // #FFCCBC
  orange700:     PALETTE.orange700,  // #BF360C
  brown100:      PALETTE.brown100,   // #D7CCC8
  brown600:      PALETTE.brown600,   // #5D4037

  // ── Brand (AgriStore, logo, nav) ─────────────────────────────────────────
  primary:       '#176B43',          // professional deep crop green
  primaryMedium: '#21865A',          // balanced action green
  primaryLight:  '#3DAA74',          // growth highlight
  primaryPale:   '#DFF3EA',          // soft mint
  primarySoft:   '#F3FBF7',          // near-white mint

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
  background:    '#F4F8F1',          // warm field-paper page background
  surface:       PALETTE.white,      // #FFFFFF card / sheet
  surfaceRaised: '#FAFCF8',          // slightly elevated paper
  surfaceSunken: '#ECF5EF',          // inset / input bg

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
  success:       '#176B43',
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

  // ── Utility colors (used by Weather, ProductDetail, Diagnosis screens) ────
  amber:         '#F57F17',
  amberLight:    '#FFB300',
  orange:        '#FF6B35',
  orangeBg:      '#FFF3EE',
  yellowBright:  '#FFB800',
  yellowDark:    '#996B00',
  blue:          '#1565C0',
  blueBg:        '#E3F2FD',
  purple:        '#9B59B6',
  greenDeep:     '#0F3D27',
  greenBright:   '#16A34A',
  red:           '#E74C3C',
  redAlpha06:    'rgba(231,76,60,0.063)',
  redAlpha12:    'rgba(231,76,60,0.125)',
  purpleAlpha15: 'rgba(155,89,178,0.145)',
  skyBright:     '#0EA5E9',
  skyBg:         '#F0F9FF',
  skyBorder:     '#BAE6FD',
  skyDeep:       '#0C4A6E',

  // ── Seller theme (orange-amber, distinct from farmer green) ────────────────
  sellerPrimary:       '#E65100',
  sellerPrimaryMedium: '#F4511E',
  sellerPrimaryLight:  '#FF7043',
  sellerPrimaryPale:   '#FBE9E7',
  sellerAccent:        '#1B5E20',
  sellerAccentLight:   '#43A047',
  sellerBg:            '#FFF8F4',
  sellerBorder:        '#FFDDD0',
  sellerPending:       '#F59E0B',
  sellerConfirmed:     '#0288D1',
  sellerShipped:       '#7C3AED',
  sellerDelivered:     '#43A047',


  grayBorder:    '#E5E7EB',
  gray100alt:    '#E8E8E8',
  slateBg:       '#F1F5F9',
  bluePale:      '#EFF6FF',
  greenMint300:  '#86EFAC',
  greenLive:     '#22C55E',
  greenDark2:    '#15803D',
  indigoPale:    '#818CF8',
  yellowPale:    '#FFFBEB',
  warmBg:        '#FFF8F0',
  orangeMid:     '#FB923C',
  grayPaper:     '#F9FAFB',
  yellowDark2:   '#F9A825',
  surfaceSunkenAlt: '#ECF5EF',
  redPale200:    '#FFCDD2',
  goldLight:     '#FDE68A',
  goldMid:       '#FBBF24',
  bluePaleBg:    '#F8F9FF',
  greenPale200:  '#C8E6C9',

  // ── Additional utility colors ────────────────────────────────────────────
  grayBg:        '#F3F4F6',
  gray150:       '#E0E0E0',
  gray175:       '#D1D5DB',
  gray350:       '#9CA3AF',
  gray550:       '#6B7280',
  gray650:       '#4B5563',
  gray700dark:   '#374151',
  slate50:       '#F8FAFC',
  slate800:      '#1E293B',
  warmGreen:     '#2D6A4F',
  amberDark:     '#F39C12',
  greenMint:     '#F0FDF4',
  orangeWarm:    '#FFF3E0',
  yellowWarm:    '#FFF8E1',
  yellowAmber:   '#FFFDE7',
  grayLight:     '#F0F0F0',
  redPale:       '#FFEBEE',
  tealDarkAlt:   '#00838F',
  tealPale2:     '#E0F7FA',
  purpleDark:    '#6A1B9A',
  purplePale:    '#F3E5F5',
  blueSteel:     '#37474F',
  steelPale:     '#ECEFF1',
  brownAlt:      '#6D4C41',
  brownPale:     '#EFEBE9',
  grayMid:       '#757575',

  // ── Extended palette (screen-specific accents) ────────────────────────────
  tealDeep: '#00695C',
  blueDark: '#01579B',
  skyDark: '#0277BD',
  skyMid: '#0369A1',
  forestNight: '#061810',
  navyNight: '#08101A',
  midnightBlue: '#0A1520',
  deepNavy: '#0A1628',
  forestDeep: '#0A1F12',
  nightSky: '#0D1B2A',
  darkForest: '#0D2B1A',
  pineGreen: '#0F2A1D',
  lushGreen: '#0F6E35',
  emerald: '#10B981',
  nearBlack: '#111827',
  darkGreen: '#166534',
  royalBlue: '#1976D2',
  charcoal: '#1A1A1A',
  deepIndigo: '#1A237E',
  darkHerb: '#1A2A1A',
  nightNavy: '#1B2A4A',
  deepPine: '#1B4332',
  duskPurple: '#1C1C2E',
  mediumGreen: '#21865A',
  whatsappGreen: '#25D366',
  stormGray: '#263238',
  tealMid: '#26A69A',
  freshGreen: '#27AE60',
  oceanBlue: '#2980B9',
  darkMaroon: '#2B0D0D',
  darkAmber: '#2B1D00',
  darkSlate: '#2C3E50',
  skyLight: '#38BDF8',
  indigoMid: '#3949AB',
  deepRed: '#3A0808',
  mintGreen: '#3DAA74',
  sageMid: '#40916C',
  greenSoft: '#48BB78',
  oliveGreen: '#4A6A4A',
  earthDark: '#4E342E',
  sageLight: '#52B788',
  cloudGray: '#546E7A',
  vibrantPurple: '#5B4CF5',
  brownDark: '#5C3D00',
  leafGreen: '#66BB6A',
  neonMint: '#69F0AE',
  calmGreen: '#74C69D',
  brownDeep: '#78350F',
  steelGray: '#78909C',
  deepBrick: '#7B1600',
  babyBlue: '#7DD3FC',
  softSage: '#81C784',
  violet: '#8B5CF6',
  amberDark2: '#92400E',
  mintLight: '#95D5B2',
  darkRed: '#9B1C1C',
  paleGreen: '#A5D6A7',
  burnOrange: '#B45309',
  crimson: '#B71C1C',
  seafoam: '#B7E4C7',
  seafoamLight: '#B8E8CC',
  crimsonAlt: '#B91C1C',
  coralRed: '#C0392B',
  silver: '#C0C0C0',
  rustOrange: '#C46716',
  mintBorder: '#C5DDCF',
  burntSienna: '#C63900',
  greenMist: '#C8E6D4',
  darkGold: '#CA8A04',
  lightGray: '#D0D0D0',
  mintPale: '#D1FAE5',
  paleForest: '#D8F3DC',
  greenWash: '#DCEFE5',
  lavender: '#DDD6FE',
  skyTint: '#E0F2FE',
  iceBluePale: '#E0F4FF',
  skyPale: '#E1F5FE',
  slateLight: '#E2E8F0',
  greenAsh: '#E4EDE7',
  greenTint: '#E4F4EC',
  tangerine: '#E67E22',
  coral: '#E76F51',
  blueMist: '#E7EFFF',
  grayTint: '#E8EAED',
  indigoPale2: '#E8EAF6',
  coolGray: '#E8EBF0',
  lightSky: '#E8F4FD',
  greenPale: '#E8F5EC',
  mintWash: '#E8F8EF',
  lavenderPale: '#EDE7F6',
  lightGray2: '#EEEEEE',
  greenMistPale: '#EEF7EE',
  greenPaper: '#F0F7F0',
  parchment: '#F1F1EE',
  paperGray: '#F1F3F4',
  softGray: '#F2F2F2',
  amberBright: '#F57C00',
  violetPale: '#F5F3FF',
  cloudBg: '#F5F7FA',
  greenBreeze: '#F5FCF9',
  snowGray: '#F7F9FA',
  nearWhite: '#F8F8F8',
  greenWhite: '#F9FFF9',
  lavenderWhite: '#FAF5FF',
  mintWhite: '#FAFFFE',
  coralPink: '#FCA5A5',
  amberVivid: '#FF6F00',
  orangeVivid: '#FF9800',
  butterscotch: '#FFE082',
  peach: '#FFE1A8',
  creamOrange: '#FFF0DF',
  roseTint: '#FFF0F0',
  blushPink: '#FFF5F5',
  warmCream: '#FFF8E8',
  ivoryWarm: '#FFFBF0',

  nearBlack2: '#0D0D0D',
  grayMid2: '#555555',
  purpleDark2: '#7B1FA2',
  mutedSage: '#8A938C',
  brownWarm: '#92610A',
  grayMedium: '#999999',
  greenPaleBorder: '#DDE8E0',
  charcoal2: '#222222',
  grayDark2: '#444444',
  grayMid3: '#777777',
  grayLight2: '#aaaaaa',
  grayLightMid: '#bbbbbb',
  nearBlack3: '#212121',
  oliveDeep: '#33691E',
  coffeeDark: '#3E2723',
  purpleDeep: '#4A148C',
  limeDark: '#558B2F',
  indigo: '#6366F1',
  brownTan: '#795548',
  limeGreen: '#7CB342',
  brownTan2: '#7D5548',
  pinkDark: '#880E4F',
  limeLight: '#8BC34A',
  brownLight: '#8D6E63',
  limePale: '#9CCC65',
  copperBrown: '#A1662F',
  limeGreenPale: '#AED581',
  brownLightPale: '#BCAAA4',
  grayMedLight: '#BDBDBD',
  grayNeutral: '#C4C4C4',
  limeWash: '#C5E1A5',
  purpleSoft: '#CE93D8',
  bluishGray: '#CFD8DC',
  sandTan: '#D7A86E',
  limeCloud: '#DCEDC8',
  deepOrange: '#E64A19',
  redSoft: '#EF5350',
  redBright: '#F44336',
  limeTint: '#F9FBE7',
  offWhite: '#FAFAFA',
  orangeAmber: '#FB8C00',
  salmonPink: '#FF8A80',
  amberDeep: '#FF8F00',
  orangeLight: '#FFB74D',
  goldenYellow: '#FFCA28',
  peachLight: '#FFCC80',
  yellow: '#FFEB3B',
  yellowLight: '#FFEE58',
  yellowPale2: '#FFF176',
  yellowCream: '#FFF59D',
  yellowTint: '#FFF9C4',
  deepOrangeVivid: '#FF5722',
  darkGray3: '#424242',
  successDark: '#2E7D32',
  primaryDark2: '#084C37',
  errorDark: '#C62828',
  redPale2: '#FFEBEE',
  orangePale: '#FFF3E0',
  greenPale2: '#E8F5E9',
  surfaceMuted: '#F1F4F7',
  amberWarm: '#F57F17',
  // ── Misc (legacy, keep for compatibility) ─────────────────────────────────
  shadow:        '#00000018',
  overlay:       '#00000060',
  tabActive:     '#176B43',
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
    shadowColor: '#176B43',
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
