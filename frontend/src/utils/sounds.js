import { Audio } from 'expo-av';

const assets = {
  tap: require('../../assets/sounds/tap.mp3'),
  success: require('../../assets/sounds/success.mp3'),
  send: require('../../assets/sounds/send.mp3'),
  scan: require('../../assets/sounds/scan.mp3'),
};

let soundCache = {};
let initialized = false;

async function init() {
  if (initialized) return;
  initialized = true;
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: false,
    shouldDuckAndroid: true,
  });
}

async function play(name) {
  const asset = assets[name];
  if (!asset) return;
  try {
    await init();
    if (soundCache[name]) {
      await soundCache[name].setPositionAsync(0);
      await soundCache[name].playAsync();
      return;
    }
    const { sound } = await Audio.Sound.createAsync(asset, {
      shouldPlay: true,
      volume: 0.3,
    });
    soundCache[name] = sound;
  } catch (_) {}
}

export const SoundEffects = {
  tap: () => play('tap'),
  success: () => play('success'),
  send: () => play('send'),
  scan: () => play('scan'),
  cleanup() {
    Object.values(soundCache).forEach((s) => {
      try { s.unloadAsync(); } catch (_) {}
    });
    soundCache = {};
    initialized = false;
  },
};
