# "Hey Krushi" — wake-word voice assistant

The app has **no voice buttons**. The farmer just says **"Hey Krushi"**; an animated
gradient glow sweeps the screen edges (green = listening, amber = thinking, blue =
speaking) and the assistant fills+saves the right form by voice, picking the domain
from whatever screen they're on (Animal → sell animal, Rent → machinery, Profile →
edit profile, MyFarm → farm, new user → onboarding).

## What's already wired (code)
- `src/screens/AI/KrushiEdgeGlow.js` — the screen-edge gradient glow animation.
- `src/screens/AI/VoiceAgentEngine.js` — the multi-turn voice form (now shows the glow, `autoStart`s on open).
- `src/context/KrushiAssistantContext.js` — global provider: owns the wake word, context-aware domain routing, the full-screen overlay, and every domain's save path. Mounted in `App.js`.
- `src/services/wakeWord.js` — Picovoice Porcupine wrapper, **guarded**: if the native module / key / model are missing it silently no-ops, so Expo Go never crashes.
- `app.json` — `NSMicrophoneUsageDescription` added (Android `RECORD_AUDIO` was already there); `extra.picovoiceAccessKey / picovoiceKeywordPath / picovoiceModelPath` placeholders.
- `package.json` — added `@picovoice/porcupine-react-native`, `@picovoice/react-native-voice-processor`, `expo-constants`.

## ⚠️ Wake word can't run in Expo Go — you need 3 things + a native build
### 1. Picovoice access key
Sign up at https://console.picovoice.ai → copy your **AccessKey**.
Put it in `app.json` → `expo.extra.picovoiceAccessKey` (or better, inject via an EAS secret + `app.config.js` so it isn't committed).

### 2. Train the "Hey Krushi" keyword
In the Picovoice Console → **Porcupine** → create keyword **"Hey Krushi"** → download the `.ppn` for **both** platforms (Android and iOS are separate files).
*(Optional: for a non-English acoustic model, also download `porcupine_params_<lang>.pv` and set `extra.picovoiceModelPath`.)*

### 3. Bundle the model + build natively
```bash
cd frontend
npm install                     # pulls the 3 new deps (or: npx expo install …)
npx expo prebuild               # generates android/ + ios/ (expo-dev-client already set up)
```
Then place the keyword file(s) so `extra.picovoiceKeywordPath` resolves:
- **Android:** copy the Android `.ppn` to `android/app/src/main/assets/hey_krushi.ppn`
- **iOS:** add the iOS `.ppn` to the app target in Xcode (Copy Bundle Resources) as `hey_krushi.ppn`

Build a dev client:
```bash
eas build --profile development --platform android   # or: npx expo run:android
```
Install that build (NOT Expo Go), set the access key, and "Hey Krushi" is live.

## Notes / current scope
- **Foreground-only listening** (while the app is open). Always-on background listening would add an Android foreground service + notification — a later step.
- **Privacy:** Porcupine runs fully on-device; no audio leaves the phone until *after* the wake word, when the assistant records a turn (same Sarvam STT path as before).
- **Mic hand-off:** while the assistant records, the wake word is paused (`pauseWakeWord`) and resumes on close — they can't fight over the mic.
- **Testing before the native build:** since there are no buttons, you can trigger the overlay from anywhere during development with
  ```js
  import { useKrushiAssistant } from '../context/KrushiAssistantContext';
  const { openAssistant } = useKrushiAssistant();
  openAssistant();            // or openAssistant('animal_post')
  ```
  Wire that to a temp dev button if you want to test the flow in Expo Go without the wake word.
