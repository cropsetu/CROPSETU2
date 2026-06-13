# Seller Dashboard

> **Tab:** Account/Profile · **Stack:** SellerStack (inside ProfileStack → `SellerPortal`) · **Route name:** `SellerDashboard` · **File:** `frontend/src/screens/Seller/DashboardScreen.js`

## Purpose
The landing/home screen of the Seller Portal. It gives a seller an at-a-glance view of their shop performance (products, units sold, revenue), surfaces recent orders, a "Received Crop Reports" inbox CTA, and quick-action shortcuts to the rest of the portal. Used by users who have been promoted to the SELLER role.

## Where it sits / how you reach it
- **Reached from:** Account tab → `ProfileHome` (ProfileScreen) → "Seller Portal" entry calls `navigation.navigate('SellerPortal', ...)`. `SellerPortal` is the `SellerNavigator` whose first/initial screen is `SellerDashboard`. (If the user is not yet a seller the Profile entry deep-links straight to `BusinessProfile` instead.)
- **Navigates to:**
  - Avatar (top-right) and "Profile" quick action → `SellerProfile`
  - "Received Crop Reports" CTA card → `ReceivedReports`
  - "Add Product" quick action → `AddProduct`
  - "My Products" quick action → `SellerMyProducts`
  - "Orders" quick action → `SellerOrders`
  - "Back to CropSetu" button → `navigation.goBack()` (exits the portal)
- **Route params in:** none

## How it works
On mount it plays entrance animations (header fade/slide, looping live-dot pulse, a tap sound) and calls `load()`. `load()` fires three requests in parallel via `Promise.all`: seller stats, the 5 most recent orders, and the crop-report inbox unread count (the inbox call is wrapped in `.catch()` so a failure defaults `unread` to 0). Results populate `stats`, `recentOrders`, and `inboxUnread`. A full-screen `ActivityIndicator` shows while `loading` is true; errors are only `console.warn`-ed (no error UI). Pull-to-refresh re-runs `load()`. Stat values animate up from 0 via an `Animated.Value` counter (`Counter`), and revenue is prefixed with ₹. A time-of-day greeting (morning/afternoon/evening) and the user's initials are derived locally.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Gradient header | View (LinearGradient) | Brick→sienna→cta gradient with greeting, seller name, phone |
| Avatar circle | TouchableOpacity | Shows initials; navigates to `SellerProfile` |
| Live indicator | Animated dot + label | Pulsing mint dot with `dash.liveBanner` text |
| "Performance" section title | Text | Section header |
| Total Products stat card | Animated StatCard | Animated counter; sub-line shows active product count |
| Total Orders stat card | Animated StatCard | Units sold counter |
| Total Revenue stat card | Animated StatCard | ₹-prefixed revenue counter |
| Received Crop Reports CTA | TouchableOpacity card | Leaf icon; shows unread count copy; navigates to `ReceivedReports` |
| Unread badge | Badge | Shows unread count (or "99+") when > 0; else a chevron |
| "Quick Actions" section title | Text | Section header |
| Add Product quick action | Animated QuickAction button | Navigates to `AddProduct` |
| My Products quick action | Animated QuickAction button | Navigates to `SellerMyProducts` |
| Orders quick action | Animated QuickAction button | Navigates to `SellerOrders` |
| Profile quick action | Animated QuickAction button | Navigates to `SellerProfile` |
| "Recent Orders" section title | Text | Section header |
| Order cards | Animated OrderCard list | Per-order: product name, buyer name/phone, status badge, qty, ₹ amount |
| Status badge | Badge | Colored by order status (PENDING/CONFIRMED/SHIPPED/DELIVERED/CANCELLED) |
| Empty orders state | View | Receipt icon + "no orders yet" copy when `recentOrders` is empty |
| "Back to CropSetu" button | TouchableOpacity | Warning haptic + `navigation.goBack()` |
| Pull-to-refresh | RefreshControl | Re-runs `load()` |
| Loading spinner | ActivityIndicator | Full-screen while initial load runs |

## Services, APIs & data
- **API endpoints (all via `services/api`):**
  - `GET /agristore/seller/stats`
  - `GET /agristore/seller/orders?limit=5`
  - `GET /crop-reports/seller/inbox?limit=1` (for unread meta; failure-tolerant)
- **Backend route/service:** `backend/src/routes/agristore.routes.js` (seller stats/orders, backed by `sellerStats.service.js`); `backend/src/routes/cropReportShare.routes.js` (inbox unread)
- **State / context:** `useAuth` (`user`, `logout`), `useLanguage` (`t`); local `useState` for `stats`, `recentOrders`, `inboxUnread`, `loading`, `refreshing`; many `Animated.Value` refs
- **Local / static data:** `STATUS_COLOR` map; `COLORS`, `SHADOWS`, `RADIUS` from constants; `Haptics`, `SoundEffects` utils; wrapped in `AnimatedScreen`

## Languages / i18n
Heavy i18n via `useLanguage().t` under the `dash.*` namespace (e.g. `dash.goodMorning`, `dash.performance`, `dash.totalProducts`, `dash.recentOrders`, `dash.qty`) and `inbox.*` keys (`inbox.dashTitle`, `inbox.dashUnread`, `inbox.dashEmpty`) with inline default values. Numbers are formatted with `toLocaleString('en-IN')`. The "Back to CropSetu" label is a hardcoded English string (not translated).

## Notes, edge cases & gaps
- Inbox unread call is wrapped in `.catch()` so the dashboard still renders if crop-reports is unavailable.
- Other load errors are silently `console.warn`-ed — there is no visible error state, only the loading spinner then whatever data arrived.
- `stats` fields are null-coalesced to 0, so missing stats render as zero counters.
- "Back to CropSetu" uses `navigation.goBack()` (it does not call `logout`, despite the destructured `logout`).
- No socket/realtime updates; data only refreshes on mount and pull-to-refresh.
