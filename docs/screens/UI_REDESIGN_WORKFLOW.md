# UI Redesign Workflow — Screen Docs → Lovable → Claude → Production Code

A repeatable, **feature-by-feature** process to redesign the CropSetu / KhetAI app UI:

1. Use the per-screen docs in this folder as the **spec**.
2. Have **Lovable** generate a polished UI for one feature flow.
3. Download Lovable's code to your **desktop**.
4. Use **Claude Code** (in this real repo) to **port the visual style** into the existing screens — **frontend only, no backend or logic changes** — production-ready.

> Share this file with your colleague. It explains the whole flow and gives the two copy-paste prompts (one for Lovable, one for Claude).

---

## ⚠️ Read this first — Lovable is web, our app is React Native

- **Lovable builds web apps** (React + Vite + Tailwind/shadcn).
- **Our app is React Native + Expo** (`StyleSheet`, no Tailwind/CSS, no `className`, no DOM).

So we **do NOT copy Lovable's code**. We treat Lovable's output as a **high-fidelity design reference** and **translate the design language** (colors, fonts, spacing, radii, shadows, component look, layout) into our React Native screens using our existing design system:

- Theme tokens: [`frontend/src/constants/khetTheme.js`](../../frontend/src/constants/khetTheme.js) → `KHET` (colors), `KFONT` (fonts), `KSHADOW`
- Brand: deep **forest green `#005f21`** + warm **gold `#e0af3b`**, cream backgrounds
- Fonts: **Fraunces** (display/headings), **Plus Jakarta Sans** (body), Inter (fallback)
- Reference screen (the look to match): `frontend/src/screens/Auth/LoginScreen.js`

Claude handles this translation for you — the prompt below tells it exactly how.

---

## The flow (steps)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  THIS REPO (spec)            LOVABLE (design)         DESKTOP        CLAUDE   │
│                                                                              │
│  docs/screens/<feature>/  ─► paste into Lovable  ─►  download repo ─► port   │
│   01-..Page.md  (elements)     prompt → build UI      to ~/Desktop    style   │
│                                iterate visually        /lovable-...   into RN │
│                                                                       screens │
│                                                          │            (no BE) │
│                                                          ▼                    │
│                                                   run app · compare · commit  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Step 0 — Prep (once).**
- Make sure this repo is pushed and clean (`git status`).
- Decide the order of features to redesign (suggest: Auth → Onboarding → AgriStore → … using the folder order in [README.md](README.md)).

**Step 1 — Pick ONE feature flow.**
Work one folder at a time (e.g. `agristore/` = Home → Product → Cart → Checkout → OrderConfirmed). Open its `.md` files; the **"UI elements"** table in each is what Lovable needs.

**Step 2 — Build the Lovable prompt.**
Copy the **Lovable Prompt Template** (below). Fill in the feature name, the screen list (in flow order), and paste each screen's **UI elements** table from its doc.

**Step 3 — Generate & iterate in Lovable.**
Paste the prompt into Lovable. Review the result on a phone-sized viewport. Iterate with short follow-ups ("make the product cards taller", "use the gold accent for the price", "bigger tap targets") until the look is right. Keep it mobile-first.

**Step 4 — Get the code onto your desktop.**
In Lovable: **GitHub → connect/export**, then clone it, **or** use Lovable's "Download / Export code" and unzip. Put it at a known path, e.g.:
```
~/Desktop/lovable-<feature>/      (e.g. ~/Desktop/lovable-agristore/)
```

**Step 5 — Open THIS repo in Claude Code.**
Open `CROPSETU2` in Claude Code (not the Lovable folder). Claude will *read* the Lovable folder but *edit* our repo.

**Step 6 — Run the Claude porting prompt.**
Copy the **Claude Porting Prompt** (below), fill in the 3 placeholders (Lovable dir, feature, screen mapping), and send it. Claude translates the Lovable design into our RN screens, frontend-only.

**Step 7 — Verify.**
- Run the app (`/run` in Claude, or `npx expo start`) and compare against the Lovable reference.
- Confirm **no** changes under `backend/`, `frontend/src/services/`, navigation logic, or API calls (`git diff --stat`).

**Step 8 — Commit per feature.**
`docs/style: redesign <feature> UI to match Lovable reference` — one commit per feature so it's easy to review/revert.

Then repeat Step 1 for the next feature.

---

## Lovable Prompt Template (copy, fill, paste into Lovable)

```
Build a polished, production-grade, MOBILE-FIRST UI for the "<FEATURE NAME>" flow of
an Indian farmer super-app called KhetAI / CropSetu. This is a visual design reference
— do not build any backend; mocked/static data is fine.

BRAND & STYLE (match exactly):
- Primary: deep forest green #005f21. Accent: warm gold #e0af3b. Backgrounds: cream / off-white.
- Headings/display font: Fraunces (serif). Body font: Plus Jakarta Sans.
- Feel: warm, trustworthy, modern, high-contrast, LARGE tap targets, usable by
  low-literacy rural users, multi-language ready. Rounded cards, soft shadows,
  clear visual hierarchy, generous spacing.
- Phone viewport. Include empty, loading, and error states where relevant.

SCREENS TO BUILD (in this exact flow order):
1. <Screen 1 name>
2. <Screen 2 name>
...

For EACH screen, lay out exactly these elements (from our spec):

### <Screen 1 name>
<paste the "UI elements" table from docs/screens/<feature>/01-...Page.md>

### <Screen 2 name>
<paste the "UI elements" table from docs/screens/<feature>/02-...Page.md>

...

Keep navigation between these screens working as a clickable prototype. Use a shared
design system (tokens for color/spacing/typography) so all screens look consistent.
```

**Tip:** do ONE feature flow per Lovable project so the design stays focused and the download is small.

---

## Claude Porting Prompt (copy, fill 3 placeholders, paste into Claude Code in THIS repo)

```
You are improving the UI of our React Native (Expo) app by porting the VISUAL DESIGN
from a Lovable-generated web prototype into our existing screens. This is a
FRONTEND-STYLE-ONLY task — production quality.

INPUTS
- Lovable web prototype (design reference, READ ONLY, do not edit): <LOVABLE DIR, e.g. ~/Desktop/lovable-agristore>
- Feature: <FEATURE NAME, e.g. AgriStore (Shop)>
- Screen mapping (Lovable screen  ->  our RN file  ->  our spec doc):
    <Lovable "Home"      -> frontend/src/screens/AgriStore/AgriStoreHome.js   -> docs/screens/agristore/01-HomePage.md>
    <Lovable "Product"   -> frontend/src/screens/AgriStore/ProductDetail.js   -> docs/screens/agristore/02-ProductPage.md>
    <...one line per screen...>

WHAT TO DO
1. Study the Lovable prototype's design system: read its Tailwind config / CSS variables /
   component classes and extract the palette, typography scale, spacing, border-radius,
   shadows, and the visual patterns for buttons, cards, inputs, headers, chips, list
   items, badges, and empty/loading states. Summarize it before editing.
2. Reconcile it with OUR design system in frontend/src/constants/khetTheme.js
   (KHET colors, KFONT fonts, KSHADOW). PREFER reusing/extending existing tokens; only add
   new tokens to khetTheme.js when the Lovable design genuinely needs them (and say which).
   Our reference implementation of the intended look is frontend/src/screens/Auth/LoginScreen.js.
3. For each target screen, restyle it to MATCH the Lovable look using React Native only
   (StyleSheet / our shared UI components / theme tokens). Re-implement layout, spacing,
   colors, typography, cards, buttons, etc. Translate web → RN correctly:
   NO className, NO Tailwind, NO CSS, NO DOM elements, NO web-only props; use RN
   <View>/<Text>/<Image>/<Pressable>/<ScrollView>/<FlatList> and StyleSheet.

HARD GUARDRAILS — DO NOT CHANGE ANY OF THESE:
- backend/ (anything)
- frontend/src/services/ and all API calls / endpoints / data shapes
- navigation routes, route names, or navigation logic in AppNavigator.js / navigators
- component logic: state, hooks, effects, data fetching, handlers, props contracts
- i18n keys and translation usage (keep every t('...') call; restyle, don't relabel)
- redux/context wiring, permissions, analytics
Only JSX structure (for layout) and styles may change. Keep ALL existing functionality,
data, and behavior identical. Do not add npm dependencies without asking first.

WORKING STYLE
- Do ONE screen at a time. After each screen, show: a short summary of the visual
  changes, any new khetTheme tokens added, and a `git diff --stat` proving only frontend
  screen/theme files changed (no backend/services).
- If something in the Lovable design can't be translated to RN cleanly, list it instead
  of forcing it.
- At the end: run the app (or build) to confirm it renders, and give a per-screen
  before/after summary plus a list of any follow-ups.

START by reading the Lovable dir and the first screen's spec doc, summarize the extracted
design system, then restyle the first screen and stop for my review before continuing.
```

---

## Guardrails recap (what must never change)

| ✅ Claude MAY change | ❌ Claude must NOT touch |
|---|---|
| Screen JSX layout & styles | `backend/**` |
| `frontend/src/constants/khetTheme.js` (extend tokens) | `frontend/src/services/**`, API calls, endpoints |
| Shared UI components' **visuals** | Navigation routes / logic |
| Spacing, color, typography, cards, buttons | Component logic, hooks, data fetching, props |
| Empty/loading visual states | i18n keys, data shapes, business rules |

Quick proof after each feature:
```bash
git diff --stat                 # should list only frontend screen/theme files
git diff -- backend frontend/src/services   # should be EMPTY
```

---

## Per-feature tracking checklist

| Feature (folder) | Lovable built | Downloaded to desktop | Claude ported | App verified | Committed |
|---|---|---|---|---|---|
| auth | ☐ | ☐ | ☐ | ☐ | ☐ |
| onboarding | ☐ | ☐ | ☐ | ☐ | ☐ |
| agristore | ☐ | ☐ | ☐ | ☐ | ☐ |
| animaltrade | ☐ | ☐ | ☐ | ☐ | ☐ |
| rent | ☐ | ☐ | ☐ | ☐ | ☐ |
| seller | ☐ | ☐ | ☐ | ☐ | ☐ |
| account | ☐ | ☐ | ☐ | ☐ | ☐ |
| weather | ☐ | ☐ | ☐ | ☐ | ☐ |
| ai-hub | ☐ | ☐ | ☐ | ☐ | ☐ |
| market-prices | ☐ | ☐ | ☐ | ☐ | ☐ |
| schemes-planning | ☐ | ☐ | ☐ | ☐ | ☐ |
| calculators-irrigation | ☐ | ☐ | ☐ | ☐ | ☐ |
| soil | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## Worked example — Auth feature

**Lovable prompt** uses `docs/screens/auth/` → screens in flow order: Login (Welcome→Phone→OTP), Landing, Phone Entry, OTP Verification. Paste each file's UI-elements table.

**Claude prompt** mapping:
```
Lovable "Login"  -> frontend/src/screens/Auth/LoginScreen.js              -> docs/screens/auth/01-LoginPage.md
Lovable "Phone"  -> frontend/src/screens/Auth/PhoneLogin/PhoneEntryScreen.js -> docs/screens/auth/03-PhoneEntryPage.md
Lovable "OTP"    -> frontend/src/screens/Auth/PhoneLogin/OtpVerificationScreen.js -> docs/screens/auth/04-OtpVerificationPage.md
```
LoginScreen.js is already the design reference, so Auth is the safest feature to start with.
