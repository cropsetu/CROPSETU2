import React from 'react';
import Svg, {
  Defs, LinearGradient, Stop,
  Rect, Ellipse, Path, Circle,
} from 'react-native-svg';

function BlackSoilIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="bs1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#3E3631" />
          <Stop offset="50%" stopColor="#2A2420" />
          <Stop offset="100%" stopColor="#1A1512" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#bs1)" />
      <Ellipse cx="30" cy="35" rx="8" ry="3" fill="#4A433E" />
      <Ellipse cx="65" cy="28" rx="10" ry="3.5" fill="#4A433E" />
      <Ellipse cx="50" cy="55" rx="12" ry="4" fill="#3A342F" />
      <Ellipse cx="25" cy="70" rx="7" ry="2.5" fill="#4A433E" />
      <Ellipse cx="72" cy="68" rx="9" ry="3" fill="#3A342F" />
      <Circle cx="40" cy="42" r="2" fill="#5A534E" />
      <Circle cx="60" cy="75" r="1.5" fill="#5A534E" />
      <Circle cx="80" cy="45" r="1.8" fill="#5A534E" />
      <Path d="M15 85 Q25 78 35 85 Q45 92 55 85 Q65 78 75 85 Q85 92 95 85" stroke="#5A534E" strokeWidth="1.5" fill="none" opacity="0.6" />
    </Svg>
  );
}

function RedSoilIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="rs1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#C45A3C" />
          <Stop offset="50%" stopColor="#A84832" />
          <Stop offset="100%" stopColor="#8B3626" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#rs1)" />
      <Ellipse cx="35" cy="30" rx="10" ry="3" fill="#D4694B" />
      <Ellipse cx="70" cy="40" rx="8" ry="3" fill="#B8533A" />
      <Ellipse cx="45" cy="60" rx="14" ry="4" fill="#D4694B" opacity="0.7" />
      <Ellipse cx="25" cy="75" rx="9" ry="3" fill="#B8533A" />
      <Circle cx="55" cy="35" r="2.5" fill="#E07A5C" />
      <Circle cx="75" cy="65" r="2" fill="#E07A5C" />
      <Circle cx="30" cy="50" r="1.5" fill="#E07A5C" />
      <Path d="M10 88 Q30 80 50 88 Q70 96 90 88" stroke="#D4694B" strokeWidth="1.5" fill="none" opacity="0.5" />
    </Svg>
  );
}

function AlluvialSoilIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="as1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#C4AA78" />
          <Stop offset="40%" stopColor="#A8905F" />
          <Stop offset="70%" stopColor="#8D7548" />
          <Stop offset="100%" stopColor="#7A6540" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#as1)" />
      <Rect x="8" y="20" width="84" height="4" rx="2" fill="#D4BC8A" opacity="0.5" />
      <Rect x="8" y="38" width="84" height="3" rx="1.5" fill="#B89E6C" opacity="0.5" />
      <Rect x="8" y="54" width="84" height="3.5" rx="1.5" fill="#D4BC8A" opacity="0.4" />
      <Rect x="8" y="70" width="84" height="3" rx="1.5" fill="#B89E6C" opacity="0.4" />
      <Path d="M5 15 Q20 8 35 15 Q50 22 65 15 Q80 8 95 15" stroke="#D4BC8A" strokeWidth="2" fill="none" opacity="0.6" />
      <Circle cx="25" cy="45" r="1.5" fill="#DFCB99" />
      <Circle cx="60" cy="32" r="1.2" fill="#DFCB99" />
      <Circle cx="78" cy="62" r="1.8" fill="#DFCB99" />
    </Svg>
  );
}

function SandySoilIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="ss1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#E8D5A3" />
          <Stop offset="50%" stopColor="#D4C08B" />
          <Stop offset="100%" stopColor="#C0AB73" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#ss1)" />
      <Circle cx="20" cy="25" r="2" fill="#F0E2B5" />
      <Circle cx="35" cy="20" r="1.5" fill="#C8B37A" />
      <Circle cx="50" cy="30" r="2.5" fill="#F0E2B5" />
      <Circle cx="70" cy="22" r="1.8" fill="#C8B37A" />
      <Circle cx="85" cy="28" r="2" fill="#F0E2B5" />
      <Circle cx="15" cy="45" r="1.8" fill="#C8B37A" />
      <Circle cx="30" cy="50" r="2.2" fill="#F0E2B5" />
      <Circle cx="55" cy="48" r="1.5" fill="#C8B37A" />
      <Circle cx="75" cy="52" r="2" fill="#F0E2B5" />
      <Circle cx="40" cy="70" r="2" fill="#C8B37A" />
      <Circle cx="60" cy="68" r="1.8" fill="#F0E2B5" />
      <Circle cx="80" cy="72" r="2.5" fill="#C8B37A" />
      <Circle cx="25" cy="85" r="1.5" fill="#F0E2B5" />
      <Circle cx="55" cy="88" r="2" fill="#C8B37A" />
      <Path d="M8 60 Q25 55 42 60 Q60 65 78 60 Q88 57 95 60" stroke="#C8B37A" strokeWidth="1" fill="none" opacity="0.5" />
    </Svg>
  );
}

function ClaySoilIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="cs1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#9B7653" />
          <Stop offset="50%" stopColor="#866545" />
          <Stop offset="100%" stopColor="#6F5238" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#cs1)" />
      <Path d="M10 25 L90 25 L88 30 L12 28 Z" fill="#A88463" opacity="0.6" />
      <Path d="M12 42 L88 40 L90 46 L10 48 Z" fill="#7A5E42" opacity="0.5" />
      <Path d="M10 60 L90 58 L88 64 L12 62 Z" fill="#A88463" opacity="0.5" />
      <Path d="M14 78 L86 76 L88 80 L12 82 Z" fill="#7A5E42" opacity="0.4" />
      <Path d="M25 20 L28 35" stroke="#B49474" strokeWidth="1" opacity="0.4" />
      <Path d="M60 38 L62 52" stroke="#B49474" strokeWidth="1" opacity="0.4" />
      <Path d="M40 55 L43 70" stroke="#B49474" strokeWidth="1" opacity="0.4" />
    </Svg>
  );
}

function LateriteSoilIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="ls1" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#B85C38" />
          <Stop offset="40%" stopColor="#9A4A2E" />
          <Stop offset="100%" stopColor="#7D3A24" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#ls1)" />
      <Rect x="12" y="18" width="18" height="14" rx="3" fill="#CC6B45" opacity="0.6" />
      <Rect x="38" y="15" width="22" height="16" rx="3" fill="#A85535" opacity="0.5" />
      <Rect x="68" y="20" width="20" height="12" rx="3" fill="#CC6B45" opacity="0.6" />
      <Rect x="10" y="40" width="24" height="16" rx="3" fill="#A85535" opacity="0.5" />
      <Rect x="42" y="38" width="16" height="18" rx="3" fill="#CC6B45" opacity="0.5" />
      <Rect x="66" y="42" width="22" height="14" rx="3" fill="#A85535" opacity="0.5" />
      <Rect x="15" y="64" width="20" height="14" rx="3" fill="#CC6B45" opacity="0.5" />
      <Rect x="44" y="62" width="18" height="16" rx="3" fill="#A85535" opacity="0.4" />
      <Rect x="70" y="66" width="18" height="12" rx="3" fill="#CC6B45" opacity="0.4" />
      <Circle cx="22" cy="88" r="3" fill="#D47A58" opacity="0.3" />
      <Circle cx="55" cy="86" r="2.5" fill="#D47A58" opacity="0.3" />
      <Circle cx="80" cy="88" r="2" fill="#D47A58" opacity="0.3" />
    </Svg>
  );
}

const SOIL_ICON_MAP = {
  black: BlackSoilIcon,
  red: RedSoilIcon,
  alluvial: AlluvialSoilIcon,
  sandy: SandySoilIcon,
  clay: ClaySoilIcon,
  laterite: LateriteSoilIcon,
};

export default function SoilIcon({ type, size = 48 }) {
  const Icon = SOIL_ICON_MAP[type];
  if (!Icon) return null;
  return <Icon size={size} />;
}

export { SOIL_ICON_MAP };
