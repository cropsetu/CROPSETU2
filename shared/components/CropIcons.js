/**
 * CropIcons.js — Beautiful SVG illustrations for all 66 Indian crops
 *
 * Every icon:
 *   • viewBox="0 0 200 200"
 *   • radialGradient + linearGradient for 3D shading
 *   • Drop-shadow filter
 *   • Soft ground shadow ellipse at cy≈178
 *   • Highlight/shine overlay (top-left)
 *   • Realistic crop-specific colour palette
 *
 * Usage:
 *   <CropIcon crop="Tomato" size={56} />
 */

import React from 'react';
import { View } from 'react-native';
import { COLORS } from '../constants/colors';
import Svg, {
  Ellipse, Circle, Path, Rect, G, Line,
} from 'react-native-svg';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Tiny shadow ellipse at bottom of every icon */
const Shadow = ({ cx = 100, rx = 44, ry = 8 }) => (
  <Ellipse cx={cx} cy={178} rx={rx} ry={ry} fill="rgba(0,0,0,0.13)" />
);

// ─────────────────────────────────────────────────────────────────────────────
// ── VEGETABLES ───────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function TomatoIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow />
      <Circle cx="100" cy="107" r="66" fill="#DC2626" opacity="0.15" />
      <Path d="M36 105 Q36 52 100 42 Q164 52 164 105 Q164 158 100 170 Q36 158 36 105Z" fill="#DC2626" />
      <Path d="M42 98 Q100 92 158 98" stroke="rgba(180,30,30,0.12)" strokeWidth="1.5" fill="none" />
      <Path d="M44 115 Q100 110 156 115" stroke="rgba(180,30,30,0.1)" strokeWidth="1.5" fill="none" />
      <Path d="M100 42 Q100 108 100 170" stroke="rgba(180,30,30,0.08)" strokeWidth="1.5" fill="none" />
      <Path d="M36 105 Q36 52 100 42 Q164 52 164 105 Q164 158 100 170 Q36 158 36 105Z" fill="rgba(255,255,255,0.12)" />
      <Path d="M36 105 Q36 52 100 42 Q164 52 164 105 Q164 158 100 170 Q36 158 36 105Z" fill="rgba(0,0,0,0.05)" />
      <Ellipse cx="78" cy="78" rx="18" ry="10" fill="rgba(255,255,255,0.18)" />
      <Path d="M78 52 Q86 40 100 44 Q86 52 80 56Z" fill="#2E7D32" />
      <Path d="M122 52 Q114 40 100 44 Q114 52 120 56Z" fill="#388E3C" />
      <Path d="M86 48 Q94 36 100 44 Q92 50 86 48Z" fill="#43A047" />
      <Path d="M114 48 Q106 36 100 44 Q108 50 114 48Z" fill="#43A047" />
      <Path d="M96 46 Q100 38 104 46" fill="#1B5E20" />
      <Path d="M100 44 Q101 34 103 26" stroke="#33691E" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Circle cx="130" cy="130" r="3" fill="rgba(255,200,200,0.15)" />
      <Circle cx="76" cy="135" r="2.5" fill="rgba(255,200,200,0.12)" />
    </Svg>
  );
}

function OnionIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={44} />
      <Path d="M100 58 Q148 62 162 112 Q162 162 100 172 Q38 162 38 112 Q52 62 100 58Z" fill="#9C27B0" />
      <Path d="M56 96 Q60 86 82 80" stroke="rgba(255,255,255,0.22)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <Path d="M60 112 Q64 100 90 94" stroke="rgba(255,255,255,0.16)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <Path d="M66 128 Q70 118 96 112" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <Path d="M140 100 Q138 88 120 82" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <Path d="M100 58 Q148 62 162 112 Q162 162 100 172 Q38 162 38 112 Q52 62 100 58Z" fill="rgba(255,255,255,0.12)" />
      <Path d="M100 58 Q148 62 162 112 Q162 162 100 172 Q38 162 38 112 Q52 62 100 58Z" fill="rgba(0,0,0,0.05)" />
      <Path d="M88 58 Q100 44 112 58" fill="#4A148C" />
      <Ellipse cx="100" cy="168" rx="14" ry="6" fill="rgba(80,20,100,0.25)" />
      <Path d="M96 50 Q92 30 88 14" stroke="#66BB6A" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <Path d="M104 48 Q108 28 114 16" stroke="#43A047" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Path d="M100 52 Q100 36 100 22" stroke="#81C784" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function PotatoIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={54} ry={9} />
      <Path d="M30 102 Q32 62 72 52 Q100 48 128 52 Q168 62 170 102 Q170 148 128 158 Q100 162 72 158 Q30 148 30 102Z" fill="#A1887F" />
      <Path d="M30 102 Q32 62 72 52 Q100 48 128 52 Q168 62 170 102 Q170 148 128 158 Q100 162 72 158 Q30 148 30 102Z" fill="rgba(255,255,255,0.12)" />
      <Path d="M30 102 Q32 62 72 52 Q100 48 128 52 Q168 62 170 102 Q170 148 128 158 Q100 162 72 158 Q30 148 30 102Z" fill="rgba(0,0,0,0.05)" />
      <Circle cx="75"  cy="94"  r="4.5" fill="rgba(93,64,55,0.5)" />
      <Circle cx="74"  cy="93"  r="2"   fill="rgba(93,64,55,0.7)" />
      <Circle cx="118" cy="104" r="4"   fill="rgba(93,64,55,0.45)" />
      <Circle cx="117" cy="103" r="1.8" fill="rgba(93,64,55,0.65)" />
      <Circle cx="92"  cy="120" r="3.5" fill="rgba(93,64,55,0.4)" />
      <Circle cx="91"  cy="119" r="1.6" fill="rgba(93,64,55,0.6)" />
      <Circle cx="140" cy="116" r="3"   fill="rgba(93,64,55,0.35)" />
      <Circle cx="62"  cy="112" r="2.8" fill="rgba(93,64,55,0.3)" />
      <Path d="M45 90 Q56 84 70 82" stroke="rgba(120,70,40,0.1)" strokeWidth="1.5" fill="none" />
      <Path d="M42 110 Q60 104 80 102" stroke="rgba(120,70,40,0.08)" strokeWidth="1.5" fill="none" />
    </Svg>
  );
}

function BrinjalIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={36} ry={7} />
      {/* Main body — solid dark purple */}
      <Path d="M56 118 Q54 68 80 54 Q100 50 120 54 Q146 68 144 118 Q144 172 100 180 Q56 172 56 118Z" fill="#6A1B9A" />
      {/* Lighter left highlight */}
      <Path d="M62 110 Q60 74 82 60 Q92 56 100 58 Q80 66 72 100 Q68 130 70 156 Q60 148 62 110Z" fill="#8E24AA" />
      {/* Shine spot */}
      <Ellipse cx="76" cy="88" rx="8" ry="14" fill="rgba(255,255,255,0.18)" />
      {/* Calyx (green cap) */}
      <Path d="M78 58 Q100 42 122 58 Q114 50 100 48 Q86 50 78 58Z" fill="#2E7D32" />
      {/* Stem */}
      <Path d="M100 48 Q98 38 96 28" stroke="#33691E" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function CauliflowerIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={58} ry={9} />
      {/* Leaves behind */}
      <Path d="M28 132 Q16 98 48 82 Q58 114 68 126Z" fill="#388E3C" />
      <Path d="M172 132 Q184 98 152 82 Q142 114 132 126Z" fill="#2E7D32" />
      <Path d="M52 148 Q36 130 52 108 Q68 130 74 148Z" fill="#43A047" />
      <Path d="M148 148 Q164 130 148 108 Q132 130 126 148Z" fill="#388E3C" />
      {/* Main white head */}
      <Ellipse cx="100" cy="110" rx="70" ry="54" fill="#F5F0E0" />
      {/* Floret bumps — solid cream circles */}
      {[
        [78,86],[100,78],[122,86],[66,104],[90,96],[112,96],[134,104],
        [78,118],[100,112],[122,118],[72,132],[100,128],[128,132],
      ].map(([cx,cy],i) => (
        <Circle key={i} cx={cx} cy={cy} r="12" fill={i % 2 === 0 ? '#EDE8D0' : '#E8E3C8'} />
      ))}
      {/* Highlight */}
      <Ellipse cx="88" cy="92" rx="18" ry="12" fill="rgba(255,255,255,0.35)" />
    </Svg>
  );
}

function CabbageIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={58} />
      {/* Outer dark leaves */}
      <Ellipse cx="100" cy="108" rx="72" ry="64" fill="#2E7D32" />
      {/* Mid leaves */}
      <Ellipse cx="100" cy="108" rx="60" ry="54" fill="#43A047" />
      {/* Inner lighter head */}
      <Ellipse cx="100" cy="108" rx="46" ry="42" fill="#66BB6A" />
      {/* Core light center */}
      <Ellipse cx="100" cy="104" rx="28" ry="26" fill="#A5D6A7" />
      {/* Leaf vein lines */}
      <Path d="M38 100 Q68 116 100 108" stroke="rgba(255,255,255,0.3)" strokeWidth="2" fill="none" />
      <Path d="M162 100 Q132 116 100 108" stroke="rgba(255,255,255,0.3)" strokeWidth="2" fill="none" />
      <Path d="M50 130 Q75 140 100 135" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" fill="none" />
      <Path d="M150 130 Q125 140 100 135" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" fill="none" />
      {/* Highlight */}
      <Ellipse cx="88" cy="94" rx="16" ry="10" fill="rgba(255,255,255,0.2)" />
    </Svg>
  );
}

function OkraIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={28} ry={7} />
      <Path d="M100 30 Q120 44 120 108 Q110 164 100 176 Q90 164 80 108 Q80 44 100 30Z" fill="#43A047" />
      <Path d="M100 34 Q108 80 108 152" stroke="rgba(0,60,0,0.25)" strokeWidth="1.5" fill="none" />
      <Path d="M100 34 Q92 80 92 152" stroke="rgba(0,60,0,0.25)" strokeWidth="1.5" fill="none" />
      <Path d="M100 34 Q114 80 114 148" stroke="rgba(0,60,0,0.15)" strokeWidth="1" fill="none" />
      <Path d="M100 34 Q86 80 86 148" stroke="rgba(0,60,0,0.15)" strokeWidth="1" fill="none" />
      <Path d="M95 42 Q91 72 92 120" stroke="rgba(255,255,255,0.35)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Path d="M88 36 Q100 24 112 36 Q106 28 100 30 Q94 28 88 36Z" fill="#388E3C" />
      <Path d="M100 30 Q99 22 98 14" stroke="#33691E" strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function CapsicumIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={54} ry={8} />
      <Path d="M58 78 Q52 58 68 48 Q88 42 100 46 Q112 42 132 48 Q148 58 142 78 Q150 100 142 132 Q130 164 100 170 Q70 164 58 132 Q50 100 58 78Z" fill="#F57C00" />
      <Path d="M58 78 Q52 58 68 48 Q88 42 100 46 Q112 42 132 48 Q148 58 142 78 Q150 100 142 132 Q130 164 100 170 Q70 164 58 132 Q50 100 58 78Z" fill="rgba(255,255,255,0.12)" />
      <Path d="M58 78 Q52 58 68 48 Q88 42 100 46 Q112 42 132 48 Q148 58 142 78 Q150 100 142 132 Q130 164 100 170 Q70 164 58 132 Q50 100 58 78Z" fill="rgba(0,0,0,0.05)" />
      <Path d="M100 66 Q100 112 100 167" stroke="rgba(0,0,0,0.12)" strokeWidth="1.8" fill="none" />
      <Path d="M78 62 Q74 100 76 157" stroke="rgba(0,0,0,0.08)" strokeWidth="1.5" fill="none" />
      <Path d="M122 62 Q126 100 124 157" stroke="rgba(0,0,0,0.08)" strokeWidth="1.5" fill="none" />
      <Ellipse cx="72" cy="82" rx="12" ry="7" fill="rgba(255,255,255,0.15)" />
      <Path d="M100 46 Q101 34 102 24" stroke="#388E3C" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M86 48 Q82 40 100 46 Q84 50 86 48Z" fill="#2E7D32" />
      <Path d="M114 48 Q118 40 100 46 Q116 50 114 48Z" fill="#388E3C" />
    </Svg>
  );
}

function CucumberIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={36} ry={7} />
      <Ellipse cx="100" cy="105" rx="38" ry="74" fill="#388E3C" />
      <Ellipse cx="100" cy="105" rx="38" ry="74" fill="rgba(255,255,255,0.12)" />
      {[0,1,2,3,4].map(i => (
        <Path key={i} d={`M${82+i*9} 36 Q${82+i*9} 105 ${82+i*9} 174`}
          stroke="rgba(0,80,0,0.18)" strokeWidth="2" fill="none" />
      ))}
      {[55,75,95,115,135,155].map((y,i) => (
        <Circle key={`b${i}`} cx={94+((i*7)%12)} cy={y} r="1.5" fill="rgba(0,80,0,0.12)" />
      ))}
      <Ellipse cx="86" cy="78" rx="10" ry="28" fill="rgba(255,255,255,0.22)" />
      <Path d="M100 175 Q108 170 100 165 Q92 170 100 175Z" fill="#FDD835" />
      <Path d="M100 32 Q99 24 99 16" stroke="#388E3C" strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function PumpkinIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={66} ry={9} />
      {/* Pumpkin lobes — solid orange fills */}
      {[-40,-20,0,20,40].map((dx, i) => (
        <Ellipse key={i} cx={100+dx} cy="112" rx="27" ry="58"
          fill={['#E65100','#EF6C00','#F57C00','#EF6C00','#E65100'][i]} />
      ))}
      {/* Ridge lines */}
      {[-30,-10,10,30].map((dx, i) => (
        <Path key={`r${i}`} d={`M${100+dx} 56 Q${100+dx} 112 ${100+dx} 168`}
          stroke="rgba(120,40,0,0.2)" strokeWidth="1.5" fill="none" />
      ))}
      {/* Highlight */}
      <Ellipse cx="80" cy="86" rx="14" ry="22" fill="rgba(255,255,255,0.18)" />
      {/* Stem */}
      <Path d="M100 54 Q98 42 96 30" stroke="#5D4037" strokeWidth="5" strokeLinecap="round" fill="none" />
      <Path d="M96 42 Q86 34 80 24" stroke="#388E3C" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function CarrotIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={26} ry={6} />
      <Path d="M78 42 Q118 42 116 100 Q112 150 100 176 Q88 150 84 100 Q82 42 78 42Z" fill="#F57C00" />
      <Path d="M78 42 Q118 42 116 100 Q112 150 100 176 Q88 150 84 100 Q82 42 78 42Z" fill="rgba(255,255,255,0.12)" />
      {[68,88,108,130,150].map((y, i) => (
        <Path key={i} d={`M${85+i} ${y} Q100 ${y-3} ${115-i} ${y}`}
          stroke="rgba(180,60,0,0.18)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      ))}
      <Path d="M89 48 Q87 88 88 145" stroke="rgba(255,255,255,0.35)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M93 50 Q91 85 92 130" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <Path d="M100 40 Q94 26 86 14" stroke="#388E3C" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 40 Q100 22 100 10" stroke="#43A047" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 40 Q106 26 114 14" stroke="#2E7D32" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 40 Q92 30 84 22" stroke="#66BB6A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M100 40 Q108 30 116 22" stroke="#81C784" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function GreenChilliIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={24} ry={6} />
      <Path d="M100 40 Q132 52 140 100 Q142 150 122 174 Q110 164 100 174 Q90 164 78 174 Q58 150 60 100 Q68 52 100 40Z" fill="#388E3C" />
      <Path d="M98 44 Q106 80 108 142" stroke="rgba(255,255,255,0.3)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Path d="M102 48 Q110 82 112 136" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <Path d="M88 44 Q80 48 100 40 Q86 46 88 44Z" fill="#388E3C" />
      <Path d="M112 44 Q120 48 100 40 Q114 46 112 44Z" fill="#43A047" />
      <Path d="M100 40 Q99 30 98 20" stroke="#33691E" strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function GarlicIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={48} ry={8} />
      <Ellipse cx="100" cy="112" rx="60" ry="58" fill="#E0E0E0" />
      {[[-24,0],[0,-20],[24,0],[0,20],[-16,-14],[16,-14],[-16,14],[16,14]].map(([dx,dy],i) => (
        <Ellipse key={i} cx={100+dx} cy={112+dy} rx="17" ry="15"
          fill="rgba(200,200,210,0.4)" />
      ))}
      <Ellipse cx="100" cy="112" rx="60" ry="58" fill="#BDBDBD" opacity="0.55" />
      <Ellipse cx="100" cy="112" rx="60" ry="58" fill="rgba(255,255,255,0.12)" />
      <Ellipse cx="80" cy="90" rx="14" ry="8" fill="rgba(255,255,255,0.35)" />
      <Path d="M100 54 Q99 40 98 26" stroke="#A1887F" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M96 38 Q90 28 86 18" stroke="#AED581" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function GingerIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={62} ry={8} />
      <Path d="M42 115 Q40 94 60 90 Q80 88 100 92 Q120 88 140 90 Q160 94 158 115 Q160 138 140 142 Q120 144 100 140 Q80 144 60 142 Q40 138 42 115Z" fill="#A1887F" />
      <Ellipse cx="56"  cy="104" rx="22" ry="18" fill="#BCAAA4" />
      <Ellipse cx="144" cy="106" rx="20" ry="17" fill="#A1887F" />
      <Ellipse cx="78"  cy="136" rx="18" ry="14" fill="#BCAAA4" />
      <Ellipse cx="126" cy="134" rx="16" ry="13" fill="#A1887F" />
      <Path d="M58 100 Q88 110 142 106" stroke="rgba(80,40,20,0.15)" strokeWidth="1.5" fill="none" />
      <Path d="M65 120 Q95 126 135 122" stroke="rgba(80,40,20,0.1)" strokeWidth="1.5" fill="none" />
      <Ellipse cx="82" cy="102" rx="16" ry="9" fill="rgba(255,255,255,0.2)" />
      <Path d="M56 86 Q54 76 56 68" stroke="#AED581" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Path d="M148 88 Q152 80 150 72" stroke="#C5E1A5" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function SpinachIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={58} ry={8} />
      {/* Cluster of leaves */}
      <Path d="M100 150 Q70 130 50 90 Q60 60 90 55 Q100 52 110 55 Q130 52 145 75 Q155 100 140 125 Q125 148 100 150Z" fill="#43A047" />
      <Path d="M100 150 Q80 140 72 110 Q80 80 100 75 Q120 80 128 110 Q120 140 100 150Z" fill={COLORS.sellerAccentLight} opacity="0.6" />
      {/* Veins */}
      <Path d="M100 150 Q100 105 100 60" stroke="rgba(255,255,255,0.35)" strokeWidth="2" fill="none" />
      <Path d="M100 110 Q80 102 60 92" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" fill="none" />
      <Path d="M100 110 Q120 102 140 92" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" fill="none" />
      <Path d="M100 90 Q82 84 68 76" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none" />
      <Path d="M100 90 Q118 84 132 76" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none" />
    </Svg>
  );
}

function PeasIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={62} ry={7} />
      <Path d="M36 100 Q38 58 100 48 Q162 58 164 100 Q162 142 100 152 Q38 142 36 100Z" fill="#43A047" />
      {[58,80,102,124,146].map((cx, i) => (
        <G key={i}>
          <Circle cx={cx} cy="100" r="17" fill="rgba(76,175,80,0.45)" />
          <Circle cx={cx-3} cy="96" r="6" fill="rgba(255,255,255,0.18)" />
        </G>
      ))}
      <Path d="M54 66 Q100 55 146 66" stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M50 76 Q100 65 150 76" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <Path d="M164 100 Q170 88 168 76" stroke="#388E3C" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M36 100 Q32 90 34 80" stroke="#43A047" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── FRUITS ───────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function MangoIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={48} ry={8} />
      <Path d="M100 38 Q155 56 152 118 Q150 166 100 174 Q50 166 48 118 Q45 56 100 38Z" fill="#FFCA28" />
      <Path d="M100 38 Q155 56 152 118 Q150 166 100 174 Q50 166 48 118 Q45 56 100 38Z" fill="rgba(255,255,255,0.12)" />
      <Path d="M100 38 Q155 56 152 118 Q150 166 100 174 Q50 166 48 118 Q45 56 100 38Z" fill="rgba(200,80,0,0.08)" />
      <Path d="M100 38 Q155 56 152 118 Q150 166 100 174 Q50 166 48 118 Q45 56 100 38Z" fill="rgba(46,125,50,0.06)" />
      <Ellipse cx="76" cy="72" rx="16" ry="9" fill="rgba(255,255,255,0.2)" />
      <Circle cx="125" cy="140" r="4" fill="rgba(230,130,0,0.12)" />
      <Circle cx="70"  cy="145" r="3" fill="rgba(230,130,0,0.1)" />
      <Path d="M100 38 Q100 26 101 18" stroke="#5D4037" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 26 Q92 18 86 12" stroke="#388E3C" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M100 26 Q108 20 114 16" stroke="#43A047" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function BananaIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={56} ry={7} />
      <Path d="M38 158 Q32 98 64 56 Q98 24 152 34 Q168 38 164 54 Q150 48 134 54 Q86 76 66 130 Q54 156 38 158Z" fill="#FDD835" />
      <Path d="M38 158 Q32 98 64 56 Q98 24 152 34 Q168 38 164 54 Q150 48 134 54 Q86 76 66 130 Q54 156 38 158Z" fill="rgba(180,120,0,0.08)" />
      <Path d="M43 150 Q48 104 76 66 Q108 34 150 40" stroke="rgba(180,120,0,0.3)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <Path d="M52 144 Q54 98 80 62 Q112 30 152 38" stroke="rgba(255,255,255,0.35)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <Path d="M60 138 Q62 96 84 64 Q110 38 148 42" stroke="rgba(255,255,255,0.15)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <Circle cx="95"  cy="85"  r="2" fill="rgba(120,80,0,0.08)" />
      <Circle cx="78"  cy="110" r="2.5" fill="rgba(120,80,0,0.06)" />
      <Path d="M38 158 Q32 164 28 170" stroke="#5D4037" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <Path d="M160 44 Q164 36 166 30" stroke="#795548" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function GrapesIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={52} ry={8} />
      {[
        [70,72],[100,70],[130,72],
        [55,98],[85,96],[115,96],[145,98],
        [70,124],[100,122],[130,124],
        [85,150],[115,150],
        [100,174],
      ].map(([cx,cy],i) => (
        <G key={i}>
          <Circle cx={cx} cy={cy} r="22" fill="#7B1FA2" />
          <Circle cx={cx} cy={cy} r="22" fill="rgba(255,255,255,0.12)" />
          <Ellipse cx={cx-6} cy={cy-7} rx="6" ry="4" fill="rgba(255,255,255,0.25)" />
          <Circle cx={cx+4} cy={cy+5} r="2" fill="rgba(40,0,60,0.12)" />
        </G>
      ))}
      <Path d="M100 48 Q100 36 100 24" stroke="#5D4037" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 34 Q88 26 78 18" stroke="#388E3C" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M100 34 Q112 28 122 22" stroke="#43A047" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M100 38 Q90 42 82 48" stroke="#43A047" strokeWidth="2" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function OrangeIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow />
      <Circle cx="100" cy="106" r="66" fill="#FB8C00" />
      <Circle cx="100" cy="106" r="66" fill="rgba(255,255,255,0.12)" />
      <Circle cx="100" cy="106" r="66" fill="rgba(0,0,0,0.05)" />
      <Circle cx="100" cy="44" r="7" fill="rgba(200,80,0,0.25)" />
      {[0,1,2,3,4,5,6,7,8,9,10,11].map(i => {
        const angle = (i / 12) * Math.PI * 2;
        const r = 38 + (i % 2) * 8;
        return <Circle key={i} cx={100+r*Math.cos(angle)} cy={106+r*Math.sin(angle)} r={2 + (i % 3)} fill="rgba(200,80,0,0.08)" />;
      })}
      <Ellipse cx="78" cy="80" rx="14" ry="8" fill="rgba(255,255,255,0.15)" />
      <Path d="M100 40 Q99 30 98 20" stroke="#5D4037" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M97 28 Q90 20 84 14" stroke="#388E3C" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function AppleIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow />
      <Path d="M100 54 Q66 46 48 78 Q38 108 48 142 Q60 170 100 174 Q140 170 152 142 Q162 108 152 78 Q134 46 100 54Z" fill="#E53935" />
      <Path d="M100 54 Q66 46 48 78 Q38 108 48 142 Q60 170 100 174 Q140 170 152 142 Q162 108 152 78 Q134 46 100 54Z" fill="rgba(255,255,255,0.12)" />
      <Path d="M100 54 Q66 46 48 78 Q38 108 48 142 Q60 170 100 174 Q140 170 152 142 Q162 108 152 78 Q134 46 100 54Z" fill="rgba(76,175,80,0.06)" />
      <Path d="M100 54 Q66 46 48 78 Q38 108 48 142 Q60 170 100 174 Q140 170 152 142 Q162 108 152 78 Q134 46 100 54Z" fill="rgba(0,0,0,0.05)" />
      <Path d="M86 56 Q100 50 114 56" stroke="rgba(150,0,0,0.25)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <Ellipse cx="72" cy="86" rx="14" ry="8" fill="rgba(255,255,255,0.16)" />
      <Circle cx="130" cy="140" r="4" fill="rgba(255,200,200,0.12)" />
      <Circle cx="65" cy="130" r="3" fill="rgba(255,200,200,0.1)" />
      <Path d="M100 52 Q100 38 100 28" stroke="#5D4037" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <Path d="M100 40 Q90 32 82 24" stroke="#388E3C" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function WatermelonIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={68} ry={9} />
      <Ellipse cx="100" cy="106" rx="68" ry="62" fill="#388E3C" />
      {[-28,-14,0,14,28].map((dy,i) => (
        <Path key={i} d={`M${34+i*2} ${106+dy} Q100 ${98+dy} ${166-i*2} ${106+dy}`}
          stroke="rgba(27,94,32,0.2)" strokeWidth="6" fill="none" strokeLinecap="round" />
      ))}
      <Ellipse cx="100" cy="106" rx="68" ry="62" fill="rgba(255,255,255,0.12)" />
      <Ellipse cx="78" cy="80" rx="18" ry="10" fill="rgba(255,255,255,0.2)" />
      <Circle cx="120" cy="140" r="3" fill="rgba(27,94,32,0.1)" />
      <Circle cx="72" cy="130" r="2.5" fill="rgba(27,94,32,0.08)" />
    </Svg>
  );
}

function PineappleIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={38} ry={7} />
      <Ellipse cx="100" cy="130" rx="48" ry="62" fill="#F9A825" />
      <Ellipse cx="100" cy="130" rx="48" ry="62" fill="rgba(255,255,255,0.12)" />
      {[0,1,2,3,4].map(row =>
        [0,1,2,3].map(col => (
          <G key={`${row}-${col}`}>
            <Path
              d={`M${64+col*18} ${82+row*16} L${73+col*18} ${74+row*16} L${82+col*18} ${82+row*16} L${73+col*18} ${90+row*16} Z`}
              fill="rgba(180,100,0,0.18)" stroke="rgba(180,100,0,0.12)" strokeWidth="0.5" />
            <Circle cx={73+col*18} cy={82+row*16} r="1.5" fill="rgba(120,60,0,0.15)" />
          </G>
        ))
      )}
      {[[-18,-8],[-10,-18],[-2,-24],[6,-20],[14,-12]].map(([dx,dy],i) => (
        <Path key={i} d={`M${100+dx} 70 Q${100+dx+dy/3} 52 ${100+dx+dy/2} 40`}
          stroke={i < 2 ? "#388E3C" : i === 2 ? "#2E7D32" : "#43A047"} strokeWidth={5-Math.abs(i-2)} strokeLinecap="round" fill="none" />
      ))}
    </Svg>
  );
}

function CoconutIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={60} ry={9} />
      <Ellipse cx="100" cy="108" rx="72" ry="64" fill="#6D4C41" />
      <Ellipse cx="100" cy="108" rx="72" ry="64" fill="rgba(255,255,255,0.12)" />
      {[-32,-16,0,16,32].map((dx,i) => (
        <Path key={i} d={`M${100+dx} 44 Q${100+dx+6} 108 ${100+dx} 170`}
          stroke="rgba(60,30,10,0.15)" strokeWidth="1.5" fill="none" />
      ))}
      {[-20,-6,8,22].map((dx,i) => (
        <Path key={`h${i}`} d={`M30 ${90+i*12} Q100 ${88+i*12} 170 ${90+i*12}`}
          stroke="rgba(60,30,10,0.08)" strokeWidth="1" fill="none" />
      ))}
      <Circle cx="86" cy="78" r="5.5" fill="#3E2723" />
      <Circle cx="86" cy="78" r="3" fill="#2E1B14" />
      <Circle cx="104" cy="74" r="5.5" fill="#3E2723" />
      <Circle cx="104" cy="74" r="3" fill="#2E1B14" />
      <Circle cx="114" cy="88" r="4.5" fill="#3E2723" />
      <Circle cx="114" cy="88" r="2.5" fill="#2E1B14" />
      <Ellipse cx="76" cy="82" rx="18" ry="12" fill="rgba(255,255,255,0.15)" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── CEREALS ──────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function WheatIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={32} ry={6} />
      <Path d="M100 178 Q100 100 100 48" stroke="url(#whStem)" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <Path d="M100 140 Q120 130 140 136" stroke="#7CB342" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M100 160 Q80 150 64 156" stroke="#8BC34A" strokeWidth="2" strokeLinecap="round" fill="none" />
      {[0,1,2,3,4,5,6].map(i => {
        const y = 46 + i * 18;
        const side = i % 2 === 0 ? -1 : 1;
        return (
          <G key={i}>
            <Ellipse cx={100 + side * 22} cy={y+5} rx="17" ry="9.5" fill="#F9A825" transform={`rotate(${side * -28}, ${100 + side * 22}, ${y+5})`} />
            <Ellipse cx={100 + side * 19} cy={y+3} rx="8" ry="5" fill="rgba(255,255,255,0.2)" transform={`rotate(${side * -28}, ${100 + side * 22}, ${y+5})`} />
            <Path d={`M100 ${y} L${100 + side * 22} ${y+5}`} stroke="#AED581" strokeWidth="1.8" />
            <Path d={`M${100 + side * 37} ${y-1} L${100 + side * 50} ${y-16}`} stroke="#F9A825" strokeWidth="1.2" strokeLinecap="round" />
          </G>
        );
      })}
      <Path d="M100 46 Q100 34 100 22" stroke="#F9A825" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M100 36 Q98 28 96 18" stroke="#F9A825" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function RiceIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={30} ry={6} />
      <Path d="M100 178 Q102 132 108 82 Q106 56 102 42" stroke="url(#rcStem)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 150 Q80 140 62 148" stroke="#8BC34A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M104 128 Q124 118 140 126" stroke="#9CCC65" strokeWidth="2" strokeLinecap="round" fill="none" />
      {[-3,-2,-1,0,1,2,3].map(col =>
        [0,1,2,3].map(row => {
          const cx = 102 + col * 10 + row * 3;
          const cy = 48 + row * 20 + Math.abs(col) * 5;
          return (
            <G key={`${col}-${row}`}>
              <Ellipse cx={cx} cy={cy} rx="6.5" ry="9.5"
                fill="#FFD54F" transform={`rotate(15,${cx},${cy})`} />
              <Ellipse cx={cx-2} cy={cy-2} rx="3" ry="4"
                fill="rgba(255,255,255,0.2)" transform={`rotate(15,${cx},${cy})`} />
            </G>
          );
        })
      )}
    </Svg>
  );
}

function MaizeIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={30} ry={7} />
      {/* Husk leaves */}
      <Path d="M72 170 Q60 130 68 80 Q78 60 88 60 Q88 120 78 170Z" fill={COLORS.leafGreen} />
      <Path d="M128 170 Q140 130 132 80 Q122 60 112 60 Q112 120 122 170Z" fill={COLORS.sellerAccentLight} />
      {/* Cob */}
      <Rect x="82" y="56" width="36" height="120" rx="18" fill="#F9A825" />
      {/* Kernel grid */}
      {[0,1,2,3,4,5].map(col =>
        [0,1,2,3,4,5,6,7,8].map(row => (
          <Ellipse key={`${col}-${row}`}
            cx={88+col*6} cy={70+row*12}
            rx="2.5" ry="3"
            fill="rgba(200,120,0,0.3)" />
        ))
      )}
      {/* Silk */}
      <Path d="M100 56 Q96 44 94 34" stroke={COLORS.peachLight} strokeWidth="2" strokeLinecap="round" fill="none" />
      <Path d="M100 56 Q102 42 104 32" stroke={COLORS.orangeLight} strokeWidth="2" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function BajraIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={24} ry={6} />
      {/* Stalk */}
      <Path d="M100 175 Q100 120 100 80" stroke={COLORS.limeLight} strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Head — cylindrical seed cluster */}
      <Ellipse cx="100" cy="80" rx="20" ry="52" fill="#A1887F" />
      {/* Seed bumps */}
      {[0,1,2,3,4,5,6,7,8].map(row =>
        [-2,-1,0,1,2].map(col => (
          <Circle key={`${row}-${col}`}
            cx={100+col*7} cy={38+row*10}
            r="4" fill="rgba(60,30,10,0.25)" />
        ))
      )}
      {/* Shine */}
      <Ellipse cx="88" cy="54" rx="8" ry="24" fill="rgba(255,255,255,0.2)" />
    </Svg>
  );
}

// Generic stalk+round-head for Jowar/Barley/Ragi
function GrainHeadIcon({ size, bgFrom, bgTo, headRx = 22, headRy = 48 }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={22} ry={6} />
      <Path d="M100 175 Q100 120 100 80" stroke={COLORS.limeLight} strokeWidth="5" strokeLinecap="round" fill="none" />
      <Ellipse cx="100" cy="78" rx={headRx} ry={headRy} fill="#8D6E63" />
      {[0,1,2,3,4,5].map(row =>
        [-1,0,1].map(col => (
          <Ellipse key={`${row}-${col}`}
            cx={100+col*10} cy={40+row*14}
            rx="5" ry="7" fill="rgba(0,0,0,0.12)" />
        ))
      )}
      <Ellipse cx="90" cy="52" rx="6" ry="20" fill="rgba(255,255,255,0.22)" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── PULSES ───────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/** Generic seeds scattered in a small pile */
function SeedPileIcon({ size, c1, c2, c3, seedRx = 14, seedRy = 11 }) {
  const seeds = [
    [72,120],[100,108],[128,120],[86,140],[114,140],[100,154],
    [60,138],[140,138],
  ];
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={56} ry={8} />
      {seeds.map(([cx,cy],i) => (
        <G key={i}>
          <Ellipse cx={cx} cy={cy} rx={seedRx} ry={seedRy} fill="#A1887F" transform={`rotate(${i*22},${cx},${cy})`} />
          <Ellipse cx={cx-4} cy={cy-3} rx={4} ry={3} fill="rgba(255,255,255,0.28)" transform={`rotate(${i*22},${cx},${cy})`} />
        </G>
      ))}
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── OILSEEDS ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function SunflowerIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={60} ry={8} />
      {/* Petals */}
      {[0,1,2,3,4,5,6,7,8,9,10,11].map(i => {
        const angle = (i / 12) * Math.PI * 2;
        const cx = 100 + 52 * Math.cos(angle);
        const cy = 100 + 52 * Math.sin(angle);
        return (
          <Ellipse key={i} cx={cx} cy={cy} rx="16" ry="9"
            fill={COLORS.yellowBright}
            transform={`rotate(${i * 30}, ${cx}, ${cy})`} />
        );
      })}
      {/* Disc */}
      <Circle cx="100" cy="100" r="40" fill="#5D4037" />
      {/* Seed pattern */}
      {[0,1,2,3,4,5,6,7].map(ring =>
        [0,1,2,3,4,5,6,7].map(pos => {
          const a = (pos / 8 + ring * 0.125) * Math.PI * 2;
          const r = 8 + ring * 4;
          return <Circle key={`${ring}-${pos}`} cx={100+r*Math.cos(a)} cy={100+r*Math.sin(a)} r="2" fill="rgba(255,255,255,0.2)" />;
        })
      )}
      {/* Shine */}
      <Ellipse cx="84" cy="86" rx="12" ry="8" fill="rgba(255,255,255,0.22)" />
      {/* Stalk */}
      <Path d="M100 140 Q100 158 100 175" stroke={COLORS.limeDark} strokeWidth="5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function GroundnutIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={60} ry={8} />
      {/* Peanut shell — two lobes */}
      <Path d="M52 100 Q50 68 74 58 Q88 54 100 56 Q112 54 126 58 Q150 68 148 100 Q148 132 126 142 Q112 146 100 144 Q88 146 74 142 Q50 132 52 100Z" fill="#D2B48C" />
      {/* Middle constriction */}
      <Path d="M56 100 Q78 92 100 100 Q122 108 144 100" stroke="rgba(120,70,20,0.35)" strokeWidth="4" fill="none" />
      {/* Ridge texture */}
      {[-3,-1,1,3].map(i => (
        <Path key={i} d={`M${52+i*6} ${100+i*8} Q100 ${96+i*8} ${148+i*6} ${100+i*8}`}
          stroke="rgba(120,70,20,0.15)" strokeWidth="1.5" fill="none" />
      ))}
      {/* Shine */}
      <Ellipse cx="78" cy="76" rx="20" ry="12" fill="rgba(255,255,255,0.25)" />
    </Svg>
  );
}

function CottonIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={52} ry={8} />
      {/* Boll segments / fluffy cloud */}
      {[
        [100,80],[76,96],[124,96],[72,120],[100,114],[128,120],
        [82,142],[100,150],[118,142],
      ].map(([cx,cy],i) => (
        <Circle key={i} cx={cx} cy={cy} r={i < 3 ? 28 : i < 6 ? 26 : 22}
          fill="#E8E8E8" />
      ))}
      {/* Bract leaves */}
      <Path d="M70 135 Q52 120 50 100 Q62 112 70 135Z" fill={COLORS.oliveDeep} />
      <Path d="M130 135 Q148 120 150 100 Q138 112 130 135Z" fill={COLORS.primaryLight} />
      <Path d="M100 158 Q92 170 88 182 Q100 165 100 158Z" fill={COLORS.green600} />
      {/* Shine */}
      <Ellipse cx="86" cy="82" rx="14" ry="9" fill="rgba(255,255,255,0.55)" />
    </Svg>
  );
}

function SugarcaneIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={20} ry={6} />
      {/* 3 stalks */}
      {[-14,0,14].map((dx, i) => (
        <G key={i}>
          <Rect x={95+dx} y={30} width={10} height={152} rx={5} fill="#7CB342" />
          {/* Nodes */}
          {[70,100,130,158].map(y => (
            <Rect key={y} x={93+dx} y={y} width={14} height={6} rx={3} fill="rgba(0,80,0,0.3)" />
          ))}
          {/* Leaf */}
          <Path d={`M${100+dx} ${70+i*20} Q${130+dx+i*8} ${55+i*20} ${155+dx+i*10} ${45+i*20}`}
            stroke={COLORS.green600} strokeWidth={4-i} strokeLinecap="round" fill="none" />
        </G>
      ))}
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── SPICES ───────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function TurmericIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={62} ry={8} />
      {/* Main rhizome */}
      <Ellipse cx="100" cy="112" rx="58" ry="32" fill="#FF8F00" />
      {/* Fingers */}
      <Ellipse cx="48"  cy="102" rx="24" ry="15" fill={COLORS.amberDeep} transform="rotate(-20,48,102)" />
      <Ellipse cx="152" cy="104" rx="22" ry="14" fill={COLORS.amber} transform="rotate(15,152,104)" />
      <Ellipse cx="68"  cy="136" rx="20" ry="13" fill={COLORS.amberDeep} transform="rotate(-10,68,136)" />
      <Ellipse cx="134" cy="134" rx="18" ry="12" fill={COLORS.cta} transform="rotate(10,134,134)" />
      {/* Texture */}
      <Path d="M52 108 Q100 112 148 108" stroke="rgba(180,80,0,0.2)" strokeWidth="1.5" fill="none" />
      <Ellipse cx="82" cy="102" rx="18" ry="10" fill="rgba(255,255,255,0.22)" />
    </Svg>
  );
}

function RedChilliIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={22} ry={6} />
      {/* Body — curved chilli */}
      <Path d="M100 42 Q136 55 140 110 Q136 155 110 175 Q100 180 90 175 Q64 155 60 110 Q64 55 100 42Z" fill="#E53935" />
      {/* Shine */}
      <Path d="M96 52 Q92 90 93 145" stroke="rgba(255,255,255,0.38)" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Calyx */}
      <Path d="M90 44 Q100 34 110 44 Q105 38 100 40 Q95 38 90 44Z" fill={COLORS.primaryLight} />
      <Path d="M100 40 Q99 30 98 22" stroke={COLORS.green600} strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function CuminIcon({ size }) {
  // Cumin seeds — small elongated brown seeds
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={56} ry={8} />
      {[
        [72,100,25],[100,88,20],[128,100,22],[86,122,18],[114,118,20],
        [60,120,16],[140,116,17],[98,145,19],[76,140,16],[122,142,18],
      ].map(([cx,cy,rx],i) => (
        <G key={i}>
          <Ellipse cx={cx} cy={cy} rx={rx} ry={rx*0.38}
            fill="#A1887F" transform={`rotate(${i*18},${cx},${cy})`} />
          <Ellipse cx={cx-rx*0.28} cy={cy-2} rx={rx*0.25} ry={rx*0.14}
            fill="rgba(255,255,255,0.28)" transform={`rotate(${i*18},${cx},${cy})`} />
        </G>
      ))}
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── NEW UNIQUE ICONS (replacing all reused stubs) ────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function BitterGourdIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={30} ry={7} />
      {/* Tapered body */}
      <Path d="M82 36 Q116 38 122 100 Q118 152 100 176 Q82 152 78 100 Q84 38 82 36Z" fill="#558B2F" />
      {/* Longitudinal ridges — characteristic warty surface */}
      {[-14,-7,0,7,14].map((dx, i) => (
        <Path key={i}
          d={`M${100+dx} 40 Q${102+dx} 108 ${100+dx} 172`}
          stroke="rgba(30,80,0,0.28)" strokeWidth="2.5" fill="none" />
      ))}
      {/* Wart bumps */}
      {[[88,60],[112,72],[85,90],[115,104],[90,122],[110,138],[95,155]].map(([cx,cy],i) => (
        <Ellipse key={i} cx={cx} cy={cy} rx="5" ry="4" fill="rgba(30,80,0,0.22)" />
      ))}
      {/* Shine */}
      <Path d="M90 44 Q87 95 88 160" stroke="rgba(255,255,255,0.3)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      {/* Calyx */}
      <Path d="M86 38 Q100 26 114 38 Q106 32 100 35 Q94 32 86 38Z" fill={COLORS.primaryLight} />
      <Path d="M100 35 Q99 24 98 16" stroke={COLORS.oliveDeep} strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function BottleGourdIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={56} ry={9} />
      {/* Narrow neck */}
      <Rect x="88" y="32" width="24" height="48" rx="12" fill="#7CB342" />
      {/* Wide lower bulb */}
      <Ellipse cx="100" cy="138" rx="62" ry="54" fill="#689F38" />
      {/* Left highlight on bulb */}
      <Ellipse cx="78" cy="128" rx="24" ry="36" fill="#8BC34A" />
      {/* Constriction between neck and bulb */}
      <Ellipse cx="100" cy="80" rx="22" ry="12" fill="#558B2F" />
      {/* Texture lines on bulb */}
      <Path d="M46 130 Q100 124 154 130" stroke="rgba(30,80,0,0.18)" strokeWidth="1.5" fill="none" />
      <Path d="M44 148 Q100 142 156 148" stroke="rgba(30,80,0,0.14)" strokeWidth="1.5" fill="none" />
      {/* Highlight */}
      <Ellipse cx="76" cy="120" rx="10" ry="16" fill="rgba(255,255,255,0.18)" />
      {/* Stem */}
      <Path d="M100 32 Q99 22 98 14" stroke="#5D4037" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M96 22 Q90 14 86 8" stroke="#2E7D32" strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function CorianderIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={56} ry={8} />
      {/* Central stem */}
      <Path d="M100 175 Q100 130 100 90" stroke={COLORS.limeDark} strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Branch stems */}
      <Path d="M100 130 Q78 115 58 108" stroke={COLORS.limeDark} strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M100 130 Q122 115 142 108" stroke={COLORS.limeDark} strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M100 108 Q80 92 62 82" stroke={COLORS.limeDark} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M100 108 Q120 92 138 82" stroke={COLORS.limeDark} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* Feathery leaflets — characteristic fine pinnate leaves */}
      {[
        [56,104,0],[70,98,15],[44,112,-15],
        [140,104,0],[126,98,-15],[152,112,15],
        [60,78,10],[74,70,25],[46,84,-10],
        [136,78,-10],[122,70,-25],[150,84,10],
        [92,88,-8],[108,88,8],[100,74,0],
      ].map(([cx,cy,rot],i) => (
        <Ellipse key={i} cx={cx} cy={cy} rx="13" ry="8"
          fill="#66BB6A"
          transform={`rotate(${rot},${cx},${cy})`} />
      ))}
      {/* Small umbel flowers at tips */}
      {[[58,100],[142,100],[62,74],[138,74],[100,66]].map(([cx,cy],i) => (
        <Circle key={i} cx={cx} cy={cy} r="4" fill={COLORS.yellowAmber} />
      ))}
    </Svg>
  );
}

function FenugreekIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={54} ry={8} />
      {/* Main stem */}
      <Path d="M100 178 Q100 130 100 80" stroke={COLORS.green600} strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Side branches */}
      {[160,138,118,96].map((y, bi) => {
        const side = bi % 2 === 0 ? -1 : 1;
        return (
          <G key={bi}>
            <Path d={`M100 ${y} Q${100+side*26} ${y-12} ${100+side*48} ${y-8}`}
              stroke={COLORS.green600} strokeWidth="2.5" strokeLinecap="round" fill="none" />
            {/* Trifoliate — 3 oval leaflets */}
            <Ellipse cx={100+side*50} cy={y-8}  rx="14" ry="10" fill="#7CB342" />
            <Ellipse cx={100+side*38} cy={y-20} rx="12" ry="9"  fill="#7CB342" />
            <Ellipse cx={100+side*56} cy={y-22} rx="12" ry="9"  fill="#7CB342" />
            {/* Midveins */}
            <Path d={`M${100+side*44} ${y-4} Q${100+side*50} ${y-8} ${100+side*56} ${y-12}`}
              stroke="rgba(255,255,255,0.3)" strokeWidth="1" fill="none" />
          </G>
        );
      })}
      {/* Top trifoliate */}
      <Ellipse cx="100" cy="76" rx="14" ry="10" fill="#7CB342" />
      <Ellipse cx="84"  cy="64" rx="12" ry="9"  fill="#7CB342" />
      <Ellipse cx="116" cy="64" rx="12" ry="9"  fill="#7CB342" />
    </Svg>
  );
}

function SoybeanIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={54} ry={8} />
      {/* Vine/stem */}
      <Path d="M100 178 Q98 140 100 108 Q102 76 100 50" stroke={COLORS.limeDark} strokeWidth="3.5" strokeLinecap="round" fill="none" />
      {/* 3 hairy pods */}
      {[[-22,145,-12],[18,120,8],[-10,88,-6]].map(([dx, cy, rot], i) => (
        <G key={i}>
          {/* Pod body */}
          <Path
            d={`M${100+dx-8} ${cy-28} Q${100+dx+12} ${cy-28} ${100+dx+10} ${cy} Q${100+dx+10} ${cy+28} ${100+dx-8} ${cy+28} Q${100+dx-18} ${cy} ${100+dx-8} ${cy-28}Z`}
            fill="#558B2F"
            transform={`rotate(${rot},${100+dx},${cy})`}
          />
          {/* Bean bumps */}
          {[-16,0,16].map((bdy, bi) => (
            <Ellipse key={bi} cx={100+dx} cy={cy+bdy} rx="9" ry="8"
              fill="rgba(80,140,40,0.35)"
              transform={`rotate(${rot},${100+dx},${cy})`} />
          ))}
          {/* Tiny hairs */}
          <Path d={`M${100+dx-16} ${cy-20} Q${100+dx+14} ${cy} ${100+dx-16} ${cy+20}`}
            stroke="rgba(200,230,160,0.4)" strokeWidth="1" fill="none"
            transform={`rotate(${rot},${100+dx},${cy})`} />
        </G>
      ))}
      {/* Trifoliate leaf */}
      <Ellipse cx="100" cy="48" rx="16" ry="11" fill={COLORS.leafGreen} />
      <Ellipse cx="84"  cy="38" rx="14" ry="10" fill={COLORS.sellerAccentLight} />
      <Ellipse cx="116" cy="38" rx="14" ry="10" fill={COLORS.limeDark} />
    </Svg>
  );
}

function JuteIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={30} ry={7} />
      {/* 3 tall fibrous stalks */}
      {[[-18,0],[0,0],[18,0]].map(([dx], i) => (
        <G key={i}>
          <Rect x={96+dx} y={28} width={8} height={155} rx={4} fill="#7CB342" />
          {/* Fibrous nodes every 30px */}
          {[60,90,120,150].map(y => (
            <Ellipse key={y} cx={100+dx} cy={y} rx="6" ry="3" fill="rgba(0,80,0,0.3)" />
          ))}
        </G>
      ))}
      {/* Large pointed-oval leaves alternating */}
      {[
        [100, 55,  0,  1],
        [82,  80, -28, -1],
        [118, 105, 28,  1],
        [78,  130,-32, -1],
        [122, 155, 32,  1],
      ].map(([cx, cy, rot, side], i) => (
        <G key={i}>
          <Path
            d={`M${cx} ${cy-22} Q${cx+side*36} ${cy} ${cx} ${cy+22} Q${cx-side*8} ${cy} ${cx} ${cy-22}Z`}
            fill={COLORS.green600}
            transform={`rotate(${rot},${cx},${cy})`}
          />
          {/* Midrib */}
          <Path d={`M${cx} ${cy-18} Q${cx} ${cy} ${cx} ${cy+18}`}
            stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" fill="none"
            transform={`rotate(${rot},${cx},${cy})`} />
        </G>
      ))}
    </Svg>
  );
}

function JowarIcon({ size }) {
  // Sorghum — large dense oval/egg-shaped panicle, very different from Bajra's slim cylinder
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={38} ry={7} />
      {/* Stalk */}
      <Path d="M100 175 Q100 132 100 106" stroke={COLORS.limeLight} strokeWidth="5.5" strokeLinecap="round" fill="none" />
      {/* Flag leaf */}
      <Path d="M100 130 Q130 118 152 106" stroke={COLORS.limeDark} strokeWidth="3.5" strokeLinecap="round" fill="none" />
      {/* Panicle — broad egg-shaped, multi-branched */}
      <Ellipse cx="100" cy="72" rx="44" ry="58" fill="#BCAAA4" />
      {/* Individual spikelet clusters */}
      {[
        [100,28],[80,36],[120,36],[68,52],[132,52],
        [60,70],[140,70],[66,90],[134,90],
        [74,108],[126,108],[86,122],[114,122],[100,130],
      ].map(([cx,cy],i) => (
        <Circle key={i} cx={cx} cy={cy} r="7" fill="rgba(80,40,10,0.3)" />
      ))}
      {/* Shine */}
      <Ellipse cx="84" cy="48" rx="14" ry="28" fill="rgba(255,255,255,0.2)" />
    </Svg>
  );
}

function BarleyIcon({ size }) {
  // 2-rowed spike with characteristic long parallel awns
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={26} ry={6} />
      {/* Stalk */}
      <Path d="M100 175 Q100 128 100 96" stroke={COLORS.limeLight} strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* 2-rowed spikelets — left and right pairs */}
      {[0,1,2,3,4,5,6].map(i => {
        const y = 96 + i * 12;
        return (
          <G key={i}>
            {/* Left grain */}
            <Ellipse cx="84" cy={y+4} rx="11" ry="7" fill="#F9A825" transform={`rotate(-10,84,${y+4})`} />
            {/* Right grain */}
            <Ellipse cx="116" cy={y+4} rx="11" ry="7" fill="#F9A825" transform={`rotate(10,116,${y+4})`} />
            {/* Left awn */}
            <Path d={`M78 ${y} L58 ${y-32}`} stroke={COLORS.yellowDark2} strokeWidth="1.8" strokeLinecap="round" />
            {/* Right awn */}
            <Path d={`M122 ${y} L142 ${y-32}`} stroke={COLORS.yellowDark2} strokeWidth="1.8" strokeLinecap="round" />
          </G>
        );
      })}
      {/* Top awn */}
      <Path d="M100 96 Q100 76 100 52" stroke={COLORS.yellowDark2} strokeWidth="2" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function RagiIcon({ size }) {
  // Finger millet — 5–6 curved "finger" spikes radiating from top of stalk
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={54} ry={8} />
      {/* Main stalk */}
      <Path d="M100 175 Q100 140 100 108" stroke={COLORS.limeLight} strokeWidth="5.5" strokeLinecap="round" fill="none" />
      {/* 5 curved finger spikes */}
      {[
        [-48, -10, -30],
        [-24,  -6, -15],
        [  0,   0,   0],
        [ 24,  -6,  15],
        [ 48, -10,  30],
      ].map(([dx, dy, rot], i) => {
        const cx = 100 + dx;
        const cy = 108 + dy;
        return (
          <G key={i}>
            {/* Finger spike */}
            <Path
              d={`M${cx} ${cy} Q${cx+rot*0.4} ${cy-36} ${cx+rot*0.2} ${cy-56}`}
              stroke="none" fill="none"
            />
            <Ellipse cx={cx} cy={cy-28} rx="9" ry="30"
              fill="#8D6E63"
              transform={`rotate(${rot},${cx},${cy})`}
            />
            {/* Grain bumps along finger */}
            {[-18,-6,6,18].map((dfy, gi) => (
              <Circle key={gi}
                cx={cx + Math.sin(rot * Math.PI/180) * (dfy + 28)}
                cy={cy - 28 + dfy - Math.cos(rot * Math.PI/180) * 0}
                r="3.5" fill="rgba(40,20,5,0.35)" />
            ))}
          </G>
        );
      })}
      {/* Hub where fingers meet */}
      <Circle cx="100" cy="108" r="10" fill={COLORS.brown600} />
    </Svg>
  );
}

function AjwainIcon({ size }) {
  // Carom seeds — small cream/white seeds, different look from brown cumin
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={58} ry={8} />
      {[
        [74,108,22],[100,92,18],[126,108,20],[88,130,16],[112,126,18],
        [62,126,15],[138,122,16],[100,150,20],[78,148,14],[122,146,16],
        [58,106,13],[142,110,14],
      ].map(([cx,cy,rx],i) => (
        <G key={i}>
          <Ellipse cx={cx} cy={cy} rx={rx} ry={rx*0.42}
            fill="#BCAAA4" transform={`rotate(${i*15+5},${cx},${cy})`} />
          {/* Cream highlight on each seed */}
          <Ellipse cx={cx-rx*0.3} cy={cy-2} rx={rx*0.28} ry={rx*0.16}
            fill="rgba(255,255,255,0.45)" transform={`rotate(${i*15+5},${cx},${cy})`} />
          {/* Longitudinal stripe */}
          <Path d={`M${cx-rx*0.7} ${cy} L${cx+rx*0.7} ${cy}`}
            stroke="rgba(100,60,30,0.35)" strokeWidth="0.8"
            transform={`rotate(${i*15+5},${cx},${cy})`} />
        </G>
      ))}
    </Svg>
  );
}

function RadishIconFn({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={38} ry={7} />
      {/* Bulb */}
      <Ellipse cx="100" cy="116" rx="46" ry="56" fill="#EF9A9A" />
      <Ellipse cx="100" cy="116" rx="46" ry="56" fill="rgba(255,255,255,0.1)" />
      {/* Taproot tip */}
      <Path d="M100 172 Q98 178 100 184" stroke={COLORS.grayMedLight} strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* Lateral roots */}
      <Path d="M88 160 Q80 166 74 170" stroke={COLORS.grayMedLight} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <Path d="M112 158 Q120 164 126 168" stroke={COLORS.grayMedLight} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      {/* Collar */}
      <Ellipse cx="100" cy="64" rx="16" ry="7" fill={COLORS.error} />
      {/* Leaves */}
      <Path d="M90 62 Q76 42 68 28" stroke={COLORS.green600} strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 60 Q100 38 100 22" stroke={COLORS.sellerAccentLight} strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M110 62 Q124 42 132 28" stroke={COLORS.primaryLight} strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function SweetPotatoIconFn({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={64} ry={9} />
      {/* Tapered oval tuber */}
      <Path d="M34 110 Q36 68 100 60 Q164 68 166 110 Q164 152 100 158 Q36 152 34 110Z" fill="#FFab91" />
      <Path d="M34 110 Q36 68 100 60 Q164 68 166 110 Q164 152 100 158 Q36 152 34 110Z" fill="rgba(255,255,255,0.1)" />
      {/* Skin texture lines */}
      <Path d="M50 90 Q100 84 150 90" stroke="rgba(150,40,0,0.15)" strokeWidth="1.5" fill="none" />
      <Path d="M44 112 Q100 106 156 112" stroke="rgba(150,40,0,0.12)" strokeWidth="1.5" fill="none" />
      <Path d="M50 132 Q100 126 150 132" stroke="rgba(150,40,0,0.12)" strokeWidth="1.5" fill="none" />
      {/* Root hairs */}
      {[70,100,130].map(cx => (
        <Path key={cx} d={`M${cx} 158 Q${cx-4} 168 ${cx-2} 176`}
          stroke={COLORS.brownLight} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      ))}
      {/* Stem scar */}
      <Ellipse cx="100" cy="62" rx="8" ry="4" fill="rgba(150,40,0,0.3)" />
      <Path d="M100 60 Q99 48 98 38" stroke={COLORS.green600} strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function GuavaIconFn({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={60} ry={9} />
      <Ellipse cx="100" cy="110" rx="66" ry="64" fill="#AED581" />
      <Ellipse cx="100" cy="110" rx="66" ry="64" fill="rgba(255,255,255,0.1)" />
      {/* Tiny dots texture */}
      {[80,96,112,128].map(cx =>
        [88,106,124,142].map(cy => (
          <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" fill="rgba(40,100,20,0.2)" />
        ))
      )}
      {/* Calyx remnant at bottom */}
      <Path d="M88 168 Q100 176 112 168 Q106 172 100 174 Q94 172 88 168Z" fill={COLORS.oliveDeep} />
      {/* Stem */}
      <Path d="M100 46 Q100 34 100 26" stroke={COLORS.brown600} strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 36 Q90 28 84 20" stroke={COLORS.green600} strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function PapayaIconFn({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={48} ry={8} />
      {/* Pear-shaped body */}
      <Path d="M68 70 Q64 40 100 34 Q136 40 132 70 Q148 100 142 148 Q134 178 100 182 Q66 178 58 148 Q52 100 68 70Z" fill="#FFB74D" />
      <Path d="M68 70 Q64 40 100 34 Q136 40 132 70 Q148 100 142 148 Q134 178 100 182 Q66 178 58 148 Q52 100 68 70Z" fill="rgba(255,255,255,0.1)" />
      {/* Seeds showing through skin */}
      {[100,86,114,100].map((cx, i) => (
        <Ellipse key={i} cx={cx} cy={120+i*12} rx="4" ry="6" fill="rgba(100,40,0,0.25)" />
      ))}
      {/* Stem with leaf */}
      <Path d="M100 34 Q99 22 98 14" stroke={COLORS.brown600} strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 24 Q88 14 80 8" stroke={COLORS.green600} strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function LemonIconFn({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={54} ry={8} />
      {/* Lemon ellipse with pointed nipples at both ends */}
      <Path d="M36 108 Q34 70 62 54 Q80 44 100 44 Q120 44 138 54 Q166 70 164 108 Q166 146 138 162 Q120 172 100 172 Q80 172 62 162 Q34 146 36 108Z" fill="#FFF176" />
      <Path d="M36 108 Q34 70 62 54 Q80 44 100 44 Q120 44 138 54 Q166 70 164 108 Q166 146 138 162 Q120 172 100 172 Q80 172 62 162 Q34 146 36 108Z" fill="rgba(255,255,255,0.1)" />
      {/* Left nipple */}
      <Path d="M36 108 Q28 104 22 100" stroke={COLORS.yellowDark2} strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Right nipple */}
      <Path d="M164 108 Q172 104 178 100" stroke={COLORS.yellowDark2} strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Skin pores */}
      {[72,100,128].map(cx =>
        [82,108,134].map(cy => (
          <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" fill="rgba(200,150,0,0.2)" />
        ))
      )}
      {/* Stem */}
      <Path d="M100 44 Q100 32 100 24" stroke={COLORS.brown600} strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M100 36 Q90 26 84 18" stroke={COLORS.green600} strokeWidth="3" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function SapotaIconFn({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={60} ry={9} />
      {/* Round-oval body */}
      <Ellipse cx="100" cy="110" rx="64" ry="66" fill="#A1887F" />
      <Ellipse cx="100" cy="110" rx="64" ry="66" fill="rgba(255,255,255,0.1)" />
      {/* Sandy grainy texture */}
      {[68,84,100,116,132].map(cx =>
        [80,98,116,134,152].map(cy => (
          <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.8" fill="rgba(60,30,10,0.18)" />
        ))
      )}
      {/* Calyx scar at bottom */}
      <Path d="M88 172 Q100 180 112 172 Q106 176 100 178 Q94 176 88 172Z" fill={COLORS.coffeeDark} />
      {/* Stem */}
      <Path d="M100 46 Q100 34 100 26" stroke={COLORS.brown600} strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function MustardPlantIcon({ size }) {
  // Mustard — yellow flowers on plant (more recognizable than seed pile)
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Shadow rx={44} ry={7} />
      {/* Central stalk */}
      <Path d="M100 178 Q100 140 100 80" stroke={COLORS.limeDark} strokeWidth="4.5" strokeLinecap="round" fill="none" />
      {/* Side branches */}
      <Path d="M100 140 Q74 128 52 120" stroke={COLORS.limeDark} strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M100 140 Q126 128 148 120" stroke={COLORS.limeDark} strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M100 112 Q78 100 60 92" stroke={COLORS.limeDark} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M100 112 Q122 100 140 92" stroke={COLORS.limeDark} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* Yellow flowers — 4-petal cross */}
      {[[52,116],[148,116],[60,88],[140,88],[100,76],[84,64],[116,64],[100,52]].map(([cx,cy],i) => (
        <G key={i}>
          <Ellipse cx={cx}   cy={cy-7} rx="5" ry="7" fill="#F9A825" />
          <Ellipse cx={cx}   cy={cy+7} rx="5" ry="7" fill="#F9A825" />
          <Ellipse cx={cx-7} cy={cy}   rx="7" ry="5" fill="#F9A825" />
          <Ellipse cx={cx+7} cy={cy}   rx="7" ry="5" fill="#F9A825" />
          <Circle  cx={cx}   cy={cy}   r="4"         fill={COLORS.amber} />
        </G>
      ))}
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ICON MAP ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const ICONS = {
  // ── Vegetables ──────────────────────────────────────────────────────────────
  Tomato:          TomatoIcon,
  Onion:           OnionIcon,
  Potato:          PotatoIcon,
  Brinjal:         BrinjalIcon,
  Cauliflower:     CauliflowerIcon,
  Cabbage:         CabbageIcon,
  Okra:            OkraIcon,
  'Bitter Gourd':  BitterGourdIcon,
  Capsicum:        CapsicumIcon,
  Cucumber:        CucumberIcon,
  'Bottle Gourd':  BottleGourdIcon,
  Pumpkin:         PumpkinIcon,
  Carrot:          CarrotIcon,
  Radish:          RadishIconFn,
  Spinach:         SpinachIcon,
  'Green Chilli':  GreenChilliIcon,
  Garlic:          GarlicIcon,
  Ginger:          GingerIcon,
  Coriander:       CorianderIcon,
  Fenugreek:       FenugreekIcon,
  'Sweet Potato':  SweetPotatoIconFn,
  Peas:            PeasIcon,

  // ── Fruits ──────────────────────────────────────────────────────────────────
  Mango:           MangoIcon,
  Banana:          BananaIcon,
  Grapes:          GrapesIcon,
  Pomegranate:     (p) => (
    <Svg viewBox="0 0 200 200" width={p.size} height={p.size}>
      <Shadow rx={62} />
      <Circle cx="100" cy="110" r="66" fill="#E53935" />
      <Circle cx="100" cy="110" r="66" fill="rgba(255,255,255,0.12)" />
      {/* Crown — distinctive */}
      <Path d="M76 50 L80 34 L87 50 L94 32 L100 50 L106 32 L113 50 L120 34 L124 50 Q112 46 100 48 Q88 46 76 50Z" fill={COLORS.pinkDark} />
      <Ellipse cx="82" cy="86" rx="16" ry="10" fill="rgba(255,255,255,0.3)" />
    </Svg>
  ),
  Guava:           GuavaIconFn,
  Papaya:          PapayaIconFn,
  Watermelon:      WatermelonIcon,
  Muskmelon:       (p) => (
    <Svg viewBox="0 0 200 200" width={p.size} height={p.size}>
      <Shadow rx={64} ry={9} />
      <Ellipse cx="100" cy="110" rx="66" ry="62" fill="#FFE082" />
      {/* Net pattern — characteristic of muskmelon */}
      {[-30,-15,0,15,30].map(dy => (
        <Path key={dy} d={`M44 ${110+dy} Q100 ${104+dy} 156 ${110+dy}`}
          stroke="rgba(150,80,0,0.22)" strokeWidth="1.5" fill="none" />
      ))}
      {[-30,-10,10,30].map(dx => (
        <Path key={dx} d={`M${100+dx} 52 Q${100+dx+6} 110 ${100+dx} 168`}
          stroke="rgba(150,80,0,0.18)" strokeWidth="1.5" fill="none" />
      ))}
      <Ellipse cx="80" cy="84" rx="18" ry="11" fill="rgba(255,255,255,0.28)" />
      <Path d="M100 48 Q100 36 100 28" stroke={COLORS.brown600} strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  ),
  Orange:          OrangeIcon,
  Lemon:           LemonIconFn,
  Apple:           AppleIcon,
  Sapota:          SapotaIconFn,
  Pineapple:       PineappleIcon,
  Litchi:          (p) => (
    <Svg viewBox="0 0 200 200" width={p.size} height={p.size}>
      <Shadow rx={56} ry={8} />
      <Ellipse cx="100" cy="110" rx="62" ry="64" fill="#EF9A9A" />
      {/* Bumpy skin — characteristic litchi texture */}
      {[0,1,2,3,4,5,6,7,8,9,10,11,12,13].map(i => {
        const a = (i/14)*Math.PI*2;
        return <Circle key={i} cx={100+48*Math.cos(a)} cy={110+52*Math.sin(a)} r="8" fill="rgba(120,0,30,0.28)" />;
      })}
      {[0,1,2,3,4,5,6,7].map(i => {
        const a = (i/8)*Math.PI*2;
        return <Circle key={i} cx={100+28*Math.cos(a)} cy={110+30*Math.sin(a)} r="6" fill="rgba(120,0,30,0.18)" />;
      })}
      <Ellipse cx="82" cy="86" rx="14" ry="9" fill="rgba(255,255,255,0.3)" />
      <Path d="M100 46 Q100 34 100 26" stroke={COLORS.brown600} strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  ),
  Coconut:         CoconutIcon,

  // ── Cereals ─────────────────────────────────────────────────────────────────
  Wheat:           WheatIcon,
  Rice:            RiceIcon,
  Maize:           MaizeIcon,
  Bajra:           BajraIcon,
  Jowar:           JowarIcon,
  Barley:          BarleyIcon,
  Ragi:            RagiIcon,

  // ── Pulses ───────────────────────────────────────────────────────────────────
  'Tur Dal':       (p) => <SeedPileIcon {...p} c1={COLORS.peachLight} c2={COLORS.amberDeep} c3={COLORS.cta} />,
  Gram:            (p) => <SeedPileIcon {...p} c1={COLORS.brown100} c2={COLORS.brownPale} c3={COLORS.brown600} seedRx={16} seedRy={14} />,
  Moong:           (p) => <SeedPileIcon {...p} c1={COLORS.green200} c2={COLORS.sellerAccentLight} c3={COLORS.sellerAccent} seedRx={12} seedRy={10} />,
  Urad:            (p) => <SeedPileIcon {...p} c1={COLORS.steelGray} c2={COLORS.blueSteel} c3={COLORS.nearBlack3} seedRx={12} seedRy={10} />,
  Masoor:          (p) => <SeedPileIcon {...p} c1={COLORS.orange100} c2={COLORS.deepOrangeVivid} c3={COLORS.orange700} seedRx={14} seedRy={9} />,

  // ── Oilseeds ─────────────────────────────────────────────────────────────────
  Soybean:         SoybeanIcon,
  Groundnut:       GroundnutIcon,
  Sunflower:       SunflowerIcon,
  Mustard:         MustardPlantIcon,
  Sesame:          (p) => <SeedPileIcon {...p} c1={COLORS.offWhite} c2={COLORS.brown100} c3={COLORS.brownLight} seedRx={8} seedRy={12} />,
  Castor:          (p) => <SeedPileIcon {...p} c1={COLORS.bluishGray} c2={COLORS.brownAlt} c3={COLORS.coffeeDark} seedRx={15} seedRy={11} />,

  // ── Cash crops ───────────────────────────────────────────────────────────────
  Cotton:          CottonIcon,
  Sugarcane:       SugarcaneIcon,
  Jute:            JuteIcon,

  // ── Spices ───────────────────────────────────────────────────────────────────
  Turmeric:        TurmericIcon,
  'Red Chilli':    RedChilliIcon,
  Cumin:           CuminIcon,
  'Coriander Seeds': (p) => <SeedPileIcon {...p} c1={COLORS.paleGreen} c2={COLORS.limeDark} c3={COLORS.primaryLight} seedRx={10} seedRy={7} />,
  Cardamom:        (p) => (
    <Svg viewBox="0 0 200 200" width={p.size} height={p.size}>
      <Shadow rx={34} ry={7} />
      {/* Elongated 3-angled pod */}
      <Ellipse cx="100" cy="108" rx="38" ry="68" fill="#7CB342" />
      <Ellipse cx="100" cy="108" rx="38" ry="68" fill="rgba(255,255,255,0.12)" />
      {/* 3 ridges */}
      {[-14,0,14].map(dx => (
        <Path key={dx} d={`M${100+dx} 42 Q${100+dx} 108 ${100+dx} 174`}
          stroke="rgba(0,80,0,0.22)" strokeWidth="2" fill="none" />
      ))}
      {/* Tip */}
      <Path d="M100 174 Q98 182 100 186" stroke={COLORS.sellerAccent} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <Path d="M100 42 Q98 32 98 26" stroke={COLORS.brown600} strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </Svg>
  ),
  'Black Pepper':  (p) => <SeedPileIcon {...p} c1={COLORS.grayMid} c2={COLORS.darkGray3} c3={COLORS.nearBlack3} seedRx={14} seedRy={14} />,
  Ajwain:          AjwainIcon,
  Fennel:          (p) => <SeedPileIcon {...p} c1={COLORS.green200} c2={COLORS.leafGreen} c3={COLORS.primaryLight} seedRx={9} seedRy={13} />,
};

// ─────────────────────────────────────────────────────────────────────────────
// ── Public API ────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the SVG illustration for a given crop name.
 *
 * @param {string}  crop  — exact name from CROP_CATEGORIES (case-sensitive)
 * @param {number}  size  — rendered width & height in dp (default: 56)
 */
export function CropIcon({ crop, size = 64 }) {
  const Icon = ICONS[crop];
  const wrap = {
    width: size, height: size, borderRadius: size * 0.22,
    backgroundColor: '#EDF5EB', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  };
  if (!Icon) {
    // Fallback — coloured leaf emoji placeholder
    return (
      <View style={wrap}>
        <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Ellipse cx="100" cy="178" rx="44" ry="8" fill="rgba(0,0,0,0.12)" />
          <Path d="M100 160 Q60 130 55 80 Q70 40 100 35 Q130 40 145 80 Q140 130 100 160Z" fill="#43A047" />
          <Path d="M100 160 Q100 110 100 38" stroke="rgba(255,255,255,0.35)" strokeWidth="3" fill="none" />
          <Path d="M100 120 Q75 108 60 92" stroke="rgba(255,255,255,0.22)" strokeWidth="2" fill="none" />
          <Path d="M100 120 Q125 108 140 92" stroke="rgba(255,255,255,0.22)" strokeWidth="2" fill="none" />
        </Svg>
      </View>
    );
  }
  return <View style={wrap}><Icon size={size} /></View>;
}

export default CropIcon;
