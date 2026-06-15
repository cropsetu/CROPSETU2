# Animal Trade Home (Livestock Marketplace)

> **Tab:** Animals · **Stack:** `AnimalStack` (`AnimalTradeNavigator`) · **Route name:** `AnimalTradeHome` · **File:** `frontend/src/screens/AnimalTrade/AnimalTradeHome.js`

## Purpose
The landing screen of the "Animals" bottom tab — a Pashushala-inspired livestock marketplace. Farmers browse animals for sale (cows, buffalo, goats, etc.) in a 2-column photo grid, filter by category and GPS distance, search, and sort by price/recency. It is the entry point for posting a new listing and for opening the chat inbox.

## Where it sits / how you reach it
- **Reached from:** The **Animals** bottom tab (root of `AnimalStack`). It is the stack's initial screen (`headerShown: false`). Also reached programmatically: `AddAnimalListing` success popup navigates here with a `freshListingId` param; `MyAnimalChatsScreen` empty state "Browse Animals" button navigates here.
- **Navigates to:**
  - `AnimalDetail` — tapping an animal card (`AnimalCard` body or the "Book Now" button) → `navigation.navigate('AnimalDetail', { listing: item })`.
  - `AddAnimalListing` — bottom-right "Post Ad" FAB, and the empty-state "Post Ad" CTA → `navigation.navigate('AddAnimalListing')`.
  - `MyAnimalChats` — the chat-bubble button in the top bar (next to the search bar) → `navigation.navigate('MyAnimalChats')`.
- **Route params in:** Optional `freshListingId` and `ts` (set by `AddAnimalListing` after a successful post). When present, filters reset to defaults, the list refetches, scrolls to top, and the params are cleared via `navigation.setParams` to avoid a re-focus loop.

## How it works
On mount and on every focus (`useFocusEffect`), and whenever `activeFilter`, `searchQuery`, `distanceKm`, `userLocation`, or `sortBy` change, it calls `fetchListings()` → `GET /animals`. Query params are built dynamically: `limit: 50`, plus `animal` (when category ≠ All), `search` (trimmed query), and `lat`/`lng`/`radius` (when a distance chip is active and GPS coords exist). Results are then client-side sorted: price-low/price-high re-sort the array; "latest" with an active distance re-sorts by `distanceKm`.

Key state: `activeFilter` ('All' default), `searchQuery`, `sortBy` ('sortLatest' default), `distanceKm` (null default), `listings`, `loading`, `refreshing`. GPS comes from the global `LocationContext` (`coords`, `permissionGranted`, `loading`), surfaced as `locStatus` ('loading' | 'granted' | 'denied'). Listings are chunked into 2-item `pairs` rendered as `CardRow`s in a `FlatList`. Pull-to-refresh calls `fetchListings(true)`.

Loading shows a `TractorLoader`; on success with zero items the `EmptyAnimals` illustration shows. On API error: in `__DEV__` it falls back to mock `ANIMAL_LISTINGS` from `constants/mockData`; in production it shows an empty list. Tapping a distance chip while location is denied triggers an `Alert` instead of filtering.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Search bar | TextInput + icon | Top bar; search-outline icon, placeholder `animal.searchPlaceholder`, controlled by `searchQuery`. Shows a clear (`close-circle`) button when text present. |
| Chat inbox button | Icon button (green chip) | Top bar, right of search; `chatbubbles` icon. Opens `MyAnimalChats`. Replaced the old "+" button. |
| Category pills row | Horizontal ScrollView of pills | `CategoryPill` per category (All, Cow, Buffalo, Goat, Bullock, Sheep), each an `AnimalIcon` in a circular frame with a label. Active pill highlighted green; sets `activeFilter`. Haptic selection on press, spring scale animation. |
| Distance label | Icon + text | Shows `location`/`location-outline` and text: "Near Me" (granted), "Locating…" (loading), or "Distance" (denied). |
| Distance chips | Horizontal ScrollView of chips | `DistChip` for All / 10 / 25 / 50 / 100 km. Toggling sets/clears `distanceKm`. Chips disabled (greyed) when location denied. |
| Section header | Row | Star badge, title `animal.allAnimals`, and a green count badge showing `listings.length`. |
| Sort chips | Horizontal ScrollView of chips | `SortChip` for `sortLatest`, `sortPriceLow`, `sortPriceHigh`; active highlighted green; sets `sortBy`. |
| Animal cards | 2-column card grid | `AnimalCard` per listing: image (or `AnimalIcon` fallback), gradient overlay, breed+animal name, ₹price, city, age, milk yield. |
| "Added recently" badge | Badge on card | Amber ribbon shown when `item.isNew`/`_isNew`. |
| Distance badge | Badge on card | Bottom-left of image; `location` icon + km, shown when distance known. |
| Vaccinated badge | Badge on card | Bottom-right green `shield-checkmark` chip when `item.vaccinated`. |
| "Book Now" button | Button on card | Green button with `car-outline` icon; opens `AnimalDetail` (same as tapping card). |
| Pull-to-refresh | RefreshControl | Green spinner; re-fetches listings. |
| Loading state | TractorLoader | "Loading animals" tractor animation while `loading` and list empty. |
| Empty state | Illustration + CTA | `EmptyAnimals`: layered rings + floating animal icons, title (`noAnimalsNearby`/`noAnimals`), reassurance chips (reach buyers / free to post / verified), "Post Ad" CTA, and a "Show all animals" button when a distance filter is active. |
| Post Ad FAB | Floating button | Bottom-right; `add` icon + "Post Ad" text → `AddAnimalListing`. |
| Scroll-to-top button | Floating button | `ScrollToTopButton`, visible after scrolling 200px (`useScrollHeader`); scrolls list to top. |
| Collapsing header | Animated.View | Search + category + distance filter block collapses on scroll via `useScrollHeader`. |

## Services, APIs & data
- **API endpoints:** `GET /animals` via `services/api` (`api.get('/animals', { params })`), params: `limit`, optional `animal`, `search`, `lat`, `lng`, `radius`. Reads `data.data` as the listings array.
- **Backend route/service:** `backend/src/routes/animaltrade.routes.js` (mounted at `/api/v1/animals` in `backend/src/app.js`) — the `GET /` list handler.
- **State / context:** `useLanguage()` (i18n), `useLocation()` (global GPS), local `useState` for filters/listings, `useScrollHeader` hook, `useFocusEffect`. No socket on this screen.
- **Local / static data:** `ANIMAL_CATEGORIES`, `DISTANCE_KEYS` ([null,10,25,50,100]), `SORT_KEYS`. `haversineKm` helper present (distance math). Dev-only fallback mock: `ANIMAL_LISTINGS` from `constants/mockData`.

## Languages / i18n
Uses `t()` from `useLanguage()` throughout. Keys span `animal.*` (e.g. `searchPlaceholder`, `allAnimals`, `nearMe`, `locating`, `distance`, `sortLatest`, `sortPriceLow`, `sortPriceHigh`, `bookNow`, `addedRecently`, `postAd`, `noAnimals`, `noAnimalsNearby`, `beFirstToList`, `reachBuyers`, `freeToPost`, `verifiedBadge`, `showAllAnimals`, `locationRequired`, `locationRequiredMsg`), `animals.<type>` for category labels, plus top-level keys `all` and `chatWithSeller`. Multi-language: app ships en/hi/gu/kn/te/ml/pa/ta/bn translation files.

## Notes, edge cases & gaps
- **Offline / API failure:** dev shows mock data, production shows empty state (no error toast).
- **Location denied:** distance chips are disabled and tapping one shows an `Alert(locationRequired)`.
- **Sorting is client-side** — the server returns verified+createdAt order; price/distance sorts are applied locally.
- **Fresh-listing flow:** returning from a successful post resets all filters so the new card is guaranteed visible, then clears the param to prevent a re-focus refetch loop.
- Performance: `FlatList` uses `windowSize={5}`, `maxToRenderPerBatch={10}`, `removeClippedSubviews`.
