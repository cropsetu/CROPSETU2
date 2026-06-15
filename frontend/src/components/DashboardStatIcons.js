/**
 * DashboardStatIcons.js — light, ANIMATED, pure-vector "3D-style" gradient SVG icons for
 * the SELLER DASHBOARD (stat cards + quick actions). Built for low-literacy Indian
 * farmer-sellers: every icon is an instantly recognisable real-world object, big and
 * colourful, alive without any Lottie file, network asset or image — only
 * react-native-svg + the React-Native Animated API (NOT reanimated).
 *
 * Matches ActivityIcons.js / CropIcons.js conventions exactly:
 *   • viewBox="0 0 200 200", width/height = size
 *   • a soft ground-shadow <Ellipse cy≈178>
 *   • a top-left white shine highlight
 *   • 3-stop light/base/dark gradients for a 3D feel, full saturated real colours
 *   • EVERY gradient id is variant-prefixed (react-native-svg gradient ids are GLOBAL,
 *     so two icons on one screen would clash otherwise — the #1 bug to avoid).
 *
 * Animation (cheap, opt-out via `animated={false}`):
 *   • every icon gets a slow native-driver "bob"/pulse (no React re-renders)
 *   • a few variants add a cheap looping accent (revenue coin shimmer, reviews sparkle,
 *     reports bar grow, settings gear turn) — these heavier accents AUTO-DISABLE under
 *     size 34 so the component is safe in long scroll lists.
 *
 * Variants:
 *   STAT CARDS    → orders · revenue · products · reviews
 *   QUICK ACTIONS → addProduct · viewOrders · reports · settings
 *   DEFAULT       → card (neutral box) for any unknown key
 *
 * Usage:  <DashboardStatIcon type="orders" size={30} />
 */
import React, { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect, G, Line, Polygon,
} from 'react-native-svg';

const AnimatedG       = Animated.createAnimatedComponent(G);
const AnimatedCircle  = Animated.createAnimatedComponent(Circle);
const AnimatedRect    = Animated.createAnimatedComponent(Rect);

// Particle / heavy-accent animations auto-disable below this size (scroll-list safe).
const PARTICLE_MIN = 34;

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
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

/** A self-looping pulsing sparkle (twinkle). Static dot when off. */
function Sparkle({ x, y, r, fill, dur, delay, on }) {
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
  if (!on) return <Circle cx={x} cy={y} r={r} fill={fill} />;
  const scale   = v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.25] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  return (
    <AnimatedCircle
      cx={x} cy={y} r={r} fill={fill}
      opacity={opacity}
      // native-driver-safe transform-origin via translate trick
      style={{ transform: [{ translateX: x }, { translateY: y }, { scale }, { translateX: -x }, { translateY: -y }] }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── STAT-CARD ICONS ──────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// ORDERS — a paper order-slip / receipt with a torn bottom (paper white, ink blue accent)
function OrdersIcon() {
  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3DLinear id="dash-orders-paper" light="#FFFFFF" base="#F4F6FB" dark="#D6DCE8" />
        <Body3D       id="dash-orders-seal"  light="#4FC3F7" base="#1E88E5" dark="#1565C0" />
      </Defs>
      <Shadow rx={46} />
      {/* Receipt body with a zig-zag torn bottom */}
      <Path d="M58 40 Q58 32 66 32 L134 32 Q142 32 142 40
               L142 150 L132 142 L122 150 L112 142 L100 150
               L88 142 L78 150 L68 142 L58 150 Z"
            fill="url(#dash-orders-paper)" />
      {/* Left edge soft shadow for 3D lift */}
      <Path d="M58 40 Q58 32 66 32 L72 32 L72 150 L68 142 L58 150 Z" fill="rgba(0,0,0,0.05)" />
      {/* Printed text lines */}
      <Rect x="70" y="52" width="60" height="6" rx="3" fill="#9AA6BC" />
      <Rect x="70" y="68" width="44" height="5" rx="2.5" fill="#C2CADB" />
      <Rect x="70" y="80" width="52" height="5" rx="2.5" fill="#C2CADB" />
      <Rect x="70" y="98" width="60" height="5" rx="2.5" fill="#C2CADB" />
      <Rect x="70" y="110" width="36" height="5" rx="2.5" fill="#C2CADB" />
      {/* Stamped blue check seal (order confirmed) */}
      <Circle cx="120" cy="120" r="20" fill="url(#dash-orders-seal)" />
      <Circle cx="120" cy="120" r="20" fill="rgba(255,255,255,0.08)" />
      <Path d="M111 121 L117 128 L130 112" stroke="#FFFFFF" strokeWidth="5"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Top-left paper shine */}
      <Path d="M66 40 L66 96" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

// REVENUE — a stack of golden rupee coins (gold #E0AF3B) · optional top-coin shimmer
function RevenueIcon({ animated, particles }) {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(shimmer, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(shimmer, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, shimmer]);
  const shineX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [78, 122] });

  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3D id="dash-rev-coin" light="#FFE082" base="#E0AF3B" dark="#A47B12" />
      </Defs>
      <Shadow rx={50} />
      {/* Coin stack (bottom → up) */}
      <Ellipse cx="100" cy="152" rx="48" ry="15" fill="#A47B12" />
      <Ellipse cx="100" cy="142" rx="48" ry="15" fill="url(#dash-rev-coin)" />
      <Ellipse cx="100" cy="132" rx="48" ry="15" fill="#C9971F" />
      <Ellipse cx="100" cy="122" rx="48" ry="15" fill="url(#dash-rev-coin)" />
      <Ellipse cx="100" cy="112" rx="48" ry="15" fill="#C9971F" />
      {/* Top hero coin (face-on) */}
      <Circle cx="100" cy="86" r="44" fill="url(#dash-rev-coin)" />
      <Circle cx="100" cy="86" r="44" fill="rgba(0,0,0,0.04)" />
      <Circle cx="100" cy="86" r="36" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" />
      {/* ₹ rupee symbol */}
      <Path d="M86 68 L116 68 M86 80 L116 80 M86 68 Q108 68 104 86 Q100 100 86 100 L112 120"
            stroke="#7A5A0E" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Moving shine on the hero coin (animated, particles only) */}
      {particles
        ? <AnimatedCircle cx={shineX} cy="70" r="7" fill="rgba(255,255,255,0.45)" />
        : <Circle cx="84" cy="70" r="7" fill="rgba(255,255,255,0.4)" />}
    </Svg>
  );
}

// PRODUCTS — a sealed cardboard package box with tape (kraft brown)
function ProductsIcon() {
  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3DLinear id="dash-prod-front" light="#D7A66B" base="#B07C40" dark="#8A5A26" />
        <Body3DLinear id="dash-prod-side"  light="#B98A52" base="#946133" dark="#6E461F" />
        <Body3DLinear id="dash-prod-lidL"  light="#E2B981" base="#C29155" dark="#A1713A" />
        <Body3DLinear id="dash-prod-lidR"  light="#CF9F62" base="#A97A42" dark="#855B2C" />
      </Defs>
      <Shadow rx={52} />
      {/* Open top flaps */}
      <Path d="M52 76 L100 96 L100 60 L60 44 Z" fill="url(#dash-prod-lidL)" />
      <Path d="M148 76 L100 96 L100 60 L140 44 Z" fill="url(#dash-prod-lidR)" />
      {/* Box front face */}
      <Path d="M52 76 L100 96 L100 162 L52 142 Z" fill="url(#dash-prod-side)" />
      <Path d="M148 76 L100 96 L100 162 L148 142 Z" fill="url(#dash-prod-front)" />
      {/* Packing tape down the middle of the front */}
      <Path d="M100 96 L100 162" stroke="#E7C99A" strokeWidth="9" strokeLinecap="butt" opacity="0.85" />
      <Path d="M100 96 L100 162" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
      {/* Tape across the open seam */}
      <Path d="M64 70 L100 86 L136 70" stroke="#E7C99A" strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.85" />
      {/* Shipping label on the right face */}
      <Path d="M112 110 L134 119 L134 137 L112 128 Z" fill="rgba(255,255,255,0.9)" />
      <Path d="M116 118 L130 124 M116 124 L128 129" stroke="#946133" strokeWidth="2" strokeLinecap="round" />
      {/* Edge highlights for 3D */}
      <Path d="M100 96 L100 162" stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
      <Path d="M52 76 L100 96" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
    </Svg>
  );
}

// REVIEWS — a glossy gold 5-point star with twinkling sparkles (rating gold)
function ReviewsIcon({ particles }) {
  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3D id="dash-rev-star" light="#FFE57F" base="#E0AF3B" dark="#B07F12" />
      </Defs>
      <Shadow rx={48} />
      {/* Soft halo */}
      <Circle cx="100" cy="100" r="62" fill="rgba(224,175,59,0.16)" />
      {/* Hero star */}
      <Polygon points="100,38 119,82 167,86 130,117 142,164 100,138 58,164 70,117 33,86 81,82"
               fill="url(#dash-rev-star)" />
      {/* Inner shine + facet */}
      <Path d="M100 52 L112 84" stroke="rgba(255,255,255,0.55)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Circle cx="86" cy="92" r="5" fill="rgba(255,255,255,0.35)" />
      <Path d="M100 138 L100 100" stroke="rgba(0,0,0,0.07)" strokeWidth="3" strokeLinecap="round" />
      {/* Twinkling sparkles */}
      <Sparkle x={154} y={60}  r={4}   fill="#FFF3C4" dur={900}  delay={0}   on={particles} />
      <Sparkle x={44}  y={128} r={3.4} fill="#FFF3C4" dur={1050} delay={350} on={particles} />
      <Sparkle x={158} y={128} r={3}   fill="#FFE082" dur={1000} delay={680} on={particles} />
      {/* Plus-shaped sparkle accents (static, cheap) */}
      <Path d="M150 56 L158 56 M154 52 L154 60" stroke="#FFF3C4" strokeWidth="2.6" strokeLinecap="round" />
      <Path d="M46 124 L54 124 M50 120 L50 128" stroke="#FFE082" strokeWidth="2.4" strokeLinecap="round" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── QUICK-ACTION ICONS ───────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// ADD PRODUCT — cardboard box with a bright green "+" badge (forest green #005f21)
function AddProductIcon() {
  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3DLinear id="dash-add-front" light="#D7A66B" base="#B07C40" dark="#8A5A26" />
        <Body3DLinear id="dash-add-side"  light="#B98A52" base="#946133" dark="#6E461F" />
        <Body3DLinear id="dash-add-lidL"  light="#E2B981" base="#C29155" dark="#A1713A" />
        <Body3DLinear id="dash-add-lidR"  light="#CF9F62" base="#A97A42" dark="#855B2C" />
        <Body3D       id="dash-add-badge" light="#34D058" base="#1C8A3C" dark="#005f21" />
      </Defs>
      <Shadow rx={52} />
      {/* Box flaps */}
      <Path d="M44 84 L88 102 L88 70 L52 56 Z" fill="url(#dash-add-lidL)" />
      <Path d="M132 84 L88 102 L88 70 L124 56 Z" fill="url(#dash-add-lidR)" />
      {/* Box body */}
      <Path d="M44 84 L88 102 L88 160 L44 142 Z" fill="url(#dash-add-side)" />
      <Path d="M132 84 L88 102 L88 160 L132 142 Z" fill="url(#dash-add-front)" />
      {/* Tape */}
      <Path d="M88 102 L88 160" stroke="#E7C99A" strokeWidth="8" opacity="0.85" />
      <Path d="M56 78 L88 92 L120 78" stroke="#E7C99A" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.85" />
      <Path d="M44 84 L88 102" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
      {/* Green "add" badge (top-right) */}
      <Circle cx="146" cy="58" r="30" fill="url(#dash-add-badge)" />
      <Circle cx="146" cy="58" r="30" fill="rgba(255,255,255,0.08)" />
      <Path d="M146 44 L146 72 M132 58 L160 58" stroke="#FFFFFF" strokeWidth="7"
            strokeLinecap="round" fill="none" />
      <Path d="M134 50 Q138 44 146 44" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

// VIEW ORDERS — an order slip with an eye / list (paper + teal). Distinct from "orders".
function ViewOrdersIcon() {
  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3DLinear id="dash-vo-paper" light="#FFFFFF" base="#F4F6FB" dark="#D6DCE8" />
        <Body3D       id="dash-vo-clip"  light="#80CBC4" base="#00897B" dark="#00564D" />
      </Defs>
      <Shadow rx={48} />
      {/* Clipboard back */}
      <Rect x="50" y="44" width="100" height="120" rx="12" fill="url(#dash-vo-clip)" />
      {/* Paper sheet */}
      <Rect x="60" y="58" width="80" height="100" rx="6" fill="url(#dash-vo-paper)" />
      <Path d="M66 64 L66 150" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Clip at top */}
      <Rect x="84" y="34" width="32" height="20" rx="6" fill="#00564D" />
      <Rect x="90" y="30" width="20" height="10" rx="5" fill="#00897B" />
      {/* List rows with check bullets */}
      {[78, 98, 118].map((y, i) => (
        <G key={i}>
          <Circle cx="76" cy={y} r="5" fill="#00897B" />
          <Path d={`M73 ${y} L75.5 ${y + 2.5} L80 ${y - 3}`} stroke="#FFFFFF" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Rect x="90" y={y - 3} width={i === 1 ? 36 : 44} height="6" rx="3" fill="#C2CADB" />
        </G>
      ))}
    </Svg>
  );
}

// REPORTS — colourful 3D bar chart with a rising trend line (analytics)
function ReportsIcon({ particles }) {
  // Bars grow on loop (scaleY from baseline) when particles enabled.
  const grow = useRef(new Animated.Value(particles ? 0 : 1)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(grow, { toValue: 1, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(grow, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, grow]);

  // Each bar scales up from its own bottom (baseline y=150).
  const bar = (h) => {
    const baseY = 150;
    const top = baseY - h;
    if (!particles) return { y: top, height: h };
    const scaleY = grow;
    const translateY = grow.interpolate({ inputRange: [0, 1], outputRange: [h, 0] });
    return { animatedStyle: { transform: [{ translateY }, { scaleY }] }, baseProps: { y: top, height: h } };
  };

  const b1 = bar(46);  // short
  const b2 = bar(74);  // tall
  const b3 = bar(58);  // mid

  const BarRect = ({ x, w, fillId, cfg }) => {
    if (!particles) return <Rect x={x} y={cfg.y} width={w} height={cfg.height} rx="4" fill={fillId} />;
    // anchor scale to the bar's own bottom via translate trick
    const { baseProps } = cfg;
    const bottom = baseProps.y + baseProps.height;
    return (
      <AnimatedRect
        x={x} y={baseProps.y} width={w} height={baseProps.height} rx="4" fill={fillId}
        style={{ transform: [{ translateY: bottom }, ...cfg.animatedStyle.transform, { translateY: -bottom }] }}
      />
    );
  };

  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3DLinear id="dash-rep-b1" light="#A3E635" base="#65A30D" dark="#3F6212" />
        <Body3DLinear id="dash-rep-b2" light="#4FC3F7" base="#1E88E5" dark="#1565C0" />
        <Body3DLinear id="dash-rep-b3" light="#FFE082" base="#E0AF3B" dark="#A47B12" />
      </Defs>
      <Shadow rx={52} />
      {/* Axis */}
      <Path d="M44 48 L44 152 L160 152" stroke="#9AA6BC" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Bars */}
      <BarRect x={58}  w={26} fillId="url(#dash-rep-b1)" cfg={b1} />
      <BarRect x={92}  w={26} fillId="url(#dash-rep-b2)" cfg={b2} />
      <BarRect x={126} w={26} fillId="url(#dash-rep-b3)" cfg={b3} />
      {/* Bar shines */}
      <Rect x={62}  y={108} width="5" height="38" rx="2.5" fill="rgba(255,255,255,0.3)" />
      <Rect x={96}  y={80}  width="5" height="64" rx="2.5" fill="rgba(255,255,255,0.3)" />
      <Rect x={130} y={96}  width="5" height="48" rx="2.5" fill="rgba(255,255,255,0.3)" />
      {/* Rising trend line + arrow head */}
      <Path d="M58 116 L96 84 L130 96 L160 60" stroke="#005f21" strokeWidth="4"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M148 58 L162 58 L162 72" stroke="#005f21" strokeWidth="4"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx="96" cy="84" r="4" fill="#005f21" />
      <Circle cx="130" cy="96" r="4" fill="#005f21" />
    </Svg>
  );
}

// SETTINGS — a slowly turning steel gear with a teal hub (mechanical grey + teal)
function SettingsIcon({ particles }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true })
    );
    a.start();
    return () => a.stop();
  }, [particles, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // 8-tooth gear ring drawn around centre (100,100).
  const teeth = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i * 45) * Math.PI / 180;
    const cx = 100 + Math.cos(ang) * 58;
    const cy = 100 + Math.sin(ang) * 58;
    teeth.push(
      <Rect key={i} x={cx - 11} y={cy - 11} width="22" height="22" rx="4"
            fill="url(#dash-set-tooth)"
            transform={`rotate(${i * 45},${cx},${cy})`} />
    );
  }

  const Gear = (
    <G>
      {teeth}
      <Circle cx="100" cy="100" r="46" fill="url(#dash-set-ring)" />
      <Circle cx="100" cy="100" r="46" fill="rgba(255,255,255,0.06)" />
      <Circle cx="100" cy="100" r="24" fill="url(#dash-set-hub)" />
      <Circle cx="100" cy="100" r="24" fill="rgba(0,0,0,0.06)" />
      <Circle cx="100" cy="100" r="11" fill="#F4F6FB" />
      {/* shine */}
      <Path d="M76 84 Q82 72 96 70" stroke="rgba(255,255,255,0.45)" strokeWidth="4" strokeLinecap="round" fill="none" />
    </G>
  );

  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3D id="dash-set-ring"  light="#ECEFF1" base="#B0BEC5" dark="#78909C" />
        <Body3D id="dash-set-tooth" light="#CFD8DC" base="#90A4AE" dark="#607D8B" />
        <Body3D id="dash-set-hub"   light="#4DB6AC" base="#00897B" dark="#00564D" />
      </Defs>
      <Shadow rx={54} />
      {particles
        ? <AnimatedG style={{ transform: [{ translateX: 100 }, { translateY: 100 }, { rotate }, { translateX: -100 }, { translateY: -100 }] }}>{Gear}</AnimatedG>
        : Gear}
    </Svg>
  );
}

// DEFAULT — a neutral generic card / box (forest-green tinted) · fallback
function CardIcon() {
  return (
    <Svg viewBox="0 0 200 200" width="100%" height="100%">
      <Defs>
        <Body3DLinear id="dash-card-body" light="#7CE49A" base="#1C8A3C" dark="#005f21" />
      </Defs>
      <Shadow rx={50} />
      <Rect x="40" y="56" width="120" height="92" rx="16" fill="url(#dash-card-body)" />
      <Rect x="40" y="56" width="120" height="30" rx="14" fill="rgba(0,0,0,0.08)" />
      <Rect x="56" y="100" width="64" height="8" rx="4" fill="rgba(255,255,255,0.85)" />
      <Rect x="56" y="118" width="44" height="7" rx="3.5" fill="rgba(255,255,255,0.55)" />
      <Circle cx="138" cy="120" r="10" fill="rgba(255,255,255,0.9)" />
      <Path d="M134 120 L137 123 L143 116" stroke="#1C8A3C" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Rect x="54" y="66" width="14" height="10" rx="4" fill="rgba(255,255,255,0.25)" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry + alias map
// ─────────────────────────────────────────────────────────────────────────────
const ICONS = {
  ORDERS:     OrdersIcon,
  REVENUE:    RevenueIcon,
  PRODUCTS:   ProductsIcon,
  REVIEWS:    ReviewsIcon,
  ADDPRODUCT: AddProductIcon,
  VIEWORDERS: ViewOrdersIcon,
  REPORTS:    ReportsIcon,
  SETTINGS:   SettingsIcon,
  CARD:       CardIcon,
};

// Maps the many keys/labels a consumer screen might pass → a canonical registry key.
// (DashboardScreen.js metrics + quick actions + their Ionicons names + common synonyms.)
const ALIASES = {
  // ── stat: orders ─────────────────────────────────────────────
  ORDERS: 'ORDERS', ORDER: 'ORDERS', TOTALORDERS: 'ORDERS', TOTALSOLD: 'ORDERS',
  UNITSSOLD: 'ORDERS', SOLD: 'ORDERS', SALES: 'ORDERS', RECEIPT: 'ORDERS',
  'CART-OUTLINE': 'ORDERS', CART: 'ORDERS', SLIP: 'ORDERS',
  // ── stat: revenue ────────────────────────────────────────────
  REVENUE: 'REVENUE', TOTALREVENUE: 'REVENUE', EARNINGS: 'REVENUE', INCOME: 'REVENUE',
  MONEY: 'REVENUE', RUPEE: 'REVENUE', CASH: 'REVENUE', 'CASH-OUTLINE': 'REVENUE',
  COINS: 'REVENUE', COIN: 'REVENUE',
  // ── stat: products ───────────────────────────────────────────
  PRODUCTS: 'PRODUCTS', PRODUCT: 'PRODUCTS', TOTALPRODUCTS: 'PRODUCTS',
  ACTIVEPRODUCTS: 'PRODUCTS', MYPRODUCTS: 'PRODUCTS', LISTINGS: 'PRODUCTS',
  STOCK: 'PRODUCTS', INVENTORY: 'PRODUCTS', BOX: 'PRODUCTS', PACKAGE: 'PRODUCTS',
  STOREFRONT: 'PRODUCTS', 'STOREFRONT-OUTLINE': 'PRODUCTS',
  // ── stat: reviews / rating ───────────────────────────────────
  REVIEWS: 'REVIEWS', REVIEW: 'REVIEWS', RATING: 'REVIEWS', RATINGS: 'REVIEWS',
  STAR: 'REVIEWS', STARS: 'REVIEWS', FEEDBACK: 'REVIEWS',
  // ── quick action: add product ────────────────────────────────
  ADDPRODUCT: 'ADDPRODUCT', ADD: 'ADDPRODUCT', NEWPRODUCT: 'ADDPRODUCT',
  'ADD-CIRCLE': 'ADDPRODUCT', 'ADD-CIRCLE-OUTLINE': 'ADDPRODUCT', PLUS: 'ADDPRODUCT',
  ADDLISTING: 'ADDPRODUCT',
  // ── quick action: view orders ────────────────────────────────
  VIEWORDERS: 'VIEWORDERS', SELLERORDERS: 'VIEWORDERS', MYORDERS: 'VIEWORDERS',
  CLIPBOARD: 'VIEWORDERS', LIST: 'VIEWORDERS', 'LIST-OUTLINE': 'VIEWORDERS',
  // ── quick action: reports ────────────────────────────────────
  REPORTS: 'REPORTS', REPORT: 'REPORTS', ANALYTICS: 'REPORTS', STATS: 'REPORTS',
  PERFORMANCE: 'REPORTS', CHART: 'REPORTS', BARCHART: 'REPORTS', INSIGHTS: 'REPORTS',
  TRENDS: 'REPORTS', 'BAR-CHART': 'REPORTS', 'STATS-CHART': 'REPORTS',
  // ── quick action: settings / profile ─────────────────────────
  SETTINGS: 'SETTINGS', SETTING: 'SETTINGS', GEAR: 'SETTINGS', COG: 'SETTINGS',
  PROFILE: 'SETTINGS', SELLERPROFILE: 'SETTINGS', PERSON: 'SETTINGS',
  'PERSON-OUTLINE': 'SETTINGS', ACCOUNT: 'SETTINGS', PREFERENCES: 'SETTINGS',
  // ── default ──────────────────────────────────────────────────
  CARD: 'CARD', DEFAULT: 'CARD', OTHER: 'CARD', NONE: 'CARD',
};

function resolveKey(type) {
  const raw = String(type || '').trim();
  if (!raw) return 'CARD';
  const norm = raw.toUpperCase();
  if (ALIASES[norm]) return ALIASES[norm];
  // strip a trailing "-outline"/"_outline" and retry
  const stripped = norm.replace(/[-_]OUTLINE$/, '');
  if (ALIASES[stripped]) return ALIASES[stripped];
  if (ICONS[norm]) return norm;
  return 'CARD';
}

/**
 * Renders the (animated) colourful 3D SVG icon for a seller-dashboard metric or action.
 * @param {string}  type      variant key (case-insensitive; many aliases) — unknown → CARD
 * @param {number}  size      width & height in dp (default 32)
 * @param {boolean} animated  gentle native-driver bob/pulse + per-icon accent (default true)
 */
export function DashboardStatIcon({ type, size = 32, animated = true }) {
  const key  = resolveKey(type);
  const Icon = ICONS[key] || CardIcon;

  // Heavy per-icon accents (coin shimmer, sparkle, bar grow, gear spin) only when the
  // icon is reasonably large — keeps long scroll lists cheap.
  const particles = animated && size >= PARTICLE_MIN;

  // Cheap native-driver "bob"/"pulse" so every icon feels alive (no React re-renders).
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const delay = ((key.charCodeAt(0) || 0) % 6) * 160;
    const a = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [animated, key, bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] });
  const scale      = bob.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const wrap = { width: size, height: size, alignItems: 'center', justifyContent: 'center' };

  return (
    <Animated.View style={[wrap, animated && { transform: [{ translateY }, { scale }] }]}>
      <Icon animated={animated} particles={particles} />
    </Animated.View>
  );
}

export default DashboardStatIcon;
