# Machinery Detail

> **Tab:** Rent · **Stack:** RentStack · **Route name:** `MachineryDetail` · **File:** `frontend/src/screens/Rent/MachineryDetail.js`

## Purpose
Full detail page for a single piece of rental equipment. Shows an image/video gallery, specs, an availability calendar, and a date-range booking flow with conflict checking and a cost calculator. Renters request a booking here; owners viewing their own listing instead get an "Edit Listing" action.

## Where it sits / how you reach it
- **Reached from:** `RentHome` — tapping a machinery card or its "Book Now" button (passes `{ id, machinery }`).
- **Navigates to:**
  - `AddMachinery` (params `{ listing: m, editMode: true }`) — the owner's "Edit Listing" bottom button.
  - Back (`navigation.goBack()`) — the gallery back arrow, and the booking-sent popup "Done" button.
  - Phone dialer (`tel:` via `safeOpenURL`) — the call icon / "Call Owner" button (not a screen).
- **Route params in:** `{ id, machinery }` — `machinery` is the pre-passed list item used for instant render; `id` drives the detail/availability fetches.

## How it works
- Initial state seeds `data` from the passed `machinery`. Three effects run keyed on `id`:
  1. `GET /rent/machinery/:id` → full detail (`setData`, seeds `bookedRanges` from `data.bookings`).
  2. `GET /rent/machinery/:id/availability?year&month` → booked date ranges for the visible calendar month (re-runs when month changes).
  3. `GET /rent/bookings?type=machinery` → finds the current user's own PENDING/CONFIRMED/ACTIVE booking on this listing (`myBooking`).
- **Owner check:** `isOwner` = `user.id === m.owner?.id || m.ownerId`; owners can't book (blocked client- and server-side).
- **Availability window:** `availFrom`/`availTo` (YYYY-MM-DD; either may be null = open-ended). `minBookKey` is the later of today and availFrom; `windowExpired` is true when availTo has passed. The calendar auto-jumps to the availability start month when it's in the future.
- **Date selection:** `handleDayPress` builds a start→end range; tapping restarts the range if a full one exists or a day before the start is tapped. `rangeHasBlocked` rejects ranges spanning any booked/out-of-window day (shows an Alert). `selectedDays()` and `totalCost()` (days × pricePerDay) feed the booking summary.
- **Booking submit (`handleBook`):** validates owner/date/range, then `POST /rent/bookings` with `{ machineryListingId, startDate, endDate, days, totalAmount, notes }`. On success it clears the selection, re-fetches availability, sets `myBooking` to PENDING, and shows the success modal. On failure shows an Alert with the server message.
- **Loading:** a full-screen `ActivityIndicator` while `loadingData` and no data.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Media gallery | Horizontal paging carousel | Images + videos (`expo-av Video` with native controls); fallback construct icon when empty; page dots. |
| Back button | Icon button (overlay) | `goBack()`. |
| Call (top) button | Icon button (overlay) | Dials `m.ownerPhone` via `safeOpenURL`/`sanitizePhone`. |
| Availability overlay | Badge | "Available Now" vs "Advance Booking Only" based on `m.available`. |
| Title + price box | Header | Name, brand, and ₹/hr, ₹/day, ₹/acre prices. |
| Rating row | Stars + text | 5-star display + rating value and review count. |
| Equipment specs card | Info rows | Age, usage hours, horsepower, fuel type, location, availability-from/to (each row hidden if value missing). |
| Features chips | Chips | One chip per `m.features`. |
| Description | Text block | `m.description`. |
| Owner notice | Banner | Shown when `isOwner` — "you can't book it". |
| My-booking banner | Banner | Non-owner with existing request — PENDING (orange) or CONFIRMED (green) with dates. |
| Window-expired card | Banner | Shown when the availability window has fully passed. |
| Availability window hint | Banner | Shows the available date range when bounds exist. |
| Availability calendar | Month calendar | Prev/next month nav; day cells colored for occupied/your-selection/unavailable; legend below. |
| Booking summary card | Card | Selected dates, days × price, total amount, and a multiline notes `TextInput`. |
| Owner card | Card | Owner avatar/name/location + a small call button. |
| Bottom bar — Edit Listing | Primary button | Owner only → `AddMachinery` in edit mode. |
| Bottom bar — Call Owner | Secondary button | Non-owner → dials owner. |
| Bottom bar — Book button | Primary button | Shows "Book {n}d — ₹{total}" / "Select dates"; disabled until a full range and not booking; runs `handleBook`. |
| Bottom bar — pending/confirmed state | Static badge | Replaces the Book button when `myBooking` exists and no new range is selected. |
| Booking-sent popup | Modal | Success modal with check icon, date/amount pill, and a "Done" button that closes and goes back. |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `GET /rent/machinery/:id`
  - `GET /rent/machinery/:id/availability?year&month`
  - `GET /rent/bookings?type=machinery`
  - `POST /rent/bookings` (body `{ machineryListingId, startDate, endDate, days, totalAmount, notes }`)
- **Backend route/service:** `backend/src/routes/rent.routes.js`.
- **State / context:** `AuthContext` (`user`), `LanguageContext` (`t`), `useSafeAreaInsets`, local `useState`/`useCallback`.
- **Local / static data:** `DAY_KEYS`, `MONTH_KEYS` (calendar labels resolved via `t('weatherHome.*')`); calendar helpers (`buildMonthCells`, `dateKey`, `isBooked`, `isPast`).

## Languages / i18n
Heavy `rent.*` namespace usage (specs labels, calendar legend, booking summary, alerts, success copy). Calendar day/month names reuse the `weatherHome.*` namespace. Dates are formatted with `toLocaleDateString('en-IN')`.

## Notes, edge cases & gaps
- Owners are prevented from booking their own listing (owner notice + Edit action instead).
- Selecting a range that spans a booked/out-of-window day is rejected both during selection and again as a final safety net in `handleBook`.
- After a successful booking, availability is re-fetched so the just-booked dates immediately show as occupied.
- Phone numbers are sanitized (`sanitizePhone`) and opened via `safeOpenURL`; the call button no-ops when `ownerPhone` is absent.
- Videos in the gallery are detected via membership in `m.videos` and render with `expo-av`.
