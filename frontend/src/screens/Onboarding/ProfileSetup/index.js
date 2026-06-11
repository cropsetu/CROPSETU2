// ─────────────────────────────────────────────────────────────────────────────
// CropSetu · Profile-Setup onboarding — public surface
// ─────────────────────────────────────────────────────────────────────────────
// Default export = the assembled <ProfileSetupFlow/>. Components and config are
// also exported for reuse / testing. See README.md.
// ─────────────────────────────────────────────────────────────────────────────
export { default } from './ProfileSetupFlow';
export { default as ProfileSetupFlow } from './ProfileSetupFlow';

// Reusable components
export { default as OnboardingLayout } from './components/OnboardingLayout';
export { default as AvatarPicker } from './components/AvatarPicker';
export { default as LanguageSelect } from './components/LanguageSelect';
export { default as LocationFields } from './components/LocationFields';
export { default as ChipSelect } from './components/ChipSelect';
export { default as StepperInput } from './components/StepperInput';
export { default as OptionIcon } from './components/OptionIcon';

// Theme + i18n + option config
export { useOnbTheme, AuthThemeProvider } from './theme';
export { useT, OnbStringsProvider, createT, STRINGS } from './strings';
export { LANGUAGES, CROPS, SOILS, IRRIGATIONS, STATES, LAND } from './options';
