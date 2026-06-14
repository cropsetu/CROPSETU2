/**
 * cosmicTheme.js — MyFarm design tokens, ported to the KhetAI (Login) design system.
 *
 * The auth/Login screens use frontend/src/constants/khetTheme.js (KHET/KFONT/KSHADOW):
 * Fraunces serif display + Plus Jakarta Sans body, deep forest-green #005f21, gold #e0af3b,
 * gradient buttons, glass/accent pills, soft elegant shadows. This file re-points every
 * MyFarm token to that system so the whole tab matches Login without per-screen rewrites.
 *
 * Symbol names (`COSMIC`, `GRADIENT`, `GLOW`, `CR`, `CS`, `CT`, …) are preserved so the
 * ~20 importing screens/components keep working — only the VALUES changed.
 *
 * Key choices:
 *   • Body font  → Plus Jakarta Sans (matches Login). Big titles → Fraunces serif.
 *   • Primary    → forest green #005f21 (was #176B43). Accent CTA → gold (was orange).
 *   • Canvas     → warm green-white #F6FBEE (KhetAI background family).
 *   • Shadows    → soft forest-green (KSHADOW), no neon.
 */

// ─── Colours ──────────────────────────────────────────────────────────────────
export const COSMIC = {
  // Canvas — KhetAI surface family (warm green-white)
  BG:            '#F6FBEE',                   // page canvas
  BG_ELEVATED:   '#FFFFFF',                   // sheets, modals
  SURFACE:       '#FFFFFF',                   // card background
  SURFACE_HI:    '#F2FAEA',                   // subtle elevated (greenish)
  SURFACE_LO:    '#E7F4DD',                   // sunken / section stripe
  BORDER:        '#D7E1D5',                   // 1-px soft border (KhetAI border)
  BORDER_HI:     '#C2D2BD',                   // emphasized border

  // Brand — deep forest green primary, gold accent (KhetAI)
  PRIMARY:       '#005F21',
  PRIMARY_DK:    '#003311',
  PRIMARY_LT:    '#1C8A3C',                   // lighter forest (between glow & ring)
  PRIMARY_SOFT:  '#DCF1D0',                   // soft green wash

  ACCENT:        '#E0AF3B',                   // gold highlight (was orange #C28F22)
  ACCENT_DK:     '#C28F22',
  ACCENT_SOFT:   '#FAF0D5',

  // Activity-type accents (semantic per activity; tuned for white-bg contrast)
  LAND_PREP:     '#6D4C41',                   // earth brown
  SOWING:        '#65A30D',                   // sprout lime
  IRRIGATION:    '#0288D1',                   // water blue
  FERTILIZER:    '#00897B',                   // nutrient teal
  SPRAY:         '#7B1FA2',                   // protection purple
  SCOUT:         '#C77700',                   // observation amber
  WEEDING:       '#558B2F',                   // weed green
  PRUNING:       '#C2185B',                   // prune magenta
  HARVEST:       '#E0AF3B',                   // harvest gold
  SALE:          '#005F21',                   // money green
  EXPENSE:       '#C62828',                   // spend red
  INCOME:        '#005F21',                   // income green

  // Status
  DANGER:        '#C62828',
  DANGER_SOFT:   '#FDECEA',
  WARN:          '#C77700',
  WARN_SOFT:     '#FBF1DC',
  INFO:          '#0288D1',
  INFO_SOFT:     '#E3F2FD',
  SUCCESS:       '#2E7D32',
  SUCCESS_SOFT:  '#E8F5E9',

  // Severity (scouting / observations)
  SEV_LOW:       '#2E7D32',
  SEV_MODERATE:  '#C77700',
  SEV_HIGH:      '#C62828',
  SEV_CRITICAL:  '#8E1313',

  // Text — forest-tinted neutrals (KhetAI foreground #06210d / muted #57685a)
  TEXT:          '#0A2614',                   // primary
  TEXT_2:        '#33483A',                   // body / secondary
  TEXT_3:        '#57685A',                   // tertiary / metadata
  MUTED:         '#90A293',                   // placeholder / disabled
  INVERSE:       '#FFFFFF',                   // text on gradient buttons

  OVERLAY:       'rgba(6,33,13,0.45)',
  SCRIM_TOP:     'rgba(246,251,238,0)',
  SCRIM_BOTTOM:  'rgba(246,251,238,0.92)',
};

// ─── Gradients (forest-green CTAs; gold for accent) ───────────────────────────
export const GRADIENT = {
  primary:       ['#005F21', '#008935'],               // KhetAI gradPrimary
  primaryBright: ['#0A9A41', '#005F21'],
  accent:        ['#D2A436', '#A87C1C'],               // deep gold (white text legible)
  logo:          ['#005F21', '#E0AF3B', '#E0AF3B'],
  danger:        ['#EF5350', '#C62828'],
  soil:          ['#A0826D', '#5D4037'],
  water:         ['#4FC3F7', '#0288D1'],
  glass:         ['#FFFFFF', '#F2FAEA'],
  surface:       ['#F8FEF4', '#E1F6DC'],               // KhetAI gradSurface (canvas/hero)
  heroOverlay:   ['rgba(0,36,3,0)', 'rgba(0,36,3,0.55)', 'rgba(0,24,3,0.96)'], // image-hero overlay
  heroOverlayLocs: [0, 0.45, 1],

  start:         { x: 0, y: 0 },
  end:           { x: 1, y: 1 },
};

// ─── Shadows (soft forest-green — KhetAI KSHADOW) ─────────────────────────────
export const GLOW = {
  green:   { shadowColor: '#0E3A20', shadowOpacity: 0.20, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },  elevation: 4 },
  gold:    { shadowColor: '#E0AF3B', shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },  elevation: 4 },
  red:     { shadowColor: '#C62828', shadowOpacity: 0.16, shadowRadius: 6,  shadowOffset: { width: 0, height: 3 },  elevation: 3 },
  soft:    { shadowColor: '#0E3A20', shadowOpacity: 0.10, shadowRadius: 14, shadowOffset: { width: 0, height: 8 },  elevation: 6 },
  subtle:  { shadowColor: '#0E3A20', shadowOpacity: 0.05, shadowRadius: 6,  shadowOffset: { width: 0, height: 2 },  elevation: 1 },
  elegant: { shadowColor: '#0E3A20', shadowOpacity: 0.30, shadowRadius: 24, shadowOffset: { width: 0, height: 16 }, elevation: 12 }, // hero / gradient CTAs
};

// ─── Radius ───────────────────────────────────────────────────────────────────
export const CR = {
  xs:   4,
  sm:   6,
  md:   10,
  lg:   12,      // default card
  xl:   16,      // pills / larger containers
  xxl:  20,      // sheets
  pill: 999,
};

// ─── Spacing (8-px grid) ──────────────────────────────────────────────────────
export const CS = {
  xs: 4, sm: 8, md: 12, base: 14, lg: 18, xl: 24, xxl: 32, huge: 48,
};

// ─── Typography — KhetAI: Plus Jakarta Sans body + Fraunces serif display ─────
export const CT = {
  family: {
    regular:       'PlusJakartaSans_400Regular',
    medium:        'PlusJakartaSans_500Medium',
    semibold:      'PlusJakartaSans_600SemiBold',
    bold:          'PlusJakartaSans_700Bold',
    extra:         'PlusJakartaSans_800ExtraBold',
    // Serif display (Login hero / big titles)
    display:       'Fraunces_700Bold',
    displaySemi:   'Fraunces_600SemiBold',
    displayReg:    'Fraunces_400Regular',
    displayItalic: 'Fraunces_400Regular_Italic',
  },
  size: {
    labelXS: 11,
    bodySM:  13,
    body:    15,
    label:   15,
    h3:      17,
    h2:      20,
    h1:      24,
    hero:    28,
    display: 32,
  },
  // Pre-baked style objects — default to the dark forest text.
  styles: {
    labelXS:       { fontSize: 11, fontFamily: 'PlusJakartaSans_600SemiBold', color: '#33483A', letterSpacing: 0.8, textTransform: 'uppercase' },
    bodySM:        { fontSize: 13, fontFamily: 'PlusJakartaSans_400Regular',  color: '#33483A' },
    body:          { fontSize: 15, fontFamily: 'PlusJakartaSans_400Regular',  color: '#0A2614' },
    label:         { fontSize: 15, fontFamily: 'PlusJakartaSans_600SemiBold', color: '#0A2614' },
    h3:            { fontSize: 17, fontFamily: 'PlusJakartaSans_700Bold',     color: '#0A2614' },
    h2:            { fontSize: 20, fontFamily: 'PlusJakartaSans_800ExtraBold', color: '#0A2614' },
    h1:            { fontSize: 24, fontFamily: 'PlusJakartaSans_800ExtraBold', color: '#0A2614' },
    // Hero & display use the Fraunces serif to match the Login titles.
    hero:          { fontSize: 28, fontFamily: 'Fraunces_700Bold',            color: '#0A2614', letterSpacing: -0.4 },
    display:       { fontSize: 32, fontFamily: 'Fraunces_700Bold',            color: '#0A2614', letterSpacing: -0.5 },
    displayItalic: { fontFamily: 'Fraunces_400Regular_Italic', fontStyle: 'italic', color: '#005F21' },
    muted:         { fontSize: 13, fontFamily: 'PlusJakartaSans_400Regular',  color: '#57685A' },
  },
};

// ─── Tap targets & layout constants ───────────────────────────────────────────
export const TAP = {
  min:     48,     // standard mobile minimum
  compact: 40,
  fab:     52,
};

// ─── Motion ───────────────────────────────────────────────────────────────────
export const MOTION = {
  fast:   180,
  base:   220,
  slow:   320,
  spring: { speed: 18, bounciness: 6 },
};

// ─── Activity-type metadata (icon + colour + i18n label key) ──────────────────
export const ACTIVITY_TYPES = [
  { key: 'LAND_PREP',  color: COSMIC.LAND_PREP,  icon: 'trail-sign-outline',  i18n: 'myFarm.v2.activity.landPrep'  },
  { key: 'SOWING',     color: COSMIC.SOWING,     icon: 'leaf-outline',         i18n: 'myFarm.v2.activity.sowing'     },
  { key: 'IRRIGATION', color: COSMIC.IRRIGATION, icon: 'water-outline',        i18n: 'myFarm.v2.activity.irrigation' },
  { key: 'FERTILIZER', color: COSMIC.FERTILIZER, icon: 'flask-outline',        i18n: 'myFarm.v2.activity.fertilizer' },
  { key: 'SPRAY',      color: COSMIC.SPRAY,      icon: 'color-filter-outline', i18n: 'myFarm.v2.activity.spray'      },
  { key: 'SCOUT',      color: COSMIC.SCOUT,      icon: 'search-outline',       i18n: 'myFarm.v2.activity.scout'      },
  { key: 'WEEDING',    color: COSMIC.WEEDING,    icon: 'cut-outline',          i18n: 'myFarm.v2.activity.weeding'    },
  { key: 'PRUNING',    color: COSMIC.PRUNING,    icon: 'git-branch-outline',   i18n: 'myFarm.v2.activity.pruning'    },
  { key: 'HARVEST',    color: COSMIC.HARVEST,    icon: 'basket-outline',       i18n: 'myFarm.v2.activity.harvest'    },
  { key: 'SALE',       color: COSMIC.SALE,       icon: 'cash-outline',         i18n: 'myFarm.v2.activity.sale'       },
  { key: 'EXPENSE',    color: COSMIC.EXPENSE,    icon: 'arrow-down-outline',   i18n: 'myFarm.v2.activity.expense'    },
  { key: 'INCOME',     color: COSMIC.INCOME,     icon: 'arrow-up-outline',     i18n: 'myFarm.v2.activity.income'     },
  { key: 'OTHER',      color: COSMIC.PRIMARY_LT, icon: 'sparkles-outline',     i18n: 'myFarm.v2.activity.other'      },
];

export const ACTIVITY_TYPE_MAP = Object.fromEntries(ACTIVITY_TYPES.map((a) => [a.key, a]));

export function activityMeta(key) {
  return ACTIVITY_TYPE_MAP[key] || { key, color: COSMIC.TEXT_2, icon: 'ellipse-outline', i18n: 'myFarm.v2.activity.other' };
}
