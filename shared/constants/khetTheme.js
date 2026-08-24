// ─────────────────────────────────────────────────────────────────────────────
// KrushiSarva auth theme — exact port of the Lovable design system (dharti-connect-hub).
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

  // ── Status roles ───────────────────────────────────────────────────────────
  // ADDED after the original auth-only palette: KHET had `destructive` and
  // nothing else, so screens invented their own greens, ambers and reds. Every
  // ink below is >= 4.5:1 (WCAG AA for normal text) on ALL THREE of its
  // surfaces — card #ffffff, background #f9fdf6, and its own tint — so a badge,
  // an inline message and a plain label can all use the same token safely.
  //
  //   *Ink*  = text and icons.   *Bg* = the tinted surface behind them.
  //
  // Note `successInk` is close in hue to `primary`: in a forest-green app green
  // alone cannot carry "this succeeded". Always pair it with an icon or a word.
  successInk:     '#0a7d0a',  // 5.32 on card · 5.17 on bg · 4.67 on successBg
  successBg:      '#e6f4e6',
  warningInk:     '#8a6100',  // 5.54 · 5.38 · 4.90
  warningBg:      '#fbf0d8',
  infoInk:        '#0d6aa8',  // 5.76 · 5.60 · 4.97
  infoBg:         '#e3f0f9',
  // `destructive` (#df2225) stays exactly as it was — it is the SURFACE/border
  // red and 573 references depend on it. As TEXT on destructiveBg it only makes
  // 4.07:1, so text uses destructiveInk instead.
  destructiveInk: '#b3231f',  // 6.61 · 6.42 · 5.63
  destructiveBg:  '#fde8e8',
  // Ink for text sitting ON the gold badge. White on gold is 2.03:1 — a real
  // AA failure that shipped; this warm near-black makes 8.11:1.
  goldForeground: '#2b1d00',
  // Gold used AS TEXT. `gold` itself is a SURFACE/icon colour: on a white card it
  // is also 2.03:1, so any gold label, price or heading needs this darker step
  // (5.54:1) instead. Same hue family, legible.
  goldInk:        '#8a6100',
  // Links: deliberately blue, because in a screen this green nothing else reads
  // as "tap this text".
  link:           '#0d6aa8',
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

// ═════════════════════════════════════════════════════════════════════════════
// SCALES — spacing, type, radius, elevation.
//
// These were derived by measuring the app rather than by picking round numbers:
// ~3,123 spacing declarations, 1,344 fontSize, 855 borderRadius (incl. corner
// variants) across frontend/src/screens. Steps are chosen to MINIMISE TOTAL
// PIXEL MOVEMENT, not to look tidy — 91% of existing spacing and 93% of existing
// font sizes land on a step with a delta of exactly 0, so a migrated screen sits
// next to an unmigrated one without a visible seam. That is what makes a
// 90-screen migration shippable one screen at a time.
//
// The codebase is a 2px grid, not a 4px or 8px one: of ~3,086 positive spacing
// values 87% divide by 2 but only 47% by 4, and the mod-4 residues are bimodal
// (class 0 = 47%, class 2 = 40%) — two competing families, not noise around one
// grid. Snapping every value to its nearest multiple of 4 would move 2,865px of
// spacing; this scale moves ~450.
//
// ── RELATIONSHIP TO colors.js (READ THIS FIRST) ──────────────────────────────
// shared/constants/colors.js ALREADY exports SPACE, RADIUS, SHADOWS and TYPE,
// and they are live: SHADOWS in 21 files, RADIUS in 9, TYPE.weight in 7, SPACE
// in 2. The scales here do not delete, wrap or alias them — they overlap
// substantially but are NOT identical, and pretending otherwise is how you get a
// fourth system. The precedence rule is:
//
//   NEW code                 → KSPACE / KRADIUS / KTYPE / KELEV (here).
//   Existing colors.js users → leave them. They are not broken.
//   ONE FILE, ONE VOCABULARY → never mix SPACE and KSPACE in the same screen.
//                              Migrating a screen means converting all of it.
//
// The end state is colors.js SPACE/RADIUS/TYPE re-exporting from here once their
// call sites are gone. That is a separate change with its own blast radius; it
// is deliberately NOT done in this one.
//
// ── PREFERRED SUBSET FOR NEW CODE ────────────────────────────────────────────
// The full ladders exist to make the migration diff empty. When writing NEW
// screens, reach only for:
//   KSPACE   s4 · s8 · s10 · s12 · s16 · s24 · s32 · s48
//   KRADIUS  r12 (controls) · r14 (surfaces) · r20 (large) · pill
//   KTYPE    meta · caption · bodySm · body · subhead · button · title · titleLg
//   KICON    sm · base · md · lg
//   KBORDER  hairline · selected
// Everything else is a migration target, not a design choice.
//
// (s10 was missing from this list in the first draft — an error, since the
// KSPACE comment two blocks down correctly calls it a co-dominant row gap. It is
// the second most used step in the app; excluding it would have forced 429
// declarations off the preferred path for no reason.)
// ═════════════════════════════════════════════════════════════════════════════

// ── Spacing ──────────────────────────────────────────────────────────────────
// s10 and s14 are load-bearing, not sloppy: s14 is the signature KrushiSarva card
// padding (37% of all card padding shorthands) and s10 is the co-dominant row
// gap. Snapping either to 8 or 12 would move hundreds of declarations.
export const KSPACE = {
  s0:  0,    // explicit reset (zeroing RN's default TextInput padding)
  s1:  1,    // optical nudge ONLY — never rhythm
  s2:  2,    // sub-label under a title
  s3:  3,    // chip / pill / badge padding
  s4:  4,    // label-to-value rhythm, micro gaps
  s6:  6,    // tight inline / icon gap
  s8:  8,    // default inline + list/grid gap  ← preferred
  s10: 10,   // row gap, card paddingVertical
  s12: 12,   // dense header gutter, control padding  ← preferred
  s14: 14,   // the signature card padding
  s16: 16,   // header bar gutter, body gutter  ← preferred
  s18: 18,   // second header gutter standard
  s20: 20,   // the AI/Soil cluster screen gutter
  s24: 24,   // empty-state padding, large card padding  ← preferred
  s32: 32,   // screen-level vertical rhythm  ← preferred
  s40: 40,   // hero block spacing
  s48: 48,   // largest layout gap  ← preferred
  s64: 64,   // full-screen centred states

  // Roles, not rhythm — these clear fixed chrome and must not be "rounded".
  tailTab: 100,  // paddingBottom clearing the bottom tab bar
  tailFab: 120,  // paddingBottom clearing the tab bar AND a floating button

  // Negative optical corrections (pulling content under a header, etc.)
  n2:  -2,
  n8:  -8,
  n12: -12,
  n16: -16,
  n20: -20,
};

// ── Screen gutters ───────────────────────────────────────────────────────────
// Three gutters is a deliberate DEFERRAL, not a design position. The AI/Soil
// cluster sits at 20 and the Rent/Store cluster at 16; unifying them now would
// narrow a whole tab by 4px against its unmigrated siblings. Keeping them named
// converts an invisible drift into a greppable one — `grep -c gutterWide` tells
// you exactly how much is left to unify.
export const KGUTTER = {
  tight: 14,
  base:  16,
  wide:  20,
};

// ── Radius ───────────────────────────────────────────────────────────────────
// The r12/r14 split is real and worth keeping: r12 is what you TOUCH (fields,
// photo cells, small buttons), r14 is what you READ (cards, surfaces).
export const KRADIUS = {
  r4:   4,    // drag handles, progress bars
  r10:  10,   // chips, badges, inputs, search rows
  r12:  12,   // controls — things you touch  ← preferred
  r14:  14,   // surfaces — things you read  ← preferred
  r16:  16,   // large content surfaces, chat bubbles
  r18:  18,   // the LARGE card tier — see the three-tier note below
  r20:  20,   // large action buttons, hero cards, sheets  ← preferred
  r28:  28,   // the hero sweep: the bottom corners of a gradient page header
  pill: 999,  // pills AND circles — RN clamps to half the shorter side
};
// Why r18 and r28 exist, when a tidier ladder would stop at r20:
// The CropDetail pilot found the app runs a THREE-tier card ladder — 14 nested,
// 16 standard, 18 large — and that the gradient hero's 28px bottom sweep is the
// single most visible shape on a page. Both were 8px and 2px from the nearest
// step respectively, and rounding them was the largest visual delta the whole
// migration would have caused. They are chrome geometry, not content rhythm.

// ── Elevation ────────────────────────────────────────────────────────────────
// Four downward tiers plus an upward variant for bottom sheets. e1–e4 each carry
// BOTH the iOS shadow* props and Android's elevation — 42 blocks in the app today
// set shadowOpacity with no shadowOffset, which renders on iOS and vanishes on
// Android.
//
// e3Up is the exception and it is called out below: Android cannot cast an
// upward shadow at all, so that tier is iOS-shadow + Android-hairline by design.
//
// e3 and e4 SPREAD KSHADOW.soft and KSHADOW.elegant rather than restating their
// numbers, so the two vocabularies cannot drift apart — editing KSHADOW moves
// KELEV with it. (Copying would have been the drift mechanism, not the guard.)
export const KELEV = {
  e1: {
    shadowColor: '#0e3a20', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  e2: {
    shadowColor: '#0e3a20', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.10, shadowRadius: 10, elevation: 3,
  },
  e3: { ...KSHADOW.soft },
  e4: { ...KSHADOW.elegant },

  // Bottom sheets / bars casting UPWARD. Android's elevation only ever paints a
  // shadow below the view, so there is no Android shadow to be had here: this
  // tier ships the hairline border itself (width included — a borderTopColor
  // with no borderTopWidth paints nothing) so it renders on both platforms
  // without the caller having to remember a second property.
  e3Up: {
    shadowColor: '#0e3a20', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.14, shadowRadius: 14, elevation: 0,
    borderTopWidth: 1, borderTopColor: '#d7e1d5',
  },
};

// ── Type scale ───────────────────────────────────────────────────────────────
// Each role is a complete, spreadable style: size + leading + family (+ tracking
// where it earns it). Spread it, don't copy from it:
//     title: { ...KTYPE.title, color: KHET.foreground }
//
// Every role names a family and carries NO fontWeight, because on Android the
// two together are actively destructive: naming a custom fontFamily AND a
// fontWeight >= 700 makes Android look for a font file that was never
// registered, fail, and fall back to system Roboto — throwing the brand face
// away entirely. 57 style blocks across 8 files do exactly this today. Weight is
// carried by the family name here (sansBold, sansExtra); never add fontWeight
// alongside one of these roles.
//
// IMPORTANT — the inverse is NOT a bug: 632 blocks set fontWeight with NO
// fontFamily, which is legitimate system-font styling and renders correctly on
// both platforms. Only the PAIRING is harmful, so never strip fontWeight
// wholesale; strip it only where a custom family is also named.
//
// Leading is the one genuinely risky part of adopting this: 1,219 of 1,375
// fontSize blocks currently inherit RN's platform- and font-dependent default,
// so adding lineHeight WILL reflow them. Use noLead() to adopt a role's size and
// family without touching its leading, then remove noLead per screen behind a
// visual diff. Fixed-height rows and any FlatList with getItemLayout go last.
export const KTYPE = {
  // ── Micro ──
  badge:       { fontSize: 9,  lineHeight: 11, fontFamily: KFONT.sansExtra, letterSpacing: 0.2 },
  micro:       { fontSize: 10, lineHeight: 13, fontFamily: KFONT.sansBold,  letterSpacing: 0.4 },

  // ── Labels & meta ──
  meta:        { fontSize: 11, lineHeight: 16, fontFamily: KFONT.sansBold },
  eyebrow:     { fontSize: 11, lineHeight: 14, fontFamily: KFONT.sansExtra, letterSpacing: 1 },
  caption:     { fontSize: 12, lineHeight: 17, fontFamily: KFONT.sansMed },
  captionBold: { fontSize: 12, lineHeight: 17, fontFamily: KFONT.sansBold,  letterSpacing: 0.1 },

  // ── Body ──
  bodySm:      { fontSize: 13, lineHeight: 18, fontFamily: KFONT.sans },
  label:       { fontSize: 13, lineHeight: 18, fontFamily: KFONT.sansSemi },
  labelBold:   { fontSize: 13, lineHeight: 18, fontFamily: KFONT.sansBold },
  buttonSm:    { fontSize: 13, lineHeight: 18, fontFamily: KFONT.sansBold,  letterSpacing: 0.2 },
  body:        { fontSize: 14, lineHeight: 20, fontFamily: KFONT.sans },
  bodyBold:    { fontSize: 14, lineHeight: 20, fontFamily: KFONT.sansBold },
  bodyLg:      { fontSize: 15, lineHeight: 22, fontFamily: KFONT.sans },

  // ── Heaviest weight in the small band ──
  // ExtraBold below 17px. These exist because 135 declarations sit at 12-16px
  // with weight 800+, and all 80 of the app's weight-900 declarations land here
  // too: Plus Jakarta Sans loads no 900 face, so 900 resolves to ExtraBold (800)
  // and these are where it goes.
  labelExtra:      { fontSize: 13, lineHeight: 18, fontFamily: KFONT.sansExtra },
  subheadExtra:    { fontSize: 15, lineHeight: 20, fontFamily: KFONT.sansExtra },
  subheadingExtra: { fontSize: 16, lineHeight: 24, fontFamily: KFONT.sansExtra },

  // ── Headings (sans) ──
  subhead:     { fontSize: 15, lineHeight: 20, fontFamily: KFONT.sansBold },
  button:      { fontSize: 15, lineHeight: 20, fontFamily: KFONT.sansBold,  letterSpacing: 0.1 },
  subheading:  { fontSize: 16, lineHeight: 24, fontFamily: KFONT.sansBold },
  heading:     { fontSize: 17, lineHeight: 23, fontFamily: KFONT.sansExtra, letterSpacing: -0.1 },
  title:       { fontSize: 18, lineHeight: 24, fontFamily: KFONT.sansExtra, letterSpacing: -0.2 },
  titleLg:     { fontSize: 20, lineHeight: 26, fontFamily: KFONT.sansExtra, letterSpacing: -0.3 },

  // ── Editorial (Fraunces serif) — opt in on KHET-styled surfaces ──
  headingSerif:{ fontSize: 20, lineHeight: 26, fontFamily: KFONT.displaySemi, letterSpacing: -0.2 },
  displayMd:   { fontSize: 22, lineHeight: 28, fontFamily: KFONT.displaySemi, letterSpacing: -0.4 },
  displayLg:   { fontSize: 24, lineHeight: 30, fontFamily: KFONT.displayBold, letterSpacing: -0.5 },

  // ── Figures — hero numbers, never running text ──
  statInline:  { fontSize: 18, lineHeight: 22, fontFamily: KFONT.displayBold, letterSpacing: -0.3 },
  figureMd:    { fontSize: 32, lineHeight: 36, fontFamily: KFONT.displayBold, letterSpacing: -0.8 },
  figureLg:    { fontSize: 44, lineHeight: 48, fontFamily: KFONT.displayBold, letterSpacing: -1.2 },
  figureXl:    { fontSize: 56, lineHeight: 60, fontFamily: KFONT.displayBold, letterSpacing: -1.6 },
};

// ── Icon sizes ───────────────────────────────────────────────────────────────
// The largest untokenised numeric family in the app: 700+ `size={n}` props on
// Ionicons and friends. Measured modes are 16 (129 uses), 18 (85), 22 (78),
// 14 (78), 20 (62), 13 (60), 12 (44), 15 (43), 11 (40), 48 (23), 24 (22).
//
// This ladder is deliberately TIGHTER than KSPACE's, and the reason is
// perceptual rather than statistical: moving a container 1px shifts everything
// after it, but moving a GLYPH 1px is invisible. So the odd sizes fold into
// their neighbour (11/13 → 12/14, 15/17 → 16/18) at no visible cost, where the
// same collapse in spacing would have been unacceptable.
//
// Preferred for new work: sm · base · md · lg.
export const KICON = {
  xs:   12,   // dense badge and chip glyphs
  sm:   14,   // inline with caption / bodySm
  base: 16,   // THE default — inline with body, list-row leading icon  ← preferred
  md:   18,   // header actions, list-row chevron  ← preferred
  lg:   20,   // primary action icons  ← preferred
  xl:   22,   // tab bar, prominent affordances
  xxl:  24,   // hero actions, large tiles
  hero: 48,   // empty-state and onboarding illustrations
};

// ── Border widths ────────────────────────────────────────────────────────────
// 509 borderWidth declarations with no scale. The values are not noise — they
// are a 4-step EMPHASIS ladder: resting hairline (1, 269 uses), chip//selected
// affordance (1.5, 99), active selection (2, 27), focus ring (3, 4). The
// stragglers (1.2 ×20, 0.5 ×3, 2.5 ×2) fold into their neighbour invisibly.
export const KBORDER = {
  hairline: 1,     // every resting card, chip and tile edge
  chip:     1.5,   // chips and tiles that read as tappable
  selected: 2,     // the currently-chosen option
  ring:     3,     // focus / emphasis ring
};

// ── Inter bridge (TEMPORARY) ─────────────────────────────────────────────────
// 212 fontFamily declarations across frontend/src resolve to Inter (195 in AI/
// and FarmProfile/, 17 in AnimalTrade/), which is loaded in App.js but has no
// KFONT key — a whole second sans family living outside the design system. This
// export exists so those call sites can stop using string literals TODAY,
// without pretending the question is settled.
//
// THE DECISION IS STILL OPEN, and it is a product call, not a token call:
//   (a) promote Inter into KFONT — cheap, but ratifies two sans families; or
//   (b) move those screens to Plus Jakarta — one visible design change across a
//       quarter of the frontend (different x-heights, text reflows).
// Make the call BEFORE migrating those screens, not during. Nothing new should
// reach for KFONT_ALT.
export const KFONT_ALT = {
  interReg:   'Inter_400Regular',
  interMed:   'Inter_500Medium',
  interSemi:  'Inter_600SemiBold',
  interBold:  'Inter_700Bold',
  interExtra: 'Inter_800ExtraBold',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A type role WITHOUT its lineHeight — adopt size, family and tracking while
 * leaving leading on RN's default so nothing reflows. The migration step:
 *     { ...noLead(KTYPE.body) }   →   { ...KTYPE.body }
 * once that screen has been eyeballed.
 */
export const noLead = (step) => {
  const { lineHeight, ...rest } = step;
  return rest;
};

/**
 * The circle idiom in one call. Replaces the 185 places that hand-compute
 * `borderRadius: size / 2`, which silently breaks when the size changes.
 */
export const circle = (size) => ({ width: size, height: size, borderRadius: size / 2 });

/**
 * A KHET hex at partial opacity — for scrims, overlays and pressed states.
 *     withAlpha(KHET.foreground, 0.55)
 *
 * Accepts hex (#rgb, #rrggbb, #rrggbbaa) OR an existing rgb()/rgba() string, so
 * it works on the gradHero tokens defined above as well as on flat colours.
 *
 * The alpha may be a 0-1 float, a 0-255 integer, or a 2-digit hex string —
 * because the codebase's existing idiom is suffix concatenation (`tint + '18'`,
 * `tint + '3A'`), which only works on 6-digit hex and silently produces garbage
 * on anything else. Accepting '18' directly gives those 4 call sites a safe
 * translation instead of a rewrite.
 *
 * Anything genuinely unparseable throws rather than returning a colour: a silent
 * fallback here renders opaque BLACK, which is a mistake worth making loud.
 */
export const withAlpha = (color, a) => {
  // Normalise alpha: '3A' -> 0.227, 128 -> 0.502, 0.5 -> 0.5
  let alpha;
  if (typeof a === 'string') {
    const t = a.trim().replace(/^#/, '');
    if (!/^[0-9a-f]{2}$/i.test(t)) throw new TypeError(`withAlpha: bad hex alpha ${JSON.stringify(a)}`);
    alpha = parseInt(t, 16) / 255;
  } else if (typeof a === 'number' && Number.isFinite(a)) {
    alpha = a > 1 ? a / 255 : a;
  } else {
    throw new TypeError(`withAlpha: bad alpha ${JSON.stringify(a)}`);
  }
  alpha = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;

  if (typeof color !== 'string') throw new TypeError(`withAlpha: bad colour ${JSON.stringify(color)}`);
  const c = color.trim();

  // Existing rgb()/rgba() — swap the alpha, keep the channels.
  const rgb = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i.exec(c);
  if (rgb) return `rgba(${+rgb[1]}, ${+rgb[2]}, ${+rgb[3]}, ${alpha})`;

  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
  if (!m) throw new TypeError(`withAlpha expects a hex or rgb() colour, got ${JSON.stringify(color)}`);
  const h = m[1];
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(f.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
