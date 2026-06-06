/**
 * SpeakerButton — tap to hear a piece of text read aloud in the farmer's
 * language (offline TTS). A low-literacy affordance used on P&L, insights and
 * mandi-price cards.
 */
import React, { useState, useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../../context/LanguageContext';
import { speak, stopSpeaking, isSpeechAvailable } from '../../../utils/speak';
import { COSMIC, CR } from '../theme/cosmicTheme';
import { Haptics } from '../../../utils/haptics';

export default function SpeakerButton({ text, size = 18, tint = COSMIC.PRIMARY, style }) {
  const { language } = useLanguage();
  const [on, setOn] = useState(false);

  useEffect(() => () => stopSpeaking(), []);

  const toggle = () => {
    Haptics.light?.();
    if (on) { stopSpeaking(); setOn(false); return; }
    speak(text, language);
    setOn(true);
    // expo-speech has no reliable JS "done" event across platforms — clear the
    // pressed state after a heuristic duration so the icon doesn't stick.
    const ms = Math.min(15000, 1200 + String(text || '').length * 60);
    setTimeout(() => setOn(false), ms);
  };

  if (!text || !isSpeechAvailable()) return null;   // hide until TTS is in the build
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityLabel="Read aloud"
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: tint + '18', borderColor: tint + '40' },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Ionicons name={on ? 'volume-high' : 'volume-medium-outline'} size={size} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 30, height: 30, borderRadius: CR.pill,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
