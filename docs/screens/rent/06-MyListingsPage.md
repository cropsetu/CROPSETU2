# My Rent Listings

> **Tab:** Account (Profile) · **Stack:** ProfileStack · **Route name:** `MyRentListings` · **File:** `frontend/src/screens/Rent/MyRentListingsScreen.js`

## Purpose
Lets a user manage the machinery and labour listings they have created. It shows two tabs (Machinery / Workers) with each listing's key info and Edit / Delete actions. Although the screen file lives under `screens/Rent/`, it is registered inside the **Profile** stack (Account tab), not the Rent tab.

## Where it sits / how you reach it
- **Reached from:** The Profile/Account tab (`ProfileNavigator`) — registered as `MyRentListings`. Typically opened from the Profile home screen's "My Rent Listings" entry.
- **Navigates to:**
  - `AddMachinery` / `AddWorker` — via Edit (prefilled, `editMode: true`) and Add buttons. Because those screens live in the Rent stack, navigation crosses into the nested Rent tab: `navigation.navigate('Rent', { screen, params })`.
  - Back (`navigation.goBack()`) — header back arrow.
- **Route params in:** none.

## How it works
- On focus (`useFocusEffect`) it calls `fetchMyListings()` which runs `GET /rent/machinery/my` and `GET /rent/labour/my` in parallel (`Promise.allSettled`, so one failure doesn't break the other) and stores results in `machinery` / `labour`.
- `tab` ('machinery' | 'labour') selects which list to render; tab labels include live counts.
- **Edit** routes to the matching Add screen with `{ listing: item, editMode: true }` through the Rent stack.
- **Delete** opens an in-app confirmation modal (not an OS Alert). `confirmDelete` calls `DELETE /rent/:type/:id`, removes the item from local state on success, or shows an inline error (`delError`) in the modal. The card dims (`opacity 0.5`) while its `id` is being deleted.
- **Loading:** centered `ActivityIndicator`. **Empty:** a per-tab empty state with an "Add" CTA. **Refresh:** pull-to-refresh via `RefreshControl`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header (back + title/sub) | Header | Back arrow; "My Rent Listings" + "Manage listings" subtitle. |
| Add (+) button | Icon button | Header right; opens `AddMachinery`/`AddWorker` for the active tab. |
| Machinery / Workers tabs | Segmented tabs | Each shows a live `(count)`; switches `tab`. |
| Machinery card | Card | Thumbnail (image or category icon), name, brand/HP, ₹/day, available/advance-booking status badge, location row. |
| Labour card | Card | Avatar (image or initials), leader/name, group size, ₹/day, status badge, up-to-3 skill tags, location row. |
| Edit button | Secondary button | Per card → opens the matching Add screen in edit mode. |
| Delete button | Danger button | Per card → opens the delete-confirm modal. |
| Empty state | Empty view | Icon, "no machinery/labour listed" title, hint, and an add-first CTA button. |
| Pull-to-refresh | RefreshControl | Re-runs `fetchMyListings`. |
| Delete confirmation popup | Modal | Trash icon, confirm copy, an item-name pill, inline error text, and Cancel / Delete buttons (Delete shows a spinner while deleting). |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `GET /rent/machinery/my`, `GET /rent/labour/my`
  - `DELETE /rent/machinery/:id`, `DELETE /rent/labour/:id` (template `/rent/${type}/${item.id}`)
- **Backend route/service:** `backend/src/routes/rent.routes.js` (delete is a soft-delete, owner-guarded).
- **State / context:** `LanguageContext` (`t`), `useSafeAreaInsets`, local `useState`; `useFocusEffect` for reload.
- **Local / static data:** `MACH_CATS` map (icon + color per category).

## Languages / i18n
Uses the `rent.*` namespace (`myRentListings`, `manageListings`, `machineryTab`, `workersTab`, `edit`, `delete`, `confirmDelete`, `confirmDeleteMsg`, `noMachineryListed`, `noLabourListed`, `tapToAdd`, `deleteError`, `cancel`, status labels, `workersCount`).

## Notes, edge cases & gaps
- This Profile-stack screen reaches the Rent-stack Add/Edit forms via cross-stack navigation (`navigate('Rent', { screen, params })`).
- Delete is confirmed in-app (consistent with the app's other modals) rather than via an OS alert; failures surface inline in the same modal.
- `Promise.allSettled` ensures a single failing endpoint still renders the other list.
- Note: worker "Edit" passes `editMode`/`listing` params, but `AddWorkerScreen` does not currently read them, so editing a worker opens a blank form (see add-worker.md).
