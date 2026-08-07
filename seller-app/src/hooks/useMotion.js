/**
 * Motion hooks — accessible, battery-aware animation.
 *
 * Two problems these fix in the seller screens:
 *
 *  1. "Reduce Motion" was ignored. The shared motion.js caches the preference
 *     in a module variable that React never re-reads, so a user who enables the
 *     OS setting still got sliding, pulsing, glowing everything.
 *
 *  2. Decorative `Animated.loop(...)` calls (the live dot, the FAB ring, the
 *     profile avatar halo) were started once and never stopped. They kept
 *     running while the screen was covered by another route and while the app
 *     sat in the background — an animation frame every 16ms, forever.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/** Live "Reduce Motion" preference — re-renders when the user toggles it. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      ?.then?.((v) => { if (active) setReduced(!!v); })
      ?.catch?.(() => {});

    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => {
      if (active) setReduced(!!v);
    });

    return () => {
      active = false;
      // RN ≥0.65 returns a subscription; older returns undefined.
      if (sub?.remove) sub.remove();
      else AccessibilityInfo.removeEventListener?.('reduceMotionChanged', setReduced);
    };
  }, []);

  return reduced;
}

/**
 * A looping Animated value that only runs while the screen is focused AND the
 * app is in the foreground, and never runs at all under Reduce Motion.
 *
 * Returns an Animated.Value parked at `from` when idle, so styles bound to it
 * stay valid whether or not the loop is running.
 */
export function usePulse({
  from = 1,
  to = 1.3,
  duration = 800,
  useNativeDriver = true,
  enabled = true,
} = {}) {
  const value = useRef(new Animated.Value(from)).current;
  const loopRef = useRef(null);
  const reduced = useReducedMotion();
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(() => AppState.currentState !== 'background');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const shouldRun = enabled && !reduced && isFocused && appActive;

  useEffect(() => {
    if (!shouldRun) {
      loopRef.current?.stop();
      loopRef.current = null;
      value.setValue(from);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: to, duration, easing: Easing.inOut(Easing.ease), useNativeDriver }),
        Animated.timing(value, { toValue: from, duration, easing: Easing.inOut(Easing.ease), useNativeDriver }),
      ]),
    );
    loopRef.current = loop;
    loop.start();

    return () => { loop.stop(); loopRef.current = null; };
  }, [shouldRun, from, to, duration, useNativeDriver, value]);

  return value;
}

/**
 * One-shot entrance animation, honouring Reduce Motion (which collapses it to a
 * plain fade with no travel) and capping the stagger so item #40 in a list
 * isn't still waiting to appear two seconds after item #1.
 */
export function useEntrance({ index = 0, distance = 24, stagger = 45, maxDelay = 260 } = {}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const delay = Math.min(index * stagger, maxDelay);

  useEffect(() => {
    const anim = reduced
      ? Animated.timing(progress, { toValue: 1, duration: 160, useNativeDriver: true })
      : Animated.spring(progress, { toValue: 1, delay, tension: 70, friction: 11, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
    // Index is intentionally excluded: an item re-ordering mid-list should not
    // replay its entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return {
    opacity: progress,
    transform: reduced
      ? []
      : [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  };
}

/**
 * Animated counter that respects Reduce Motion and — unlike the original —
 * doesn't drive a JS-thread setState on every frame for the whole duration.
 * It samples at ~20fps, which is indistinguishable for rolling digits and
 * roughly a third of the render work.
 */
export function useCountUp(target, { duration = 1100 } = {}) {
  const reduced = useReducedMotion();
  const numeric = Number.isFinite(Number(target)) ? Number(target) : 0;
  const [display, setDisplay] = useState(reduced ? numeric : 0);
  const frame = useRef(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (reduced || duration <= 0) { setDisplay(numeric); return undefined; }
    if (numeric === 0) { setDisplay(0); return undefined; }

    let cancelled = false;
    startRef.current = 0;
    let lastEmit = 0;

    const step = (ts) => {
      if (cancelled) return;
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const p = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - p, 3);         // easeOutCubic
      if (p >= 1) { setDisplay(numeric); return; }
      if (ts - lastEmit >= 50) { lastEmit = ts; setDisplay(numeric * eased); }
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [numeric, duration, reduced]);

  return display;
}

/** Press-scale feedback that collapses to no-op under Reduce Motion. */
export function usePressScale({ to = 0.97 } = {}) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() => {
    if (reduced) return;
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 45, bounciness: 0 }).start();
  }, [reduced, scale, to]);

  const onPressOut = useCallback(() => {
    if (reduced) return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 35, bounciness: 6 }).start();
  }, [reduced, scale]);

  return { scale, onPressIn, onPressOut, reduced };
}
