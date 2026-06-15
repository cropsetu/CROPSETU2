# Add / Edit Machinery Listing

> **Tab:** Rent · **Stack:** RentStack · **Route name:** `AddMachinery` · **File:** `frontend/src/screens/Rent/AddMachineryScreen.js`

## Purpose
A form to list a piece of equipment for rent (or edit an existing listing). It collects category, specs, features, pricing, availability dates, location (with GPS), contact info, and media (up to 5 images + 1 video). Media is uploaded to Cloudinary, then the listing is created/updated via the rent API.

## Where it sits / how you reach it
- **Reached from:**
  - `RentHome` — the "List Your Machinery" empty-state button and the bottom banner (Machinery tab).
  - `MachineryDetail` — the owner's "Edit Listing" button (passes `{ listing, editMode: true }`).
  - `MyRentListingsScreen` (Profile stack) — the Edit/Add buttons, which navigate into the nested Rent tab: `navigation.navigate('Rent', { screen: 'AddMachinery', params })`.
- **Navigates to:**
  - Back (`navigation.goBack()`) — header back arrow and the success popup "Done" button.
  - `RentHome` — the success popup "View Listings" button.
- **Route params in:** `{ listing, editMode }` (both optional). `listing` pre-fills every field for edit mode; `editMode` switches the submit between create and update.

## How it works
- Every field is local `useState`, seeded from `route.params.listing` when editing. Images from the server are stored as `{ uri, url }` (already uploaded); new picks have `url: null`.
- **GPS:** `fetchGPS` reads `coords` from `LocationContext` and stores `lat`/`lng`; if no coords, it alerts a permission message. (GPS is fetched globally at app start, so there is no in-screen loading spinner.)
- **Media pickers (expo-image-picker):** gallery multi-select images (cap 5), camera single image, and a single video. Removing a thumbnail/video clears it from state.
- **Upload helpers:** `uploadImage` compresses (`compressImage`) to base64 then `POST /upload/image`; `uploadVideo` compresses (`compressVideo`), validates the extension against `['mp4','mov','avi','mkv']`, and posts multipart to `POST /upload/video`.
- **Submit (`handleSubmit`):** validates category, name, price/day (₹1–₹5,00,000), location, district, and that availableTo ≥ availableFrom. Then uploads any un-uploaded media (`setUploading`), builds the payload, and calls `PUT /rent/machinery/:id` (edit) or `POST /rent/machinery` (create). On success it shows the success modal; on failure an Alert with the server message.
- **Loading:** the submit button is disabled and shows a spinner while `uploading || submitting`; its label reflects the upload phase ("Uploading media…").

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header (back + title/sub) | Header | Back arrow; title "Edit Listing"/"List Your Machinery" with subtitle. |
| Category chips | Single-select chips | tractor/harvester/sprayer/rotavator/thresher/transplanter/truck/tempo/other; required. |
| Equipment name | Text input | Required. |
| Brand / model | Text input | Optional. |
| Age (years) | Text input | `decimal-pad`. |
| Mileage / hours | Text input | `numeric`. |
| Horse power | Text input | Optional. |
| Fuel type chips | Single-select chips | diesel / petrol / electric. |
| Features chips | Multi-select chips | 4WD, Power Steering, GPS Tracked, AC Cabin, Hydraulic, PTO, Front Loader, Rear Blade. |
| Description | Multiline text input | Optional. |
| Price per hour | Text input | `numeric`, optional. |
| Price per day | Text input | `numeric`, required (validated ₹1–₹5,00,000). |
| Price per acre | Text input | `numeric`, optional. |
| Availability dates | Date-range picker | `RentAvailabilityPicker` (from/to). |
| Village/City + District | Text inputs | Both required. |
| Use GPS button | Toggle button | Auto-fills lat/lng from `LocationContext`; shows saved coords when set. |
| Owner name / Phone | Text inputs | Optional; phone uses `phone-pad`. |
| Photos (up to 5) | Image picker grid | Thumbnails with remove (×); "Gallery" and "Camera" add buttons until 5 reached. |
| Video (optional) | Video picker | Choose-video button; once picked shows filename + trash remove. |
| Submit button | Primary button | "List My Equipment" / "Save Changes" / "Uploading media…"; spinner + disabled while busy. |
| Success popup | Modal | Check icon, created/updated copy, a name+category pill, and "Done" (goBack) / "View Listings" (→ RentHome) buttons. |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `POST /upload/image` (base64) and `POST /upload/video` (multipart)
  - `POST /rent/machinery` (create)
  - `PUT /rent/machinery/:id` (update)
- **Backend route/service:** `backend/src/routes/rent.routes.js` (plus the upload routes for media).
- **State / context:** `LanguageContext` (`t`), `LocationContext` (GPS coords), `useSafeAreaInsets`, local `useState`. Media compression via `utils/mediaCompressor`.
- **Local / static data:** `CATEGORIES`, `FUEL_KEYS`, `COMMON_FEATURES`; local `RentAvailabilityPicker` component (`components/ui/RentAvailabilityPicker`).

## Languages / i18n
Uses the `rent.*` namespace extensively (field labels, placeholders, validation alerts, GPS strings, success copy) plus `products.limitMsg`, `ai.permissionRequired`, and `ai.cameraPermission` for picker limits/permissions.

## Notes, edge cases & gaps
- Image cap is 5; attempting more shows a limit alert. Video is limited to one file with extension validation (MP4/MOV/AVI/MKV).
- Media already on the server (edit mode) is kept by its `url` and not re-uploaded.
- GPS uses globally cached coordinates; if none are available it alerts a permission message rather than prompting in-screen.
- Upload uses extended timeouts (image 60s, video 120s). A failed upload aborts submit with an "upload failed" alert.
- Price/day is hard-capped at ₹5,00,000 client-side.
