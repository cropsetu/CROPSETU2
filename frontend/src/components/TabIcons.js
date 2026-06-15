/**
 * TabIcons.js — bold, 2-tone, pure-vector SVG icons for the 6 BOTTOM TABS.
 *
 * These render small (~24-28px) so — unlike CropIcons.js / ActivityIcons.js —
 * they are deliberately SIMPLE, bold, filled shapes (detail turns to mud at this
 * size). A cohesive set with the same visual weight.
 *
 * All tabs render in FULL brand colour (forest green / gold gradients + a top-left
 * white shine + a soft ground shadow) — bright, friendly icons read best for
 * low-literacy users. The ACTIVE tab is shown by the pill background + bold label +
 * press scale in AppNavigator (not by greying-out the inactive icons). The `focused`
 * prop is still accepted for API parity but currently always renders coloured.
 *
 * STATIC by design: the tab bar (AppNavigator → TabItem) already animates a
 * pill + scale on press, so a calm icon is better here. An `animated` prop is
 * still accepted for API parity with the sibling icon files (it is a no-op).
 *
 * Conventions shared with ActivityIcons.js / CropIcons.js:
 *   • viewBox="0 0 200 200", width=height=size
 *   • soft ground-shadow ellipse at cy≈178 (focused only)
 *   • a top-left white shine highlight (focused only)
 *   • 3-stop gradients (light/base/dark) for a 3D feel (focused only)
 *   • CRITICAL: react-native-svg gradient ids are GLOBAL — every id is
 *     prefixed per-variant ("tab-shop-…") so two icons never clash on one screen.
 *
 * Usage:  <TabIcon name="shop" size={26} focused />
 */
import React from 'react';
import { View } from 'react-native';
import Svg, {
  Defs, RadialGradient, LinearGradient, Stop,
  Ellipse, Circle, Path, Rect, G, Line, Polygon,
} from 'react-native-svg';

// ── Brand palette (mirrors constants/colors.js) ─────────────────────────────
const BRAND = {
  green: { light: '#3DAA74', base: '#176B43', dark: '#084C37' }, // forest green
  gold:  { light: '#FDE68A', base: '#E0AF3B', dark: '#A47B12' }, // harvest gold
};
const SAGE = '#8A938C';        // COLORS.mutedSage — the single inactive tone
const SAGE_DARK = '#6E776F';   // a touch darker, for inactive depth accents
const WHEEL_DARK = '#2A302C';  // near-black tire tone (focused tractor wheels only)

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Soft ground shadow — only drawn when focused (keeps inactive icons flat). */
const Shadow = ({ on, cx = 100, rx = 48, ry = 8 }) =>
  on ? <Ellipse cx={cx} cy={178} rx={rx} ry={ry} fill="rgba(0,0,0,0.12)" /> : null;

/** Top-left white shine — only drawn when focused. */
const Shine = ({ on, cx, cy, rx, ry }) =>
  on ? <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="rgba(255,255,255,0.28)" /> : null;

const Body3D = ({ id, light, base, dark }) => (
  <RadialGradient id={id} cx="36%" cy="30%" r="82%">
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

/**
 * Resolve the fill for a shape:
 *   • focused → url(#id) of a brand gradient
 *   • inactive → a flat sage tone
 */
const fill = (focused, gradId, sage = SAGE) => (focused ? `url(#${gradId})` : sage);

// ─────────────────────────────────────────────────────────────────────────────
// ── TAB ICONS ────────────────────────────────────────────────────────────────
// Each: bold silhouette + one accent shape. Cohesive weight across the set.
// ─────────────────────────────────────────────────────────────────────────────

// SHOP — a storefront with a striped awning (AgriStore)
function ShopIcon({ size, focused }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="tab-shop-body" light={BRAND.green.light} base={BRAND.green.base} dark={BRAND.green.dark} />
        <Body3DLinear id="tab-shop-awn"  light={BRAND.gold.light}  base={BRAND.gold.base}  dark={BRAND.gold.dark} />
      </Defs>
      <Shadow on={focused} rx={52} />
      {/* Shop building */}
      <Path d="M44 90 L156 90 L156 158 Q156 166 148 166 L52 166 Q44 166 44 158 Z"
        fill={fill(focused, 'tab-shop-body')} />
      {/* Door */}
      <Rect x="86" y="118" width="28" height="48" rx="4"
        fill={focused ? 'rgba(255,255,255,0.92)' : '#FFFFFF'} opacity={focused ? 1 : 0.85} />
      {/* Awning (striped scallop) */}
      <Path d="M38 60 L162 60 L168 92 Q150 84 138 92 Q126 84 114 92 Q102 84 90 92 Q78 84 66 92 Q54 84 42 92 Q34 84 32 92 Z"
        fill={fill(focused, 'tab-shop-awn', SAGE_DARK)} />
      <Shine on={focused} cx={70} cy={108} rx={9} ry={20} />
    </Svg>
  );
}

// AI — a friendly leaf-chip spark (KhetAI brand: green leaf → gold spark)
function AiIcon({ size, focused }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="tab-ai-leaf"  light={BRAND.green.light} base={BRAND.green.base} dark={BRAND.green.dark} />
        <Body3D       id="tab-ai-spark" light={BRAND.gold.light}  base={BRAND.gold.base}  dark={BRAND.gold.dark} />
      </Defs>
      <Shadow on={focused} rx={48} />
      {/* Leaf-chip body (rounded leaf: pointed top-right, round bottom-left) */}
      <Path d="M62 142 Q40 120 44 86 Q48 52 84 44 Q120 36 146 56 Q150 96 128 124 Q104 150 62 142 Z"
        fill={fill(focused, 'tab-ai-leaf')} />
      {/* Midrib vein */}
      <Path d="M68 138 Q98 104 134 64"
        stroke={focused ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.55)'}
        strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Gold spark (the "AI" intelligence dot) — top-right */}
      <Polygon points="146,40 154,62 176,70 154,78 146,100 138,78 116,70 138,62"
        fill={fill(focused, 'tab-ai-spark', SAGE_DARK)} />
      <Shine on={focused} cx={74} cy={74} rx={8} ry={14} />
    </Svg>
  );
}

// ANIMAL — a clean, friendly COW head (AnimalTrade): big sideways ears,
// short curved zebu horns, broad muzzle with a mouth line, oval cow eyes.
function AnimalIcon({ size, focused }) {
  const ink = focused ? BRAND.green.dark : SAGE_DARK;
  const headFill = fill(focused, 'tab-animal-head');
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="tab-animal-head" light={BRAND.green.light} base={BRAND.green.base} dark={BRAND.green.dark} />
        <Body3DLinear id="tab-animal-horn" light="#F4ECD6" base="#D9C49A" dark="#A98D5C" />
      </Defs>
      <Shadow on={focused} rx={52} />
      {/* Short curved ivory zebu horns, from the top of the head */}
      <Path d="M82 84 Q68 62 56 54 Q63 48 76 60 Q86 72 89 84 Z" fill={focused ? 'url(#tab-animal-horn)' : SAGE} />
      <Path d="M118 84 Q132 62 144 54 Q137 48 124 60 Q114 72 111 84 Z" fill={focused ? 'url(#tab-animal-horn)' : SAGE} />
      {/* Big sideways ears */}
      <Ellipse cx="42" cy="110" rx="24" ry="13" fill={headFill} transform="rotate(-22,42,110)" />
      <Ellipse cx="158" cy="110" rx="24" ry="13" fill={headFill} transform="rotate(22,158,110)" />
      <Ellipse cx="46" cy="110" rx="12" ry="6" fill={ink} opacity={0.35} transform="rotate(-22,46,110)" />
      <Ellipse cx="154" cy="110" rx="12" ry="6" fill={ink} opacity={0.35} transform="rotate(22,154,110)" />
      {/* Head — rounded, tapering to the muzzle */}
      <Path d="M62 96 Q100 82 138 96 Q151 110 148 134 Q145 157 120 168 Q100 176 80 168 Q55 157 52 134 Q49 110 62 96 Z"
        fill={headFill} />
      {/* Forelock tuft between the horns */}
      <Path d="M86 92 Q100 76 114 92 Q100 101 86 92 Z" fill={ink} opacity={0.5} />
      {/* Broad muzzle (lighter) */}
      <Path d="M66 144 Q100 132 134 144 Q139 159 120 167 Q100 173 80 167 Q61 159 66 144 Z"
        fill={focused ? 'rgba(255,255,255,0.94)' : '#FFFFFF'} opacity={focused ? 1 : 0.85} />
      {/* Nostrils + mouth line */}
      <Path d="M84 150 Q89 145 94 150 Q92 157 87 156 Q83 155 84 150 Z" fill={ink} />
      <Path d="M116 150 Q111 145 106 150 Q108 157 113 156 Q117 155 116 150 Z" fill={ink} />
      <Path d="M88 161 Q100 167 112 161" stroke={ink} strokeWidth="2.4" strokeLinecap="round" fill="none" opacity={0.7} />
      {/* Oval cow eyes — white with a dark pupil */}
      <Ellipse cx="82" cy="120" rx="8" ry="7" fill="#FFFFFF" />
      <Ellipse cx="118" cy="120" rx="8" ry="7" fill="#FFFFFF" />
      <Circle cx="83" cy="121" r="3.6" fill={ink} />
      <Circle cx="117" cy="121" r="3.6" fill={ink} />
      <Shine on={focused} cx={76} cy={106} rx={9} ry={7} />
    </Svg>
  );
}

// RENT — a bold tractor (Rent)
function RentIcon({ size, focused }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="tab-rent-body"  light={BRAND.green.light} base={BRAND.green.base} dark={BRAND.green.dark} />
      </Defs>
      <Shadow on={focused} rx={56} />
      {/* Cab + hood body */}
      <Path d="M58 110 L58 78 Q58 70 66 70 L96 70 Q104 70 106 78 L112 104 L150 104 Q160 104 160 114 L160 132 L50 132 Q42 132 42 124 L42 118 Q42 110 50 110 Z"
        fill={fill(focused, 'tab-rent-body')} />
      {/* Cab window */}
      <Rect x="66" y="80" width="30" height="22" rx="4"
        fill={focused ? 'rgba(255,255,255,0.9)' : '#FFFFFF'} opacity={focused ? 1 : 0.85} />
      {/* Exhaust pipe */}
      <Rect x="114" y="52" width="9" height="30" rx="4" fill={fill(focused, 'tab-rent-body', SAGE_DARK)} />
      {/* Big rear wheel */}
      <Circle cx="138" cy="140" r="28" fill={focused ? WHEEL_DARK : SAGE_DARK} />
      <Circle cx="138" cy="140" r="13" fill={focused ? BRAND.gold.base : '#FFFFFF'} opacity={focused ? 1 : 0.85} />
      {/* Small front wheel */}
      <Circle cx="62" cy="146" r="18" fill={focused ? WHEEL_DARK : SAGE_DARK} />
      <Circle cx="62" cy="146" r="8" fill={focused ? BRAND.gold.base : '#FFFFFF'} opacity={focused ? 1 : 0.85} />
      <Shine on={focused} cx={66} cy={86} rx={7} ry={9} />
    </Svg>
  );
}

// FARM — a green sprout over field rows (MyFarm)
function FarmIcon({ size, focused }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3DLinear id="tab-farm-leaf"  light={BRAND.green.light} base={BRAND.green.base} dark={BRAND.green.dark} />
        <Body3DLinear id="tab-farm-field" light={BRAND.gold.light}  base={BRAND.gold.base}  dark={BRAND.gold.dark} />
      </Defs>
      <Shadow on={focused} rx={52} />
      {/* Field rows (soil mound) */}
      <Path d="M36 138 Q60 124 100 124 Q140 124 164 138 Q164 160 100 162 Q36 160 36 138 Z"
        fill={fill(focused, 'tab-farm-field', SAGE_DARK)} />
      <Path d="M52 142 Q100 132 148 142"
        stroke={focused ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.4)'} strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* Stem */}
      <Path d="M100 128 Q100 96 100 64"
        stroke={fill(focused, 'tab-farm-leaf')} strokeWidth="9" strokeLinecap="round" fill="none" />
      {/* Left leaf */}
      <Path d="M100 96 Q66 90 48 62 Q86 56 100 92 Z" fill={fill(focused, 'tab-farm-leaf')} />
      {/* Right leaf */}
      <Path d="M100 84 Q134 76 152 48 Q116 44 100 80 Z" fill={fill(focused, 'tab-farm-leaf')} />
      <Shine on={focused} cx={70} cy={72} rx={6} ry={9} />
    </Svg>
  );
}

// ACCOUNT — a person (Account)
function AccountIcon({ size, focused }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D       id="tab-acct-head" light={BRAND.green.light} base={BRAND.green.base} dark={BRAND.green.dark} />
        <Body3DLinear id="tab-acct-body" light={BRAND.green.light} base={BRAND.green.base} dark={BRAND.green.dark} />
      </Defs>
      <Shadow on={focused} rx={50} />
      {/* Shoulders / body */}
      <Path d="M44 168 Q44 116 100 116 Q156 116 156 168 Q156 172 150 172 L50 172 Q44 172 44 168 Z"
        fill={fill(focused, 'tab-acct-body')} />
      {/* Head */}
      <Circle cx="100" cy="74" r="34" fill={fill(focused, 'tab-acct-head')} />
      <Shine on={focused} cx={86} cy={62} rx={9} ry={11} />
    </Svg>
  );
}

// DOT — neutral fallback (unknown name)
function DotIcon({ size, focused }) {
  return (
    <Svg viewBox="0 0 200 200" width={size} height={size}>
      <Defs>
        <Body3D id="tab-dot" light={BRAND.green.light} base={BRAND.green.base} dark={BRAND.green.dark} />
      </Defs>
      <Shadow on={focused} rx={34} />
      <Circle cx="100" cy="100" r="46" fill={fill(focused, 'tab-dot')} />
      <Shine on={focused} cx={84} cy={84} rx={10} ry={12} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry + alias map. Consumer (AppNavigator iconMap) passes: shop, ai,
// animal, rent, farm, account. Aliases cover the raw route names too, so this
// stays drop-in even if a caller forwards `route.name` directly.
// ─────────────────────────────────────────────────────────────────────────────
const ICONS = {
  shop:    ShopIcon,
  ai:      AiIcon,
  animal:  AnimalIcon,
  rent:    RentIcon,
  farm:    FarmIcon,
  account: AccountIcon,
  dot:     DotIcon,
};

const ALIASES = {
  // canonical
  shop: 'shop', ai: 'ai', animal: 'animal', rent: 'rent', farm: 'farm', account: 'account',
  // route names (AppNavigator Tab.Screen names)
  agristore: 'shop', store: 'shop', market: 'shop',
  aiassistant: 'ai', assistant: 'ai', khetai: 'ai',
  animaltrade: 'animal', cattle: 'animal', livestock: 'animal',
  myfarm: 'farm', sprout: 'farm', crop: 'farm',
  tractor: 'rent', machinery: 'rent',
  profile: 'account', person: 'account', user: 'account', me: 'account',
};

const DEFAULT_KEY = 'dot';

/**
 * Renders the bold 2-tone SVG icon for a bottom tab.
 * @param {string}  name      tab key (case-insensitive); unknown → DOT fallback
 * @param {number}  size      width & height in dp (default 26)
 * @param {boolean} focused   true → full brand colour; false → muted sage tone
 * @param {boolean} animated  accepted for API parity (no-op — tab icons stay calm)
 */
export function TabIcon({ name, size = 26, focused = false, animated }) { // eslint-disable-line no-unused-vars
  const raw = String(name || '').trim().toLowerCase();
  const key = ALIASES[raw] || (ICONS[raw] ? raw : DEFAULT_KEY);
  const Icon = ICONS[key] || DotIcon;

  // Always render the full-colour variant so every tab reads as a bright, friendly
  // icon (easier for low-literacy users). The active tab is still obvious from the
  // pill background + bold label + press scale in AppNavigator. `focused` is kept in
  // the signature for API parity / future use.
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={size} focused />
    </View>
  );
}

export default TabIcon;
