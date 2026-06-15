# My Orders

> **Tab:** Account · **Stack:** ProfileStack · **Route name:** `MyOrders` · **File:** `frontend/src/screens/Profile/MyOrdersScreen.js`

## Purpose
Shows the buyer's AgriStore (marketplace) purchase history as a scrollable list of order cards. Each card summarises one order: a short order ID, status badge, the first product's thumbnail/name (with a "+N more items" hint), order date, and total amount. Used by any logged-in farmer to review what they have bought.

## Where it sits / how you reach it
- **Reached from:** Account home (`ProfileScreen`) — the "My Orders" quick tile (`navigation.navigate('MyOrders')`). Registered in `ProfileStack` as `MyOrders`.
- **Navigates to:** Only `navigation.goBack()` via the header back button. (Order cards are display-only — no tap-through to an order detail screen.)
- **Route params in:** none.

## How it works
On mount (`useEffect`) it calls `fetchOrders(null)`. Pagination is keyset/cursor-based: the first page requests `paginate=cursor&limit=10`; each subsequent page passes the server-issued `meta.nextCursor` as `cursor=...&limit=10`. Results append to the existing list unless it's a refresh/first page, in which case they replace it.

Key state: `orders`, `loading`, `refreshing`, `cursor` (next-page cursor; `null` = first page), `hasMore` (derived from `meta.nextCursor`), `loadingMore`, `error`.

Interactions: pull-to-refresh (`RefreshControl` → `fetchOrders(null, true)`); infinite scroll (`onEndReached` → `handleLoadMore`, guarded so it only fires when there is more, nothing is loading, and a cursor exists). A full-screen `ActivityIndicator` shows on initial load; an inline footer spinner shows while more pages may load. Errors set `error` and render a retry view.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header | View with back button + title | Title "My Orders"; back button → `navigation.goBack()`. |
| Back button | `TouchableOpacity` (arrow-back icon) | Returns to account home. |
| Order list | `FlatList` | Renders `OrderCard` per order; `removeClippedSubviews`, windowed. |
| Order card | `OrderCard` (View) | One per order; display-only (not tappable). |
| Order ID | Text | Last 8 chars of `order.id`, uppercased, prefixed `#`. |
| Status badge | `StatusBadge` | Colored pill: PENDING / CONFIRMED / SHIPPED / DELIVERED / CANCELLED (color from `STATUS_META`). |
| Product thumbnail | Image / placeholder | First item's first image, or a cube-outline placeholder. |
| Product name + "+N more items" | Text | First item name; extra-item count hint. |
| Date | Text (calendar icon) | `order.createdAt` formatted `dd MMM yyyy` (en-IN). |
| Total | Text | `₹` + `order.total` to 2 decimals. |
| Pull-to-refresh | `RefreshControl` | Reloads first page. |
| Footer spinner | `ActivityIndicator` | Shown while `hasMore`. |
| Empty state | View | Cart-outline icon + "No orders yet" / "Your AgriStore orders will appear here". |
| Error state | View | Alert icon + message + "Retry" button. |
| Loading state | `ActivityIndicator` | Full-screen on initial load. |

## Services, APIs & data
- **API endpoints (via `services/api.js`, base `/api/v1`):**
  - `GET /agristore/orders?paginate=cursor&limit=10` — first page.
  - `GET /agristore/orders?cursor=<nextCursor>&limit=10` — subsequent pages.
- **Backend route/service:** AgriStore order routes (`backend/src/routes/agristore.*` / order routes) — not `user.routes.js`. The screen reads `data.data` (orders) and `data.meta.nextCursor`.
- **State / context:** `LanguageContext` (`t`, imported but the header/empty strings are hardcoded English; `t` is largely unused for visible copy) and local `useState`/`useCallback`. No socket, writeQueue, or AuthContext usage.
- **Local / static data:** `STATUS_META` map (status → label/color/bg) and `CATEGORY`-style color constants from `constants/colors`.

## Languages / i18n
`useLanguage().t` is imported but the visible strings ("My Orders", "No orders yet", "Your AgriStore orders will appear here", "Retry", status labels, "more item(s)") are hardcoded English in this file. So the screen is effectively English-only despite the i18n hook being present.

## Notes, edge cases & gaps
- **Retry bug:** the error-state "Retry" button and one branch call `fetchOrders(1)` (a numeric `1`), but `fetchOrders` treats any truthy `cur` as a cursor and would issue `cursor=1` — a stale/invalid request rather than a clean first-page reload (which uses `null`). Worth noting as a minor gap.
- Order cards are not tappable — there is no order-detail navigation from here.
- `hasMore` is derived purely from `meta.nextCursor`; the footer spinner remains until the server stops returning a cursor.
- No offline/writeQueue handling — failures surface the generic error view.
- Status labels and colors are fixed to the five `STATUS_META` statuses; unknown statuses fall back to the raw status string with neutral styling.
