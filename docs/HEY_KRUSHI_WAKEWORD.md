# "Hey Krushi" — voice assistant setup

The Krushi voice assistant opens two ways:
1. **Mic button** on the **Profile tab** (bottom-right) — tap to talk. Works today, no setup.
2. **"Hey Krushi" wake word** — hands-free, always-listening. Needs the native setup below.

When active, an animated gradient glow sweeps the screen edges (🟢 listening → 🟡 thinking →
🔵 speaking) and the assistant fills + saves the right form by voice, picking the domain from
the current screen (Animal → sell animal, Rent → machinery, Profile → edit profile, MyFarm →
farm, new user → onboarding).

## Code (already wired)
- `src/screens/AI/KrushiEdgeGlow.js` — the screen-edge glow.
- `src/context/KrushiAssistantContext.js` — global provider: wake word + overlay + per-domain save. Mounted in `App.js`. Exposes `useKrushiAssistant().openAssistant()`.
- `src/services/wakeWord.js` — Picovoice Porcupine wrapper, **guarded** (inert/no-op without the native module / key / model, so Expo Go never crashes).
- `plugins/withKrushiKeyword.js` — bundles the `.ppn` into the Android build (guarded).
- `app.config.js` — injects the Picovoice access key from `PICOVOICE_ACCESS_KEY` (env / EAS secret), never committed.
- `app.json` — mic permission (`NSMicrophoneUsageDescription`, Android `RECORD_AUDIO`), plugin registered, `extra.picovoiceKeywordPath = hey_krushi.ppn`.

## Enable the real wake word — 3 steps + a native build
Wake word can't run in Expo Go; it needs a dev/preview **native build**.

### 1. Picovoice access key → EAS secret (not committed)
Sign up at https://console.picovoice.ai → copy your **AccessKey**, then:
```bash
cd frontend
eas env:create --name PICOVOICE_ACCESS_KEY --value "<your-picovoice-key>" --environment preview
# (repeat for the 'production' environment when you ship)
```
`app.config.js` reads it at build time. (For a quick local run you can instead `export PICOVOICE_ACCESS_KEY=…`.)

### 2. Train "Hey Krushi" → drop the .ppn in the repo
Picovoice Console → **Porcupine** → keyword **"Hey Krushi"** → download the **Android** `.ppn`, then:
```
frontend/assets/wakeword/hey_krushi.ppn
```
Commit it. The plugin copies it into the Android assets automatically on build.
*(iOS: download the iOS `.ppn` too and add it to the app target in Xcode → Copy Bundle Resources.)*

### 3. Build
```bash
cd frontend
eas build --platform android --profile preview     # same profile you've been using
```
Install that APK, and "Hey Krushi" listens while the app is open. The Profile mic button keeps working regardless.

## Notes
- **Foreground-only** listening (app open). Background always-on would add an Android foreground service — a later step.
- **Privacy:** Porcupine runs fully on-device; no audio leaves the phone until *after* the wake word, when a turn is recorded (same Sarvam STT path as chat).
- **Mic hand-off:** the wake word pauses while the assistant records, then resumes — no mic conflict.
- **Backend:** the assistant calls `/ai/voice-agent/turn` on the API the build points to (preview → prod Railway). Needs a working `GEMINI_API_KEY` + `SARVAM_API_KEY` there.
