/**
 * WeatherIcons.js — colourful, realistic, gently-ANIMATED pure-vector SVG weather
 * icons for the CropSetu Weather screens. Built for low-literacy Indian farmers:
 * big, saturated, instantly-recognisable real-world sky objects (golden sun,
 * fluffy clouds, blue rain drops, gold lightning bolt) — no Lottie, no images,
 * no network. Only react-native-svg + the RN Animated API (NOT reanimated).
 *
 * Animation (all opt-out via `animated={false}`):
 *   • every icon gets a cheap native-driver "bob" so it feels alive (no re-renders)
 *   • the sun's rays slowly pulse, clouds drift, rain/drizzle drops fall (Faller),
 *     the thunderbolt flashes
 *   • HEAVY particle motion (drops / drift) AUTO-DISABLES below size 34 so the icon
 *     is safe in long 24-hour / 7-day scroll lists — only the cheap bob survives.
 *
 * Matches ActivityIcons.js / CropIcons.js conventions: viewBox 0 0 200 200,
 * 3-stop gradients for 3D shading, a soft ground-shadow ellipse, a top-left shine.
 * Every gradient id is variant-prefixed because react-native-svg gradient ids are
 * GLOBAL — two icons on one screen would otherwise clash (the #1 bug here).
 *
 * The consumer screens (WeatherHome.js, AIAssistantHome.js) pass the backend
 * `conditionIcon` (an Ionicons-style name: sunny / partly-sunny / cloud / rainy /
 * snow / thunderstorm) OR the human-readable `condition` text ("Partly Cloudy",
 * "Heavy Rain", "Foggy", …). The alias map below resolves ALL of those.
 *
 * Usage:  <WeatherIcon condition="rain" size={48} animated />
 */
import React, { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect, G, Line, Polygon,
} from 'react-native-svg';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedG       = Animated.createAnimatedComponent(G);
const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

// Below this size we drop expensive particle/drift animation (lists at ~24).
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

/** A single self-looping falling drop (rain / drizzle). Static frame when off. */
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

/** Reusable fluffy 3D cloud body. `grad` is a gradient id, `g` the shine colour. */
const CloudBody = ({ grad, cx = 100, cy = 104, scale = 1, shine = 'rgba(255,255,255,0.35)' }) => (
  <G transform={`translate(${cx} ${cy}) scale(${scale})`}>
    <Ellipse cx={-34} cy={8}  rx={28} ry={24} fill={`url(#${grad})`} />
    <Ellipse cx={34}  cy={10} rx={30} ry={24} fill={`url(#${grad})`} />
    <Ellipse cx={-8}  cy={-14} rx={30} ry={28} fill={`url(#${grad})`} />
    <Ellipse cx={20}  cy={-8} rx={32} ry={30} fill={`url(#${grad})`} />
    <Rect x={-58} y={4} width={116} height={26} rx={13} fill={`url(#${grad})`} />
    {/* top-left shine */}
    <Ellipse cx={-22} cy={-18} rx={16} ry={9} fill={shine} />
  </G>
);

// ─────────────────────────────────────────────────────────────────────────────
// ── WEATHER ICONS ────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// CLEAR / SUNNY — golden sun with glowing, slowly-pulsing rays
function SunnyIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, pulse]);

  const rayScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const rayOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const rayProps = particles
    ? { opacity: rayOpacity, transform: [{ translateX: 100 }, { translateY: 100 }, { scale: rayScale }, { translateX: -100 }, { translateY: -100 }] }
    : {};

  const rays = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i * 30 * Math.PI) / 180;
    const r1 = 50, r2 = 70;
    const x1 = 100 + r1 * Math.cos(ang), y1 = 100 + r1 * Math.sin(ang);
    const x2 = 100 + r2 * Math.cos(ang), y2 = 100 + r2 * Math.sin(ang);
    rays.push(
      <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="url(#wx-sunny-ray)" strokeWidth={i % 2 === 0 ? 8 : 5} strokeLinecap="round" />
    );
  }

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="wx-sunny-disc" light="#FFF59D" base="#FDB813" dark="#E0890B" />
        <Body3DLinear id="wx-sunny-ray" light="#FFE082" base="#FFC107" dark="#FB8C00" />
      </Defs>
      <Shadow rx={52} />
      <Circle cx="100" cy="100" r="78" fill="rgba(255,193,7,0.13)" />
      <AnimatedG {...rayProps}>{rays}</AnimatedG>
      <Circle cx="100" cy="100" r="42" fill="url(#wx-sunny-disc)" />
      <Circle cx="100" cy="100" r="42" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
      {/* top-left shine */}
      <Ellipse cx="84" cy="84" rx="16" ry="11" fill="rgba(255,255,255,0.45)" />
    </Svg>
  );
}

// PARTLY-CLOUDY — golden sun peeking from behind a white-grey cloud (DEFAULT)
function PartlyCloudyIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, drift]);
  const tx = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 7] });

  const rays = [];
  for (let i = 0; i < 6; i++) {
    const ang = (-30 + i * 24 - 90) * Math.PI / 180; // upper-left arc
    const x1 = 78 + 30 * Math.cos(ang), y1 = 72 + 30 * Math.sin(ang);
    const x2 = 78 + 44 * Math.cos(ang), y2 = 72 + 44 * Math.sin(ang);
    rays.push(<Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#wx-pc-ray)" strokeWidth="6" strokeLinecap="round" />);
  }

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="wx-pc-sun" light="#FFF59D" base="#FDB813" dark="#E0890B" />
        <Body3DLinear id="wx-pc-ray" light="#FFE082" base="#FFC107" dark="#FB8C00" />
        <Body3D id="wx-pc-cloud" light="#FFFFFF" base="#ECEFF1" dark="#B0BEC5" />
      </Defs>
      <Shadow rx={54} />
      {/* Sun behind, upper-left */}
      <G>{rays}</G>
      <Circle cx="78" cy="72" r="28" fill="url(#wx-pc-sun)" />
      <Ellipse cx="68" cy="62" rx="9" ry="6" fill="rgba(255,255,255,0.45)" />
      {/* Cloud drifting over the sun */}
      <AnimatedG transform={particles ? [{ translateX: tx }] : undefined}>
        <CloudBody grad="wx-pc-cloud" cx={108} cy={112} scale={0.92} />
      </AnimatedG>
    </Svg>
  );
}

// CLOUDY / OVERCAST — layered grey clouds, gently drifting
function CloudyIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, drift]);
  const txBack = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const txFront = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="wx-cloudy-back" light="#CFD8DC" base="#90A4AE" dark="#607D8B" />
        <Body3D id="wx-cloudy-front" light="#FFFFFF" base="#E0E5E8" dark="#AEB9C0" />
      </Defs>
      <Shadow rx={56} />
      {/* Darker cloud behind, upper-right */}
      <AnimatedG transform={particles ? [{ translateX: txBack }] : undefined}>
        <CloudBody grad="wx-cloudy-back" cx={120} cy={78} scale={0.66} shine="rgba(255,255,255,0.2)" />
      </AnimatedG>
      {/* Lighter cloud in front */}
      <AnimatedG transform={particles ? [{ translateX: txFront }] : undefined}>
        <CloudBody grad="wx-cloudy-front" cx={94} cy={112} scale={0.98} />
      </AnimatedG>
    </Svg>
  );
}

// RAIN / SHOWERS — blue-grey cloud with falling blue drops
function RainIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, drift]);
  const tx = drift.interpolate({ inputRange: [0, 1], outputRange: [-4, 4] });

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="wx-rain-cloud" light="#ECEFF1" base="#B0BEC5" dark="#78909C" />
        <Body3D id="wx-rain-drop" light="#81D4FA" base="#29B6F6" dark="#0277BD" />
      </Defs>
      <Shadow rx={54} />
      {/* Falling rain drops (auto-off below size 34) */}
      <Faller x={66}  fromY={120} toY={166} rx={4.5} ry={8} fill="url(#wx-rain-drop)" dur={780}  delay={0}   on={particles} />
      <Faller x={100} fromY={124} toY={170} rx={5}   ry={9} fill="url(#wx-rain-drop)" dur={860}  delay={220} on={particles} />
      <Faller x={134} fromY={120} toY={166} rx={4.5} ry={8} fill="url(#wx-rain-drop)" dur={800}  delay={440} on={particles} />
      <Faller x={84}  fromY={122} toY={168} rx={4}   ry={7} fill="url(#wx-rain-drop)" dur={920}  delay={620} on={particles} />
      <Faller x={118} fromY={122} toY={168} rx={4}   ry={7} fill="url(#wx-rain-drop)" dur={880}  delay={340} on={particles} />
      {/* Cloud above */}
      <AnimatedG transform={particles ? [{ translateX: tx }] : undefined}>
        <CloudBody grad="wx-rain-cloud" cx={100} cy={86} scale={0.94} />
      </AnimatedG>
    </Svg>
  );
}

// DRIZZLE — pale cloud with a few small, slow drops
function DrizzleIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="wx-drizzle-cloud" light="#FFFFFF" base="#CFD8DC" dark="#90A4AE" />
        <Body3D id="wx-drizzle-drop" light="#B3E5FC" base="#4FC3F7" dark="#039BE5" />
      </Defs>
      <Shadow rx={52} />
      <Faller x={76}  fromY={122} toY={158} rx={3.2} ry={5.5} fill="url(#wx-drizzle-drop)" dur={1100} delay={0}   on={particles} />
      <Faller x={100} fromY={124} toY={160} rx={3.4} ry={6}   fill="url(#wx-drizzle-drop)" dur={1200} delay={380} on={particles} />
      <Faller x={124} fromY={122} toY={158} rx={3.2} ry={5.5} fill="url(#wx-drizzle-drop)" dur={1150} delay={720} on={particles} />
      <CloudBody grad="wx-drizzle-cloud" cx={100} cy={88} scale={0.9} />
    </Svg>
  );
}

// THUNDERSTORM — dark cloud with a flashing gold lightning bolt
function ThunderstormIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0.45, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(flash, { toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(flash, { toValue: 0.45, duration: 300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.delay(900),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, flash]);
  const boltOpacity = particles ? flash : 1;
  const boltScale = particles
    ? flash.interpolate({ inputRange: [0.45, 1], outputRange: [0.94, 1.04] })
    : 1;

  const bolt = "100,108 78,150 96,150 84,186 130,134 108,134 124,108";

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="wx-storm-cloud" light="#90A4AE" base="#546E7A" dark="#37474F" />
        <Body3DLinear id="wx-storm-bolt" light="#FFF176" base="#FFC107" dark="#FB8C00" />
      </Defs>
      <Shadow rx={52} />
      {/* Lightning bolt */}
      {particles ? (
        <AnimatedG opacity={boltOpacity} transform={[{ translateX: 104 }, { translateY: 147 }, { scale: boltScale }, { translateX: -104 }, { translateY: -147 }]}>
          <Polygon points={bolt} fill="url(#wx-storm-bolt)" />
          <Polygon points={bolt} fill="none" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.5" />
        </AnimatedG>
      ) : (
        <G>
          <Polygon points={bolt} fill="url(#wx-storm-bolt)" />
          <Polygon points={bolt} fill="none" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.5" />
        </G>
      )}
      {/* Dark storm cloud above */}
      <CloudBody grad="wx-storm-cloud" cx={100} cy={84} scale={0.96} shine="rgba(255,255,255,0.22)" />
    </Svg>
  );
}

// FOG / MIST / HAZE — pale grey horizontal bands (with a dim sun ghost), drifting
function FogIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, drift]);
  const tA = drift.interpolate({ inputRange: [0, 1], outputRange: [-7, 7] });
  const tB = drift.interpolate({ inputRange: [0, 1], outputRange: [6, -6] });

  const band = (y, w, opacity, grad) => (
    <Rect x={(200 - w) / 2} y={y} width={w} height="13" rx="6.5" fill={`url(#${grad})`} opacity={opacity} />
  );

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="wx-fog-band" light="#FFFFFF" base="#E0E5E8" dark="#B0BEC5" />
        <Body3D id="wx-fog-sun" light="#FFF8E1" base="#FFE082" dark="#FFCA28" />
      </Defs>
      <Shadow rx={56} />
      {/* Dim sun ghost behind the haze */}
      <Circle cx="100" cy="76" r="34" fill="url(#wx-fog-sun)" opacity="0.55" />
      {/* Pale grey haze bands */}
      <AnimatedG transform={particles ? [{ translateX: tA }] : undefined}>{band(58, 132, 0.7, 'wx-fog-band')}</AnimatedG>
      <AnimatedG transform={particles ? [{ translateX: tB }] : undefined}>{band(82, 148, 0.85, 'wx-fog-band')}</AnimatedG>
      <AnimatedG transform={particles ? [{ translateX: tA }] : undefined}>{band(106, 138, 0.92, 'wx-fog-band')}</AnimatedG>
      <AnimatedG transform={particles ? [{ translateX: tB }] : undefined}>{band(130, 126, 0.85, 'wx-fog-band')}</AnimatedG>
      <AnimatedG transform={particles ? [{ translateX: tA }] : undefined}>{band(152, 100, 0.7, 'wx-fog-band')}</AnimatedG>
    </Svg>
  );
}

// SNOW — pale cloud with soft falling white flakes
function SnowIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="wx-snow-cloud" light="#FFFFFF" base="#E1F5FE" dark="#B3E5FC" />
        <Body3D id="wx-snow-flake" light="#FFFFFF" base="#E3F2FD" dark="#BBDEFB" />
      </Defs>
      <Shadow rx={54} />
      <Faller x={70}  fromY={122} toY={164} rx={6}   ry={6}   fill="url(#wx-snow-flake)" dur={1500} delay={0}   on={particles} />
      <Faller x={100} fromY={126} toY={168} rx={6.5} ry={6.5} fill="url(#wx-snow-flake)" dur={1700} delay={500} on={particles} />
      <Faller x={130} fromY={122} toY={164} rx={6}   ry={6}   fill="url(#wx-snow-flake)" dur={1600} delay={950} on={particles} />
      <CloudBody grad="wx-snow-cloud" cx={100} cy={88} scale={0.94} />
    </Svg>
  );
}

// WINDY — light cloud pushed by curling wind streaks (drifting)
function WindyIcon({ size, animated }) {
  const particles = animated && size >= PARTICLE_MIN;
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!particles) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [particles, drift]);
  const tx = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 12] });

  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="wx-windy-cloud" light="#FFFFFF" base="#E0E5E8" dark="#AEB9C0" />
        <LinearGradient id="wx-windy-streak" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#B0BEC5" stopOpacity="0.3" />
          <Stop offset="1" stopColor="#78909C" stopOpacity="0.9" />
        </LinearGradient>
      </Defs>
      <Shadow rx={52} />
      <AnimatedG transform={particles ? [{ translateX: tx }] : undefined}>
        <Path d="M40 86 Q120 76 132 92 Q138 108 116 108 Q126 96 110 94 L40 96Z" fill="url(#wx-windy-streak)" />
        <Path d="M44 116 Q148 108 158 124 Q162 138 142 138 Q152 126 138 124 L44 126Z" fill="url(#wx-windy-streak)" />
        <Path d="M52 146 Q116 140 124 152 Q128 162 112 160 Q120 152 108 150 L52 154Z" fill="url(#wx-windy-streak)" />
      </AnimatedG>
      <CloudBody grad="wx-windy-cloud" cx={102} cy={84} scale={0.78} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry + alias map + case-insensitive lookup
// ─────────────────────────────────────────────────────────────────────────────
const ICONS = {
  sunny:           SunnyIcon,
  'partly-cloudy': PartlyCloudyIcon,
  cloudy:          CloudyIcon,
  rain:            RainIcon,
  drizzle:         DrizzleIcon,
  thunderstorm:    ThunderstormIcon,
  fog:             FogIcon,
  snow:            SnowIcon,
  windy:           WindyIcon,
};

const DEFAULT_VARIANT = 'partly-cloudy';

/**
 * Maps every input key the consumer screens actually pass — the backend
 * `conditionIcon` (Ionicons-style names) AND the human-readable `condition`
 * text from utils/weatherCodes.js — onto a canonical variant above.
 * Keys are normalised (lower-cased, spaces/underscores → '-') before lookup.
 */
const ALIASES = {
  // ── backend conditionIcon values (the primary inputs) ──
  'sunny':           'sunny',
  'partly-sunny':    'partly-cloudy',
  'cloud':           'cloudy',
  'cloudy':          'cloudy',
  'rainy':           'rain',
  'snow':            'snow',
  'thunderstorm':    'thunderstorm',

  // ── canonical / common synonyms ──
  'clear':           'sunny',
  'clear-sky':       'sunny',
  'clear-day':       'sunny',
  'sun':             'sunny',
  'mainly-clear':    'sunny',
  'fair':            'sunny',

  'partly-cloudy':   'partly-cloudy',
  'partly-clouds':   'partly-cloudy',
  'partlycloudy':    'partly-cloudy',
  'partly':          'partly-cloudy',

  'overcast':        'cloudy',
  'clouds':          'cloudy',
  'broken-clouds':   'cloudy',
  'scattered-clouds':'cloudy',
  'few-clouds':      'partly-cloudy',

  // ── rain family ──
  'rain':            'rain',
  'rains':           'rain',
  'light-rain':      'rain',
  'heavy-rain':      'rain',
  'moderate-rain':   'rain',
  'showers':         'rain',
  'rain-showers':    'rain',
  'light-rain-showers':'rain',
  'heavy-rain-showers':'rain',
  'shower':          'rain',
  'freezing-rain':   'rain',
  'light-freezing-rain':'rain',
  'heavy-freezing-rain':'rain',

  // ── drizzle family ──
  'drizzle':         'drizzle',
  'light-drizzle':   'drizzle',
  'heavy-drizzle':   'drizzle',
  'freezing-drizzle':'drizzle',
  'light-freezing-drizzle':'drizzle',
  'heavy-freezing-drizzle':'drizzle',

  // ── storm family ──
  'thunder':         'thunderstorm',
  'storm':           'thunderstorm',
  'thundershower':   'thunderstorm',
  'thunderstorm-w/-hail':'thunderstorm',
  'thunderstorm-with-hail':'thunderstorm',
  'hail':            'thunderstorm',
  'heavy-hail-storm':'thunderstorm',
  'lightning':       'thunderstorm',

  // ── fog / mist / haze ──
  'fog':             'fog',
  'foggy':           'fog',
  'icy-fog':         'fog',
  'mist':            'fog',
  'misty':           'fog',
  'haze':            'fog',
  'hazy':            'fog',
  'smoke':           'fog',

  // ── snow family ──
  'snowy':           'snow',
  'light-snow':      'snow',
  'heavy-snow':      'snow',
  'snow-grains':     'snow',
  'snow-showers':    'snow',
  'light-snow-showers':'snow',
  'heavy-snow-showers':'snow',
  'sleet':           'snow',

  // ── wind ──
  'windy':           'windy',
  'wind':            'windy',
  'breezy':          'windy',
  'gale':            'windy',
};

function resolveVariant(condition) {
  const norm = String(condition || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (!norm) return DEFAULT_VARIANT;
  if (ALIASES[norm]) return ALIASES[norm];
  if (ICONS[norm]) return norm;
  // last-resort keyword scan for any free-text condition string
  if (norm.includes('thunder') || norm.includes('storm') || norm.includes('hail') || norm.includes('lightning')) return 'thunderstorm';
  if (norm.includes('drizzle')) return 'drizzle';
  if (norm.includes('rain') || norm.includes('shower')) return 'rain';
  if (norm.includes('snow') || norm.includes('sleet')) return 'snow';
  if (norm.includes('fog') || norm.includes('mist') || norm.includes('haze') || norm.includes('smoke')) return 'fog';
  if (norm.includes('wind') || norm.includes('breez') || norm.includes('gale')) return 'windy';
  if (norm.includes('overcast') || norm.includes('cloud')) {
    return norm.includes('part') || norm.includes('sun') ? 'partly-cloudy' : 'cloudy';
  }
  if (norm.includes('clear') || norm.includes('sun') || norm.includes('fair')) return 'sunny';
  return DEFAULT_VARIANT;
}

/**
 * Renders the (animated) SVG illustration for a weather condition.
 * @param {string}  condition  conditionIcon key OR condition text (case-insensitive); unknown → partly-cloudy
 * @param {number}  size       width & height in dp (default 56)
 * @param {boolean} animated   gentle bob + condition-specific motion (default true). Heavy
 *                             particle motion auto-disables below size 34 (safe in scroll lists).
 */
export function WeatherIcon({ condition, size = 56, animated = true }) {
  const variant = resolveVariant(condition);
  const Icon = ICONS[variant] || PartlyCloudyIcon;

  // Cheap native-driver "bob" so every icon feels alive (no React re-renders).
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const delay = ((variant.charCodeAt(0) || 0) % 6) * 170;
    const a = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(bob, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [animated, variant, bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const wrap = { width: size, height: size, alignItems: 'center', justifyContent: 'center' };

  return (
    <Animated.View style={[wrap, animated && { transform: [{ translateY }] }]}>
      <Icon size={size} animated={animated} />
    </Animated.View>
  );
}

export default WeatherIcon;
