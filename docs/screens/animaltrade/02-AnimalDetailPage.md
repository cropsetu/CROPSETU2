# Animal Detail

> **Tab:** Animals · **Stack:** `AnimalStack` (`AnimalTradeNavigator`) · **Route name:** `AnimalDetail` · **File:** `frontend/src/screens/AnimalTrade/AnimalDetail.js`

## Purpose
The full detail view for a single livestock listing. It shows the hero photo, price, key facts (age, weight, milk yield, gender, vaccination), a description, seller info, and safety tips. From the bottom action bar a buyer can call or chat with the seller; the owner of the listing instead sees Edit and View-Inbox actions.

## Where it sits / how you reach it
- **Reached from:** `AnimalTradeHome` — tapping any `AnimalCard` or its "Book Now" button navigates here with the `listing` object. This screen uses the stack header (title = `animalDetail.animalDetails`) which provides the back button.
- **Navigates to:**
  - `Chat` — buyer's "Chat with Seller" button → `navigation.navigate('Chat', { listingId, sellerName, sellerId })` (falls back `sellerId: listing.id`).
  - `AddAnimalListing` (edit mode) — owner's "Edit Listing" button → `navigation.navigate('AddAnimalListing', { listing })`.
  - `MyAnimalChats` — owner's "View Inbox" button → `navigation.navigate('MyAnimalChats')`.
  - Phone dialer — buyer's "Call Seller" button opens `tel:` via `safeOpenURL(sanitizePhone(...))`.
- **Route params in:** `listing` (required) — the full animal listing object (id, animal, breed, price, images, age, weight, gender, milkYield, vaccinated, tags, description, sellerId, sellerName, sellerLocation, sellerAvatar, verified, createdAt, etc.).

## How it works
Pure presentational screen — no data fetch on mount; it renders the `listing` passed in via params. On mount a `contentAnim` timing animation fades/slides the content body up (opacity 0→1, translateY 30→0). The hero image has a parallax scale tied to scroll position (`scrollY` via `Animated.event`).

Owner detection: `isOwner = user?.id && listing?.sellerId && user.id === listing.sellerId` (from `AuthContext`). This drives which two buttons render in the bottom bar — Edit/Inbox for the owner, Call/Chat for everyone else (Call+Chat are hidden for the owner since they can't transact with themselves).

`formatPostedDate(listing)` prefers a ready-made `postedDate` (mock data) and otherwise derives a friendly relative label ("today", "yesterday", "N days ago", "N weeks ago", or a locale date) from `createdAt`/`updatedAt`. The "key highlights" strip picks the first 3 available facts among age, weight, milk yield, gender.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Stack header + back | Navigation header | Provided by `AnimalDetail` stack screen (title `animalDetail.animalDetails`); back button returns to home. |
| Hero image | Parallax Image | Full-width 300px hero; `paw` icon fallback when no image. Scales on scroll. |
| Like button | Icon button (overlay) | `heart-outline` in a dark circle, top-right of hero. **No onPress handler** (visual only). |
| Share button | Icon button (overlay) | `share-social-outline` in a dark circle. **No onPress handler** (visual only). |
| Verified badge | Badge (overlay) | Bottom-left of hero; green `shield-checkmark` + `sellerVerified` text, shown when `listing.verified`. |
| Title + Hindi name | Text | Animal + breed; optional `animalHi` second line. |
| Price | Text | `₹` + localized `listing.price`. |
| Key highlights strip | Row of `HighlightCard` | Up to 3 cards (age / weight / milk yield / gender) with icon, value, label. |
| Tags row | Chips | One `tag` chip per `listing.tags` entry with a `checkmark-circle` icon. |
| Animal Details section | Card with `InfoRow`s | Gender, Age, Weight, (Milk Yield if present), Vaccinated — each a labeled row; missing values show `notMentioned`. |
| Description section | Text | `listing.description` or italic fallback `noDescription`. |
| Seller Info card | Card | Avatar initials, seller name, location row (`location` icon + `sellerLocation`), posted date, and small verified check if verified. |
| Safety Tips card | Warning card | `warning` icon + `safetyTips` title + `safetyTipsText`. |
| Bottom action bar | Fixed bar | Two buttons depending on ownership (see below). |
| Call Seller button | Outlined button (buyer) | `call` icon + `callSeller`; opens `tel:` dialer, shows error Alert if it fails. |
| Chat with Seller button | Gradient button (buyer) | `chatbubbles` icon + `chatWithSeller`; opens `Chat`. |
| Edit Listing button | Outlined button (owner) | `create-outline` + "Edit Listing"; opens `AddAnimalListing` in edit mode. |
| View Inbox button | Gradient button (owner) | `chatbubbles` + "View Inbox"; opens `MyAnimalChats`. |

## Services, APIs & data
- **API endpoints:** None directly. The "Chat with Seller" button defers chat creation to `ChatScreen` (which POSTs `/animals/:listingId/chat`). "Call Seller" opens a `tel:` URL via `safeOpenURL`.
- **Backend route/service:** Indirect only — chat creation lands on `backend/src/routes/animaltrade.routes.js` (`POST /:id/chat`) once `ChatScreen` mounts.
- **State / context:** `useAuth()` (owner check via `user.id`), `useLanguage()`, local `useRef` animated values (`scrollY`, `contentAnim`). No network state on this screen.
- **Local / static data:** Receives everything via `route.params.listing`. Helpers: `formatPostedDate`, `InfoRow`, `HighlightCard`.

## Languages / i18n
`t()` keys used: `animalDetail.*` (`animalDetails`, `sellerVerified`, `notMentioned`, `yes`, `noDescription`, `sellerInfo`, `postedDate`, `safetyTipsText`, `phoneError`), plus shared keys `age`, `weight`, `milkYield`, `gender`, `vaccinated`, `safetyTips`, `callSeller`, `chatWithSeller`, `product.productDescription`, `product.error`. Note: the "Edit Listing" and "View Inbox" labels are hard-coded English strings (not translated). Multi-language support via the app's translation files.

## Notes, edge cases & gaps
- **Like and Share buttons are non-functional** — purely decorative overlays with no `onPress`.
- **Owner Edit/Inbox labels are hard-coded English** ("Edit Listing", "View Inbox", "Your changes have been saved" style strings) rather than i18n keys.
- Call requires a valid `sellerPhone`; sanitized via `sanitizePhone`, and a failed open shows `animalDetail.phoneError`.
- Robust to missing optional fields — highlights strip and InfoRows degrade gracefully to `notMentioned`/fallbacks so the screen never looks empty.
- `sellerId` may be absent on some listings; chat falls back to using `listing.id` as `sellerId`.
