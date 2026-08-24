// ─────────────────────────────────────────────────────────────────────────────
// ListRow — the horizontal row idiom. MEASURED in frontend/src/screens: 292
// row-family style keys, 737 `flexDirection: 'row'` declarations, and 23
// chevron-forward glyphs across 16 files.
//
// It absorbs three patterns the pilot named separately:
//
//   ICON ROW     icon + text + gap. Six instances on ONE screen with FOUR
//                different gaps (6, 8, 8, 9, 10, 10) for the identical visual
//                relationship. That orphan 9 is where a proposed KSPACE.s9 came
//                from — this component removes the gap rather than tokenising it,
//                which is exactly what the pilot argued for. Corpus-wide the gap
//                is bimodal at 8 (158) and 10 (153); 10 is the row gap the theme
//                file itself calls co-dominant, so that is the default.
//
//   KEY / VALUE  eight instances, with a HARDCODED 96px key column in a fully
//                localised screen — a live clipping bug on longer Hindi/Marathi
//                keys, not a style preference. `variant="kv"` uses flexShrink
//                with a maxWidth instead, so the key ellipsises and the value
//                keeps its room. The fixed width cannot be reintroduced.
//
//   NAV ROW      icon + label + chevron, hand-rolled in 16 files at five
//                different chevron sizes.
//
// TOUCH TARGET: minHeight 44 applies ONLY when the row is pressable, so adopting
// this component never grows a static row — and a pressable row shorter than 44
// was a tap-target bug anyway.
// ─────────────────────────────────────────────────────────────────────────────
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  KHET, KSPACE, KGUTTER, KICON, KBORDER,
} from '@krushisarva/shared/constants/khetTheme';
import Text from './Text';
import { tintSurface } from './Card';

const TAP = 44;
const TILE = 36;        // the tinted icon tile the app repeats everywhere
const TILE_RADIUS = 11; // the pilot's most-repeated shape, which no KRADIUS step
//                         reaches — absorbed here rather than promoted to r11.

/**
 * <ListRow
 *   icon        Ionicons name, or any node
 *   iconColor   ink for a bare icon. Default KHET.primary.
 *   tint        renders the icon inside a tinted tile derived from this colour
 *               (replaces the `tint + '18'` / `+ '3A'` concat pair)
 *   title / subtitle          strings or nodes
 *   titleRole / subtitleRole  KTYPE keys
 *   value       trailing string — the "value" half of a key/value row
 *   right       trailing node (takes precedence over `value`)
 *   chevron     defaults to true when pressable AND there is no right/value
 *   variant     'row' (default) | 'kv'
 *   gap         icon-to-text gap. Default KSPACE.s10.
 *   divider     false (default) | true | 'inset'
 *   dense       tighter vertical padding and a smaller tile
 * />
 */
export default function ListRow({
  icon,
  iconColor = KHET.primary,
  iconSize,
  tint,
  title,
  titleRole = 'bodyBold',
  titleLines = 1,
  subtitle,
  subtitleRole = 'bodySm',
  subtitleLines = 2,
  value,
  valueRole = 'bodySm',
  valueTone = 'muted',
  right,
  chevron,
  variant = 'row',
  gap = KSPACE.s10,
  paddingHorizontal = KGUTTER.base,
  paddingVertical,
  divider = false,
  dense = false,
  align = 'center',
  onPress,
  onLongPress,
  disabled = false,
  style,
  children,
  ...rest
}) {
  const pressable = Boolean(onPress || onLongPress);
  const pv = paddingVertical != null ? paddingVertical : (dense ? KSPACE.s8 : KSPACE.s12);
  const tileSize = dense ? 28 : TILE;
  const glyph = iconSize != null ? iconSize : (dense ? KICON.sm : KICON.md);
  const showChevron = chevron != null
    ? chevron
    : (pressable && right == null && value == null);

  const frame = {
    flexDirection: 'row',
    alignItems: align,
    gap,
    paddingHorizontal,
    paddingVertical: pv,
    // Only pressable rows get the 44pt floor, so a static row keeps its height.
    ...(pressable ? { minHeight: TAP } : null),
    ...(divider === true
      ? { borderBottomWidth: KBORDER.hairline, borderBottomColor: KHET.border }
      : null),
    ...(disabled ? { opacity: 0.5 } : null),
  };

  const iconNode = icon == null ? null : typeof icon !== 'string' ? icon : (
    tint ? (
      <View style={[
        tintSurface(tint),
        { width: tileSize, height: tileSize, borderRadius: TILE_RADIUS },
        styles.centre,
      ]}>
        <Ionicons name={icon} size={glyph} color={tint} />
      </View>
    ) : (
      <Ionicons name={icon} size={glyph} color={iconColor} />
    )
  );

  const body = variant === 'kv' ? (
    <>
      <View style={styles.kvKey}>
        {typeof title === 'string' || typeof title === 'number' ? (
          <Text role={titleRole} tone="muted" numberOfLines={2}>{title}</Text>
        ) : (title || null)}
      </View>
      <View style={styles.kvVal}>
        {typeof value === 'string' || typeof value === 'number' ? (
          <Text role={valueRole} align="right">{value}</Text>
        ) : (value || right || null)}
      </View>
    </>
  ) : (
    <>
      <View style={styles.stack}>
        {typeof title === 'string' || typeof title === 'number' ? (
          <Text role={titleRole} numberOfLines={titleLines}>{title}</Text>
        ) : (title || null)}
        {typeof subtitle === 'string' || typeof subtitle === 'number' ? (
          <Text role={subtitleRole} tone="muted" numberOfLines={subtitleLines} style={styles.sub}>
            {subtitle}
          </Text>
        ) : (subtitle || null)}
        {children}
      </View>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text role={valueRole} tone={valueTone} numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {right || null}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={KICON.md} color={KHET.mutedForeground} />
      ) : null}
    </>
  );

  // 'inset' is drawn as an absolutely-positioned child rather than a border, so
  // it can start after the icon column without changing the row's box.
  const rule = divider === 'inset' ? (
    <View
      pointerEvents="none"
      style={[
        styles.rule,
        { left: paddingHorizontal + (iconNode ? tileSize + gap : 0) },
      ]}
    />
  ) : null;

  if (!pressable) {
    return (
      <View {...rest} style={[frame, style]}>
        {iconNode}
        {body}
        {rule}
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={typeof title === 'string' ? title : undefined}
      {...rest}
      style={[frame, style]}
    >
      {iconNode}
      {body}
      {rule}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
  stack: { flex: 1, minWidth: 0 },
  sub: { marginTop: KSPACE.s2 },
  value: { flexShrink: 1, textAlign: 'right' },
  // flexShrink + maxWidth, NOT a fixed 96px column — the localisation fix.
  kvKey: { flexShrink: 1, flexGrow: 0, maxWidth: '55%' },
  kvVal: { flex: 1, alignItems: 'flex-end', minWidth: 0 },
  rule: {
    position: 'absolute', right: 0, bottom: 0,
    height: KBORDER.hairline, backgroundColor: KHET.border,
  },
});
