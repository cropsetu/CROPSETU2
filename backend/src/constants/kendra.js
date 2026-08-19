/**
 * Krushi Seva Kendra business types.
 *
 * A "Krushi Seva Kendra" is, in data terms, a User whose `businessType` is one of
 * these agri-input dealer kinds. These are the accounts that onboard in the seller
 * app, get KYC-verified by an admin, surface in the farmer's nearby-Kendra
 * discovery, and receive/reply to crop-diagnosis reports in the seller app's
 * received-reports inbox.
 *
 * Single source of truth — imported by the crop-report share/discovery routes and
 * the admin KYC queue so the definition can never drift.
 */
export const KRUSHI_KENDRA_TYPES = [
  'krushi_kendra',
  'fertilizer_dealer',
  'seed_supplier',
  'agri_input_shop',
  'pesticide_dealer',
];
