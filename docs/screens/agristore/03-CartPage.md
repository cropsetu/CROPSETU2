# Cart

> **Tab:** Shop · **Stack:** `AgriStoreNavigator` (AgriStack) · **Route name:** `Cart` · **File:** `frontend/src/screens/AgriStore/CartScreen.js`

## Purpose
Shows the farmer's current shopping cart: line items with images, per-unit price, quantity steppers and per-item subtotals, plus an order summary (subtotal, delivery, free-delivery progress, total payable). Entry point to checkout.

## Where it sits / how you reach it
- **Reached from:** `AgriStoreHome` cart icon, `ProductDetail` cart icon, and after add-to-cart/"Buy Now" on `ProductDetail` (`navigation.navigate('Cart')`).
- **Navigates to:**
  - `Checkout` — "Proceed to Checkout" button, passing `{ total, delivery, grandTotal, itemCount }`.
  - Back — header back arrow (`navigation.goBack()`); the empty-cart "Browse Products" button also calls `goBack()`.
- **Route params in:** none.

## How it works
- On mount `fetchCart()` calls `api.get('/agristore/cart')` and sets `items` (`data.data.items`) and `total` (`data.data.total`). Pull-to-refresh re-fetches.
- Delivery logic: `FREE_THRESHOLD = 999`; `delivery = total >= 999 ? 0 : 49`; `grandTotal = total + delivery`.
- **Quantity change** (`handleQtyChange`): optimistic local update of item + total, then `PUT /agristore/cart/{productId}` `{ quantity }`; on error re-fetches. `+` is capped at `product.stock`. Decrementing below 1 triggers removal.
- **Remove** (`handleRemove`): optimistic removal, then `DELETE /agristore/cart/{productId}` and `refreshCart()`; on error re-fetches. The trash button plays a slide-out animation (no confirm dialog — removal is reversible).
- Loading shows a header + 3 `CartItemSkeleton`s. When not loading and `items.length === 0`, renders the animated `EmptyCart` component.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back button | Header icon | `navigation.goBack()` |
| Header title / subtitle | Text | "My Cart" + "{n} items" (subtitle is "loading" during fetch) |
| Header count badge | Badge | Shows `items.length` when > 0 |
| Cart item card | List item | Image, category, name, price/unit, quantity pill, subtotal |
| Quantity pill | −/+ stepper | `handleQtyChange`; `+` disabled (dimmed) at stock cap; animated number pop |
| Trash button | Icon button | `confirmRemove` → slide-out + `handleRemove` |
| Pull-to-refresh | RefreshControl | Re-runs `fetchCart()` |
| Order summary card | List footer | Subtotal (with item count), delivery, total payable |
| Free-delivery progress | Animated progress bar | "Add ₹X more for free delivery!" — shown only when delivery > 0 |
| Savings badge | Inline badge | "You saved ₹49 on delivery!" — shown when delivery == 0 |
| Bottom action bar | Sticky bar | Grand total + item/delivery summary + "Proceed to Checkout" |
| Proceed to Checkout | Primary button | `handleCheckout` → `Checkout` with totals |
| Empty cart state | Full-screen view | Pulsing bag icon, title/subtitle, gradient "Browse Products" button → goBack |
| Cart item skeleton | Shimmer placeholder | 3 shown while loading |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `GET /agristore/cart` — cart items + total.
  - `PUT /agristore/cart/{productId}` `{ quantity }` — update line quantity.
  - `DELETE /agristore/cart/{productId}` — remove line.
- **Backend route/service:** `backend/src/routes/agristore.routes.js` (`GET /cart` line 190, `PUT /cart/:productId` line 233, `DELETE /cart/:productId` line 253) — all `authenticate`-guarded.
- **State / context:** `useCart()` (`refresh`) to keep the global tab badge synced; `useLanguage()` (`t`); local `useState` (items, total, loading, refreshing); `useSafeAreaInsets`.
- **Local / static data:** `FREE_THRESHOLD = 999`, flat ₹49 delivery fee, `GREEN_BG` constant.

## Languages / i18n
i18n via `t`. Keys include `cart.emptyTitle`, `cart.emptySub`, `cart.browseProducts`, `cart.myCart`, `cart.orderSummary`, `cart.delivery`, `cart.totalPayable`, `cart.proceedCheckout`, `loading`, `free`. Some strings are hardcoded English ("My Cart", "{n} items", "Subtotal", "You saved ₹49 on delivery!", "Free delivery").

## Notes, edge cases & gaps
- **Optimistic updates** for qty/remove with re-fetch rollback on API error; no error toast/alert is shown to the user.
- **Removal has no confirm dialog** by design (relies on the slide-out animation as feedback; item can be re-added from ProductDetail).
- Free delivery threshold (₹999) and fee (₹49) are hardcoded client-side; the server computes its own authoritative total at order time.
- Empty cart fetch failure also routes to `setItems([])` → empty state.
