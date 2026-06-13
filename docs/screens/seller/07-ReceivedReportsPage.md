# Received Crop Reports (Inbox)

> **Tab:** Account/Profile · **Stack:** SellerStack · **Route name:** `ReceivedReports` · **File:** `frontend/src/screens/Seller/ReceivedReportsScreen.js`

## Purpose
The seller's inbox of AI crop-diagnosis reports that nearby farmers have shared (sent from the farmer's DiagnosisResult → KrushiKendra share sheet). The seller browses these reports, filters by reply status, and taps one to open its detail/reply screen. Lets a Krushi Kendra / agri-input seller recommend treatments and products to farmers.

## Where it sits / how you reach it
- **Reached from:** Seller Dashboard "Received Crop Reports" CTA card (`navigation.navigate('ReceivedReports')`).
- **Navigates to:**
  - Each report card → `ReceivedReportDetail` with `{ shareId: item.id }`
  - Custom back button → `navigation.goBack()`
- **Route params in:** none

## How it works
Holds a `filter` of `ALL | PENDING | REPLIED`. `load()` requests the inbox, passing `{ status: filter }` as params when the filter is not ALL. Two effects run the load: a `useEffect` (initial, clears `loading`) and `useFocusEffect` (reload on every focus, e.g. after replying). Pull-to-refresh re-runs `load()`. A full-screen spinner shows during initial load; on error it shows an error empty-state with a Retry button; on empty results it shows a leaf empty-state. Each card derives a risk color, an unread flag (`!item.readAt`), and a "You replied" indicator when `item.status === 'REPLIED'`. `relativeTime` renders human-friendly timestamps (just now / min / h / d ago, then a date).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Custom header | View | cta-colored bar with back button, title, subtitle |
| Back button | TouchableOpacity | `navigation.goBack()` |
| Filter tabs | TouchableOpacity ×3 | All / Pending / Replied; sets `filter` |
| Report list | FlatList | List of report cards |
| Risk bar | View | Left colored stripe by risk level (HIGH/MEDIUM/MODERATE/LOW) |
| Disease title | Text | `report.primaryDisease` (or "Unknown disease") |
| Unread dot | View | Small dot shown when `!readAt` |
| Crop line | Text | Crop type · growth stage |
| Farmer line | Text | Farmer name (or `+91 phone`) · village |
| Risk pill | Badge | Risk level + rounded confidence % |
| Relative time | Text | Human-friendly age of the report |
| "You replied" row | View | Checkmark + label when status REPLIED |
| Card (whole) | TouchableOpacity | Opens `ReceivedReportDetail` with `shareId`; highlighted border when unread |
| Pull-to-refresh | RefreshControl | Re-runs `load()` |
| Error state | View | Cloud-offline icon + message + Retry button |
| Empty state | View | Leaf icon + "no reports yet" copy |
| Loading spinner | ActivityIndicator | Full-screen during initial load |

## Services, APIs & data
- **API endpoints (via `services/api`):**
  - `GET /crop-reports/seller/inbox` (optionally `?status=PENDING|REPLIED` via params)
- **Backend route/service:** `backend/src/routes/cropReportShare.routes.js` (seller inbox)
- **State / context:** `useLanguage` (`t`); local `useState` for `items`, `loading`, `refreshing`, `error`, `filter`; `useFocusEffect` for refresh-on-focus
- **Local / static data:** `RISK_COLOR` map; `relativeTime` helper; `safeErrorMessage` from `services/api`; `COLORS`, `SHADOWS`, `RADIUS`

## Languages / i18n
i18n via `useLanguage().t` with inline defaults, under `inbox.*` (`inbox.title`, `inbox.subtitle`, `inbox.tabAll`, `inbox.tabPending`, `inbox.tabReplied`, `inbox.replied`, `inbox.emptyTitle`, `inbox.emptyText`) and `share.*` (`share.justNow`, `share.minAgo`, `share.hourAgo`, `share.dayAgo`, `share.unknownDisease`, `share.loadFailed`) plus shared `retry`. Every key supplies an English fallback string.

## Notes, edge cases & gaps
- Reloads on focus via `useFocusEffect`, so the unread state and reply status stay current after returning from the detail screen.
- Error state is rendered inline with a Retry that re-toggles `loading`; empty and error states are mutually exclusive.
- Unread is purely a UI cue from `!readAt`; the read marking happens server-side when the detail is opened.
- No pagination — the inbox is fetched as a single list.
