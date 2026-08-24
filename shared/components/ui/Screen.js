// ─────────────────────────────────────────────────────────────────────────────
// Screen — the one place that knows about the notch, the home indicator, the
// status bar, the keyboard and the scroll tail.
//
// MEASURED in frontend/src/screens: 40 files call useSafeAreaInsets(), 12 wrap in
// SafeAreaView, 33 mount their own StatusBar — and they disagree with each other.
//
// THE ADDITIVE TAIL, which is the one thing the token file structurally cannot
// hold. KSPACE.tailTab (100) and tailFab (120) are ABSOLUTE totals that already
// subsume insets.bottom. Screens that write `insets.bottom + 30` are COMPOSING —
// a different arithmetic relationship wearing the same name. That is why the
// pilot's `insets.bottom + 30` survived a migration that tokenised 70% of the
// screen: there was nothing to migrate it to. `tail` below encodes the
// distinction in the API, so it cannot be got wrong:
//     tail="tab"  → KSPACE.tailTab          (absolute; inset NOT added)
//     tail={30}   → insets.bottom + 30      (additive)
//
// THE KEYBOARD. `behavior="padding"` on Android double-applies the keyboard
// height, because adjustResize has already shrunk the window. That is the exact
// bug fixed in this repo at 99bae07 (onboarding, Android), and it is still latent
// in the other KeyboardAvoidingView call sites. Baked in here so it cannot recur.
//
// Screen PUBLISHES which safe-area edges it consumed. <Header> reads that and
// adds nothing on top — see Header.js. That makes the double-inset regression
// impossible rather than remembered.
//
// STATUS BAR: not rendered unless asked. 65 of 98 screens set none today; forcing
// one would repaint them.
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useMemo } from 'react';
import {
  View, ScrollView, StatusBar, StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KHET, KSPACE, KGUTTER, KELEV } from '@krushisarva/shared/constants/khetTheme';

const ScreenContext = createContext(null);

const NO_CONSUME = { top: false, bottom: false, left: false, right: false };

/**
 * Insets plus what the enclosing <Screen> already consumed.
 *
 * Use this instead of a second useSafeAreaInsets() call inside a Screen — it is
 * the only way a gradient hero can add `insets.top + 18` without risking a
 * double inset. It is also the escape hatch for the 28 FlatList/SectionList
 * screens, which cannot use `scroll` (wrapping a virtualised list in a
 * ScrollView breaks windowing) and must build their own contentContainerStyle:
 *
 *     const { insets, gutter } = useScreenInsets();
 *     <FlatList contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} />
 *
 * Safe to call outside a Screen: `consumed` is all-false.
 */
export function useScreenInsets() {
  const ctx = useContext(ScreenContext);
  const raw = useSafeAreaInsets();
  return ctx || { insets: raw, consumed: NO_CONSUME, gutter: KGUTTER.base };
}

/**
 * <Screen
 *   edges       safe-area edges Screen pads. Default ['top'] — what SafeAreaView
 *               does. Gradient/hero screens that paint UNDER the status bar pass
 *               edges={[]} and read useScreenInsets() inside the hero.
 *   bg          background colour. Default KHET.background.
 *   gutter      false (default) | true | a number | a KGUTTER key.
 *               NOTE: this is paddingHorizontal, never a `padding` shorthand —
 *               that is the KSPACE-vs-KGUTTER rule the pilot had to invent,
 *               made executable so `grep -c KGUTTER` stops lying.
 *   scroll      render the body in a ScrollView.
 *   keyboard    wrap in a KeyboardAvoidingView (iOS padding, Android nothing).
 *   tail        bottom clearance on the scroll content:
 *                 'none' (default) · 'safe' (insets.bottom)
 *                 'tab'  KSPACE.tailTab — ABSOLUTE, inset NOT added
 *                 'fab'  KSPACE.tailFab — ABSOLUTE, inset NOT added
 *                 <number> insets.bottom + N — the additive form
 *   footer      node pinned below the body, already carrying the bottom inset
 *               and the upward KELEV.e3Up hairline (Android cannot cast an
 *               upward shadow, so that tier ships its own border).
 *   statusBar   'dark' | 'light' | undefined (default: render nothing)
 * />
 * children may be a function: {({ insets }) => …}
 * Remaining props go to the ScrollView when `scroll`, else to the body View.
 */
export default function Screen({
  edges = ['top'],
  bg = KHET.background,
  gutter = false,
  scroll = false,
  keyboard = false,
  tail = 'none',
  footer,
  footerPad = KSPACE.s12,
  statusBar,
  statusBarBg,
  translucent,
  style,
  contentContainerStyle,
  children,
  ...rest
}) {
  const insets = useSafeAreaInsets();

  const consumed = useMemo(() => {
    const list = Array.isArray(edges) ? edges : [];
    return {
      top: list.indexOf('top') !== -1,
      bottom: list.indexOf('bottom') !== -1,
      left: list.indexOf('left') !== -1,
      right: list.indexOf('right') !== -1,
    };
  }, [edges]);

  const gut = gutter === false || gutter == null
    ? 0
    : gutter === true
      ? KGUTTER.base
      : typeof gutter === 'number' ? gutter : (KGUTTER[gutter] || KGUTTER.base);

  const ctx = useMemo(
    () => ({ insets, consumed, gutter: gut }),
    [insets, consumed, gut]
  );

  const frame = {
    flex: 1,
    backgroundColor: bg,
    paddingTop: consumed.top ? insets.top : 0,
    paddingLeft: consumed.left ? insets.left : 0,
    paddingRight: consumed.right ? insets.right : 0,
    // In scroll mode the bottom edge belongs to the CONTENT, not the frame —
    // otherwise the list stops short and the scroll gutter is cut. A footer pays
    // the bottom inset itself, so the frame must not pay it twice.
    paddingBottom: !scroll && !footer && consumed.bottom ? insets.bottom : 0,
  };

  const tailPad = useMemo(() => {
    if (tail === 'none' || tail == null || tail === false) return 0;
    if (tail === 'safe') return insets.bottom;
    if (tail === 'tab') return KSPACE.tailTab;   // absolute: already clears the bar
    if (tail === 'fab') return KSPACE.tailFab;   // absolute
    if (typeof tail === 'number') return insets.bottom + tail; // additive
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[khet/Screen] unknown tail "${tail}" — expected 'none'|'safe'|'tab'|'fab' or a number.`);
    }
    return 0;
  }, [tail, insets.bottom]);

  const body = typeof children === 'function' ? children({ insets, consumed }) : children;

  let content = scroll ? (
    <ScrollView
      style={styles.fill}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...rest}
      contentContainerStyle={[
        gut ? { paddingHorizontal: gut } : null,
        tailPad ? { paddingBottom: tailPad } : null,
        contentContainerStyle,
      ]}
    >
      {body}
    </ScrollView>
  ) : (
    <View {...rest} style={[styles.fill, gut ? { paddingHorizontal: gut } : null, contentContainerStyle]}>
      {body}
    </View>
  );

  if (keyboard) {
    content = (
      <KeyboardAvoidingView
        style={styles.fill}
        // iOS only. Android's adjustResize has ALREADY shrunk the window; adding
        // padding on top of that squeezes the form off-screen — bug 99bae07.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {content}
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScreenContext.Provider value={ctx}>
      <View style={[frame, style]}>
        {statusBar ? (
          <StatusBar
            barStyle={statusBar === 'light' ? 'light-content' : 'dark-content'}
            backgroundColor={
              Platform.OS === 'android'
                ? (statusBarBg != null ? statusBarBg : 'transparent')
                : undefined
            }
            translucent={translucent != null ? translucent : consumed.top}
          />
        ) : null}

        {content}

        {footer ? (
          <View
            style={[
              styles.footer,
              {
                paddingHorizontal: gut || KGUTTER.base,
                paddingTop: footerPad,
                // Math.max keeps a real tap target on non-notched Android, where
                // insets.bottom is 0.
                paddingBottom: Math.max(insets.bottom, footerPad),
              },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </ScreenContext.Provider>
  );
}

Screen.Context = ScreenContext;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  footer: { backgroundColor: KHET.card, ...KELEV.e3Up },
});
