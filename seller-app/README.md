# CropSetu Seller

Standalone Expo app for **sellers**: list products, manage orders, complete KYC, and
answer crop reports farmers forward from the buyer app.

Split out of `frontend/` — the buyer app no longer contains any seller screens.
Both apps share one backend, one account system (the same OTP login), and the
`../shared` package.

| | |
| --- | --- |
| Bundle id | `com.cropsetu.seller` |
| Scheme | `cropsetu-seller://` |
| Buyer app | `../frontend` (`com.cropsetu.app`) |
| Shared code | `../shared` (see its README) |

## Setup

```bash
npm install
cp .env.example .env      # point EXPO_PUBLIC_API_BASE_URL at your backend
npm start
```

The buyer app's Metro usually holds port 8081, so run this one on another port:

```bash
npx expo start --port 8082
```

## Screens

| Route | File | What it does |
| --- | --- | --- |
| `SellerDashboard` | `src/screens/DashboardScreen.js` | stats, recent orders, unread report count |
| `SellerMyProducts` | `src/screens/MyProductsScreen.js` | list / edit / delete / toggle stock |
| `AddProduct` | `src/screens/AddProductScreen.js` | create + edit listing, image upload |
| `SellerOrders` | `src/screens/OrdersScreen.js` | orders, status transitions |
| `SellerProfile` | `src/screens/SellerProfileScreen.js` | account + shop details |
| `BusinessProfile` | `src/screens/BusinessProfileScreen.js` | GST / PAN / Aadhaar / bank KYC |
| `ReceivedReports` | `src/screens/ReceivedReportsScreen.js` | crop reports farmers shared |
| `ReceivedReportDetail` | `src/screens/ReceivedReportDetailScreen.js` | one report + reply with products |

## Entry routing

`src/navigation/SellerNavigator.js` picks the landing screen from the account:

- **Not a seller yet** → `BusinessProfile`. Saving it makes the backend flip the
  role `FARMER → SELLER` and return fresh tokens; the navigator then remounts at
  the dashboard.
- **Already a seller** → `SellerDashboard`.

`isSellerAccount()` lives in `../shared/utils/roles.js` so the buyer app's profile
badge and this gate can never disagree.

## API

Every endpoint is on the shared backend; no seller-only service exists.

```
GET    /agristore/seller/stats
GET    /agristore/seller/products            POST /agristore/seller/products
PUT    /agristore/seller/products/:id        DELETE /agristore/seller/products/:id
GET    /agristore/seller/orders              PUT  /agristore/seller/orders/:id/status
GET    /crop-reports/seller/inbox            GET  /crop-reports/seller/inbox/:shareId
POST   /crop-reports/seller/inbox/:shareId/reply
GET    /agristore/categories
POST   /upload/image
PUT    /users/me
```

## Known limitation: EAS Build and `../shared`

`eas build` uploads the directory it runs in, so a cloud build from here would not
include `../shared` and would fail to resolve `@cropsetu/shared/*`. Local runs
(`npm start`, `expo run:android`) are unaffected — Metro reads `../shared` from disk.

To fix before the first cloud build, make the repo an npm workspace so EAS uploads
the whole tree. Add a root `package.json`:

```json
{
  "name": "cropsetu",
  "private": true,
  "workspaces": ["frontend", "seller-app", "shared"]
}
```

then reinstall in both apps (`rm -rf node_modules && npm install` from the root) and
add `nodeModulesPaths` entries for the hoisted root `node_modules` in both
`metro.config.js` files. Do this when no Metro instance is running — it moves
dependencies out of each app's own `node_modules`.
