import React from 'react';
import Svg, {
  Defs, LinearGradient, Stop,
  Rect, Ellipse, Path, Circle, Line,
} from 'react-native-svg';

function DripIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="drBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#E8F5E9" />
          <Stop offset="100%" stopColor="#C8E6C9" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#drBg)" />
      <Line x1="15" y1="25" x2="85" y2="25" stroke="#5D4037" strokeWidth="3" strokeLinecap="round" />
      <Line x1="30" y1="25" x2="30" y2="40" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
      <Line x1="50" y1="25" x2="50" y2="40" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
      <Line x1="70" y1="25" x2="70" y2="40" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
      <Path d="M27 48 Q30 42 33 48 Q30 56 27 48 Z" fill="#2196F3" opacity="0.8" />
      <Path d="M27 60 Q30 54 33 60 Q30 68 27 60 Z" fill="#2196F3" opacity="0.6" />
      <Path d="M47 48 Q50 42 53 48 Q50 56 47 48 Z" fill="#2196F3" opacity="0.8" />
      <Path d="M47 60 Q50 54 53 60 Q50 68 47 60 Z" fill="#2196F3" opacity="0.6" />
      <Path d="M67 48 Q70 42 73 48 Q70 56 67 48 Z" fill="#2196F3" opacity="0.8" />
      <Path d="M67 60 Q70 54 73 60 Q70 68 67 60 Z" fill="#2196F3" opacity="0.6" />
      <Path d="M20 80 Q30 72 40 78 Q50 82 55 78" stroke="#4CAF50" strokeWidth="2" fill="none" />
      <Path d="M55 78 Q65 72 75 78 Q82 82 88 78" stroke="#4CAF50" strokeWidth="2" fill="none" />
      <Circle cx="30" cy="82" r="3" fill="#66BB6A" opacity="0.5" />
      <Circle cx="50" cy="80" r="2.5" fill="#66BB6A" opacity="0.5" />
      <Circle cx="70" cy="82" r="3" fill="#66BB6A" opacity="0.5" />
    </Svg>
  );
}

function SprinklerIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="spBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#E3F2FD" />
          <Stop offset="100%" stopColor="#BBDEFB" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#spBg)" />
      <Line x1="50" y1="85" x2="50" y2="40" stroke="#78909C" strokeWidth="3" strokeLinecap="round" />
      <Circle cx="50" cy="36" r="5" fill="#546E7A" />
      <Path d="M50 32 Q35 18 20 25" stroke="#42A5F5" strokeWidth="1.5" fill="none" opacity="0.7" />
      <Path d="M50 32 Q40 15 28 18" stroke="#42A5F5" strokeWidth="1.5" fill="none" opacity="0.7" />
      <Path d="M50 32 Q50 12 50 12" stroke="#42A5F5" strokeWidth="1.5" fill="none" opacity="0.7" />
      <Path d="M50 32 Q60 15 72 18" stroke="#42A5F5" strokeWidth="1.5" fill="none" opacity="0.7" />
      <Path d="M50 32 Q65 18 80 25" stroke="#42A5F5" strokeWidth="1.5" fill="none" opacity="0.7" />
      <Circle cx="20" cy="28" r="2" fill="#64B5F6" opacity="0.6" />
      <Circle cx="28" cy="20" r="1.5" fill="#64B5F6" opacity="0.6" />
      <Circle cx="50" cy="14" r="2" fill="#64B5F6" opacity="0.6" />
      <Circle cx="72" cy="20" r="1.5" fill="#64B5F6" opacity="0.6" />
      <Circle cx="80" cy="28" r="2" fill="#64B5F6" opacity="0.6" />
      <Circle cx="15" cy="40" r="1.5" fill="#90CAF9" opacity="0.5" />
      <Circle cx="35" cy="50" r="1.2" fill="#90CAF9" opacity="0.5" />
      <Circle cx="65" cy="50" r="1.2" fill="#90CAF9" opacity="0.5" />
      <Circle cx="85" cy="40" r="1.5" fill="#90CAF9" opacity="0.5" />
      <Path d="M10 88 Q30 82 50 88 Q70 82 90 88" stroke="#4CAF50" strokeWidth="2" fill="none" opacity="0.6" />
    </Svg>
  );
}

function FloodIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="flBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFF8E1" />
          <Stop offset="60%" stopColor="#E8D5A3" />
          <Stop offset="100%" stopColor="#90CAF9" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#flBg)" />
      <Rect x="5" y="55" width="90" height="40" rx="4" fill="#64B5F6" opacity="0.5" />
      <Path d="M5 58 Q15 52 25 58 Q35 64 45 58 Q55 52 65 58 Q75 64 85 58 Q92 54 98 58" stroke="#42A5F5" strokeWidth="2" fill="none" opacity="0.8" />
      <Path d="M5 68 Q15 62 25 68 Q35 74 45 68 Q55 62 65 68 Q75 74 85 68 Q92 64 98 68" stroke="#42A5F5" strokeWidth="1.5" fill="none" opacity="0.6" />
      <Path d="M5 78 Q15 72 25 78 Q35 84 45 78 Q55 72 65 78 Q75 84 85 78 Q92 74 98 78" stroke="#42A5F5" strokeWidth="1.5" fill="none" opacity="0.4" />
      <Path d="M25 50 L25 20 L22 20 L25 14 L28 20 L25 20" stroke="#4CAF50" strokeWidth="1.5" fill="#66BB6A" />
      <Path d="M50 48 L50 15 L47 15 L50 8 L53 15 L50 15" stroke="#4CAF50" strokeWidth="1.5" fill="#66BB6A" />
      <Path d="M75 50 L75 20 L72 20 L75 14 L78 20 L75 20" stroke="#4CAF50" strokeWidth="1.5" fill="#66BB6A" />
    </Svg>
  );
}

function RainfedIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="rfBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#ECEFF1" />
          <Stop offset="100%" stopColor="#CFD8DC" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#rfBg)" />
      <Path d="M25 30 Q25 18 38 18 Q38 10 52 12 Q58 8 68 12 Q80 12 80 24 Q88 26 85 35 Q88 42 78 42 L25 42 Q15 42 18 34 Q15 28 25 30 Z" fill="#90A4AE" opacity="0.8" />
      <Path d="M30 50 L28 60" stroke="#42A5F5" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <Path d="M42 48 L40 58" stroke="#42A5F5" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <Path d="M54 50 L52 60" stroke="#42A5F5" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <Path d="M66 48 L64 58" stroke="#42A5F5" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <Path d="M36 58 L34 68" stroke="#42A5F5" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <Path d="M48 56 L46 66" stroke="#42A5F5" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <Path d="M60 58 L58 68" stroke="#42A5F5" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <Path d="M72 56 L70 66" stroke="#42A5F5" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <Path d="M10 88 Q25 80 40 85 Q55 90 70 85 Q85 80 95 85" stroke="#4CAF50" strokeWidth="2.5" fill="none" opacity="0.6" />
      <Circle cx="30" cy="86" r="2.5" fill="#66BB6A" opacity="0.4" />
      <Circle cx="55" cy="84" r="2" fill="#66BB6A" opacity="0.4" />
      <Circle cx="75" cy="86" r="2.5" fill="#66BB6A" opacity="0.4" />
    </Svg>
  );
}

function CanalIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="caBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#E8F5E9" />
          <Stop offset="100%" stopColor="#C8E6C9" />
        </LinearGradient>
        <LinearGradient id="caWat" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#42A5F5" />
          <Stop offset="100%" stopColor="#1E88E5" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#caBg)" />
      <Path d="M5 35 L30 38 L70 38 L95 35 L95 65 L70 62 L30 62 L5 65 Z" fill="url(#caWat)" opacity="0.6" />
      <Path d="M5 38 Q20 32 35 38 Q50 44 65 38 Q80 32 95 38" stroke="#1E88E5" strokeWidth="1.5" fill="none" opacity="0.7" />
      <Path d="M5 50 Q20 44 35 50 Q50 56 65 50 Q80 44 95 50" stroke="#1E88E5" strokeWidth="1.5" fill="none" opacity="0.5" />
      <Path d="M5 35 L30 38" stroke="#795548" strokeWidth="3" strokeLinecap="round" />
      <Path d="M95 35 L70 38" stroke="#795548" strokeWidth="3" strokeLinecap="round" />
      <Path d="M5 65 L30 62" stroke="#795548" strokeWidth="3" strokeLinecap="round" />
      <Path d="M95 65 L70 62" stroke="#795548" strokeWidth="3" strokeLinecap="round" />
      <Path d="M15 20 L18 12 L21 20" stroke="#4CAF50" strokeWidth="2" fill="#66BB6A" />
      <Path d="M80 18 L83 10 L86 18" stroke="#4CAF50" strokeWidth="2" fill="#66BB6A" />
      <Path d="M15 80 L18 72 L21 80" stroke="#4CAF50" strokeWidth="2" fill="#66BB6A" />
      <Path d="M80 82 L83 74 L86 82" stroke="#4CAF50" strokeWidth="2" fill="#66BB6A" />
    </Svg>
  );
}

const IRRIGATION_ICON_MAP = {
  drip: DripIcon,
  sprinkler: SprinklerIcon,
  flood: FloodIcon,
  rainfed: RainfedIcon,
  canal: CanalIcon,
};

export default function IrrigationIcon({ type, size = 48 }) {
  const Icon = IRRIGATION_ICON_MAP[type];
  if (!Icon) return null;
  return <Icon size={size} />;
}

export { IRRIGATION_ICON_MAP };
