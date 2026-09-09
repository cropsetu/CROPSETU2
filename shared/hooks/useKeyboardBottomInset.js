import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';
import { keyboardBottomInset } from '../utils/keyboard';

/**
 * Bottom inset a scroll container needs to keep its content clear of the
 * keyboard. Returns `safeAreaBottom` while the keyboard is closed, so callers
 * can use it as a drop-in replacement for `insets.bottom`.
 *
 * See shared/utils/keyboard.js for why KeyboardAvoidingView cannot do this job
 * under Expo SDK 54's forced edge-to-edge on Android.
 *
 * No-op on web: react-native-web's Keyboard module never emits, so the height
 * stays 0 and the returned inset is always `safeAreaBottom`.
 */
export default function useKeyboardBottomInset(safeAreaBottom = 0) {
  const { height: windowHeight } = useWindowDimensions();
  // Seeded, not just zero: Android only emits keyboardDidShow on a *change* of
  // visibility. Moving from the phone step to the OTP step remounts this hook
  // while the keyboard may already be up, and no event would follow — the OTP
  // boxes would then sit behind a keyboard nobody padded for.
  // react-native-web has no metrics(), hence the optional calls.
  const [keyboardHeight, setKeyboardHeight] = useState(() => {
    const m = Keyboard.isVisible?.() ? Keyboard.metrics?.() : null;
    return Number.isFinite(m?.height) ? m.height : 0;
  });
  // Window height last seen with the keyboard closed. Used to detect (and not
  // double-count) devices where the window itself shrinks for the IME.
  const restWindowHeight = useRef(windowHeight);

  useEffect(() => {
    if (keyboardHeight === 0) restWindowHeight.current = windowHeight;
  }, [keyboardHeight, windowHeight]);

  useEffect(() => {
    // iOS fires *Will* early enough to move with the keyboard animation.
    // Android only has *Did*, which is fine — it fires from onGlobalLayout.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      Keyboard.addListener(showEvent, (e) => {
        const h = e?.endCoordinates?.height;
        setKeyboardHeight(Number.isFinite(h) ? h : 0);
      }),
      Keyboard.addListener(hideEvent, () => setKeyboardHeight(0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return keyboardBottomInset({
    keyboardHeight,
    restWindowHeight: restWindowHeight.current,
    windowHeight,
    safeAreaBottom,
    platform: Platform.OS,
  });
}
