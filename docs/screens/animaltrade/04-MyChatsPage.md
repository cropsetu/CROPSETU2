# My Animal Chats (Inbox)

> **Tab:** Animals · **Stack:** `AnimalStack` (`AnimalTradeNavigator`) · **Route name:** `MyAnimalChats` · **File:** `frontend/src/screens/AnimalTrade/MyAnimalChatsScreen.js`

## Purpose
The user's inbox of animal-trade conversations. It lists every chat the user is part of (as buyer or seller), one row per chat, showing the listing thumbnail, counterpart name, animal/breed line, last-message preview, and time. It updates in real time over the socket and opens individual conversations in `ChatScreen`.

## Where it sits / how you reach it
- **Reached from:**
  - `AnimalTradeHome` — the chat-bubble button in the top bar → `navigation.navigate('MyAnimalChats')`.
  - `AnimalDetail` — the owner's "View Inbox" button → `navigation.navigate('MyAnimalChats')`.
  - Renders its **own custom header** (`headerShown: false` in the stack); the back button is part of the screen.
- **Navigates to:**
  - `Chat` — tapping any `ChatRow` → `navigation.navigate('Chat', { listingId, sellerName, sellerId, chatId })` (chatId already known, so `ChatScreen` skips the upsert).
  - `AnimalTradeHome` — empty-state "Browse Animals" button.
  - Back (`navigation.goBack()`) — header back arrow.
- **Route params in:** None.

## How it works
On focus (`useFocusEffect`) it calls `fetchChats()` → `GET /animals/chats/my`, storing `data.data` as `rows`. State: `rows`, `loading`, `refreshing`, `error`.

A second `useFocusEffect` opens the real-time socket (`connectSocket()` from `services/socket`) and subscribes to `new_message` on the user's personal room (`user:<id>`). On each incoming message it finds the matching row by `chatId`, updates its `lastMessage` (text/imageUrl/createdAt/`mine` flag) and `updatedAt`, and floats it to the top of the list. If the message belongs to a chat not yet in the list (first contact from a new buyer), it triggers a full `fetchChats()` refetch. The listener is cleaned up on blur/unmount.

Each `ChatRow` derives: thumbnail from `listing.images[0]` (paw placeholder otherwise), an animal line (`animal · breed`, or "Listing removed" if the listing is gone), and a last-message preview ("📷 Photo" for image messages, "You: …" prefix for own messages, or "Tap to start the conversation" when empty). Times use a `timeAgo` helper (now / Nm / Nh / Nd / date).

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Custom header | Header row | Back arrow (`arrow-back`) + centered title (`chatWithSeller`); platform-padded on Android. |
| Back button | Icon button | `arrow-back`; calls `navigation.goBack()`. |
| Chat list | FlatList | One `ChatRow` per chat; hairline separators between rows. |
| Chat row | TouchableOpacity | Thumbnail + name + animal line + preview + time; opens the conversation. |
| Listing thumbnail | Image / placeholder | Circular image from `listing.images[0]`, or a `paw-outline` placeholder. |
| Counterpart name | Text | `counterpart.name` or role-based fallback ("Seller"/"Buyer"). |
| Animal line | Text | `animal · breed`, or "Listing removed". |
| Last-message preview | Text | Last message text, "You: …" prefix for own, "📷 Photo" for images, or "Tap to start the conversation". |
| Time | Text | Relative time of the last message / `updatedAt`. |
| Pull-to-refresh | RefreshControl | Re-fetches the chat list. |
| Loading state | ActivityIndicator | Large green spinner while `loading`. |
| Error state | Error block | `alert-circle-outline` icon + error message + "Retry" button (`fetchChats`). |
| Empty state | Empty block | `chatbubbles-outline` icon, "No chats yet", explanatory text, and a "Browse Animals" button → `AnimalTradeHome`. |

## Services, APIs & data
- **API endpoints:** `GET /animals/chats/my` via `services/api` (`api.get('/animals/chats/my')`), reads `data.data`.
- **Backend route/service:** `backend/src/routes/animaltrade.routes.js` → `GET /chats/my` (mounted at `/api/v1/animals`).
- **Real-time:** `connectSocket()` from `services/socket`; listens for `new_message` on the user's personal room. Socket events are emitted server-side by `backend/src/socket/chat.socket.js` to `user:<id>` for both participants.
- **State / context:** `useAuth()` (`user.id` for the socket room + `mine` flag), `useLanguage()`, local `useState` for rows/loading/refreshing/error, two `useFocusEffect` hooks (fetch + socket).
- **Local / static data:** `timeAgo` helper, `ChatRow` component.

## Languages / i18n
Mostly hard-coded English UI strings: "No chats yet", "Retry", "Browse Animals", "Tap to start the conversation", "Listing removed", "Seller"/"Buyer", and the empty-state body. The only `t()` key used is `chatWithSeller` (header title, with an English fallback). Multi-language support is therefore minimal on this screen.

## Notes, edge cases & gaps
- **Real-time updates** keep the list fresh without a manual refresh — new/incoming messages reorder rows to the top; unknown chats trigger a refetch.
- **Socket-failure tolerant:** if `connectSocket()` throws, it silently falls back (focus re-runs and pull-to-refresh keep the list usable).
- **Removed listings** render as "Listing removed" with a paw placeholder thumbnail rather than crashing.
- **Mostly untranslated** — a localization gap compared to the browse/list screens.
- No unread-count badges on rows (preview only).
