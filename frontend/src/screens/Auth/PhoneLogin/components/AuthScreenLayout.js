// ─────────────────────────────────────────────────────────────────────────────
// <AuthScreenLayout/> — the shared scaffold both auth screens are built from
// ─────────────────────────────────────────────────────────────────────────────
// Owns everything that is identical between Phone-entry and OTP: the deep field
// gradient backdrop + soft agrarian glow, the frosted logo badge & wordmark, the
// 2-step progress dots, safe-area + keyboard handling, the mount entry
// animation (reduce-motion aware) and the low-emphasis legal footer slot.
//
// Each screen supplies only its own header (icon/title/subtitle), form body and
// optional back button / top-right slot (e.g. a language switcher).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo } from 'react';
import {
  View, Text, Image, Pressable, StyleSheet, KeyboardAvoidingView, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeIn, FadeInUp, useReducedMotion } from 'react-native-reanimated';
import { ChevronLeft } from 'lucide-react-native';
import { useAuthTheme } from '../theme';
import { useT } from '../strings';
import { Haptics } from '../../../../utils/haptics';
import { s, vs, ms } from '../../../../utils/responsive';

const LOGO = require('../../../../../assets/cropsetu-logo.png');

/**
 * @param {object} props
 * @param {1|2} props.step                     Drives the progress dots.
 * @param {() => void} [props.onBack]          Renders a back affordance when set.
 * @param {React.ReactNode} [props.topRightSlot]
 * @param {React.ComponentType} props.HeaderIcon  lucide icon for the card header.
 * @param {string} props.title
 * @param {string} props.subtitle
 * @param {React.ReactNode} [props.subtitleAccessory]  e.g. masked phone + edit link.
 * @param {React.ReactNode} props.children     The form body.
 * @param {React.ReactNode} [props.footer]     Legal / consent microcopy.
 */
export default function AuthScreenLayout({
  step,
  onBack,
  topRightSlot,
  HeaderIcon,
  title,
  subtitle,
  subtitleAccessory,
  children,
  footer,
}) {
  const theme = useAuthTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();

  // Near-instant fades when reduce-motion is on; gentle fade/slide otherwise.
  const heroEnter = reduceMotion ? FadeIn.duration(1) : FadeIn.duration(420);
  const cardEnter = reduceMotion ? FadeIn.duration(1) : FadeInUp.duration(440).springify().damping(18);

  const handleBack = () => {
    Haptics.selection();
    onBack?.();
  };

  return (
    <View style={styles.root}>
      <StatusBar style={theme.statusBar} />

      {/* Deep field-green backdrop — the dominant brand surface */}
      <LinearGradient
        colors={theme.heroGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Soft agrarian glow — purely decorative, sits well behind the opaque card */}
      <View pointerEvents="none" style={[styles.glow, styles.glowTop]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowBottom]} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Top bar: back (left) + optional language/guest slot (right) */}
        <View style={styles.topBar}>
          <View style={styles.topBarSide}>
            {onBack ? (
              <Pressable
                onPress={handleBack}
                style={styles.backBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={t('auth.a11yBack')}
              >
                <ChevronLeft size={ms(22)} color={theme.onHero} strokeWidth={2.5} />
              </Pressable>
            ) : null}
          </View>
          <View style={[styles.topBarSide, styles.topBarRight]}>{topRightSlot}</View>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Brand hero */}
            <Animated.View entering={heroEnter} style={styles.hero}>
              <View style={styles.badgeShadow}>
                <BlurView intensity={theme.mode === 'dark' ? 30 : 45} tint={theme.mode} style={styles.badge}>
                  <Image source={LOGO} style={styles.logo} resizeMode="contain" />
                </BlurView>
              </View>
              <Text style={styles.wordmark} maxFontSizeMultiplier={1.4}>
                {t('auth.appName')}
              </Text>
              <Text style={styles.tagline} maxFontSizeMultiplier={1.5}>
                {t('auth.tagline')}
              </Text>
            </Animated.View>

            {/* Form card */}
            <Animated.View entering={cardEnter} style={styles.card}>
              {/* 2-step progress dots */}
              <View
                style={styles.steps}
                accessibilityRole="progressbar"
                accessibilityLabel={`Step ${step} of 2`}
              >
                <View style={[styles.dot, styles.dotActive]} />
                <View style={[styles.bar, step >= 2 && styles.barActive]} />
                <View style={[styles.dot, step >= 2 && styles.dotActive]} />
              </View>

              <View style={styles.headerIconWrap}>
                <HeaderIcon size={ms(22)} color={theme.primary} strokeWidth={2.25} />
              </View>

              <Text style={styles.title} maxFontSizeMultiplier={1.6}>
                {title}
              </Text>
              <Text style={styles.subtitle} maxFontSizeMultiplier={1.6}>
                {subtitle}
              </Text>
              {subtitleAccessory}

              <View style={styles.body}>{children}</View>
            </Animated.View>

            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.screenBg },
    flex: { flex: 1 },
    safe: { flex: 1 },

    // Decorative soft glows behind the hero.
    glow: { position: 'absolute', borderRadius: 999, opacity: t.mode === 'dark' ? 0.14 : 0.22 },
    glowTop: {
      width: s(320), height: s(320), top: -s(120), right: -s(100),
      backgroundColor: t.leaf,
    },
    glowBottom: {
      width: s(280), height: s(280), bottom: -s(110), left: -s(90),
      backgroundColor: t.primaryDim,
    },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: s(t.space.base),
      minHeight: vs(44),
    },
    topBarSide: { minWidth: s(44), justifyContent: 'center' },
    topBarRight: { alignItems: 'flex-end' },
    backBtn: {
      width: s(40), height: s(40), borderRadius: s(20),
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },

    scroll: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: s(t.space.xl),
      paddingVertical: vs(t.space.xl),
    },

    // Hero
    hero: { alignItems: 'center', marginBottom: vs(t.space.xl) },
    badgeShadow: { borderRadius: ms(26), marginBottom: vs(t.space.base), ...t.shadow.card },
    badge: {
      width: ms(88), height: ms(88), borderRadius: ms(26),
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
      backgroundColor: t.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.20)',
    },
    logo: { width: ms(60), height: ms(60) },
    wordmark: { ...t.text.display, color: t.onHero },
    tagline: {
      ...t.text.helper,
      color: t.onHeroDim,
      marginTop: vs(t.space.xs),
      textAlign: 'center',
      maxWidth: s(300),
    },

    // Card
    card: {
      backgroundColor: t.surface,
      borderRadius: t.radius.xxl,
      padding: s(t.space.xl),
      borderWidth: t.mode === 'dark' ? 1 : 0,
      borderColor: t.borderStrong,
      ...t.shadow.card,
    },
    steps: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginBottom: vs(t.space.lg) },
    dot: { width: s(8), height: s(8), borderRadius: s(4), backgroundColor: t.border },
    dotActive: { backgroundColor: t.primary },
    bar: { width: s(28), height: 2, marginHorizontal: s(t.space.xs), borderRadius: 1, backgroundColor: t.border },
    barActive: { backgroundColor: t.primary },

    headerIconWrap: {
      width: ms(46), height: ms(46), borderRadius: ms(23),
      backgroundColor: t.primaryWash,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: vs(t.space.md),
    },
    title: { ...t.text.title, color: t.textPrimary, marginBottom: vs(t.space.xs) },
    subtitle: { ...t.text.subtitle, color: t.textSecondary },
    body: { marginTop: vs(t.space.lg) },

    footer: { marginTop: vs(t.space.xl), alignItems: 'center' },
  });
}
