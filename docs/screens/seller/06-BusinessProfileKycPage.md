# Business Profile & KYC

> **Tab:** Account/Profile · **Stack:** SellerStack · **Route name:** `BusinessProfile` · **File:** `frontend/src/screens/Seller/BusinessProfileScreen.js`

## Purpose
The seller onboarding / KYC form. Captures business identity (type), location, GST details, bank account, and KYC documents (Aadhaar, PAN). Submitting it is the explicit consent that authorises a FARMER→SELLER role promotion. Used both by existing sellers to update their details and by farmers becoming sellers for the first time (the Profile screen deep-links non-sellers straight here).

## Where it sits / how you reach it
- **Reached from:**
  - Seller Profile — completion card, location/business/GST/bank rows, and "Business Profile & KYC" quick action all navigate here
  - Account tab → Profile screen "Seller Portal" entry when the user is **not** yet a seller deep-links to `{ screen: 'BusinessProfile' }`
- **Navigates to:** `navigation.goBack()` automatically after a successful save (fired from the success-toast completion callback).
- **Route params in:** none

## How it works
Pre-fills a single `form` state from `user` and `user.sellerProfile` (`sp`). Plain-text fields (business type, location, GST, bank holder/name/IFSC) are re-displayed; encrypted PII (bank account number, Aadhaar, PAN) is never re-displayed — those inputs start blank, with "on file" hints/placeholders when a value already exists (`hasAadhaar`/`hasPan`/`hasBankAcc`). A `set(key)` curried updater also clears taluka whenever district changes. `calcCompletion` shows a live completion badge over ten fields. `handleSave` validates required location fields and, when provided, GST/IFSC/Aadhaar/PAN formats (via `validators` util), surfacing failures through an inline error toast. The payload always sets `sellerConsent: true` (the SELLER_ONBOARDING consent) and `state: 'Maharashtra'`; encrypted fields are included **only** when the user typed a fresh value (sending `''` would overwrite the stored value). It `PUT`s `/users/me`; if the backend returns fresh tokens (role upgraded to SELLER) it persists them via `saveTokens` so subsequent SELLER-only routes don't 403, then `updateUser` and shows a green success toast that slides in and triggers `goBack`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Toast | Animated.View | Single slot; green success (then goBack) or red error |
| Completion badge | View | Live % with complete/almost/incomplete label, colored by threshold |
| Business Identity section | SectionHeader | Storefront header |
| Business type chips | Chip row (required) | Single-select from `BUSINESS_TYPES` |
| Location section | SectionHeader | Location header |
| State field | Read-only View | Hardcoded "Maharashtra" |
| District picker | LocationPicker modal (required) | Searchable district list; resets taluka |
| Taluka picker | LocationPicker modal (required) | Disabled until district chosen |
| Village/Town input | TextInput (required) | Free text primary location |
| GST section | SectionHeader | GST header |
| "No GST" checkbox row | TouchableOpacity checkbox | Toggles `gstOptOut`; hides the GST input |
| GST Number input | TextInput | Shown only when not opted out; uppercase, maxLength 15 |
| Bank Account section | SectionHeader | Bank header + hint |
| Holder Name input | TextInput | Plain text |
| Bank Name input | TextInput | Plain text |
| Account Number input | TextInput (number-pad) | Encrypted; "on file" hint/placeholder if present; maxLength 18 |
| IFSC input | TextInput | Uppercase; maxLength 11 |
| KYC Documents section | SectionHeader | KYC header + hint |
| Aadhaar input | TextInput (number-pad) | Encrypted; "on file" hint if present; maxLength 12 |
| PAN input | TextInput | Uppercase; "on file" hint if present; maxLength 10 |
| Data-security notice | View | Lock icon + reassurance copy |
| Save button (footer) | TouchableOpacity | Validates + PUT `/users/me`; spinner while saving |

## Services, APIs & data
- **API endpoints (via `services/api`):**
  - `PUT /users/me` — submits the whole business/KYC payload (including `sellerConsent: true`); may return upgraded role + fresh tokens
- **Other service calls:** `saveTokens(...)` from `services/api` to persist new access/refresh tokens after a role upgrade
- **Backend route/service:** users/me update route (records SELLER_ONBOARDING consent and flips FARMER→SELLER role)
- **State / context:** `useAuth` (`user`, `updateUser`), `useLanguage` (`t`); local `form` + `saving` + `toast` state; `toastAnim` Animated.Value
- **Local / static data:** `DISTRICT_LIST`, `getTalukas`, `BUSINESS_TYPES` from `constants/locations`; `isValidGst`/`isValidIfsc`/`isValidAadhaar`/`isValidPan` from `utils/validators`; `LocationPicker` component

## Languages / i18n
i18n via `useLanguage().t` under the `sellerBizProfile.*` namespace (with inline English default values), e.g. `sellerBizProfile.bizIdentity`, `sellerBizProfile.district`, `sellerBizProfile.gstDetails`, `sellerBizProfile.noGst`, `sellerBizProfile.bankAccountSection`, `sellerBizProfile.kycDocs`, `sellerBizProfile.aadhaar`, `sellerBizProfile.saved`, `sellerBizProfile.invalidGstMsg`, `sellerBizProfile.securityNote`, `sellerBizProfile.saveBizProfile`. Business-type labels use `biz.*`. The "Maharashtra" state value and several placeholders are literal strings.

## Notes, edge cases & gaps
- Encrypted PII fields (account number, Aadhaar, PAN) are deliberately never re-displayed; blank-and-saved keeps the existing stored value, a fresh value replaces it.
- Validation only runs format checks when a field is non-empty (except district/taluka/village which are strictly required).
- GST is uppercased; IFSC and PAN are uppercased; Aadhaar/PAN/IFSC/GST formats validated client-side via `validators`.
- Toast is the only feedback channel — success auto-navigates back after ~1.6s; errors stay ~2.4s.
- Persisting the returned tokens is critical: without it, SELLER-only endpoints (dashboard stats, inbox) keep returning 403 after a first-time promotion.
- `state` is hardcoded to `'Maharashtra'`.
