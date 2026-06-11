// ── Completion · "You're all set!" — warm, tasteful celebration ──────────────
import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withDelay, withTiming,
  useReducedMotion, FadeInUp, Easing,
} from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import PrimaryButton from '../../../Auth/PhoneLogin/components/PrimaryButton';
import { useOnbTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { s, vs, ms } from '../../../../utils/responsive';

/**
 * @param {object} props
 * @param {() => void} props.onComplete
 */
export default function StepSuccess({ onComplete }) {
  const theme = useOnbTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();

  const checkScale = useSharedValue(reduceMotion ? 1 : 0);
  const ring = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    Haptics.success();             // celebratory haptic on arrival
    if (reduceMotion) return;
    checkScale.value = withSpring(1, { damping: 9, stiffness: 220, mass: 0.9 });
    ring.value = withDelay(120, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, [reduceMotion, checkScale, ring]);

  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));
  // A single expanding ring — subtle, not gaudy.
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.6 + ring.value * 0.8 }],
    opacity: (1 - ring.value) * 0.5,
  }));

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient colors={theme.heroGradient} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <View style={styles.badgeWrap}>
            <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />
            <Animated.View style={[styles.badge, checkStyle]}>
              <Check size={ms(48)} color={theme.onAccent} strokeWidth={3} />
            </Animated.View>
          </View>

          <Animated.View entering={reduceMotion ? undefined : FadeInUp.delay(150).duration(420)} style={styles.texts}>
            <Text style={styles.title} maxFontSizeMultiplier={1.4}>{t('onb.successTitle')}</Text>
            <Text style={styles.subtitle} maxFontSizeMultiplier={1.5}>{t('onb.successSubtitle')}</Text>
          </Animated.View>
        </View>

        <View style={styles.footer}>
          <PrimaryButton label={t('onb.successCta')} onPress={onComplete} testID="onb-complete" />
        </View>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.screenBg },
    safe: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: s(t.space.xl), gap: vs(t.space.xl) },
    badgeWrap: { width: ms(140), height: ms(140), alignItems: 'center', justifyContent: 'center' },
    ring: {
      position: 'absolute',
      width: ms(140), height: ms(140), borderRadius: ms(70),
      borderWidth: 3, borderColor: t.accent,
    },
    badge: {
      width: ms(104), height: ms(104), borderRadius: ms(52),
      backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center',
      ...t.shadow.cta,
    },
    texts: { alignItems: 'center', gap: vs(t.space.sm) },
    title: { ...t.text.display, color: t.onHero, textAlign: 'center' },
    subtitle: { ...t.text.subtitle, color: t.onHeroDim, textAlign: 'center', maxWidth: s(320) },
    footer: { paddingHorizontal: s(t.space.xl), paddingBottom: vs(t.space.base) },
  });
}
