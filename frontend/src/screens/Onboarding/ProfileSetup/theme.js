// ─────────────────────────────────────────────────────────────────────────────
// CropSetu · Profile-Setup theme — built ON TOP of the shared auth tokens
// ─────────────────────────────────────────────────────────────────────────────
// We do NOT define a second palette. The onboarding flow must feel like the same
// app as login, so it consumes the exact auth theme (greens + earth + harvest
// gold, the spacing/radii/type ramp) and only adds a few *semantic aliases*
// derived from existing tokens — no new raw colours, no magic numbers.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react';
import { useAuthTheme, AuthThemeProvider, makeTheme } from '../../Auth/PhoneLogin/theme';

// Re-export so onboarding consumers have a single import surface.
export { AuthThemeProvider, makeTheme };

/**
 * Add onboarding-only semantic tokens to the shared theme. Every value below is
 * an alias of an existing auth token, so a rebrand of the auth palette flows
 * through here automatically.
 */
function augment(t) {
  return {
    ...t,

    // Informational accent (location detecting, hints, "auto-filled" cues)
    info: t.primaryDim,
    infoBg: t.primaryWash,

    // Selectable chips / cards — rest vs selected
    chipBg: t.surfaceAlt,
    chipBorder: t.border,
    chipText: t.textSecondary,
    chipSelectedBg: t.primaryWash,
    chipSelectedBorder: t.primary,
    chipSelectedText: t.primary,

    // "Auto-filled from your location" badge
    autofillBg: t.successBg,
    autofillText: t.success,
    autofillBorder: t.successBorder,

    // Avatar picker
    avatarRing: t.primary,
    avatarPlaceholderBg: t.surfaceAlt,
    avatarPlaceholderBorder: t.border,
  };
}

/**
 * useOnbTheme — the single theme hook every onboarding component uses.
 * Follows the OS scheme (or the AuthThemeProvider override) exactly like login.
 * @param {'light'|'dark'} [override]
 */
export function useOnbTheme(override) {
  const t = useAuthTheme(override);
  return useMemo(() => augment(t), [t]);
}
