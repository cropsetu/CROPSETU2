# My Animal Listings

> **Tab:** Account · **Stack:** ProfileStack · **Route name:** `MyAnimalListings` · **File:** `frontend/src/screens/Profile/MyAnimalListingsScreen.js`

## Purpose
Shows the animal listings the current user has posted to the AnimalTrade marketplace, and lets them manage each one — view basic info (animal/breed, age, gender, location, price, view count, date), edit a listing, or delete it. The entry point for a farmer to maintain their livestock-for-sale inventory.

## Where it sits / how you reach it
- **Reached from:** Account home (`ProfileScreen`) — the "My Listings" quick tile and the "My Animal Listings" row under My Activity (both `navigation.navigate('MyAnimalListings')`). Registered in `ProfileStack` as `MyAnimalListings`.
- **Navigates to:**
  - `navigation.goBack()` — header back button.
  - `AnimalTrade` `{ screen: 'AddAnimalListing' }` — the header "+" button and the empty-state "Add Listing" button (create new).
  - `AnimalTrade` `{ screen: 'AddAnimalListing', params: { listing: item } }` — a card's edit (pencil) button (edit existing; passes the listing for prefill).
- **Route params in:** none.

## How it works
On mount (`useEffect`) and on every focus (`useFocusEffect`) it calls `fetchListings()` → `GET /animals/my`, storing `data.data` into `listings`. Refresh-on-focus ensures a newly posted/edited listing appears immediately on return.

Key state: `listings`, `loading`, `refreshing`, `error`, `pendingDelete` (the listing awaiting delete confirmation, or `null`), `deleting`.

Delete flow: the card's trash button calls `requestDelete(item)` which sets `pendingDelete` and opens a confirmation `Modal` (a state-driven Modal is used because RN-Web silently drops multi-button `Alert.alert`). Confirming calls `confirmDelete` → `DELETE /animals/<id>`, then optimistically removes the listing from local state and closes the modal. On error it closes the modal and shows a single-button `Alert.alert('Delete failed', ...)`.

Edit flow: `handleEdit(item)` navigates to the AnimalTrade `AddAnimalListing` screen with the listing as a param for prefill.

There is no pagination — the whole list comes from one `/animals/my` call. Pull-to-refresh re-fetches.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header | View with back, title, add | Title "My Listings". |
| Back button | `TouchableOpacity` (arrow-back) | `navigation.goBack()`. |
| Add button ("+") | `TouchableOpacity` (header right) | → `AnimalTrade` `{ screen: 'AddAnimalListing' }`. |
| Listing list | `FlatList` | Renders `ListingCard` per listing; windowed, `removeClippedSubviews`. |
| Listing card | `ListingCard` (View) | One per listing. |
| Thumbnail | Image / placeholder | First image, or paw-outline placeholder. |
| Animal name | Text | `"{animal} — {breed}"`. |
| Detail line | Text | `"{age} · {gender}"`. |
| Location | Text (location icon) | `item.sellerLocation`. |
| Price | Text | `₹` + `item.price` (en-IN formatted). |
| View count + date | Text (eye + calendar) | `viewCount` views and `createdAt` date. |
| Edit button | `TouchableOpacity` (pencil) | → AddAnimalListing with `{ listing: item }` for prefill. |
| Delete button | `TouchableOpacity` (trash) | Opens delete-confirm modal (`requestDelete`). |
| Pull-to-refresh | `RefreshControl` | Re-fetches `/animals/my`. |
| Empty state | View | Paw-outline icon + "No listings yet" / "Tap + to list an animal for sale" + "Add Listing" button → AddAnimalListing. |
| Error state | View | Alert icon + message + "Retry" button. |
| Loading state | `ActivityIndicator` | Full-screen on initial load. |
| Delete-confirm modal | `Modal` (centered) | Trash icon, "Remove Listing?" title, item summary body, Cancel + Delete buttons; Delete shows spinner while `deleting`. |

## Services, APIs & data
- **API endpoints (via `services/api.js`, base `/api/v1`):**
  - `GET /animals/my` — the user's own animal listings.
  - `DELETE /animals/<id>` — delete a listing.
- **Backend route/service:** AnimalTrade/animals routes (`backend/src/routes/animals.*` / `animal.routes.js`) — not `user.routes.js`.
- **State / context:** Local `useState`/`useCallback` + `useFocusEffect` (refresh on focus). No AuthContext, LanguageContext, socket, or writeQueue usage. Single-button error `Alert.alert` is used for delete failures.
- **Local / static data:** Color constants from `constants/colors`. No mock data.

## Languages / i18n
No i18n — this screen does **not** import `useLanguage`. All visible strings ("My Listings", "No listings yet", "Tap + to list an animal for sale", "Add Listing", "Remove Listing?", "Cancel", "Delete", "Retry", "{n} views") are hardcoded English.

## Notes, edge cases & gaps
- Delete uses a state-driven `Modal` specifically because RN-Web silently drops multi-button `Alert.alert` confirmations (commented in the code). The error path uses a single-button `Alert.alert`, which works fine on web.
- Deletion is optimistic on success (local filter) — no re-fetch needed.
- No pagination/infinite scroll — relies on a single `/animals/my` response, so very large inventories load all at once.
- Refresh-on-focus (`useFocusEffect`) keeps the list in sync after add/edit.
- Cards have view counts (`viewCount`) but no analytics/detail drill-down; tapping the card body does nothing — only the edit/delete buttons are interactive.
