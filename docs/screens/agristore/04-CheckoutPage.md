# Checkout

> **Tab:** Shop · **Stack:** `AgriStoreNavigator` (AgriStack) · **Route name:** `Checkout` · **File:** `frontend/src/screens/AgriStore/CheckoutScreen.js`

## Purpose
A 3-step ordering flow — **Address → Order Summary → Payment** — driven by a step header. The farmer selects/adds a delivery address, reviews the items and price breakdown, picks a payment method, adds an optional note, and places the order.

## Where it sits / how you reach it
- **Reached from:** `CartScreen` "Proceed to Checkout" button (`navigation.navigate('Checkout', { total, delivery, grandTotal, itemCount })`).
- **Navigates to:**
  - `OrderConfirmed` — on successful order placement via `navigation.replace('OrderConfirmed', { order, paymentMethod, grandTotal })`.
  - Back — the step header back arrow (`handleBack`) goes to the previous step, or `navigation.goBack()` from step 1.
- **Route params in:** `{ total, delivery, grandTotal }` (defaulting to 0). `itemCount` is passed by Cart but not consumed here.

## How it works
- On mount: `api.get('/addresses')` loads saved addresses (auto-selects the default or first); `api.get('/agristore/cart')` loads `cartItems` for the summary.
- **Step 1 (Address):** lists saved `AddrCard`s (select/delete), a dashed "Add new address" card that reveals an inline form. `saveAddress()` validates required fields, phone (`isValidPhone`/`normalizePhone`) and pincode (`isValidPincode`), then `POST /addresses` and selects the new address.
- **Step 2 (Summary):** "Deliver to" card (with Change → address sheet), order-items list, and a price-details card (items, delivery, total payable).
- **Step 3 (Payment):** address mini-card, payment-method radio list (`cod`/`upi`/`card`), order-notes textarea, total-payable card.
- `handleContinue` advances steps; on step 1 it saves the form if open (else requires a selected address). On step 3 it calls `placeOrder()`.
- **Place order** (`placeOrder`): requires `selectedAddr`; computes `expectedTotal` from `cartItems` (only when the cart loaded) and `POST /agristore/orders` `{ deliveryAddressId, paymentMethod, note?, expectedTotal }`, then `navigation.replace('OrderConfirmed', …)`. Errors → `Alert`. `placing` shows a spinner.
- An address-picker bottom-sheet `Modal` (`addrSheet`) lets the user change address from steps 2/3 (and jump to the add-form on step 1).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Step header | Stepper (3 dots + connectors) | Animated Address/Summary/Payment indicator; back arrow = `handleBack` |
| Address card | Selectable card | Type badge, default badge, name, address line, phone; tap to select; trash to delete |
| Add new address card | Dashed card | Reveals inline address form (`setShowForm(true)`) |
| Type chips | Segmented chips | HOME / OFFICE / OTHER selector in the form |
| Form inputs (`FInput`) | Labelled TextInputs | Full name, mobile (phone-pad), flat, street, city, state, pincode (number-pad), landmark; chained focus |
| Close form (×) | Icon button | Hides inline form |
| Deliver-to card | Info card | Selected address summary + "Change" → address sheet (step 2) |
| Order items list | Rows | Image, name, "qty × ₹price", line total per cart item |
| Price details | Rows | Items subtotal, delivery (FREE when 0), bold total payable |
| Address mini card | Card | Compact address + "Change" → address sheet (step 3) |
| Payment options (`PayOption`) | Radio list | Cash on Delivery / UPI / Card — animated radio dot, icon, description |
| Order notes | Multiline TextInput | Optional note (`note` state) |
| Total payable card | Highlight card | Grand total |
| Bottom action bar | Sticky bar | Context-aware: delivering-to (step1) / total (steps 2-3) + CTA |
| Continue / Save & Continue / Proceed to Payment / Place Order | Primary button | `handleContinue`; label changes per step; spinner while placing/saving |
| Address picker sheet | Bottom-sheet Modal | Choose address, or "Add new address" (jumps to step-1 form) |

## Services, APIs & data
- **API endpoints (via `services/api.js`):**
  - `GET /addresses` — saved addresses; `POST /addresses` — create; `DELETE /addresses/{id}` — delete.
  - `GET /agristore/cart` — items for the summary.
  - `POST /agristore/orders` `{ deliveryAddressId, paymentMethod, note?, expectedTotal }` — place order.
- **Backend route/service:** `backend/src/routes/addresses.routes.js` (address CRUD); `backend/src/routes/agristore.routes.js` (`GET /cart` line 190, `POST /orders` line 265). The server recomputes `totalAmount = sum(price × qty)` and rejects on mismatch with `expectedTotal` (delivery is not part of the server total).
- **State / context:** `useLanguage()` (`t`); local `useState` (step, addresses, selectedAddr, showForm, savingAddr, payMethod, placing, cartItems, note, addrSheet, form); validators from `utils/validators`; `useSafeAreaInsets`.
- **Local / static data:** `TYPE_ICON`/`TYPE_COLOR` maps; `PAY_OPTS` (cod/upi/card) defined inline; `addrLine()` helper.

## Languages / i18n
i18n via `t`. Keys include `checkout.deliveryAddress`, `checkout.addNewAddress`, `checkout.newAddress`, `checkout.fullName`, `checkout.mobileNumber`, `checkout.flat`, `checkout.street`, `checkout.city`, `checkout.state`, `checkout.pincode`, `checkout.landmark`, `checkout.required`, `checkout.fillAllFields`, `checkout.invalidPhone(Msg)`, `checkout.invalidPincode(Msg)`, `checkout.deliverTo`, `checkout.change`, `checkout.priceDetails`, `checkout.delivery`, `checkout.paymentMethod`, `checkout.orderNotes`, `checkout.notesPlaceholder`, `checkout.selectAddress(Msg)`, `checkout.orderFailed(Msg)`, `checkout.deleteAddress(Msg/Error)`, `checkout.saveAddressError`, `cart.totalPayable`, `product.defaultBadge`, `free`. Some Marathi subtitles and step labels ("Address"/"Summary"/"Payment", CTA labels, payment `nameHi`) are hardcoded.

## Notes, edge cases & gaps
- **Validation:** required fields + phone + pincode checks before saving an address; placing an order requires a selected address.
- **Payment is method-selection only** — no real gateway is invoked here; the order is created server-side with the chosen `paymentMethod` (COD/UPI/Card all just POST the order). Payment processing lives in `backend/src/services/payment.service.js` but is not called from this screen.
- `expectedTotal` is omitted when the cart fetch fails, so a failed fetch can't force a ₹0 total.
- `navigation.replace` is used for confirmation so the back button doesn't return to checkout.
- Delete address uses an `Alert` confirm; save errors and order-failure errors surface server `error.message`.
