// ─────────────────────────────────────────────────────────────────────────────
// Internal colour helpers for the kit. Not exported from index.js — call sites
// use component props, not these.
//
// WHY alpha() EXISTS AND withAlpha() IS NOT ENOUGH
// khetTheme's withAlpha() is hex-only and THROWS on anything else, deliberately
// (parseInt on a non-hex yields NaN, which would silently paint black). That is
// the right call for a token helper. It is the wrong call inside a primitive:
// Card and ListRow take an accent colour as an ARGUMENT, so they receive
// whatever the caller has — a KHET.gradHero stop ('rgba(0,36,3,0.55)'), a
// STAGE_RAMP entry, a raw 'transparent'. A throw there is a crash at render, in
// production, on a screen that merely passed the wrong colour.
//
// So: hex goes through withAlpha unchanged (identical output, single source of
// truth), and everything else is handled here instead of exploding.
//
// It also accepts a 2-DIGIT HEX STRING as the alpha, because that is the form
// the app already writes: 151 sites in frontend/src/screens concatenate
// `colour + '18'` / `+ '3A'` / `+ '40'`. withAlpha cannot express those (0x18 is
// 0.0941…, "not a number anyone will type"), which is exactly why those sites
// stayed raw through the pilot migration. `alpha(c, '18')` migrates them
// mechanically, at delta 0.
// ─────────────────────────────────────────────────────────────────────────────
import { KHET, withAlpha } from '@cropsetu/shared/constants/khetTheme';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function alpha(color, a) {
  if (typeof color !== 'string') return color;
  const c = color.trim();
  // '18' | '3A' | '40' → 0-1, so the existing concat idiom migrates at delta 0.
  const amount = typeof a === 'string' ? parseInt(a, 16) / 255 : a;
  if (HEX.test(c)) return withAlpha(c, amount);
  const m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(',').map((x) => x.trim());
    if (p.length >= 3) return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${amount})`;
  }
  // 'transparent', a named colour, a platform colour — pass through untouched
  // rather than crash. It will not be tinted, which is visible and debuggable;
  // a thrown TypeError inside a list row is neither.
  return c;
}

// ── Semantic ink ─────────────────────────────────────────────────────────────
// Every entry is a TEXT-SAFE step, never a surface step. `gold` is goldInk
// (5.54:1 on a card), NOT KHET.gold — which is 2.03:1 as text and is the exact
// AA failure khetTheme already caught once and shipped goldForeground for.
// `danger` is destructiveInk (6.61:1), not destructive (4.07:1). Choosing a tone
// therefore cannot produce an illegible label; typing `color: KHET.gold` can,
// and does today.
export const TONE = {
  default:   KHET.foreground,
  muted:     KHET.mutedForeground,
  secondary: KHET.secondaryForeground,
  primary:   KHET.primary,
  success:   KHET.successInk,
  warning:   KHET.warningInk,
  info:      KHET.infoInk,
  danger:    KHET.destructiveInk,
  gold:      KHET.goldInk,
  link:      KHET.link,
  onDark:    KHET.white,
  onDarkDim: withAlpha(KHET.primaryForeground, 0.85),
  onGold:    KHET.goldForeground,
};

// KHET keys that are SURFACE colours and fail AA as text on a white card.
// Passing one to `color` is legal (it is the raw escape hatch) but warned.
const UNSAFE_AS_TEXT = { gold: 'gold', destructive: 'danger', primaryGlow: 'primary', ring: 'primary' };

const DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

/**
 * Resolve a `tone` name, a KHET key, or a raw colour string to a colour.
 * Order matters: tone names win over KHET keys so `tone="gold"` is the ink.
 */
export function resolveColor(value, fallback) {
  if (value == null || value === false) return fallback;
  if (typeof value !== 'string') return fallback;
  if (TONE[value]) return TONE[value];
  if (Object.prototype.hasOwnProperty.call(KHET, value)) {
    if (DEV && UNSAFE_AS_TEXT[value]) {
      console.warn(
        `[khet] color="${value}" is a SURFACE colour and fails WCAG AA as text ` +
        `(KHET.gold and KHET.destructive are both ~2-4:1 on a white card). ` +
        `Use tone="${UNSAFE_AS_TEXT[value]}" for the legible ink step instead.`
      );
    }
    const v = KHET[value];
    return typeof v === 'string' ? v : fallback;
  }
  return value; // raw '#rrggbb' / 'rgba(...)' / data-palette colour
}
