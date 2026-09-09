// ─────────────────────────────────────────────────────────────────────────────
// Keyboard geometry — pure math, no React Native import so it stays testable
// under the node-environment jest config.
//
// WHY THIS EXISTS INSTEAD OF <KeyboardAvoidingView behavior="padding">
// ───────────────────────────────────────────────────────────────────
// KeyboardAvoidingView derives its offset from `keyboardDidShow.endCoordinates
// .screenY`. On Android API >= 30 React Native fills that field like this
// (ReactRootView.java, checkForKeyboardEvents):
//
//     screenY = softInputMode == SOFT_INPUT_ADJUST_NOTHING
//         ? visibleDisplayFrame.bottom - height
//         : visibleDisplayFrame.bottom;
//
// Our manifest uses adjustResize, so screenY == visibleDisplayFrame.bottom.
// Expo SDK 54 forces edge-to-edge (decorFitsSystemWindows=false), under which
// the window does NOT shrink when the IME opens — the visible frame bottom is
// unchanged, so screenY still points at the bottom of the screen and KAV's
// `frame.y + frame.height - screenY` evaluates to 0. It applies no padding at
// all, which is exactly the "keyboard covers the input" bug.
//
// `endCoordinates.height` in that same payload IS correct: it is
// `imeInsets.bottom - systemBarInsets.bottom`, i.e. the keyboard measured above
// the navigation bar. We use that instead.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * How much of the window bottom the keyboard actually covers.
 *
 * `keyboardHeight` is `endCoordinates.height`. On devices where the window DOES
 * resize for the IME (older Androids, edge-to-edge disabled) the layout has
 * already made room, so padding by the full keyboard height would double-count
 * and push the field up by twice the keyboard. `restWindowHeight` (the window
 * height last measured with the keyboard closed) minus the current
 * `windowHeight` is that shrink, and we subtract it.
 *
 * Resizing window   → shrink == keyboardHeight → overlap 0.
 * Edge-to-edge      → shrink == 0             → overlap == keyboardHeight.
 * Partial resize    → the remainder.
 */
export function keyboardOverlap({ keyboardHeight, restWindowHeight, windowHeight }) {
  const kb = Math.max(0, num(keyboardHeight));
  if (kb === 0) return 0;
  const shrink = Math.max(0, num(restWindowHeight) - num(windowHeight));
  return Math.max(0, Math.round(kb - shrink));
}

/**
 * Total bottom inset a scroll container needs so its last element clears both
 * the system bars and the keyboard.
 *
 * Keyboard closed → just the safe-area inset, as before.
 * Android open    → safeAreaBottom + overlap. RN reports the keyboard height
 *                   NET of the navigation bar, and the nav bar still overlays
 *                   the IME, so both insets are needed.
 * iOS open        → max(safeAreaBottom, overlap). UIKit reports the keyboard
 *                   height INCLUDING the home-indicator strip, so adding the
 *                   safe-area inset on top would leave a visible dead gap.
 */
export function keyboardBottomInset({
  keyboardHeight,
  restWindowHeight,
  windowHeight,
  safeAreaBottom = 0,
  platform = 'android',
}) {
  const safe = Math.max(0, num(safeAreaBottom));
  const overlap = keyboardOverlap({ keyboardHeight, restWindowHeight, windowHeight });
  if (overlap === 0) return safe;
  return platform === 'ios' ? Math.max(safe, overlap) : safe + overlap;
}
