// ─────────────────────────────────────────────────────────────────────────────
// Header — the top bar. MEASURED in frontend/src/screens: 141 header-family style
// keys (95 `header*`, 46 `*Header*`), 56 files calling navigation.goBack(), and
// the back glyph split between "arrow-back" (20) and "chevron-back" (17) at
// three different sizes with no two touch targets agreeing.
//
// THE SAFE-AREA RULE — the reason this composes with Screen instead of guessing:
//   safeArea="auto" (default) adds the top inset ONLY when a <Screen> ancestor
//   exists AND declared it did not consume 'top'. With no Screen ancestor it adds
//   NOTHING, because an unmigrated screen is already padding itself.
// So Header is safe dropped alone into a legacy screen, safe under a Screen that
// already paid the inset, and correct under a hero Screen with edges={[]}. All
// three cases are asserted in the kit's test suite. This is the exact regression
// class this repo shipped a fix for in 99bae07, made impossible rather than
// remembered.
//
// tone="light" flips ink to white for a Header sitting on a gradient or photo
// hero (36 screens use LinearGradient). It changes INK ONLY and never paints a
// background, so a transparent Header is a drop-in replacement for a hero's
// hand-rolled title row.
// ─────────────────────────────────────────────────────────────────────────────
import { useContext } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KHET, KSPACE, KGUTTER, KELEV, KICON, KBORDER,
} from '@cropsetu/shared/constants/khetTheme';
import Text from './Text';
import Screen from './Screen';
import { alpha } from './palette';

const TAP = 44; // the platform minimum, which the hand-rolled back buttons miss

/**
 * <Header
 *   title        string, or any node (pass a node for a bilingual pair)
 *   subtitle     string or node under the title
 *   titleRole    KTYPE key for the title. Default 'title' (18/sansExtra/-0.2).
 *   onBack       renders the back control. Omit for no back button.
 *   backIcon     default 'arrow-back' (the corpus mode: 20 vs 17 chevron-back)
 *   left         node replacing the back slot entirely (menu, logo, avatar)
 *   right        node(s) for the trailing slot
 *   align        'left' (default, matches the corpus) | 'center'
 *   variant      'bar' (card bg + hairline, default) | 'plain' | 'transparent'
 *   tone         'dark' (default) | 'light' — ink only, never a background
 *   safeArea     'auto' (default) | true | false
 *   elevation    a KELEV key, or false (default — a shadow under the bar is a
 *                design position, not something to inherit by accident)
 * />
 */
export default function Header({
  title,
  subtitle,
  titleRole = 'title',
  titleLines = 2,
  subtitleLines = 2,
  subtitleRole = 'bodySm',
  onBack,
  backIcon = 'arrow-back',
  backLabel = 'Go back',
  left,
  right,
  align = 'left',
  variant = 'bar',
  tone = 'dark',
  gutter = KGUTTER.base,
  paddingVertical = KSPACE.s12,
  safeArea = 'auto',
  elevation = false,
  border,
  radius,
  style,
  titleStyle,
  children,
}) {
  const rawInsets = useSafeAreaInsets();
  const screen = useContext(Screen.Context);

  // The entire double-inset guard, in one expression.
  const applyInset =
    safeArea === true ? true
      : safeArea === false ? false
        : Boolean(screen) && !screen.consumed.top; // 'auto'
  const topInset = applyInset ? (screen ? screen.insets.top : rawInsets.top) : 0;

  const light = tone === 'light';
  const ink = light ? KHET.white : KHET.foreground;
  const inkDim = light ? alpha(KHET.white, 0.78) : KHET.mutedForeground;
  const bare = variant === 'plain' || variant === 'transparent';
  const showBorder = border != null ? border : variant === 'bar';

  const frame = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: KSPACE.s10,
    paddingHorizontal: gutter,
    paddingTop: topInset + paddingVertical,
    paddingBottom: paddingVertical,
    backgroundColor: bare ? 'transparent' : KHET.card,
    borderBottomWidth: showBorder ? KBORDER.hairline : 0,
    borderBottomColor: typeof showBorder === 'string'
      ? showBorder
      : (light ? alpha(KHET.white, 0.18) : KHET.border),
    ...(radius != null
      ? { borderBottomLeftRadius: radius, borderBottomRightRadius: radius }
      : null),
  };

  const backSlot = left !== undefined ? left : onBack ? (
    <TouchableOpacity
      onPress={onBack}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={backLabel}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.tap}
    >
      <Ionicons name={backIcon} size={KICON.xl} color={ink} />
    </TouchableOpacity>
  ) : null;

  const titleBlock = (
    <View
      style={align === 'center' ? styles.centreTitle : styles.leftTitle}
      pointerEvents={align === 'center' ? 'none' : 'box-none'}
    >
      {typeof title === 'string' || typeof title === 'number' ? (
        <Text
          role={titleRole}
          color={ink}
          numberOfLines={titleLines}
          align={align === 'center' ? 'center' : undefined}
          style={titleStyle}
        >
          {title}
        </Text>
      ) : (title || null)}
      {typeof subtitle === 'string' || typeof subtitle === 'number' ? (
        <Text
          role={subtitleRole}
          color={inkDim}
          numberOfLines={subtitleLines}
          align={align === 'center' ? 'center' : undefined}
          style={styles.sub}
        >
          {subtitle}
        </Text>
      ) : (subtitle || null)}
    </View>
  );

  // A centred title is an ABSOLUTELY POSITIONED layer, not a `<View width={40}/>`
  // spacer. The spacer idiom only balances when both sides happen to be the same
  // width, so it drifts the moment a right-hand action appears — which is what
  // the hand-rolled headers get wrong today.
  if (align === 'center') {
    return (
      <View style={[frame, elevation ? KELEV[elevation] : null, style]}>
        {titleBlock}
        <View style={styles.side}>{backSlot}</View>
        <View style={[styles.side, styles.sideEnd]}>{right}</View>
        {children}
      </View>
    );
  }

  return (
    <View style={[frame, elevation ? KELEV[elevation] : null, style]}>
      {backSlot}
      {titleBlock}
      {right ? <View style={styles.rightRow}>{right}</View> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tap: {
    minWidth: TAP - 8,
    minHeight: TAP - 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -KSPACE.s8, // pull the glyph out to the gutter, keep the target
  },
  leftTitle: { flex: 1, minWidth: 0 },
  centreTitle: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  side: { flexBasis: 0, flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8 },
  sideEnd: { justifyContent: 'flex-end' },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: KSPACE.s8 },
  sub: { marginTop: KSPACE.s2 },
});
