import { keyboardOverlap, keyboardBottomInset } from '../keyboard';

// Numbers below model a small low-end Android: 640dp window, 48dp nav bar,
// ~260dp keyboard as RN reports it (net of the nav bar).
const WINDOW = 640;
const NAV = 48;
const KB = 260;

describe('keyboardOverlap', () => {
  test('closed keyboard covers nothing', () => {
    expect(keyboardOverlap({ keyboardHeight: 0, restWindowHeight: WINDOW, windowHeight: WINDOW })).toBe(0);
  });

  test('edge-to-edge (window does not resize) — full keyboard height', () => {
    expect(keyboardOverlap({ keyboardHeight: KB, restWindowHeight: WINDOW, windowHeight: WINDOW })).toBe(KB);
  });

  test('resizing window — nothing, because the layout already made the room', () => {
    // This is the double-count guard: without it the field would be pushed up
    // by twice the keyboard on devices where adjustResize still shrinks.
    expect(keyboardOverlap({ keyboardHeight: KB, restWindowHeight: WINDOW, windowHeight: WINDOW - KB })).toBe(0);
  });

  test('partial resize — only the uncovered remainder', () => {
    expect(keyboardOverlap({ keyboardHeight: KB, restWindowHeight: WINDOW, windowHeight: WINDOW - 100 })).toBe(160);
  });

  test('a window that GREW is not treated as negative shrink', () => {
    expect(keyboardOverlap({ keyboardHeight: KB, restWindowHeight: WINDOW, windowHeight: WINDOW + 50 })).toBe(KB);
  });

  test('missing or garbage measurements degrade to no padding, never NaN', () => {
    expect(keyboardOverlap({ keyboardHeight: undefined, restWindowHeight: WINDOW, windowHeight: WINDOW })).toBe(0);
    expect(keyboardOverlap({ keyboardHeight: KB, restWindowHeight: undefined, windowHeight: undefined })).toBe(KB);
    expect(keyboardOverlap({ keyboardHeight: -10, restWindowHeight: WINDOW, windowHeight: WINDOW })).toBe(0);
  });
});

describe('keyboardBottomInset', () => {
  test('keyboard closed — just the safe area, unchanged from before', () => {
    expect(keyboardBottomInset({
      keyboardHeight: 0, restWindowHeight: WINDOW, windowHeight: WINDOW, safeAreaBottom: NAV, platform: 'android',
    })).toBe(NAV);
  });

  test('android adds the nav bar, because RN reports the keyboard net of it', () => {
    expect(keyboardBottomInset({
      keyboardHeight: KB, restWindowHeight: WINDOW, windowHeight: WINDOW, safeAreaBottom: NAV, platform: 'android',
    })).toBe(NAV + KB);
  });

  test('ios does not, because UIKit already includes the home indicator', () => {
    expect(keyboardBottomInset({
      keyboardHeight: KB, restWindowHeight: WINDOW, windowHeight: WINDOW, safeAreaBottom: 34, platform: 'ios',
    })).toBe(KB);
  });

  test('ios never returns less than the safe area (floating/hardware keyboard)', () => {
    expect(keyboardBottomInset({
      keyboardHeight: 10, restWindowHeight: WINDOW, windowHeight: WINDOW, safeAreaBottom: 34, platform: 'ios',
    })).toBe(34);
  });

  test('web — no keyboard events ever fire, so it is the safe area forever', () => {
    expect(keyboardBottomInset({
      keyboardHeight: 0, restWindowHeight: WINDOW, windowHeight: WINDOW, safeAreaBottom: 0, platform: 'web',
    })).toBe(0);
  });
});
