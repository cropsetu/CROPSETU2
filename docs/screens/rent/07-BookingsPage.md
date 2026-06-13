# Rent Bookings (Requests)

> **Tab:** Rent · **Stack:** RentStack · **Route name:** `RentBookings` · **File:** `frontend/src/screens/Rent/RentBookingsScreen.js`

## Purpose
Manages machinery/labour booking requests from two sides. "Received" shows requests other users made on the current user's listings (owner view) with Approve/Reject for pending ones. "My Bookings" shows requests the current user made as a customer, with read-only status.

## Where it sits / how you reach it
- **Reached from:** `RentHome` — the header notifications bell (shown only when the user has listings); the bell badge reflects the pending-received count.
- **Navigates to:** Back (`navigation.goBack()`) — header back arrow. (No outbound screen navigation; approve/reject happen in place.)
- **Route params in:** none.

## How it works
- On focus (`useFocusEffect`) `load()` runs `GET /rent/bookings/received` and `GET /rent/bookings` in parallel (`Promise.allSettled`), populating `received` and `myBooks`.
- `tab` ('received' | 'mine') selects the list. The "Received" tab shows a red badge with the count of PENDING requests.
- **Approve / Reject:** the buttons open an in-app confirmation modal (`confirm = { item, action }`). `runAction` first guards against acting on a no-longer-pending request (refreshes if stale), then calls `PUT /rent/bookings/:id/approve` or `PUT /rent/bookings/:id/reject`, optimistically updates the card's status (CONFIRMED / CANCELLED), and closes the modal. Errors show inline in the modal (`actErr`); 400/404 responses trigger a reload.
- Each booking's status drives its badge via `STATUS_CONFIG` (PENDING / CONFIRMED / ACTIVE / COMPLETED / CANCELLED).
- **Loading:** centered `ActivityIndicator`. **Empty:** per-tab empty state. **Refresh:** pull-to-refresh via `RefreshControl`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header (back + title/sub) | Header | Back arrow; "Rent Bookings" + "Manage requests" subtitle. |
| Received / My Bookings tabs | Segmented tabs | Switches `tab`; "Received" carries a pending-count badge. |
| Received card | Card | Type tag (machinery/labour), status badge, listing name, requester avatar/name/phone, dates → range, days, total amount, optional notes row. |
| Approve button | Primary button | On PENDING received cards → confirm modal (spinner while acting). |
| Reject button | Danger button | On PENDING received cards → confirm modal. |
| My-booking card | Card | Type tag, status badge, listing thumbnail/name/location, dates → range, total amount, and a "waiting for approval" row when PENDING. |
| Empty state | Empty view | Per-tab icon + title + subtext ("no booking requests" / "no bookings"). |
| Pull-to-refresh | RefreshControl | Re-runs `load`. |
| Approve/Reject confirmation popup | Modal | Check/close icon, confirm copy, a requester+dates pill, inline error text, and Cancel / Approve|Reject buttons (spinner while acting). |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `GET /rent/bookings/received`
  - `GET /rent/bookings`
  - `PUT /rent/bookings/:id/approve`
  - `PUT /rent/bookings/:id/reject`
- **Backend route/service:** `backend/src/routes/rent.routes.js`.
- **State / context:** `LanguageContext` (`t`), `useSafeAreaInsets`, local `useState`; `useFocusEffect` for reload.
- **Local / static data:** `STATUS_CONFIG` (per-status color/bg/icon/tKey); `fmt` date formatter (`en-IN`).

## Languages / i18n
Uses the `rent.*` namespace (`rentBookings`, `manageRequests`, `receivedTab`, `myBookingsTab`, status labels `statusPending`/`statusApproved`/`statusActive`/`statusCompleted`/`statusRejected`, `approve`, `reject`, `confirmApprove(Msg)`, `confirmReject(Msg)`, `waitingApproval`, `typeMachinery`, `typeLabour`, empty-state copy, error messages).

## Notes, edge cases & gaps
- Approve/Reject use an in-app modal instead of OS alerts (the comment notes Alert button callbacks don't fire on web).
- Stale-state protection: acting on a request that's no longer PENDING shows a message and reloads; server 400/404 also triggers a reload to resync.
- Status updates are applied optimistically to the local list; only the received list is mutated by actions (My Bookings is read-only here).
- The "Received" tab's pending badge mirrors the same count surfaced on the RentHome bell.
