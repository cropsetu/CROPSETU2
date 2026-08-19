/**
 * Skeleton — the app's one loading-placeholder kit.
 *
 * Why skeletons instead of spinners: a spinner on a blank screen tells the user
 * nothing about what is coming or how long it will take, and the screen jumps
 * when the data lands. A placeholder in the shape of the real content reads as
 * "loading" rather than "empty", and the layout is already the right size when
 * the response arrives, so nothing moves.
 *
 * The shop grid proved this out; this module is that treatment extracted so the
 * animal grid, the rent lists, the AI screens and the profile lists all pulse
 * with the same colours, the same rhythm and the same shapes. A screen that
 * rolls its own skeleton drifts out of sync with the rest of the app within a
 * release or two — importing from here is what keeps the convention one thing.
 *
 * Mechanics worth knowing:
 *  • One clock per skeleton tree. `SkeletonGroup` puts a single Reanimated
 *    shared value on context and every block reads it, so twelve placeholder
 *    cards cost one driver, not twelve. Presets mount their own group, so the
 *    common case needs no wrapper.
 *  • Animation runs on the UI thread. The moment a screen is waiting is exactly
 *    the moment JS is busy parsing the response — a JS-driven pulse would stall
 *    there and make the app look hung.
 *  • Reduced motion holds the blocks at the mid-tone instead of pulsing.
 *  • The whole tree is one `progressbar` to a screen reader and its children are
 *    hidden, so VoiceOver announces "loading" once instead of reading out a
 *    dozen empty boxes.
 *
 * Usage:
 *   {loading && !items.length ? <SkeletonGrid rows={3} /> : null}
 *   {loading ? <SkeletonList rows={5} thumb="square" /> : null}
 *   <SkeletonGroup><SkeletonBlock h={12} w="60%" /></SkeletonGroup>   // custom
 */
import { createContext, memo, useContext, useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import { COLORS } from '@cropsetu/shared/constants/colors';
import { KBORDER, KELEV, KGUTTER, KRADIUS, KSPACE } from '@cropsetu/shared/constants/khetTheme';
import { isReducedMotion } from '@cropsetu/shared/components/ui/motion';

const { width: W } = Dimensions.get('window');

// The two tones the shop grid pulses between. Kept here so every skeleton in
// the app shares one palette — a screen that picks its own greys reads as a
// different app while it loads.
const TONE_DIM   = COLORS.greenAsh;   // #E4EDE7
const TONE_LIT   = COLORS.greenMist;  // #C8E6D4
const PULSE_MS   = 750;

const RADIUS_SM   = KRADIUS.r4;    // text lines and small bars
const RADIUS_CARD = KRADIUS.r18;   // the large card tier the listing grids use
const GUTTER      = KGUTTER.tight; // matches the shop/animal grid gutter
const GAP         = KSPACE.s10;

/** Shared 0→1 clock. `null` means "no provider" → block mounts a private one. */
const PulseContext = createContext(null);

function usePulse() {
  const shared = useContext(PulseContext);
  // Hooks must run unconditionally, so a private clock is always created; it is
  // simply left un-started (and unread) when a group clock is available.
  const own = useSharedValue(0);
  const reduced = isReducedMotion();
  useEffect(() => {
    if (shared || reduced) return;
    own.value = withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [shared, reduced, own]);
  return shared ?? own;
}

/**
 * Drives every `SkeletonBlock` beneath it from one animation. Presets wrap
 * themselves; reach for this directly only when hand-building a custom shape.
 *
 * @param {{children: React.ReactNode, label?: string, style?: any}} props
 */
export function SkeletonGroup({ children, label = 'Loading', style }) {
  const progress = useSharedValue(0);
  const reduced  = isReducedMotion();

  useEffect(() => {
    if (reduced) return;
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [reduced, progress]);

  return (
    <PulseContext.Provider value={progress}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityState={{ busy: true }}
      >
        {/* Children are decorative: the group above already says "loading", and
            without this a screen reader would walk a dozen empty boxes.
            `style` belongs on THIS view, not the a11y host above it — it is the
            one the blocks are actually siblings inside, so a caller passing
            `gap` or `flexDirection` gets what they asked for. Putting it on the
            outer view made those silently inert, since it has a single child. */}
        <View
          style={style}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        >
          {children}
        </View>
      </View>
    </PulseContext.Provider>
  );
}

/**
 * One shimmering rectangle — the atom every preset is built from.
 *
 * @param {{w?: number|string, h?: number, r?: number, style?: any}} props
 *        w/h/r are width, height and corner radius; `style` wins over all three.
 */
export const SkeletonBlock = memo(function SkeletonBlock({ w = '100%', h = 12, r = RADIUS_SM, style }) {
  const progress = usePulse();
  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [TONE_DIM, TONE_LIT]),
  }));
  return (
    <Animated.View
      style={[{ width: w, height: h, borderRadius: r }, style, animated]}
    />
  );
});

/**
 * A paragraph of placeholder lines. The last line is short on purpose — an
 * even-width stack reads as a table, not as prose.
 *
 * @param {{lines?: number, h?: number, gap?: number, widths?: Array<number|string>}} props
 */
export const SkeletonText = memo(function SkeletonText({ lines = 3, h = 11, gap = 8, widths }) {
  const rows = useMemo(
    () => Array.from({ length: lines }, (_, i) =>
      widths?.[i] ?? (i === lines - 1 ? '55%' : i % 2 ? '92%' : '100%')),
    [lines, widths],
  );
  return (
    <View style={{ gap }}>
      {rows.map((width, i) => <SkeletonBlock key={i} w={width} h={h} />)}
    </View>
  );
});

// ── Presets ──────────────────────────────────────────────────────────────────
// Each preset mounts its own group, so callers can drop one in without a
// wrapper. They take the shape of a real screen region, not of a generic box.

/**
 * Two-up card grid — shop products, animal listings, machinery tiles.
 *
 * The gutter/gap/photo knobs exist because the real grids do not agree: the shop
 * lays out at 12/12 with a 130px photo, the animal grid at 14/10 with a square-ish
 * one. A skeleton that ignores that is a skeleton the screen jumps away from, so
 * pass the host grid's actual numbers rather than accepting the defaults blind.
 *
 * @param {{rows?: number, columns?: number, gutter?: number, gap?: number,
 *          photoRatio?: number, photoH?: number, bordered?: boolean,
 *          showButton?: boolean, label?: string, style?: any}} props
 */
export const SkeletonGrid = memo(function SkeletonGrid({
  rows = 3,
  columns = 2,
  gutter = GUTTER,
  gap = GAP,
  photoRatio = 0.82,
  photoH,
  bordered = false,
  showButton = true,
  label = 'Loading',
  style,
}) {
  const cardW    = (W - gutter * 2 - gap * (columns - 1)) / columns;
  const imageH   = photoH ?? Math.round(cardW * photoRatio);
  return (
    <SkeletonGroup label={label} style={style}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={[S.row, { gap, marginBottom: gap }]}>
          {Array.from({ length: columns }, (_, c) => (
            <View key={c} style={[S.card, bordered && S.bordered, { width: cardW }]}>
              <SkeletonBlock w="100%" h={imageH} r={0} />
              <View style={S.cardBody}>
                <SkeletonBlock w="85%" h={11} />
                <SkeletonBlock w="55%" h={13} />
                <SkeletonBlock w="42%" h={9} />
                {showButton ? <SkeletonBlock w="100%" h={32} r={10} style={{ marginTop: 4 }} /> : null}
              </View>
            </View>
          ))}
        </View>
      ))}
    </SkeletonGroup>
  );
});

/**
 * Full-width rows — rent listings, orders, bookings, scan history, chats.
 *
 * @param {{rows?: number, thumb?: 'square'|'circle'|'none', thumbSize?: number,
 *          lines?: number, showMeta?: boolean, rowH?: number, bordered?: boolean,
 *          label?: string, style?: any}} props
 *        rowH pins the row to the real card's height. The generic row is about
 *        104pt tall; a card with a price and a quantity stepper in it is far
 *        taller, and the difference is exactly the jump a skeleton exists to
 *        prevent — so measure the real card rather than accepting the default.
 */
export const SkeletonList = memo(function SkeletonList({
  rows = 5,
  thumb = 'square',
  thumbSize = 64,
  lines = 2,
  showMeta = true,
  rowH,
  bordered = false,
  label = 'Loading',
  style,
}) {
  return (
    <SkeletonGroup label={label} style={style}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[S.listRow, bordered && S.bordered, rowH ? { minHeight: rowH } : null]}>
          {thumb !== 'none' ? (
            <SkeletonBlock
              w={thumbSize}
              h={thumbSize}
              r={thumb === 'circle' ? thumbSize / 2 : 12}
            />
          ) : null}
          <View style={S.listBody}>
            <SkeletonBlock w="70%" h={12} />
            {lines > 1 ? <SkeletonBlock w="45%" h={10} /> : null}
            {showMeta ? (
              <View style={S.metaRow}>
                <SkeletonBlock w={54} h={20} r={10} />
                <SkeletonBlock w={70} h={20} r={10} />
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
});

/**
 * Horizontal card rail — "top rated", "nearby", carousel sections.
 *
 * @param {{count?: number, cardW?: number, cardH?: number, bordered?: boolean, label?: string, style?: any}} props
 */
export const SkeletonRail = memo(function SkeletonRail({
  count = 3,
  cardW = 150,
  cardH = 110,
  bordered = false,
  label = 'Loading',
  style,
}) {
  return (
    <SkeletonGroup label={label} style={style}>
      <View style={S.rail}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={[S.card, bordered && S.bordered, { width: cardW }]}>
            <SkeletonBlock w="100%" h={cardH} r={0} />
            <View style={S.cardBody}>
              <SkeletonBlock w="80%" h={10} />
              <SkeletonBlock w="50%" h={12} />
            </View>
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
});

/**
 * Detail screen — hero image, title, price, chips, body copy, action bar.
 * Used while a product / animal / machine / worker record is being fetched.
 *
 * @param {{heroH?: number, chips?: number, paragraphs?: number, showAction?: boolean,
 *          label?: string, style?: any}} props
 */
export const SkeletonDetail = memo(function SkeletonDetail({
  heroH = Math.round(W * 0.72),
  chips = 3,
  paragraphs = 4,
  showAction = true,
  label = 'Loading',
  style,
}) {
  return (
    <SkeletonGroup label={label} style={style}>
      <SkeletonBlock w="100%" h={heroH} r={0} />
      <View style={S.detailBody}>
        <SkeletonBlock w="72%" h={18} />
        <SkeletonBlock w="40%" h={22} r={8} />
        <View style={S.metaRow}>
          {Array.from({ length: chips }, (_, i) => (
            <SkeletonBlock key={i} w={70 + (i % 3) * 16} h={26} r={13} />
          ))}
        </View>
        <SkeletonText lines={paragraphs} />
        {showAction ? (
          <View style={S.actionRow}>
            <SkeletonBlock w="48%" h={46} r={14} />
            <SkeletonBlock w="48%" h={46} r={14} />
          </View>
        ) : null}
      </View>
    </SkeletonGroup>
  );
});

/**
 * KPI tiles — credit balances, mandi prices, MSP figures, planner counters.
 *
 * @param {{count?: number, columns?: number, tileH?: number, gutter?: number,
 *          gap?: number, bordered?: boolean, label?: string, style?: any}} props
 */
export const SkeletonStats = memo(function SkeletonStats({
  count = 4,
  columns = 2,
  tileH = 84,
  gutter = GUTTER,
  gap = GAP,
  bordered = false,
  label = 'Loading',
  style,
}) {
  const tileW = (W - gutter * 2 - gap * (columns - 1)) / columns;
  const rows  = Math.ceil(count / columns);
  return (
    <SkeletonGroup label={label} style={style}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={[S.row, { gap, marginBottom: gap }]}>
          {Array.from({ length: Math.min(columns, count - r * columns) }, (_, c) => (
            <View key={c} style={[S.tile, bordered && S.bordered, { width: tileW, height: tileH }]}>
              <SkeletonBlock w={26} h={26} r={13} />
              <SkeletonBlock w="62%" h={14} />
              <SkeletonBlock w="40%" h={9} />
            </View>
          ))}
        </View>
      ))}
    </SkeletonGroup>
  );
});

/**
 * A row of filter/category pills — the strip above most listing screens.
 *
 * @param {{count?: number, h?: number, label?: string, style?: any}} props
 */
export const SkeletonChips = memo(function SkeletonChips({ count = 5, h = 34, label = 'Loading', style }) {
  return (
    <SkeletonGroup label={label} style={style}>
      <View style={S.rail}>
        {Array.from({ length: count }, (_, i) => (
          <SkeletonBlock key={i} w={68 + (i % 3) * 22} h={h} r={h / 2} />
        ))}
      </View>
    </SkeletonGroup>
  );
});

const S = StyleSheet.create({
  row:        { flexDirection: 'row' },
  bordered:   { borderWidth: KBORDER.hairline, borderColor: COLORS.border },
  card:       { backgroundColor: COLORS.surface, borderRadius: RADIUS_CARD, overflow: 'hidden', ...KELEV.e1 },
  cardBody:   { padding: KSPACE.s10, gap: KSPACE.s6 },
  listRow:    { flexDirection: 'row', gap: KSPACE.s12, alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS_CARD, padding: KSPACE.s12, marginBottom: GAP, ...KELEV.e1 },
  listBody:   { flex: 1, gap: KSPACE.s8 },
  metaRow:    { flexDirection: 'row', gap: KSPACE.s8, flexWrap: 'wrap' },
  rail:       { flexDirection: 'row', gap: GAP },
  detailBody: { padding: KSPACE.s16, gap: KSPACE.s12 },
  actionRow:  { flexDirection: 'row', gap: GAP, marginTop: KSPACE.s4 },
  tile:       { backgroundColor: COLORS.surface, borderRadius: RADIUS_CARD, padding: KSPACE.s12, gap: KSPACE.s8, justifyContent: 'center', ...KELEV.e1 },
});

export default SkeletonGroup;
