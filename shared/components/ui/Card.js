// ─────────────────────────────────────────────────────────────────────────────
// Card — the bordered surface. MEASURED in frontend/src/screens: 169 card-family
// style keys; of the 126 that actually declare a surface, 67% carry a
// borderWidth, 52% carry a shadow, and the radius splits 14 (32) · 16 (22) ·
// 20 (18) · 18 (12). The pilot found five of them on ONE screen — three
// backgrounds, four radii, three paddings, no two identical — with the PAIR
// `borderWidth: 1 + borderColor: KHET.border + ...KELEV.e3` copied verbatim all
// five times.
//
// WHY radius AND padding ARE PROPS THAT TAKE RAW NUMBERS
// The duplication is in the PAIR, so that is what Card owns. The radius is NOT
// duplication — it is a real three-tier ladder (14 nested / 16 small / 18 large)
// that KRADIUS cannot express, because it jumps r16 → r20. A primitive that
// snapped 18 to 20 could not be adopted on screen 1 of 90. So Card takes what the
// screen already had, and the ladder that was invisible drift inside a StyleSheet
// becomes a greppable prop: `grep -oE 'radius=\{[0-9]+\}'` gives you the whole
// ladder across 90 screens in one command.
//
// `tint` SOLVES A GAP withAlpha() STRUCTURALLY CANNOT. 151 sites concatenate
// `colour + '18'` / `+ '3A'` / `+ '40'`; withAlpha takes a 0-1 float and 0x18 is
// 0.0941…, so those are precisely the sites that stayed raw through the pilot.
// `tint` derives the background AND the border from one accent, so the two halves
// cannot disagree — as they already do on the pilot screen, where the same tile
// ships '3A' in one copy and '40' in the other.
//
// NOTE ON overflow:'hidden' — deliberately absent. On iOS it sets clipsToBounds,
// which clips the SHADOW along with the children; a view cannot carry both. A
// card that must clip a full-bleed image should pass elevation={false} plus its
// own overflow, and say so.
// ─────────────────────────────────────────────────────────────────────────────
import { View, TouchableOpacity } from 'react-native';
import {
  KHET, KSPACE, KRADIUS, KELEV, KBORDER,
} from '@cropsetu/shared/constants/khetTheme';
import { alpha } from './palette';

const SURFACES = {
  card:       KHET.card,
  white:      KHET.white,
  muted:      KHET.muted,
  background: KHET.background,
  secondary:  KHET.secondary,
  accent:     KHET.accent,
  input:      KHET.input,
  success:    KHET.successBg,
  warning:    KHET.warningBg,
  info:       KHET.infoBg,
  danger:     KHET.destructiveBg,
  none:       'transparent',
};

// The two alphas the app already uses for accent fills, decided once. 0.09 ≈ the
// '18' suffix (0.094); 0.25 ≈ '40' (0.251), chosen at the top of the existing
// '3A'..'40' range so the border stays visible against the page background.
const TINT_BG = 0.09;
const TINT_BORDER = 0.25;

/**
 * <Card
 *   surface     a SURFACES key ('card' default) or any raw colour string.
 *   tint        an accent colour. Derives BOTH background and border from it and
 *               overrides `surface`. Replaces the `tint + '18'` idiom.
 *   radius      number, or a KRADIUS key. Default KRADIUS.r14 (the corpus mode).
 *   padding     number. Default KSPACE.s14 — the signature CropSetu card padding
 *               (37% of card padding shorthands). Pass 0 for edge-to-edge media.
 *   border      true (default) | false | a raw colour string
 *   elevation   a KELEV key ('e1'..'e4','e3Up') or false. Default 'e3', which IS
 *               KSHADOW.soft. See the adoption note: only 52% of existing cards
 *               carry a shadow, so this is the prop most likely to need an
 *               override, in either direction.
 *   onPress     makes the whole surface a button, with ONE activeOpacity (the
 *               app runs ten different values across 352 TouchableOpacity sites).
 *   row/gap/align/justify   layout shorthands.
 * />
 * `style` is applied LAST and always wins — the half-migration contract.
 */
export default function Card({
  surface = 'card',
  tint,
  radius = KRADIUS.r14,
  padding = KSPACE.s14,
  paddingHorizontal,
  paddingVertical,
  border = true,
  elevation = 'e3',
  row = false,
  gap,
  align,
  justify,
  flex,
  onPress,
  onLongPress,
  disabled = false,
  style,
  children,
  ...rest
}) {
  const bg = tint
    ? alpha(tint, TINT_BG)
    : (SURFACES[surface] !== undefined ? SURFACES[surface] : surface);

  const borderColor = tint
    ? alpha(tint, TINT_BORDER)
    : typeof border === 'string' ? border : KHET.border;

  const base = {
    backgroundColor: bg,
    borderRadius: typeof radius === 'string' ? (KRADIUS[radius] ?? KRADIUS.r14) : radius,
    borderWidth: border === false ? 0 : KBORDER.hairline,
    borderColor,
    ...(paddingHorizontal == null && paddingVertical == null ? { padding } : null),
    ...(paddingHorizontal != null ? { paddingHorizontal } : null),
    ...(paddingVertical != null ? { paddingVertical } : null),
    ...(row ? { flexDirection: 'row', alignItems: align || 'center' } : (align ? { alignItems: align } : null)),
    ...(justify ? { justifyContent: justify } : null),
    ...(gap != null ? { gap } : null),
    ...(flex != null ? { flex: flex === true ? 1 : flex } : null),
  };

  const shadow = elevation && KELEV[elevation] ? KELEV[elevation] : null;

  if (!onPress && !onLongPress) {
    return <View {...rest} style={[base, shadow, style]}>{children}</View>;
  }

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      {...rest}
      style={[base, shadow, disabled ? { opacity: 0.55 } : null, style]}
    >
      {children}
    </TouchableOpacity>
  );
}

/**
 * The tinted-surface pair as a value, for the places that need it without a whole
 * Card — a 36px accent tile, a chip, a callout.
 *     <View style={[tintSurface(SECTION_TINTS.water), square(36, 11)]} />
 */
export function tintSurface(color) {
  return {
    backgroundColor: alpha(color, TINT_BG),
    borderColor: alpha(color, TINT_BORDER),
    borderWidth: KBORDER.hairline,
  };
}

/**
 * circle()'s missing sibling: a square whose radius is NOT half its size. The two
 * most-repeated shapes on the pilot screen (36/r11 and 34/r11) are exactly this,
 * and both had to stay raw because circle() does not cover them and no KRADIUS
 * step lands on 11.
 */
export function square(size, radius) {
  return { width: size, height: size, borderRadius: radius };
}
