/**
 * ActivityIcons.js — light, ANIMATED, pure-vector "3D-style" gradient SVG icons for
 * farm ACTIVITY types. Designed to be instantly recognizable to a low-literacy Indian
 * farmer (clear real-world objects, big and colourful) and to feel alive without any
 * Lottie file, network asset or image — only react-native-svg + the Animated API.
 *
 * Animation (all GPU/JS-cheap, opt-out via `animated={false}`):
 *   • every icon gets a slow, staggered "bob" (native-driver translateY — no re-renders)
 *   • IRRIGATION pours falling water drops, SPRAY drifts a mist, SOWING drops seeds
 *
 * Matches CropIcons.js conventions: viewBox 0 0 200 200, 3-stop gradients for shading,
 * a soft ground-shadow ellipse, and a top-left shine. Every gradient id is key-prefixed
 * because react-native-svg gradient ids are GLOBAL (else two icons on one screen clash).
 *
 * Usage:  <ActivityIcon type="IRRIGATION" size={56} />
 */
import React, { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect, G, Line, Polygon,
} from 'react-native-svg';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedCircle  = Animated.createAnimatedComponent(Circle);

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

/** A single self-looping falling element (water drop / seed). Static when off. */
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

// ─────────────────────────────────────────────────────────────────────────────
// ── ACTIVITY ICONS ───────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// LAND_PREP — a spade (phawda) digging a tilled soil bed (earth brown #6D4C41)
function LandPrepIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="landprep-soil" light="#A1887F" base="#6D4C41" dark="#4E342E" />
        <Body3DLinear id="landprep-blade" light="#ECEFF1" base="#B0BEC5" dark="#78909C" />
        <Body3DLinear id="landprep-shaft" light="#A1887F" base="#795548" dark="#4E342E" />
      </Defs>
      <Shadow rx={56} />
      {/* Tilled soil bed */}
      <Path d="M24 150 Q40 132 70 130 Q100 127 130 130 Q160 132 176 150 Q176 166 100 168 Q24 166 24 150Z" fill="url(#landprep-soil)" />
      <Path d="M40 146 Q70 136 100 137 Q130 136 160 146" stroke="rgba(40,24,12,0.30)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <Path d="M50 156 Q76 149 100 150 Q124 149 150 156" stroke="rgba(40,24,12,0.20)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <Path d="M44 140 Q72 132 100 133 Q128 132 156 140" stroke="rgba(255,255,255,0.14)" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Spade shaft (wood) */}
      <Rect x="94" y="40" width="14" height="74" rx="6" fill="url(#landprep-shaft)" transform="rotate(8,100,80)" />
      {/* D-grip top */}
      <Path d="M88 44 Q88 26 101 26 Q114 26 114 44" stroke="#795548" strokeWidth="9" strokeLinecap="round" fill="none" />
      {/* Spade blade (planted into the soil) */}
      <Path d="M82 104 L130 110 L124 142 Q108 160 92 144 L78 116 Q78 106 82 104Z" fill="url(#landprep-blade)" />
      {/* Blade edge shadow + shine */}
      <Path d="M92 144 Q108 158 122 142" stroke="rgba(0,0,0,0.18)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <Path d="M88 112 L100 140" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* A clod of turned soil on the blade */}
      <Circle cx="112" cy="120" r="6" fill="url(#landprep-soil)" />
    </Svg>
  );
}

// SOWING — sprout rising from soil with falling seeds (sprout green #65A30D)
function SowingIcon({ size, animated }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="sowing-soil" light="#8D6E63" base="#6D4C41" dark="#4E342E" />
        <Body3DLinear id="sowing-leaf" light="#A3E635" base="#65A30D" dark="#3F6212" />
        <Body3D id="sowing-seed" light="#D7CCC8" base="#A1887F" dark="#6D4C41" />
      </Defs>
      <Shadow rx={54} />
      <Path d="M40 138 Q40 126 60 124 Q100 120 140 124 Q160 126 160 138 Q160 158 100 160 Q40 158 40 138Z" fill="url(#sowing-soil)" />
      <Path d="M50 134 Q100 128 150 134" stroke="rgba(255,255,255,0.12)" strokeWidth="2" fill="none" />
      <Path d="M100 138 Q100 100 100 70" stroke="url(#sowing-leaf)" strokeWidth="6" strokeLinecap="round" fill="none" />
      <Path d="M100 92 Q72 84 56 60 Q86 58 100 90Z" fill="url(#sowing-leaf)" />
      <Path d="M100 84 Q128 74 146 52 Q116 50 100 82Z" fill="url(#sowing-leaf)" />
      <Path d="M100 90 Q82 82 68 66" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* Falling seeds (animated) */}
      <Faller x={60}  fromY={70}  toY={120} rx={6.5} ry={4.5} fill="url(#sowing-seed)" dur={1100} delay={0}   on={animated} />
      <Faller x={140} fromY={64}  toY={120} rx={6.5} ry={4.5} fill="url(#sowing-seed)" dur={1200} delay={420} on={animated} />
      <Faller x={80}  fromY={60}  toY={120} rx={5.5} ry={4}   fill="url(#sowing-seed)" dur={1000} delay={760} on={animated} />
    </Svg>
  );
}

// IRRIGATION — a centered watering can pouring drops (water blue #0288D1)
function IrrigationIcon({ size, animated }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="irrigation-can" light="#4FC3F7" base="#0288D1" dark="#01579B" />
        <Body3D id="irrigation-drop" light="#81D4FA" base="#29B6F6" dark="#0277BD" />
      </Defs>
      <Shadow rx={52} />
      {/* Can body (centered) */}
      <Path d="M86 92 Q84 82 96 82 L142 82 Q152 82 150 92 L143 146 Q141 156 129 156 L100 156 Q88 156 86 146 Z" fill="url(#irrigation-can)" />
      {/* Top rim */}
      <Rect x="90" y="74" width="60" height="11" rx="5.5" fill="url(#irrigation-can)" />
      {/* Top handle */}
      <Path d="M100 80 Q122 50 144 70" stroke="#0277BD" strokeWidth="7" strokeLinecap="round" fill="none" />
      {/* Spout to the left */}
      <Path d="M86 104 Q54 104 42 84" stroke="url(#irrigation-can)" strokeWidth="12" strokeLinecap="round" fill="none" />
      {/* Rose / sprinkler head */}
      <Ellipse cx="40" cy="82" rx="12" ry="7.5" fill="#01579B" transform="rotate(-42,40,82)" />
      {/* Body shine */}
      <Ellipse cx="102" cy="100" rx="8" ry="20" fill="rgba(255,255,255,0.25)" />
      {/* Falling water drops from the rose (animated) */}
      <Faller x={34} fromY={92}  toY={158} rx={5.5} ry={7.5} fill="url(#irrigation-drop)" dur={950}  delay={0}   on={animated} />
      <Faller x={46} fromY={92}  toY={158} rx={5}   ry={7}   fill="url(#irrigation-drop)" dur={1050} delay={330} on={animated} />
      <Faller x={40} fromY={92}  toY={158} rx={4.5} ry={6.5} fill="url(#irrigation-drop)" dur={1000} delay={640} on={animated} />
    </Svg>
  );
}

// FERTILIZER — nutrient sack with granules spilling (nutrient teal #00897B)
function FertilizerIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="fertilizer-sack" light="#4DB6AC" base="#00897B" dark="#00564D" />
        <Body3D id="fertilizer-gran" light="#80CBC4" base="#26A69A" dark="#00695C" />
      </Defs>
      <Shadow rx={52} />
      <Path d="M62 70 Q60 60 72 58 L128 58 Q140 60 138 70 L146 148 Q148 162 130 164 L70 164 Q52 162 54 148 Z" fill="url(#fertilizer-sack)" />
      <Path d="M70 60 Q100 46 130 60 Q116 54 100 54 Q84 54 70 60Z" fill="#00695C" />
      <Rect x="84" y="52" width="32" height="9" rx="4.5" fill="#004D40" />
      <Rect x="78" y="92" width="44" height="34" rx="6" fill="rgba(255,255,255,0.85)" />
      <Circle cx="90" cy="109" r="4" fill="#00897B" />
      <Circle cx="100" cy="109" r="4" fill="#26A69A" />
      <Circle cx="110" cy="109" r="4" fill="#004D40" />
      <Ellipse cx="78" cy="80" rx="9" ry="16" fill="rgba(255,255,255,0.22)" />
      <Circle cx="58" cy="160" r="5" fill="url(#fertilizer-gran)" />
      <Circle cx="48" cy="166" r="4" fill="url(#fertilizer-gran)" />
      <Circle cx="64" cy="168" r="4" fill="url(#fertilizer-gran)" />
      <Circle cx="142" cy="162" r="4.5" fill="url(#fertilizer-gran)" />
      <Circle cx="152" cy="168" r="4" fill="url(#fertilizer-gran)" />
    </Svg>
  );
}

// SPRAY — sprayer bottle releasing a drifting mist (protection purple #7B1FA2)
function SprayIcon({ size, animated }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="spray-bottle" light="#BA68C8" base="#7B1FA2" dark="#4A148C" />
        <Body3D id="spray-mist" light="#CE93D8" base="#AB47BC" dark="#7B1FA2" />
      </Defs>
      <Shadow rx={48} />
      <Path d="M44 110 Q42 96 56 94 L92 94 Q104 96 102 110 L102 152 Q102 164 88 164 L58 164 Q44 164 44 152 Z" fill="url(#spray-bottle)" />
      <Rect x="62" y="80" width="26" height="18" rx="5" fill="url(#spray-bottle)" />
      <Path d="M62 80 L62 62 L100 62 Q108 62 108 70 L108 76 Z" fill="#6A1B9A" />
      <Rect x="108" y="66" width="18" height="8" rx="3" fill="#4A148C" />
      <Path d="M72 80 Q60 82 62 96" stroke="#4A148C" strokeWidth="5" strokeLinecap="round" fill="none" />
      <Ellipse cx="58" cy="116" rx="7" ry="16" fill="rgba(255,255,255,0.25)" />
      {/* Drifting mist (animated) */}
      <Mist fromX={130} toX={172} y={58} r={4}   fill="#CE93D8" dur={1100} delay={0}   on={animated} />
      <Mist fromX={130} toX={168} y={70} r={3.4} fill="#CE93D8" dur={1200} delay={300} on={animated} />
      <Mist fromX={130} toX={176} y={64} r={3}   fill="#E1BEE7" dur={1000} delay={620} on={animated} />
    </Svg>
  );
}

// SCOUT — magnifying glass inspecting a leaf (observation amber #C77700)
function ScoutIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="scout-ring" light="#FFB74D" base="#C77700" dark="#8A5300" />
        <Body3DLinear id="scout-leaf" light="#9CCC65" base="#558B2F" dark="#33691E" />
      </Defs>
      <Shadow rx={50} />
      <Path d="M118 150 Q72 140 56 96 Q70 60 108 60 Q146 64 152 104 Q150 138 118 150Z" fill="url(#scout-leaf)" />
      <Path d="M118 150 Q104 104 88 64" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" fill="none" />
      <Path d="M104 110 Q84 102 68 92" stroke="rgba(255,255,255,0.25)" strokeWidth="1.8" fill="none" />
      <Path d="M108 92 Q126 86 142 80" stroke="rgba(255,255,255,0.25)" strokeWidth="1.8" fill="none" />
      <Circle cx="86" cy="92" r="34" fill="rgba(255,255,255,0.32)" />
      <Circle cx="86" cy="92" r="34" fill="none" stroke="url(#scout-ring)" strokeWidth="9" />
      <Path d="M70 78 Q74 70 86 68" stroke="rgba(255,255,255,0.7)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M110 116 L142 150" stroke="url(#scout-ring)" strokeWidth="13" strokeLinecap="round" />
      <Path d="M112 120 L138 148" stroke="rgba(255,255,255,0.25)" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

// WEEDING — hand-held khurpi pulling a weed (weed green #558B2F)
function WeedingIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="weeding-blade" light="#ECEFF1" base="#B0BEC5" dark="#78909C" />
        <Body3DLinear id="weeding-weed" light="#9CCC65" base="#558B2F" dark="#33691E" />
        <Body3D id="weeding-soil" light="#8D6E63" base="#6D4C41" dark="#4E342E" />
      </Defs>
      <Shadow rx={52} />
      <Path d="M34 150 Q34 138 60 136 Q100 132 140 136 Q166 138 166 150 Q166 164 100 166 Q34 164 34 150Z" fill="url(#weeding-soil)" />
      <Path d="M122 138 Q124 120 130 100 Q124 110 118 124" stroke="url(#weeding-weed)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M130 100 Q140 84 152 76" stroke="url(#weeding-weed)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M130 100 Q120 86 110 78" stroke="url(#weeding-weed)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Path d="M124 138 Q122 150 116 158" stroke="#8D6E63" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M128 140 Q130 152 134 160" stroke="#8D6E63" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M44 96 Q34 110 46 130 Q66 140 86 128 Q72 108 56 96 Q50 92 44 96Z" fill="url(#weeding-blade)" />
      <Path d="M50 104 Q46 116 56 126" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M78 122 L108 156" stroke="#6D4C41" strokeWidth="12" strokeLinecap="round" />
      <Path d="M82 124 L104 152" stroke="rgba(255,255,255,0.18)" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

// PRUNING — garden secateurs snipping a branch (prune magenta #C2185B)
function PruningIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="pruning-blade" light="#F8BBD0" base="#EC407A" dark="#C2185B" />
        <Body3DLinear id="pruning-branch" light="#8D6E63" base="#6D4C41" dark="#4E342E" />
      </Defs>
      <Shadow rx={50} />
      <Path d="M30 150 Q70 132 108 118" stroke="url(#pruning-branch)" strokeWidth="9" strokeLinecap="round" fill="none" />
      <Path d="M70 134 Q60 116 48 108 Q66 112 76 128Z" fill="#7CB342" />
      <Circle cx="116" cy="106" r="9" fill="#880E4F" />
      <Circle cx="116" cy="106" r="3.5" fill="#F8BBD0" />
      <Path d="M116 106 Q150 78 178 60 Q182 68 176 74 Q146 92 122 110Z" fill="url(#pruning-blade)" />
      <Path d="M116 106 Q150 96 180 92 Q182 100 176 104 Q148 110 120 114Z" fill="#AD1457" />
      <Path d="M116 106 Q92 124 74 150" stroke="#C2185B" strokeWidth="11" strokeLinecap="round" fill="none" />
      <Path d="M116 106 Q98 132 86 160" stroke="#AD1457" strokeWidth="11" strokeLinecap="round" fill="none" />
      <Path d="M126 100 Q150 84 170 70" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

// HARVEST — sickle cutting a wheat sheaf (harvest gold #E0AF3B)
function HarvestIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="harvest-grain" light="#FFE082" base="#E0AF3B" dark="#A47B12" />
        <Body3DLinear id="harvest-blade" light="#ECEFF1" base="#CFD8DC" dark="#90A4AE" />
      </Defs>
      <Shadow rx={52} />
      {[-18, -6, 6, 18].map((dx, i) => (
        <Path key={i} d={`M${100 + dx} 160 Q${100 + dx * 0.6} 110 ${100 + dx * 0.5} 64`}
          stroke="#C9A227" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      ))}
      {[[82, 60], [100, 52], [118, 60], [91, 76], [109, 76]].map(([cx, cy], i) => (
        <G key={i}>
          <Ellipse cx={cx} cy={cy} rx="11" ry="18" fill="url(#harvest-grain)" />
          <Ellipse cx={cx - 3} cy={cy - 4} rx="3.5" ry="6" fill="rgba(255,255,255,0.28)" />
          <Line x1={cx} y1={cy - 18} x2={cx} y2={cy - 30} stroke="#C9A227" strokeWidth="1.5" />
        </G>
      ))}
      <Path d="M40 152 Q24 120 50 100 Q86 80 124 92 Q92 96 70 112 Q50 126 56 150Z" fill="url(#harvest-blade)" />
      <Path d="M50 144 Q40 122 58 108" stroke="rgba(255,255,255,0.55)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M40 152 L26 168" stroke="#6D4C41" strokeWidth="11" strokeLinecap="round" />
    </Svg>
  );
}

// SALE — rupee coin with a stacked coins (money green #005F21)
function SaleIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="sale-coin" light="#34D058" base="#1C8A3C" dark="#005F21" />
      </Defs>
      <Shadow rx={52} />
      <Ellipse cx="78" cy="138" rx="42" ry="14" fill="#005F21" />
      <Ellipse cx="78" cy="130" rx="42" ry="14" fill="url(#sale-coin)" />
      <Ellipse cx="78" cy="122" rx="42" ry="14" fill="#1C8A3C" />
      <Circle cx="118" cy="96" r="46" fill="url(#sale-coin)" />
      <Circle cx="118" cy="96" r="46" fill="rgba(0,0,0,0.05)" />
      <Circle cx="118" cy="96" r="38" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" />
      <Path d="M104 76 L134 76 M104 88 L134 88 M104 76 Q126 76 122 92 Q118 104 104 104 L130 124"
        stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Ellipse cx="102" cy="80" rx="12" ry="7" fill="rgba(255,255,255,0.3)" />
    </Svg>
  );
}

// EXPENSE — wallet with a downward arrow (spend red #C62828)
function ExpenseIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="expense-wallet" light="#EF5350" base="#C62828" dark="#8E0000" />
        <Body3D id="expense-arrow" light="#FF8A80" base="#E53935" dark="#B71C1C" />
      </Defs>
      <Shadow rx={52} />
      <Rect x="40" y="96" width="120" height="70" rx="16" fill="url(#expense-wallet)" />
      <Path d="M40 112 Q40 92 60 92 L150 92 Q160 92 160 100 L160 112Z" fill="#8E0000" />
      <Rect x="120" y="118" width="40" height="26" rx="13" fill="#8E0000" />
      <Circle cx="132" cy="131" r="6" fill="#FFCDD2" />
      <Rect x="50" y="120" width="14" height="34" rx="7" fill="rgba(255,255,255,0.2)" />
      <Circle cx="100" cy="56" r="30" fill="url(#expense-arrow)" />
      <Circle cx="100" cy="56" r="30" fill="rgba(255,255,255,0.1)" />
      <Path d="M100 40 L100 64 M86 56 L100 72 L114 56" stroke="#FFFFFF" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

// INCOME — coins with an upward arrow (income green #005F21)
function IncomeIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="income-coin" light="#34D058" base="#1C8A3C" dark="#005F21" />
        <Body3D id="income-arrow" light="#69F0AE" base="#2E7D32" dark="#005F21" />
      </Defs>
      <Shadow rx={52} />
      <Ellipse cx="100" cy="156" rx="46" ry="15" fill="#005F21" />
      <Ellipse cx="100" cy="146" rx="46" ry="15" fill="url(#income-coin)" />
      <Ellipse cx="100" cy="136" rx="46" ry="15" fill="#1C8A3C" />
      <Ellipse cx="100" cy="126" rx="46" ry="15" fill="url(#income-coin)" />
      <Ellipse cx="100" cy="116" rx="46" ry="15" fill="#34D058" />
      <Path d="M90 110 L110 110 M90 116 L110 116 M90 110 Q104 110 101 119 M90 110 L108 126"
        stroke="#005F21" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Ellipse cx="86" cy="112" rx="10" ry="4" fill="rgba(255,255,255,0.3)" />
      <Circle cx="100" cy="58" r="30" fill="url(#income-arrow)" />
      <Circle cx="100" cy="58" r="30" fill="rgba(255,255,255,0.1)" />
      <Path d="M100 74 L100 50 M86 64 L100 46 L114 64" stroke="#FFFFFF" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

// OTHER — friendly star / sparkle badge (neutral green #1C8A3C) · fallback
function OtherIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="other-star" light="#7CE49A" base="#1C8A3C" dark="#0A5C24" />
      </Defs>
      <Shadow rx={48} />
      <Circle cx="100" cy="100" r="60" fill="rgba(28,138,60,0.16)" />
      <Polygon points="100,40 116,84 162,84 124,112 138,158 100,130 62,158 76,112 38,84 84,84" fill="url(#other-star)" />
      <Path d="M100 52 L110 82" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Circle cx="88" cy="92" r="5" fill="rgba(255,255,255,0.3)" />
      <Path d="M150 56 L154 56 M152 54 L152 58" stroke="#A3E635" strokeWidth="3" strokeLinecap="round" />
      <Path d="M48 132 L52 132 M50 130 L50 134" stroke="#A3E635" strokeWidth="3" strokeLinecap="round" />
      <Circle cx="158" cy="120" r="3" fill="#A3E635" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const ICONS = {
  LAND_PREP:  LandPrepIcon,
  SOWING:     SowingIcon,
  IRRIGATION: IrrigationIcon,
  FERTILIZER: FertilizerIcon,
  SPRAY:      SprayIcon,
  SCOUT:      ScoutIcon,
  WEEDING:    WeedingIcon,
  PRUNING:    PruningIcon,
  HARVEST:    HarvestIcon,
  SALE:       SaleIcon,
  EXPENSE:    ExpenseIcon,
  INCOME:     IncomeIcon,
  OTHER:      OtherIcon,
};

/**
 * Renders the (animated) SVG illustration for a farm-activity type.
 * @param {string}  type      activity key (case-insensitive); unknown → OTHER
 * @param {number}  size      width & height in dp (default 56)
 * @param {boolean} animated  gentle bob + activity-specific motion (default true)
 */
export function ActivityIcon({ type, size = 56, animated = true }) {
  const key = String(type || '').trim().toUpperCase();
  const Icon = ICONS[key] || OtherIcon;

  // Cheap native-driver "bob" so every icon feels alive (no React re-renders).
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const delay = ((key.charCodeAt(0) || 0) % 6) * 170;
    const a = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(bob, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [animated, key, bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const wrap = { width: size, height: size, alignItems: 'center', justifyContent: 'center' };

  return (
    <Animated.View style={[wrap, animated && { transform: [{ translateY }] }]}>
      <Icon size={size} animated={animated} />
    </Animated.View>
  );
}

export default ActivityIcon;
