/**
 * withVoskModel — bundles the offline Vosk speech model into the native Android app
 * so the "Hey Krushi" wake word (services/wakeWord.js) can load it by folder name.
 *
 * Put the extracted model folder at  frontend/assets/wakeword/vosk-model/  and it is
 * copied into the Android assets during `expo prebuild` (which EAS runs). GUARDED:
 * if the folder isn't there yet, it silently skips so the build never fails — the
 * wake word just stays inert until the model exists.
 *
 * (iOS: add the model folder to the app target in Xcode → Copy Bundle Resources.)
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withVoskModel(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, 'assets', 'wakeword', 'vosk-model');
      if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
        const destDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', 'vosk-model');
        fs.rmSync(destDir, { recursive: true, force: true });
        fs.cpSync(src, destDir, { recursive: true });
        // eslint-disable-next-line no-console
        console.log('[withVoskModel] bundled vosk-model into Android assets');
      } else {
        // eslint-disable-next-line no-console
        console.log('[withVoskModel] assets/wakeword/vosk-model/ not found — skipping (wake word stays inert)');
      }
      return cfg;
    },
  ]);
};
