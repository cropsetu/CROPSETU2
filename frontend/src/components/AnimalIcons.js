/**
 * AnimalIcons.js — Beautiful, REALISTIC 3D-style SVG illustrations for the
 * CropSetu animal-trade categories. Built for LOW-LITERACY Indian farmers:
 * each icon must instantly read as the correct real animal in its true colours.
 *
 * Style recipe (mirrors CropIcons.js / ActivityIcons.js):
 *   • viewBox="0 0 200 200", transparent background (sits on the pill/card)
 *   • 3-stop radial/linear gradients (light/base/dark) for a rounded 3D body
 *   • a soft ground-shadow ellipse near cy≈180
 *   • a subtle top-left white shine
 *   • REALISTIC species colours — never brand green
 *
 * react-native-svg gradient ids are GLOBAL, so EVERY id is prefixed per
 * animal+part (e.g. "anim-cow-body", "anim-buffalo-horn"). No duplicates.
 *
 * Public API (unchanged):
 *   <AnimalIcon type="Cow" size={48} />
 *   export { ANIMAL_ICON_MAP };
 */

import React from 'react';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect, G, Line, Polygon,
} from 'react-native-svg';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Soft ground shadow at the foot of every icon. */
const Shadow = ({ cx = 100, rx = 56, ry = 9 }) => (
  <Ellipse cx={cx} cy={180} rx={rx} ry={ry} fill="rgba(0,0,0,0.13)" />
);

/** 3-stop radial body gradient — top-left lit, bottom-right shaded. */
const Body3D = ({ id, light, base, dark }) => (
  <RadialGradient id={id} cx="38%" cy="30%" r="82%">
    <Stop offset="0" stopColor={light} />
    <Stop offset="0.55" stopColor={base} />
    <Stop offset="1" stopColor={dark} />
  </RadialGradient>
);

/** 3-stop top-to-bottom linear body gradient. */
const Body3DLinear = ({ id, light, base, dark }) => (
  <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <Stop offset="0" stopColor={light} />
    <Stop offset="0.5" stopColor={base} />
    <Stop offset="1" stopColor={dark} />
  </LinearGradient>
);

// ─────────────────────────────────────────────────────────────────────────────
// ── ANIMAL ICONS ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// ALL — a friendly group: a cream cow, a smaller tan goat and a little brown hen.
function AllAnimalsIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-all-cow" light="#FFFBF2" base="#F3E9D6" dark="#D9C8A8" />
        <Body3DLinear id="anim-all-cowpatch" light="#C68C5E" base="#A9744F" dark="#855837" />
        <Body3D id="anim-all-goat" light="#FBF1DC" base="#E7D4AE" dark="#C9B485" />
        <Body3D id="anim-all-hen" light="#D89C63" base="#B0703F" dark="#824E26" />
      </Defs>
      <Shadow rx={62} />

      {/* COW (back-left, biggest) */}
      <G>
        <Ellipse cx="78" cy="118" rx="52" ry="38" fill="url(#anim-all-cow)" />
        {/* hump */}
        <Path d="M44 96 Q56 70 84 80 Q70 92 60 104Z" fill="url(#anim-all-cow)" />
        {/* brown patch */}
        <Path d="M92 100 Q116 96 120 124 Q108 140 88 132 Q82 114 92 100Z" fill="url(#anim-all-cowpatch)" />
        {/* head */}
        <Ellipse cx="44" cy="92" rx="22" ry="20" fill="url(#anim-all-cow)" />
        <Ellipse cx="40" cy="104" rx="11" ry="8" fill="#E8B7B0" />
        <Path d="M28 76 Q20 66 26 64 Q31 66 33 78Z" fill="#D7C29C" />
        <Path d="M60 76 Q68 66 62 64 Q57 66 55 78Z" fill="#D7C29C" />
        <Path d="M30 86 Q22 82 18 88" stroke="#CBB89A" strokeWidth="5" strokeLinecap="round" fill="none" />
        <Path d="M58 86 Q66 82 70 88" stroke="#CBB89A" strokeWidth="5" strokeLinecap="round" fill="none" />
        <Circle cx="37" cy="88" r="3" fill="#2B1A0E" />
        <Circle cx="51" cy="88" r="3" fill="#2B1A0E" />
        <Circle cx="38" cy="103" r="1.4" fill="#7A4A4A" />
        <Circle cx="43" cy="103" r="1.4" fill="#7A4A4A" />
        {/* legs */}
        <Rect x="60" y="146" width="9" height="26" rx="4" fill="#D9C8A8" />
        <Rect x="92" y="148" width="9" height="24" rx="4" fill="#C7B58F" />
        <Ellipse cx="56" cy="100" rx="12" ry="7" fill="rgba(255,255,255,0.30)" />
      </G>

      {/* GOAT (front-centre, smaller, tan) */}
      <G>
        <Ellipse cx="120" cy="138" rx="30" ry="22" fill="url(#anim-all-goat)" />
        <Ellipse cx="146" cy="124" rx="15" ry="13" fill="url(#anim-all-goat)" />
        <Path d="M140 112 Q134 100 138 100 Q143 102 145 113Z" fill="#A88C5A" />
        <Path d="M152 112 Q158 100 154 100 Q149 102 147 113Z" fill="#A88C5A" />
        <Path d="M152 128 Q160 132 162 126" stroke="#C9B485" strokeWidth="5" strokeLinecap="round" fill="none" />
        <Circle cx="143" cy="123" r="2.4" fill="#2B1A0E" />
        <Circle cx="151" cy="122" r="2.4" fill="#2B1A0E" />
        <Path d="M146 134 L145 142" stroke="#8C7448" strokeWidth="3" strokeLinecap="round" />
        <Rect x="108" y="156" width="7" height="18" rx="3" fill="#C9B485" />
        <Rect x="128" y="156" width="7" height="18" rx="3" fill="#BBA677" />
      </G>

      {/* HEN (little, front-right, brown) */}
      <G>
        <Ellipse cx="166" cy="156" rx="20" ry="16" fill="url(#anim-all-hen)" />
        <Circle cx="178" cy="142" r="11" fill="url(#anim-all-hen)" />
        <Path d="M178 132 Q176 124 179 124 Q182 126 180 132Z" fill="#D7263D" />
        <Path d="M183 132 Q186 125 188 128 Q187 133 183 134Z" fill="#D7263D" />
        <Path d="M177 145 Q176 149 180 148 L177 146Z" fill="#D7263D" />
        <Polygon points="188,142 196,144 188,146" fill="#F2A03D" />
        <Circle cx="180" cy="140" r="1.8" fill="#1E120A" />
        <Path d="M150 152 Q142 148 146 158 Q152 158 152 154Z" fill="#824E26" />
        <Line x1="160" y1="172" x2="160" y2="178" stroke="#F2A03D" strokeWidth="3" strokeLinecap="round" />
        <Line x1="170" y1="172" x2="170" y2="178" stroke="#F2A03D" strokeWidth="3" strokeLinecap="round" />
      </G>
    </Svg>
  );
}

// COW — Indian humped zebu: cream body, light-brown patches, hump, dewlap,
// short curved horns, pink muzzle, soft ears, big gentle eyes.
function CowIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-cow-body" light="#FFFCF4" base="#F3E9D6" dark="#D8C6A4" />
        <Body3D id="anim-cow-head" light="#FFFCF4" base="#F3E9D6" dark="#DCCBA9" />
        <Body3DLinear id="anim-cow-patch" light="#C68C5E" base="#A9744F" dark="#82532F" />
        <Body3DLinear id="anim-cow-horn" light="#F0E6CE" base="#CBB89A" dark="#9C875F" />
        <Body3D id="anim-cow-muzzle" light="#F6C9C1" base="#E8AFA6" dark="#CC8C82" />
      </Defs>
      <Shadow rx={58} />

      {/* body */}
      <Ellipse cx="108" cy="116" rx="56" ry="40" fill="url(#anim-cow-body)" />
      {/* shoulder hump */}
      <Path d="M74 84 Q90 52 124 70 Q104 80 88 100Z" fill="url(#anim-cow-body)" />
      {/* brown patches */}
      <Path d="M120 92 Q150 88 156 122 Q142 142 116 130 Q108 108 120 92Z" fill="url(#anim-cow-patch)" />
      <Ellipse cx="92" cy="138" rx="16" ry="12" fill="url(#anim-cow-patch)" opacity="0.9" />
      {/* tail */}
      <Path d="M162 112 Q176 124 170 150 Q168 156 164 152 Q170 134 158 124Z" fill="url(#anim-cow-body)" />
      <Circle cx="167" cy="152" r="4" fill="#A9744F" />
      {/* legs */}
      <Rect x="78" y="148" width="11" height="30" rx="5" fill="#D8C6A4" />
      <Rect x="100" y="150" width="11" height="28" rx="5" fill="#C7B58F" />
      <Rect x="126" y="150" width="11" height="28" rx="5" fill="#D8C6A4" />
      <Rect x="146" y="148" width="11" height="30" rx="5" fill="#C7B58F" />
      <Rect x="78" y="172" width="11" height="6" rx="2" fill="#5A4730" />
      <Rect x="146" y="174" width="11" height="6" rx="2" fill="#5A4730" />

      {/* head */}
      <Ellipse cx="58" cy="98" rx="28" ry="26" fill="url(#anim-cow-head)" />
      {/* ears */}
      <Path d="M34 84 Q20 78 24 92 Q30 98 40 92Z" fill="#E2D2B0" />
      <Path d="M82 84 Q96 78 92 92 Q86 98 76 92Z" fill="#EADBBA" />
      {/* short curved horns */}
      <Path d="M44 74 Q36 56 44 54 Q50 60 52 72Z" fill="url(#anim-cow-horn)" />
      <Path d="M72 74 Q80 56 72 54 Q66 60 64 72Z" fill="url(#anim-cow-horn)" />
      {/* eyes */}
      <Circle cx="48" cy="94" r="4.5" fill="#FFFFFF" />
      <Circle cx="48" cy="95" r="3" fill="#241208" />
      <Circle cx="49.2" cy="93.8" r="1" fill="#FFFFFF" />
      <Circle cx="70" cy="94" r="4.5" fill="#FFFFFF" />
      <Circle cx="70" cy="95" r="3" fill="#241208" />
      <Circle cx="71.2" cy="93.8" r="1" fill="#FFFFFF" />
      {/* pink muzzle */}
      <Ellipse cx="58" cy="116" rx="16" ry="11" fill="url(#anim-cow-muzzle)" />
      <Ellipse cx="52" cy="116" rx="2" ry="3" fill="#9E5C56" />
      <Ellipse cx="64" cy="116" rx="2" ry="3" fill="#9E5C56" />
      {/* dewlap fold */}
      <Path d="M58 124 Q54 142 70 150 Q66 134 70 124Z" fill="url(#anim-cow-head)" />
      <Path d="M62 130 Q60 140 67 146" stroke="rgba(150,120,80,0.35)" strokeWidth="2" fill="none" />

      {/* top-left shine */}
      <Ellipse cx="86" cy="98" rx="16" ry="9" fill="rgba(255,255,255,0.30)" />
    </Svg>
  );
}

// BUFFALO — heavy dark slate-grey body, large backward crescent horns,
// lighter grey muzzle. Clearly darker and bulkier than the cow.
function BuffaloIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-buffalo-body" light="#6E777C" base="#4B5358" dark="#23272B" />
        <Body3D id="anim-buffalo-head" light="#717A7F" base="#4F575C" dark="#2B2F33" />
        <Body3DLinear id="anim-buffalo-horn" light="#C9CDCF" base="#9AA0A3" dark="#6A6F72" />
        <Body3D id="anim-buffalo-muzzle" light="#8F979B" base="#6E767B" dark="#4A5256" />
      </Defs>
      <Shadow rx={62} />

      {/* bulky body */}
      <Ellipse cx="106" cy="118" rx="60" ry="44" fill="url(#anim-buffalo-body)" />
      {/* low shoulder rise */}
      <Path d="M70 86 Q92 64 128 80 Q104 86 86 104Z" fill="url(#anim-buffalo-body)" />
      {/* tail */}
      <Path d="M164 116 Q178 130 172 156 Q170 162 166 158 Q172 138 160 126Z" fill="url(#anim-buffalo-body)" />
      <Circle cx="169" cy="158" r="4.5" fill="#1C2024" />
      {/* legs (thick) */}
      <Rect x="74" y="150" width="13" height="30" rx="6" fill="#3A4044" />
      <Rect x="98" y="152" width="13" height="28" rx="6" fill="#2E3337" />
      <Rect x="126" y="152" width="13" height="28" rx="6" fill="#3A4044" />
      <Rect x="148" y="150" width="13" height="30" rx="6" fill="#2E3337" />
      <Rect x="74" y="174" width="13" height="6" rx="2" fill="#15181B" />
      <Rect x="148" y="174" width="13" height="6" rx="2" fill="#15181B" />

      {/* head (broad, low) */}
      <Ellipse cx="56" cy="106" rx="30" ry="26" fill="url(#anim-buffalo-head)" />
      {/* large backward crescent horns */}
      <Path d="M40 84 Q8 76 6 50 Q4 42 12 44 Q18 70 46 78Z" fill="url(#anim-buffalo-horn)" />
      <Path d="M72 84 Q104 76 106 50 Q108 42 100 44 Q94 70 66 78Z" fill="url(#anim-buffalo-horn)" />
      {/* ears tucked under horns */}
      <Path d="M34 96 Q20 92 24 104 Q30 108 40 102Z" fill="#3D4347" />
      <Path d="M78 96 Q92 92 88 104 Q82 108 72 102Z" fill="#454B4F" />
      {/* eyes */}
      <Circle cx="46" cy="102" r="4.3" fill="#E9ECEE" />
      <Circle cx="46" cy="103" r="2.7" fill="#0E1113" />
      <Circle cx="66" cy="102" r="4.3" fill="#E9ECEE" />
      <Circle cx="66" cy="103" r="2.7" fill="#0E1113" />
      {/* lighter grey muzzle */}
      <Ellipse cx="56" cy="122" rx="17" ry="12" fill="url(#anim-buffalo-muzzle)" />
      <Ellipse cx="49" cy="122" rx="2.2" ry="3.2" fill="#3A4044" />
      <Ellipse cx="63" cy="122" rx="2.2" ry="3.2" fill="#3A4044" />

      {/* shine */}
      <Ellipse cx="84" cy="100" rx="16" ry="9" fill="rgba(255,255,255,0.16)" />
    </Svg>
  );
}

// GOAT — slim tan/white body, small backward horns, chin beard, floppy ears,
// alert eyes. Clearly smaller and slimmer than the cow.
function GoatIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-goat-body" light="#FFFDF7" base="#F0E6D0" dark="#D2C09C" />
        <Body3D id="anim-goat-head" light="#FFFDF7" base="#EFE4CE" dark="#D7C6A2" />
        <Body3DLinear id="anim-goat-horn" light="#E7DCC2" base="#BCA77E" dark="#8C7A52" />
      </Defs>
      <Shadow rx={50} />

      {/* slim body */}
      <Ellipse cx="106" cy="120" rx="48" ry="32" fill="url(#anim-goat-body)" />
      {/* short upright tail */}
      <Path d="M150 104 Q160 98 158 110 Q154 116 148 112Z" fill="url(#anim-goat-body)" />
      {/* slender legs */}
      <Rect x="80" y="146" width="8" height="32" rx="4" fill="#D2C09C" />
      <Rect x="100" y="148" width="8" height="30" rx="4" fill="#C2B088" />
      <Rect x="122" y="148" width="8" height="30" rx="4" fill="#D2C09C" />
      <Rect x="140" y="146" width="8" height="32" rx="4" fill="#C2B088" />
      <Rect x="80" y="174" width="8" height="5" rx="2" fill="#5A4A30" />
      <Rect x="140" y="174" width="8" height="5" rx="2" fill="#5A4A30" />

      {/* head (longish, alert) */}
      <Path d="M44 90 Q44 70 64 70 Q80 70 82 92 Q82 116 62 122 Q42 116 44 90Z" fill="url(#anim-goat-head)" />
      {/* floppy ears */}
      <Path d="M44 90 Q26 90 22 104 Q34 110 48 100Z" fill="#E0D0AC" />
      <Path d="M82 90 Q100 90 104 104 Q92 110 78 100Z" fill="#EADCBC" />
      {/* small backward horns */}
      <Path d="M52 70 Q44 52 50 50 Q56 56 58 70Z" fill="url(#anim-goat-horn)" />
      <Path d="M74 70 Q82 52 76 50 Q70 56 68 70Z" fill="url(#anim-goat-horn)" />
      {/* alert eyes */}
      <Circle cx="54" cy="90" r="4" fill="#FFFFFF" />
      <Ellipse cx="54" cy="91" rx="2.2" ry="2.6" fill="#241208" />
      <Circle cx="72" cy="90" r="4" fill="#FFFFFF" />
      <Ellipse cx="72" cy="91" rx="2.2" ry="2.6" fill="#241208" />
      {/* nose */}
      <Ellipse cx="63" cy="112" rx="8" ry="6" fill="#E3D2AE" />
      <Ellipse cx="59" cy="112" rx="1.4" ry="2" fill="#7A6440" />
      <Ellipse cx="67" cy="112" rx="1.4" ry="2" fill="#7A6440" />
      {/* chin beard */}
      <Path d="M58 120 Q60 138 68 142 Q66 128 70 120Z" fill="#E7DCC2" />
      <Path d="M62 124 Q62 134 66 140" stroke="rgba(150,130,90,0.4)" strokeWidth="1.5" fill="none" />

      {/* shine */}
      <Ellipse cx="86" cy="106" rx="12" ry="7" fill="rgba(255,255,255,0.32)" />
    </Svg>
  );
}

// BULLOCK — working ox: strong brown/grey build, prominent horns, AND a
// wooden YOKE across the shoulders + nose-rope (the "plough animal" signal).
function BullockIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-bullock-body" light="#B49474" base="#8A6A4A" dark="#5E4329" />
        <Body3D id="anim-bullock-head" light="#B79778" base="#8D6D4D" dark="#62482E" />
        <Body3DLinear id="anim-bullock-horn" light="#F2E8D2" base="#CDBA98" dark="#9A865E" />
        <Body3DLinear id="anim-bullock-yoke" light="#9C6B3E" base="#7A4F28" dark="#553318" />
      </Defs>
      <Shadow rx={62} />

      {/* strong body */}
      <Ellipse cx="108" cy="118" rx="58" ry="42" fill="url(#anim-bullock-body)" />
      {/* hump/shoulder */}
      <Path d="M72 84 Q90 56 126 74 Q104 82 88 102Z" fill="url(#anim-bullock-body)" />
      {/* tail */}
      <Path d="M164 114 Q178 128 172 154 Q170 160 166 156 Q172 136 160 124Z" fill="url(#anim-bullock-body)" />
      <Circle cx="169" cy="156" r="4.5" fill="#3F2D19" />
      {/* legs (strong) */}
      <Rect x="76" y="150" width="12" height="30" rx="5" fill="#6E5031" />
      <Rect x="100" y="152" width="12" height="28" rx="5" fill="#5A3F26" />
      <Rect x="128" y="152" width="12" height="28" rx="5" fill="#6E5031" />
      <Rect x="150" y="150" width="12" height="30" rx="5" fill="#5A3F26" />
      <Rect x="76" y="174" width="12" height="6" rx="2" fill="#2E2012" />
      <Rect x="150" y="174" width="12" height="6" rx="2" fill="#2E2012" />

      {/* WOODEN YOKE across the shoulders/neck */}
      <Path d="M58 70 Q104 50 150 70" stroke="url(#anim-bullock-yoke)" strokeWidth="13" strokeLinecap="round" fill="none" />
      <Path d="M60 72 Q104 54 148 72" stroke="rgba(255,255,255,0.18)" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* yoke pegs over the neck */}
      <Rect x="64" y="60" width="5" height="22" rx="2.5" fill="#5E3A1C" />
      <Rect x="78" y="56" width="5" height="22" rx="2.5" fill="#5E3A1C" />

      {/* head */}
      <Ellipse cx="56" cy="100" rx="28" ry="25" fill="url(#anim-bullock-head)" />
      {/* prominent horns */}
      <Path d="M40 78 Q24 54 34 50 Q44 58 48 76Z" fill="url(#anim-bullock-horn)" />
      <Path d="M72 78 Q88 54 78 50 Q68 58 64 76Z" fill="url(#anim-bullock-horn)" />
      {/* ears */}
      <Path d="M34 92 Q20 88 24 100 Q30 104 40 98Z" fill="#7A5A3B" />
      <Path d="M78 92 Q92 88 88 100 Q82 104 72 98Z" fill="#8A6A4A" />
      {/* eyes */}
      <Circle cx="47" cy="98" r="4.2" fill="#FFFFFF" />
      <Circle cx="47" cy="99" r="2.7" fill="#1E1108" />
      <Circle cx="67" cy="98" r="4.2" fill="#FFFFFF" />
      <Circle cx="67" cy="99" r="2.7" fill="#1E1108" />
      {/* muzzle + nose-rope */}
      <Ellipse cx="56" cy="116" rx="16" ry="11" fill="#A07A52" />
      <Ellipse cx="50" cy="116" rx="2" ry="3" fill="#3F2D19" />
      <Ellipse cx="62" cy="116" rx="2" ry="3" fill="#3F2D19" />
      <Path d="M40 118 Q56 130 72 118" stroke="#E8C98A" strokeWidth="3" fill="none" strokeLinecap="round" />
      <Circle cx="56" cy="124" r="2.4" fill="#C99A4E" />

      {/* shine */}
      <Ellipse cx="86" cy="100" rx="14" ry="8" fill="rgba(255,255,255,0.20)" />
    </Svg>
  );
}

// SHEEP — fluffy white/cream wool drawn as cloud-like bumps, small tan face,
// tiny ears.
function SheepIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-sheep-wool" light="#FFFFFF" base="#F4EFE4" dark="#D9D1BF" />
        <Body3D id="anim-sheep-face" light="#C8B294" base="#A88B6A" dark="#7E6346" />
      </Defs>
      <Shadow rx={56} />

      {/* cloud-like wool body — overlapping bumps */}
      <G fill="url(#anim-sheep-wool)">
        <Circle cx="72" cy="108" r="26" />
        <Circle cx="102" cy="96" r="30" />
        <Circle cx="136" cy="106" r="26" />
        <Circle cx="84" cy="132" r="26" />
        <Circle cx="116" cy="132" r="28" />
        <Circle cx="146" cy="128" r="22" />
        <Circle cx="62" cy="128" r="20" />
      </G>
      {/* wool shading dots (subtle) */}
      <Circle cx="118" cy="136" r="8" fill="rgba(0,0,0,0.04)" />
      <Circle cx="80" cy="128" r="7" fill="rgba(0,0,0,0.04)" />
      {/* legs */}
      <Rect x="82" y="150" width="9" height="28" rx="4" fill="#8E7656" />
      <Rect x="104" y="152" width="9" height="26" rx="4" fill="#7E6346" />
      <Rect x="126" y="152" width="9" height="26" rx="4" fill="#8E7656" />
      <Rect x="82" y="174" width="9" height="5" rx="2" fill="#4E3C26" />
      <Rect x="126" y="174" width="9" height="5" rx="2" fill="#4E3C26" />

      {/* tan face peeking out (front-left) */}
      <Ellipse cx="56" cy="110" rx="20" ry="22" fill="url(#anim-sheep-face)" />
      {/* woolly forelock */}
      <Path d="M46 92 Q56 80 70 92 Q60 88 56 96Z" fill="url(#anim-sheep-wool)" />
      {/* tiny ears */}
      <Ellipse cx="40" cy="106" rx="7" ry="4" fill="#8E7256" transform="rotate(-25 40 106)" />
      <Ellipse cx="74" cy="104" rx="7" ry="4" fill="#9C7E60" transform="rotate(25 74 104)" />
      {/* eyes */}
      <Circle cx="50" cy="108" r="3.4" fill="#1E120A" />
      <Circle cx="51" cy="107" r="1" fill="#FFFFFF" />
      <Circle cx="64" cy="108" r="3.4" fill="#1E120A" />
      <Circle cx="65" cy="107" r="1" fill="#FFFFFF" />
      {/* nose */}
      <Ellipse cx="57" cy="120" rx="6" ry="4.5" fill="#6E5440" />
      <Ellipse cx="54.5" cy="120" rx="1.2" ry="1.8" fill="#3A2A1C" />
      <Ellipse cx="59.5" cy="120" rx="1.2" ry="1.8" fill="#3A2A1C" />

      {/* shine on wool */}
      <Ellipse cx="96" cy="92" rx="18" ry="9" fill="rgba(255,255,255,0.45)" />
    </Svg>
  );
}

// POULTRY — plump hen/rooster: brown body, RED comb + wattle, ORANGE beak,
// orange legs/feet, small tail.
function PoultryIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-poultry-body" light="#E1A86E" base="#B97C46" dark="#8A5728" />
        <Body3D id="anim-poultry-head" light="#E6B077" base="#BE8149" dark="#925E2C" />
        <Body3DLinear id="anim-poultry-tail" light="#7A4E28" base="#5A3818" dark="#3A2410" />
        <Body3DLinear id="anim-poultry-comb" light="#F0564E" base="#D7263D" dark="#A2122A" />
        <Body3DLinear id="anim-poultry-beak" light="#FFC861" base="#F2A03D" dark="#C97A1E" />
      </Defs>
      <Shadow rx={48} />

      {/* plump body */}
      <Ellipse cx="98" cy="120" rx="46" ry="42" fill="url(#anim-poultry-body)" />
      {/* wing */}
      <Path d="M84 104 Q120 100 128 130 Q112 150 86 142 Q74 122 84 104Z" fill="#A66E3C" />
      <Path d="M92 116 Q112 114 118 132" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" fill="none" />
      {/* tail feathers (back) */}
      <Path d="M138 96 Q176 78 178 110 Q160 116 142 118Z" fill="url(#anim-poultry-tail)" />
      <Path d="M140 110 Q170 100 176 122 Q156 126 144 124Z" fill="#6A4420" />

      {/* head */}
      <Circle cx="76" cy="80" r="26" fill="url(#anim-poultry-head)" />
      {/* RED comb */}
      <Path d="M62 56 Q60 44 66 44 Q70 48 70 56Z" fill="url(#anim-poultry-comb)" />
      <Path d="M72 52 Q70 38 78 38 Q82 44 80 54Z" fill="url(#anim-poultry-comb)" />
      <Path d="M84 54 Q84 42 92 44 Q94 50 90 58Z" fill="url(#anim-poultry-comb)" />
      {/* eye */}
      <Circle cx="70" cy="76" r="4.5" fill="#FFFFFF" />
      <Circle cx="70" cy="76" r="2.8" fill="#1A0E06" />
      <Circle cx="71" cy="75" r="0.9" fill="#FFFFFF" />
      {/* ORANGE beak */}
      <Polygon points="52,80 32,84 52,90" fill="url(#anim-poultry-beak)" />
      <Path d="M52 85 L34 86" stroke="rgba(0,0,0,0.20)" strokeWidth="1.5" />
      {/* RED wattle */}
      <Path d="M56 92 Q52 106 62 106 Q64 98 62 92Z" fill="url(#anim-poultry-comb)" />

      {/* orange legs + feet */}
      <Line x1="86" y1="158" x2="84" y2="176" stroke="#E08A1E" strokeWidth="5" strokeLinecap="round" />
      <Line x1="106" y1="158" x2="110" y2="176" stroke="#E08A1E" strokeWidth="5" strokeLinecap="round" />
      <Path d="M76 178 L84 176 L92 178" stroke="#E08A1E" strokeWidth="4" strokeLinecap="round" fill="none" />
      <Path d="M102 178 L110 176 L118 178" stroke="#E08A1E" strokeWidth="4" strokeLinecap="round" fill="none" />

      {/* shine */}
      <Ellipse cx="92" cy="98" rx="14" ry="8" fill="rgba(255,255,255,0.24)" />
    </Svg>
  );
}

// HORSE — chestnut body, long face, upright ears, flowing mane, tail, legs.
function HorseIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-horse-body" light="#B5743F" base="#8A4F22" dark="#5C3212" />
        <Body3DLinear id="anim-horse-neck" light="#A8682F" base="#824A1E" dark="#5A3010" />
        <Body3DLinear id="anim-horse-mane" light="#5A3416" base="#3E230D" dark="#241308" />
      </Defs>
      <Shadow rx={58} />

      {/* body */}
      <Ellipse cx="118" cy="120" rx="52" ry="34" fill="url(#anim-horse-body)" />
      {/* tail (flowing) */}
      <Path d="M166 102 Q188 112 184 154 Q178 162 174 156 Q184 132 162 120Z" fill="url(#anim-horse-mane)" />
      {/* legs (slender) */}
      <Rect x="92" y="146" width="9" height="34" rx="4" fill="#6E3F1A" />
      <Rect x="112" y="148" width="9" height="32" rx="4" fill="#5C3212" />
      <Rect x="136" y="148" width="9" height="32" rx="4" fill="#6E3F1A" />
      <Rect x="154" y="146" width="9" height="34" rx="4" fill="#5C3212" />
      <Rect x="92" y="176" width="9" height="5" rx="2" fill="#2E1A0A" />
      <Rect x="154" y="176" width="9" height="5" rx="2" fill="#2E1A0A" />

      {/* neck rising up-left */}
      <Path d="M72 130 Q58 86 70 56 Q82 50 92 60 Q86 92 100 124Z" fill="url(#anim-horse-neck)" />
      {/* long face */}
      <Path d="M58 60 Q52 40 66 36 Q82 36 86 56 Q86 74 70 78 Q56 74 58 60Z" fill="url(#anim-horse-body)" />
      {/* flowing mane */}
      <Path d="M84 58 Q98 50 96 70 Q88 66 84 74Z" fill="url(#anim-horse-mane)" />
      <Path d="M88 70 Q104 66 100 90 Q90 82 84 92Z" fill="url(#anim-horse-mane)" />
      <Path d="M92 92 Q108 92 100 116 Q92 104 84 112Z" fill="url(#anim-horse-mane)" />
      {/* upright ears */}
      <Path d="M62 38 Q56 24 64 26 Q68 32 68 40Z" fill="#8A4F22" />
      <Path d="M76 38 Q84 24 84 32 Q80 38 74 42Z" fill="#7A451E" />
      {/* forelock tuft between the ears */}
      <Path d="M68 36 Q72 26 76 34 Q72 40 70 46Z" fill="url(#anim-horse-mane)" />
      {/* eye + nostril */}
      <Circle cx="68" cy="54" r="3.6" fill="#1A0E06" />
      <Circle cx="69" cy="53" r="1" fill="#FFFFFF" />
      <Ellipse cx="64" cy="70" rx="3" ry="4" fill="#3A2010" />
      <Ellipse cx="63" cy="70" rx="1.2" ry="1.8" fill="#160B04" />

      {/* shine */}
      <Ellipse cx="106" cy="104" rx="16" ry="8" fill="rgba(255,255,255,0.22)" />
    </Svg>
  );
}

// CAMEL — sandy/tan body, single hump, long curved neck, small head, long legs.
function CamelIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-camel-body" light="#EBC98E" base="#CFA463" dark="#A67C3C" />
        <Body3DLinear id="anim-camel-neck" light="#E2BD80" base="#C69C5B" dark="#9E7436" />
        <Body3D id="anim-camel-head" light="#E8C589" base="#CCA160" dark="#A47A39" />
      </Defs>
      <Shadow rx={56} />

      {/* body */}
      <Ellipse cx="116" cy="124" rx="48" ry="28" fill="url(#anim-camel-body)" />
      {/* single hump — tall and rounded (the key camel signal) */}
      <Path d="M86 104 Q112 48 140 104 Q116 88 100 104Z" fill="url(#anim-camel-body)" />
      {/* tail */}
      <Path d="M162 116 Q174 124 170 146 Q167 150 164 147 Q170 130 158 122Z" fill="url(#anim-camel-body)" />
      {/* long legs */}
      <Rect x="92" y="148" width="9" height="32" rx="4" fill="#B68A4A" />
      <Rect x="108" y="150" width="9" height="30" rx="4" fill="#A67C3C" />
      <Rect x="132" y="150" width="9" height="30" rx="4" fill="#B68A4A" />
      <Rect x="150" y="148" width="9" height="32" rx="4" fill="#A67C3C" />
      <Rect x="92" y="176" width="9" height="5" rx="2" fill="#6E5224" />
      <Rect x="150" y="176" width="9" height="5" rx="2" fill="#6E5224" />

      {/* long curved neck */}
      <Path d="M84 130 Q60 110 56 70 Q56 56 68 56 Q70 96 100 120Z" fill="url(#anim-camel-neck)" />
      {/* small head */}
      <Path d="M48 64 Q42 48 56 46 Q70 48 70 64 Q70 78 58 80 Q48 76 48 64Z" fill="url(#anim-camel-head)" />
      {/* small ears */}
      <Path d="M56 46 Q52 38 58 40 Q60 44 60 48Z" fill="#B68A4A" />
      <Path d="M64 46 Q70 38 70 44 Q66 48 62 50Z" fill="#A67C3C" />
      {/* eye + nostril + mouth */}
      <Circle cx="58" cy="60" r="3.2" fill="#1E120A" />
      <Circle cx="59" cy="59" r="0.9" fill="#FFFFFF" />
      <Ellipse cx="51" cy="72" rx="2.4" ry="3" fill="#7A5A2E" />
      <Path d="M46 76 Q52 80 58 76" stroke="#8A6A38" strokeWidth="2" fill="none" strokeLinecap="round" />

      {/* shine */}
      <Ellipse cx="104" cy="110" rx="14" ry="7" fill="rgba(255,255,255,0.26)" />
    </Svg>
  );
}

// PIG — pink body, round snout with two nostrils, floppy ears, curly tail.
function PigIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-pig-body" light="#FBD3D6" base="#F2A8B0" dark="#D67E8C" />
        <Body3D id="anim-pig-head" light="#FBD6D9" base="#F3ADB5" dark="#DA8593" />
        <Body3D id="anim-pig-snout" light="#F6BEC6" base="#E89AA6" dark="#C97585" />
      </Defs>
      <Shadow rx={58} />

      {/* round body */}
      <Ellipse cx="110" cy="118" rx="56" ry="42" fill="url(#anim-pig-body)" />
      {/* curly tail */}
      <Path d="M164 108 Q180 102 174 116 Q168 124 178 124 Q184 124 182 118"
        stroke="#D67E8C" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* legs (short, stubby) */}
      <Rect x="80" y="150" width="12" height="28" rx="5" fill="#DD8896" />
      <Rect x="104" y="152" width="12" height="26" rx="5" fill="#CE7382" />
      <Rect x="128" y="152" width="12" height="26" rx="5" fill="#DD8896" />
      <Rect x="150" y="150" width="12" height="28" rx="5" fill="#CE7382" />
      <Rect x="80" y="173" width="12" height="6" rx="2" fill="#A85968" />
      <Rect x="150" y="173" width="12" height="6" rx="2" fill="#A85968" />

      {/* head */}
      <Circle cx="62" cy="100" r="30" fill="url(#anim-pig-head)" />
      {/* floppy ears */}
      <Path d="M42 76 Q34 60 50 64 Q54 70 54 84Z" fill="#E893A1" />
      <Path d="M82 76 Q90 60 74 64 Q70 70 70 84Z" fill="#EFA0AD" />
      {/* eyes */}
      <Circle cx="52" cy="96" r="3.6" fill="#FFFFFF" />
      <Circle cx="52" cy="96" r="2.3" fill="#3A1E22" />
      <Circle cx="72" cy="96" r="3.6" fill="#FFFFFF" />
      <Circle cx="72" cy="96" r="2.3" fill="#3A1E22" />
      {/* round snout with two nostrils */}
      <Ellipse cx="62" cy="114" rx="15" ry="11" fill="url(#anim-pig-snout)" />
      <Ellipse cx="62" cy="114" rx="15" ry="11" fill="none" stroke="rgba(170,90,104,0.4)" strokeWidth="1.5" />
      <Ellipse cx="56" cy="114" rx="2.4" ry="4" fill="#A85968" />
      <Ellipse cx="68" cy="114" rx="2.4" ry="4" fill="#A85968" />

      {/* shine */}
      <Ellipse cx="84" cy="96" rx="14" ry="8" fill="rgba(255,255,255,0.34)" />
    </Svg>
  );
}

// DUCK — domestic white duck: cream body, folded wing, rounded head, bright orange bill, webbed feet.
function DuckIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-duck-body" light="#FFFFFF" base="#F3EFE3" dark="#D8D0BC" />
        <Body3D id="anim-duck-head" light="#FFFFFF" base="#F4F0E5" dark="#DBD3C0" />
        <Body3DLinear id="anim-duck-bill" light="#FFC861" base="#F2933D" dark="#C96A1E" />
        <Body3DLinear id="anim-duck-foot" light="#FFB04A" base="#F08A2C" dark="#C96A1E" />
      </Defs>
      <Shadow rx={56} />
      <Ellipse cx="118" cy="120" rx="54" ry="42" fill="url(#anim-duck-body)" />
      <Ellipse cx="100" cy="165" rx="9" ry="13" fill="url(#anim-duck-foot)" />
      <Ellipse cx="128" cy="167" rx="9" ry="13" fill="url(#anim-duck-foot)" />
      <Path d="M150 96 Q186 84 180 130 Q160 122 150 110Z" fill="url(#anim-duck-body)" />
      <Path d="M152 100 Q176 92 174 120" stroke="#D8D0BC" strokeWidth="3" fill="none" strokeLinecap="round" />
      <Ellipse cx="170" cy="118" rx="12" ry="8" fill="#EDE7D8" />
      <Circle cx="66" cy="86" r="30" fill="url(#anim-duck-head)" />
      <Path d="M40 92 Q6 86 18 102 Q8 104 22 110 Q34 112 44 102Z" fill="url(#anim-duck-bill)" />
      <Ellipse cx="20" cy="100" rx="2.2" ry="3.2" fill="#B0581A" />
      <Circle cx="58" cy="80" r="3.8" fill="#FFFFFF" /><Circle cx="58" cy="80" r="2.4" fill="#2A211A" />
      <Ellipse cx="60" cy="74" rx="11" ry="7" fill="rgba(255,255,255,0.30)" />
      <Ellipse cx="106" cy="104" rx="20" ry="11" fill="rgba(255,255,255,0.28)" />
    </Svg>
  );
}

// RABBIT — sitting rabbit: grey body, white belly, two long pink-inner ears, fluffy tail, pink nose, whiskers.
function RabbitIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-rabbit-body" light="#EAEAEA" base="#C7C7C7" dark="#9C9C9C" />
        <Body3D id="anim-rabbit-head" light="#EEEEEE" base="#CBCBCB" dark="#A0A0A0" />
        <Body3D id="anim-rabbit-belly" light="#FFFFFF" base="#F2F2F2" dark="#D8D8D8" />
      </Defs>
      <Shadow rx={50} />
      <Ellipse cx="100" cy="128" rx="46" ry="44" fill="url(#anim-rabbit-body)" />
      <Ellipse cx="100" cy="142" rx="28" ry="28" fill="url(#anim-rabbit-belly)" />
      <Ellipse cx="150" cy="140" rx="14" ry="13" fill="#F4F4F4" stroke="#D2D2D2" strokeWidth="2" />
      <Path d="M78 78 Q70 22 86 26 Q96 30 92 82Z" fill="url(#anim-rabbit-head)" />
      <Path d="M81 74 Q76 36 86 38 Q91 42 88 76Z" fill="#F2B8C2" />
      <Path d="M104 78 Q110 22 124 30 Q130 38 118 84Z" fill="url(#anim-rabbit-head)" />
      <Path d="M108 75 Q114 38 122 44 Q124 50 116 80Z" fill="#F2B8C2" />
      <Circle cx="92" cy="98" r="30" fill="url(#anim-rabbit-head)" />
      <Circle cx="82" cy="94" r="4.2" fill="#FFFFFF" /><Circle cx="82" cy="94" r="2.8" fill="#2A2622" />
      <Circle cx="83" cy="92.5" r="1" fill="#FFFFFF" />
      <Path d="M88 108 Q92 112 96 108" stroke="#A0A0A0" strokeWidth="2" fill="none" strokeLinecap="round" />
      <Ellipse cx="92" cy="106" rx="3.4" ry="2.4" fill="#F2A6B4" />
      <Line x1="70" y1="106" x2="48" y2="102" stroke="#B8B8B8" strokeWidth="1.6" strokeLinecap="round" />
      <Line x1="70" y1="110" x2="48" y2="112" stroke="#B8B8B8" strokeWidth="1.6" strokeLinecap="round" />
      <Ellipse cx="84" cy="86" rx="12" ry="8" fill="rgba(255,255,255,0.28)" />
    </Svg>
  );
}

// DONKEY — grey donkey: grey body, long upright ears with dark tips, dark mane, lighter muzzle, tail tuft.
function DonkeyIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-donkey-body" light="#B9BEC2" base="#8E9498" dark="#5F6468" />
        <Body3D id="anim-donkey-head" light="#BDC2C6" base="#92989C" dark="#62676B" />
        <Body3D id="anim-donkey-muzzle" light="#CDD1D4" base="#AEB3B6" dark="#8A8F92" />
      </Defs>
      <Shadow rx={54} />
      <Ellipse cx="112" cy="118" rx="52" ry="38" fill="url(#anim-donkey-body)" />
      <Path d="M160 130 Q176 138 168 156 Q164 150 162 142" fill="#5F6468" />
      <Path d="M165 150 Q172 152 170 162 Q166 162 164 156Z" fill="#3A3E41" />
      <Rect x="84" y="148" width="11" height="28" rx="4" fill="#82888C" />
      <Rect x="120" y="148" width="11" height="28" rx="4" fill="#72787C" />
      <Path d="M58 96 Q40 96 30 132 Q44 140 58 122Z" fill="url(#anim-donkey-head)" />
      <Path d="M44 78 Q38 36 54 42 Q60 50 58 90Z" fill="url(#anim-donkey-head)" />
      <Path d="M46 50 Q42 40 52 44 Q55 50 54 60Z" fill="#3F4346" />
      <Path d="M70 76 Q66 34 82 42 Q86 52 82 88Z" fill="url(#anim-donkey-head)" />
      <Path d="M72 48 Q70 40 80 44 Q82 50 80 60Z" fill="#3F4346" />
      <Circle cx="62" cy="104" r="28" fill="url(#anim-donkey-head)" />
      <Path d="M76 80 Q90 70 88 96 Q82 92 76 90Z" fill="#3A2E22" />
      <Ellipse cx="48" cy="124" rx="18" ry="14" fill="url(#anim-donkey-muzzle)" />
      <Ellipse cx="42" cy="124" rx="2.6" ry="3.6" fill="#5A5F62" />
      <Circle cx="56" cy="98" r="3.8" fill="#FFFFFF" /><Circle cx="56" cy="98" r="2.4" fill="#26211C" />
      <Ellipse cx="58" cy="92" rx="11" ry="7" fill="rgba(255,255,255,0.26)" />
      <Ellipse cx="96" cy="102" rx="18" ry="10" fill="rgba(255,255,255,0.24)" />
    </Svg>
  );
}

// DOG — friendly tan desi dog: tan body, floppy + alert ears, black nose, pink tongue, raised tail, red collar.
function DogIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-dog-body" light="#E0B97E" base="#BC8A4E" dark="#8A5E2C" />
        <Body3D id="anim-dog-head" light="#E4BE83" base="#C09053" dark="#8E6230" />
        <Body3D id="anim-dog-ear" light="#C79A60" base="#A0743C" dark="#704E22" />
      </Defs>
      <Shadow rx={54} />
      <Ellipse cx="116" cy="120" rx="52" ry="40" fill="url(#anim-dog-body)" />
      <Path d="M158 116 Q182 96 174 124 Q166 132 156 124Z" fill="url(#anim-dog-body)" />
      <Rect x="86" y="150" width="12" height="28" rx="5" fill="#A87C42" />
      <Rect x="122" y="152" width="12" height="26" rx="5" fill="#946C38" />
      <Path d="M44 78 Q30 70 32 102 Q44 100 52 86Z" fill="url(#anim-dog-ear)" />
      <Path d="M86 70 Q96 56 100 84 Q92 88 84 82Z" fill="url(#anim-dog-ear)" />
      <Circle cx="68" cy="100" r="32" fill="url(#anim-dog-head)" />
      <Ellipse cx="56" cy="118" rx="18" ry="15" fill="#D9B277" />
      <Ellipse cx="48" cy="116" rx="7" ry="6" fill="#241B12" />
      <Ellipse cx="46" cy="114" rx="2.4" ry="1.8" fill="#5A4A38" />
      <Path d="M52 126 Q50 142 58 140 Q60 132 58 126Z" fill="#E87D8E" />
      <Circle cx="60" cy="92" r="3.8" fill="#FFFFFF" /><Circle cx="60" cy="92" r="2.4" fill="#241B12" />
      <Circle cx="80" cy="94" r="3.8" fill="#FFFFFF" /><Circle cx="80" cy="94" r="2.4" fill="#241B12" />
      <Path d="M78 142 Q98 134 138 138" stroke="#D7263D" strokeWidth="8" fill="none" strokeLinecap="round" />
      <Circle cx="92" cy="146" r="4.5" fill="#F2C94C" stroke="#C99A1E" strokeWidth="1.4" />
      <Ellipse cx="62" cy="84" rx="13" ry="8" fill="rgba(255,255,255,0.28)" />
    </Svg>
  );
}

// FISH — rohu-type fish sideways: blue-silver body, orange forked tail + fins, scale texture, gill line.
function FishIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="anim-fish-body" light="#BFE3F5" base="#6FA8D6" dark="#3E6E9E" />
        <Body3DLinear id="anim-fish-fin" light="#FFC861" base="#F2933D" dark="#C96A1E" />
      </Defs>
      <Shadow rx={56} />
      <Path d="M150 100 Q176 78 182 100 Q176 122 150 100Z" fill="url(#anim-fish-fin)" />
      <Path d="M96 70 Q104 50 122 74 Q108 78 96 82Z" fill="url(#anim-fish-fin)" />
      <Path d="M92 128 Q100 150 118 128 Q106 124 96 124Z" fill="url(#anim-fish-fin)" />
      <Ellipse cx="92" cy="100" rx="64" ry="38" fill="url(#anim-fish-body)" />
      <Path d="M52 70 Q48 100 52 130" stroke="#3E6E9E" strokeWidth="3" fill="none" strokeLinecap="round" />
      <Path d="M74 78 Q70 86 74 94" stroke="#4E7EAE" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <Path d="M92 80 Q88 88 92 96" stroke="#4E7EAE" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <Path d="M110 82 Q106 90 110 98" stroke="#4E7EAE" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <Circle cx="44" cy="94" r="9" fill="#FFFFFF" />
      <Circle cx="44" cy="94" r="5.5" fill="#241B12" />
      <Circle cx="42" cy="91.5" r="1.8" fill="#FFFFFF" />
      <Ellipse cx="70" cy="80" rx="26" ry="10" fill="rgba(255,255,255,0.28)" />
    </Svg>
  );
}

// HONEYBEE — plump bee: yellow body with black stripes, dark head, antennae, two translucent wings, stinger.
function HoneybeeIcon({ size }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="anim-bee-body" light="#FFE082" base="#FBC02D" dark="#E0A50A" />
        <Body3D id="anim-bee-head" light="#4A453E" base="#2A2622" dark="#161310" />
      </Defs>
      <Shadow rx={34} />
      <Ellipse cx="112" cy="108" rx="46" ry="34" fill="url(#anim-bee-body)" />
      <Path d="M148 96 Q160 108 148 120 Q140 114 140 108 Q140 102 148 96Z" fill="#2A2622" />
      <Path d="M124 78 Q132 104 124 138 Q116 104 124 78Z" fill="#2A2622" />
      <Path d="M100 80 Q106 104 100 136 Q94 104 100 80Z" fill="#2A2622" />
      <Path d="M76 84 Q80 106 76 130 Q72 106 76 84Z" fill="#2A2622" />
      <Ellipse cx="96" cy="148" rx="6" ry="9" fill="#FBC02D" />
      <Ellipse cx="118" cy="150" rx="6" ry="9" fill="#E0A50A" />
      <Path d="M66 102 Q44 108 62 130 Q56 112 68 110Z" fill="#161310" />
      <Circle cx="58" cy="104" r="22" fill="url(#anim-bee-head)" />
      <Line x1="48" y1="86" x2="38" y2="68" stroke="#2A2622" strokeWidth="2.4" strokeLinecap="round" />
      <Line x1="60" y1="84" x2="58" y2="64" stroke="#2A2622" strokeWidth="2.4" strokeLinecap="round" />
      <Circle cx="38" cy="68" r="3" fill="#2A2622" /><Circle cx="58" cy="64" r="3" fill="#2A2622" />
      <Circle cx="50" cy="102" r="3.6" fill="#FFFFFF" /><Circle cx="50" cy="102" r="2.3" fill="#FFE082" />
      <Ellipse cx="100" cy="74" rx="30" ry="20" fill="rgba(255,255,255,0.55)" stroke="#D8D8D8" strokeWidth="1.4" transform="rotate(-22 100 74)" />
      <Ellipse cx="132" cy="80" rx="24" ry="16" fill="rgba(255,255,255,0.5)" stroke="#D8D8D8" strokeWidth="1.4" transform="rotate(12 132 80)" />
      <Ellipse cx="96" cy="96" rx="16" ry="9" fill="rgba(255,255,255,0.26)" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry + public API
// ─────────────────────────────────────────────────────────────────────────────

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
  Pig: PigIcon,
  Duck: DuckIcon,
  Rabbit: RabbitIcon,
  Donkey: DonkeyIcon,
  Dog: DogIcon,
  Fish: FishIcon,
  Honeybee: HoneybeeIcon,
};

export default function AnimalIcon({ type, size = 48 }) {
  const Icon = ANIMAL_ICON_MAP[type];
  if (!Icon) return null;
  return <Icon size={size} />;
}

export { ANIMAL_ICON_MAP };
