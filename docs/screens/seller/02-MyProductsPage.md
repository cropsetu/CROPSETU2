# My Products

> **Tab:** Account/Profile · **Stack:** SellerStack · **Route name:** `SellerMyProducts` · **File:** `frontend/src/screens/Seller/MyProductsScreen.js`

## Purpose
Lists all products the seller has listed in the AgriStore. The seller can scroll their catalog, toggle each product active/inactive, edit a product, delete a product, and add a new one via a floating button. Used by sellers to manage their shop inventory.

## Where it sits / how you reach it
- **Reached from:** Seller Dashboard "My Products" quick action (`navigation.navigate('SellerMyProducts')`).
- **Navigates to:**
  - Per-card "Edit" → `AddProduct` with `{ product: item }`
  - FAB (+) → `AddProduct` with `{ product: null }` (light haptic)
- **Route params in:** none

## How it works
On mount it loads the first page of products via cursor (keyset) pagination — the first request opts in with `paginate=cursor&limit=20`, subsequent pages pass the server's `nextCursor`. It also registers a navigation `focus` listener so the list reloads (replaces) whenever the screen regains focus (e.g. returning from AddProduct). `hasMore`/`cursor` come from `meta.nextCursor`. Infinite scroll: `onEndReached` calls `onLoadMore`, which appends the next page. Pull-to-refresh reloads page 1. Delete asks for confirmation via `Alert.alert` then `DELETE`s and optimistically removes the item from state. The active/inactive `Switch` PUTs the new `isActive` and updates that row from the response. A full-screen spinner shows during initial load; per-page errors are `console.warn`-ed, and delete/toggle errors raise an `Alert`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Product list | FlatList | Cursor-paginated list of `ProductCard`s |
| Product thumbnail | Image / placeholder | First image, or image-outline placeholder |
| Product name | Text | Up to 2 lines |
| Category | Text | `item.category?.name` |
| Price + MRP | Text | ₹price/unit, with struck-through MRP if higher |
| Stock line | Text | Stock with unit; turns red when stock is 0 |
| Active/inactive toggle | Switch | Calls `handleToggle` → `PUT` isActive |
| Edit action | TouchableOpacity | Pencil; opens `AddProduct` with the product |
| Delete action | TouchableOpacity | Trash; confirm Alert then `DELETE` |
| Add FAB (+) | TouchableOpacity | Pulsing-ring floating button; opens `AddProduct` (new) |
| Pulse ring | Animated.View | Looping ring animation around the FAB |
| Pull-to-refresh | RefreshControl | Reloads page 1 |
| Load-more spinner | ActivityIndicator | Footer spinner while fetching next page |
| Empty state | View | Storefront icon + "no products" copy when list is empty |
| Loading spinner | ActivityIndicator | Full-screen during initial load |

## Services, APIs & data
- **API endpoints (all via `services/api`):**
  - `GET /agristore/seller/products?paginate=cursor&limit=20` (first page) / `?cursor=<cursor>&limit=20` (next pages)
  - `PUT /agristore/seller/products/:id` (toggle `isActive`)
  - `DELETE /agristore/seller/products/:id`
- **Backend route/service:** `backend/src/routes/agristore.routes.js` (seller products CRUD)
- **State / context:** `useLanguage` (`t`); local `useState` for `products`, `loading`, `refreshing`, `cursor`, `hasMore`, `loadingMore`; `Animated.Value` refs for the FAB ring; `navigation.addListener('focus', ...)`
- **Local / static data:** `UNIT_LABELS` map (kg, g, L, etc.); `COLORS`, `SHADOWS`, `RADIUS`; `Haptics`

## Languages / i18n
i18n via `useLanguage().t` under the `myProducts.*` namespace (`myProducts.stock`, `myProducts.edit`, `myProducts.delete`, `myProducts.deleteProduct`, `myProducts.deleteConfirm`, `myProducts.noProducts`, `myProducts.noProductsSub`, `myProducts.deleteError`, `myProducts.updateStatusError`) plus shared keys `cancel`, `error`. Prices formatted with `toLocaleString('en-IN')`.

## Notes, edge cases & gaps
- Uses keyset/cursor pagination (not page numbers) to keep deep-page latency flat.
- `onLoadMore` early-returns when there is no `cursor`, a load is already running, or `hasMore` is false.
- Delete and toggle update local state optimistically; failures surface via `Alert`.
- List-load errors are silently `console.warn`-ed (no error UI), falling back to whatever was already loaded.
- The FAB pulse-ring hooks are declared before the early loading return to respect the Rules of Hooks.
