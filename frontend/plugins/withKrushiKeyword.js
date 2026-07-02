/**
 * withKrushiKeyword — bundles the trained "Hey Krushi" Porcupine keyword (.ppn)
 * into the native Android app so the wake word can load it by filename at runtime.
 *
 * Drop the Android keyword file at  frontend/assets/wakeword/hey_krushi.ppn  and it
 * is copied into the Android assets during `expo prebuild` (which EAS runs).
 * GUARDED: if the file isn't there yet, it silently skips so the build never fails
 * — the wake-word module (services/wakeWord.js) just stays inert until it exists.
 *
 * (iOS: add the iOS .ppn to the app target in Xcode's "Copy Bundle Resources".)
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withKrushiKeyword(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, 'assets', 'wakeword', 'hey_krushi.ppn');
      if (fs.existsSync(src)) {
        const destDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets');
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, path.join(destDir, 'hey_krushi.ppn'));
        // eslint-disable-next-line no-console
        console.log('[withKrushiKeyword] bundled hey_krushi.ppn into Android assets');
      } else {
        // eslint-disable-next-line no-console
        console.log('[withKrushiKeyword] assets/wakeword/hey_krushi.ppn not found — skipping (wake word stays inert)');
      }
      return cfg;
    },
  ]);
};
