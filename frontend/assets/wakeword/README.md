# Wake-word model goes here

Drop the trained **"Hey Krushi"** Porcupine keyword file here as:

```
assets/wakeword/hey_krushi.ppn      # the ANDROID .ppn from the Picovoice Console
```

The `plugins/withKrushiKeyword.js` config plugin auto-copies it into the Android
app during `expo prebuild` / EAS build. If this file is absent, the build still
succeeds and the wake word simply stays inert.

Train it at https://console.picovoice.ai → Porcupine → keyword "Hey Krushi" →
download the **Android** `.ppn` (iOS is a separate file; add it to the iOS target).

The Picovoice **access key** is NOT stored here — it's injected at build time from
the `PICOVOICE_ACCESS_KEY` env var / EAS secret (see `app.config.js`).
