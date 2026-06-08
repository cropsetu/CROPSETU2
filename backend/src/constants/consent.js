/**
 * Consent configuration — DPDP Act §5 (free, specific, informed, unambiguous).
 *
 * The current policy version is bumped whenever the Terms / Privacy notice
 * materially changes. Because consent records are append-only and store the
 * version that was shown, a version bump lets us detect users who consented to
 * an older notice and re-prompt them.
 */

// Bump this (and re-prompt users) when the Terms/Privacy notice changes.
export const CONSENT_POLICY_VERSION = '2026-06-01';

// Canonical purposes — mirror the Prisma ConsentPurpose enum exactly.
export const CONSENT_PURPOSES = {
  TERMS_OF_SERVICE: 'TERMS_OF_SERVICE',
  PRIVACY_POLICY:   'PRIVACY_POLICY',
  DATA_PROCESSING:  'DATA_PROCESSING',
  AI_PROCESSING:    'AI_PROCESSING',
  LOCATION:         'LOCATION',
  MARKETING:        'MARKETING',
  GUARDIAN_CONSENT: 'GUARDIAN_CONSENT',
};

// DPDP §9(3): no targeted advertising or behavioural tracking of children.
// A minor may never grant these, regardless of guardian consent.
export const MINOR_PROHIBITED_PURPOSES = [
  CONSENT_PURPOSES.MARKETING,
];

export const CONSENT_PURPOSE_VALUES = Object.values(CONSENT_PURPOSES);

// Human-readable descriptions surfaced to the client (informed consent).
export const CONSENT_PURPOSE_INFO = {
  TERMS_OF_SERVICE: { required: true,  label: 'Terms of Service',
    description: 'You agree to the Terms of Service governing use of CropSetu.' },
  PRIVACY_POLICY:   { required: true,  label: 'Privacy Policy',
    description: 'You acknowledge the Privacy Policy describing how your data is processed.' },
  DATA_PROCESSING:  { required: true,  label: 'Personal data processing',
    description: 'We process your profile, farm and location data to provide core features.' },
  AI_PROCESSING:    { required: false, label: 'AI crop & voice features',
    description: 'Your crop photos and voice inputs are sent to AI providers for diagnosis and assistance.' },
  LOCATION:         { required: false, label: 'Precise location',
    description: 'We use your precise GPS location to find nearby sellers, weather and mandis.' },
  MARKETING:        { required: false, label: 'Marketing communications',
    description: 'You agree to receive promotional offers and product updates.' },
  GUARDIAN_CONSENT: { required: false, label: 'Parental / guardian consent',
    description: 'A parent or legal guardian consents to the processing of a minor’s personal data (DPDP Act §9).' },
};

// Consents captured (granted) the moment a user registers. These are the lawful
// basis for operating their account at all.
export const REQUIRED_SIGNUP_PURPOSES = [
  CONSENT_PURPOSES.TERMS_OF_SERVICE,
  CONSENT_PURPOSES.PRIVACY_POLICY,
  CONSENT_PURPOSES.DATA_PROCESSING,
];

export function isValidPurpose(p) {
  return CONSENT_PURPOSE_VALUES.includes(p);
}
