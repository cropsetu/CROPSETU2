// ─────────────────────────────────────────────────────────────────────────────
// <OnboardingLayout/> — the reusable wizard scaffold
// ─────────────────────────────────────────────────────────────────────────────
// Carries the auth brand language into onboarding: a deep-green gradient header
// holding the back / skip chrome, an animated progress bar + "Step X of N", and
// a rounded content sheet that scrolls under a fixed footer CTA (the shared auth
// <PrimaryButton/>). Step content animates in per `stepKey` + `direction`,
// honouring reduce-motion. Nothing in the footer moves between states.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, KeyboardAvoidingView, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, useReducedMotion,
  FadeIn, SlideInRight, SlideInLeft, Easing,
} from 'react-native-reanimated';
import { ChevronLeft, TriangleAlert } from 'lucide-react-native';
import PrimaryButton from '../../../Auth/PhoneLogin/components/PrimaryButton';
import { useOnbTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { s, vs, ms } from '../../../../utils/responsive';

/**
 * @param {object} props
 * @param {number} props.stepIndex          0-based current step.
 * @param {number} props.stepCount          Total steps.
 * @param {string} props.stepKey            Changes per step → drives the transition.
 * @param {1|-1}  [props.direction=1]       1 = forward (slide L→R), -1 = back.
 * @param {string} props.title
 * @param {string} props.subtitle
 * @param {React.ReactNode} props.children  The step body.
 * @param {() => void} [props.onBack]       Omit on the first step.
 * @param {() => void} [props.onSkip]       Omit to hide "Skip for now".
 * @param {string} props.nextLabel
 * @param {() => void} props.onNext
 * @param {boolean} [props.nextDisabled]
 * @param {boolean} [props.nextLoading]
 * @param {string} [props.nextLoadingLabel]
 */
export default function OnboardingLayout({
  stepIndex, stepCount, stepKey, direction = 1,
  title, subtitle, children,
  onBack, onSkip,
  nextLabel, onNext, nextDisabled, nextLoading, nextLoadingLabel, footerError,
}) {
  const theme = useOnbTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();

  // Progress bar — animate the filled width in px once we know the track width.
  const [trackW, setTrackW] = useState(0);
  const progress = useSharedValue((stepIndex + 1) / stepCount);
  useEffect(() => {
    const target = (stepIndex + 1) / stepCount;
    progress.value = reduceMotion ? target : withTiming(target, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [stepIndex, stepCount, reduceMotion, progress]);
  const fillStyle = useAnimatedStyle(() => ({ width: trackW * progress.value }));

  // Per-step entry: slide in the direction of travel, or fade if reduce-motion.
  const entering = reduceMotion
    ? FadeIn.duration(1)
    : (direction >= 0 ? SlideInRight : SlideInLeft).duration(260).easing(Easing.out(Easing.cubic));

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={theme.heroGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.headerBg}
      />

      {/* ── Header chrome ── */}
      <SafeAreaView edges={['top']}>
        <View style={styles.topBar}>
          <View style={styles.topSide}>
            {onBack ? (
              <Pressable
                onPress={() => { Haptics.selection(); onBack(); }}
                style={styles.iconBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={t('onb.back')}
              >
                <ChevronLeft size={ms(22)} color={theme.onHero} strokeWidth={2.5} />
              </Pressable>
            ) : null}
          </View>

          <View
            style={styles.progressWrap}
            accessibilityRole="progressbar"
            accessibilityLabel={t('onb.a11y.progress', { current: stepIndex + 1, total: stepCount })}
            accessibilityValue={{ min: 0, max: stepCount, now: stepIndex + 1 }}
          >
            <Text style={styles.stepText} maxFontSizeMultiplier={1.4}>
              {t('onb.stepOf', { current: stepIndex + 1, total: stepCount })}
            </Text>
            <View style={styles.track} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
              <Animated.View style={[styles.fill, fillStyle]} />
            </View>
          </View>

          <View style={[styles.topSide, styles.topRight]}>
            {onSkip ? (
              <Pressable
                onPress={() => { Haptics.selection(); onSkip(); }}
                style={styles.skipBtn}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('onb.skip')}
              >
                <Text style={styles.skipText} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                  {t('onb.skip')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>

      {/* ── Content sheet ── */}
      <KeyboardAvoidingView
        style={styles.sheet}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={stepKey} entering={entering}>
            <Text style={styles.title} maxFontSizeMultiplier={1.5}>{title}</Text>
            <Text style={styles.subtitle} maxFontSizeMultiplier={1.6}>{subtitle}</Text>
            <View style={styles.body}>{children}</View>
          </Animated.View>
        </ScrollView>

        {/* Fixed footer — never moves between states */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, vs(12)) }]}>
          {footerError ? (
            <View style={styles.footerError} accessibilityLiveRegion="assertive">
              <TriangleAlert size={s(16)} color={theme.error} strokeWidth={2.25} />
              <Text style={styles.footerErrorText}>{footerError}</Text>
            </View>
          ) : null}
          <PrimaryButton
            label={nextLabel}
            loadingLabel={nextLoadingLabel}
            loading={nextLoading}
            disabled={nextDisabled}
            onPress={onNext}
            testID="onb-next"
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.screenBg },
    flex: { flex: 1 },
    headerBg: { position: 'absolute', top: 0, left: 0, right: 0, height: vs(220) },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: s(t.space.base),
      paddingTop: vs(t.space.sm),
      paddingBottom: vs(t.space.md),
      gap: s(t.space.sm),
    },
    topSide: { width: s(56), justifyContent: 'center' },
    topRight: { alignItems: 'flex-end' },
    iconBtn: {
      width: s(40), height: s(40), borderRadius: s(20),
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    skipBtn: { minHeight: s(40), justifyContent: 'center', paddingHorizontal: s(t.space.xs) },
    skipText: { ...t.text.label, color: t.onHeroDim, textDecorationLine: 'underline' },

    progressWrap: { flex: 1, alignItems: 'center', gap: vs(t.space.sm) },
    stepText: { ...t.text.caption, color: t.onHeroDim },
    track: {
      width: '100%',
      height: vs(6),
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.22)',
      overflow: 'hidden',
    },
    fill: { height: '100%', borderRadius: 3, backgroundColor: t.accent },

    sheet: {
      flex: 1,
      backgroundColor: t.surface,
      borderTopLeftRadius: t.radius.xxl,
      borderTopRightRadius: t.radius.xxl,
      marginTop: vs(t.space.xs),
      overflow: 'hidden',
    },
    scroll: {
      paddingHorizontal: s(t.space.xl),
      paddingTop: vs(t.space.xl),
      paddingBottom: vs(t.space.xl),
    },
    title: { ...t.text.title, color: t.textPrimary, marginBottom: vs(t.space.xs) },
    subtitle: { ...t.text.subtitle, color: t.textSecondary },
    body: { marginTop: vs(t.space.lg) },

    footer: {
      paddingHorizontal: s(t.space.xl),
      paddingTop: vs(t.space.md),
      backgroundColor: t.surface,
      borderTopWidth: 1,
      borderTopColor: t.borderStrong,
    },
    footerError: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s(t.space.sm),
      marginBottom: vs(t.space.md),
      paddingHorizontal: s(t.space.md),
      paddingVertical: vs(t.space.sm),
      borderRadius: t.radius.md,
      backgroundColor: t.errorBg,
    },
    footerErrorText: { flex: 1, ...t.text.helper, color: t.mode === 'dark' ? t.onErrorBg : t.error },
  });
}
