# Chat (Buyer ↔ Seller Conversation)

> **Tab:** Animals · **Stack:** `AnimalStack` (`AnimalTradeNavigator`) · **Route name:** `Chat` · **File:** `frontend/src/screens/AnimalTrade/ChatScreen.js`

## Purpose
A single real-time conversation between a buyer and a seller about a specific animal listing. It loads the message history, streams new messages and read-receipts over the socket (with HTTP polling as a fallback), and lets the user type and send messages with optimistic rendering and retry-on-failure.

## Where it sits / how you reach it
- **Reached from (two entry points):**
  1. `AnimalDetail` — "Chat with Seller" button passes only `listingId`, `sellerId`, `sellerName`. The screen then POSTs `/animals/:listingId/chat` to upsert/find the Chat row.
  2. `MyAnimalChats` — a `ChatRow` tap passes `chatId` (plus `listingId`, `sellerName`, `sellerId`), so the upsert is skipped and messages load directly.
  - Uses the stack header — its title is `route.params.sellerName` (or `nav.chat`), providing the back button. (The screen also renders its own in-body header row with avatar + online status below it.)
- **Navigates to:** No outbound navigation from this screen (back via the stack header only).
- **Route params in:** `listingId`, `sellerName`, `chatId` (optional). `sellerId` is also passed in by callers though not destructured here.

## How it works
On mount (`init`): if no `chatId` is known, it POSTs `/animals/:listingId/chat` to get/create the chat id; then GETs `/animals/chats/:chatId/messages?limit=100`. State: `chatId`, `messages`, `inputText`, `loading`, `sending`, `error`, `focused`.

**Real-time (socket, primary):** a `useFocusEffect` connects via `connectSocket()`, emits `join_chat {chatId}` and `mark_read {chatId}`, then listens for:
- `new_message` — replaces a matching optimistic/pending row (by senderId+text) or appends; if the message is from the counterpart, emits `mark_read` again.
- `messages_read` — when the counterpart reads, flips the user's own sent messages' `readAt` (✓✓ turns blue).

**Polling (fallback):** a separate `useFocusEffect` polls `GET /animals/chats/:chatId/messages` every 8s (`POLL_MS`) while focused. `mergeServerMessages` merges server rows with any local pending/failed rows; `isSameState` avoids needless re-renders but still catches `readAt` changes.

**Sending (`sendMessage`, optimistic):** trims input, inserts a temp `pending` bubble, clears the box, then POSTs `/animals/chats/:chatId/messages` with `{ text }`. On success it swaps the temp row for the saved server row; on failure it marks the row `failed` (tap-to-retry via `retryFailed`). Char cap is 2000 (`MAX_CHARS`); a counter appears within 200 of the cap (`COUNTER_AT = 1800`). On web, Enter sends and Shift+Enter inserts a newline (`onKeyPress`). The list auto-scrolls to the end when message count changes.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Stack header + back | Navigation header | Title = `sellerName`; back returns to the previous screen. |
| In-body chat header | Header row | Circular avatar (seller initial) + seller name + green online dot and "Online" text (`chat.online`). Static "Online" indicator. |
| Message list | FlatList | Renders `MessageBubble` per message; auto-scrolls to bottom on new messages; `keyboardShouldPersistTaps="handled"`. |
| Message bubble (theirs) | Bubble (left) | Surface-colored bubble with small counterpart avatar (initial); timestamp footer. |
| Message bubble (mine) | Bubble (right, green) | Primary-colored bubble, right-aligned; timestamp + status icon. |
| Status: pending | Icon | `time-outline` while the message is sending (optimistic). |
| Status: sent / read | Icon | `checkmark-done` — pale when sent, blue (`#7DD3FC`) once `readAt` is set. |
| Status: failed | Text | "· tap to retry" on failed bubbles; tapping the bubble re-sends. |
| Composer input | Multiline TextInput | Placeholder `chat.typePlaceholder` (or "Loading…" when disabled); grows up to 120px; capped at 2000 chars; web outline disabled. Focus highlights the composer border. |
| Send button | Icon button | `send` icon; enabled only when chat ready + non-empty trimmed text; shows `ActivityIndicator` while `sending`; disabled style otherwise. |
| Char counter | Text | Shows `length / 2000`, appears at ≥1800 chars; turns red when at the 2000 cap. |
| Loading state | ActivityIndicator | Large spinner + "Loading conversation…" while `loading`. |
| Error state | Error block | `alert-circle-outline` + error message + "Retry" button (re-runs `init`). |
| Empty state | Empty block | `chatbubble-ellipses-outline` icon, "Say hello 👋", and a hint to message the seller. |
| Keyboard avoider | KeyboardAvoidingView | `padding` on iOS (offset ~88) / `height` on Android, so the composer stays above the keyboard. |

## Services, APIs & data
- **API endpoints (via `services/api`):**
  - Upsert chat (when no `chatId`): `POST /animals/:listingId/chat`.
  - Load messages: `GET /animals/chats/:chatId/messages?limit=100` (mount + every 8s poll).
  - Send message: `POST /animals/chats/:chatId/messages` body `{ text }`.
- **Backend route/service:** `backend/src/routes/animaltrade.routes.js` — `POST /:id/chat`, `GET /chats/:chatId/messages`, `POST /chats/:chatId/messages` (mounted at `/api/v1/animals`). Socket events handled by `backend/src/socket/chat.socket.js`.
- **Real-time:** `connectSocket()` from `services/socket`. Emits `join_chat`, `mark_read`; listens for `new_message` and `messages_read`. Polling is the fallback when the socket is disconnected.
- **State / context:** `useAuth()` (`user.id` to distinguish own vs counterpart messages and read receipts), `useLanguage()`, local `useState` + `useRef` (`flatListRef`, `pollTimerRef`), two `useFocusEffect` hooks (poll + socket).
- **Local / static data:** Constants `POLL_MS=8000`, `MAX_CHARS=2000`, `COUNTER_AT=1800`. Helpers: `formatTime`, `isSameState`, `mergeServerMessages`, `MessageBubble`.

## Languages / i18n
Limited i18n: `t()` keys `chat.online`, `chat.typePlaceholder` (both with English fallbacks). Most strings are hard-coded English: "Loading conversation…", "Retry", "Say hello 👋", the empty hint, "tap to retry", and "Conversation"/"Online". Multi-language support is therefore partial on this screen.

## Notes, edge cases & gaps
- **Optimistic send + retry:** messages appear instantly as pending; on network failure they flip to a tappable "failed" state that re-sends in place (no duplicate row).
- **Dual delivery (socket + poll):** socket is primary; the 8s poll covers socket downtime. `new_message` de-dupes against existing ids and reconciles optimistic temp rows by senderId+text.
- **Read receipts:** ✓✓ goes blue when the counterpart's `messages_read` arrives; the screen also marks incoming counterpart messages read on receipt and on join.
- **Image messages:** the inbox preview supports "📷 Photo" and the data model carries `imageUrl`, but this screen's composer has **no image/photo attach button** — it sends text only.
- **No voice input** on this chat (text composer only).
- **Char limit 2000**, enforced both by `maxLength` and by slicing in `onChangeText`.
- **Web key handling:** Enter sends, Shift+Enter inserts a newline.
- The in-body "Online" status is static (not driven by `user_online`/`user_offline` socket events).
