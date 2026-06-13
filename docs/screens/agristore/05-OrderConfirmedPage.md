# Order Confirmed

> **Tab:** Shop · **Stack:** `AgriStoreNavigator` (AgriStack) · **Route name:** `OrderConfirmed` · **File:** `frontend/src/screens/AgriStore/OrderConfirmedScreen.js`

## Purpose
Success / confirmation screen shown after an order is placed. It plays a celebratory animation (spring checkmark, breathing circles, success haptic + sound) and summarizes the order — id, item count, total paid, payment method, estimated delivery window and the list of ordered items — then offers a "Continue Shopping" return to the store.

## Where it sits / how you reach it
- **Reached from:** `CheckoutScreen.placeOrder()` via `navigation.replace('OrderConfirmed', { order, paymentMethod, grandTotal })` (replace, so back doesn't return to checkout).
- **Navigates to:** `AgriStoreHome` — the "Continue Shopping" button (`navigation.navigate('AgriStoreHome')`). There is no back/header button on this screen.
- **Route params in:** `{ order, paymentMethod, grandTotal }` — `order` (with `id`, `items[]`, `totalAmount`), `paymentMethod` (`cod`/`upi`/`card`), and `grandTotal`.

## How it works
- On mount: fires `Haptics.success()` and `SoundEffects.success()`, then runs a choreographed sequence of `Animated` timelines — spring-pop checkmark, fade-in title, sub text, content card slide-up, delivery card, button, plus two looping "breathing" decorative circles.
- Derives display data: `shortId` (first 8 chars of `order.id`, uppercased), `items = order.items`, `totalAmt = grandTotal || order.totalAmount`, and an estimated delivery window of **today+2 to today+4** days (formatted `en-IN`).
- Payment is mapped to a label + badge color via `PAY_LABEL` / `PAY_BADGE_BG` / `PAY_BADGE_TXT` keyed by `paymentMethod`.
- Each ordered item renders via `OrderItemRow` (staggered entrance), reading `product.name`, `product.images[0]`, `unitPrice`/`product.price`, `quantity`, `totalPrice`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Green gradient hero | LinearGradient header | Success banner with breathing decorative circles |
| Spring checkmark | Animated icon | Pops in on mount |
| Hero title / subtitle | Text | "Order confirmed" + Marathi confirmation line |
| Order details card | Card | Header with `#{shortId}` order-id badge |
| Detail rows | Rows | Items count, Total Paid (green), Payment (badge), Est. Delivery |
| Payment badge | Badge | Colored label per payment method |
| Items ordered list | Rows (`OrderItemRow`) | Image, name, "Qty: n × ₹price", line total — staggered animation |
| Estimated delivery card | Card | Car icon + delivery window + clock icon |
| Continue Shopping | Gradient button | → `AgriStoreHome` |
| Thank-you note | Text | "Thank you for shopping with CropSetu!" |

## Services, APIs & data
- **API endpoints:** none — this screen makes no API calls; it renders entirely from `route.params`.
- **Backend route/service:** n/a (the order was created by `POST /agristore/orders` on the previous screen, `backend/src/routes/agristore.routes.js`).
- **State / context:** `useLanguage()` (`t`); `useSafeAreaInsets`; many `useRef` `Animated.Value`s for the entrance choreography; no `useState`.
- **Local / static data:** `PAY_LABEL` / `PAY_BADGE_BG` / `PAY_BADGE_TXT` maps; estimated delivery computed locally (today+2 → today+4). Uses `Haptics` and `SoundEffects` utils.

## Languages / i18n
i18n via `t`. Keys include `orderConfirmed.heroTitle`, `orderConfirmed.orderDetails`, `orderConfirmed.itemsOrdered`, `orderConfirmed.estDelivery`, `orderConfirmed.continueShopping`. Several strings are hardcoded: the Marathi hero subtitle ("तुमचा ऑर्डर यशस्वीरित्या पुष्टी झाला"), detail-row labels ("Items", "Total Paid", "Payment", "Est. Delivery"), payment labels, and "Thank you for shopping with CropSetu!".

## Notes, edge cases & gaps
- **No data fetch / no error states** — purely presentational; guards with `route.params || {}` and `order?.…` so missing params degrade gracefully (e.g. `shortId` falls back to `--------`, empty items list hides that section).
- **Estimated delivery is a static client-side guess** (today+2 to +4 days), not a real shipping estimate.
- No header/back navigation — reached via `replace`, exits only through "Continue Shopping".
- Plays sound + haptic on mount; `SoundEffects.cleanup()` is handled globally on app background in `AppNavigator`.
