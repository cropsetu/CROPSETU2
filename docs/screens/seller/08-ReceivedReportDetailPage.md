# Received Report Detail & Reply

> **Tab:** Account/Profile · **Stack:** SellerStack · **Route name:** `ReceivedReportDetail` · **File:** `frontend/src/screens/Seller/ReceivedReportDetailScreen.js`

## Purpose
The seller's detailed view of one shared AI crop-diagnosis report, plus a reply form. The seller reads the diagnosis (disease, confidence, risk, symptoms, AI-suggested chemicals/organics, weather snapshot), then recommends a treatment, optionally names a SKU, selects products from their own shop to suggest, marks availability, and sends the recommendation to the farmer. Used by agri-input sellers to respond to farmer diagnoses.

## Where it sits / how you reach it
- **Reached from:** `ReceivedReports` inbox — tapping a report card navigates here with `{ shareId }`.
- **Navigates to:** Custom back button → `navigation.goBack()` (also used by the error state's "Back" button).
- **Route params in:** `route.params.shareId` — the inbox share record ID, used in both the GET detail and POST reply endpoints.

## How it works
On mount `load()` GETs the share by `shareId` and hydrates the reply form from any previously saved values (`sellerReply`, `recommendedSku`, `available`, `recommendedProductIds` → a `Set`). A second `useEffect` independently fetches the seller's own products (`?limit=50`) for the product picker, tracking `productsLoaded`. The header shows the disease, crop/stage, and a Pending/Replied status badge. The body renders conditional sections (summary, symptoms, farmer's note, AI chemicals, organic alternatives, weather) only when that data exists, parsing nested `report.fullReport.treatment` shapes defensively (handles both string and object entries). `toggleProduct` adds/removes product IDs in the selection Set. `handleSend` requires at least 4 chars of reply text, then POSTs `{ reply, recommendedSku, recommendedProductIds, available }`; on success it shows a confirmation Alert and reloads (so status flips to Replied). Loading shows a spinner; a load failure shows a full error state with a Back button.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Custom header | View | cta bar: back button, disease title, crop·stage subtitle, status badge |
| Status badge | Badge | Pending vs Replied |
| Farmer card | View | Avatar, farmer name, location; call button (currently a no-op placeholder) |
| Diagnosis Summary section | Section | Confidence %, Risk (colored), field area, pincode |
| Symptoms section | Section (Bullets) | Listed when symptoms present |
| Farmer's note section | Section | Shown when the farmer attached a message |
| AI-suggested chemicals section | Section (Bullets) | First 6 chemicals (name/dose/timing) |
| Organic alternatives section | Section (Bullets) | First 5 organic options |
| Weather snapshot section | Section | Temp, humidity, description at scan time |
| Product picker section | Section | Pick up to 10 of the seller's own products |
| Product row | TouchableOpacity | Checkbox + thumbnail + name + price/unit/stock; toggles selection |
| Picker loading / empty | ActivityIndicator / Text | Spinner while products load; "no products yet" hint if none |
| Reply text input | TextInput (multiline) | Recommended pesticide/fungicide/dose; maxLength 2000 |
| SKU input | TextInput | Optional product SKU/name; maxLength 120 |
| "I have this in stock" toggle | Switch | Sets `available` (farmer gets a collect notification) |
| Send/Update button | TouchableOpacity | POSTs the reply; disabled while sending or reply < 4 chars; spinner while sending |
| Loading spinner | ActivityIndicator | Full-screen during initial load |
| Error state | View | Alert icon + message + "Back" button |

## Services, APIs & data
- **API endpoints (all via `services/api`):**
  - `GET /crop-reports/seller/inbox/:shareId` (report detail; also marks read server-side)
  - `POST /crop-reports/seller/inbox/:shareId/reply` (body `{ reply, recommendedSku, recommendedProductIds, available }`)
  - `GET /agristore/seller/products?limit=50` (for the recommendation product picker)
- **Backend route/service:** `backend/src/routes/cropReportShare.routes.js` (inbox detail + reply); `backend/src/routes/agristore.routes.js` (seller products)
- **State / context:** `useLanguage` (`t`); local `useState` for `share`, `loading`, `error`, `reply`, `sku`, `available`, `sending`, `myProducts`, `productsLoaded`, `selectedProductIds` (a Set); `safeErrorMessage` from `services/api`
- **Local / static data:** `Section`/`Bullet` helper components; defensive parsing of `fullReport.treatment` (`chemical`/`chemical_controls`, `organic`/`organic_alternatives`, `follow_up_schedule`/`followUpSchedule`)

## Languages / i18n
i18n via `useLanguage().t` under the `share.*` namespace with inline English defaults, e.g. `share.summarySection`, `share.confidence`, `share.risk`, `share.symptomsSection`, `share.aiChemicalSection`, `share.organicSection`, `share.weatherSection`, `share.productPickerSection`, `share.productPickerHint`, `share.replyLabel`, `share.replyPlaceholder`, `share.skuLabel`, `share.availableTitle`, `share.sendReplyCta`, `share.updateCta`, `share.replyTooShort`, `share.replySent`, plus shared `back`. Confidence is `Math.round`-ed.

## Notes, edge cases & gaps
- Reply must be ≥ 4 characters (trimmed) — both the validation Alert and the disabled send button enforce this.
- All diagnosis sub-sections render conditionally; missing fields simply omit their section. Treatment parsing handles both snake_case and camelCase shapes and string-or-object list entries.
- When already replied, the form is pre-filled and the CTA becomes "Update recommendation" (status badge shows Replied).
- The farmer "call" button is a placeholder — its `onPress` only has a comment, no `tel:` linking yet.
- The product picker hint mentions a 10-product cap, but the UI does not hard-enforce the limit client-side (no guard in `toggleProduct`).
- After a successful send it reloads the detail rather than navigating away, so the seller sees the updated Replied state in place.
