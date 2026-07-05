# "Hey Krushi" — voice assistant setup

The assistant opens two ways:
1. **Mic button** on the **Profile tab** (bottom-right) — tap to talk. Works today, no setup.
2. **"Hey Krushi" wake word** — hands-free, powered by **Vosk** (offline, FREE, no key/account).

When active, an animated gradient glow sweeps the screen edges (🟢 listening → 🟡 thinking →
🔵 speaking) and the assistant fills + saves the right form by voice, picking the domain from
the current screen (Animal → sell animal, Rent → machinery, Profile → edit profile, MyFarm →
farm, new user → onboarding).

## Wake word = Vosk (free, offline, no account/key)
- `src/services/wakeWord.js` — runs `react-native-vosk` continuously and watches the transcript
  for "hey krushi" (+ common mishears). Guarded: inert without the native module + model, so
  Expo Go never crashes. No audio leaves the device.
- `plugins/withVoskModel.js` — bundles the Vosk model into the Android build.
- No API key, no per-user fee. Needs a **native dev build** (not Expo Go).

## Enable it — 3 steps + a native build
### 1. Add the dependency
```bash
cd frontend
npx expo install react-native-vosk    # reconciles the version for RN 0.81 / Expo 54
```

### 2. Bundle a Vosk model
Download a small model from https://alphacephei.com/vosk/models
(recommended: **vosk-model-small-en-in-0.4**, Indian English ~40 MB) → unzip → rename the
extracted folder to **`vosk-model`** and place it at:
```
frontend/assets/wakeword/vosk-model/
```
Commit it. The plugin copies it into the Android app automatically on build.
*(iOS: add the folder to the app target in Xcode → Copy Bundle Resources.)*

### 3. Build
```bash
cd frontend
npx expo prebuild
eas build --platform android --profile preview     # the profile you've been using
```
Install that APK and say **"Hey Krushi"** while the app is open. The Profile mic button keeps
working regardless.

## Notes / tuning
- **Foreground-only** listening (app open). Continuous ASR uses more battery than a dedicated
  wake-word chip, so keep it opt-in and don't run it in the background (v1).
- **Accuracy tuning:** edit `WAKE_PHRASES` / `DEBOUNCE_MS` in `wakeWord.js`. The grammar-
  restricted (keyword-spotting) mode already keeps CPU low and false triggers down.
- **Privacy:** fully on-device; nothing is sent anywhere until *after* the wake word, when a
  turn is recorded (same Sarvam STT path as chat).
- **Mic hand-off:** the wake word pauses while the assistant records, then resumes on close.
- **Backend:** the assistant calls `/ai/voice-agent/turn` on the API the build points to
  (preview → prod Railway). Needs a working `GEMINI_API_KEY` + `SARVAM_API_KEY` there.
