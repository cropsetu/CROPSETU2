# Wake-word model goes here (Vosk)

The "Hey Krushi" wake word uses **Vosk** — a free, offline speech recogniser. No
API key, no account, no per-user fee.

Extract a small Vosk model into this folder, renamed to **`vosk-model`**:

```
assets/wakeword/vosk-model/      # the extracted model (conf/, am/, graph/, ivector/, ...)
```

Recommended: **vosk-model-small-en-in-0.4** (Indian English, ~40 MB) — best for
"krushi". Download from https://alphacephei.com/vosk/models → unzip → rename the
extracted folder to `vosk-model`, then commit it.

`plugins/withVoskModel.js` copies it into the Android app during `expo prebuild` /
EAS build. If this folder is absent, the build still succeeds and the wake word
simply stays inert.
