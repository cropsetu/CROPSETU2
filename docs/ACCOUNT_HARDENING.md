# Account tab production hardening

The Account (Profile) tab was the last of the six tabs without a hardening pass.
Shop, Krushi AI, Animals, Rent and My Farm each had one; this closes the set.

Two of the changes are **app-wide**, not Account-specific — they were found while
auditing this tab but the defect existed in every module (§1, §2).

Everything here is additive. No column was dropped, no endpoint removed, no
request shape changed. An un-upgraded app build keeps working against the new
backend.

---

## 1. Async route safety net (app-wide)

`backend/src/middleware/asyncRoutes.js`, installed once from `app.js`.

**The bug.** Express 4 discards a route handler's return value. A handler without
`try/catch` that rejects therefore writes no response at all — the socket stays
open until the client times out. The app shows a spinner that never resolves;
nothing 5xx-shaped reaches monitoring, so the failure is invisible from both
ends. `process.on('unhandledRejection')` in `server.js` kept the *process* alive,
which is why this never appeared as a crash. It never answered the request.

Handlers missing `try/catch` at the time of the audit included
`GET /agristore/orders` and `GET /community/saved` — both of them Account-tab
screens.

**The fix.** Patch `Layer.prototype.handle_request` so a returned rejected
promise is forwarded to `next(err)`, where the existing global error handler
answers with a safe 500 and writes an `ErrorLog` row. Handlers that already
catch never reject, so they are untouched.

Two details that matter and are covered by tests:

- The wrapper copies `fn.length`. **Express dispatches on arity** — a 4-argument
  function is error-handling middleware. Losing the arity would silently break
  error routing app-wide.
- If a handler rejects *after* responding, the error is logged rather than passed
  to `next()`, which would attempt a second set of headers.

**Rollback:** delete the `installAsyncRouteSafety()` call in `app.js`. Behaviour
returns to hanging requests; nothing else changes.

---

## 2. Page-size and page-number clamps (app-wide)

`parsePageNumber()` added to `utils/response.js`, alongside the existing
`parsePageSize()`. Applied across Shop, Community, Crop Disease, Groups, AI and
Crop Report Share.

| Before | Effect |
| --- | --- |
| `?limit=1000000` → `take: 1000000` | Any authenticated user could ask the database to materialise a million rows **with includes**. No auth bypass needed — an ordinary request. |
| `?page=abc` → `skip: NaN` | Prisma throws. Combined with §1, the request then hung. |

11 uncapped `limit` reads and 11 unguarded `page` reads were fixed. Admin routes
(`moderation`, `fraud`, `cms`, `ops`) were **checked and left alone** — they
already clamp inside their service layer or via a validator.

Page sizes now cap at 50 with a default of 20 (10 for crop-disease history).
A client asking for more receives 50 rather than an error, so no app build
breaks.

**Rollback:** none needed — this only narrows accepted input. If a legitimate
caller needs more than 50, raise the `max` argument at that call site.

---

## 3. Notification preference — the switch that did nothing

Account → Notifications was `useState(true)`. Flipping it changed a local
variable. Nothing was persisted, no request was made, and delivery consulted
nothing — so a farmer who turned alerts off kept receiving them with no way to
tell the control was decorative.

**Schema:** one column.

```sql
ALTER TABLE "users" ADD COLUMN "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
```

`ADD COLUMN` with a default is metadata-only on PostgreSQL 11+ — no table
rewrite, no lock of consequence, no data loss.

**Behaviour:**

- Read and written through the existing `GET`/`PUT /users/me`. No new endpoint.
- `deliverUserNotification()` skips the **device push** when muted.
- The **in-app inbox row is still written**. Muting silences the interruption,
  not the record, so re-enabling later leaves no hole in the history.
- The preference read **fails open**. If the lookup errors, the notification is
  delivered. Losing "your order is out for delivery" because a read blipped is
  worse than one unwanted push.

**Security alerts ignore the mute entirely.** `category: 'SECURITY'` is passed by
`loginRisk`, `geoAnomaly` and `otp`. New-device sign-in, location anomaly and OTP
lockout are how someone discovers their account is being taken over; whoever is
holding the phone must not be able to switch them off from a settings screen.
Covered by `tests/backend/unit/pushPreference.test.js`.

**Rollback:** `UPDATE users SET "notificationsEnabled" = true;` restores the old
behaviour (everyone receives everything) without a deploy. The column can stay.

---

## 4. Saved Addresses

Account → "Saved Addresses" opened the profile-location editor (city, district,
PIN) — a different thing from the address book that checkout reads and writes.
That address book had **no management surface anywhere in the app**: a farmer
could create an address during checkout and then never edit or delete it. That is
a usability hole and a data-rights one, since a delivery address is personal data
its owner could not remove.

- New screen: `frontend/src/screens/Profile/SavedAddressesScreen.js`, backed by
  the existing `/api/v1/addresses` CRUD. No new endpoint.
- The row now navigates there.

Two server-side flaws fixed in `addresses.routes.js`:

- **Create was not transactional.** `updateMany({isDefault:false})` then
  `create()` — a create that failed after the demote left the account with *no*
  default, and checkout with nothing preselected.
- **Deleting the default left zero defaults.** It now promotes the most recently
  added survivor, in the same transaction as the delete.

Both are covered by `tests/backend/api/accountAddresses.api.test.js`, along with
cross-account isolation on read, edit, delete and set-default.

**Rollback:** `git revert`. The endpoints predate this change and are unaffected.

---

## 5. Screen-level defects

| Screen | Defect |
| --- | --- |
| My Orders | Read `order.total`; the column is `totalAmount`. **Every order displayed ₹0.00** — on the screen a farmer opens to check what they were charged. |
| My Orders | Status badges looked up `orders.statusPending` and friends. **None of those keys existed**, so the badge rendered the literal text `orders.statusConfirmed`. Added in en/hi/mr. |
| My Orders | `REFUNDED` was missing from the status map — a refunded order showed the raw enum string in grey. |
| My Orders | The retry button called `fetchOrders(1)`, passing a page number where a cursor was expected. Retry never worked. |
| My Orders | Item name and image came from the live product join. They now prefer the order item's **snapshot** columns, so a seller renaming or delisting a product cannot rewrite a farmer's receipt. |
| Saved Posts | `onEndReached` had no in-flight guard — a fast flick appended the same page several times (duplicate rows, duplicate React keys). |
| My Animal Listings | **Every user-facing string was hard-coded English**, including the destructive delete confirm, on a screen whose users largely read Marathi or Hindi. |
| My Animal Listings | Fetched `/animals/my` unpaginated while the endpoint has paged since the animal-trade pass. |
| My Animal Listings | A mount-time `useEffect` ran alongside `useFocusEffect`, firing the request twice on every open. |
| Profile | The state picker called `setLanguageByState`, which `LanguageContext` **never provided** — every tap threw `is not a function`. The context half is now implemented. |
| Profile | Privacy Center was a hard-coded English alert asserting data is "never shared with third parties" — **not true** (Razorpay, MSG91, Cloudinary, the model provider) and unreadable to most users. Replaced with translated copy describing the protections that are actually implemented. |
| Profile | `Linking.openURL` was unguarded; it rejects when no app can handle the URL, so those rows looked like buttons that did nothing. |
| All | Hard-coded `paddingTop: Platform.OS === 'android' ? 44 : 12` replaced with measured safe-area insets — the constant was wrong on every notched and punch-hole device. |
| All | Failed pagination no longer wipes the list already on screen; only a failed first page shows an error. |
| Profile | The state sheet had `maxHeight: '85%'` and no `height`. Its list is a `flex: 1` ScrollView, and flex distributes FREE space — in a parent sized to its own content there is none, so the list collapsed to zero and the sheet rendered as a bare header. Invisible until the picker stopped crashing. |
| Profile | `label="Village"` and `label="My Farms"` were hard-coded English literals where translations already existed. |
| Saved Posts | Three fallback strings (`profile.postUntitled` and friends) referenced keys that did not exist, so they rendered as raw key text. Added in en/hi/mr. |

### The raw-key guard

`t()` returns the KEY when a lookup misses. Nothing throws and nothing logs, so
a farmer is shown `orders.statusConfirmed` where a status badge should be and
an English-speaking reviewer scrolling past sees a word. Every My Orders status
badge shipped this way.

There is a second, nastier form: adding a `foo: { … }` namespace **silently
shadows** an existing `foo: 'Some text'` string, and every `t('foo')` call in
the app starts rendering `foo`. This pass hit it live — a new
`myAnimalListings` block shadowed the string of the same name that the Account
menu row used. It is now named `myAnimalListingsScreen`.

`frontend/src/screens/Profile/__tests__/accountI18n.test.js` fails if any
Account-tab screen contains a bare `t('key')` that does not resolve to a string
in English, and separately if any resolves to an object. It found three real
defects before it was green, and reintroducing the shadowing bug turns it red.

`t('key', 'Fallback')` and `t('key', { defaultValue: '…' })` are exempt — they
degrade to real text, not to a key.

### `setLanguageByState` fallback

Only `en`, `hi` and `mr` have dictionaries. Selecting a state whose language has
none — Gujarat, Punjab, Tamil Nadu — records the state but **leaves the UI
language alone**. Dropping a Hindi-reading farmer into English because they told
us where they live would be a downgrade. The picker offers an explicit "choose
language" link for anyone who wants a different one.

---

## 6. Deployment

```bash
cd backend
npx prisma generate
npx prisma db push      # one ADD COLUMN, see §3
```

No new environment variables. No new runtime settings. No new dependencies —
`SavedAddressesScreen` uses only packages already in the build, so no native
rebuild is required.

## 7. Rollback

`git revert` the merge. Safe at any time: the only schema change is one nullable-
by-default column, which is simply left in place and unread. Config-only partial
rollback for the notification mute is in §3.

---

## 8. Known gaps (unchanged by this pass)

- **Device push is never delivered to anyone.** The backend pipeline is complete
  (`push.service.js` → Expo), but the app never registers a push token:
  `expo-notifications` is not a dependency and `POST /users/me/push-token` has no
  caller. The mute in §3 therefore governs a channel that is currently dormant,
  and the in-app inbox is what farmers actually see. Wiring device push needs a
  new dependency and a native rebuild, so it was left out of this pass rather
  than half-done.
- **37 pre-existing test failures** across 7 suites (agristore, auth, farm, user,
  prisma, booking-concurrency, cacheWarmer). Verified unchanged by this work:
  the failing-test-name set is identical before and after.
- Translations remain en/hi/mr only.
- **378 bare `t()` keys across the app still render as raw text**, found by the
  guard described above when pointed at the whole codebase. The Account tab is
  now at zero; the rest are concentrated in **My Farm (171 keys)** and **Shop
  (15)**. Neither was in scope for this pass, and fixing them means writing real
  Hindi and Marathi copy rather than a mechanical edit — but the check is one
  command, so the work is now measurable:

  ```
  # point the SCREENS list in accountI18n.test.js at another tab to enumerate them
  ```
