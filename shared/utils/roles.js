/**
 * Role helpers shared by both apps.
 *
 * The seller app gates its entry on this (seller → dashboard, otherwise → KYC
 * setup); the buyer app uses it only to label the profile trust badge. Keeping
 * one definition means the two apps can never disagree about who is a seller.
 */

/**
 * True when the account may use the seller portal.
 *
 * Role is the source of truth — the backend flips FARMER → SELLER on the first
 * BusinessProfile save. The extra field checks cover accounts that filled the
 * form before that role flip existed and would otherwise be locked out.
 */
export function isSellerAccount(user) {
  if (!user) return false;
  return (
    user.role === 'SELLER' ||
    user.role === 'VERIFIED_FARMER' ||
    user.role === 'ADMIN' ||
    !!user.sellerProfile?.bankAccountNumber ||
    !!user.gstNumber ||
    !!user.businessType
  );
}

/** True when the account's KYC has been approved. */
export function isKycVerified(user) {
  return user?.kycStatus === 'VERIFIED' || !!user?.sellerProfile?.kycVerifiedAt;
}
