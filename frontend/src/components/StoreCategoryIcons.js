/**
 * StoreCategoryIcons.js — colourful, ANIMATED, pure-vector "3D-style" gradient SVG
 * icons for AgriStore product CATEGORIES. Built for low-literacy Indian farmers:
 * every icon is an instantly-recognisable real-world object, big and saturated.
 *
 * Matches ActivityIcons.js / CropIcons.js conventions exactly:
 *   • viewBox="0 0 200 200", width={size} height={size}
 *   • a soft ground-shadow <Ellipse cy≈178>
 *   • a top-left white shine highlight
 *   • 3-stop light/base/dark gradients for a 3D feel
 *   • every gradient id is variant-prefixed (e.g. "store-seeds-packet") because
 *     react-native-svg gradient ids are GLOBAL — two icons on one screen must not clash.
 *
 * Animation (opt-out via `animated={false}`, all native-driver / JS-cheap):
 *   • a gentle staggered "bob" on every icon (native driver, no React re-renders)
 *   • a few variants add a cheap particle motion (mist / falling drops / sprouting)
 *   • heavy particles AUTO-DISABLE below size 34 so it is safe in long scroll lists
 *
 * The AgriStore screen passes the API category's Ionicon name (cat.icon) — e.g.
 * "leaf", "flask", "shield-checkmark" — or the human category name. The alias map
 * below resolves BOTH forms (and short keys like "seeds") to a variant. Unknown
 * input falls back to a friendly colourful shopping bag.
 *
 * Usage:  <StoreCategoryIcon type="seeds" size={32} />
 */
import React, { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect, G, Line, Polygon,
} from 'react-native-svg';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedCircle  = Animated.createAnimatedComponent(Circle);

// Below this size we skip per-particle loops (only the parent bob/pulse remains)
// so a horizontal pill list of 22 icons stays cheap.
const PARTICLE_MIN = 34;

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────
const Shadow = ({ cx = 100, rx = 50 }) => (
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

/** A single self-looping falling element (drop / seed). Static midpoint when off. */
function Faller({ x, fromY, toY, rx, ry, fill, dur, delay, on }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const a = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.in(Easing.quad), useNativeDriver: false }),
    ]));
    a.start();
    return () => a.stop();
  }, [on, dur, delay, v]);
  if (!on) {
    const midY = fromY + (toY - fromY) * 0.5;
    return <Ellipse cx={x} cy={midY} rx={rx} ry={ry} fill={fill} />;
  }
  const cy = v.interpolate({ inputRange: [0, 1], outputRange: [fromY, toY] });
  const opacity = v.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] });
  return <AnimatedEllipse cx={x} cy={cy} rx={rx} ry={ry} fill={fill} opacity={opacity} />;
}

/** A self-looping drifting mist puff. Static when off. */
function Mist({ fromX, toX, y, r, fill, dur, delay, on }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const a = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]));
    a.start();
    return () => a.stop();
  }, [on, dur, delay, v]);
  if (!on) return <Circle cx={(fromX + toX) / 2} cy={y} r={r} fill={fill} />;
  const cx = v.interpolate({ inputRange: [0, 1], outputRange: [fromX, toX] });
  const opacity = v.interpolate({ inputRange: [0, 0.2, 0.7, 1], outputRange: [0, 0.9, 0.9, 0] });
  return <AnimatedCircle cx={cx} cy={y} r={r} fill={fill} opacity={opacity} />;
}

/** A self-looping soft pulse (twinkle / glow). Static at mid-opacity when off. */
function Twinkle({ cx, cy, r, fill, dur, delay, on, min = 0.2, max = 0.95 }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const a = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(v, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    a.start();
    return () => a.stop();
  }, [on, dur, delay, v]);
  if (!on) return <Circle cx={cx} cy={cy} r={r} fill={fill} opacity={(min + max) / 2} />;
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [min, max] });
  return <AnimatedCircle cx={cx} cy={cy} r={r} fill={fill} opacity={opacity} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── CATEGORY ICONS ────────────────────────────────────────────────────────────
// Each is a self-contained Svg. `animated` toggles particles; `parts` is the
// computed "particles allowed" flag (animated && size >= PARTICLE_MIN).
// ─────────────────────────────────────────────────────────────────────────────

// SEEDS & PLANTING MATERIAL — seed packet with a sprout + falling seeds (leaf green)
function SeedsIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-seeds-packet" light="#FFF6DB" base="#F2D98B" dark="#C9A93F" />
        <Body3DLinear id="store-seeds-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
        <Body3D id="store-seeds-seed" light="#D7CCC8" base="#A1887F" dark="#6D4C41" />
        <Body3D id="store-seeds-window" light="#8D6E63" base="#5D4037" dark="#3E2723" />
      </Defs>
      <Shadow rx={50} />
      {/* Paper packet */}
      <Path d="M58 50 Q56 42 66 42 L134 42 Q144 42 142 50 L150 156 Q152 168 138 168 L62 168 Q48 168 50 156 Z" fill="url(#store-seeds-packet)" />
      {/* Torn/zig top edge */}
      <Path d="M58 50 L70 44 L82 50 L94 44 L106 50 L118 44 L130 50 L142 50 L142 44 L58 44 Z" fill="#C9A93F" />
      {/* Picture window with soil + sprout */}
      <Rect x="70" y="64" width="60" height="56" rx="8" fill="url(#store-seeds-window)" />
      <Path d="M72 110 Q100 102 128 110 L128 116 Q100 110 72 116 Z" fill="#6D4C41" />
      <Path d="M100 116 Q100 96 100 80" stroke="url(#store-seeds-leaf)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <Path d="M100 96 Q82 90 74 76 Q92 74 100 94Z" fill="url(#store-seeds-leaf)" />
      <Path d="M100 90 Q120 82 128 70 Q108 68 100 88Z" fill="url(#store-seeds-leaf)" />
      {/* Brand band */}
      <Rect x="68" y="132" width="64" height="9" rx="4.5" fill="#43A047" />
      <Rect x="74" y="148" width="52" height="6" rx="3" fill="rgba(67,160,71,0.45)" />
      {/* Shine */}
      <Path d="M66 52 Q64 100 70 150" stroke="rgba(255,255,255,0.45)" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Spilled / falling seeds */}
      <Faller x={150} fromY={120} toY={164} rx={5.5} ry={4} fill="url(#store-seeds-seed)" dur={1100} delay={0}   on={parts} />
      <Faller x={160} fromY={116} toY={164} rx={5}   ry={3.6} fill="url(#store-seeds-seed)" dur={1200} delay={420} on={parts} />
      {!parts && <>
        <Circle cx="150" cy="160" r="5" fill="url(#store-seeds-seed)" />
        <Circle cx="160" cy="166" r="4" fill="url(#store-seeds-seed)" />
      </>}
      <Circle cx="44" cy="166" r="4.5" fill="url(#store-seeds-seed)" />
    </Svg>
  );
}

// FERTILIZERS & SOIL NUTRITION — nutrient sack with granules spilling (deep blue)
function FertilizerIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-fert-sack" light="#64B5F6" base="#1565C0" dark="#0D3C75" />
        <Body3D id="store-fert-gran" light="#E1A86A" base="#B07733" dark="#7A4E1C" />
      </Defs>
      <Shadow rx={52} />
      <Path d="M60 70 Q58 60 70 58 L130 58 Q142 60 140 70 L148 148 Q150 162 132 164 L68 164 Q50 162 52 148 Z" fill="url(#store-fert-sack)" />
      <Path d="M68 60 Q100 46 132 60 Q116 54 100 54 Q84 54 68 60Z" fill="#0D3C75" />
      <Rect x="84" y="52" width="32" height="9" rx="4.5" fill="#0A2E5C" />
      {/* White label with N-P-K */}
      <Rect x="76" y="90" width="48" height="36" rx="6" fill="rgba(255,255,255,0.92)" />
      <Circle cx="90" cy="108" r="4.5" fill="#1565C0" />
      <Circle cx="100" cy="108" r="4.5" fill="#43A047" />
      <Circle cx="110" cy="108" r="4.5" fill="#E65100" />
      <Rect x="84" y="118" width="32" height="4" rx="2" fill="rgba(21,101,192,0.4)" />
      <Ellipse cx="76" cy="80" rx="9" ry="16" fill="rgba(255,255,255,0.25)" />
      {/* Spilled granules */}
      <Circle cx="56" cy="160" r="5" fill="url(#store-fert-gran)" />
      <Circle cx="46" cy="166" r="4" fill="url(#store-fert-gran)" />
      <Circle cx="64" cy="168" r="4" fill="url(#store-fert-gran)" />
      <Circle cx="142" cy="162" r="4.5" fill="url(#store-fert-gran)" />
      <Circle cx="152" cy="168" r="4" fill="url(#store-fert-gran)" />
      <Faller x={150} fromY={130} toY={162} rx={4} ry={4} fill="url(#store-fert-gran)" dur={1000} delay={200} on={parts} />
    </Svg>
  );
}

// CROP PROTECTION — shield with a protected leaf + tick (alert red)
function ProtectionIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-prot-shield" light="#EF5350" base="#C62828" dark="#8E0000" />
        <Body3DLinear id="store-prot-leaf" light="#A5D6A7" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={48} />
      <Path d="M100 36 Q132 50 158 52 Q160 110 134 142 Q116 164 100 170 Q84 164 66 142 Q40 110 42 52 Q68 50 100 36Z" fill="url(#store-prot-shield)" />
      <Path d="M100 36 Q132 50 158 52 Q160 110 134 142 Q116 164 100 170 Q84 164 66 142 Q40 110 42 52 Q68 50 100 36Z" fill="rgba(255,255,255,0.08)" />
      <Path d="M58 56 Q66 100 84 132" stroke="rgba(255,255,255,0.35)" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Inner protected leaf */}
      <Path d="M112 130 Q78 122 68 88 Q80 60 108 62 Q138 66 142 96 Q140 122 112 130Z" fill="url(#store-prot-leaf)" />
      <Path d="M112 130 Q100 96 86 68" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" fill="none" />
      {/* Tick badge */}
      <Circle cx="128" cy="118" r="18" fill="#FFFFFF" />
      <Path d="M120 118 L126 125 L138 110" stroke="#43A047" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

// ORGANIC & NATURAL FARMING — green leaf inside a "cycle" ring (organic green)
function OrganicIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-org-ring" light="#C5E1A5" base="#7CB342" dark="#558B2F" />
        <Body3DLinear id="store-org-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={50} />
      <Circle cx="100" cy="100" r="62" fill="rgba(85,139,47,0.16)" />
      {/* Eco cycle arrows ring */}
      <Path d="M100 44 A56 56 0 1 1 50 76" fill="none" stroke="url(#store-org-ring)" strokeWidth="11" strokeLinecap="round" />
      <Polygon points="100,32 112,46 88,46" fill="#558B2F" />
      {/* Central leaf */}
      <Path d="M118 138 Q72 128 60 88 Q74 56 112 58 Q150 62 156 102 Q152 132 118 138Z" fill="url(#store-org-leaf)" />
      <Path d="M118 138 Q104 96 86 60" stroke="rgba(255,255,255,0.45)" strokeWidth="3" fill="none" />
      <Path d="M104 104 Q84 96 70 86" stroke="rgba(255,255,255,0.28)" strokeWidth="2" fill="none" />
      <Path d="M110 88 Q128 82 144 76" stroke="rgba(255,255,255,0.28)" strokeWidth="2" fill="none" />
      <Ellipse cx="86" cy="84" rx="9" ry="14" fill="rgba(255,255,255,0.22)" />
    </Svg>
  );
}

// PLANT GROWTH REGULATORS — sprout climbing an upward growth arrow (purple)
function GrowthIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-grow-arrow" light="#CE93D8" base="#8E24AA" dark="#6A1B9A" />
        <Body3DLinear id="store-grow-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={50} />
      {/* Rising bar steps */}
      <Rect x="44"  y="128" width="22" height="34" rx="5" fill="url(#store-grow-arrow)" opacity="0.55" />
      <Rect x="74"  y="108" width="22" height="54" rx="5" fill="url(#store-grow-arrow)" opacity="0.75" />
      <Rect x="104" y="86"  width="22" height="76" rx="5" fill="url(#store-grow-arrow)" />
      {/* Growth arrow */}
      <Path d="M48 132 L92 96 L116 116 L160 64" stroke="url(#store-grow-arrow)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Polygon points="166,56 168,90 134,70" fill="#8E24AA" />
      {/* Sprout at the tip */}
      <Path d="M150 78 Q150 60 150 48" stroke="url(#store-grow-leaf)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <Path d="M150 60 Q134 54 126 42 Q144 40 150 58Z" fill="url(#store-grow-leaf)" />
      <Path d="M150 56 Q168 48 176 36 Q156 34 150 54Z" fill="url(#store-grow-leaf)" />
    </Svg>
  );
}

// IRRIGATION & WATER MANAGEMENT — drip pipe dripping onto a sprout (water blue)
function IrrigationIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-irr-pipe" light="#90A4AE" base="#546E7A" dark="#37474F" />
        <Body3D id="store-irr-drop" light="#81D4FA" base="#29B6F6" dark="#0277BD" />
        <Body3DLinear id="store-irr-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={52} />
      {/* Soil bed */}
      <Path d="M34 150 Q34 138 60 136 Q100 132 140 136 Q166 138 166 150 Q166 164 100 166 Q34 164 34 150Z" fill="#6D4C41" />
      {/* Sprout */}
      <Path d="M100 150 Q100 124 100 104" stroke="url(#store-irr-leaf)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <Path d="M100 120 Q84 114 76 102 Q92 100 100 118Z" fill="url(#store-irr-leaf)" />
      <Path d="M100 114 Q116 108 124 96 Q108 94 100 112Z" fill="url(#store-irr-leaf)" />
      {/* Horizontal drip lateral pipe */}
      <Rect x="26" y="54" width="148" height="16" rx="8" fill="url(#store-irr-pipe)" />
      <Rect x="30" y="57" width="140" height="3.5" rx="2" fill="rgba(255,255,255,0.4)" />
      {/* Emitters */}
      <Circle cx="62"  cy="72" r="6" fill="#37474F" />
      <Circle cx="100" cy="72" r="6" fill="#37474F" />
      <Circle cx="138" cy="72" r="6" fill="#37474F" />
      {/* Falling drops from emitters */}
      <Faller x={62}  fromY={80} toY={142} rx={5}   ry={7}   fill="url(#store-irr-drop)" dur={950}  delay={0}   on={parts} />
      <Faller x={100} fromY={80} toY={142} rx={5.5} ry={7.5} fill="url(#store-irr-drop)" dur={1050} delay={320} on={parts} />
      <Faller x={138} fromY={80} toY={142} rx={5}   ry={7}   fill="url(#store-irr-drop)" dur={1000} delay={620} on={parts} />
      {!parts && (
        <Path d="M100 84 Q94 94 100 100 Q106 94 100 84Z" fill="url(#store-irr-drop)" />
      )}
    </Svg>
  );
}

// FARM MACHINERY & EQUIPMENT — a simple tractor (earth brown / green machine)
function MachineryIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-mach-body" light="#7CB342" base="#558B2F" dark="#33691E" />
        <Body3D id="store-mach-wheelB" light="#616161" base="#37474F" dark="#1C2429" />
        <Body3D id="store-mach-wheelF" light="#9E9E9E" base="#616161" dark="#37474F" />
        <Body3DLinear id="store-mach-cab" light="#B3E5FC" base="#4FC3F7" dark="#0288D1" />
      </Defs>
      <Shadow rx={56} />
      {/* Big rear wheel */}
      <Circle cx="138" cy="138" r="34" fill="url(#store-mach-wheelB)" />
      <Circle cx="138" cy="138" r="15" fill="#90A4AE" />
      <Circle cx="138" cy="138" r="7"  fill="#455A64" />
      {/* Small front wheel */}
      <Circle cx="58" cy="146" r="22" fill="url(#store-mach-wheelF)" />
      <Circle cx="58" cy="146" r="9"  fill="#B0BEC5" />
      {/* Body / engine */}
      <Path d="M40 118 L40 100 Q40 92 50 92 L84 92 L92 70 Q94 62 104 62 L120 62 Q132 62 132 74 L132 118 Q132 128 120 128 L52 128 Q40 128 40 118Z" fill="url(#store-mach-body)" />
      {/* Cab window */}
      <Path d="M100 70 L120 70 Q124 70 124 76 L124 92 L98 92 L100 70Z" fill="url(#store-mach-cab)" />
      {/* Exhaust */}
      <Rect x="74" y="56" width="8" height="40" rx="4" fill="#37474F" />
      {/* Headlight + shine */}
      <Circle cx="48" cy="106" r="6" fill="#FFE082" />
      <Path d="M48 98 Q44 110 52 120" stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

// HAND TOOLS & SMALL EQUIPMENT — khurpi/hoe: wood handle + metal blade (orange)
function ToolsIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-tool-handle" light="#D7A86E" base="#A1683A" dark="#6D4118" />
        <Body3DLinear id="store-tool-blade" light="#ECEFF1" base="#B0BEC5" dark="#78909C" />
      </Defs>
      <Shadow rx={50} />
      {/* Wooden handle (diagonal) */}
      <Rect x="92" y="32" width="18" height="86" rx="9" fill="url(#store-tool-handle)" transform="rotate(34,100,80)" />
      <Path d="M68 50 L120 88" stroke="rgba(255,255,255,0.3)" strokeWidth="3" strokeLinecap="round" transform="rotate(0,0,0)" />
      {/* Metal ferrule */}
      <Rect x="108" y="104" width="22" height="14" rx="5" fill="#78909C" transform="rotate(34,119,111)" />
      {/* Khurpi blade — broad curved metal */}
      <Path d="M112 112 Q150 116 158 150 Q156 168 132 166 Q98 162 92 132 Q92 116 112 112Z" fill="url(#store-tool-blade)" />
      <Path d="M104 128 Q112 152 134 162" stroke="rgba(255,255,255,0.55)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Path d="M100 132 Q108 154 132 164" stroke="rgba(0,0,0,0.12)" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* A little soil on the tip */}
      <Circle cx="142" cy="156" r="6" fill="#6D4C41" />
      <Circle cx="150" cy="160" r="4" fill="#5D4037" />
    </Svg>
  );
}

// PROTECTED CULTIVATION — polyhouse / greenhouse tunnel with plants (teal)
function PolyhouseIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-poly-film" light="#B2DFDB" base="#4DB6AC" dark="#00897B" />
        <Body3DLinear id="store-poly-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={56} />
      {/* Tunnel arch (plastic film) */}
      <Path d="M36 150 L36 108 Q36 56 100 56 Q164 56 164 108 L164 150 Z" fill="url(#store-poly-film)" />
      <Path d="M36 150 L36 108 Q36 56 100 56 Q164 56 164 108 L164 150 Z" fill="rgba(255,255,255,0.10)" />
      {/* Film panel lines / glazing */}
      <Path d="M72 150 L72 64" stroke="rgba(255,255,255,0.45)" strokeWidth="3" fill="none" />
      <Path d="M100 150 L100 56" stroke="rgba(255,255,255,0.4)" strokeWidth="3" fill="none" />
      <Path d="M128 150 L128 64" stroke="rgba(255,255,255,0.45)" strokeWidth="3" fill="none" />
      <Path d="M44 96 Q100 64 156 96" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" fill="none" />
      {/* Frame outline */}
      <Path d="M36 150 L36 108 Q36 56 100 56 Q164 56 164 108 L164 150" stroke="#00695C" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Plants inside */}
      <Path d="M70 150 Q70 132 70 120 M70 132 Q58 126 54 116 M70 132 Q82 126 86 116" stroke="url(#store-poly-leaf)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M130 150 Q130 132 130 120 M130 132 Q118 126 114 116 M130 132 Q142 126 146 116" stroke="url(#store-poly-leaf)" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Ground */}
      <Rect x="34" y="150" width="132" height="8" rx="4" fill="#6D4C41" />
    </Svg>
  );
}

// MICRONUTRIENTS & SPECIALTY NUTRITION — droplet bottle with a leaf (amber)
function MicronutrientIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-micro-bottle" light="#FFE082" base="#F9A825" dark="#C77700" />
        <Body3D id="store-micro-drop" light="#FFD54F" base="#FB8C00" dark="#E65100" />
        <Body3DLinear id="store-micro-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={46} />
      {/* Bottle body */}
      <Path d="M64 96 Q62 84 76 82 L124 82 Q138 84 136 96 L142 150 Q144 164 128 166 L72 166 Q56 164 58 150 Z" fill="url(#store-micro-bottle)" />
      {/* Neck + cap */}
      <Rect x="86" y="62" width="28" height="22" rx="4" fill="url(#store-micro-bottle)" />
      <Rect x="82" y="50" width="36" height="16" rx="6" fill="#C77700" />
      {/* Label with a droplet + leaf */}
      <Rect x="72" y="104" width="56" height="46" rx="8" fill="rgba(255,255,255,0.92)" />
      <Path d="M100 110 Q88 126 100 136 Q112 126 100 110Z" fill="url(#store-micro-drop)" />
      <Path d="M100 132 Q90 130 84 122 Q94 120 100 130Z" fill="url(#store-micro-leaf)" />
      <Rect x="80" y="142" width="40" height="4" rx="2" fill="rgba(249,168,37,0.5)" />
      <Ellipse cx="74" cy="100" rx="7" ry="14" fill="rgba(255,255,255,0.3)" />
      {/* Dripping nutrient */}
      <Faller x={100} fromY={40} toY={58} rx={4} ry={5.5} fill="url(#store-micro-drop)" dur={1100} delay={0} on={parts} />
    </Svg>
  );
}

// SEEDS TREATMENT & ADDITIVES — coated seeds + a wand/dropper colouring them (magenta)
function SeedTreatIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-treat-seed" light="#F8BBD0" base="#EC407A" dark="#AD1457" />
        <Body3DLinear id="store-treat-wand" light="#ECEFF1" base="#B0BEC5" dark="#78909C" />
        <Body3D id="store-treat-drop" light="#F48FB1" base="#E91E63" dark="#AD1457" />
      </Defs>
      <Shadow rx={50} />
      {/* Bowl of coated seeds */}
      <Path d="M44 116 Q44 158 100 158 Q156 158 156 116 Z" fill="#FCE4EC" />
      <Path d="M44 116 L156 116" stroke="#F48FB1" strokeWidth="4" strokeLinecap="round" />
      {/* Coated (magenta) seeds */}
      {[[70,128],[92,134],[114,130],[136,128],[82,144],[104,146],[126,142]].map(([cx, cy], i) => (
        <G key={i}>
          <Ellipse cx={cx} cy={cy} rx="9" ry="7" fill="url(#store-treat-seed)" />
          <Ellipse cx={cx - 2.5} cy={cy - 2} rx="2.5" ry="1.6" fill="rgba(255,255,255,0.4)" />
        </G>
      ))}
      {/* Dropper / wand from top-right */}
      <Rect x="118" y="36" width="14" height="56" rx="7" fill="url(#store-treat-wand)" transform="rotate(24,125,64)" />
      <Path d="M138 92 Q150 96 146 84Z" fill="#AD1457" />
      <Circle cx="120" cy="36" r="10" fill="#AD1457" />
      {/* Dropping dye */}
      <Faller x={120} fromY={96} toY={120} rx={4} ry={5.5} fill="url(#store-treat-drop)" dur={1000} delay={0} on={parts} />
      {!parts && <Path d="M120 100 Q113 110 120 118 Q127 110 120 100Z" fill="url(#store-treat-drop)" />}
    </Svg>
  );
}

// LIVESTOCK, DAIRY & POULTRY — friendly cow head (brown / cream)
function LivestockIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-cow-head" light="#EFE4D8" base="#C9B49A" dark="#9C8265" />
        <Body3D id="store-cow-muzzle" light="#FBCFE0" base="#F0A9C2" dark="#D17A9A" />
        <Body3D id="store-cow-ear" light="#D7C3AC" base="#A88B6A" dark="#7A6244" />
      </Defs>
      <Shadow rx={52} />
      {/* Ears */}
      <Ellipse cx="50" cy="86" rx="18" ry="13" fill="url(#store-cow-ear)" transform="rotate(-28,50,86)" />
      <Ellipse cx="150" cy="86" rx="18" ry="13" fill="url(#store-cow-ear)" transform="rotate(28,150,86)" />
      {/* Horns */}
      <Path d="M64 64 Q54 48 60 36 Q70 46 74 62Z" fill="#E0D2BE" />
      <Path d="M136 64 Q146 48 140 36 Q130 46 126 62Z" fill="#E0D2BE" />
      {/* Head */}
      <Path d="M58 92 Q58 60 100 60 Q142 60 142 92 Q142 132 100 152 Q58 132 58 92Z" fill="url(#store-cow-head)" />
      {/* Brown spot */}
      <Path d="M70 78 Q62 96 76 108 Q90 100 84 80 Q78 74 70 78Z" fill="rgba(120,90,60,0.35)" />
      {/* Eyes */}
      <Circle cx="82" cy="98" r="7" fill="#3E2723" />
      <Circle cx="118" cy="98" r="7" fill="#3E2723" />
      <Circle cx="80" cy="95" r="2.4" fill="#FFFFFF" />
      <Circle cx="116" cy="95" r="2.4" fill="#FFFFFF" />
      {/* Muzzle */}
      <Ellipse cx="100" cy="128" rx="30" ry="22" fill="url(#store-cow-muzzle)" />
      <Circle cx="90" cy="128" r="4" fill="#9C5C76" />
      <Circle cx="110" cy="128" r="4" fill="#9C5C76" />
      <Path d="M88 140 Q100 148 112 140" stroke="#9C5C76" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Ellipse cx="74" cy="84" rx="9" ry="6" fill="rgba(255,255,255,0.3)" />
    </Svg>
  );
}

// FENCING & FARM PROTECTION — fence posts with wire mesh (slate grey)
function FencingIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-fence-post" light="#90A4AE" base="#546E7A" dark="#37474F" />
      </Defs>
      <Shadow rx={54} />
      {/* Posts */}
      {[48, 100, 152].map((x, i) => (
        <Rect key={i} x={x - 7} y="54" width="14" height="108" rx="7" fill="url(#store-fence-post)" />
      ))}
      {/* Post caps */}
      {[48, 100, 152].map((x, i) => (
        <Path key={i} d={`M${x - 8} 56 L${x} 44 L${x + 8} 56Z`} fill="#455A64" />
      ))}
      {/* Wire mesh (diagonal chain-link) */}
      <G stroke="#B0BEC5" strokeWidth="3" strokeLinecap="round">
        <Line x1="40" y1="78" x2="160" y2="78" />
        <Line x1="40" y1="104" x2="160" y2="104" />
        <Line x1="40" y1="130" x2="160" y2="130" />
      </G>
      <G stroke="#CFD8DC" strokeWidth="2.5" strokeLinecap="round" opacity="0.85">
        <Line x1="56" y1="68" x2="84" y2="142" />
        <Line x1="84" y1="68" x2="56" y2="142" />
        <Line x1="116" y1="68" x2="144" y2="142" />
        <Line x1="144" y1="68" x2="116" y2="142" />
      </G>
      {/* Barbs / shine */}
      <Line x1="42" y1="74" x2="158" y2="74" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
    </Svg>
  );
}

// STORAGE & PACKAGING — stacked cardboard boxes / sacks (kraft brown)
function StorageIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-box-front" light="#E0B584" base="#C08E52" dark="#8A5E2C" />
        <Body3DLinear id="store-box-top" light="#F0CB9E" base="#D6A567" dark="#A87B40" />
        <Body3DLinear id="store-box-side" light="#C49656" base="#A4763C" dark="#71511F" />
      </Defs>
      <Shadow rx={54} />
      {/* Small box behind-left */}
      <Rect x="32" y="108" width="50" height="50" rx="5" fill="url(#store-box-front)" />
      <Path d="M32 108 L40 98 L82 98 L82 108Z" fill="url(#store-box-top)" />
      {/* Main box */}
      <Rect x="78" y="92" width="84" height="74" rx="6" fill="url(#store-box-front)" />
      {/* Box top lid (open flaps) */}
      <Path d="M78 92 L98 70 L162 70 L162 92Z" fill="url(#store-box-top)" />
      <Path d="M162 92 L182 74 L182 148 L162 166Z" fill="url(#store-box-side)" />
      {/* Tape seam */}
      <Rect x="116" y="92" width="10" height="74" fill="rgba(255,255,255,0.35)" />
      <Path d="M98 70 L116 92 L126 92 L110 70Z" fill="rgba(0,0,0,0.08)" />
      {/* Label */}
      <Rect x="92" y="118" width="38" height="26" rx="4" fill="rgba(255,255,255,0.85)" />
      <Rect x="98" y="125" width="26" height="3.5" rx="1.8" fill="#8A5E2C" />
      <Rect x="98" y="133" width="18" height="3.5" rx="1.8" fill="#C08E52" />
    </Svg>
  );
}

// AGRI TECHNOLOGY & SMART FARMING — microchip leaf (deep indigo)
function AgritechIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-tech-chip" light="#5C6BC0" base="#283593" dark="#1A237E" />
        <Body3DLinear id="store-tech-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={50} />
      {/* Chip pins */}
      <G fill="#7986CB">
        {[64, 86, 114, 136].map((x, i) => <Rect key={`t${i}`} x={x - 4} y="44" width="8" height="16" rx="2" />)}
        {[64, 86, 114, 136].map((x, i) => <Rect key={`b${i}`} x={x - 4} y="140" width="8" height="16" rx="2" />)}
        {[64, 86, 114, 136].map((y, i) => <Rect key={`l${i}`} x="44" y={y - 4} width="16" height="8" rx="2" />)}
        {[64, 86, 114, 136].map((y, i) => <Rect key={`r${i}`} x="140" y={y - 4} width="16" height="8" rx="2" />)}
      </G>
      {/* Chip body */}
      <Rect x="58" y="58" width="84" height="84" rx="14" fill="url(#store-tech-chip)" />
      <Rect x="68" y="68" width="64" height="64" rx="8" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
      {/* Leaf-on-chip = smart farming */}
      <Path d="M118 124 Q82 116 74 88 Q86 66 112 68 Q138 72 142 98 Q138 120 118 124Z" fill="url(#store-tech-leaf)" />
      <Path d="M118 124 Q106 96 92 70" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" fill="none" />
      {/* Circuit node */}
      <Twinkle cx="86" cy="100" r="4.5" fill="#FFD54F" dur={780} delay={0} on={parts} />
      <Ellipse cx="84" cy="74" rx="6" ry="4" fill="rgba(255,255,255,0.25)" />
    </Svg>
  );
}

// SOLAR & ENERGY — solar panel + sun (golden yellow)
function SolarIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-solar-sun" light="#FFF176" base="#FFC107" dark="#F57F17" />
        <Body3DLinear id="store-solar-panel" light="#42A5F5" base="#1565C0" dark="#0D3C75" />
        <Body3DLinear id="store-solar-stand" light="#90A4AE" base="#607D8B" dark="#37474F" />
      </Defs>
      <Shadow rx={52} />
      {/* Sun top-left with rays */}
      <G stroke="#FFC107" strokeWidth="4" strokeLinecap="round">
        <Line x1="58" y1="22" x2="58" y2="36" />
        <Line x1="30" y1="50" x2="40" y2="58" />
        <Line x1="86" y1="50" x2="76" y2="58" />
        <Line x1="26" y1="62" x2="40" y2="64" />
      </G>
      <Twinkle cx="58" cy="62" r="19" fill="url(#store-solar-sun)" dur={1400} delay={0} on={parts} min={0.7} max={1} />
      {/* Panel (tilted) */}
      <Path d="M70 150 L96 96 L182 96 L156 150 Z" fill="url(#store-solar-panel)" />
      {/* Cells grid */}
      <G stroke="rgba(255,255,255,0.45)" strokeWidth="2">
        <Line x1="124" y1="96" x2="98" y2="150" />
        <Line x1="139" y1="96" x2="113" y2="150" />
        <Line x1="154" y1="96" x2="128" y2="150" />
        <Line x1="88" y1="114" x2="170" y2="114" />
        <Line x1="80" y1="132" x2="162" y2="132" />
      </G>
      <Path d="M100 100 L120 100" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round" />
      {/* Stand / pole */}
      <Rect x="108" y="150" width="12" height="20" rx="4" fill="url(#store-solar-stand)" />
      <Rect x="92" y="166" width="44" height="9" rx="4.5" fill="#455A64" />
    </Svg>
  );
}

// SAFETY & PROTECTIVE GEAR — hard hat + safety mask (safety red)
function SafetyIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-safe-hat" light="#FFD54F" base="#FBC02D" dark="#F57F17" />
        <Body3DLinear id="store-safe-mask" light="#FFFFFF" base="#E0E0E0" dark="#9E9E9E" />
      </Defs>
      <Shadow rx={50} />
      {/* Hard hat dome */}
      <Path d="M48 116 Q48 60 100 56 Q152 60 152 116 Z" fill="url(#store-safe-hat)" />
      {/* Hat ridge */}
      <Path d="M100 56 L100 116" stroke="rgba(0,0,0,0.10)" strokeWidth="6" />
      <Path d="M76 60 Q76 88 76 114" stroke="rgba(0,0,0,0.07)" strokeWidth="5" />
      <Path d="M124 60 Q124 88 124 114" stroke="rgba(0,0,0,0.07)" strokeWidth="5" />
      {/* Brim */}
      <Path d="M36 116 Q100 134 164 116 Q164 126 152 128 L48 128 Q36 126 36 116Z" fill="#F9A825" />
      <Path d="M52 64 Q60 70 64 84" stroke="rgba(255,255,255,0.4)" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Respirator mask below */}
      <Path d="M62 138 Q100 130 138 138 Q142 158 100 168 Q58 158 62 138Z" fill="url(#store-safe-mask)" />
      <Path d="M62 138 Q100 146 138 138" stroke="#BDBDBD" strokeWidth="2.5" fill="none" />
      <Path d="M70 152 Q100 158 130 152" stroke="#BDBDBD" strokeWidth="2" fill="none" />
      {/* Filter valve */}
      <Circle cx="100" cy="152" r="9" fill="#C62828" />
      <Circle cx="100" cy="152" r="4" fill="#FFCDD2" />
      {/* Straps */}
      <Path d="M62 138 Q44 132 40 144" stroke="#9E9E9E" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M138 138 Q156 132 160 144" stroke="#9E9E9E" strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

// SPRAYING EQUIPMENT — sprayer bottle releasing a drifting mist (cyan/teal)
function SprayerIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-spray-bottle" light="#80DEEA" base="#0097A7" dark="#006978" />
      </Defs>
      <Shadow rx={48} />
      {/* Bottle body */}
      <Path d="M44 112 Q42 98 56 96 L94 96 Q106 98 104 112 L104 152 Q104 166 90 166 L58 166 Q44 166 44 152 Z" fill="url(#store-spray-bottle)" />
      {/* Liquid level */}
      <Path d="M46 130 Q74 124 102 130 L102 152 Q102 164 90 164 L58 164 Q46 164 46 152 Z" fill="rgba(178,235,242,0.4)" />
      {/* Neck + trigger head */}
      <Rect x="62" y="80" width="26" height="18" rx="5" fill="url(#store-spray-bottle)" />
      <Path d="M62 80 L62 60 L102 60 Q110 60 110 68 L110 76 Z" fill="#006978" />
      <Rect x="110" y="64" width="20" height="8" rx="3" fill="#004D58" />
      {/* Trigger */}
      <Path d="M72 80 Q58 82 60 98" stroke="#004D58" strokeWidth="5" strokeLinecap="round" fill="none" />
      <Ellipse cx="58" cy="118" rx="7" ry="16" fill="rgba(255,255,255,0.28)" />
      {/* Drifting mist from nozzle */}
      <Mist fromX={132} toX={176} y={58} r={4}   fill="#B2EBF2" dur={1100} delay={0}   on={parts} />
      <Mist fromX={132} toX={172} y={70} r={3.4} fill="#B2EBF2" dur={1200} delay={300} on={parts} />
      <Mist fromX={132} toX={180} y={64} r={3}   fill="#E0F7FA" dur={1000} delay={620} on={parts} />
      {!parts && <>
        <Circle cx="142" cy="60" r="3.6" fill="#B2EBF2" opacity="0.9" />
        <Circle cx="156" cy="66" r="3" fill="#E0F7FA" opacity="0.9" />
      </>}
    </Svg>
  );
}

// HARVESTING & POST-HARVEST — sickle cutting a wheat sheaf (harvest green/gold)
function HarvestIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-harv-grain" light="#FFE082" base="#E0AF3B" dark="#A47B12" />
        <Body3DLinear id="store-harv-blade" light="#ECEFF1" base="#CFD8DC" dark="#90A4AE" />
      </Defs>
      <Shadow rx={52} />
      {[-18, -6, 6, 18].map((dx, i) => (
        <Path key={i} d={`M${100 + dx} 160 Q${100 + dx * 0.6} 110 ${100 + dx * 0.5} 64`}
          stroke="#C9A227" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      ))}
      {[[82, 60], [100, 52], [118, 60], [91, 76], [109, 76]].map(([cx, cy], i) => (
        <G key={i}>
          <Ellipse cx={cx} cy={cy} rx="11" ry="18" fill="url(#store-harv-grain)" />
          <Ellipse cx={cx - 3} cy={cy - 4} rx="3.5" ry="6" fill="rgba(255,255,255,0.28)" />
          <Line x1={cx} y1={cy - 18} x2={cx} y2={cy - 30} stroke="#C9A227" strokeWidth="1.5" />
        </G>
      ))}
      <Path d="M40 152 Q24 120 50 100 Q86 80 124 92 Q92 96 70 112 Q50 126 56 150Z" fill="url(#store-harv-blade)" />
      <Path d="M50 144 Q40 122 58 108" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M40 152 L26 168" stroke="#6D4C41" strokeWidth="11" strokeLinecap="round" />
    </Svg>
  );
}

// AQUACULTURE & FISHERIES — fish in water (deep ocean blue)
function FishIcon({ size, parts }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-fish-body" light="#4FC3F7" base="#0288D1" dark="#01579B" />
        <Body3D id="store-fish-bubble" light="#E1F5FE" base="#81D4FA" dark="#29B6F6" />
      </Defs>
      <Shadow rx={50} />
      {/* Water surface arcs */}
      <Path d="M30 60 Q50 50 70 60 Q90 70 110 60 Q130 50 150 60 Q160 64 170 60" stroke="rgba(2,136,209,0.3)" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* Fish body */}
      <Path d="M48 108 Q70 70 116 74 Q150 78 162 108 Q150 138 116 142 Q70 146 48 108Z" fill="url(#store-fish-body)" />
      {/* Tail */}
      <Path d="M48 108 Q28 86 22 70 Q42 84 54 96 M48 108 Q28 130 22 146 Q42 132 54 120Z" fill="#0277BD" />
      {/* Top fin */}
      <Path d="M104 74 Q110 54 128 50 Q124 64 120 76Z" fill="#0277BD" />
      {/* Eye */}
      <Circle cx="140" cy="100" r="8" fill="#FFFFFF" />
      <Circle cx="142" cy="100" r="4" fill="#01579B" />
      {/* Gill + scales shine */}
      <Path d="M124 82 Q118 108 124 134" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" fill="none" />
      <Ellipse cx="92" cy="94" rx="14" ry="8" fill="rgba(255,255,255,0.25)" />
      {/* Rising bubbles */}
      <Faller x={158} fromY={92}  toY={50} rx={4}   ry={4}   fill="url(#store-fish-bubble)" dur={1400} delay={0}   on={parts} />
      <Faller x={166} fromY={84}  toY={44} rx={3}   ry={3}   fill="url(#store-fish-bubble)" dur={1600} delay={500} on={parts} />
      {!parts && <Circle cx="160" cy="74" r="4" fill="url(#store-fish-bubble)" />}
    </Svg>
  );
}

// HORTICULTURE & NURSERY — a blooming flower in a pot (deep rose/pink)
function NurseryIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="store-nur-flower" light="#F48FB1" base="#E91E63" dark="#AD1457" />
        <Body3D id="store-nur-center" light="#FFE082" base="#FFC107" dark="#F57F17" />
        <Body3DLinear id="store-nur-pot" light="#FFAB91" base="#E0644A" dark="#A03A28" />
        <Body3DLinear id="store-nur-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={48} />
      {/* Pot */}
      <Path d="M64 130 L136 130 L128 166 Q126 170 120 170 L80 170 Q74 170 72 166 Z" fill="url(#store-nur-pot)" />
      <Rect x="58" y="122" width="84" height="14" rx="6" fill="#C84A30" />
      {/* Stem + leaves */}
      <Path d="M100 130 Q100 104 100 86" stroke="url(#store-nur-leaf)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <Path d="M100 116 Q80 110 70 96 Q90 94 100 112Z" fill="url(#store-nur-leaf)" />
      <Path d="M100 110 Q120 104 130 90 Q110 88 100 106Z" fill="url(#store-nur-leaf)" />
      {/* Flower petals */}
      {[0, 72, 144, 216, 288].map((deg, i) => (
        <Ellipse key={i} cx="100" cy="56" rx="13" ry="20" fill="url(#store-nur-flower)" transform={`rotate(${deg},100,72)`} />
      ))}
      {/* Center */}
      <Circle cx="100" cy="72" r="13" fill="url(#store-nur-center)" />
      <Circle cx="96" cy="68" r="3.5" fill="rgba(255,255,255,0.5)" />
    </Svg>
  );
}

// HOME & KITCHEN GARDEN — woven basket of fresh produce (forest green) · also nice default-ish
function KitchenGardenIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-kg-basket" light="#C49656" base="#A4763C" dark="#71511F" />
        <Body3D id="store-kg-tom" light="#FF8A80" base="#E53935" dark="#B71C1C" />
        <Body3D id="store-kg-leafy" light="#A3E635" base="#43A047" dark="#1B5E20" />
        <Body3D id="store-kg-carrot" light="#FFB74D" base="#FB8C00" dark="#E65100" />
      </Defs>
      <Shadow rx={54} />
      {/* Produce poking out */}
      <Circle cx="78" cy="106" r="16" fill="url(#store-kg-tom)" />
      <Path d="M78 92 Q82 84 90 86 Q84 92 80 94Z" fill="#2E7D32" />
      <Path d="M118 96 Q108 70 116 56 Q126 70 124 96Z" fill="url(#store-kg-leafy)" />
      <Path d="M104 100 Q98 76 106 62 Q114 78 110 100Z" fill="url(#store-kg-leafy)" />
      <Path d="M132 116 Q142 96 152 92 Q150 110 142 122Z" fill="url(#store-kg-carrot)" />
      <Path d="M150 90 Q154 80 160 80 M152 92 Q158 84 164 86" stroke="url(#store-kg-leafy)" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* Basket body */}
      <Path d="M44 112 L156 112 L144 158 Q142 164 134 164 L66 164 Q58 164 56 158 Z" fill="url(#store-kg-basket)" />
      {/* Weave lines */}
      <G stroke="rgba(0,0,0,0.14)" strokeWidth="2.5">
        <Line x1="52" y1="128" x2="148" y2="128" />
        <Line x1="55" y1="144" x2="145" y2="144" />
      </G>
      <G stroke="rgba(255,255,255,0.18)" strokeWidth="2">
        <Line x1="76" y1="114" x2="72" y2="162" />
        <Line x1="100" y1="114" x2="100" y2="162" />
        <Line x1="124" y1="114" x2="128" y2="162" />
      </G>
      {/* Rim + handle */}
      <Rect x="40" y="104" width="120" height="14" rx="7" fill="#8A5E2C" />
      <Path d="M62 108 Q100 70 138 108" stroke="#8A5E2C" strokeWidth="7" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

// DEFAULT FALLBACK — friendly colourful shopping bag with a leaf (forest green / gold)
function ShoppingBagIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="store-bag-body" light="#34D058" base="#1C8A3C" dark="#005F21" />
        <Body3DLinear id="store-bag-leaf" light="#A3E635" base="#43A047" dark="#1B5E20" />
      </Defs>
      <Shadow rx={52} />
      {/* Bag body */}
      <Path d="M50 80 L150 80 L160 156 Q161 168 148 168 L52 168 Q39 168 40 156 Z" fill="url(#store-bag-body)" />
      <Path d="M50 80 L150 80 L150 96 L50 96 Z" fill="#005F21" />
      {/* Handles */}
      <Path d="M72 84 Q72 50 100 50 Q128 50 128 84" stroke="#005F21" strokeWidth="8" strokeLinecap="round" fill="none" />
      <Path d="M72 84 Q72 52 100 52" stroke="rgba(255,255,255,0.3)" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* Gold leaf emblem */}
      <Circle cx="100" cy="128" r="26" fill="rgba(255,255,255,0.16)" />
      <Path d="M112 142 Q86 136 80 116 Q88 100 108 102 Q128 104 130 124 Q128 138 112 142Z" fill="url(#store-bag-leaf)" />
      <Path d="M112 142 Q102 122 90 104" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" fill="none" />
      {/* Shine */}
      <Path d="M56 86 Q54 124 60 160" stroke="rgba(255,255,255,0.3)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Ellipse cx="64" cy="92" rx="8" ry="4" fill="rgba(255,255,255,0.35)" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry  (canonical variant key → component)
// ─────────────────────────────────────────────────────────────────────────────
const ICONS = {
  seeds:          SeedsIcon,
  fertilizer:     FertilizerIcon,
  protection:     ProtectionIcon,
  organic:        OrganicIcon,
  growth:         GrowthIcon,
  irrigation:     IrrigationIcon,
  machinery:      MachineryIcon,
  tools:          ToolsIcon,
  polyhouse:      PolyhouseIcon,
  micronutrient:  MicronutrientIcon,
  seedtreat:      SeedTreatIcon,
  livestock:      LivestockIcon,
  fencing:        FencingIcon,
  storage:        StorageIcon,
  agritech:       AgritechIcon,
  solar:          SolarIcon,
  safety:         SafetyIcon,
  sprayer:        SprayerIcon,
  harvest:        HarvestIcon,
  fish:           FishIcon,
  nursery:        NurseryIcon,
  kitchengarden:  KitchenGardenIcon,
  bag:            ShoppingBagIcon,
};

const DEFAULT_KEY = 'bag';

// ─────────────────────────────────────────────────────────────────────────────
// Alias map — every key the consumer screen actually passes. AgriStoreHome.js
// renders `cat.icon` (the API category's Ionicon name) into the pill, so the
// seeded Ionicon names are the PRIMARY input. We also accept the full category
// name and short human keys. All lookups are lower-cased + de-punctuated below.
// ─────────────────────────────────────────────────────────────────────────────
const ALIASES = {
  // 1. Seeds & Planting Material — seed icon "leaf"
  'leaf': 'seeds',
  'seeds': 'seeds',
  'seed': 'seeds',
  'seedsandplantingmaterial': 'seeds',
  'plantingmaterial': 'seeds',
  'sprout': 'seeds',

  // 2. Fertilizers & Soil Nutrition — "flask"
  'flask': 'fertilizer',
  'fertilizer': 'fertilizer',
  'fertilizers': 'fertilizer',
  'fertiliser': 'fertilizer',
  'fertilizersandsoilnutrition': 'fertilizer',
  'soilnutrition': 'fertilizer',
  'manure': 'fertilizer',

  // 3. Crop Protection — "shield-checkmark" / "shield"
  'shieldcheckmark': 'protection',
  'shield': 'protection',
  'cropprotection': 'protection',
  'protection': 'protection',
  'pesticide': 'protection',
  'pesticides': 'protection',
  'insecticide': 'protection',
  'fungicide': 'protection',
  'herbicide': 'protection',
  'bug': 'protection',

  // 4. Organic & Natural Farming — "flower" (seed used eco→flower)
  'flower': 'organic',
  'eco': 'organic',
  'organic': 'organic',
  'organicandnaturalfarming': 'organic',
  'naturalfarming': 'organic',

  // 5. Plant Growth Regulators — "trending-up"
  'trendingup': 'growth',
  'growth': 'growth',
  'plantgrowthregulators': 'growth',
  'growthregulators': 'growth',
  'pgr': 'growth',
  'regulator': 'growth',

  // 6. Irrigation & Water Management — "water"
  'water': 'irrigation',
  'irrigation': 'irrigation',
  'irrigationandwatermanagement': 'irrigation',
  'watermanagement': 'irrigation',
  'drip': 'irrigation',

  // 7. Farm Machinery & Equipment — "settings"
  'settings': 'machinery',
  'cog': 'machinery',
  'car': 'machinery',
  'machinery': 'machinery',
  'machine': 'machinery',
  'farmmachineryandequipment': 'machinery',
  'equipment': 'machinery',
  'tractor': 'machinery',

  // 8. Hand Tools & Small Equipment — "construct"
  'construct': 'tools',
  'hammer': 'tools',
  'tools': 'tools',
  'tool': 'tools',
  'handtools': 'tools',
  'handtoolsandsmallequipment': 'tools',
  'khurpi': 'tools',
  'hoe': 'tools',

  // 9. Protected Cultivation — "home"
  'home': 'polyhouse',
  'business': 'polyhouse',
  'polyhouse': 'polyhouse',
  'greenhouse': 'polyhouse',
  'protectedcultivation': 'polyhouse',
  'nethouse': 'polyhouse',

  // 10. Micronutrients & Specialty Nutrition — "nutrition"
  'nutrition': 'micronutrient',
  'micronutrient': 'micronutrient',
  'micronutrients': 'micronutrient',
  'micronutrientsandspecialtynutrition': 'micronutrient',
  'specialtynutrition': 'micronutrient',

  // 11. Seeds Treatment & Additives — "color-wand"
  'colorwand': 'seedtreat',
  'colourwand': 'seedtreat',
  'wand': 'seedtreat',
  'seedtreat': 'seedtreat',
  'seedtreatment': 'seedtreat',
  'seedstreatmentandadditives': 'seedtreat',
  'additives': 'seedtreat',

  // 12. Livestock, Dairy & Poultry — "paw"
  'paw': 'livestock',
  'livestock': 'livestock',
  'livestockdairyandpoultry': 'livestock',
  'dairy': 'livestock',
  'poultry': 'livestock',
  'cattle': 'livestock',
  'cow': 'livestock',
  'animal': 'livestock',

  // 13. Fencing & Farm Protection — "git-network"
  'gitnetwork': 'fencing',
  'fencing': 'fencing',
  'fence': 'fencing',
  'fencingandfarmprotection': 'fencing',
  'farmprotection': 'fencing',

  // 14. Storage & Packaging — "archive"
  'archive': 'storage',
  'cube': 'storage',
  'storage': 'storage',
  'packaging': 'storage',
  'storageandpackaging': 'storage',
  'box': 'storage',

  // 15. Agri Technology & Smart Farming — "hardware-chip"
  'hardwarechip': 'agritech',
  'chip': 'agritech',
  'agritech': 'agritech',
  'technology': 'agritech',
  'agritechnologyandsmartfarming': 'agritech',
  'smartfarming': 'agritech',
  'iot': 'agritech',
  'drone': 'agritech',

  // 16. Solar & Energy — "sunny"
  'sunny': 'solar',
  'sun': 'solar',
  'solar': 'solar',
  'energy': 'solar',
  'solarandenergy': 'solar',
  'power': 'solar',

  // 17. Safety & Protective Gear — "medkit" (seed had warning earlier)
  'medkit': 'safety',
  'warning': 'safety',
  'safety': 'safety',
  'ppe': 'safety',
  'safetyandprotectivegear': 'safety',
  'protectivegear': 'safety',
  'mask': 'safety',
  'gloves': 'safety',

  // 18. Spraying Equipment — "cloud"
  'cloud': 'sprayer',
  'spray': 'sprayer',
  'sprayer': 'sprayer',
  'sprayers': 'sprayer',
  'sprayingequipment': 'sprayer',
  'sprayequipment': 'sprayer',
  'knapsack': 'sprayer',

  // 19. Harvesting & Post-Harvest — "cut"
  'cut': 'harvest',
  'harvest': 'harvest',
  'harvesting': 'harvest',
  'harvestingandpostharvest': 'harvest',
  'postharvest': 'harvest',
  'sickle': 'harvest',

  // 20. Aquaculture & Fisheries — "fish"
  'fish': 'fish',
  'aquaculture': 'fish',
  'fisheries': 'fish',
  'aquacultureandfisheries': 'fish',

  // 21. Horticulture & Nursery — "rose"
  'rose': 'nursery',
  'horticulture': 'nursery',
  'nursery': 'nursery',
  'horticultureandnursery': 'nursery',
  'flowers': 'nursery',

  // 22. Agri Inputs for Home & Kitchen Garden — "basket"
  'basket': 'kitchengarden',
  'kitchengarden': 'kitchengarden',
  'homegarden': 'kitchengarden',
  'agriinputsforhomeandkitchengarden': 'kitchengarden',
  'kitchen': 'kitchengarden',
  'terracegarden': 'kitchengarden',

  // generic fallbacks → shopping bag
  'all': 'bag',
  'storefront': 'bag',
  'store': 'bag',
  'cart': 'bag',
  'grid': 'bag',
  'apps': 'bag',
  'bag': 'bag',
  'book': 'bag',
};

/** Normalise an input key: lower-case, "&" → "and", strip everything but a-z0-9.
 *  Mapping "&" to "and" lets the full category names (e.g. "Hand Tools & Small
 *  Equipment" → "handtoolsandsmallequipment") hit their exact alias instead of
 *  ambiguously matching a shorter shared token. */
function normalize(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

// Alias keys sorted longest-first so the soft "contains" fallback prefers the
// most specific token (e.g. "seedtreat" beats "seeds", "kitchengarden" beats
// "home", "handtools" beats "equipment") instead of whichever was declared first.
const ALIAS_KEYS_BY_LEN = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

function resolveVariant(type) {
  const norm = normalize(type);
  if (!norm) return DEFAULT_KEY;
  if (ICONS[norm]) return norm;            // direct variant key
  if (ALIASES[norm]) return ALIASES[norm]; // exact alias (incl. Ionicon name / full category name)
  // soft keyword contains — covers translated/extended names that include a known
  // token; longest match wins so the most specific category is chosen.
  for (const k of ALIAS_KEYS_BY_LEN) {
    if (k.length >= 4 && norm.includes(k)) return ALIASES[k];
  }
  return DEFAULT_KEY;
}

/**
 * Renders the (animated) colourful SVG illustration for an AgriStore category.
 * @param {string}  type      category key — Ionicon name (cat.icon), category
 *                            name, or short key (case-insensitive); unknown → bag
 * @param {number}  size      width & height in dp (default 32)
 * @param {boolean} animated  gentle bob + subtle motion (default true). When
 *                            false a sensible static frame renders. Heavy particle
 *                            motion auto-disables below size 34 for scroll lists.
 */
export function StoreCategoryIcon({ type, size = 32, animated = true }) {
  const variant = resolveVariant(type);
  const Icon = ICONS[variant] || ICONS[DEFAULT_KEY];

  // Particles only when animated AND large enough to be worth it.
  const parts = animated && size >= PARTICLE_MIN;

  // Cheap native-driver "bob" so every icon feels alive (no React re-renders).
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const delay = (variant.charCodeAt(0) % 6) * 170;
    const a = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [animated, variant, bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] });
  const wrap = { width: size, height: size, alignItems: 'center', justifyContent: 'center' };

  return (
    <Animated.View style={[wrap, animated && { transform: [{ translateY }] }]}>
      <Icon size={size} animated={animated} parts={parts} />
    </Animated.View>
  );
}

export default StoreCategoryIcon;
