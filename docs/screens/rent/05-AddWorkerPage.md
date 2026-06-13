# Register as Worker (Add Labour Listing)

> **Tab:** Rent · **Stack:** RentStack · **Route name:** `AddWorker` · **File:** `frontend/src/screens/Rent/AddWorkerScreen.js`

## Purpose
A form for a farm worker (or a worker group/"sangha") to register themselves as available for wage work. It collects worker type, identity/contact, skills, languages, experience, pricing, availability dates, location (with GPS), a profile photo, additional images, and a work video. Media is uploaded to Cloudinary, then the listing is created via the rent API.

## Where it sits / how you reach it
- **Reached from:**
  - `RentHome` (Workers tab) — the "Register as Worker" empty-state button and the bottom banner.
  - `MyRentListingsScreen` (Profile stack) — Edit/Add buttons navigate into the nested Rent tab: `navigation.navigate('Rent', { screen: 'AddWorker', params })`.
- **Navigates to:**
  - Back (`navigation.goBack()`) — header back arrow and the success popup "Done" button.
  - `RentHome` — the success popup "View Listings" button.
- **Route params in:** none read directly in this screen. (It accepts `{ navigation }`; edit-mode params from MyRentListings are not consumed here — see Notes.)

## How it works
- All fields are local `useState`. `workerType` toggles between `individual` and `group`; in group mode it additionally collects group name and size and uses `leader` for the leader's name.
- **GPS:** `fetchGPS` reads `coords` from `LocationContext` into `lat`/`lng`, else alerts a permission message.
- **Pickers (expo-image-picker):** a single profile photo (gallery or camera), up to 4 additional images, and a single work video.
- **Upload helpers:** `uploadImage` (compress → base64 → `POST /upload/image`) and `uploadVideo` (compress → multipart → `POST /upload/video`).
- **Submit (`handleSubmit`):** validates name, at least one skill, price/day, location, district, and availableTo ≥ availableFrom. Uploads photo/images/video, then `POST /rent/labour` with the full payload (name, leader, groupName, skills, experience, description, languages, prices, groupSize, media, phone, location, district, availability, lat/lng). On success shows the success modal; on failure an Alert with the server message.
- **Loading:** submit button disabled with a spinner while `uploading || submitting`; label shows "Uploading media…" during the upload phase.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header (back + title/sub) | Header | Back arrow; "Register as Worker" + subtitle. |
| Worker type cards | Two-option selector | "Individual" / "Group/Sangha"; sets `workerType`. |
| Name / Leader name | Text input | Required; label switches by worker type. |
| Group name | Text input | Group mode only. |
| Group size | Text input | Group mode only; `numeric`. |
| Phone number | Text input | Required; `phone-pad`. |
| Skills chips | Multi-select chips | 14 skills (weeding, harvesting, planting, …); at least one required; checkmark when active. |
| Languages chips | Multi-select chips | marathi/hindi/english/kannada/telugu/gujarati. |
| Experience | Text input | Optional. |
| About | Multiline text input | Optional. |
| Price per day | Text input | `numeric`, required. |
| Price per hour | Text input | `numeric`, optional. |
| Availability dates | Date-range picker | `RentAvailabilityPicker` (from/to). |
| Village/City + District | Text inputs | Both required. |
| Use GPS button | Toggle button | Auto-fills lat/lng; shows saved coords when set. |
| Profile photo | Image picker | Gallery/Camera buttons; preview with remove (×). |
| Additional images (up to 4) | Image picker grid | Thumbnails with remove; "+" add button until 4 reached. |
| Work video | Video picker | Choose-video button; once picked shows filename + trash remove. |
| Submit button | Primary button | "Register & Go Live" / "Uploading media…"; spinner + disabled while busy. |
| Success popup | Modal | Check icon, registered copy, name pill, and "Done" (goBack) / "View Listings" (→ RentHome) buttons. |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `POST /upload/image` (base64) and `POST /upload/video` (multipart)
  - `POST /rent/labour` (create)
- **Backend route/service:** `backend/src/routes/rent.routes.js` (plus upload routes for media).
- **State / context:** `LanguageContext` (`t`), `LocationContext` (GPS coords), `useSafeAreaInsets`, local `useState`. Compression via `utils/mediaCompressor`.
- **Local / static data:** `SKILL_KEYS` (14 skills), `LANGUAGE_KEYS` (6 languages); local `RentAvailabilityPicker` component.

## Languages / i18n
Uses `rent.*` (form labels, placeholders, validation alerts, GPS strings, success copy), `skills.*` (skill chip labels), `languages.*` (language chip labels), plus `products.limitMsg` and `ai.permissionRequired` for picker limits/permissions.

## Notes, edge cases & gaps
- This screen only handles creation (`POST /rent/labour`) — unlike `AddMachineryScreen`, it does **not** read `route.params.listing`/`editMode`, so worker "Edit" from MyRentListings opens a blank form rather than a prefilled one. Notable gap.
- Additional images are capped at 4 (separate from the single profile photo); skills require at least one selection.
- GPS relies on globally cached coordinates; if absent it alerts a permission message.
- Group mode derives `leader` from `name` when the leader field is left blank, and defaults `groupSize` to 1 if unparseable.
