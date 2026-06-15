/**
 * LanguageIcon.js — colourful, ANIMATED, pure-vector "3D-style" GLOBE icon for the
 * onboarding LANGUAGE picker hero. Built for low-literacy Indian farmers: a friendly,
 * instantly-recognisable green/blue Earth globe with subtle continents, a gentle
 * latitude/longitude grid, a top-left shine and a soft ground shadow — plus 2-3 little
 * script glyphs ("अ", "A", "க") floating around it in speech bubbles to say "many
 * languages". No Lottie, no images, no network — only react-native-svg + the Animated API.
 *
 * Animation (all GPU/JS-cheap, opt-out via `animated={false}`):
 *   • the whole globe gets a slow native-driver "bob" (translateY — no re-renders)
 *   • a soft specular shimmer sweeps across the globe (the "slow-rotate" feel)
 *   • the floating script bubbles gently drift up/fade (heavy part) — AUTO-DISABLED
 *     under size 34 so it is safe in long scroll lists (only the cheap bob remains)
 *
 * Matches ActivityIcons.js / CropIcons.js conventions: viewBox 0 0 200 200, 3-stop
 * gradients for shading, a ground-shadow ellipse at cy≈178, and a top-left shine.
 * Every gradient id is variant-prefixed ("language-globe-…") because react-native-svg
 * gradient ids are GLOBAL (else two icons on one screen clash — the #1 bug to avoid).
 *
 * Usage:  <LanguageIcon size={48} animated />
 */
import React, { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect, G, Line, Polygon,
} from 'react-native-svg';

const AnimatedG       = Animated.createAnimatedComponent(G);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

// Below this size the floating-glyph particle motion is too small to read and too
// costly in scroll lists, so we keep only the cheap native-driver bob.
const PARTICLE_MIN = 34;

// Brand colours
const GOLD = '#e0af3b';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (same recipe as ActivityIcons.js)
// ─────────────────────────────────────────────────────────────────────────────
const Shadow = ({ cx = 100, rx = 52 }) => (
  <Ellipse cx={cx} cy={178} rx={rx} ry={8} fill="rgba(0,0,0,0.13)" />
);

const Body3D = ({ id, light, base, dark }) => (
  <RadialGradient id={id} cx="38%" cy="32%" r="80%">
    <Stop offset="0" stopColor={light} />
    <Stop offset="0.55" stopColor={base} />
    <Stop offset="1" stopColor={dark} />
  </RadialGradient>
);

const Body3DLinear = ({ id, light, base, dark }) => (
  <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <Stop offset="0" stopColor={light} />
    <Stop offset="0.5" stopColor={base} />
    <Stop offset="1" stopColor={dark} />
  </LinearGradient>
);

/**
 * A small floating "speech bubble" carrying a script glyph that gently drifts up
 * and fades, looping. Static (a clean resting bubble) when off.
 */
function GlyphBubble({ cx, cy, r, fill, stroke, glyph, dur, delay, on }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const a = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [on, dur, delay, v]);

  const translateY = on ? v.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) : 0;
  const opacity    = on ? v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.92, 1, 0.92] }) : 1;

  return (
    <AnimatedG style={on ? { opacity, transform: [{ translateY }] } : undefined}>
      {/* bubble */}
      <Circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth="2.5" />
      <Ellipse cx={cx - r * 0.32} cy={cy - r * 0.38} rx={r * 0.34} ry={r * 0.2} fill="rgba(255,255,255,0.55)" />
      {/* little tail toward the globe (down-left) */}
      <Path d={`M${cx - r * 0.55} ${cy + r * 0.55} L${cx - r * 0.15} ${cy + r * 1.05} L${cx + r * 0.15} ${cy + r * 0.55}Z`} fill={fill} />
      {glyph(cx, cy, r)}
    </AnimatedG>
  );
}

// ── Script glyphs drawn as simple Paths (no real fonts — safe everywhere) ─────
// Devanagari-flavoured "अ" mark
function glyphA(cx, cy, r) {
  const s = r / 13; // scale unit relative to a ~13px reference bubble
  return (
    <G transform={`translate(${cx},${cy}) scale(${s})`}>
      {/* top headline bar (shirorekha) */}
      <Path d="M-7 -8 L8 -8" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* curved body */}
      <Path d="M-6 -8 Q-9 4 -1 6 Q5 7 5 -2 Q5 6 6 9"
        stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* small vertical stem on the right */}
      <Path d="M8 -8 L8 9" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" fill="none" />
    </G>
  );
}

// Latin "A"
function glyphLatin(cx, cy, r) {
  const s = r / 13;
  return (
    <G transform={`translate(${cx},${cy}) scale(${s})`}>
      <Path d="M-7 8 L0 -9 L7 8 M-4 2 L4 2"
        stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </G>
  );
}

// Tamil-flavoured "க" mark
function glyphTamil(cx, cy, r) {
  const s = r / 13;
  return (
    <G transform={`translate(${cx},${cy}) scale(${s})`}>
      {/* loop + descending tail, evoking க */}
      <Path d="M-7 -6 Q4 -10 6 -1 Q7 6 -2 6 Q-7 6 -6 1"
        stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M6 -1 Q8 5 5 9" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" fill="none" />
    </G>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── GLOBE ICON ───────────────────────────────────────────────────────────────
// A friendly green/blue Earth globe with continents, a soft grid, a shimmer sweep,
// and floating multilingual script bubbles.
// ─────────────────────────────────────────────────────────────────────────────
function GlobeIcon({ size, animated }) {
  const heavy = animated && size >= PARTICLE_MIN;

  // Specular shimmer sweep (the slow-rotate "alive" feel) — native driver, no re-render.
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(shimmer, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(shimmer, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [animated, shimmer]);

  const shineX = animated ? shimmer.interpolate({ inputRange: [0, 1], outputRange: [-10, 22] }) : 0;
  const shineO = animated ? shimmer.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.22, 0.42, 0.22] }) : 0.3;

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        {/* Ocean body */}
        <Body3D id="language-globe-ocean" light="#7FD0FF" base="#1E88E5" dark="#0D47A1" />
        {/* Land masses (forest green → brand) */}
        <Body3DLinear id="language-globe-land" light="#7CE49A" base="#1C8A3C" dark="#005f21" />
        {/* Speech-bubble fills */}
        <Body3D id="language-globe-bubA"  light="#FFE082" base={GOLD}     dark="#A47B12" />
        <Body3D id="language-globe-bubB"  light="#7CE49A" base="#1C8A3C"  dark="#005f21" />
        <Body3D id="language-globe-bubC"  light="#F8A0BE" base="#EC407A"  dark="#AD1457" />
      </Defs>

      <Shadow rx={52} />

      {/* Soft halo */}
      <Circle cx="100" cy="104" r="68" fill="rgba(30,136,229,0.14)" />

      {/* ── The globe sphere (ocean) ── */}
      <Circle cx="100" cy="104" r="58" fill="url(#language-globe-ocean)" />

      {/* Longitude / latitude grid (subtle "wireframe") */}
      <Ellipse cx="100" cy="104" rx="58" ry="58" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
      <Ellipse cx="100" cy="104" rx="24" ry="58" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
      <Ellipse cx="100" cy="104" rx="46" ry="58" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.2" />
      <Line x1="42" y1="104" x2="158" y2="104" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <Path d="M50 74 Q100 64 150 74"  stroke="rgba(255,255,255,0.13)" strokeWidth="1.2" fill="none" />
      <Path d="M50 134 Q100 144 150 134" stroke="rgba(255,255,255,0.13)" strokeWidth="1.2" fill="none" />

      {/* ── Continents (friendly blobs, brand green) ── */}
      {/* upper-left landmass */}
      <Path d="M62 70 Q82 60 96 70 Q104 78 96 88 Q86 96 74 92 Q60 86 62 70Z" fill="url(#language-globe-land)" />
      {/* right landmass */}
      <Path d="M118 78 Q142 76 144 96 Q144 114 126 116 Q112 112 114 96 Q112 84 118 78Z" fill="url(#language-globe-land)" />
      {/* lower-centre landmass (India-ish wedge) */}
      <Path d="M84 116 Q104 110 112 122 Q116 136 102 144 Q92 150 88 138 Q82 128 84 116Z" fill="url(#language-globe-land)" />
      {/* small island */}
      <Circle cx="68" cy="120" r="6" fill="url(#language-globe-land)" />

      {/* Subtle land shading edges */}
      <Path d="M62 70 Q82 60 96 70" stroke="rgba(255,255,255,0.30)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <Path d="M84 116 Q104 110 112 122" stroke="rgba(255,255,255,0.25)" strokeWidth="1.8" strokeLinecap="round" fill="none" />

      {/* ── Moving specular shimmer (the "rotate" shine) ── */}
      <AnimatedEllipse cx="78" cy="78" rx="20" ry="30" fill="#FFFFFF" opacity={shineO}
        style={animated ? { transform: [{ translateX: shineX }] } : undefined} />
      {/* Static top-left highlight (always present) */}
      <Ellipse cx="78" cy="76" rx="14" ry="9" fill="rgba(255,255,255,0.30)" />

      {/* Crisp rim light */}
      <Path d="M58 86 Q66 60 96 50" stroke="rgba(255,255,255,0.45)" strokeWidth="3" strokeLinecap="round" fill="none" />

      {/* ── Floating multilingual script bubbles ── */}
      <GlyphBubble cx={154} cy={58}  r={16} fill="url(#language-globe-bubA)" stroke="#A47B12" glyph={glyphA}     dur={1500} delay={0}   on={heavy} />
      <GlyphBubble cx={46}  cy={50}  r={14} fill="url(#language-globe-bubB)" stroke="#005f21" glyph={glyphLatin} dur={1700} delay={420} on={heavy} />
      <GlyphBubble cx={158} cy={128} r={14} fill="url(#language-globe-bubC)" stroke="#AD1457" glyph={glyphTamil} dur={1600} delay={840} on={heavy} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry + alias map + fallback (case-insensitive)
// ─────────────────────────────────────────────────────────────────────────────
const ICONS = {
  GLOBE: GlobeIcon,
};

// Consumer-screen input keys → registry keys. The onboarding hero may pass any of
// these (or nothing). Unknown input falls back to the default 'globe'.
const ALIASES = {
  GLOBE:        'GLOBE',
  LANGUAGE:     'GLOBE',
  LANGUAGES:    'GLOBE',
  LANG:         'GLOBE',
  MULTILINGUAL: 'GLOBE',
  TRANSLATE:    'GLOBE',
  WORLD:        'GLOBE',
  EARTH:        'GLOBE',
};

const DEFAULT_KEY = 'GLOBE';

/**
 * Renders the (animated) multilingual globe SVG for the language picker.
 * @param {string}  variant   icon key (case-insensitive); unknown → 'globe'
 * @param {string}  type      alias for `variant` (same lookup)
 * @param {number}  size      width & height in dp (default 48)
 * @param {boolean} animated  gentle bob + shimmer + floating glyphs (default true);
 *                            heavy glyph motion auto-disables under size 34
 */
export function LanguageIcon({ variant, type, size = 48, animated = true }) {
  const raw = String(variant ?? type ?? '').trim().toUpperCase();
  const key = ALIASES[raw] || (ICONS[raw] ? raw : DEFAULT_KEY);
  const Icon = ICONS[key] || ICONS[DEFAULT_KEY];

  // Cheap native-driver "bob" so the icon feels alive (no React re-renders).
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [animated, bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const wrap = { width: size, height: size, alignItems: 'center', justifyContent: 'center' };

  return (
    <Animated.View style={[wrap, animated && { transform: [{ translateY }] }]}>
      <Icon size={size} animated={animated} />
    </Animated.View>
  );
}

export default LanguageIcon;
