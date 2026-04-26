/**
 * cosmicTheme.js — MyFarm v2 design tokens (LIGHT, minimal, app-aligned).
 *
 * Palette and typography mirror the rest of the app (constants/colors.js)
 * so MyFarm blends in visually. Symbol names (`COSMIC`, `GRADIENT`, `GLOW`)
 * are preserved so importing screens don't need to change.
 *
 * Key numbers:
 *   • body fontSize 15 (was 18 in earlier revs — farmer-readable but not huge)
 *   • h1 24, h2 20, h3 17 — matches app's TYPE scale
 *   • tap target 48dp (standard mobile; the earlier 56dp cosmic felt clunky)
 *   • surfaces are white #FFFFFF with subtle 1-px #E7E5E4 borders
 *   • shadows are soft black (not coloured neon glows)
 */

// ─── Colours ──────────────────────────────────────────────────────────────────
export const COSMIC = {
  // Canvas — matches constants/colors.js `background` token
  BG:            '#F4F8F1',                   // warm field-paper page
  BG_ELEVATED:   '#FFFFFF',                   // sheets, modals
  SURFACE:       '#FFFFFF',                   // card background
  SURFACE_HI:    '#FAFCF8',                   // subtle elevated
  SURFACE_LO:    '#ECF5EF',                   // sunken / section stripe
  BORDER:        '#E7E5E4',                   // 1-px soft border
  BORDER_HI:     '#D6D3D1',                   // emphasized border

  // Brand — forest-green primary, orange CTA (same as the rest of the app)
  PRIMARY:       '#176B43',
  PRIMARY_DK:    '#0F4A2E',
  PRIMARY_LT:    '#21865A',
  PRIMARY_SOFT:  '#DFF3EA',

  ACCENT:        '#E65100',                   // CTA orange
  ACCENT_DK:     '#D84315',
  ACCENT_SOFT:   '#FBE9E7',

  // Activity-type accents (darkened for white-bg contrast)
  LAND_PREP:     '#6D4C41',
  SOWING:        '#65A30D',
  IRRIGATION:    '#0288D1',
  FERTILIZER:    '#00897B',
  SPRAY:         '#7B1FA2',
  SCOUT:         '#EF6C00',
  WEEDING:       '#558B2F',
  PRUNING:       '#C2185B',
  HARVEST:       '#F57F17',
  SALE:          '#176B43',
  EXPENSE:       '#C62828',
  INCOME:        '#176B43',

  // Status
  DANGER:        '#C62828',
  DANGER_SOFT:   '#FDECEA',
  WARN:          '#EF6C00',
  WARN_SOFT:     '#FFF4E6',
  INFO:          '#0288D1',
  INFO_SOFT:     '#E3F2FD',
  SUCCESS:       '#2E7D32',
  SUCCESS_SOFT:  '#E8F5E9',

  // Severity (scouting / observations)
  SEV_LOW:       '#2E7D32',
  SEV_MODERATE:  '#F57F17',
  SEV_HIGH:      '#C62828',
  SEV_CRITICAL:  '#8E1313',

  // Text (warm neutrals — same as rest of app)
  TEXT:          '#1C1917',                   // primary
  TEXT_2:        '#44403C',                   // body / secondary
  TEXT_3:        '#78716C',                   // tertiary / metadata
  MUTED:         '#A8A29E',                   // placeholder / disabled
  INVERSE:       '#FFFFFF',                   // text on gradient buttons

  OVERLAY:       'rgba(28,25,23,0.45)',
  SCRIM_TOP:     'rgba(244,248,241,0)',
  SCRIM_BOTTOM:  'rgba(244,248,241,0.92)',
};

// ─── Gradients (used sparingly — for primary CTAs only) ───────────────────────
export const GRADIENT = {
  primary:       ['#21865A', '#176B43'],               // forest-green button
  primaryBright: ['#3DAA74', '#176B43'],
  accent:        ['#FF7043', '#E65100'],               // orange CTA button (matches rest of app)
  logo:          ['#21865A', '#E65100', '#E65100'],
  danger:        ['#EF5350', '#C62828'],
  soil:          ['#A0826D', '#5D4037'],
  water:         ['#4FC3F7', '#0288D1'],
  glass:         ['#FFFFFF', '#FAFCF8'],

  start:         { x: 0, y: 0 },
  end:           { x: 1, y: 1 },
};

// ─── Shadows (soft black — no neon glows) ─────────────────────────────────────
export const GLOW = {
  green:  { shadowColor: '#176B43', shadowOpacity: 0.18, shadowRadius: 8,  shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  gold:   { shadowColor: '#E65100', shadowOpacity: 0.18, shadowRadius: 8,  shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  red:    { shadowColor: '#C62828', shadowOpacity: 0.16, shadowRadius: 6,  shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  soft:   { shadowColor: '#000',    shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  subtle: { shadowColor: '#000',    shadowOpacity: 0.04, shadowRadius: 4,  shadowOffset: { width: 0, height: 2 }, elevation: 1 },
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

// ─── Typography — matches constants/colors.js TYPE scale ─────────────────────
export const CT = {
  family: {
    regular:  'Inter_400Regular',
    medium:   'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold:     'Inter_700Bold',
    extra:    'Inter_800ExtraBold',
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
  },
  // Pre-baked style objects — all default to the dark warm primary text.
  styles: {
    labelXS: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#44403C', letterSpacing: 0.8, textTransform: 'uppercase' },
    bodySM:  { fontSize: 13, fontFamily: 'Inter_400Regular',  color: '#44403C' },
    body:    { fontSize: 15, fontFamily: 'Inter_400Regular',  color: '#1C1917' },
    label:   { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#1C1917' },
    h3:      { fontSize: 17, fontFamily: 'Inter_700Bold',     color: '#1C1917' },
    h2:      { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: '#1C1917' },
    h1:      { fontSize: 24, fontFamily: 'Inter_800ExtraBold', color: '#1C1917' },
    hero:    { fontSize: 28, fontFamily: 'Inter_800ExtraBold', color: '#1C1917' },
    muted:   { fontSize: 13, fontFamily: 'Inter_400Regular',  color: '#78716C' },
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
];

export const ACTIVITY_TYPE_MAP = Object.fromEntries(ACTIVITY_TYPES.map((a) => [a.key, a]));

export function activityMeta(key) {
  return ACTIVITY_TYPE_MAP[key] || { key, color: COSMIC.TEXT_2, icon: 'ellipse-outline', i18n: 'myFarm.v2.activity.other' };
}
