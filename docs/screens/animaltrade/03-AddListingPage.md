# Add / Edit Animal Listing

> **Tab:** Animals · **Stack:** `AnimalStack` (`AnimalTradeNavigator`) · **Route name:** `AddAnimalListing` · **File:** `frontend/src/screens/AnimalTrade/AddAnimalListing.js`

## Purpose
The form for posting a new livestock listing (or editing an existing one). Sellers upload photos, pick the animal type, fill in breed/age/gender/weight/milk-yield/price, toggle vaccination, add a description and location, and submit. The same screen handles both create (POST) and edit (PUT) flows based on whether a `listing` param is passed.

## Where it sits / how you reach it
- **Reached from:**
  - `AnimalTradeHome` — the "Post Ad" FAB and the empty-state "Post Ad" CTA → `navigation.navigate('AddAnimalListing')` (create mode).
  - `AnimalDetail` — the owner's "Edit Listing" button → `navigation.navigate('AddAnimalListing', { listing })` (edit mode).
  - Uses the stack header (title = `sellYourAnimal`), which provides the back button.
- **Navigates to:**
  - `AnimalTradeHome` — success popup "View Animals" button → `navigation.navigate('AnimalTradeHome', { freshListingId: id, ts: Date.now() })`.
  - Back (`navigation.goBack()`) — success popup "Close" button.
- **Route params in:** Optional `listing`. When present, the screen runs in **edit mode**: existing fields prefill the form, existing remote image URLs are kept in `existingImages`, and submit becomes a `PUT`. When absent, create mode with empty defaults.

## How it works
Initialized via `useState(() => editing ? {...prefilled} : {...defaults})`. Default location is built from the user's profile (village/taluka/district/city/state) or the listing's `sellerLocation` in edit mode. Milk yield is parsed numeric-only for editing (`"12 Litre/Day"` → `"12"`); gender maps between UI `Male`/`Female` and backend `MALE`/`FEMALE`.

Photos: `pickPhoto()` uses `expo-image-picker` (`launchImageLibraryAsync`, images only, 4:3 crop, quality 0.7), capped at 4 total (existing + new). Each picked asset is shown as an 80×80 thumb with a remove (`close-circle`) button.

Submit (`handleSubmit`): validates required fields (animal, breed, age, weight, price) and a positive numeric price, then sets `loading`. Pulls GPS `lat`/`lng` from `LocationContext` (`coords`) and sets `gpsState`. Builds a `FormData` payload with all fields; appends `tags: 'Vaccinated'` when toggled; in edit mode sends `existingImages` (even empty, to signal a replace). Each photo is prepped via `prepareImageForFormData` and appended (a real `Blob` on web, the `{uri,name,type}` shorthand on native). Then `PUT /animals/:id` (edit) or `POST /animals` (create) with a 90s timeout. On success, a `Modal` success popup shows; on failure, an `Alert` surfaces the actual backend validation error (first detail) or a fallback message.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Stack header + back | Navigation header | Title `sellYourAnimal`; back returns to previous screen. |
| Photo section | Section card | Title shows count (`addPhotosTitle` with `count`), subtitle `goodPhotos`. |
| Existing photo thumbs | Image thumbs (edit mode) | Already-uploaded URLs; each removable via `close-circle`. |
| New photo thumbs | Image thumbs | Newly-picked assets; each removable via `close-circle`. |
| Add Photo tile | Dashed button | `camera-outline` + `addPhoto`; opens image library. Hidden once 4 photos reached. |
| Animal Type chips | `SelectChip` grid | Cow, Buffalo, Goat, Bullock, Sheep, Pig, Horse, Camel; sets `form.animal` (English value sent to backend). |
| Breed input | TextInput | `breedRequired` label, required. |
| Age input | TextInput | `age` label. |
| Gender selector | Two toggle buttons | Male / Female with `male`/`female` icons; sets `form.gender`. |
| Weight input | Numeric TextInput | `weightKg` label, numeric keyboard. |
| Milk yield input | Numeric TextInput | `dailyMilk` label; shown only when animal is Cow/Buffalo or gender Female. |
| Asking Price input | Numeric TextInput | `askingPrice` label, numeric; price hint below. |
| Vaccinated switch | Switch | `vaccinated` toggle with sublabel; adds the `Vaccinated` tag. |
| Description textarea | Multiline TextInput | `descLabel`; 4 lines, top-aligned. |
| Location input | TextInput | `locationLabel`; prefilled from profile/listing. |
| GPS note | Icon + status text | Shows `gpsAutoSave` / `gpsLoading` / `gpsCoordsSaved` / `gpsAccessDenied` based on `gpsState`. |
| Submit button | Primary button | `postFreeListing` with `checkmark-circle`; shows `ActivityIndicator` while loading; disabled during submit. |
| Success popup | Modal | Fade modal: green check circle, title ("Listing Posted!"/"Listing Updated!"), body, an animal·breed pill, and two buttons. |
| Close button (modal) | Secondary button | Dismisses popup and `goBack()`. |
| View Animals button (modal) | Primary button | Navigates to `AnimalTradeHome` with `freshListingId` so the new card shows. |

## Services, APIs & data
- **API endpoints (via `services/api`):**
  - Create: `POST /animals` (multipart `FormData`, `timeout: 90000`).
  - Edit: `PUT /animals/:id` (multipart `FormData`, `timeout: 90000`).
- **Backend route/service:** `backend/src/routes/animaltrade.routes.js` (`POST /` and `PUT /:id`), mounted at `/api/v1/animals`.
- **State / context:** `useAuth()` (profile for default location), `useLocation()` (GPS coords), `useLanguage()`, local `useState` for `form`, `photos`, `existingImages`, `loading`, `gpsState`, `success`.
- **Local / static data:** `ANIMAL_TYPE_KEYS` (i18n keys) ↔ `ANIMAL_TYPE_VALUES` (English values sent to backend). Image prep via `utils/mediaCompressor` (`prepareImageForFormData`). Image picking via `expo-image-picker`.

## Languages / i18n
`t()` keys under `addAnimal.*` (e.g. `limitReached`, `maxPhotos`, `missingInfo`, `missingInfoMsg`, `invalidPrice`, `addPhotosTitle`, `goodPhotos`, `addPhoto`, `animalTypeSection`, `animalCow`…`animalCamel`, `basicDetails`, `breedRequired`, `breedPlaceholder`, `agePlaceholder`, `genderLabel`, `male`, `female`, `weightKg`, `weightPlaceholder`, `milkPlaceholder`, `pricingSection`, `pricePlaceholder`, `priceHint`, `healthInfo`, `vaccinated`, `vaccinatedSub`, `descriptionSection`, `descLabel`, `descPlaceholder`, `locationSection`, `locationLabel`, `locationPlaceholder`, `gpsCoordsSaved`, `gpsAccessDenied`, `gpsLoading`, `gpsAutoSave`, `failedToPost`) plus shared keys `age`, `dailyMilk`, `askingPrice`, `postFreeListing`, `listingPosted`, `listingPostedMsg`, `sellYourAnimal`, `product.error`. Multi-language via the app's translation files. Note: the success popup's "Listing Updated!" / "Your changes have been saved." / "Close" / "View Animals" strings are hard-coded English.

## Notes, edge cases & gaps
- **Validation:** required fields (animal, breed, age, weight, price) and positive-numeric price are checked client-side with `Alert`s. Location is optional client-side; the backend falls back to the user's district/state.
- **Backend errors surfaced verbatim** — the first validation `details` entry (`path: msg`) is shown so users can self-diagnose.
- **Web vs native image upload:** on web the image URI is fetched into a real `Blob` before appending; native uses the `{uri,name,type}` shorthand. Per-image prep failures are caught and logged (the rest still upload).
- **Photo cap:** 4 total (existing + new combined); the Add tile hides at the cap and `pickPhoto` also guards with an Alert.
- **Edit mode image semantics:** sending `existingImages` (even empty) signals the backend to replace the image list with whatever is kept.
- 90-second request timeout accommodates slow multi-photo uploads.
