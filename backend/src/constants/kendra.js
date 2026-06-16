/**
 * Krushi Seva Kendra business types.
 *
 * A "Krushi Seva Kendra" is, in data terms, a User whose `businessType` is one of
 * these agri-input dealer kinds. These are the accounts that onboard via the
 * dedicated Kendra website, get licence-verified by an admin, surface in the
 * farmer's nearby-Kendra discovery, and receive/reply to crop-diagnosis reports.
 *
 * Single source of truth — imported by the Kendra onboarding routes and the
 * crop-report share/discovery routes so the definition can never drift.
 */
export const KRUSHI_KENDRA_TYPES = [
  'krushi_kendra',
  'fertilizer_dealer',
  'seed_supplier',
  'agri_input_shop',
  'pesticide_dealer',
];

export function isKendraBusinessType(businessType) {
  return !!businessType && KRUSHI_KENDRA_TYPES.includes(businessType);
}
