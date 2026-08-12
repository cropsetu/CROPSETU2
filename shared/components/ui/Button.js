// ─────────────────────────────────────────────────────────────────────────────
// Button — MEASURED in frontend/src/screens: 322 button-family style keys (310
// `*Btn*`, 12 `btn*`), 352 TouchableOpacity call sites spread across TEN
// different activeOpacity values (0.85×50, 0.8×35, 0.7×27, 1×14, 0.9×13,
// 0.75×9, 0.88×3, 0.82×3, 0.92, 0.6), and 76 ActivityIndicators.
//
// WHAT IT ACTUALLY FIXES, beyond spelling:
//  1. LOADING DOES NOT RESIZE THE BUTTON. The label stays mounted at opacity 0
//     with the spinner absolutely centred over it, so "Save" → spinner does not
//     reflow the row it sits in. Every hand-rolled version swaps the child and
//     jumps — which is how a form moves under a thumb mid-tap.
//  2. LOADING BLOCKS THE PRESS, so a double-submit is impossible by construction
//     rather than by remembering to guard the handler.
//  3. DISABLED IS REAL — dimmed AND unpressable AND announced. Almost nothing in
//     the app dims a disabled button today.
//  4. tone="gold" uses KHET.goldForeground, NOT white. White on gold is 2.03:1 —
//     the AA failure khetTheme already shipped goldForeground to fix, and which
//     gold CTAs keep re-introducing.
//  5. Height comes from a size, not from padding arithmetic: md is 44, the corpus
//     mode (13 sites) and the platform tap minimum, so it lands there without
//     anyone thinking about it.
//
// The label goes through <Text>, so it can never carry a fontWeight.
// ─────────────────────────────────────────────────────────────────────────────
import { TouchableOpacity, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  KHET, KSPACE, KRADIUS, KELEV, KICON, KBORDER,
} from '@cropsetu/shared/constants/khetTheme';
import Text from './Text';
import { alpha } from './palette';

const SIZES = {
  sm: { minH: 36, px: KSPACE.s12, gap: KSPACE.s6, role: 'buttonSm', icon: KICON.base, radius: KRADIUS.r10 },
  md: { minH: 44, px: KSPACE.s16, gap: KSPACE.s8, role: 'button',   icon: KICON.md,   radius: KRADIUS.r12 },
  lg: { minH: 52, px: KSPACE.s20, gap: KSPACE.s8, role: 'button',   icon: KICON.lg,   radius: KRADIUS.r14 },
};

// Every tone is a fill + an ink that is legible ON that fill.
const TONES = {
  primary:     { bg: KHET.primary,     ink: KHET.primaryForeground,   border: null,          elev: 'e2' },
  secondary:   { bg: KHET.secondary,   ink: KHET.secondaryForeground, border: null,          elev: null },
  outline:     { bg: 'transparent',    ink: KHET.primary,             border: KHET.primary,  elev: null },
  neutral:     { bg: KHET.card,        ink: KHET.foreground,          border: KHET.border,   elev: null },
  ghost:       { bg: 'transparent',    ink: KHET.primary,             border: null,          elev: null },
  destructive: { bg: KHET.destructive, ink: KHET.white,               border: null,          elev: 'e2' },
  gold:        { bg: KHET.gold,        ink: KHET.goldForeground,      border: null,          elev: 'e2' },
  link:        { bg: 'transparent',    ink: KHET.link,                border: null,          elev: null },
};

/**
 * <Button
 *   title       string label (or pass children)
 *   tone        'primary'(default) | 'secondary' | 'outline' | 'neutral' |
 *               'ghost' | 'destructive' | 'gold' | 'link'
 *   size        'sm' (36) | 'md' (44, default) | 'lg' (52)
 *   icon        Ionicons name, leading      iconRight  Ionicons name, trailing
 *   loading     spinner over the label; keeps the width, blocks the press
 *   disabled    dimmed, unpressable, announced
 *   full        stretch to the container width
 *   radius      override the size's radius (number or KRADIUS key)
 *   pill        shorthand for radius={KRADIUS.pill}
 *   height/paddingHorizontal   exact overrides, for zero-delta migrations
 * />
 */
export default function Button({
  title,
  children,
  tone = 'primary',
  size = 'md',
  icon,
  iconRight,
  iconSize,
  loading = false,
  disabled = false,
  full = false,
  radius,
  pill = false,
  height,
  paddingHorizontal,
  elevation,
  lead = false,
  textRole,
  textStyle,
  onPress,
  style,
  accessibilityLabel,
  ...rest
}) {
  const S = SIZES[size] || SIZES.md;
  const T = TONES[tone] || TONES.primary;
  const off = disabled || loading;
  const isLink = tone === 'link';

  const r = pill
    ? KRADIUS.pill
    : radius != null
      ? (typeof radius === 'string' ? (KRADIUS[radius] ?? S.radius) : radius)
      : S.radius;

  const shadow = elevation !== undefined
    ? (elevation && KELEV[elevation] ? KELEV[elevation] : null)
    : (T.elev ? KELEV[T.elev] : null);

  // minHeight, NOT height. The app respects the OS text-size setting with no
  // cap, so a fixed height clips the label the moment a user turns text up —
  // and these are 36/44/52, i.e. exactly one line of the default label. minHeight
  // preserves the tap target at default scale and lets the button grow instead
  // of truncating. An explicit `height` prop still wins, for zero-delta
  // migrations of a screen that genuinely needs the old fixed box.
  const frame = {
    ...(height != null
      ? { height }
      : (isLink ? null : { minHeight: S.minH, paddingVertical: KSPACE.s6 })),
    paddingHorizontal: isLink ? 0 : (paddingHorizontal != null ? paddingHorizontal : S.px),
    borderRadius: isLink ? 0 : r,
    backgroundColor: T.bg,
    borderWidth: T.border ? KBORDER.hairline : 0,
    borderColor: T.border || 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.gap,
    alignSelf: full ? 'stretch' : 'flex-start',
    opacity: disabled ? 0.45 : 1,
  };

  const label = title != null ? title : children;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={off || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!loading }}
      accessibilityLabel={accessibilityLabel || (typeof label === 'string' ? label : undefined)}
      {...rest}
      style={[frame, isLink ? null : shadow, style]}
    >
      {/* Stays mounted while loading, at opacity 0, so the width never changes
          and nothing below the button moves. */}
      <View style={[styles.content, { gap: S.gap }, loading ? styles.hidden : null]}>
        {icon ? <Ionicons name={icon} size={iconSize || S.icon} color={T.ink} /> : null}
        {typeof label === 'string' || typeof label === 'number' ? (
          <Text
            role={textRole || S.role}
            lead={lead}
            color={T.ink}
            numberOfLines={1}
            style={textStyle}
          >
            {label}
          </Text>
        ) : (label || null)}
        {iconRight ? <Ionicons name={iconRight} size={iconSize || S.icon} color={T.ink} /> : null}
      </View>

      {loading ? (
        <View style={[StyleSheet.absoluteFill, styles.centre]} pointerEvents="none">
          <ActivityIndicator size="small" color={T.ink} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/**
 * The square icon-only action — header buttons, steppers, close controls. Same
 * tone vocabulary, so a row of them matches the text buttons beside it.
 */
Button.Icon = function ButtonIcon({
  icon, onPress, size = 40, tone = 'ghost', iconSize, disabled = false,
  radius = KRADIUS.pill, label, style, ...rest
}) {
  const T = TONES[tone] || TONES.ghost;
  const solid = tone === 'primary' || tone === 'destructive' || tone === 'gold';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      {...rest}
      style={[
        styles.content,
        {
          width: size,
          height: size,
          borderRadius: typeof radius === 'string' ? (KRADIUS[radius] ?? KRADIUS.pill) : radius,
          backgroundColor: solid ? T.bg : tone === 'neutral' ? KHET.card : 'transparent',
          borderWidth: T.border ? KBORDER.hairline : 0,
          borderColor: T.border || 'transparent',
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {typeof icon === 'string'
        ? <Ionicons name={icon} size={iconSize || Math.round(size * 0.5)} color={T.ink} />
        : icon}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  // opacity 0, NOT display:none — the label must keep occupying its width.
  hidden: { opacity: 0 },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
