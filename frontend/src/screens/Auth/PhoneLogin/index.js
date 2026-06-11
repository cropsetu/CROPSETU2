// ─────────────────────────────────────────────────────────────────────────────
// CropSetu · Phone-login module — public surface
// ─────────────────────────────────────────────────────────────────────────────
// Assembled flow (default) + every piece, so the screens can be embedded or the
// components reused independently. See README.md for wiring + theming.
// ─────────────────────────────────────────────────────────────────────────────
export { default } from './LoginFlow';
export { default as LoginFlow } from './LoginFlow';

// Screens
export { default as LandingScreen } from '../Landing/LandingScreen';
export { default as PhoneEntryScreen } from './PhoneEntryScreen';
export { default as OtpVerificationScreen } from './OtpVerificationScreen';

// Reusable components
export { default as PhoneInput } from './components/PhoneInput';
export { default as OtpInput } from './components/OtpInput';
export { default as PrimaryButton } from './components/PrimaryButton';
export { default as AuthScreenLayout } from './components/AuthScreenLayout';
export { default as AuthTopControls } from './components/AuthTopControls';
export { default as LegalFooter } from './components/LegalFooter';
export { default as Shimmer } from './components/Shimmer';
export { default as ConfettiBurst } from './components/ConfettiBurst';

// Auth SFX manager
export { SFX, useSfxMuted } from '../../../utils/authSound';

// Theme + i18n
export { useAuthTheme, AuthThemeProvider, makeTheme } from './theme';
export { useT, AuthStringsProvider, createT, STRINGS } from './strings';
