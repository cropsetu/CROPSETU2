# Seller Orders

> **Tab:** Account/Profile · **Stack:** SellerStack · **Route name:** `SellerOrders` · **File:** `frontend/src/screens/Seller/OrdersScreen.js`

## Purpose
Shows the orders placed against this seller's products. Sellers can filter by status, see buyer/delivery details, and advance an order through its lifecycle (PENDING → CONFIRMED → SHIPPED → DELIVERED) or cancel a pending order. Used by sellers to fulfil and track sales.

## Where it sits / how you reach it
- **Reached from:** Seller Dashboard "Orders" quick action (`navigation.navigate('SellerOrders')`).
- **Navigates to:** none — actions happen in place (status updates via Alert confirmation). No `navigation` prop is even destructured.
- **Route params in:** none

## How it works
Holds a `filter` (`All` plus the status labels) and page-based pagination. `load(pageNum, replace)` requests `?page=&limit=20` plus an optional `&status=` when a non-All filter is active; `hasMore` is inferred from whether the page returned a full 20 items. A `useEffect` keyed on `load` (which depends on `filter`) re-runs page 1 whenever the filter changes, toggling the loading spinner. Pull-to-refresh reloads page 1; `onEndReached` appends the next page. `handleUpdateStatus` confirms via `Alert.alert`, fires a success haptic, `PUT`s the new status, and optimistically patches that order's status in local state. A client-side `filtered` array also re-filters the in-memory list by the active filter. Load errors are `console.warn`-ed; status-update failures raise an `Alert`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Status filter chips | Horizontal FlatList of chips | All / PENDING / CONFIRMED / SHIPPED / DELIVERED / CANCELLED; sets `filter` |
| Orders list | FlatList | Page-paginated `OrderCard`s |
| Product name | Text | Up to 2 lines |
| Buyer line | Text | Buyer name (or "Farmer") + phone |
| Status badge | Badge | Icon + colored status label |
| Details row | View | Qty (with unit), ₹ amount, payment method |
| Delivery address | View | Name, address line, city, pincode (when present) |
| "Mark as <next>" button | TouchableOpacity | Advances to the next status (confirm Alert → PUT) |
| "Cancel order" button | TouchableOpacity | Shown only for PENDING; sets status CANCELLED (confirm Alert → PUT) |
| Order date | Text | Formatted `createdAt` |
| Pull-to-refresh | RefreshControl | Reloads page 1 |
| Load-more spinner | ActivityIndicator | Footer spinner while fetching next page |
| Empty state | View | Receipt icon + "no orders" copy (All vs filtered wording) |
| Loading spinner | ActivityIndicator | Center spinner during initial/filter load |

## Services, APIs & data
- **API endpoints (all via `services/api`):**
  - `GET /agristore/seller/orders?page=<n>&limit=20[&status=<STATUS>]`
  - `PUT /agristore/seller/orders/:orderId/status` (body `{ status }`)
- **Backend route/service:** `backend/src/routes/agristore.routes.js` (seller orders list + status update)
- **State / context:** `useLanguage` (`t`); local `useState` for `orders`, `loading`, `refreshing`, `filter`, `page`, `hasMore`, `loadingMore`; `Animated.Value` refs in `OrderCard`; `Haptics`
- **Local / static data:** `STATUS_FLOW`, `STATUS_COLOR`, `STATUS_ICON`, `STATUS_LABELS` constants

## Languages / i18n
i18n via `useLanguage().t` under the `orders.*` namespace (`orders.qty`, `orders.amount`, `orders.payment`, `orders.markAs`, `orders.markAsMsg`, `orders.cancelOrder`, `orders.confirm`, `orders.noOrdersFound`, `orders.noOrdersAll`, `orders.noOrdersFilter`, `orders.updateStatusError`) plus shared `cancel`, `error`. The filter chip labels themselves (All/PENDING/…) are the raw status strings from `STATUS_LABELS`, not translated. Amounts use `toLocaleString('en-IN')`.

## Notes, edge cases & gaps
- Status advancement is linear via `STATUS_FLOW`; the "advance" button is hidden once an order is DELIVERED or CANCELLED. Cancel is offered only while PENDING.
- `hasMore` relies on a full page of 20; the last partial page stops pagination.
- The screen filters both server-side (query param) and client-side (`filtered`), so the in-memory list also narrows to the active filter.
- Load errors are silently `console.warn`-ed (no error UI); only update failures raise an Alert.
- No realtime/socket updates — new orders appear only on refresh or filter change.
