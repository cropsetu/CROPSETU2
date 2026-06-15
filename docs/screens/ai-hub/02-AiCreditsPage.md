# AI Credits (Credit Usage Dashboard)

> **Tab:** AI Assistant (`AIAssistant` bottom tab) · **Stack:** `AINavigator` (AIStack) · **Route name:** `AICredits` · **File:** `frontend/src/screens/AI/AICreditsScreen.js`

## Purpose
The AI credit usage dashboard. It shows the farmer's current AI credit balance and plan/tier, a usage progress bar, today's/monthly/lifetime stats, a per-feature credit cost table, optional buy-credits packs, and a recent transaction ledger. Farmers open it to understand why they're being charged for AI features and how many credits remain before the monthly refill.

## Where it sits / how you reach it
- **Reached from:** The **AI Credits card** on `AIAssistantHome` (`navigation.navigate('AICredits')`). Registered at `AppNavigator.js:363` inside `AINavigator`.
- **Navigates to:** Only **back** — the header back button calls `navigation.goBack()`. The future "Buy Credits" pack cards are `TouchableOpacity` but currently have **no `onPress`** (non-functional placeholder).
- **Route params in:** none.

## How it works
On mount, `useEffect` calls `load()`. `load(isRefresh)` sets `loading` (or `refreshing`), calls `getAICredits()`, stores the result in `data`, and clears the loading flags in `finally`. Errors are swallowed silently (empty `catch`). While `loading` is true the screen renders only a centered `ActivityIndicator`.

Once loaded, it derives display values from `data` with safe fallbacks:
- `balance` (`data.balance ?? 0`), `tier` (`tierLabel ?? 'Free'`), `monthly` (`monthlyAllowance ?? 100`), `spent` (`lifetimeSpent ?? 0`), `earned` (`lifetimeEarned ?? 100`), `todayUsed` (`todaySpent ?? 0`).
- `usedPct = min(100, round(spent / max(earned,1) * 100))` drives the usage bar width.
- `isLow = balance <= 10` toggles a red/danger color scheme across the balance value, tier badge, and bar.
- `txns = recentTransactions ?? []`, `costs = costs ?? {}`, `packs = packs ?? []`.

The body is a `ScrollView` with **pull-to-refresh** (`RefreshControl` → `load(true)`). It renders: a balance card, the credit-costs table (iterating `Object.entries(costs)`, humanizing keys like `ai_scan_gemini` → "Scan gemini"), an optional packs row (only when `packs.length > 0`), and the transactions section — which shows an empty state when there are no transactions, otherwise a list. Each transaction row picks an icon/color from the `TYPE_ICONS` map keyed by `txn.type`.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Header back button | Button | `chevron-back` icon → `navigation.goBack()`. |
| Header title + subtitle | Text | Title `aiCredits.title`; subtitle is `{tier}` + `aiCredits.plan` (e.g. "Free plan"). |
| Loading spinner | `ActivityIndicator` | Full-screen centered while `loading` is true. |
| Pull-to-refresh | `RefreshControl` | Triggers `load(true)` to re-fetch credits. |
| Balance card | Card | Available-credits label + big balance number (red when `isLow`). Border turns pink/`#FECACA` when low. |
| Tier badge | Badge | Flash icon + tier name; amber normally, red background when low. |
| Usage bar | Progress bar | Width = `usedPct`%; amber, red when low. Labels below: `{spent} used` and `{earned} total`. |
| Stats row | 3-stat row | Today (`todayUsed`), Monthly (`monthly` allowance), Lifetime (`spent`), separated by dividers. |
| "Credit Costs" section title | Text | `aiCredits.creditCosts`. |
| Cost table | List card | One row per entry in `costs`: type icon + humanized label + cost (`"FREE"` when `0`, else `"{n} cr"`). |
| "Buy Credits" section + pack cards | Conditional row of cards | Rendered only if `packs.length > 0`. Each card: flash icon, credit count, `aiCredits.credits` label, price pill `Rs {priceInr}`. **No onPress yet (placeholder).** |
| "Recent Activity" section title | Text | `aiCredits.recentActivity`. |
| Empty transactions state | Empty state | `receipt-outline` icon + `aiCredits.noActivity` text when `txns.length === 0`. |
| Transaction list | List card | One row per transaction. |
| Transaction row | List item | Type icon (from `TYPE_ICONS`), description, meta chips (`model`, `{tokens} tokens`, `${cost}` USD when present), formatted date (`en-IN`, day/month + time), and signed amount (green `+` for credits added, red for spend) with `aiChat.credits` label. |

**`TYPE_ICONS` map** (drives both cost-table and transaction icons): `ai_scan_gemini`, `ai_scan_claude`, `ai_chat_groq`, `ai_chat_claude`, `ai_pest_rule`, `ai_pest_haiku`, `ai_pest_sonnet`, `ai_voice`, `ai_translate`, `ai_planner`, `free_refill`, `purchase`, `admin_grant`, `referral`. Unknown types fall back to a neutral `ellipse` icon.

## Services, APIs & data
- **API endpoints:** `GET /api/v1/ai/credits` via `getAICredits()` in `services/aiApi.js`. Returns `{ balance, tierLabel, monthlyAllowance, lifetimeEarned, lifetimeSpent, todaySpent, recentTransactions[], costs{}, packs[] }`.
- **Backend route/service:** `backend/src/routes/ai.routes.js` → `router.get('/credits', authenticate, …)` (around line 1842) → `getCreditSummary(userId)` in `backend/src/services/aiCredit.service.js` (around line 388). Costs come from `CREDIT_COSTS` and packs from `CREDIT_PACKS` in that same service (packs: 100/₹49, 500/₹199, 1000/₹349, 5000/₹1499); `todaySpent` is computed from same-day negative-amount transactions. This Express credit ledger is the authoritative budget for AI spend.
- **State / context:** `useLanguage()` (`language`, `t`). Local `useState`: `data`, `loading`, `refreshing`. `load` is a memoized `useCallback`.
- **Local / static data:** `TYPE_ICONS` icon/color map; `COLORS`/`TYPE`/`SHADOWS` from `constants/colors`. Cost-row labels are derived by string-transforming the cost keys (`ai_` stripped, underscores → spaces, first letter capitalized) — they are **not** localized.

## Languages / i18n
Uses `useLanguage()` → `t()` with the `aiCredits.*` namespace (`title`, `plan`, `availableCredits`, `used`, `total`, `today`, `monthly`, `lifetime`, `creditCosts`, `free`, `buyCredits`, `credits`, `recentActivity`, `noActivity`). The per-credit-row label inside transactions reuses `aiChat.credits`. Defined for English/hi/mr in `translations.js` and the other languages under `i18n/lang/*.js`. Note: cost-table labels (e.g. "Scan gemini") are generated from the cost keys and are therefore English-only regardless of selected language; transaction dates are always formatted with the `en-IN` locale.

## Notes, edge cases & gaps
- **Silent error handling:** if `getAICredits()` throws, `data` stays `null`; loading clears and the screen renders with all the `?? fallback` defaults (balance 0, Free tier, monthly 100, empty cost table and transactions) — there is **no error message or retry UI**.
- **Low-balance state** (`balance <= 10`) recolors the balance, tier badge, and usage bar red and tints the card border.
- **Buy Credits is non-functional** — pack cards render only when the backend returns `packs`, and even then have no purchase handler (marked "future" in the source comment).
- **No auth handling here** — relies on `api.js` interceptors injecting the bearer token and refreshing it; an unauthenticated request would just be caught silently.
- The cost table renders whatever keys the backend sends, so legacy provider keys (e.g. `ai_chat_claude`, `ai_pest_sonnet`) may appear even in the Gemini-only stack if still present in `CREDIT_COSTS`.
