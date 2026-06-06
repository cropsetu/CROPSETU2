/**
 * _svgMath.js — shared geometry + animation helpers for the MyFarm chart library.
 *
 * Kept tiny and dependency-free so each chart component stays small. All charts
 * pull colour from cosmicTheme and animate with React Native's core Animated
 * (transform/opacity use the native driver; stroke draws use JS driver).
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

export const TAU = Math.PI * 2;

/** Clamp v into [min, max]. */
export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/** Sum of `.value` over an array of {value} (NaN/neg-safe → treated as 0). */
export const sumValues = (arr) =>
  (arr || []).reduce((s, x) => s + (Number(x?.value) > 0 ? Number(x.value) : 0), 0);

/**
 * Point on a circle. angleDeg measured with 0° = 3 o'clock, increasing
 * clockwise (SVG y-down). Used by arc gauges and rings.
 */
export function polarToCartesian(cx, cy, r, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/**
 * SVG path `d` for an arc from startAngle→endAngle (clockwise), degrees.
 * Handles sweeps >180° and angles >360°.
 */
export function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/** Build an SVG polyline `d` from numeric points, scaled into a w×h box. */
export function buildLinePath(points, w, h, pad = 2) {
  const pts = (points || []).map(Number).filter((n) => !isNaN(n));
  if (pts.length === 0) return { d: '', area: '', coords: [] };
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const stepX = pts.length > 1 ? (w - pad * 2) / (pts.length - 1) : 0;
  const coords = pts.map((v, i) => ({
    x: pad + i * stepX,
    y: pad + (h - pad * 2) * (1 - (v - min) / span),
  }));
  const d = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(' ');
  const area = `${d} L ${coords[coords.length - 1].x.toFixed(2)} ${h - pad} L ${coords[0].x.toFixed(2)} ${h - pad} Z`;
  return { d, area, coords };
}

/** Mount reveal: fade + gentle scale-up. Native driver → cheap & smooth. */
export function useReveal(delay = 0, duration = 320) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [v, delay, duration]);
  return {
    opacity: v,
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
  };
}

/**
 * Draw progress 0→1 for stroke "draw-on" effects (dashoffset, bar heights).
 * JS-driven because it animates stroke/layout props SVG can't drive natively.
 */
export function useDraw(duration = 700, delay = 90, dep = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const anim = Animated.timing(v, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [v, duration, delay, dep]);
  return v;
}
