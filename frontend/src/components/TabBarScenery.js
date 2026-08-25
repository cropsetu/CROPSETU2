/**
 * TabBarScenery.js — illustrated decoration for the BOTTOM TAB BAR.
 *
 * Two exports, both purely decorative (no touch targets, no text):
 *
 *   <TabBarScenery />        layered pale-green ridges that sweep up at the left
 *                            and right edges, absolutely filling the bar so the
 *                            tabs float over a landscape.
 *   <TabActiveGlow size />   soft sun-glow behind the FOCUSED tab icon, replacing
 *                            the old flat rounded-rect tint pill.
 *
 * Conventions shared with TabIcons.js / ActivityIcons.js:
 *   • CRITICAL: react-native-svg gradient ids are GLOBAL — every id here is
 *     prefixed "tabsc-" so it can never clash with an icon's gradient.
 *   • STATIC by design. The bar already animates scale + glow opacity on press;
 *     an animated backdrop would compete with that and burn frames on the
 *     low-end Androids this app targets.
 *
 * Two constraints drive the shapes:
 *   1. LABEL CONTRAST. The label row sits over the upper half of this artwork, so
 *      RIDGE_BACK/RIDGE_MID are near-white — mutedSage labels keep the contrast
 *      they had on the old plain white bar. Only RIDGE_FRONT is saturated, and
 *      its crest stays below the text baseline.
 *   2. STRETCH. Everything is one preserveAspectRatio="none" SVG so it spans any
 *      bar width. That rules out discrete corner foliage — an earlier version
 *      pinned fixed-size leaf tufts to each end and they read as smudged streaks
 *      behind the Shop/Account labels. The edge rise is drawn INTO the ridges
 *      instead, which stretches gracefully and never collides with text.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

// Pale end of the brand greens. Kept local rather than pulled from COLORS
// because these are backdrop washes, not semantic UI colour — they must stay
// lighter than every foreground token in the bar.
const RIDGE_BACK  = '#F2FAEE';
const RIDGE_MID   = '#E4F5DC';
const RIDGE_FRONT = '#D2ECC7';

/**
 * Layered hills. Each path starts high at x=0, dips through the middle where the
 * labels sit, and rises again at x=400 — so the greenery frames both ends of the
 * bar and thins out behind the text.
 */
function Ridges() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 84" preserveAspectRatio="none">
      <Path
        d="M0 40 C 46 58, 104 63, 176 62 C 254 61, 330 58, 400 38 L400 84 L0 84 Z"
        fill={RIDGE_BACK}
      />
      <Path
        d="M0 54 C 52 68, 112 73, 190 72 C 268 71, 340 68, 400 52 L400 84 L0 84 Z"
        fill={RIDGE_MID}
      />
      <Path
        d="M0 66 C 58 76, 126 80, 204 79 C 282 78, 348 76, 400 64 L400 84 L0 84 Z"
        fill={RIDGE_FRONT}
      />
    </Svg>
  );
}

export function TabBarScenery() {
  return (
    <View style={S.fill} pointerEvents="none">
      <Ridges />
    </View>
  );
}

/** Soft radial sun-glow behind the focused tab icon. */
export function TabActiveGlow({ size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="tabsc-glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0"    stopColor="#FFEFA8" stopOpacity="1" />
          <Stop offset="0.40" stopColor="#F2F5B0" stopOpacity="0.85" />
          <Stop offset="0.70" stopColor="#D8EDB4" stopOpacity="0.50" />
          <Stop offset="1"    stopColor="#CDE8AC" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill="url(#tabsc-glow)" />
    </Svg>
  );
}

const S = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
});

export default TabBarScenery;
