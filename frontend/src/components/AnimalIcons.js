import React from 'react';
import Svg, {
  Defs, LinearGradient, Stop,
  Rect, Ellipse, Path, Circle, Line,
} from 'react-native-svg';

function AllAnimalsIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="aaBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#E8F5E9" />
          <Stop offset="100%" stopColor="#C8E6C9" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#aaBg)" />
      <Path d="M20 60 Q20 48 28 48 L38 48 Q42 48 42 52 L42 65 Q42 68 38 68 L24 68 Q20 68 20 64 Z" fill="#8D6E63" />
      <Circle cx="28" cy="44" r="7" fill="#8D6E63" />
      <Path d="M22 40 L18 35" stroke="#8D6E63" strokeWidth="2" strokeLinecap="round" />
      <Path d="M34 40 L38 35" stroke="#8D6E63" strokeWidth="2" strokeLinecap="round" />
      <Circle cx="26" cy="43" r="1.2" fill="#3E2723" />
      <Circle cx="31" cy="43" r="1.2" fill="#3E2723" />
      <Path d="M55 55 Q55 45 62 45 L72 45 Q78 45 78 50 L78 62 Q78 66 72 66 L60 66 Q55 66 55 62 Z" fill="#E0E0E0" />
      <Circle cx="63" cy="40" r="6" fill="#E0E0E0" />
      <Path d="M58 36 L55 30" stroke="#BDBDBD" strokeWidth="2" strokeLinecap="round" />
      <Path d="M68 36 L72 30" stroke="#BDBDBD" strokeWidth="2" strokeLinecap="round" />
      <Circle cx="61" cy="39" r="1" fill="#424242" />
      <Circle cx="66" cy="39" r="1" fill="#424242" />
      <Path d="M35 85 Q35 76 42 76 L50 76 Q55 76 55 80 L55 88 Q55 92 50 92 L40 92 Q35 92 35 88 Z" fill="#5D4037" />
      <Circle cx="42" cy="72" r="5.5" fill="#5D4037" />
      <Path d="M37 68 L34 63" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
      <Path d="M47 68 L50 63" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
      <Circle cx="40" cy="71" r="1" fill="#1B0E07" />
      <Circle cx="44" cy="71" r="1" fill="#1B0E07" />
    </Svg>
  );
}

function CowIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="cwBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFF3E0" />
          <Stop offset="100%" stopColor="#FFE0B2" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#cwBg)" />
      <Ellipse cx="50" cy="58" rx="28" ry="18" fill="#F5F5F5" />
      <Ellipse cx="38" cy="55" rx="8" ry="6" fill="#8D6E63" />
      <Ellipse cx="62" cy="52" rx="10" ry="7" fill="#8D6E63" />
      <Circle cx="50" cy="36" r="14" fill="#F5F5F5" />
      <Ellipse cx="45" cy="30" rx="4" ry="2.5" fill="#8D6E63" />
      <Path d="M36 28 L30 18 L34 24" stroke="#F5F5F5" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M64 28 L70 18 L66 24" stroke="#F5F5F5" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Circle cx="44" cy="34" r="2" fill="#3E2723" />
      <Circle cx="56" cy="34" r="2" fill="#3E2723" />
      <Ellipse cx="50" cy="42" rx="5" ry="3" fill="#FFCCBC" />
      <Circle cx="48" cy="42" r="1" fill="#5D4037" />
      <Circle cx="52" cy="42" r="1" fill="#5D4037" />
      <Line x1="35" y1="76" x2="35" y2="88" stroke="#BDBDBD" strokeWidth="3" strokeLinecap="round" />
      <Line x1="45" y1="76" x2="45" y2="88" stroke="#BDBDBD" strokeWidth="3" strokeLinecap="round" />
      <Line x1="55" y1="76" x2="55" y2="88" stroke="#BDBDBD" strokeWidth="3" strokeLinecap="round" />
      <Line x1="65" y1="76" x2="65" y2="88" stroke="#BDBDBD" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

function BuffaloIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="bfBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#EFEBE9" />
          <Stop offset="100%" stopColor="#D7CCC8" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#bfBg)" />
      <Ellipse cx="50" cy="58" rx="26" ry="17" fill="#3E2723" />
      <Circle cx="50" cy="36" r="15" fill="#3E2723" />
      <Path d="M32 30 Q22 15 18 22 Q16 28 28 30" fill="#4E342E" stroke="#3E2723" strokeWidth="1" />
      <Path d="M68 30 Q78 15 82 22 Q84 28 72 30" fill="#4E342E" stroke="#3E2723" strokeWidth="1" />
      <Circle cx="43" cy="34" r="2.5" fill="#EFEBE9" />
      <Circle cx="43" cy="34" r="1.2" fill="#1B0E07" />
      <Circle cx="57" cy="34" r="2.5" fill="#EFEBE9" />
      <Circle cx="57" cy="34" r="1.2" fill="#1B0E07" />
      <Ellipse cx="50" cy="44" rx="6" ry="4" fill="#5D4037" />
      <Circle cx="47" cy="44" r="1.2" fill="#1B0E07" />
      <Circle cx="53" cy="44" r="1.2" fill="#1B0E07" />
      <Line x1="34" y1="75" x2="34" y2="88" stroke="#2C1810" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="44" y1="75" x2="44" y2="88" stroke="#2C1810" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="56" y1="75" x2="56" y2="88" stroke="#2C1810" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="66" y1="75" x2="66" y2="88" stroke="#2C1810" strokeWidth="3.5" strokeLinecap="round" />
    </Svg>
  );
}

function GoatIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="gtBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FBE9E7" />
          <Stop offset="100%" stopColor="#FFCCBC" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#gtBg)" />
      <Ellipse cx="50" cy="58" rx="20" ry="14" fill="#EFEBE9" />
      <Circle cx="50" cy="38" r="12" fill="#EFEBE9" />
      <Path d="M40 30 L34 15 L38 26" stroke="#D7CCC8" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M60 30 L66 15 L62 26" stroke="#D7CCC8" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Circle cx="45" cy="36" r="1.8" fill="#3E2723" />
      <Circle cx="55" cy="36" r="1.8" fill="#3E2723" />
      <Ellipse cx="50" cy="44" rx="4" ry="2.5" fill="#FFCCBC" />
      <Circle cx="48" cy="44" r="0.8" fill="#5D4037" />
      <Circle cx="52" cy="44" r="0.8" fill="#5D4037" />
      <Path d="M48 48 L47 54" stroke="#BCAAA4" strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M52 48 L53 54" stroke="#BCAAA4" strokeWidth="1.5" strokeLinecap="round" />
      <Line x1="38" y1="72" x2="38" y2="86" stroke="#A1887F" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="46" y1="72" x2="46" y2="86" stroke="#A1887F" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="54" y1="72" x2="54" y2="86" stroke="#A1887F" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="62" y1="72" x2="62" y2="86" stroke="#A1887F" strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

function BullockIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="blBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#EFEBE9" />
          <Stop offset="100%" stopColor="#D7CCC8" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#blBg)" />
      <Ellipse cx="50" cy="58" rx="28" ry="18" fill="#6D4C41" />
      <Circle cx="50" cy="36" r="14" fill="#6D4C41" />
      <Path d="M36 26 Q28 10 22 18 Q18 24 30 28" fill="#8D6E63" />
      <Path d="M64 26 Q72 10 78 18 Q82 24 70 28" fill="#8D6E63" />
      <Circle cx="44" cy="34" r="2.2" fill="#EFEBE9" />
      <Circle cx="44" cy="34" r="1" fill="#1B0E07" />
      <Circle cx="56" cy="34" r="2.2" fill="#EFEBE9" />
      <Circle cx="56" cy="34" r="1" fill="#1B0E07" />
      <Ellipse cx="50" cy="43" rx="5" ry="3.5" fill="#8D6E63" />
      <Circle cx="48" cy="43" r="1" fill="#3E2723" />
      <Circle cx="52" cy="43" r="1" fill="#3E2723" />
      <Ellipse cx="50" cy="56" rx="8" ry="4" fill="#795548" />
      <Line x1="34" y1="76" x2="34" y2="88" stroke="#4E342E" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="44" y1="76" x2="44" y2="88" stroke="#4E342E" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="56" y1="76" x2="56" y2="88" stroke="#4E342E" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="66" y1="76" x2="66" y2="88" stroke="#4E342E" strokeWidth="3.5" strokeLinecap="round" />
    </Svg>
  );
}

function SheepIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="shBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#F3E5F5" />
          <Stop offset="100%" stopColor="#E1BEE7" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#shBg)" />
      <Circle cx="35" cy="52" r="8" fill="#FAFAFA" />
      <Circle cx="50" cy="48" r="9" fill="#FAFAFA" />
      <Circle cx="65" cy="52" r="8" fill="#FAFAFA" />
      <Circle cx="40" cy="60" r="8" fill="#FAFAFA" />
      <Circle cx="55" cy="58" r="9" fill="#FAFAFA" />
      <Circle cx="60" cy="64" r="7" fill="#FAFAFA" />
      <Circle cx="45" cy="68" r="7" fill="#FAFAFA" />
      <Circle cx="50" cy="35" r="10" fill="#424242" />
      <Circle cx="46" cy="33" r="1.5" fill="#FAFAFA" />
      <Circle cx="54" cy="33" r="1.5" fill="#FAFAFA" />
      <Ellipse cx="50" cy="39" rx="3" ry="2" fill="#616161" />
      <Path d="M40 30 L36 24" stroke="#424242" strokeWidth="2" strokeLinecap="round" />
      <Path d="M60 30 L64 24" stroke="#424242" strokeWidth="2" strokeLinecap="round" />
      <Line x1="40" y1="74" x2="40" y2="88" stroke="#424242" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="48" y1="74" x2="48" y2="88" stroke="#424242" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="52" y1="74" x2="52" y2="88" stroke="#424242" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="60" y1="74" x2="60" y2="88" stroke="#424242" strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

function PoultryIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="ptBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFF8E1" />
          <Stop offset="100%" stopColor="#FFECB3" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#ptBg)" />
      <Ellipse cx="50" cy="58" rx="18" ry="16" fill="#F5F5F5" />
      <Ellipse cx="55" cy="65" rx="10" ry="5" fill="#E0E0E0" />
      <Circle cx="50" cy="34" r="11" fill="#F5F5F5" />
      <Path d="M50 24 Q48 16 50 14 Q52 16 50 24" fill="#F44336" />
      <Path d="M50 24 Q46 18 48 14 Q50 16 50 24" fill="#E53935" />
      <Path d="M50 24 Q54 18 52 14 Q50 16 50 24" fill="#EF5350" />
      <Circle cx="46" cy="32" r="1.8" fill="#1B0E07" />
      <Circle cx="54" cy="32" r="1.8" fill="#1B0E07" />
      <Path d="M50 37 L56 36 L50 39 Z" fill="#FF8F00" />
      <Path d="M48 42 Q50 46 52 42" stroke="#E53935" strokeWidth="1.5" fill="none" />
      <Path d="M28 55 Q22 48 18 55 Q22 60 28 55" fill="#E0E0E0" />
      <Path d="M72 55 Q78 48 82 55 Q78 60 72 55" fill="#E0E0E0" />
      <Path d="M75 62 Q82 58 85 64 Q80 68 75 62" fill="#BDBDBD" />
      <Line x1="44" y1="74" x2="42" y2="88" stroke="#FF8F00" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="56" y1="74" x2="58" y2="88" stroke="#FF8F00" strokeWidth="2.5" strokeLinecap="round" />
      <Path d="M38 88 L42 88 L46 88" stroke="#FF8F00" strokeWidth="2" strokeLinecap="round" />
      <Path d="M54 88 L58 88 L62 88" stroke="#FF8F00" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function HorseIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="hsBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFF3E0" />
          <Stop offset="100%" stopColor="#FFE0B2" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#hsBg)" />
      <Ellipse cx="50" cy="56" rx="22" ry="16" fill="#795548" />
      <Path d="M38 42 Q36 28 42 22 Q46 18 48 22 L48 38" fill="#795548" />
      <Ellipse cx="44" cy="22" rx="5" ry="4" fill="#795548" />
      <Path d="M40 18 L38 10" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
      <Path d="M48 18 L50 10" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />
      <Circle cx="42" cy="22" r="1.5" fill="#1B0E07" />
      <Ellipse cx="44" cy="26" rx="2.5" ry="1.5" fill="#6D4C41" />
      <Path d="M70 48 Q78 45 80 50 Q82 55 76 56" fill="#5D4037" />
      <Line x1="36" y1="72" x2="36" y2="88" stroke="#5D4037" strokeWidth="3" strokeLinecap="round" />
      <Line x1="44" y1="72" x2="44" y2="88" stroke="#5D4037" strokeWidth="3" strokeLinecap="round" />
      <Line x1="56" y1="72" x2="56" y2="88" stroke="#5D4037" strokeWidth="3" strokeLinecap="round" />
      <Line x1="64" y1="72" x2="64" y2="88" stroke="#5D4037" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

function CamelIcon({ size = 48 }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Defs>
        <LinearGradient id="cmBg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFF8E1" />
          <Stop offset="100%" stopColor="#FFE0B2" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" rx="16" fill="url(#cmBg)" />
      <Ellipse cx="52" cy="52" rx="22" ry="14" fill="#D4A357" />
      <Path d="M42 44 Q40 34 50 32 Q60 34 58 44" fill="#C69340" />
      <Path d="M30 52 Q28 35 34 28 Q38 24 40 28 L40 44" fill="#D4A357" />
      <Ellipse cx="36" cy="28" rx="5" ry="4" fill="#D4A357" />
      <Path d="M32 24 L30 18" stroke="#C69340" strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M40 24 L42 18" stroke="#C69340" strokeWidth="1.5" strokeLinecap="round" />
      <Circle cx="34" cy="27" r="1.5" fill="#3E2723" />
      <Ellipse cx="36" cy="32" rx="2.5" ry="1.5" fill="#C69340" />
      <Line x1="36" y1="66" x2="36" y2="88" stroke="#C69340" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="44" y1="66" x2="44" y2="88" stroke="#C69340" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="58" y1="66" x2="58" y2="88" stroke="#C69340" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="66" y1="66" x2="66" y2="88" stroke="#C69340" strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

const ANIMAL_ICON_MAP = {
  All: AllAnimalsIcon,
  Cow: CowIcon,
  Buffalo: BuffaloIcon,
  Goat: GoatIcon,
  Bullock: BullockIcon,
  Sheep: SheepIcon,
  Poultry: PoultryIcon,
  Horse: HorseIcon,
  Camel: CamelIcon,
};

export default function AnimalIcon({ type, size = 48 }) {
  const Icon = ANIMAL_ICON_MAP[type];
  if (!Icon) return null;
  return <Icon size={size} />;
}

export { ANIMAL_ICON_MAP };
