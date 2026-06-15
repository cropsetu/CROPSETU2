# Rent Home (Machinery & Labour Marketplace)

> **Tab:** Rent · **Stack:** RentStack · **Route name:** `RentHome` · **File:** `frontend/src/screens/Rent/RentHome.js`

## Purpose
The landing screen of the Rent bottom tab. It is a two-mode marketplace where farmers browse equipment available for hire ("Machinery") or farm workers/groups available for wage work ("Workers/Labour"). It supports GPS-based proximity sorting, category and distance filtering, text search, and quick entry points to list your own machinery or register as a worker.

## Where it sits / how you reach it
- **Reached from:** The "Rent" bottom tab (the `construct` icon) — it is the first/default screen of `RentNavigator`.
- **Navigates to:**
  - `MachineryDetail` (params `{ id, machinery }`) — tapping a machinery card or its "Book Now" button.
  - `LabourDetail` (params `{ id, labour }`) — tapping a worker card or its "Call" button.
  - `AddMachinery` — the "List Your Machinery" empty-state button and the bottom banner (when on the Machinery tab).
  - `AddWorker` — the "Register as Worker" empty-state button and the bottom banner (when on the Workers tab).
  - `RentBookings` — the header bell icon (only shown when the user has listings).
- **Route params in:** none.

## How it works
- On mount the screen reads global GPS from `LocationContext` (`coords`, `loading`). Once GPS is ready (`gpsReady`) it calls `fetchAll()`. It re-fetches on radius change and on every screen focus (`useFocusEffect`).
- `fetchAll()` issues parallel `GET /rent/machinery` and `GET /rent/labour` calls, passing `lat`/`lng`/`radius` params when GPS is available so the backend can sort by proximity and return a `distanceKm` per item.
- If logged in, it additionally fetches `/rent/machinery/my` + `/rent/labour/my` to decide whether to show the header bell (`hasListings`); if listings exist it fetches `/rent/bookings/received/pending-count` for the bell badge. It also fetches `/rent/bookings` to build a `bookingMap` (listingId → my booking status) so cards the user has already booked show a status tag.
- Key state: `tab` ('machinery' | 'labour'), `category`, `search`, `radiusKm` (default 10), `machinery`, `labour`, `loading`, `fetchError`, `pendingCount`, `hasListings`, `bookingMap`.
- Filtering is client-side: machinery is filtered by selected `category` and a case-insensitive search across name/equipment/brand/location; labour is filtered by search across name/leader/location/skills.
- The collapsing header uses `useScrollHeader(55)`; a `ScrollToTopButton` appears once scrolled.
- **Loading:** a `TractorLoader` is shown in place of the list. **Error:** on a failed fetch a red retry banner appears (in `__DEV__` it falls back to mock data from `constants/mockData`; in production it shows empty lists + error). **Empty:** a "Coming Soon" empty card with a call-to-action button to list machinery / register as a worker.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Screen title "Rent" | Header text | `t('rentTitle')`, in the collapsing header. |
| GPS status dot | Indicator | Green when GPS coords available, orange (`COLORS.cta`) otherwise. |
| Notifications bell | Icon button | Only when `hasListings`; navigates to `RentBookings`. Shows a red count badge (`pendingCount`, capped "9+"). |
| Error/retry banner | Toast-style button | Shown on fetch failure; tap to re-run `fetchAll()`. |
| Machinery / Workers tabs | Segmented tabs | Two-tab bar switching `tab`; resets category to "all". Icons `construct-outline` / `people-outline`. |
| Search bar | Text input | Placeholder switches between `machinerySearch` / `labourSearch`; has a clear (×) button when text present. |
| Distance label | Text | "Nearby" when GPS on, "GPS off" otherwise (`rent.distNearby` / `rent.distGpsOff`). |
| Distance filter chips | Horizontal chips | 5 / 10 / 25 / 50 km + "Any"; disabled (greyed) when GPS off and km ≠ null; sets `radiusKm`. |
| Category chips | Horizontal chips | Machinery tab only. all/tractor/harvester/sprayer/rotavator/thresher/transplanter/truck/tempo/other; custom `MachineryIcon` per category; sets `category`. |
| Section header + count badge | Header | Shows the active category title and "{n} found" count. |
| Machinery card | Card | Photo (or `MockImagePlaceholder`), gradient overlay, availability badge (Booked/Reserved/Available), category tag, distance overlay, name/brand/HP, price/hr + price/day, rating pill, age pill, "Verified" pill, location row. |
| Card "Book Now" button | Primary button | On machinery cards (non-owner, not already booked) → navigates to `MachineryDetail`. |
| "Your Listing" tag | Badge | Shown on cards the current user owns (in place of Book/Call). |
| Booked status tag | Badge | Shown when `bookingMap[item.id]` is PENDING/CONFIRMED/ACTIVE. |
| Worker card | Card | Avatar (image or initials) with availability dot, name/leader, group size, skill tags (+more), location/distance, rating pill, price/day, booked lock badge. |
| Card "Call" button | Primary button | On worker cards (non-owner) → navigates to `LabourDetail`. |
| Empty state | Empty card | Icon, "Coming Soon" title, "no listings" text, and a button to `AddMachinery` / `AddWorker`. |
| List-your-equipment/worker banner | Banner button | Bottom of list → navigates to `AddMachinery` or `AddWorker` based on tab. |
| Scroll-to-top button | FAB | `ScrollToTopButton`, visible after scrolling. |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `GET /rent/machinery` (with `lat`,`lng`,`radius` params)
  - `GET /rent/labour` (with `lat`,`lng`,`radius` params)
  - `GET /rent/machinery/my`, `GET /rent/labour/my`
  - `GET /rent/bookings/received/pending-count`
  - `GET /rent/bookings`
- **Backend route/service:** `backend/src/routes/rent.routes.js`.
- **State / context:** `AuthContext` (`isLoggedIn`, `user.id`), `LocationContext` (GPS coords), `LanguageContext` (`t`), local `useState`, `useScrollHeader` hook.
- **Local / static data:** `MACH_CATS` (category config), `DIST_OPTIONS` (distance filter); dev-only fallback `MACHINERY_LISTINGS` / `LABOUR_LISTINGS` from `constants/mockData`.

## Languages / i18n
Uses `useLanguage().t` with the `rent.*` namespace heavily (category keys `catTractor`…`catOther`, tab keys, distance, status labels, empty-state copy) plus top-level keys `rentTitle`, `bookNow`, `verified`, `machinerySearch`, `labourSearch`, and `ai.comingSoon`. Multi-language is supported app-wide via the i18n context.

## Notes, edge cases & gaps
- Distance chips other than "Any" are disabled until GPS coordinates are available.
- "Owner" detection compares `user.id` against `item.owner?.id`/`item.ownerId` (machinery) and `item.provider?.id`/`item.providerId` (labour) to swap Book/Call for a "Your Listing" tag.
- Availability badge precedence: real booking status (`bookedStatus` BOOKED/RESERVED from the backend) overrides the owner's manual `available` flag.
- Mock data is only used in development (`__DEV__`); production shows an error/empty state instead.
- The bell (and bookings entry) is hidden entirely for users with no listings.
