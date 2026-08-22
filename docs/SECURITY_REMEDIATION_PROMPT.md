# Security Remediation — CROPSETU backend

You are fixing confirmed security defects in the CROPSETU monorepo. Every item below was verified by reading the code; file and line references are real. Fix them in the order given — the ordering is by blast radius, not by effort.

## Stack

Node 20 + Express 4 (ESM, `"type": "module"`) + Prisma 5 → PostgreSQL + Redis.
Backend `backend/`, buyer app `frontend/` (Expo), seller app `seller-app/` (Expo), admin `admin/` (React+Vite+TS), shared workspace `@cropsetu/shared`.
Routes mount at `${ENV.API_PREFIX}/agristore` (default `/api/v1/agristore`).

## Rules

- **Additive schema changes only.** Production applies schema with `prisma db push` (`package.json` → `start:prod`), not `migrate deploy`. A non-additive change hits the data-loss guard and applies *nothing* — this already caused `users.adminScopes` to go missing in prod and every login to 500 with P2022. Non-additive work goes in `backend/prisma/manual/*.sql` as hand-written drop-free SQL. **Never pass `--accept-data-loss`.**
- **Use the existing helpers.** `sendSuccess` / `sendError` / `sendNotFound` / `sendServerError` / `paginationMeta` from `src/utils/response.js` (they run `serializeDecimals`, so bypassing them leaks money as strings). `D()` from `src/utils/money.js` for all money. `authenticate` / `optionalAuth` / `requireRole` from `src/middleware/auth.js`. `auditAction()` from `src/services/audit.service.js`.
- **Add a regression test for every fix** in `backend/tests/backend/api/` or `backend/tests/backend/security/`, following `tests/fixtures/setup.js` (`getApp`, `createTestUser`, `authHeader`). Run with `node --experimental-vm-modules node_modules/jest/bin/jest.js --testTimeout=60000` — the default 5 s hook timeout kills every suite on cold app import.
- Do not refactor beyond the fix. Do not touch `@cropsetu/shared` styling.

---

## CRITICAL-1 — Payment signature verification is bypassable

`backend/src/services/payment.service.js:31`

```js
const isMock = !ENV.RAZORPAY_KEY_ID || !ENV.RAZORPAY_KEY_SECRET;
```

In mock mode `verifyPaymentSignature()` returns `true` unconditionally and `fetchPaymentOrder()` returns `{ id, mock: true }` with **no amount**. `POST /agristore/orders/confirm` guards its two anti-tamper bindings behind `if (!paymentOrder.mock)`, so in mock mode **both** the receipt binding (which blocks replaying another user's payment id) and the paid-amount binding (which blocks initiate-cheap-then-enlarge-cart) are skipped.

**Attack:** if production ever boots with either Razorpay variable unset or empty, any client can POST to `/orders/confirm` with an arbitrary `razorpayOrderId`, `razorpayPaymentId` and `razorpaySignature` and receive a fully paid order. Free checkout, unlimited, no account beyond a normal logged-in buyer.

**Fix:**
1. Make mock mode impossible in production. `src/config/env.js` already has a production config validator that throws `FATAL: production config invalid` — add Razorpay key presence to it so the process refuses to boot rather than silently degrading to "signature always valid".
2. Add a second independent guard in `payment.service.js`: if `NODE_ENV === 'production'` and `isMock`, throw on every call rather than returning a mock.
3. Tests: mock mode active under production config → boot fails; `verifyPaymentSignature` with a bad signature → false in every environment.

## CRITICAL-2 — Order confirmation is replayable

`backend/src/routes/agristore.routes.js` — `POST /orders/confirm`

The Razorpay payment id is persisted only inside the free-text `notes` field. There is no unique constraint and no dedupe check anywhere on the route.

**Attack:** complete one real payment and capture the signed triple. Re-fill the cart, replay the same triple. The HMAC still validates because it covers only `orderId|paymentId`, the receipt binding passes because it is the same user, and a second order is created against a single payment. Repeat indefinitely.

**Fix:** add `Order.razorpayPaymentId String? @unique` (additive, safe for `db push`) and write it as a real column. Treat the uniqueness violation as the idempotency signal and return the *existing* order rather than an error, so a legitimate client retry stays safe. Keep the value in `notes` as well if anything else parses it.

**Test:** the same signed triple submitted twice produces exactly one `Order` row, and the second call returns the first order.

## HIGH-1 — Stock can be driven negative

`backend/src/utils/stockBatch.js:37-42`

```sql
UPDATE products AS p SET stock = p.stock + v.delta
FROM (VALUES ...) AS v(id, delta) WHERE p.id = v.id
```

There is no `stock >= 0` guard. Correctness rests entirely on the in-transaction validation plus Serializable isolation — one missed validation path, or any future caller of this helper, silently oversells.

**Fix:** add `AND p.stock + v.delta >= 0` to the `WHERE`, and make the caller assert that the affected row count equals the number of deltas, aborting the transaction when it does not. This is defence in depth — keep the existing in-transaction validation.

**Test:** two concurrent checkouts of the last unit → exactly one succeeds, stock lands at 0, never negative.

## HIGH-2 — Cart add is a check-then-act race

`backend/src/routes/agristore.routes.js:210-232`

`POST /cart` reads the product, computes `totalAfter = (existing?.quantity || 0) + quantity`, checks it against `product.stock`, then upserts with an `increment`. The read and the write are not in a transaction.

**Attack:** fire N concurrent `POST /cart` requests. All N pass the stock check against the same stale read and every increment applies. The cart now holds more units than exist. Checkout's Serializable re-validation eventually catches it, so this is not oversell — but the buyer hits a hard failure at the payment step instead of a clear message at add time, and any code path that trusts cart quantity in between is exposed.

**Fix:** wrap the read and upsert in a transaction, or express the stock check as a conditional write. Return a 400 carrying the real available quantity.

## HIGH-3 — Reviews require no purchase

`backend/src/routes/agristore.routes.js` — `POST /products/:id/review`

`authenticate` only. No `requireRole`, no purchase verification, and `Review` has no `orderId`, so a purchase link is not even expressible in the schema. The preceding `product.findUnique` does not filter `isActive`.

**Attack:** any authenticated account rates any product 1–5. The route then recomputes `product.rating` and calls `bumpListingVersion(NS_PRODUCTS)` precisely because rating drives the storefront sort order. Ratings — and therefore search ranking — are directly manipulable by anyone with an account, including competitors, and including against soft-deleted products.

**Fix:** add `Review.orderItemId String?` (additive), require a `DELIVERED` `OrderItem` for that user and product before accepting the review, and filter `isActive`. If the catalog/offer split project is also in flight, coordinate the `Review` unique-key change with it.

## MEDIUM-1 — Upload accepts arbitrary bytes as an image

`backend/src/routes/upload.routes.js:22-24`

```js
if (base64.startsWith('data:') && !base64.startsWith('data:image/')) {
  return sendError(res, 'Only image files are allowed', 400);
}
```

The check reads the **prefix string only**, never the decoded magic bytes, and is skipped entirely when the payload has no `data:` prefix — which the code explicitly anticipates, since it strips the prefix conditionally on the next lines.

**Attack:** send `data:image/png;base64,<any bytes>`, or raw base64 with no prefix at all. Content type is entirely attacker-declared.

**Fix:** sniff the decoded buffer's magic bytes and allow only JPEG, PNG and WebP. Reject SVG explicitly — it is a stored-XSS vector if the asset is ever served inline. Verify independently whether Cloudinary's re-encode already neutralises a malicious payload; if it does, this drops to defence in depth, but still add the check, because the `!ENV.CLOUDINARY_CLOUD_NAME` dev branch returns a placeholder URL *before* any upload happens.

## MEDIUM-2 — Missing UUID guard produces a 500

`backend/src/routes/agristore.routes.js:41-42`

`router.param` registers `uuidParamGuard` for `id` and `productId` only. `PUT /seller/orders/:orderId/status` therefore accepts any string; a non-UUID reaches `prisma.orderItem.updateMany` against a uuid column and, with no try/catch on the route, surfaces as a 500 through the global handler.

**Impact:** an error oracle that distinguishes valid from invalid id formats, plus log-noise amplification and wasted DB round-trips.

**Fix:** `router.param('orderId', uuidParamGuard)`. Then sweep every route file for `router.param` coverage of every uuid parameter — this is a class of defect, not a single instance.

## MEDIUM-3 — Order status rollup races and destroys inventory

`backend/src/routes/agristore.routes.js:929-957` — three defects in one handler:

1. The read-derive-write of `Order.status` runs **outside a transaction**, so two sellers updating the same multi-seller order concurrently persist a stale rollup.
2. A partially-cancelled order falls through to `PENDING`, so a buyer sees "pending" for an order one seller has already cancelled.
3. A seller setting `CANCELLED` **never restocks.** Unlike the buyer-cancel path, `applyStockDeltas` is never called — inventory is silently destroyed.

**Fix:** wrap the whole rollup in a transaction, represent partial cancellation explicitly rather than letting it fall through, and call `applyStockDeltas` with positive deltas on seller cancellation.

## MEDIUM-4 — Duplicate payouts are possible

`backend/prisma/schema.prisma` — model `Payout` has no `@@unique`. Nothing prevents two payout rows for the same `sellerId` over the same `periodFrom`/`periodTo`.

**Fix:** add `@@unique([sellerId, periodFrom, periodTo])` (additive). Check for existing duplicates first — the constraint will fail to apply if any exist.

## MEDIUM-5 — Soft-deleted products remain publicly fetchable

`backend/src/routes/agristore.routes.js` — `GET /products/:id` has no auth middleware and no `isActive` filter. `DELETE /seller/products/:id` is a soft delete (`isActive: false`), so every "deleted" product remains retrievable by id, including its seller-supplied description and images.

**Fix:** filter `isActive: true` for non-owner requests, and decide deliberately whether the owner and admins may still fetch it.

## LOW-1 — Checkout serialization failures surface as 500s

Both checkout paths use `prisma.$transaction(fn, { isolationLevel: 'Serializable' })` with no retry wrapper. Two buyers racing for the last unit is a normal event, but a 40001 abort currently returns a 500 "Checkout failed. Please try again."

**Fix:** a bounded retry (2–3 attempts with jitter) around the transaction, and a 409 rather than a 500 when it genuinely conflicts.

## LOW-2 — Referential integrity is unenforced on the money rails

`SellerLedgerEntry`, `Payout` and `Dispute` use bare `String` scalars with no foreign keys — deliberately, to keep `db push` additive (see the comment at `schema.prisma:2168-2172`). Orphaned ledger entries and payouts to deleted users are possible.

**Fix:** do **not** add FKs; that breaks the deploy path. Add a periodic integrity check that reports orphans, and validate that the referenced user exists at write time.

## LOW-3 — `minOrderQty` is never enforced

Stored on product create and update (lines 712, 751, 818, 851) and read by no cart or checkout path. Quantity is bounded only by the validator's `1..100` and by stock. Sellers believe they have a minimum order quantity that does not exist.

**Fix:** enforce it in cart add, cart update and checkout — or remove the field.

---

## Also review — not confirmed, verify before changing

**The CSRF pre-auth exemption in `backend/src/middleware/csrf.js`.** It matches with `path.endsWith(suffix)` over `PRE_AUTH_PATHS`. `csrfProtection` is global middleware mounted at `src/app.js:326`, *before* routing, so `req.path` is the full request path. Confirm no other route can end with `/auth/send-otp` or `/auth/verify-otp`, and consider exact-matching against the mounted API prefix instead of `endsWith`. The exemption itself is sound — those two endpoints establish a session rather than act on one, and `/auth/refresh` correctly stays protected.

## Do not "fix" these — they are already correct

- `backend/src/utils/keyset.js:72` `$queryRawUnsafe` — identifiers are regex-guarded by `IDENT`, values are parameterised. Not injectable.
- No secrets are committed anywhere in git history.
- `src/config/env.js` validates production config and throws `FATAL` on invalid setups; JWT secret length is enforced at ≥ 32 characters.
- Field encryption is AES-256-GCM with a key-id registry and rotation support.
- OTP has proof-of-work gating plus IP and phone rate limiters on both send and verify. Refresh tokens rotate with reuse detection, token-family revocation, and a security-incident record.
- CORS uses an allowlist that refuses to reflect arbitrary origins in production; helmet and `trust proxy` are configured.

## Sequence

1. **CRITICAL-1 and CRITICAL-2** — live financial exposure. Ship these first, alone, ahead of everything else.
2. HIGH-1 through HIGH-3.
3. The `router.param` sweep from MEDIUM-2, across all route files.
4. Everything else.

Every fix ships with its regression test. Report which tests fail before the fix and pass after.
