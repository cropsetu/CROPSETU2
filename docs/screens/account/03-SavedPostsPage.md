# Saved Posts

> **Tab:** Account · **Stack:** ProfileStack · **Route name:** `SavedPosts` · **File:** `frontend/src/screens/Profile/SavedPostsScreen.js`

## Purpose
Shows the community posts the user has bookmarked, as a scrollable list of post cards. Each card shows the post image (if any), a category badge, date, title, a short description, the author (avatar + name), and a filled bookmark icon indicating it's saved. Lets the farmer revisit content they marked from the community feed.

## Where it sits / how you reach it
- **Reached from:** Account home (`ProfileScreen`) — the "Saved Posts" quick tile (`navigation.navigate('SavedPosts')`). Registered in `ProfileStack` as `SavedPosts`.
- **Navigates to:** Only `navigation.goBack()` via the header back button. (Post cards are display-only — no tap-through to a post detail screen.)
- **Route params in:** none.

## How it works
On mount (`useEffect`) it calls `fetchPosts(1)`. Pagination is page/offset-based: `GET /community/saved?page=<p>&limit=20`. `hasMore` is computed as `page < meta.totalPages`. New pages append unless it's a refresh or page 1 (which replaces).

Key state: `posts`, `loading`, `refreshing`, `page`, `hasMore`, `error`.

Interactions: pull-to-refresh (`RefreshControl` → `fetchPosts(1, true)`); infinite scroll (`onEndReached` → `handleLoadMore`, which fetches `page + 1` when `hasMore && !loading`). Full-screen `ActivityIndicator` on initial load; inline footer spinner while more pages remain. Errors set `error` and render a retry view.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header | View with back button + title | Title "Saved Posts"; back → `navigation.goBack()`. |
| Back button | `TouchableOpacity` (arrow-back icon) | Returns to account home. |
| Post list | `FlatList` | Renders `PostCard` per post; `removeClippedSubviews`, windowed. |
| Post card | `PostCard` (View) | One per saved post; display-only (not tappable). |
| Post image | Image (conditional) | First image of the post, full-width 160px, cover. |
| Category badge | View + Text | Tinted pill colored by `CATEGORY_COLORS` (TIP/QUESTION/NEWS/SALE/COMMUNITY); falls back to "POST". |
| Date | Text | `post.createdAt` formatted `dd MMM yyyy` (en-IN). |
| Title | Text | `post.title` (or "Untitled"), up to 2 lines. |
| Description | Text (conditional) | Up to 3 lines. |
| Author row | View | Author avatar (or person-icon placeholder) + name (or "Farmer"). |
| Bookmark icon | Ionicon | Filled bookmark (primary color) indicating the post is saved. |
| Pull-to-refresh | `RefreshControl` | Reloads page 1. |
| Footer spinner | `ActivityIndicator` | Shown while `hasMore`. |
| Empty state | View | Bookmark-outline icon + "No saved posts yet" / "Bookmark community posts to see them here". |
| Error state | View | Alert icon + message + "Retry" button. |
| Loading state | `ActivityIndicator` | Full-screen on initial load. |

## Services, APIs & data
- **API endpoints (via `services/api.js`, base `/api/v1`):**
  - `GET /community/saved?page=<p>&limit=20` — paginated list of bookmarked community posts. Reads `data.data` (posts) and `data.meta.totalPages`.
- **Backend route/service:** Community routes (`backend/src/routes/community.*`) — the `/community/saved` endpoint. Not `user.routes.js`.
- **State / context:** Local `useState`/`useCallback` only. No AuthContext, LanguageContext, socket, or writeQueue usage in this file.
- **Local / static data:** `CATEGORY_COLORS` map (post category → color) and color constants from `constants/colors`.

## Languages / i18n
No i18n — this screen does **not** import `useLanguage`. All visible strings ("Saved Posts", "No saved posts yet", "Bookmark community posts to see them here", "Retry", "Farmer", "Untitled") are hardcoded English. Category labels render the raw `post.category` value.

## Notes, edge cases & gaps
- Post cards are display-only — there is no navigation to a post detail / community thread, and no in-screen unsave/unbookmark action (the bookmark icon is decorative here).
- Pagination relies on `meta.totalPages`; if the API omits it, `hasMore` defaults to `1 > 1 = false` (single page assumed).
- `handleLoadMore` guards on `!loading` but not on a separate `loadingMore` flag, so a fast scroll could in theory request the same next page more than once (low risk given `loading`/list state).
- No offline/writeQueue handling — failures surface the generic error view with Retry.
