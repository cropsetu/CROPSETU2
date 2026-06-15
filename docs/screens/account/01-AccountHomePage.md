# Account Home (Profile)

> **Tab:** Account · **Stack:** ProfileStack · **Route name:** `ProfileHome` · **File:** `frontend/src/screens/Profile/ProfileScreen.js`

## Purpose
The account hub for the logged-in farmer. It shows the user's profile (avatar, name, phone, location, status quote, member-since), activity stats, and acts as the launchpad for every account-related destination: farms, orders, saved posts, animal/rent listings, the seller portal, government schemes, settings, language/state selection, support links, and logout. It is the home screen of the "Account" bottom tab.

## Where it sits / how you reach it
- **Reached from:** The "Account" bottom tab (`Account` tab → `ProfileNavigator` → `ProfileHome`). It is the default/initial screen of `ProfileStack`.
- **Navigates to:**
  - `FarmList` — "My Farms" quick tile (`navigation.navigate('FarmList')`).
  - `MyOrders` — "My Orders" quick tile.
  - `SavedPosts` — "Saved Posts" quick tile.
  - `MyAnimalListings` — "My Listings" quick tile AND the "My Animal Listings" row under My Activity.
  - `MyRentListings` — "My Rent Listings" row under My Activity.
  - `AIAssistant` (nested `{ screen: 'Scheme' }`) — the government-schemes banner.
  - `SellerPortal` — the seller banner. If the user is already a seller it opens the portal directly; otherwise it deep-links to `{ screen: 'BusinessProfile' }` to set up a business profile.
  - Edit Profile modal — hero "Edit Profile" button and the "Saved Addresses" row both open the `EditProfileModal` (`setShowEditModal(true)`).
  - State picker modal — "Select State" row (`setShowStateModal(true)`); from there a "Manual language" link opens the language modal.
  - Language picker modal — opened from the state sheet's "Manual language" link.
  - External links via `Linking.openURL`: Terms (`https://cropsetu.app/terms`), FAQs (`https://cropsetu.app/faqs`).
  - Logout confirmation modal (`setShowLogoutConfirm(true)`) → `logout()` from `AuthContext`.
- **Route params in:** none.

## How it works
On every focus (`useFocusEffect`) the screen calls `refreshUser()` (AuthContext) to re-sync the profile, and fires two parallel `Promise.allSettled` requests — `GET /rent/machinery/my?limit=1` and `GET /rent/labour/my?limit=1` — reading `meta.total` to compute a live rental-listing count (`rentCount`). If both fail it falls back to the backend `user._count` machinery/labour counts. Activity stat values come from `user._count` (`animalListings`, `orders`) plus the computed rental total.

Key state: `notifications` (local Switch toggle, not persisted to backend), `showLangModal`, `showStateModal`, `showEditModal`, `showLogoutConfirm`, `uploadingPhoto`, `avatarBust` (cache-buster for the avatar `<Image>` after upload), `rentCount`, and an `Animated.Value` `scrollY` that scales/fades the hero on scroll.

Seller detection (`isSeller`) is derived from `user.role` (`SELLER` / `VERIFIED_FARMER` / `ADMIN`) with legacy fallbacks (`sellerProfile.bankAccountNumber`, `gstNumber`, `businessType`) — this flips the seller banner between "Become a Seller" and "Seller Dashboard".

Avatar upload (`handlePhotoPress`): requests media-library permission, launches `ImagePicker`, validates MIME/extension (jpg/jpeg/png/webp), compresses via `compressImage`, builds a `FormData` (Blob on web, RN file object on native) and `PUT /users/me`. On success it updates the avatar and bumps `avatarBust`; on failure it shows an `Alert`.

Edit Profile (`EditProfileModal`): a bottom sheet with five fields (name, status/bio, district, city, pincode). It re-seeds from `user` each time it opens. Save validates non-empty name then `PUT /users/me` with the field payload; on success calls `onSaved(data.data)` which updates the user and closes.

Logout uses a custom in-app confirmation Modal (not a native Alert), then calls `logout()`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Hero header | Gradient banner (`LinearGradient` + SVG `HeroBgDecoration`) | Animated, scales/fades on scroll. |
| Avatar + camera button | Touchable image / initials | Tap to pick & upload a new profile photo; shows `ActivityIndicator` while uploading. |
| Name / phone / location / status quote | Text | Read from `user`; location is `city, district`. |
| Edit Profile button | Button (hero) | Opens `EditProfileModal`. |
| Member-since label | Text | Year from `user.createdAt`. |
| Stats card | 3-cell row | Animal listings, Orders, Rentals (rentals = live machinery+labour count). |
| Quick Actions grid | 4 `QuickTile` tiles | My Farms → `FarmList`; My Orders → `MyOrders`; Saved Posts → `SavedPosts`; My Listings → `MyAnimalListings`. |
| Account Settings — Saved Addresses | `RowItem` | Opens Edit Profile modal; subtitle shows current city/district or "add address". |
| Account Settings — Select State | `RowItem` | Opens state picker sheet; subtitle shows selected state + language. |
| Account Settings — Notifications | `RowItem` with `Switch` | Local toggle (`notifications` state); not persisted server-side. |
| Account Settings — Privacy Center | `RowItem` | Shows an informational `Alert` about data privacy. |
| Personal Info rows | `RowItem` (read-only) | Mobile number, Email (placeholder "not added"), District, Village, City/Town, State, Pincode. No arrows. |
| My Activity — My Animal Listings | `RowItem` | → `MyAnimalListings`; subtitle = listing count. |
| My Activity — My Rent Listings | `RowItem` | → `MyRentListings`; subtitle = rental count. |
| Farm Details section | `RowItem` group (conditional) | Only rendered if `user.farmDetail` exists: Total Land, Soil Type, Irrigation, Main Crops (read-only). |
| Government Schemes banner | Gradient touchable | → `AIAssistant` `{ screen: 'Scheme' }`. |
| Feedback & Info — Rate | `RowItem` | Shows a "thank you" `Alert`. |
| Feedback & Info — Help | `RowItem` | Shows a support/call-us `Alert`. |
| Feedback & Info — Terms | `RowItem` | `Linking.openURL` to terms page. |
| Feedback & Info — Browse FAQs | `RowItem` | `Linking.openURL` to FAQs page. |
| Seller banner | Gradient touchable | "Become a Seller" or "Seller Dashboard" → `SellerPortal` (deep-links to `BusinessProfile` if not yet a seller). |
| Logout button | Touchable | Opens logout confirmation modal. |
| Version text | Text | App version string from i18n. |
| Edit Profile modal | Bottom-sheet `Modal` | 5 text inputs (name, status/bio, district, city, pincode) + gradient Save button. |
| Logout confirm modal | Centered `Modal` | Cancel / Logout buttons; Logout calls `logout()`. |
| Select-State modal | Bottom-sheet `Modal` | States grouped by region; selecting one calls `setLanguageByState`. "Manual language" link opens the language modal. |
| Language modal | Bottom-sheet `Modal` | Lists `LANGUAGES` (flag, name, native name); selecting calls `setLanguage`. |

## Services, APIs & data
- **API endpoints (all via `services/api.js`, base `/api/v1`):**
  - `PUT /users/me` — update profile fields (Edit Profile) and avatar upload (FormData).
  - `GET /rent/machinery/my?limit=1` — live machinery listing count.
  - `GET /rent/labour/my?limit=1` — live labour listing count.
- **Backend route/service:** `backend/src/routes/user.routes.js` (`/users/me`); rent routes for `/rent/machinery/my` & `/rent/labour/my`. (Addresses/consent routes — `addresses.routes.js`, `consent.routes.js` — are not directly called here; "Saved Addresses" reuses the profile city/district fields via the edit modal.)
- **State / context:** `AuthContext` (`user`, `updateUser`, `logout`, `refreshUser`), `LanguageContext` (`t`, `language`, `setLanguage`, `setLanguageByState`, `selectedState`, `LANGUAGES`), plus local `useState`/`useRef` (Animated `scrollY`). Image upload uses `expo-image-picker` + `utils/mediaCompressor`.
- **Local / static data:** `STAT_CONFIGS` (stat tiles), `i18n/stateMappings` (`getStatesByRegion`, `REGION_ORDER`) for the state picker, `constants/colors` (`COLORS`), `constants/khetTheme` (`KHET`, `KFONT`, `KSHADOW`), `components/ui/ImmersiveKit` (`EntrySlide`, `D`).

## Languages / i18n
Heavily i18n-driven via `useLanguage().t` with the `profile.*` namespace plus top-level keys (`editProfile`, `myOrders`, `savedPosts`, `myAnimalListings`, `myRentListings`, `memberSince`, `logout`, `logoutConfirm`, `cancel`, `personalInfo`, `myActivity`, `farmDetails`, `rate`, `help`, `helpSub`). The screen also lets the user change app language directly (Language modal) and set state→language mapping (State modal); `selectedState` and `language` come from `LanguageContext`.

## Notes, edge cases & gaps
- Avatar upload has platform-specific FormData handling (Blob on web, `{ uri, name, type }` on native) and cache-busts the image via a `?v=` query param so the new photo shows immediately.
- The Notifications toggle is purely local UI state — it is not persisted to any backend endpoint.
- "Saved Addresses" does not open a dedicated address book; it reuses the Edit Profile modal (city/district/pincode fields). No call to `addresses.routes.js` from this screen.
- Privacy Center, Rate, and Help are informational `Alert`s only (no navigation/API).
- Farm Details section only renders when `user.farmDetail` is present.
- Rental count gracefully falls back to `user._count` when both `/rent/.../my` calls fail (offline-tolerant).
- Logout and (on `MyAnimalListings`/web) delete use custom Modals because RN-Web silently drops multi-button `Alert.alert` dialogs.
