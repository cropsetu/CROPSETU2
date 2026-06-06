import { Audio } from 'expo-av';

const assets = {
  tap: require('../../assets/sounds/tap.mp3'),
  success: require('../../assets/sounds/success.mp3'),
  send: require('../../assets/sounds/send.mp3'),
  scan: require('../../assets/sounds/scan.mp3'),
};

let initialized = false;

async function init() {
  if (initialized) return;
  initialized = true;
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: false,
    shouldDuckAndroid: true,
  });
}

// IMPORTANT: do NOT keep Sound instances loaded. expo-av (deprecated) releases
// any loaded player in AVManager.onHostDestroy on a background thread, which
// throws "Player is accessed on the wrong thread" and red-boxes the app when an
// activity is destroyed (backgrounding, config change, RN reload). Creating a
// fresh Sound per play and unloading it on finish means nothing is ever loaded
// at host-destroy time, so the crash can't fire.
async function play(name) {
  const asset = assets[name];
  if (!asset) return;
  try {
    await init();
    const { sound } = await Audio.Sound.createAsync(asset, {
      shouldPlay: true,
      volume: 0.3,
    });
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status && (status.didJustFinish || status.error)) {
        sound.unloadAsync().catch(() => {});
      }
    });
  } catch (_) {}
}

export const SoundEffects = {
  tap: () => play('tap'),
  success: () => play('success'),
  send: () => play('send'),
  scan: () => play('scan'),
  cleanup() {
    initialized = false;
  },
};
