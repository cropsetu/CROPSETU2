# Seller Profile

> **Tab:** Account/Profile · **Stack:** SellerStack · **Route name:** `SellerProfile` · **File:** `frontend/src/screens/Seller/SellerProfileScreen.js`

## Purpose
The seller's account/profile hub inside the portal. Shows a profile-completion meter, account details (phone, display name, location), business info (type, GST, bank, KYC status), seller stats, and quick links to the Business Profile/KYC form and help/legal pages. Lets the seller inline-edit their display name. Used by sellers to review and lightly edit their identity.

## Where it sits / how you reach it
- **Reached from:** Seller Dashboard — avatar (top-right) and the "Profile" quick action both `navigation.navigate('SellerProfile')`.
- **Navigates to:**
  - Completion card, Location row, Business Type / GST / Bank rows, and "Business Profile & KYC" quick action → `BusinessProfile`
  - "Back to CropSetu" button → `navigation.goBack()` (exits the portal)
  - Help Center row → informational `Alert` (no navigation)
  - Terms / Privacy rows → no-op `onPress` (`() => {}`)
- **Route params in:** none

## How it works
Reads `user` from `AuthContext` and computes everything locally — there is no fetch on this screen. On mount it runs entrance animations (avatar spring/fade, header slide, body fade-in, looping ring pulse). `calcCompletion(user)` derives a 0–100% completion from eight profile fields (name, businessType, district, taluka, village, GST-or-optOut, bank account number, bank IFSC); the percentage and progress bar are colored green/amber/red by threshold. Initials, business-type label, and a joined location string are derived from `user`. The display name can be edited inline in the header: tapping "Edit name" (or the Display Name row) flips `editMode`, revealing a `TextInput` with Save/Cancel; Save validates non-empty, `PUT`s `/users/me`, calls `updateUser`, and exits edit mode (errors raise an Alert). Several rows render status badges (GST verified/exempt, bank added, KYC verified/pending, account active).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Gradient header | View (LinearGradient) | Avatar (initials), name, phone, business-type badge |
| Avatar + pulse ring | Animated.View | Looping ring around the initials avatar |
| Business-type badge | Badge | Shows the seller's business type (when set) |
| "Edit name" button | TouchableOpacity | Enters inline edit mode |
| Name input (edit mode) | TextInput | Inline display-name editor (autoFocus) |
| Save / Cancel (edit mode) | TouchableOpacity ×2 | Save → PUT `/users/me`; Cancel reverts |
| Profile completion card | TouchableOpacity | %, sub-text, progress bar; navigates to `BusinessProfile` |
| Progress bar | View | Fill width = completion %, colored by threshold |
| Phone Number row | Row | Read-only `+91 phone` |
| Display Name row | Row | Tapping enters edit mode |
| Location row | Row | Village/taluka/district; navigates to `BusinessProfile` |
| Business Type row | Row | Navigates to `BusinessProfile` |
| GST Number row | Row + badge | Value/Verified/Exempt/Not added; → `BusinessProfile` |
| Bank Account row | Row + badge | Masked `••••last4 · bankName`; "Added" badge; → `BusinessProfile` |
| KYC Status row | Row + badge | Verified vs Pending badge |
| Seller Since row | Row | Joined month/year from `createdAt` |
| Account Status row | Row + badge | Hardcoded "Active" |
| Business Profile & KYC quick action | Row | → `BusinessProfile` |
| Help Center row | Row | Shows informational `Alert` |
| Terms row | Row | No-op |
| Privacy row | Row | No-op |
| "Back to CropSetu" button | TouchableOpacity | Warning haptic + `navigation.goBack()` |

## Services, APIs & data
- **API endpoints (via `services/api`):**
  - `PUT /users/me` (body `{ name }`) — only call on this screen, used to save the display name
- **Backend route/service:** users/me update route (user controller; not an agristore route)
- **State / context:** `useAuth` (`user`, `logout`, `updateUser`), `useLanguage` (`t`); local `useState` for `editMode`, `name`, `saving`; `Animated.Value` refs; `Haptics`
- **Local / static data:** `BUSINESS_TYPES` from `constants/locations`; `calcCompletion` helper; `COLORS`, `SHADOWS`, `RADIUS`

## Languages / i18n
i18n via `useLanguage().t` under the `sellerProfile.*` namespace (e.g. `sellerProfile.completion`, `sellerProfile.account`, `sellerProfile.phoneNumber`, `sellerProfile.businessType`, `sellerProfile.gstNumber`, `sellerProfile.kycStatus`, `sellerProfile.bizProfileKyc`, `sellerProfile.helpCenter`, `sellerProfile.updateError`) and `biz.*` for business-type labels, plus shared keys (`save`, `cancel`, `seller`, `notSet`). The "Back to CropSetu" label is hardcoded English.

## Notes, edge cases & gaps
- No data fetch — purely derived from the cached `user` in `AuthContext`; values are stale until `user` updates (e.g. after saving in BusinessProfile).
- Account Status is always rendered as "Active"; KYC/GST/Bank badges are computed from `user` fields (e.g. `user.kycStatus === 'verified'`).
- Terms and Privacy rows are placeholders (no destination).
- "Back to CropSetu" uses `navigation.goBack()` and does not invoke the destructured `logout`.
- Display-name save validates only that the trimmed name is non-empty.
