# Product Detail

> **Tab:** Shop · **Stack:** `AgriStoreNavigator` (AgriStack) · **Route name:** `ProductDetail` · **File:** `frontend/src/screens/AgriStore/ProductDetail.js`

## Purpose
Full-page view of a single agri-store product. Shows an image gallery, brand/name, rating, price/MRP/savings, stock state, a quantity selector, seller info and collapsible spec/highlight/description sections, plus a similar-products carousel. Lets the farmer add the item to the cart or "Buy Now".

## Where it sits / how you reach it
- **Reached from:** `AgriStoreHome` product/best-seller cards (`navigation.navigate('ProductDetail', { product })`); and recursively from its own "Similar Products" cards via `navigation.push('ProductDetail', { product: p })`.
- **Navigates to:**
  - `Cart` — header cart icon, and after "Add to Cart"/"Buy Now" (`handleBuyNow` navigates to `Cart` after adding).
  - `ProductDetail` (pushed) — tapping a similar-product card.
  - Back — header back arrow (`navigation.goBack()`).
- **Route params in:** `{ product }` — **required**; the full product object (id, name, nameHi, images[], price, mrp, stock/inStock, rating, ratingCount, unit, category{id,name}, categoryId, brand, manufacturer, countryOfOrigin, minOrderQty, highlights[], specifications{}, description).

## How it works
- On mount, runs an entrance animation (fade + slide-up) and fetches similar products: `api.get('/agristore/products?categoryId={catId}&limit=10')` using `product.category?.id || product.categoryId`, filters out the current product, keeps up to 8.
- Derives `discount`, `saving`, `inStock`, `reviews`, `brandLabel`, `mfrLabel`, and builds `specRows` / `mfrRows` from real DB fields (seller `specifications{}` merged with base rows; falls back to derived highlight grid).
- `quantity` state with +/- pill; the `+` button is capped at `product.stock` when stock is known.
- **Add to cart:** `addToCart()` POSTs `/agristore/cart` `{ productId, quantity }`, then `refreshCart()`. `handleAddToCart` shows a success `Alert`; `handleBuyNow` navigates to `Cart` on success. Errors surface via `Alert.alert`. `adding` state disables both buttons and shows a spinner.
- Wishlist heart + share button are local/visual only (heart toggles `wishlist` state with a spring pop; share has no handler).
- Default "All Details" tab is `spec` if specs exist, else `mfr`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back button | Header icon | `navigation.goBack()` |
| Header title | Text | Product name (1 line) |
| Cart button | Header icon + badge | → `Cart`; badge shows `cartCount` (99+ cap) |
| Main image | Image | Current gallery image (contain fit); leaf placeholder if none |
| Wishlist heart | Icon button (top-right) | Toggles local `wishlist` with spring animation (no API) |
| Share button | Icon button (top-right) | Visual only — no onPress handler |
| Discount badge | Badge (top-left) | "{n}% OFF" when MRP > price |
| Rating pill | Pill (image bottom bar) | Rating + star + review count |
| Thumbnail strip | Row of tappable thumbs | Switches `imgIdx` (only when >1 image) |
| Brand label | Text | Uppercase brand/category |
| Product name (+ Hindi) | Text | `product.name` and optional `product.nameHi` |
| Hot deal badge | Badge | Shown when discount ≥ 20% |
| Stock tag | Badge | "In Stock" / "Only N left" (≤5) / "Out of Stock" |
| Inline rating chip | Chip | Rating + ratings count |
| Price block | Text | Price, MRP (strikethrough), "↓{discount}%", "You save ₹" pill |
| Quantity selector | Pill with −/+ | Adjusts `quantity` (min 1, max = stock); shows live total |
| Delivery & address card | Coming-soon card | Static "coming soon" placeholder |
| Seller card | Info card | "Sold by" + "FarmEasy Direct" (static) |
| Returns & policies card | Coming-soon card | Static "coming soon" placeholder |
| Similar Products | Horizontal `FlatList` | `SimilarCard`s → push another ProductDetail; "View All" link (no handler) |
| Collapsible: Highlights | Accordion | Bullet list, only if `product.highlights` present (default open) |
| Collapsible: All Details | Accordion w/ tabs | Specifications / Manufacturer tab tables (only if specs or manufacturer present) |
| Collapsible: Description | Accordion | `product.description` text, if present |
| Add to Cart button | Bottom-bar button | `handleAddToCart` → POST cart + success Alert; disabled if out of stock/adding (spinner) |
| Buy Now button | Bottom-bar button | `handleBuyNow` → POST cart then → `Cart`; shows price; disabled if out of stock/adding |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `GET /agristore/products?categoryId={id}&limit=10` — similar products.
  - `POST /agristore/cart` `{ productId, quantity }` — add to cart.
- **Backend route/service:** `backend/src/routes/agristore.routes.js` (`GET /products` line 113, `POST /cart` line 199).
- **State / context:** `useCart()` (`count`, `refresh`); `useLanguage()` (`t`); local `useState` (quantity, wishlist, imgIdx, adding, similar, activeTab); `useSafeAreaInsets`.
- **Local / static data:** Seller name/"FarmEasy Direct", coming-soon cards, `mfrRows` (Quality Check "CropSetu Verified", support hours), `baseSpecRows` are all static/derived; Product Code derived as `FE-{id slice}`.

## Languages / i18n
i18n via `t`. Keys include `product.error`, `product.cartError`, `product.addedToCart`, `product.hotDeal`, `product.outOfStock`, `product.quantity`, `product.soldBy`, `product.farmEasyDirect`, `product.similarProducts`, `product.highlightsTitle`, `product.allDetailsTitle`, `product.specifications`, `product.manufacturer`, `product.productDescription`, `product.buyAt` (interpolates price), `addToCart`, `store.viewAll`. Optional `product.nameHi` rendered as a secondary Hindi name.

## Notes, edge cases & gaps
- **Out of stock:** both bottom buttons are disabled and dimmed; `+` is capped at stock.
- **Wishlist & share are non-functional** (local state / no handler).
- "Delivery & address", "Returns & policies", and "View All" on similar products are placeholders.
- Add-to-cart errors show the server `error.message` via Alert; the cart action requires auth (`POST /agristore/cart` is `authenticate`-guarded on the backend).
- Similar-products fetch failures are swallowed (`.catch(() => {})`), simply hiding that section.
