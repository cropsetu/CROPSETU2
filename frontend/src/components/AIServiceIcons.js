/**
 * AIServiceIcons.js — animated, colourful 3D-style SVG icons for the core Krushi
 * AI services shown on the AI hub (AIAssistantHome):
 *   • drishti — Krushi Drishti  (crop disease detection / "vision": leaf + magnifier)
 *   • gyaan   — Krushi Gyaan    (AI chat knowledge: speech bubble + sprout + spark)
 *   • vaani   — Krushi Vaani    (voice assistant: microphone + sound waves)
 *   • farms   — My Farms        (sun + field rows + sprout)
 *
 * Style recipe mirrors CropIcons.js / AnimalIcons.js (viewBox 200, 3-stop
 * gradients, soft ground shadow, top-left shine) plus the gentle native-driver
 * "bob" from ActivityIcons.js so the tiles feel alive. react-native-svg gradient
 * ids are GLOBAL, so every id is prefixed per service+part ("ai-drishti-leaf", …).
 *
 * Usage:  <AIServiceIcon name="drishti" size={32} />   // animated by default
 */
import React, { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect, G, Line, Polygon,
} from 'react-native-svg';

// ── Shared helpers (same conventions as the sibling icon files) ──────────────
const Shadow = ({ cx = 100, rx = 52, ry = 9 }) => (
  <Ellipse cx={cx} cy={181} rx={rx} ry={ry} fill="rgba(0,0,0,0.12)" />
);
const Body3D = ({ id, light, base, dark }) => (
  <RadialGradient id={id} cx="36%" cy="30%" r="82%">
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

// ── DRISHTI — a healthy green leaf being scanned by a magnifier (disease spots) ─
function DrishtiIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="ai-drishti-leaf" light="#7CE6AE" base="#2FA86A" dark="#147346" />
        <Body3DLinear id="ai-drishti-glass" light="#EAF6FF" base="#BBDDF6" dark="#88B6DF" />
        <Body3DLinear id="ai-drishti-rim" light="#FDE68A" base="#E0AF3B" dark="#A47B12" />
      </Defs>
      <Shadow rx={50} />
      {/* leaf */}
      <Path d="M58 150 Q34 118 46 78 Q58 42 102 40 Q138 38 154 64 Q150 110 120 138 Q94 160 58 150 Z" fill="url(#ai-drishti-leaf)" />
      {/* midrib + side veins */}
      <Path d="M66 146 Q100 104 148 62" stroke="rgba(255,255,255,0.55)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <Path d="M86 122 Q98 110 96 92" stroke="rgba(255,255,255,0.4)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M104 130 Q120 118 122 100" stroke="rgba(255,255,255,0.4)" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* disease spots */}
      <Circle cx="86" cy="90" r="6.5" fill="#C4571F" /><Circle cx="86" cy="90" r="3" fill="#7C3209" />
      <Circle cx="72" cy="108" r="4" fill="#C4571F" />
      {/* magnifier over the lower-right of the leaf */}
      <Circle cx="120" cy="120" r="30" fill="url(#ai-drishti-glass)" opacity="0.92" />
      <Circle cx="120" cy="120" r="30" fill="none" stroke="url(#ai-drishti-rim)" strokeWidth="9" />
      {/* zoomed-in spot inside the lens */}
      <Circle cx="116" cy="122" r="7" fill="#C4571F" /><Circle cx="116" cy="122" r="3.4" fill="#7C3209" />
      {/* handle */}
      <Rect x="138" y="138" width="13" height="36" rx="6.5" fill="url(#ai-drishti-rim)" transform="rotate(45 144 156)" />
      {/* lens shine */}
      <Ellipse cx="110" cy="110" rx="8" ry="5" fill="rgba(255,255,255,0.6)" />
    </Svg>
  );
}

// ── GYAAN — a speech bubble with a white knowledge-sprout + a gold AI spark ────
function GyaanIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="ai-gyaan-bubble" light="#7FB4FF" base="#3B7DEB" dark="#1E54BE" />
        <Body3D id="ai-gyaan-spark" light="#FFF0B8" base="#F6C638" dark="#C68E12" />
      </Defs>
      <Shadow rx={46} />
      {/* speech bubble with a tail at the bottom-left */}
      <Path d="M52 50 Q52 38 64 38 H148 Q160 38 160 50 V104 Q160 116 148 116 H92 L66 140 L72 116 H64 Q52 116 52 104 Z" fill="url(#ai-gyaan-bubble)" />
      {/* white sprout (knowledge grows) inside the bubble */}
      <Path d="M106 102 Q106 86 106 72" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" fill="none" />
      <Path d="M106 86 Q86 84 76 68 Q98 62 106 82 Z" fill="#FFFFFF" />
      <Path d="M106 80 Q126 76 136 60 Q114 56 106 76 Z" fill="rgba(255,255,255,0.92)" />
      {/* gold AI spark (4-point star) top-right + small twinkle */}
      <Polygon points="160,30 167,50 187,57 167,64 160,84 153,64 133,57 153,50" fill="url(#ai-gyaan-spark)" />
      <Circle cx="44" cy="62" r="4" fill="url(#ai-gyaan-spark)" />
      {/* shine */}
      <Ellipse cx="80" cy="56" rx="14" ry="8" fill="rgba(255,255,255,0.25)" />
    </Svg>
  );
}

// ── VAANI — a microphone with green voice waves ───────────────────────────────
function VaaniIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="ai-vaani-mic" light="#FFD08A" base="#F7922E" dark="#C9610C" />
        <Body3DLinear id="ai-vaani-stand" light="#F2C879" base="#D79A2E" dark="#A06E12" />
      </Defs>
      <Shadow rx={42} />
      {/* voice waves (green) on the right */}
      <Path d="M150 74 Q166 100 150 126" stroke="#2FA86A" strokeWidth="7" strokeLinecap="round" fill="none" />
      <Path d="M164 58 Q190 100 164 142" stroke="#2FA86A" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.6" />
      {/* mic capsule */}
      <Rect x="74" y="36" width="44" height="86" rx="22" fill="url(#ai-vaani-mic)" />
      {/* grille lines */}
      <Line x1="84" y1="58" x2="108" y2="58" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" />
      <Line x1="84" y1="72" x2="108" y2="72" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" />
      <Line x1="84" y1="86" x2="108" y2="86" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" />
      {/* cradle arc */}
      <Path d="M58 104 Q58 142 96 142 Q134 142 134 104" stroke="url(#ai-vaani-stand)" strokeWidth="8" strokeLinecap="round" fill="none" />
      {/* stand + base */}
      <Rect x="92" y="142" width="8" height="22" rx="3" fill="url(#ai-vaani-stand)" />
      <Rect x="74" y="164" width="44" height="9" rx="4.5" fill="url(#ai-vaani-stand)" />
      {/* shine */}
      <Ellipse cx="88" cy="52" rx="7" ry="12" fill="rgba(255,255,255,0.35)" />
    </Svg>
  );
}

// ── FARMS — a sun over a field mound with a central sprout ────────────────────
function FarmsIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="ai-farms-sun" light="#FFE9A6" base="#FBC02D" dark="#E08F12" />
        <Body3DLinear id="ai-farms-leaf" light="#7CE0A2" base="#33A865" dark="#157A44" />
        <Body3DLinear id="ai-farms-field" light="#E0B06A" base="#B98442" dark="#8A5E28" />
      </Defs>
      <Shadow rx={52} />
      {/* sun + rays, top-right */}
      <G>
        <Line x1="156" y1="16" x2="156" y2="30" stroke="#FBC02D" strokeWidth="5" strokeLinecap="round" />
        <Line x1="182" y1="28" x2="173" y2="39" stroke="#FBC02D" strokeWidth="5" strokeLinecap="round" />
        <Line x1="190" y1="54" x2="176" y2="54" stroke="#FBC02D" strokeWidth="5" strokeLinecap="round" />
        <Line x1="130" y1="30" x2="139" y2="41" stroke="#FBC02D" strokeWidth="5" strokeLinecap="round" />
        <Circle cx="156" cy="52" r="18" fill="url(#ai-farms-sun)" />
      </G>
      {/* field mound */}
      <Path d="M28 150 Q100 130 172 150 Q172 178 100 180 Q28 178 28 150 Z" fill="url(#ai-farms-field)" />
      {/* furrow lines */}
      <Path d="M44 152 Q100 140 156 152" stroke="rgba(255,255,255,0.32)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M52 164 Q100 154 148 164" stroke="rgba(0,0,0,0.12)" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* central sprout */}
      <Path d="M100 150 Q100 116 100 86" stroke="url(#ai-farms-leaf)" strokeWidth="9" strokeLinecap="round" fill="none" />
      <Path d="M100 114 Q68 108 50 80 Q86 74 100 110 Z" fill="url(#ai-farms-leaf)" />
      <Path d="M100 102 Q128 96 144 74 Q112 66 100 100 Z" fill="url(#ai-farms-leaf)" />
      {/* small side sprout */}
      <Path d="M70 152 Q70 132 70 118" stroke="#33A865" strokeWidth="6" strokeLinecap="round" fill="none" />
      <Path d="M70 130 Q54 126 46 112 Q64 110 70 126 Z" fill="#33A865" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const ICONS = { drishti: DrishtiIcon, gyaan: GyaanIcon, vaani: VaaniIcon, farms: FarmsIcon };

/**
 * Animated colourful icon for a core Krushi AI service.
 * @param {string}  name      drishti | gyaan | vaani | farms
 * @param {number}  size      width & height in dp (default 32)
 * @param {boolean} animated  gentle idle bob (default true)
 */
export default function AIServiceIcon({ name, size = 32, animated = true }) {
  const Icon = ICONS[name];
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated || !Icon) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [animated, Icon]);

  if (!Icon) return null;
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <Icon size={size} />
    </Animated.View>
  );
}
