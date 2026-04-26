import React from 'react';
import Svg, {
  Defs, LinearGradient, Stop,
  Rect, Ellipse, Path, Circle, G, Line,
} from 'react-native-svg';

const CATEGORY_THEMES = {
  fertilizer: { bg1: '#E8F5E9', bg2: '#A5D6A7', icon: '#388E3C', label: 'leaf' },
  pesticide:  { bg1: '#FBE9E7', bg2: '#FFAB91', icon: '#D84315', label: 'bug' },
  machinery:  { bg1: '#E3F2FD', bg2: '#90CAF9', icon: '#1565C0', label: 'gear' },
  seed:       { bg1: '#FFF8E1', bg2: '#FFE082', icon: '#F9A825', label: 'seed' },
  feed:       { bg1: '#FFF3E0', bg2: '#FFCC80', icon: '#E65100', label: 'paw' },
  animal:     { bg1: '#EFEBE9', bg2: '#BCAAA4', icon: '#4E342E', label: 'animal' },
  tractor:    { bg1: '#E8F5E9', bg2: '#A5D6A7', icon: '#2E7D32', label: 'tractor' },
  harvester:  { bg1: '#FFF8E1', bg2: '#FFE082', icon: '#F57F17', label: 'harvester' },
  sprayer:    { bg1: '#E3F2FD', bg2: '#90CAF9', icon: '#1976D2', label: 'sprayer' },
  person:     { bg1: '#F3E5F5', bg2: '#CE93D8', icon: '#6A1B9A', label: 'person' },
  default:    { bg1: '#F5F5F5', bg2: '#E0E0E0', icon: '#616161', label: 'default' },
};

function getTheme(category) {
  if (!category) return CATEGORY_THEMES.default;
  const key = category.toLowerCase();
  if (key.includes('fertili') || key.includes('khad') || key === '1') return CATEGORY_THEMES.fertilizer;
  if (key.includes('pestic') || key.includes('insect') || key === '2') return CATEGORY_THEMES.pesticide;
  if (key.includes('machin') || key.includes('tractor') || key === '3') return CATEGORY_THEMES.machinery;
  if (key.includes('seed') || key.includes('bij') || key === '4') return CATEGORY_THEMES.seed;
  if (key.includes('feed') || key.includes('animal') || key.includes('paw') || key === '5') return CATEGORY_THEMES.feed;
  if (key.includes('cow') || key.includes('buffalo') || key.includes('goat') || key.includes('sheep') || key.includes('bullock')) return CATEGORY_THEMES.animal;
  if (key.includes('harvest')) return CATEGORY_THEMES.harvester;
  if (key.includes('spray')) return CATEGORY_THEMES.sprayer;
  if (key.includes('labour') || key.includes('worker') || key.includes('person')) return CATEGORY_THEMES.person;
  return CATEGORY_THEMES.default;
}

function LeafShape({ color }) {
  return (
    <G>
      <Path d="M50 25 Q70 30 72 50 Q74 70 50 75 Q26 70 28 50 Q30 30 50 25 Z" fill={color} opacity="0.3" />
      <Path d="M50 30 L50 70" stroke={color} strokeWidth="1.5" opacity="0.5" />
      <Path d="M50 40 L38 35" stroke={color} strokeWidth="1" opacity="0.4" />
      <Path d="M50 50 L62 45" stroke={color} strokeWidth="1" opacity="0.4" />
      <Path d="M50 60 L40 57" stroke={color} strokeWidth="1" opacity="0.4" />
    </G>
  );
}

function BugShape({ color }) {
  return (
    <G>
      <Ellipse cx="50" cy="55" rx="14" ry="18" fill={color} opacity="0.3" />
      <Circle cx="50" cy="35" r="8" fill={color} opacity="0.3" />
      <Line x1="42" y1="32" x2="36" y2="22" stroke={color} strokeWidth="1.5" opacity="0.4" />
      <Line x1="58" y1="32" x2="64" y2="22" stroke={color} strokeWidth="1.5" opacity="0.4" />
      <Line x1="36" y1="48" x2="28" y2="44" stroke={color} strokeWidth="1" opacity="0.3" />
      <Line x1="64" y1="48" x2="72" y2="44" stroke={color} strokeWidth="1" opacity="0.3" />
      <Line x1="36" y1="58" x2="28" y2="60" stroke={color} strokeWidth="1" opacity="0.3" />
      <Line x1="64" y1="58" x2="72" y2="60" stroke={color} strokeWidth="1" opacity="0.3" />
    </G>
  );
}

function GearShape({ color }) {
  return (
    <G>
      <Circle cx="50" cy="50" r="12" fill="none" stroke={color} strokeWidth="3" opacity="0.3" />
      <Circle cx="50" cy="50" r="5" fill={color} opacity="0.2" />
      <Line x1="50" y1="30" x2="50" y2="38" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.3" />
      <Line x1="50" y1="62" x2="50" y2="70" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.3" />
      <Line x1="30" y1="50" x2="38" y2="50" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.3" />
      <Line x1="62" y1="50" x2="70" y2="50" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.3" />
      <Line x1="36" y1="36" x2="42" y2="42" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.3" />
      <Line x1="58" y1="58" x2="64" y2="64" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.3" />
      <Line x1="64" y1="36" x2="58" y2="42" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.3" />
      <Line x1="42" y1="58" x2="36" y2="64" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.3" />
    </G>
  );
}

function SeedShape({ color }) {
  return (
    <G>
      <Path d="M50 28 Q62 35 60 50 Q58 68 50 72 Q42 68 40 50 Q38 35 50 28 Z" fill={color} opacity="0.25" />
      <Path d="M50 32 L50 68" stroke={color} strokeWidth="1.5" opacity="0.4" />
      <Path d="M50 42 Q55 38 58 42" stroke={color} strokeWidth="1" fill="none" opacity="0.3" />
      <Path d="M50 52 Q44 48 42 52" stroke={color} strokeWidth="1" fill="none" opacity="0.3" />
    </G>
  );
}

function PawShape({ color }) {
  return (
    <G>
      <Ellipse cx="50" cy="58" rx="12" ry="10" fill={color} opacity="0.25" />
      <Circle cx="38" cy="44" r="5" fill={color} opacity="0.25" />
      <Circle cx="46" cy="38" r="5" fill={color} opacity="0.25" />
      <Circle cx="54" cy="38" r="5" fill={color} opacity="0.25" />
      <Circle cx="62" cy="44" r="5" fill={color} opacity="0.25" />
    </G>
  );
}

function AnimalShape({ color }) {
  return (
    <G>
      <Ellipse cx="50" cy="55" rx="18" ry="12" fill={color} opacity="0.25" />
      <Circle cx="50" cy="38" r="10" fill={color} opacity="0.25" />
      <Path d="M40 32 L36 22" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <Path d="M60 32 L64 22" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <Line x1="38" y1="67" x2="38" y2="78" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.25" />
      <Line x1="62" y1="67" x2="62" y2="78" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.25" />
    </G>
  );
}

function TractorShape({ color }) {
  return (
    <G>
      <Rect x="25" y="35" width="40" height="22" rx="4" fill={color} opacity="0.25" />
      <Rect x="55" y="30" width="18" height="15" rx="3" fill={color} opacity="0.2" />
      <Circle cx="35" cy="68" r="12" fill="none" stroke={color} strokeWidth="3" opacity="0.3" />
      <Circle cx="35" cy="68" r="5" fill={color} opacity="0.15" />
      <Circle cx="65" cy="68" r="8" fill="none" stroke={color} strokeWidth="2.5" opacity="0.3" />
      <Circle cx="65" cy="68" r="3" fill={color} opacity="0.15" />
    </G>
  );
}

function HarvesterShape({ color }) {
  return (
    <G>
      <Rect x="20" y="32" width="50" height="26" rx="5" fill={color} opacity="0.25" />
      <Rect x="62" y="28" width="16" height="16" rx="3" fill={color} opacity="0.2" />
      <Circle cx="32" cy="68" r="10" fill="none" stroke={color} strokeWidth="2.5" opacity="0.3" />
      <Circle cx="60" cy="68" r="10" fill="none" stroke={color} strokeWidth="2.5" opacity="0.3" />
      <Path d="M20 45 L10 45 L10 58 L20 52" fill={color} opacity="0.2" />
    </G>
  );
}

function SprayerShape({ color }) {
  return (
    <G>
      <Rect x="40" y="30" width="12" height="30" rx="4" fill={color} opacity="0.25" />
      <Rect x="38" y="26" width="16" height="6" rx="3" fill={color} opacity="0.2" />
      <Path d="M46 60 L36 72" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <Path d="M46 60 L56 72" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <Circle cx="36" cy="74" r="2" fill={color} opacity="0.25" />
      <Circle cx="56" cy="74" r="2" fill={color} opacity="0.25" />
      <Circle cx="30" cy="78" r="1.5" fill={color} opacity="0.2" />
      <Circle cx="62" cy="78" r="1.5" fill={color} opacity="0.2" />
    </G>
  );
}

function PersonShape({ color }) {
  return (
    <G>
      <Circle cx="50" cy="34" r="10" fill={color} opacity="0.25" />
      <Path d="M38 48 Q38 44 50 44 Q62 44 62 48 L62 65 Q62 68 58 68 L42 68 Q38 68 38 65 Z" fill={color} opacity="0.2" />
      <Line x1="44" y1="68" x2="44" y2="80" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.2" />
      <Line x1="56" y1="68" x2="56" y2="80" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.2" />
    </G>
  );
}

function DefaultShape({ color }) {
  return (
    <G>
      <Rect x="30" y="30" width="40" height="40" rx="8" fill={color} opacity="0.2" />
      <Circle cx="50" cy="50" r="10" fill="none" stroke={color} strokeWidth="2" opacity="0.3" />
    </G>
  );
}

const SHAPE_MAP = {
  leaf: LeafShape,
  bug: BugShape,
  gear: GearShape,
  seed: SeedShape,
  paw: PawShape,
  animal: AnimalShape,
  tractor: TractorShape,
  harvester: HarvesterShape,
  sprayer: SprayerShape,
  person: PersonShape,
  default: DefaultShape,
};

export default function MockImagePlaceholder({ category, size = 100, style }) {
  const theme = getTheme(category);
  const Shape = SHAPE_MAP[theme.label] || SHAPE_MAP.default;
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size} style={style}>
      <Defs>
        <LinearGradient id={`mip_${theme.label}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={theme.bg1} />
          <Stop offset="100%" stopColor={theme.bg2} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill={`url(#mip_${theme.label})`} />
      <Shape color={theme.icon} />
    </Svg>
  );
}

export { getTheme, CATEGORY_THEMES };
