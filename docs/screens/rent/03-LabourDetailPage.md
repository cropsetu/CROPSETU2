# Labour Detail (Worker / Group Profile)

> **Tab:** Rent · **Stack:** RentStack · **Route name:** `LabourDetail` · **File:** `frontend/src/screens/Rent/LabourDetail.js`

## Purpose
Profile page for a single worker or worker group available for farm work. It shows a photo/video gallery, skills, languages, experience, pricing, and location. The primary action is to call the worker directly — there is no calendar/booking flow (unlike machinery). Owners viewing their own listing see an "Your Listing" state instead of the call action.

## Where it sits / how you reach it
- **Reached from:** `RentHome` (Workers tab) — tapping a worker card or its "Call" button (passes `{ id, labour }`).
- **Navigates to:**
  - Back (`navigation.goBack()`) — the gallery back arrow.
  - Phone dialer (`tel:` via `safeOpenURL`) — the call icon, the call CTA card, and the bottom "Call Now" button (not a screen).
- **Route params in:** `{ id, labour }` — `labour` is the pre-passed list item for instant render; `id` (or `labour.id`) drives the detail fetch.

## How it works
- State seeds `data` from passed `labour`. On mount (keyed on `listingId`) it calls `GET /rent/labour/:id` and replaces `data` with the full record; on failure it keeps the passed data.
- **Owner check:** `isOwner` = `user.id === l.provider?.id || l.providerId`. Owners can't hire themselves, so the call CTA card and call buttons are replaced with an owner notice / "Your Listing" bottom bar.
- **Phone resolution:** `phone = l.phone || l.provider?.phone || null`. `handleCall` opens `tel:` via `sanitizePhone`/`safeOpenURL`; it no-ops when no phone.
- **Media:** `allMedia` combines `l.image`, `l.images[]`, and `l.videos[]`; the gallery pages through them (videos via `expo-av`). With no media it shows a big initials avatar hero.
- **Loading:** full-screen `ActivityIndicator` while `loadingData` and no data.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Media gallery | Horizontal paging carousel | Photo(s) + video(s); page dots; gradient overlay. Falls back to an initials avatar hero when empty. |
| Back button | Icon button (overlay) | `goBack()`. |
| Call (top) button | Icon button (overlay) | Shown only when phone exists and not owner; dials worker. |
| Name + group name | Header | Leader/name, secondary group name, and a "{n} workers available" group badge when `groupSize > 1`. |
| Availability badge | Badge | "Available" vs "Busy" based on `l.available`. |
| Pricing cards | Cards | ₹/day card, optional ₹/hour card, and a rating card (stars + count). |
| Owner notice | Banner | Shown when `isOwner` — "you can't hire it". |
| Call-to-hire CTA card | Button card | Non-owner; phone icon + "Call to Hire" + phone number (or "phone not listed"); disabled/dimmed when no phone. |
| Skills | Chips | One chip per `l.skills` with a check icon. |
| Languages row | Info row | "Speaks {langs}" when `l.languages` present. |
| Experience row | Info row | `l.experience` when present. |
| Description | Text block | `l.description` under an "About" heading. |
| Availability window card | Card | `l.availableFrom`(–`availableTo`/"onwards") when present. |
| Location row | Info row | `l.location` (+ district). |
| Bottom bar — Your Listing | Static badge | Owner only. |
| Bottom bar — Call Now | Primary button | Non-owner; "Call Now • {phone}" or "phone not listed"; disabled when no phone. |

## Services, APIs & data
- **API endpoints (via `services/api.js`):** `GET /rent/labour/:id`.
- **Backend route/service:** `backend/src/routes/rent.routes.js`.
- **State / context:** `AuthContext` (`user`), `LanguageContext` (`t`), `useSafeAreaInsets`, local `useState`.
- **Local / static data:** none beyond derived values (initials, `allMedia`, `phone`).

## Languages / i18n
Uses the `rent.*` namespace (`callToHire`, `phoneNotListed`, `skillsExpertise`, `speaks`, `aboutSection`, `busy`, `listAvailable`, `callNow`, `ownListingMsg`, etc.). Dates formatted with `toLocaleDateString('en-IN')`.

## Notes, edge cases & gaps
- There is no booking/calendar flow for labour — hiring happens off-app via a phone call.
- All call actions are disabled (dimmed) when no phone number is available on the listing or provider.
- Owner state suppresses every call affordance and shows "Your Listing" instead.
- Phone is sanitized before dialing (`sanitizePhone` + `safeOpenURL`).
