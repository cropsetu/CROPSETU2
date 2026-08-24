/**
 * Seller design system — "warm agrarian premium".
 *
 * The seller app should read like a well-made paper ledger sitting on a wooden
 * counter, not like a generic SaaS admin panel. Three decisions carry that:
 *
 *   1. TYPOGRAPHY IS THE DESIGN. Fraunces (a soft serif) carries every number
 *      and every heading — earnings, order counts, screen titles. Plus Jakarta
 *      Sans carries everything a person actually reads word by word. The old
 *      scale was system-font weights only, which is why every screen looked
 *      like the default.
 *   2. PAPER, NOT PANELS. Surfaces are a three-step parchment hierarchy
 *      (page → raised → sunken) separated by a warm hairline and a *tinted*
 *      soft shadow, never the flat grey `shadowOpacity` box.
 *   3. ONE ACCENT, HELD. Harvest orange stays the seller identity (it is what
 *      distinguishes this app from the farmer-green buyer app). Everything
 *      else is neutral or a status colour that carries an icon too.
 *
 * WHY EVERY TYPE STEP PINS `fontFamily` AND NEVER `fontWeight`
 * -----------------------------------------------------------
 * React Native on Android resolves a custom font by exact family name and
 * ignores `fontWeight` entirely; on web, stacking `fontWeight: '800'` on a font
 * file that is already ExtraBold makes the browser synthesise a faux-bold on
 * top of a real one. So weight lives in the family name (`F.sans700`) and the
 * steps below are the only place it is chosen. Screens must not re-specify it.
 *
 * WHY `lineHeight` IS EXPLICIT ON EVERY STEP
 * ------------------------------------------
 * RN's default leading differs per platform *and* per font file. Without it,
 * rows of text drift out of alignment between iOS, Android and web — which is
 * exactly what used to happen in the order and product rows.
 *
 * Everything here is a plain object/function — no React — so it is safe to
 * import at module scope from `StyleSheet.create`.
 */
import { Platform, useWindowDimensions } from 'react-native';
import { COLORS, SHADOWS, RADIUS } from '@krushisarva/shared/constants/colors';

// ── Alpha helper ─────────────────────────────────────────────────────────────
// Screens used to append hex alpha suffixes by hand ('#E65100' + '18'), which
// silently produces garbage the moment a base colour becomes an rgb()/named
// value. This parses properly and returns the input untouched if it can't.
export function alpha(color, amount) {
  const a = Math.max(0, Math.min(1, amount));
  if (typeof color !== 'string') return color;
  const hex = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  let body = m[1];
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ── Raw ramps ────────────────────────────────────────────────────────────────
/**
 * Private. The seller app's own hex values live here rather than in
 * `@krushisarva/shared/constants/colors`, because the buyer app depends on that
 * module and must not inherit this palette. Nothing outside this file reads
 * `P` — screens and components consume the semantic `C` below.
 *
 * Text tones are chosen against `P.parchment`; every one of them clears 4.5:1.
 */
const P = {
  // Parchment — the paper the app is printed on.
  parchment:    '#FAF4EC',  // page
  parchmentDim: '#F5EDE2',  // page, alternate (settings/forms)
  paper:        '#FFFCF8',  // raised: cards, sheets, inputs
  paperSunken:  '#F2E9DE',  // sunken: tracks, wells, thumbnails
  hairline:     '#EADCCB',  // border on paper
  hairlineSoft: '#F0E6DA',  // divider inside a card
  hairlineDeep: '#E0CDB6',  // border on parchment / emphasised edge

  // Harvest orange — the seller identity.
  ember50:  '#FFF2EA',
  ember100: '#FFE2D2',
  ember200: '#FFC4A6',
  ember400: '#FF7043',
  ember500: '#E65100',   // brand mark, fills, indicators
  ember600: '#C63900',   // 4.8:1 on parchment — the orange that may be TEXT
  ember700: '#9C2A00',
  ember800: '#7B1600',
  ember900: '#4A1200',   // deep ground for headers

  // Cardamom — the money / confirmed-good secondary.
  leaf50:  '#E8F1E5',
  leaf500: '#2E6B34',
  leaf600: '#1B5E20',

  // Ink — warm browns, not neutral greys. Greys on parchment read as dirt.
  ink900: '#2A1C10',
  ink700: '#4E3D2E',
  ink500: '#6E5B49',
  ink400: '#7C6755',

  // Status. Hues are spread across the wheel (amber / azure / iris / moss /
  // rust) so they stay separable under deuteranopia and protanopia — and every
  // component that uses them also renders an icon and a text label, because
  // hue separation alone is not an accessible signal.
  amber50:  '#FDF0DA',
  amber500: '#D97706',
  amber600: '#A45A00',
  azure50:  '#E4F1F8',
  azure500: '#0288D1',
  azure600: '#0F6E9C',
  iris50:   '#EDE7FB',
  iris500:  '#7C3AED',
  iris600:  '#5B37B7',
  moss50:   '#E6F2E6',
  moss500:  '#43A047',
  moss600:  '#256B29',
  rust50:   '#FBEAE8',
  rust500:  '#DC2626',
  rust600:  '#B3261E',
  stone50:  '#EFE9E2',
  stone500: '#7A6E62',
  stone600: '#5A5148',

  white: '#FFFFFF',
  // Warm brown used to tint every shadow. A neutral black shadow over
  // parchment reads as grime; this reads as depth.
  shadow: '#5A2E0E',
  scrim:  '#2A1C10',
};

// ── Palette ──────────────────────────────────────────────────────────────────
export const C = {
  // Brand
  brand:        P.ember500,
  brandMedium:  COLORS.sellerPrimaryMedium,
  brandLight:   P.ember400,
  brandPale:    P.ember50,
  brandSoft:    P.ember100,
  brandDeep:    P.ember900,
  brandMid:     P.ember700,
  /** The only orange allowed as text or as an icon on a light surface. */
  brandInk:     P.ember600,

  accent:       P.leaf600,
  accentLight:  COLORS.sellerAccentLight,
  accentInk:    P.leaf500,
  accentPale:   P.leaf50,

  // Surfaces — three steps, always in this order: page < raised < sunken tint.
  bg:            P.parchment,
  bgAlt:         P.parchmentDim,
  surface:       P.paper,
  surfaceRaised: P.white,
  surfaceSunken: P.paperSunken,
  overlay:       alpha(P.scrim, 0.55),

  // Text
  text:      P.ink900,
  textBody:  P.ink700,
  textMuted: P.ink500,
  textFaint: P.ink400,
  onBrand:   P.white,
  onDark:    P.parchment,
  /** Secondary text on a deep-ember ground. 5.2:1 against `GRAD.brand`'s
   *  lightest stop — anything fainter than this fails on the panel. */
  onBrandMuted: alpha(P.white, 0.8),
  onBrandFaint: alpha(P.white, 0.14),

  // Lines
  border:        P.hairline,
  borderStrong:  P.hairlineDeep,
  borderNeutral: P.hairline,
  divider:       P.hairlineSoft,
  hairline:      P.hairline,

  // Status — `*Pale` is the fill, the base is the 4.5:1 ink on that fill.
  danger:      P.rust600,
  dangerBold:  P.rust500,
  dangerDeep:  P.rust600,
  dangerPale:  P.rust50,
  warning:     P.amber600,
  warningBold: P.amber500,
  warningPale: P.amber50,
  info:        P.azure600,
  infoBold:    P.azure500,
  infoPale:    P.azure50,
  success:     P.moss600,
  successBold: P.moss500,
  successDeep: P.moss600,
  successPale: P.moss50,
  neutral:     P.stone600,
  neutralPale: P.stone50,

  // Decorative
  shadowTint: P.shadow,
};

/**
 * Gradient ramps. Kept here so no screen inlines a set of stops.
 *
 * `brand` stops at ember700 rather than running down to ember500: white text
 * on #E65100 is 3.7:1 and fails AA, which is exactly what the old header ramp
 * did along its bottom third. Every stop in `brand` clears 7:1 against white.
 * `ember` is the bright ramp and is for decoration only — never behind text.
 */
export const GRAD = {
  brand:  [P.ember900, P.ember800, P.ember700],
  ember:  [P.ember600, P.ember500],
  /** Fades a panel into the page instead of ending on a hard seam. */
  fadeToPage: [alpha(P.parchment, 0), P.parchment],
};

// ── Order status ─────────────────────────────────────────────────────────────
/**
 * Single source of truth: colour, fill, icon and i18n key per status. The
 * lifecycle order (`step`) lives here too, so the order card's step indicator
 * and the "advance to next" button can never disagree about the sequence.
 */
const ORDER_STATUS = {
  PENDING:   { color: P.amber600, tint: P.amber50, icon: 'hourglass-outline',    step: 0, tKey: 'orders.statusPending',   fallback: 'Pending' },
  CONFIRMED: { color: P.azure600, tint: P.azure50, icon: 'checkmark-circle',     step: 1, tKey: 'orders.statusConfirmed', fallback: 'Confirmed' },
  SHIPPED:   { color: P.iris600,  tint: P.iris50,  icon: 'cube',                 step: 2, tKey: 'orders.statusShipped',   fallback: 'Shipped' },
  DELIVERED: { color: P.moss600,  tint: P.moss50,  icon: 'bag-check',            step: 3, tKey: 'orders.statusDelivered', fallback: 'Delivered' },
  CANCELLED: { color: P.rust600,  tint: P.rust50,  icon: 'close-circle',         step: -1, tKey: 'orders.statusCancelled', fallback: 'Cancelled' },
  REFUNDED:  { color: P.stone600, tint: P.stone50, icon: 'return-up-back',       step: -1, tKey: 'orders.statusRefunded',  fallback: 'Refunded' },
};

const ORDER_STATUS_FALLBACK = {
  color: P.stone600, tint: P.stone50, icon: 'ellipse-outline', step: -1, tKey: null, fallback: 'Unknown',
};

export function orderStatusMeta(status) {
  return ORDER_STATUS[status] || ORDER_STATUS_FALLBACK;
}

/** Human label for a status, translated when a key exists. */
export function orderStatusLabel(status, t) {
  const meta = orderStatusMeta(status);
  if (!meta.tKey) return status || meta.fallback;
  return t(meta.tKey, meta.fallback);
}

/**
 * Crop-report risk levels. Same contract as ORDER_STATUS — never colour alone,
 * so each carries an icon the row can render next to the text.
 */
export const RISK = {
  HIGH:     { color: P.rust600,  tint: P.rust50,  icon: 'alert-circle' },
  MEDIUM:   { color: P.amber600, tint: P.amber50, icon: 'warning-outline' },
  MODERATE: { color: P.amber600, tint: P.amber50, icon: 'warning-outline' },
  LOW:      { color: P.moss600,  tint: P.moss50,  icon: 'shield-checkmark-outline' },
};

const RISK_FALLBACK = { color: P.stone600, tint: P.stone50, icon: 'help-circle-outline' };

export function riskMeta(level) {
  return RISK[String(level || '').toUpperCase()] || RISK_FALLBACK;
}

// ── Spacing (8px grid, with 4px half-steps) ──────────────────────────────────
export const SP = {
  xxs: 2,
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
};

// ── Radius ───────────────────────────────────────────────────────────────────
/**
 * One radius language, held across the app:
 *   xs/sm  — inline chips of text, progress tracks
 *   md     — inputs, filter chips, small tiles      (14)
 *   lg     — nested blocks inside a card            (20)
 *   xl     — cards                                  (24)
 *   xxl    — bottom sheets, hero panels             (30)
 *   pill   — badges, primary buttons
 * A surface never mixes two of these on the same edge.
 */
export const R = {
  xs:   6,
  sm:   10,
  md:   14,
  lg:   20,
  xl:   24,
  xxl:  30,
  pill: 999,
};

// ── Fonts ────────────────────────────────────────────────────────────────────
/**
 * Exact family names as registered by `useFonts` in App.js. Anything not in
 * this map is not loaded and will silently fall back to the system font.
 */
export const F = {
  // Fraunces — display, headings, and every figure a seller cares about.
  serif500: 'Fraunces_500Medium',
  serif600: 'Fraunces_600SemiBold',
  serif700: 'Fraunces_700Bold',
  serif900: 'Fraunces_900Black',
  serifItalic: 'Fraunces_400Regular_Italic',
  // Plus Jakarta Sans — everything read as language.
  sans400: 'PlusJakartaSans_400Regular',
  sans500: 'PlusJakartaSans_500Medium',
  sans600: 'PlusJakartaSans_600SemiBold',
  sans700: 'PlusJakartaSans_700Bold',
  sans800: 'PlusJakartaSans_800ExtraBold',
};

// ── Type scale ───────────────────────────────────────────────────────────────
/**
 * Sizes run one step larger than a typical mobile scale on purpose: the reader
 * is outdoors in direct sun on a mid-range Android phone, often at arm's
 * length. Body text is 15px, not 14.
 */
export const T = {
  // Display / editorial — Fraunces.
  display:  { fontFamily: F.serif700, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  title:    { fontFamily: F.serif700, fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  heading:  { fontFamily: F.serif600, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  subhead:  { fontFamily: F.serif600, fontSize: 17, lineHeight: 23, letterSpacing: -0.1 },

  // Figures — the dashboard's hero numbers and every currency amount. Tabular
  // so a rolling count-up doesn't shift the layout on every frame.
  figure:   { fontFamily: F.serif900, fontSize: 38, lineHeight: 44, letterSpacing: -1.2, fontVariant: ['tabular-nums'] },
  figureMd: { fontFamily: F.serif700, fontSize: 26, lineHeight: 32, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  figureSm: { fontFamily: F.serif700, fontSize: 19, lineHeight: 25, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },

  // Eyebrow above a group of content. Uppercase + tracked, Jakarta.
  section:  { fontFamily: F.sans700, fontSize: 12, lineHeight: 16, letterSpacing: 1.4 },

  // Reading text — Plus Jakarta Sans.
  bodyLg:   { fontFamily: F.sans500, fontSize: 16, lineHeight: 24 },
  body:     { fontFamily: F.sans500, fontSize: 15, lineHeight: 22 },
  bodyBold: { fontFamily: F.sans700, fontSize: 15, lineHeight: 22 },
  label:    { fontFamily: F.sans600, fontSize: 13, lineHeight: 18 },
  labelBold:{ fontFamily: F.sans700, fontSize: 13, lineHeight: 18 },
  caption:  { fontFamily: F.sans500, fontSize: 12, lineHeight: 17 },
  captionBold: { fontFamily: F.sans700, fontSize: 12, lineHeight: 17 },
  micro:    { fontFamily: F.sans700, fontSize: 11, lineHeight: 14, letterSpacing: 0.6 },

  // Buttons get their own step: slightly tighter tracking than body at the
  // same size, which is what stops a label from looking loose inside a pill.
  button:   { fontFamily: F.sans700, fontSize: 15, lineHeight: 20, letterSpacing: 0.1 },
  buttonSm: { fontFamily: F.sans700, fontSize: 13, lineHeight: 18, letterSpacing: 0.2 },
};

// ── Elevation ────────────────────────────────────────────────────────────────
/**
 * Tinted, not grey. Every shadow is cast in warm brown so a card reads as
 * paper lying on a table rather than as a floating grey rectangle. Opacities
 * are low and radii are wide — the *border* does the edge definition (see
 * `Card`), the shadow only does the lift.
 */
export const E = {
  none: {},
  card: {
    shadowColor: P.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  raised: {
    shadowColor: P.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 5,
  },
  float: {
    shadowColor: P.shadow,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 40,
    elevation: 12,
  },
  /** Reserved for the primary action and the FAB — orange light, not brown. */
  brand: {
    shadowColor: P.ember500,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
};

// ── Touch targets ────────────────────────────────────────────────────────────
/**
 * WCAG 2.2 AA / platform HIG minimum. Every interactive element is at least
 * this tall, or carries hitSlop to reach it. Several controls used to be
 * 22–28px, which is unusable with gloves on — the actual field condition here.
 */
export const HIT = {
  min: 48,
  minCompact: 44,
  slop: { top: 10, bottom: 10, left: 10, right: 10 },
};

// ── Motion ───────────────────────────────────────────────────────────────────
/**
 * Refinement, not decoration. Entrance travel is capped at 18px and the
 * stagger at 60ms, because a list that keeps moving while you try to read it
 * is worse than one that simply appears. `useReducedMotion()` collapses all of
 * it to a cross-fade.
 */
export const MOTION = {
  entranceDistance: 14,
  entranceStagger: 55,
  entranceMaxDelay: 240,
  pressScale: 0.975,
};

// ── Responsive ───────────────────────────────────────────────────────────────
const BREAKPOINT = { sm: 360, md: 600, lg: 905, xl: 1240 };

/**
 * Layout facts derived from the *live* window size. Screens previously read
 * `Dimensions.get('window')` once at module scope, so a rotation or a resized
 * browser window left the layout computed against stale numbers.
 */
export function useResponsive() {
  const { width, height } = useWindowDimensions();

  const isCompact  = width < BREAKPOINT.md;                           // phones
  const isMedium   = width >= BREAKPOINT.md && width < BREAKPOINT.lg; // large phone / small tablet
  const isExpanded = width >= BREAKPOINT.lg;                          // tablet / desktop web
  const isLandscape = width > height;

  // Content never stretches edge-to-edge on a wide screen — long line lengths
  // are the main readability failure when this app is opened on desktop web.
  const contentMaxWidth = isExpanded ? 760 : isMedium ? 640 : width;

  return {
    width,
    height,
    isCompact,
    isMedium,
    isExpanded,
    isLandscape,
    contentMaxWidth,
    /** Columns for the dashboard quick-action grid. */
    quickActionColumns: isExpanded ? 4 : isMedium ? 4 : 2,
    /** Columns for stat cards. */
    statColumns: isExpanded ? 3 : isMedium ? 3 : 1,
    /** Horizontal page padding. */
    gutter: isCompact ? SP.xl : SP.xxl,
  };
}

// ── Misc ─────────────────────────────────────────────────────────────────────
export const IS_WEB = Platform.OS === 'web';

/** ₹ formatting that never throws on null/NaN/strings. */
export function formatCurrency(value, { withSymbol = true } = {}) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return withSymbol ? '₹—' : '—';
  const formatted = n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return withSymbol ? `₹${formatted}` : formatted;
}

/** Initials for an avatar, resilient to empty/whitespace/emoji names. */
export function initialsOf(name, fallback = 'S') {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const letters = parts.slice(0, 2).map((w) => Array.from(w)[0] || '').join('');
  return letters ? letters.toUpperCase() : fallback;
}

export { COLORS, SHADOWS, RADIUS };
