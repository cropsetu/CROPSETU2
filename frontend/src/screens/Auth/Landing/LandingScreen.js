// ─────────────────────────────────────────────────────────────────────────────
// Screen 0 · Landing (welcome)
// ─────────────────────────────────────────────────────────────────────────────
// The warm, alive first impression that ends in a single CTA into the login
// flow. It reuses the auth design system end-to-end: the deep field-green hero
// gradient, the frosted logo badge / wordmark / tagline from AuthScreenLayout,
// the harvest-gold PrimaryButton, the shared legal + guest footer, and the same
// top-right language chip (now paired with a sound toggle).
//
// Motion graphics live BEHIND the content (<FieldScene/>, pointerEvents none): a
// breathing sun, parallax rolling hills, and drifting seeds. A one-shot gradient
// shimmer sweeps the hero on mount, and the brand zone / carousel / CTA enter in
// a staggered choreography. Sound: a soft welcome chime on first open and a light
// tick on the CTA. EVERYTHING here is gated by reduce-motion + the global mute —
// with either on, the screen is a calm static frame with identical layout.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  FadeIn,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  cancelAnimation,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import { ArrowRight } from 'lucide-react-native';
import { useAuthTheme } from '../PhoneLogin/theme';
import { useT } from '../PhoneLogin/strings';
import PrimaryButton from '../PhoneLogin/components/PrimaryButton';
import AuthTopControls from '../PhoneLogin/components/AuthTopControls';
import LegalFooter from '../PhoneLogin/components/LegalFooter';
import FieldScene from './components/FieldScene';
import ValuePropCarousel from './components/ValuePropCarousel';
import { SPRINGS } from '../../../components/ui/motion';
import { SFX } from '../../../utils/authSound';
import { s, vs, ms, SCREEN } from '../../../utils/responsive';

const LOGO = require('../../../../assets/cropsetu-logo.png');

// Module-scoped so the ambient welcome chime plays only ONCE per app session
// ("first app open only"), even if the Landing screen remounts.
let welcomePlayed = false;

/**
 * @param {object} props
 * @param {() => void} props.onGetStarted        Advance into the phone step.
 * @param {() => void} [props.onGuest]
 * @param {() => void} [props.onToggleLanguage]
 * @param {string} [props.languageCode='EN']
 * @param {() => void} [props.onTerms]
 * @param {() => void} [props.onPrivacy]
 */
export default function LandingScreen({
  onGetStarted,
  onGuest,
  onToggleLanguage,
  languageCode = 'EN',
  onTerms,
  onPrivacy,
}) {
  const theme = useAuthTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const reduceMotion = useReducedMotion();

  // Warm the audio session, then the once-per-session welcome chime (self-gates
  // on mute / reduce-motion inside SFX.play, so this is silent when it should be).
  useEffect(() => {
    SFX.preloadAll();
    if (!welcomePlayed) {
      welcomePlayed = true;
      SFX.play('welcome');
    }
  }, []);

  // Staggered entrance: each foreground element rises ~80ms after the last.
  const entrance = (delay) =>
    reduceMotion ? FadeIn.duration(1) : FadeInUp.delay(delay).duration(420).springify().damping(18);

  const handleGetStarted = () => {
    SFX.play('tap');           // light positive tick (PrimaryButton also fires Haptics.light)
    onGetStarted?.();
  };

  return (
    <View style={styles.root}>
      <StatusBar style={theme.statusBar} />

      {/* Deep field-green backdrop */}
      <LinearGradient
        colors={theme.heroGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Decorative parallax field scene — fades in as the "illustration" beat */}
      <Animated.View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        entering={reduceMotion ? FadeIn.duration(1) : FadeIn.delay(240).duration(700)}
      >
        <FieldScene />
      </Animated.View>

      {/* One-shot gradient shimmer sweep across the hero on mount */}
      <HeroSweep theme={theme} reduceMotion={reduceMotion} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <AuthTopControls onToggleLanguage={onToggleLanguage} languageCode={languageCode} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Centred brand + carousel region */}
          <View style={styles.center}>
            <BrandZone
              theme={theme}
              styles={styles}
              reduceMotion={reduceMotion}
              eyebrow={t('auth.welcomeBack')}
              wordmark={t('auth.appName')}
              tagline={t('auth.tagline')}
              entrance={entrance}
            />

            <Animated.View entering={entrance(320)} style={styles.carousel}>
              <ValuePropCarousel />
            </Animated.View>
          </View>

          {/* CTA + guest + legal */}
          <View style={styles.footer}>
            <Animated.View entering={entrance(400)} style={styles.ctaWrap}>
              <PrimaryButton
                label={t('auth.getStarted')}
                onPress={handleGetStarted}
                Icon={ArrowRight}
                testID="landing-get-started"
              />
            </Animated.View>

            <Animated.View entering={entrance(480)} style={styles.legalWrap}>
              <LegalFooter onTerms={onTerms} onPrivacy={onPrivacy} onGuest={onGuest} />
            </Animated.View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Brand zone: spring-in + idle-floating logo badge, eyebrow, wordmark, tagline
function BrandZone({ theme, styles, reduceMotion, eyebrow, wordmark, tagline, entrance }) {
  const scale = useSharedValue(reduceMotion ? 1 : 0.8);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const float = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      scale.value = 1; opacity.value = 1; float.value = 0;
      return undefined;
    }
    opacity.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    scale.value = withSpring(1, SPRINGS.bouncy);
    // Barely-there idle float (±3px, 4s loop) once it has settled.
    float.value = withDelay(
      420,
      withRepeat(
        withSequence(
          withTiming(-s(3), { duration: 2000, easing: Easing.inOut(Easing.sin) }),
          withTiming(s(3), { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      ),
    );
    return () => { cancelAnimation(float); };
  }, [reduceMotion, scale, opacity, float]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: float.value }],
  }));

  return (
    <View style={styles.hero}>
      <Animated.View style={[styles.badgeShadow, badgeStyle]}>
        <BlurView intensity={theme.mode === 'dark' ? 30 : 45} tint={theme.mode} style={styles.badge}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
        </BlurView>
      </Animated.View>

      <Animated.Text entering={entrance(80)} style={styles.eyebrow} maxFontSizeMultiplier={1.4}>
        {eyebrow}
      </Animated.Text>
      <Animated.Text
        entering={entrance(120)}
        style={styles.wordmark}
        maxFontSizeMultiplier={1.4}
        accessibilityRole="header"
      >
        {wordmark}
      </Animated.Text>
      <Animated.Text entering={entrance(200)} style={styles.tagline} maxFontSizeMultiplier={1.5}>
        {tagline}
      </Animated.Text>
    </View>
  );
}

// ── One-shot diagonal shimmer that sweeps the hero exactly once on mount ──────
function HeroSweep({ theme, reduceMotion }) {
  const x = useSharedValue(-SCREEN.W);

  useEffect(() => {
    if (reduceMotion) return undefined;
    x.value = withDelay(120, withTiming(SCREEN.W, { duration: 900, easing: Easing.out(Easing.quad) }));
    return undefined;
  }, [reduceMotion, x]);

  const aStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { rotate: '14deg' }] }));

  if (reduceMotion) return null;

  const tint = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.16)';
  return (
    <Animated.View pointerEvents="none" style={[sweepStyles.band, aStyle]}>
      <LinearGradient
        colors={['transparent', tint, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const sweepStyles = StyleSheet.create({
  band: { position: 'absolute', top: -vs(40), bottom: -vs(40), width: s(160) },
});

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.screenBg },
    safe: { flex: 1 },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: s(t.space.base),
      minHeight: vs(44),
    },

    scroll: {
      flexGrow: 1,
      paddingHorizontal: s(t.space.xl),
      paddingBottom: vs(t.space.lg),
    },

    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    // Hero — mirrors AuthScreenLayout's badge/wordmark/tagline treatment.
    hero: { alignItems: 'center', marginBottom: vs(t.space.xxl) },
    badgeShadow: { borderRadius: ms(28), marginBottom: vs(t.space.base), ...t.shadow.card },
    badge: {
      width: ms(104), height: ms(104), borderRadius: ms(28),
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
      backgroundColor: t.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.20)',
    },
    logo: { width: ms(72), height: ms(72) },
    eyebrow: {
      ...t.text.caption,
      color: t.onHeroDim,
      textTransform: 'uppercase',
      letterSpacing: 2,
      marginBottom: vs(t.space.xs),
    },
    wordmark: { ...t.text.display, color: t.onHero, textAlign: 'center' },
    tagline: {
      ...t.text.helper,
      color: t.onHeroDim,
      marginTop: vs(t.space.xs),
      textAlign: 'center',
      maxWidth: s(300),
    },

    carousel: { marginTop: vs(t.space.sm) },

    footer: { alignItems: 'center', marginTop: vs(t.space.xl) },
    ctaWrap: { alignSelf: 'stretch' },
    legalWrap: { alignItems: 'center', marginTop: vs(t.space.lg) },
  });
}
