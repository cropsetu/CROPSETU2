/**
 * LabourIcon.js — a colourful, ANIMATED, pure-vector "3D-style" gradient SVG icon
 * for the Rent → LABOUR side (find workers, register as a worker, empty states).
 *
 * Draws a friendly farm worker: a turban / sun-hat, warm skin, earthy clothes, a
 * green-leaf badge on the shirt, holding a wooden spade (phawda) over a hint of
 * green field. Built to be instantly recognisable to a low-literacy Indian farmer
 * — big, warm and alive — without any Lottie file, network asset or image, only
 * react-native-svg + the Animated API (NOT reanimated).
 *
 * Animation (all GPU/JS-cheap, opt-out via `animated={false}`):
 *   • a slow native-driver "bob" of the whole icon (no React re-renders)
 *   • a couple of soft dust puffs drifting up off the spade — AUTO-DISABLED when
 *     size < 34 so the icon is safe in long scroll lists (only the cheap bob runs)
 *
 * Matches ActivityIcons.js / CropIcons.js conventions: viewBox 0 0 200 200, 3-stop
 * gradients for shading, a soft ground-shadow ellipse and a top-left shine. Every
 * gradient id is variant-prefixed because react-native-svg gradient ids are GLOBAL
 * (else two icons on one screen clash). Brand: forest green #005f21, gold #e0af3b.
 *
 * Usage:  <LabourIcon size={56} animated />
 *         <LabourIcon type="worker" size={28} animated={false} />
 */
import React, { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect,
} from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Below this size the heavy particle motion is skipped (keep only the cheap bob).
const PARTICLE_MIN = 34;

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (same recipe as ActivityIcons.js)
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

/** A soft dust puff drifting up + fading. Static dot when off. */
function DustPuff({ fromX, toX, fromY, toY, r, fill, dur, delay, on }) {
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
  if (!on) return <Circle cx={(fromX + toX) / 2} cy={(fromY + toY) / 2} r={r} fill={fill} opacity={0.5} />;
  const cx = v.interpolate({ inputRange: [0, 1], outputRange: [fromX, toX] });
  const cy = v.interpolate({ inputRange: [0, 1], outputRange: [fromY, toY] });
  const opacity = v.interpolate({ inputRange: [0, 0.2, 0.7, 1], outputRange: [0, 0.65, 0.5, 0] });
  return <AnimatedCircle cx={cx} cy={cy} r={r} fill={fill} opacity={opacity} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── WORKER ICON ──────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// WORKER — a friendly farm labourer with a turban, holding a spade over green field.
//   skin  warm brown  #C68642 / #A1672E
//   shirt forest green #005f21 (brand)
//   turban gold        #e0af3b (brand)
//   spade  wood + steel blade
function WorkerIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="labour-worker-skin"   light="#E8B884" base="#C68642" dark="#8A5524" />
        <Body3DLinear id="labour-worker-shirt"  light="#1C8A3C" base="#005F21" dark="#003D14" />
        <Body3D id="labour-worker-turban" light="#FFE082" base="#E0AF3B" dark="#A47B12" />
        <Body3DLinear id="labour-worker-shaft"  light="#C49A6C" base="#8D6E63" dark="#5D4037" />
        <Body3DLinear id="labour-worker-blade"  light="#ECEFF1" base="#B0BEC5" dark="#78909C" />
        <Body3DLinear id="labour-worker-field"  light="#9CCC65" base="#5FA025" dark="#3F6212" />
        <Body3D id="labour-worker-leaf"   light="#A3E635" base="#65A30D" dark="#3F6212" />
      </Defs>

      <Shadow rx={56} />

      {/* Green field hint behind the worker */}
      <Path d="M22 162 Q60 146 100 148 Q140 146 178 162 Q178 172 100 174 Q22 172 22 162Z" fill="url(#labour-worker-field)" />
      <Path d="M40 158 L36 144 M52 159 L50 146 M150 159 L154 146 M162 158 L166 144"
        stroke="#3F6212" strokeWidth="3" strokeLinecap="round" />
      <Path d="M34 160 Q60 150 100 152 Q140 150 166 160" stroke="rgba(255,255,255,0.18)" strokeWidth="2" fill="none" />

      {/* Spade — held to the worker's left, planted toward the field */}
      {/* shaft */}
      <Rect x="130" y="58" width="13" height="86" rx="6" fill="url(#labour-worker-shaft)" transform="rotate(14,136,100)" />
      {/* D-grip top */}
      <Path d="M120 64 Q120 46 134 46 Q148 46 148 64" stroke="#5D4037" strokeWidth="8" strokeLinecap="round" fill="none" transform="rotate(14,134,55)" />
      {/* steel blade planted in the field */}
      <Path d="M150 132 L178 138 L173 162 Q162 176 150 164 L142 142 Q142 134 150 132Z" fill="url(#labour-worker-blade)" />
      <Path d="M150 164 Q162 174 172 162" stroke="rgba(0,0,0,0.18)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <Path d="M154 140 L162 160" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" fill="none" />

      {/* Body / shirt (kurta) */}
      <Path d="M58 168 Q54 120 72 112 Q86 106 100 106 Q114 106 128 112 Q146 120 142 168 Q100 174 58 168Z" fill="url(#labour-worker-shirt)" />
      {/* collar V */}
      <Path d="M88 110 L100 126 L112 110" stroke="#003D14" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* shirt shine */}
      <Path d="M70 158 Q66 126 80 116" stroke="rgba(255,255,255,0.22)" strokeWidth="6" strokeLinecap="round" fill="none" />
      {/* green-leaf badge on the chest */}
      <Path d="M116 134 Q126 126 136 130 Q130 142 116 140Z" fill="url(#labour-worker-leaf)" />
      <Path d="M118 138 Q126 133 134 131" stroke="rgba(255,255,255,0.4)" strokeWidth="1.6" fill="none" strokeLinecap="round" />

      {/* Left arm reaching up to grip the spade shaft */}
      <Path d="M122 130 Q138 112 134 84" stroke="url(#labour-worker-shirt)" strokeWidth="15" strokeLinecap="round" fill="none" />
      {/* gripping hand */}
      <Circle cx="134" cy="78" r="11" fill="url(#labour-worker-skin)" />
      <Path d="M127 74 Q134 70 141 74" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" fill="none" />

      {/* Right arm resting down */}
      <Path d="M70 130 Q56 146 62 162" stroke="url(#labour-worker-shirt)" strokeWidth="15" strokeLinecap="round" fill="none" />
      <Circle cx="62" cy="164" r="10" fill="url(#labour-worker-skin)" />

      {/* Neck */}
      <Rect x="92" y="92" width="16" height="20" rx="7" fill="url(#labour-worker-skin)" />

      {/* Head — warm skin */}
      <Circle cx="100" cy="74" r="28" fill="url(#labour-worker-skin)" />
      {/* cheek shine */}
      <Ellipse cx="88" cy="66" rx="8" ry="10" fill="rgba(255,255,255,0.2)" />
      {/* ears */}
      <Circle cx="73" cy="76" r="6" fill="url(#labour-worker-skin)" />
      <Circle cx="127" cy="76" r="6" fill="url(#labour-worker-skin)" />

      {/* Friendly face */}
      <Circle cx="90" cy="74" r="3.6" fill="#3E2723" />
      <Circle cx="110" cy="74" r="3.6" fill="#3E2723" />
      <Circle cx="89" cy="72.5" r="1.2" fill="rgba(255,255,255,0.8)" />
      <Circle cx="109" cy="72.5" r="1.2" fill="rgba(255,255,255,0.8)" />
      <Path d="M86 66 Q90 62 95 65" stroke="#5D4037" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <Path d="M105 65 Q110 62 114 66" stroke="#5D4037" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* warm smile */}
      <Path d="M88 84 Q100 94 112 84" stroke="#7A3B1E" strokeWidth="3.2" strokeLinecap="round" fill="none" />
      {/* rosy cheeks */}
      <Circle cx="82" cy="82" r="4.5" fill="rgba(214,93,49,0.28)" />
      <Circle cx="118" cy="82" r="4.5" fill="rgba(214,93,49,0.28)" />

      {/* Turban / sun-hat (gold, brand colour) */}
      <Path d="M70 60 Q72 30 100 28 Q128 30 130 60 Q116 50 100 50 Q84 50 70 60Z" fill="url(#labour-worker-turban)" />
      {/* turban wrap folds */}
      <Path d="M74 54 Q100 40 126 54" stroke="#A47B12" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Path d="M78 46 Q100 35 122 46" stroke="rgba(255,255,255,0.45)" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* little knotted tip */}
      <Circle cx="100" cy="29" r="5" fill="url(#labour-worker-turban)" />
      <Circle cx="97" cy="27" r="1.8" fill="rgba(255,255,255,0.5)" />

      {/* Soft dust puffs drifting up off the planted spade (auto-disabled < 34) */}
      <DustPuff fromX={158} toX={170} fromY={150} toY={124} r={5}   fill="#D7CCC8" dur={1500} delay={0}   on={particles} />
      <DustPuff fromX={150} toX={138} fromY={152} toY={128} r={4.2} fill="#E0D6CF" dur={1700} delay={520} on={particles} />
      <DustPuff fromX={164} toX={176} fromY={148} toY={130} r={3.4} fill="#EFEAE6" dur={1400} delay={960} on={particles} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry + alias map + fallback (for consistency with the other icon files).
// A single great worker icon is the goal; the registry keeps the same API shape.
// ─────────────────────────────────────────────────────────────────────────────
const ICONS = {
  WORKER: WorkerIcon,
};

// Alias map — input keys the consumer screen(s) actually pass → canonical key.
// RentHome's labour side talks about "workers", "labour", "find/list yourself".
const ALIASES = {
  WORKER:   'WORKER',
  WORKERS:  'WORKER',
  LABOUR:   'WORKER',
  LABOR:    'WORKER',
  LABOURER: 'WORKER',
  LABORER:  'WORKER',
  PERSON:   'WORKER',
  FARMER:   'WORKER',
  HELP:     'WORKER',
};

const DEFAULT_KEY = 'WORKER';

/**
 * Renders the (animated) SVG illustration for a farm-labour icon.
 * @param {string}  type      labour key (case-insensitive); unknown → WORKER
 * @param {number}  size      width & height in dp (default 56)
 * @param {boolean} animated  gentle bob (+ dust puffs ≥34) (default true)
 */
export function LabourIcon({ type = 'worker', size = 56, animated = true }) {
  const raw = String(type || '').trim().toUpperCase();
  const key = ALIASES[raw] || (ICONS[raw] ? raw : DEFAULT_KEY);
  const Icon = ICONS[key] || ICONS[DEFAULT_KEY];

  // Cheap native-driver "bob" so the worker feels alive (no React re-renders).
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
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

export default LabourIcon;
