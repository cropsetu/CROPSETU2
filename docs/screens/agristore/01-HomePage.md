# AgriStore Home (Shop)

> **Tab:** Shop · **Stack:** `AgriStoreNavigator` (AgriStack) · **Route name:** `AgriStoreHome` · **File:** `frontend/src/screens/AgriStore/AgriStoreHome.js`

## Purpose
The landing screen of the Shop tab — an agri-input storefront where farmers browse, search and filter products (seeds, fertilizers, tools, etc.). It shows a search bar, category filters, a "Best Sellers" carousel and a paginated "All Products" grid, and is the entry point into the buy flow (ProductDetail → Cart → Checkout).

## Where it sits / how you reach it
- **Reached from:** Tapping the **Shop** bottom tab (`AgriStore` tab → first screen of `AgriStoreNavigator`). It is the stack's initial route. Also returned to via the "Continue Shopping" button on `OrderConfirmedScreen` (`navigation.navigate('AgriStoreHome')`).
- **Navigates to:**
  - `ProductDetail` (route param `{ product: item }`) — tapping any product card, best-seller card, the card's circular add/"Add to Cart" button (`handleProductPress`).
  - `Cart` — the cart icon in the header (`navigation.navigate('Cart')`).
- **Route params in:** none.

## How it works
- On mount, `useEffect` calls `api.get('/agristore/categories')` and stores the result in `categories` (empty array on failure — no mock fallback).
- A second `useEffect` debounces product loading: it calls `fetchProducts()` whenever `selectedCategory`, `selectedSubcategory`, or `searchQuery` changes (400 ms debounce when a search query is present, immediate otherwise). `fetchProducts` calls `api.get('/agristore/products', { params })` with `{ limit: 40, category?, subcategory?, search? }`.
- `bestSellers` = first 8 products of the loaded list. Loading shows 4 shimmer `Skeleton` cards; an empty result shows the "coming soon" empty state.
- `useFocusEffect` re-runs `refreshCart()` from `CartContext` every time the screen regains focus so the header cart badge stays in sync.
- A `Keyboard` `keyboardDidHide` listener clears the search focus ring (Android back-press fix).
- Left **category drawer** (`CategoryDrawer`, RN `Modal` + spring slide) and a **language bottom sheet** (`Modal` + animated `translateY`) are managed with `drawerOpen` / `langPickerOpen` state. Selecting a language calls `setLanguage(code)` from `LanguageContext`.
- The header collapses on scroll via the `useScrollHeader` hook (`hideOnScroll`, `headerAnimatedStyle`, `showTopBtn`).
- Category labels are localized per-language by picking the matching `name<Lang>` field from the category object.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Hamburger button | Icon button (3 lines) | Opens the left category drawer (`setDrawerOpen(true)`) |
| CropSetu wordmark | Image | Brand logo (`assets/cropsetu-wordmark.png`) |
| Language button | Pill button (globe + lang code) | Opens animated language bottom sheet (`openLangPicker`) |
| Cart button | Icon button + badge | Navigates to `Cart`; red badge shows `cartCount` when > 0 |
| Search bar | TextInput + search icon | Filters products (debounced); green focus ring; clear (×) button when text present |
| Category pills | Horizontal scroll of pill tabs | "All" + one pill per API category (icon + color), selects category filter |
| Best Sellers section | Section header + "View All" link | Header title; "View All" resets to `__all__` category |
| Best Seller card | Horizontal card | Image, discount %, stock badge, name, rating, price, circular `+` add button → ProductDetail |
| All Products section | Section header | Title + `{products.length} items` result count |
| Product grid card | 2-column card | Image, heart (wishlist toggle, local state only), discount %, star rating overlay, stock badge, name, price/MRP, full-width "Add to Cart" button → ProductDetail |
| Skeleton cards | Shimmer placeholders | 4 cards shown while `loading` |
| Empty state | Illustration + text | Gradient storefront icon + "coming soon" copy when no products |
| Scroll-to-top button | FAB (`ScrollToTopButton`) | Appears on scroll; scrolls list to top |
| Category drawer | Left slide-in Modal | "All Products" row + flat list of categories; close (×) button |
| Stock badge | Badge | "Out of Stock" (stock 0) or "Only N left" (stock ≤ 5) |
| Language picker | Bottom-sheet Modal | Drag handle, title, scrollable list of languages with flag/native name + radio/check |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `GET /agristore/categories` — category list.
  - `GET /agristore/products` (params: `limit`, `category`, `subcategory`, `search`) — product list (used for grid, best sellers and search).
- **Backend route/service:** `backend/src/routes/agristore.routes.js` (`GET /categories` line 101, `GET /products` line 113).
- **State / context:** `useCart()` (CartContext) for `count`/`refresh`; `useLanguage()` for `t`, `language`, `setLanguage`, `LANGUAGES`; local `useState` for drawer/sheet/filters/search/products/categories/loading; `useScrollHeader` hook; `useSafeAreaInsets`.
- **Local / static data:** `ICON_MAP` (maps seed icon names → valid Ionicons); `ALL_ID = '__all__'` sentinel; color constants from `constants/colors` and `constants/khetTheme`.

## Languages / i18n
Fully i18n-driven via `useLanguage().t`. Keys include `store.browse`, `store.shopName`, `store.allProducts`, `store.shopBySection`, `store.searchPlaceholder`, `store.bestSellers`, `store.viewAll`, `store.comingSoonMsg`, `all`, `addToCart`, `appName`, `ai.comingSoon`, `profile.selectLanguage`. Category names are resolved per active language using `nameMr/nameHi/nameTa/nameKn/nameMl/nameTe/nameBn/nameGu/namePa` fields (9 Indian languages + English fallback).

## Notes, edge cases & gaps
- **Empty/loading:** shimmer skeletons while loading; "coming soon" empty state when the API returns no products (intentionally no mock fallback for categories or products).
- **Wishlist (heart) is local-only** — `liked` state lives in each `ProductCard`; no persistence or API call.
- **Stock badges** appear only when `stock` is non-null and ≤ 5 (or 0). Discount % is derived from `mrp` vs `price`.
- The grid uses `FlatList` with `scrollEnabled={false}` nested in a parent `ScrollView` (virtualization is effectively disabled for the grid).
- No offline/error toast — a failed fetch silently yields an empty list.
