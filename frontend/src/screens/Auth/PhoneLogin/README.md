# CropSetu · Phone-Login Experience

A production-grade, **phone + OTP** login built for Indian farmers across a wide
range of ages, literacy, device quality, network speed and bright outdoor light.
UI/UX only — no API calls, no token storage, no auth logic. Sending/verifying is
delegated to clean handler props (`onSendOtp`, `onVerifyOtp`, `onResendOtp`).

```
PhoneLogin/
├─ index.js                 # public exports (default = <LoginFlow/>)
├─ LoginFlow.js             # the two screens assembled + handler STUBS (demo-ready)
├─ PhoneEntryScreen.js      # Screen 1 — phone entry
├─ OtpVerificationScreen.js # Screen 2 — OTP verification
├─ theme.js                 # design tokens (light + dark) + useAuthTheme()
├─ strings.js               # one localizable strings object + t() stub
├─ components/
│  ├─ AuthScreenLayout.js   # gradient hero, brand, step dots, keyboard, footer slot
│  ├─ PhoneInput.js         # +91 prefix, grouped entry, animated focus, inline error
│  ├─ OtpInput.js           # 6 boxes over one hidden input; shake/success/verify states
│  └─ PrimaryButton.js      # harvest-gold CTA, loading w/o layout shift, disabled colour
└─ README.md
```

## Quick start

```jsx
import LoginFlow from './screens/Auth/PhoneLogin';

// Self-contained demo (simulated latency; OTP "123456" succeeds, else shakes):
<LoginFlow onComplete={() => navigation.replace('Home')} onGuest={enterGuest} />
```

Wire it to the real backend by passing handlers (each may reject → the screen
maps the failure to friendly copy):

```jsx
<LoginFlow
  t={useLanguage().t}                       // inject the app's translator (optional)
  forceScheme={undefined}                   // omit → follow the OS color scheme
  onSendOtp={(phone)        => api.sendOtp(phone)}
  onVerifyOtp={(phone, otp) => api.verifyOtp(phone, otp)}   // store token here
  onResendOtp={(phone)      => api.sendOtp(phone)}
  onComplete={() => navigation.replace('Onboarding')}
  onGuest={enterGuestMode}
/>
```

Requires a `SafeAreaProvider` ancestor (already present app-wide in `App.js`)
and the Inter fonts loaded via `@expo-google-fonts/inter` (also already in
`App.js`). No new dependencies are introduced.

## Design rationale

- **Audience-first.** Large tap targets (everything interactive is ≥ 48 dp via
  size or `hitSlop`), high contrast for sunlight, generous spacing, minimal
  text, recognizable lucide iconography, and forgiving interactions (errors
  clear as you edit; the OTP auto-clears and refocuses after a wrong code).
- **Trust.** The screen asks for a phone number, so it leads with the brand, a
  shield-backed safety line, and masks the number on screen 2 (only the last 4
  digits are shown).
- **One focal action.** A single harvest-gold CTA is the only gold element on the
  screen, so the next step is never ambiguous. Disabled state is a real **colour**
  change (gold → muted sand) — not just opacity — so it survives sunlight and
  colour-blind vision.
- **No layout jump.** Loading swaps the button's inner content while the box
  keeps its exact size; OTP state changes only recolour boxes, never resize them.
- **Multilingual-ready.** Every string flows through `t('auth.*')` and lives in
  one object (`strings.js`, `en` + a deliberately verbose `hi` for testing).
  Layouts use flexible widths, wrapping and generous line-heights, and were sized
  to survive ~1.6× text and OS font scaling without truncation.

## The token scale (`theme.js`)

Tokens are the only source of dimensions/colours — components never hard-code a
value. Device scaling (`s/vs/fs`) is applied where tokens are consumed.

| Token group | Values |
|---|---|
| **Spacing** (4 px sub-grid) | `xs 4 · sm 8 · md 12 · base 16 · lg 20 · xl 24 · xxl 32 · xxxl 40` |
| **Radius** | `sm 8 · md 12 · lg 16 · xl 20 · xxl 28 · pill 999` |
| **Motion** (ms) | `fast 150 · base 200 · slow 280` (springs come from shared `motion.js`) |
| **Type ramp** | `display 30 · title 22 · subtitle 16 · body 16 · button 17 · label 14 · helper 13 · caption 12 · otpDigit 26` — all Inter |
| **Min tap** | `48` |

**Colour roles** (identical keys in both modes, so components never branch on
scheme): `primary / primaryDim / leaf / primaryWash` (greens), `earth` (warm
neutral), `accent / onAccent / accentDisabledBg` (harvest gold CTA), `surface /
surfaceAlt / surfaceFocus`, `border / borderFocus`, `text{Primary,Secondary,
Tertiary,Placeholder}`, `onHero / onHeroDim` (over the gradient), and status
sets `success* / error*`. Contrast targets **WCAG AA** for UI/body and **AAA**
for the largest copy and the CTA label.

## How to theme it

- **Mode** — `useAuthTheme()` follows the OS scheme by default. Wrap in
  `<AuthThemeProvider scheme="dark">` to pin a mode, or pass `forceScheme` to
  `<LoginFlow/>`. Both light and dark are fully designed.
- **Rebrand** — edit the `LIGHT` / `DARK` palettes in `theme.js`. Because every
  component reads semantic roles (`theme.accent`, not `#F2A20C`), swapping the
  gold or greens reskins the whole flow.
- **Re-scale** — change `SPACE` / `RADIUS` / `RAMP`; all components reflow.
- **Localize** — add a language table to `STRINGS` in `strings.js`, or inject the
  app's translator via `<AuthStringsProvider t={appT}>` / `<LoginFlow t={appT}>`.

## States covered

`default · focused · filled/valid · invalid · loading/submitting · disabled ·
network-error · success · keyboard-open · slow-network` — across both screens,
both color schemes, and with **reduce-motion** honoured (every animation becomes
instant). Errors are announced to screen readers
(`accessibilityLiveRegion` + `announceForAccessibility`); state is never signalled
by colour alone — it is always paired with an icon and text.

## Notes

- **OTP architecture** — six visual boxes are rendered over a *single* hidden
  `TextInput`, giving paste, iOS/Android SMS-autofill (`textContentType=
  "oneTimeCode"`, `autoComplete="sms-otp"`), backspace-to-previous and
  auto-advance for free, with no fragile per-box focus juggling.
- **"Typed"** — the codebase is JavaScript (no TS toolchain), so types are
  expressed as thorough JSDoc `@param` annotations rather than adding a heavy
  TypeScript dependency. Convert to `.tsx` 1:1 if/when TS is adopted.
- **react-native-web** — renders acceptably: the gradient, reanimated motion and
  color-scheme detection all work; `BlurView` degrades to a translucent panel and
  haptics no-op, both gracefully.
- **Non-destructive** — this module is standalone and does not touch the existing
  `src/screens/Auth/LoginScreen.js` or navigation. Swap it in when ready.
```
