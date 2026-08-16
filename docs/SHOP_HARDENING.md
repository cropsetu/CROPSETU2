# Shop (AgriStore) production hardening

Deployment, configuration and rollback notes for the Shop hardening pass.

Everything here is **additive**. No column was dropped, no endpoint was removed,
and every existing request shape still works — an un-upgraded app build keeps
functioning against the new backend.

---

## 1. Database migration

The project is push-based (`prisma/migrations/` is not used):

```bash
cd backend
npx prisma generate
npx prisma db push          # production: npm run start:prod does this
```

### What it adds

**New tables** — all empty on arrival, none required by an existing code path:

| Table | Purpose |
| --- | --- |
| `subcategories` | Backend-managed subcategory master data |
| `payment_intents` | A payment recorded *before* the gateway is called |
| `payment_webhook_events` | Webhook idempotency ledger |
| `seller_licences` | Per-class regulatory licence, admin-verified |
| `product_compliance` | Approved-label data + review state, one per product |
| `product_batches` | Batch / expiry register per seller offer |
| `product_recalls` | Recall records |
| `sale_blocks` | Administrative stop-sale by product/seller/category/batch/state/district |
| `seller_service_areas` | PIN-code serviceability + delivery ETA |
| `stock_reservations` | Units held for one buyer while their payment is in flight |

**New columns on existing tables** — every one nullable or defaulted:

- `categories`: `attributeSchema`, `isRegulated`
- `products`: `taxRatePct`, `hsnCode`, `shippingClass` (default `PARCEL`),
  `weightKg`, `subcategoryId`
- `orders`: `subtotal`, `deliveryFee`, `taxAmount`, `discountAmount`,
  `couponCode`, `pricingSnapshot`, `deliveryPincode`, `promisedEtaDays`
- `order_items`: `productName`, `productNameMr`, `productImage`, `brand`,
  `unit`, `packSize`, `sellerName`, `taxRatePct`, `taxAmount`, `batchNumber`,
  `batchExpiry`, `labelVersion`, `complianceSnapshot`, `returnWindowDays`,
  `returnEligible`

**New indexes** — see §6 for the query each one serves.

### Risk

Low. `db push` on these changes is `ADD COLUMN` / `CREATE TABLE` / `CREATE INDEX`
only. The one caveat is index creation time on a large `products` /
`order_items` table; on a hot database prefer creating those two concurrently
first (see §6) and then running `db push`, which will find them already present.

---

## 2. Environment variables

One new variable:

```
RAZORPAY_WEBHOOK_SECRET=<from the Razorpay dashboard, Webhooks section>
```

**It fails closed.** With the variable unset, every incoming webhook is
rejected with a 400 and an error log. That is deliberate — a webhook can mark
money as received with no authenticated user behind it, so an unconfigured
secret must never be read as "trust everything". Payment reconciliation still
works without it (it polls the gateway directly), so an unset secret degrades
recovery latency rather than breaking it.

Register the endpoint in the Razorpay dashboard:

```
URL:    https://<api-host>/api/v1/shop-webhooks/razorpay
Events: payment.captured, payment.failed, order.paid,
        refund.created, refund.processed
```

---

## 3. Runtime settings (no redeploy needed)

All new behaviour is driven by `AppSetting` rows editable from
**Admin → Settings**. Defaults are chosen so the deploy is behaviourally
minimal.

### Shop

| Key | Default | Note |
| --- | --- | --- |
| `shop.reservation.enabled` | `true` | Hold stock while the buyer pays. **Turning this off reinstates the race** where two buyers can both pay for the last unit. |
| `shop.reservation.ttlMinutes` | `15` | How long units stay held. Too short and a farmer on a slow connection loses the item mid-payment; too long and abandoned checkouts keep stock off the shelf. |
| `shop.delivery.feePerShipment` | `49` | **Matches what the app already displayed.** Set to `0` to keep the pre-change server behaviour (no delivery charged). |
| `shop.delivery.freeAboveSubtotal` | `999` | Matches the app's previous hard-coded threshold |
| `shop.delivery.heavyFee` | `250` | Only applies to `shippingClass = HEAVY` products; nothing is HEAVY until set |
| `shop.delivery.freightQuoteRequired` | `true` | Only applies to `shippingClass = FREIGHT`; nothing is FREIGHT until set |
| `shop.delivery.codFee` | `0` | Off |
| `shop.tax.enabled` | `false` | **Off.** Turn on only after product tax slabs are set |
| `shop.tax.pricesIncludeTax` | `true` | Indian retail convention |
| `shop.tax.defaultRatePct` | `0` | Conservative — set slabs per product |
| `shop.serviceability.strict` | `false` | PIN check is advisory until sellers configure areas |
| `shop.returns.defaultWindowDays` | `7` | Frozen onto each order item |
| `shop.returns.nonReturnableCategoryIds` | `[]` | Add chemical / seed category ids here |

### Compliance

| Key | Default |
| --- | --- |
| `compliance.enabled` | `true` |
| `compliance.requireLicenceKinds` | `["PESTICIDE","INSECTICIDE","FUNGICIDE","HERBICIDE","PLANT_GROWTH_REGULATOR"]` |
| `compliance.requireApprovalBeforePublish` | `true` |
| `compliance.blockExpiredSale` | `true` |
| `compliance.minShelfLifeDaysDefault` | `30` |
| `compliance.expiryAlertDays` | `45` |

**The compliance gate only fires on products that have a `product_compliance`
row with `regulatedKind != NONE`.** That table is empty after the migration, so
on day one the gate is a no-op for the entire existing catalogue. Enforcement
begins per product, as each one is classified.

---

## 4. The one intentional behaviour change

`Order.totalAmount` now means **the amount payable** (goods + delivery + tax),
where it previously meant the goods subtotal.

This is the fix, not a side effect. The app displayed
`subtotal + ₹49` on the cart screen, posted the subtotal to the server, and the
order recorded the subtotal — so the farmer approved one number and was charged
another, in both directions depending on the path. Online payments raised the
Razorpay order for the subtotal too, meaning the delivery fee was displayed and
never collected.

- `Order.subtotal` now holds the old meaning of `totalAmount`.
- Reporting or exports reading `totalAmount` as "goods" should switch to
  `subtotal`.
- To keep the *server* behaviour identical to before, set
  `shop.delivery.feePerShipment = 0`. The app will then show and charge the same
  number it records.

---

## 5. Rollback

### Code

`git revert` the merge. Safe at any time — no destructive migration accompanies
it. New tables and columns are simply left in place and unread. The only
consequence is that orders created *while the change was live* have a
`totalAmount` that includes delivery; their `subtotal` column still carries the
goods figure, so nothing is lost.

### Config-only rollback (preferred — no deploy)

Most of the new behaviour can be switched off from Admin → Settings:

| To undo | Set |
| --- | --- |
| Delivery charging | `shop.delivery.feePerShipment = 0`, `shop.delivery.freeAboveSubtotal = 0` |
| Tax | `shop.tax.enabled = false` |
| Compliance enforcement | `compliance.enabled = false` (still records, stops blocking) |
| PIN blocking | `shop.serviceability.strict = false` |
| Machinery freight gate | `shop.delivery.freightQuoteRequired = false` |
| Stock holds during payment | `shop.reservation.enabled = false` |

**Before disabling reservations,** release anything currently held — otherwise
those units stay off the shelf until the sweeper runs (which continues to work
with the setting off, so this is a matter of minutes, not a leak):

```sql
SELECT count(*) FROM stock_reservations WHERE status = 'HELD';
```

### Schema rollback

Only if genuinely required, and only after the code is reverted:

```sql
-- Destructive. Takes compliance history, batches and payment intents with it.
DROP TABLE IF EXISTS payment_webhook_events, payment_intents,
  product_recalls, product_batches, product_compliance,
  seller_licences, seller_service_areas, sale_blocks, subcategories CASCADE;

ALTER TABLE orders
  DROP COLUMN IF EXISTS subtotal, DROP COLUMN IF EXISTS "deliveryFee",
  DROP COLUMN IF EXISTS "taxAmount", DROP COLUMN IF EXISTS "discountAmount",
  DROP COLUMN IF EXISTS "couponCode", DROP COLUMN IF EXISTS "pricingSnapshot",
  DROP COLUMN IF EXISTS "deliveryPincode", DROP COLUMN IF EXISTS "promisedEtaDays";
```

Dropping `order_items` snapshot columns is **not** recommended: they are the only
record of what a past order actually contained, and of which batch shipped.

---

## 6. Index notes

Two indexes are on large, hot tables. On a production database with meaningful
volume, create them **concurrently before** running `db push` so the push finds
them already present and skips them:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_items_productId_status_idx"
  ON order_items ("productId", status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_items_batchNumber_idx"
  ON order_items ("batchNumber");
```

Queries they serve:

| Index | Query |
| --- | --- |
| `order_items(productId, status)` | Verified-purchase check on review submit — previously a sequential scan |
| `order_items(batchNumber)` | Recall fan-out: "who bought batch X" |
| `products(status, createdAt DESC, id DESC)` | Storefront "Latest" sort, keyset-safe |
| `products(status, rating DESC, id DESC)` | Storefront "Top rated" sort |
| `products(subcategoryId)` | Subcategory filter |
| `seller_service_areas(pincode, isActive)` / `(pincodePrefix, isActive)` | The PIN-code probe |
| `product_batches(listingId, status, expiryDate)` | FEFO batch allocation |
| `product_batches(status, expiryDate)` | Nightly expiry sweep |
| `payment_intents(status, createdAt)` | Reconciliation sweep |
| `stock_reservations(providerOrderId, status)` | Confirm-time lookup: "what is held for this payment" |
| `stock_reservations(status, expiresAt)` | The 2-minute expiry sweep |

---

## 7. Scheduled jobs added

Both are leader-locked, so only one instance runs each:

| Schedule | Job | What happens if it does not run |
| --- | --- | --- |
| `*/2 * * * *` | Stock-reservation expiry sweep | **Abandoned checkouts keep stock off the shelf indefinitely.** An abandoned payment sheet produces no webhook and no client call, so this is the only path that recovers those units. The most operationally important of the four. |
| `*/5 * * * *` | Shop health alerting | No `[ALERT][Shop]` markers. Per-process in-memory counters, so this one is deliberately NOT leader-locked — every instance evaluates its own. |
| `*/10 * * * *` | Payment reconciliation | Interrupted payments stay unresolved; buyers see "confirming" indefinitely. No data loss — the intent rows persist. |
| `10 3 * * *` | Batch expiry sweep | Expired batches are not marked `EXPIRED`. The sale gate still refuses them (it compares dates directly), so this is a queue-hygiene job, not a safety-critical one. |

---

## 7a. Enabling online payment

The app asks the server what it can collect with, via
`GET /api/v1/agristore/payment-config`, and only renders those methods. With no
Razorpay keys it returns `{ onlineEnabled: false, methods: ["cod"] }` and the
checkout screen shows **Cash on Delivery only**, with a line explaining why.

That is deliberate. Before this, the app rendered UPI and Card unconditionally
and posted the choice to `POST /orders`, which creates an order and **never asks
for money** — the farmer saw "Order Placed!" with a UPI badge and was charged
nothing.

To turn online payment on:

```
RAZORPAY_KEY_ID=rzp_live_xxxxxxxx          # publishable — reaches the client
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx       # NEVER leaves the server
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxx   # see §2
```

The endpoint re-reads these per request, so no code change is needed — restart
the API and the UPI/Card tiles appear. `keyId` is Razorpay's **publishable** key
and is meant to sit in a client; the secret is only ever used server-side to
verify the payment signature, so a tampered client cannot manufacture a paid
order.

Checkout runs Razorpay Standard Checkout inside a WebView
(`frontend/src/screens/AgriStore/RazorpayCheckout.js`) — `react-native-webview`
was already a dependency, so this needs no new native module and no new build.

**Verify after enabling:**

```bash
curl -H "Authorization: Bearer $TOKEN" "$API/agristore/payment-config"
# expect: {"onlineEnabled":true,"methods":["cod","upi","card"],"keyId":"rzp_..."}
```

Then place one small live order and confirm: a `payment_intents` row reaches
`ORDER_CREATED`, the order has `paymentStatus: "paid"` and a `paymentRef`, and
the `stock_reservations` rows for it are `CONSUMED`.

---

## 8. Post-deploy checks

```bash
# 1. Quote endpoint returns a full breakdown
curl -H "Authorization: Bearer $TOKEN" \
  "$API/agristore/cart/quote" | jq '{subtotal,deliveryFee,taxAmount,total,issues}'

# 2. Webhook rejects an unsigned payload (expect 400)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{"event":"payment.captured"}' \
  "$API/shop-webhooks/razorpay"

# 3. Storefront list is card-shaped (should NOT contain `description`)
curl -s "$API/agristore/products?limit=1" | jq '.data[0] | keys'

# 4. Reconciliation queue — should be empty
#    Admin → Payments → Intents, filter "orphaned"

# 5. Shop metrics are being collected (route TEMPLATES only, never ids)
curl -s "$API/../readyz" | jq '.shop.latency, .shop.rates'

# 6. Held stock should trend to zero between checkouts
psql -c "SELECT status, count(*) FROM stock_reservations GROUP BY status;"
```

Watch for 24 h after deploy:

- `[ShopPayment] RECONCILE: captured payment with no order` — money held against
  nothing. Should be zero; each occurrence needs a manual refund.
- `[Webhook] rejected: bad or missing signature` — a burst means the secret is
  wrong or unset.
- `[Shop] failed to record payment intent` — an unrecorded intent is an
  unreconcilable payment.
- `[Reservation] release failed` — held stock that did not go back. The sweeper
  retries it, but a repeated marker means units are stuck off the shelf.
- `[ALERT][Shop] checkout failure rate above threshold` / `product list p95
  latency above threshold` — the two windowed health alerts.

### A note on held stock

`seller_listings.stockQty` is net of holds — it means "available to sell right
now", exactly as it did before. That is what keeps every read path (buy box,
product list, cart validation) unchanged. If you are reconciling inventory by
hand, the seller's physical count is `stockQty` **plus** their live `HELD`
reservations:

```sql
SELECT l.id, l."stockQty" AS available,
       COALESCE(SUM(r.quantity) FILTER (WHERE r.status = 'HELD'), 0) AS held
FROM seller_listings l
LEFT JOIN stock_reservations r ON r."listingId" = l.id
GROUP BY l.id;
```
