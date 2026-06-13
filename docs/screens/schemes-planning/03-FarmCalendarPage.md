# Farm Calendar

> **Tab:** AI Assistant · **Stack:** `AINavigator` (AIStack) · **Route name:** `FarmCalendar` · **File:** `frontend/src/screens/AI/FarmCalendarScreen.js`

## Purpose
An AI-generated, ICAR-based crop calendar with task tracking. A farmer creates a calendar per crop+season+sowing date; the backend generates a dated task schedule, and the screen surfaces today's due + overdue tasks for completion. It has three tabs: **Today** (due/overdue tasks across all active calendars), **Calendars** (list of created calendars with task counts), and **Create New** (a form to generate a new calendar).

## Where it sits / how you reach it
- **Reached from:**
  - Registered in `AppNavigator.js` as `<AIStack.Screen name="FarmCalendar" component={FarmCalendarScreen} />` (`headerShown: false`), inside the AI Assistant tab's stack.
  - No tile in `AIAssistantHome`'s `QUICK_SERVICES`/`AI_TOOLS` arrays targets `FarmCalendar`, and no `navigation.navigate('FarmCalendar')` exists elsewhere in `frontend/src/`. Like Daily Planner, it is wired into the AI stack but has no in-repo button pushing to it; reachable by route name via deep link / programmatic navigation.
- **Navigates to:**
  - **Back** — header back chevron calls `navigation.goBack()`. No outbound `navigation.navigate` calls; all in-screen movement is tab switching via local state.
- **Route params in:** none (reads only `navigation` from props).

## How it works
- Wrapped in `AnimatedScreen` (a reanimated `FadeIn` content wrapper).
- Key state: `tab` (`'today' | 'calendars' | 'create'`, default `'today'`), `todayTasks`, `calendars`, `crops`, `loading`, `creating`.
- **On mount / tab change** (`useEffect` keyed on `tab`): always loads the crop list via `getCrops().then(setCrops)`; if `tab === 'today'` calls `loadTasks()`, if `tab === 'calendars'` calls `loadCals()`.
- **`loadTasks()`** calls `getCalendarTodaysTasks()` which returns `{ today: [...], overdue: [...] }`; it tags overdue items with `status: 'overdue'` and today items with their existing status (or `'due'`), merges them (overdue first) into `todayTasks`. Errors are swallowed.
- **`loadCals()`** calls `getCropCalendars()` into `calendars`. Errors swallowed.
- **Complete / skip a task:** `TaskCard` buttons call `handleDone(taskId)` → `updateCalendarTask(taskId, 'completed')` then locally set status to `'done'`; `handleSkip(taskId)` → `updateCalendarTask(taskId, 'skipped')` then local status `'skipped'`. Both ignore API errors and just update local state.
- **Create flow (`CreateCalendar` sub-component):** local state `cropName`, `sowingDate`, `season` (default `'kharif'`), `cropModal`, `loading`, `error`. `handleCreate()` validates that crop and sowing date are present, then calls `generateCropCalendar({ crop, season, sowingDate, fieldName: '' })`. On success the parent's `onCreated` switches to the `calendars` tab and reloads it; on failure it shows the API error message (or "Generation failed"). The crop picker opens a bottom-sheet `Modal` with a searchable `FlatList` of crops (name + Hindi name).
- **Loading & status icons:** each tab shows a centered `ActivityIndicator` while `loading`. `TaskCard` maps `task.status` to a color/icon via `STATUS_CONFIG` (upcoming/pending/due/overdue/completed/done/skipped) and renders done/skipped tasks dimmed without action buttons.

## UI elements

| Element | Type | Description / action |
|---|---|---|
| Back button | `TouchableOpacity` + `chevron-back` | Header left; `navigation.goBack()`. |
| Header title + subtitle | Text (`farmCalendar.farmCalendar`, `farmCalendar.icarbasedTaskSchedule`) | Screen heading. |
| Tab bar | Horizontal `ScrollView` of `TouchableOpacity` chips | Three tabs: `todaysTasks`, `calendars`, `createNew`; active chip highlighted. |
| **Today tab** task list | `FlatList` of `TaskCard` | Due + overdue tasks; empty → `calendar-outline` + `noTasksForToday` + `createFromTab`. |
| Task status icon | `Ionicons` in tinted square | Per `STATUS_CONFIG` (time/alert/warning/checkmark/close). |
| Task name / crop / date / notes | Text | Title (`task.title`/`task.task`), crop, scheduled date (overdue tagged with `farmCalendar.overdue`), description (2 lines). |
| Done button | `TouchableOpacity` (`checkmark`) | `handleDone(task.id)` → mark completed. Hidden when already done/skipped. |
| Skip button | `TouchableOpacity` (`close`) | `handleSkip(task.id)` → mark skipped. Hidden when already done/skipped. |
| **Calendars tab** list | `FlatList` of calendar cards | Each shows leaf icon, crop, `season · year · Sown <date>`, and total task count (`farmCalendar.tasks`). |
| Calendars empty state | Icon + `noCalendarsYet` + "Create New" button | Button calls `setTab('create')`. |
| **Create tab** form | `CreateCalendar` view inside a `ScrollView` | Form to generate a calendar. |
| Crop select | `TouchableOpacity` (`leaf-outline` + chevron) | Opens crop picker modal; label `farmCalendar.selectCrop` until chosen. |
| Season chips | 3 `TouchableOpacity` chips | `kharif` / `rabi` / `summer` (`farmCalendar.season_*`); single-select, default kharif. |
| Sowing date input | `TextInput` | `YYYY-MM-DD`; required (`farmCalendar.sowingDate`). |
| Error text | Text | Validation / generation error (`cropAndDateRequired` or API message). |
| Cancel button | `TouchableOpacity` (`farmCalendar.cancel`) | Calls `onCancel` → back to `calendars` tab. |
| Create/Generate button | `TouchableOpacity` (`farmCalendar.create` / spinner) | `handleCreate()` → `generateCropCalendar(...)`; spinner + `disabled` while loading. |
| Crop picker modal | bottom-sheet `Modal` + `FlatList` | Lists crops (name + `nameHi`); tap selects and closes; close button (`farmCalendar.cancel`). |

## Services, APIs & data
- **API endpoints (via `services/aiApi.js`):**
  - `GET /calendar/today` — `getCalendarTodaysTasks()` (Today tab; returns `{ today, overdue }`).
  - `GET /calendar` — `getCropCalendars()` (Calendars tab).
  - `POST /calendar/generate` — `generateCropCalendar({ crop, season, sowingDate, fieldName })` (Create tab, 20s timeout).
  - `PATCH /calendar/tasks/:taskId` — `updateCalendarTask(taskId, status)` (done/skip).
  - `GET /crops` — `getCrops()` (crop picker options).
- **Backend route/service:** `backend/src/routes/calendar.routes.js` (`POST /generate`, `GET /today`, `GET /`, `GET /:id`, `PATCH /tasks/:taskId`, `DELETE /:id`); calendar generation is backed by `cropCalendar.service.js`. Crop list comes from the `/crops` route. Auth token injected via `api.js` interceptors.
- **State / context:** `useLanguage()` for `language` + `t()`; local `useState` for tab, lists, and form fields; `useCallback` memoized loaders. No AuthContext / writeQueue / socket.
- **Local / static data:** `STATUS_CONFIG` (status→color/icon map) and the season options `['kharif','rabi','summer']`. All tasks, calendars and crops are fetched from the backend.

## Languages / i18n
- Uses the `farmCalendar.*` namespace. Keys seen: `farmCalendar`, `icarbasedTaskSchedule`, `todaysTasks`, `calendars`, `createNew`, `overdue`, `noTasksForToday`, `createFromTab`, `noCalendarsYet`, `tasks`, `newCropCalendar`, `selectCrop`, `season_kharif`/`season_rabi`/`season_summer`, `sowingDate`, `cropAndDateRequired`, `cancel`, `create`.
- The `farmCalendar` namespace is defined in `src/i18n/translations.js` (English, Hindi, Marathi) plus the per-language files (`bn, gu, kn, ml, pa, ta, te`). Crop names show an English `name` and optional `nameHi` from the API.

## Notes, edge cases & gaps
- **Date entry is a raw text field** (`YYYY-MM-DD`) with no date picker — invalid formats are only caught by the backend, not validated client-side beyond "non-empty".
- **`fieldName` is always sent empty** on creation; there is no field/plot selector in the form.
- **Errors are largely swallowed:** Today and Calendars loaders catch and ignore errors (just stop the spinner); done/skip ignore API failures and optimistically mutate local state. Only the Create form surfaces an error message.
- Empty states exist for both Today (no tasks) and Calendars (no calendars, with a shortcut to Create); each tab shows a spinner while loading.
- `creating` state is declared but not used for any visible behavior in the current code.
- The crop picker `FlatList` and task lists use virtualization tuning (`windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`) for performance on long lists.
