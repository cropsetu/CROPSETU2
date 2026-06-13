# Loan Calculator

> **Tab:** AI Assistant (`AIAssistant`) · **Stack:** `AINavigator` (AIStack) · **Route name:** `LoanCalculator` · **File:** `frontend/src/screens/AI/LoanCalculatorScreen.js`

> **Note:** Although the component is `LoanCalculatorScreen`, it is **not** currently registered in `AppNavigator.js` (the AI stack imports/registers `InputCalculatorScreen` and `IrrigationScreen` but no `LoanCalculator` screen). An i18n service tile `aiHome.tools.loan` ("Loan Calculator / KCC eligibility & EMI") exists but is not rendered in the home grids. The intended route name is `LoanCalculator` per the component, but no live navigation path to it was found in the current code.

## Purpose
A three-in-one agricultural-finance tool. Tab 1 estimates a farmer's **Kisan Credit Card (KCC) limit** from crop + area + state (NABARD scale-of-finance). Tab 2 is a reducing-balance **EMI calculator** (principal, interest rate, tenure). Tab 3 is a **bank comparison** list showing each bank's KCC interest rate. Used by farmers checking borrowing eligibility and loan affordability.

## Where it sits / how you reach it
- **Reached from:** No in-app navigator entry was found — the screen is not in `AINavigator`'s screen list, and no `navigate('LoanCalculator')` call exists in `src/screens`. (The matching `aiHome.tools.loan` tile is defined in i18n but not wired into the rendered service grids.) When wired, it would live in the AI stack like its sibling calculators.
- **Navigates to:** Only `navigation.goBack()` (header back chevron). No outbound navigation.
- **Route params in:** none — reads no `route.params`. It does read `user?.state` from `AuthContext` to seed the default KCC state.

## How it works
- **Tabs:** `tab` state defaults to `'kcc'`; a horizontal scroll of three pill buttons (`kcc`, `emi`, `banks`) switches the active form.
- **KCC tab state:** `kccCrop`, `kccArea`, `kccState` (defaults to `user?.state || 'Maharashtra'`), `kccResult`, `kccLoading`, `kccError`.
- **EMI tab state:** `principal`, `rate` (default `'4'`), `tenure` (default `'12'`), `emiResult`, `emiLoading`.
- **Banks tab state:** `banks`, `banksLoading`.
- **Lazy bank load:** a `useEffect` keyed on `tab` fetches `getLoanBankComparison()` the first time the Banks tab is opened (only if `banks.length === 0`); it accepts either `{ banks: [...] }` or a raw array and stores `[]` on error.
- **`calcKCC`:** requires both crop and area (else sets `kccError`); calls `calculateLoanKCC({ crop, area, unit: 'acre', state })`, stores result. Renders a KCC-limit card, a breakdown card (key/value rows from `kccResult.breakdown`), an ineligibility card when `kccResult.eligibility === false`, and an optional note.
- **`calcEMI`:** no-ops if `principal` is empty; calls `calculateLoanEMI({ principal, annualRate, tenureMonths })` and renders a 2×2 grid of result boxes (Monthly EMI [highlighted], Total Amount, Total Interest, Interest %). On error it resets `emiResult` to `null`.
- **Loading/error handling:** each calculate button shows an `ActivityIndicator` and is disabled while its `*Loading` flag is set. KCC errors render as a red inline line; EMI errors are swallowed (result simply stays null). Banks tab shows a centered spinner while loading and a `ListEmptyComponent` message when empty.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back chevron | Header button | `navigation.goBack()` |
| Header title + subtitle | Text | `t('loanCalc.loanCalculator')` / "KCC · EMI · `t('loanCalc.bankCompare')`" |
| Tab bar | Horizontal `ScrollView` of 3 pill buttons | `KCC Eligibility` / `EMI Calc` / `Banks`; active pill highlighted |
| **KCC tab** — Crop name input | `TextInput` | `kccCrop`; placeholder "Crop name (e.g. Wheat, Cotton)" |
| KCC area input | `TextInput` (`decimal-pad`) | `kccArea`; placeholder "Area (acres)" |
| KCC state field | Read-only `View` (text) | Displays `kccState` (defaults from `user.state`); **not editable in this screen** |
| KCC error text | Text (red) | Validation/API error, conditional |
| Check Eligibility button | Primary button | `calcKCC`; spinner + disabled while loading; label `t('loanCalc.checkEligibility')` ("Check Eligibility →") |
| KCC result card | Card | "KCC Limit" + `₹kccResult.kccLimit` + "Estimated credit limit" |
| KCC breakdown card | Card | Key/value rows from `kccResult.breakdown` (values formatted with `toLocaleString` if numeric) |
| Ineligible card | Card (red, close-circle icon) | Shown when `kccResult.eligibility === false`; shows `reason` |
| KCC note | Text | `* {kccResult.note}` when present |
| **EMI tab** — Loan amount input | `TextInput` (`numeric`) | `principal`; label `t('loanCalc.loanAmount')`, placeholder "e.g. 100000" |
| EMI interest rate input | `TextInput` (`decimal-pad`) | `rate` (default 4); label `t('loanCalc.interestRatePa')` |
| EMI tenure input | `TextInput` (`numeric`) | `tenure` (default 12); label `t('loanCalc.tenureMonths')` |
| Calculate EMI button | Primary button | `calcEMI`; spinner + disabled while loading; label `t('loanCalc.calculateEmi')` ("Calculate EMI →") |
| EMI result grid | 2×2 grid of stat boxes | Monthly EMI (highlighted), Total Amount, Total Interest, Interest % |
| KCC info card | Card (info icon) | Static text `t('loanCalc.kccInfo')` explaining the 4% KCC rate + 3% rebate |
| **Banks tab** — loading spinner | `ActivityIndicator` | Shown while `banksLoading` |
| Banks list | `FlatList` of bank cards | Each card: `item.bank` name, `item.type`, `item.kccRate`% + "KCC Rate" label |
| Banks empty state | `ListEmptyComponent` text | `t('loanCalc.bankDataNotAvailable')` ("Bank data not available") |

## Services, APIs & data
- **API endpoints (all via `services/aiApi.js`, shared `api` axios instance, base `API_BASE_URL`, auth via interceptors):**
  - `POST /loan/kcc-eligibility` via `calculateLoanKCC(loanData)` — body `{ crop, area, unit:'acre', state }`; returns `{ kccLimit, breakdown, eligibility, reason, note }`.
  - `POST /loan/emi` via `calculateLoanEMI(emiData)` — body `{ principal, annualRate, tenureMonths }`; returns `{ emi, totalAmount, totalInterest, interestPercentage }`.
  - `GET /loan/compare` via `getLoanBankComparison()` — returns `{ banks: [...] }` or a raw array of `{ bank, type, kccRate }`.
- **Backend route/service:** `backend/src/routes/loan.routes.js`. All three computations (KCC scale of finance, EMI reducing-balance math, bank list) are **server-side** — the screen performs **no local loan math**.
- **State / context:** `useAuth()` (reads `user.state` for default KCC state) and `useLanguage()` (for `t`); all form/result state is local `useState`. No writeQueue or socket.
- **Local / static data:** `STATES` array (`['Maharashtra','Punjab',…]`) — declared at module top but **not actually consumed** in the rendered JSX (the state field is a non-interactive display only). `COLORS` from `constants/colors`. Wrapped in `AnimatedScreen`.

## Languages / i18n
Uses the `loanCalc.*` namespace via `useLanguage().t` (e.g. `loanCalc.loanCalculator`, `kccEligibility`, `emiCalc`, `banks`, `checkEligibility`, `calculateEmi`, `kccLimit`, `monthlyEmi`, `totalInterest`, `kccInfo`, `bankDataNotAvailable`, etc.), defined across language blocks in `frontend/src/i18n/translations.js` → multi-language. Some placeholders are hard-coded English strings ("e.g. 100000", "e.g. 4 (KCC rate)", "e.g. 12").

## Notes, edge cases & gaps
- **Not navigable:** the most notable gap — the screen exists and is fully built but is not registered in `AppNavigator.js` and has no `navigate()` entry point, so it is effectively dead/unreachable in the current build.
- **State field is display-only:** `kccState` defaults from the user profile and there is no picker to change it in-screen, despite a `STATES` constant being declared (unused).
- **EMI errors silent:** a failed `/loan/emi` call clears the result without any user-visible error message.
- **Banks lazy-load once:** banks are only fetched on first visit to the tab; no pull-to-refresh or retry on failure (a failed fetch yields an empty list → empty-state message).
- **Offline:** no caching or offline fallback.
- No image picker, voice, or socket usage on this screen.
