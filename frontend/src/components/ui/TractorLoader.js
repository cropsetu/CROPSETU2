/**
 * TractorLoader — Colorful animated tractor driving across the screen.
 *
 * Features:
 *   - Tractor body drawn with pure RN Views (no SVG/Lottie dependency)
 *   - Wheels spin continuously with Reanimated rotation
 *   - Tractor drives left → right in a loop
 *   - Exhaust smoke puffs rise and fade
 *   - Ground with growing crop dots
 *   - "Loading..." text with bouncing dots
 *   - 100% UI-thread animations via Reanimated worklets
 *   - Respects reduced motion (static tractor + pulsing opacity)
 */
import { useEffect } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  withSpring,
  Easing,
  interpolate,
  FadeIn,
} from 'react-native-reanimated';
import { COLORS } from '../../constants/colors';
import { isReducedMotion } from './motion';

// ── Colors ───────────────────────────────────────────────────────────────────
const TRACTOR_RED    = '#E53935';
const TRACTOR_BODY   = '#D32F2F';
const WHEEL_DARK     = '#37474F';
const WHEEL_HUB      = '#B0BEC5';
const EXHAUST_GRAY   = '#90A4AE';
const CHIMNEY_DARK   = '#455A64';
const WINDOW_BLUE    = '#81D4FA';
const GROUND_GREEN   = COLORS.primary;
const GROUND_LIGHT   = COLORS.primaryPale || '#DFF3EA';
const FIELD_BG       = COLORS.background || '#F4F8F1';

// ── Spinning Wheel ───────────────────────────────────────────────────────────
function SpinningWheel({ size, delay: d = 0 }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withDelay(d,
      withRepeat(
        withTiming(360, { duration: 800, easing: Easing.linear }),
        -1, // infinite
        false,
      )
    );
  }, []);

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const spoke = (angle) => ({
    position: 'absolute',
    width: 2,
    height: size - 6,
    backgroundColor: WHEEL_HUB,
    top: 3,
    left: size / 2 - 1,
    transform: [{ rotate: `${angle}deg` }],
    borderRadius: 1,
  });

  return (
    <Animated.View style={[{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: WHEEL_DARK,
      borderWidth: 3, borderColor: '#263238',
      justifyContent: 'center', alignItems: 'center',
    }, wheelStyle]}>
      {/* Spokes */}
      <View style={spoke(0)} />
      <View style={spoke(60)} />
      <View style={spoke(120)} />
      {/* Hub */}
      <View style={{
        width: size * 0.35, height: size * 0.35, borderRadius: size * 0.175,
        backgroundColor: WHEEL_HUB, borderWidth: 1.5, borderColor: '#78909C',
      }} />
    </Animated.View>
  );
}

// ── Smoke Puff ───────────────────────────────────────────────────────────────
function SmokePuff({ delay: d = 0, offsetX = 0 }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(d,
      withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }),
        -1, false,
      )
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3, 1], [0, 0.6, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -28]) },
      { translateX: interpolate(progress.value, [0, 1], [0, offsetX]) },
      { scale: interpolate(progress.value, [0, 1], [0.4, 1.2]) },
    ],
  }));

  return (
    <Animated.View style={[{
      position: 'absolute',
      width: 10, height: 10, borderRadius: 5,
      backgroundColor: EXHAUST_GRAY,
      top: -6, left: 2,
    }, style]} />
  );
}

// ── Growing Crop ─────────────────────────────────────────────────────────────
function CropSprout({ delay: d = 0 }) {
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.value = withDelay(d,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }),
          withTiming(0.3, { duration: 800, easing: Easing.in(Easing.quad) }),
        ),
        -1, false,
      )
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: interpolate(grow.value, [0, 1], [0.2, 1]) }],
    opacity: interpolate(grow.value, [0, 0.3, 1], [0.3, 0.8, 1]),
  }));

  return (
    <Animated.View style={[{
      width: 4, height: 14,
      backgroundColor: GROUND_GREEN,
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
      transformOrigin: 'bottom',
    }, style]} />
  );
}

// ── Bouncing Dot ─────────────────────────────────────────────────────────────
function BounceDot({ delay: d, color = COLORS.primary }) {
  const y = useSharedValue(0);

  useEffect(() => {
    y.value = withDelay(d,
      withRepeat(
        withSequence(
          withTiming(-6, { duration: 300, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) }),
        ),
        -1, false,
      )
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  return (
    <Animated.View style={[{
      width: 6, height: 6, borderRadius: 3,
      backgroundColor: color, marginHorizontal: 2,
    }, style]} />
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function TractorLoader({
  message = 'Loading',
  size = 'medium',     // 'small' | 'medium' | 'large'
  fullScreen = true,
}) {
  const { width: screenW } = useWindowDimensions();
  const reduced = isReducedMotion();

  // Tractor drives across screen
  const driveX = useSharedValue(-120);

  useEffect(() => {
    if (reduced) return;
    driveX.value = withRepeat(
      withTiming(screenW + 40, { duration: 3500, easing: Easing.inOut(Easing.quad) }),
      -1, false,
    );
  }, [screenW]);

  const tractorDriveStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: driveX.value }],
  }));

  // Tractor body bounce (simulates uneven ground)
  const bounce = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    bounce.value = withRepeat(
      withSequence(
        withTiming(-2.5, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }),
        withTiming(-1.5, { duration: 120 }),
        withTiming(0, { duration: 120 }),
      ),
      -1, false,
    );
  }, []);

  const bounceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bounce.value }],
  }));

  // Reduced motion: just pulse opacity
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!reduced) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.5, { duration: 800 }),
        withTiming(1, { duration: 800 }),
      ),
      -1, false,
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: reduced ? pulse.value : 1,
  }));

  const scale = size === 'small' ? 0.6 : size === 'large' ? 1.2 : 0.85;

  const content = (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      {/* Field / ground area */}
      <View style={styles.scene}>
        {/* Crops in the field */}
        <View style={styles.cropRow}>
          {Array.from({ length: 12 }, (_, i) => (
            <CropSprout key={i} delay={i * 200} />
          ))}
        </View>

        {/* Tractor */}
        <Animated.View style={[reduced ? pulseStyle : tractorDriveStyle, { position: 'absolute', bottom: 12 }]}>
          <Animated.View style={[bounceStyle, { transform: [{ scale }] }]}>
            {/* ── Tractor Assembly ── */}
            <View style={styles.tractorWrap}>

              {/* Exhaust smoke */}
              {!reduced && (
                <View style={styles.smokeContainer}>
                  <SmokePuff delay={0} offsetX={-4} />
                  <SmokePuff delay={400} offsetX={2} />
                  <SmokePuff delay={800} offsetX={-6} />
                </View>
              )}

              {/* Chimney / exhaust pipe */}
              <View style={styles.chimney} />

              {/* Cabin */}
              <View style={styles.cabin}>
                <View style={styles.window} />
                <View style={styles.windowFrame} />
              </View>

              {/* Engine hood */}
              <View style={styles.hood} />

              {/* Grill lines */}
              <View style={styles.grillArea}>
                <View style={styles.grillLine} />
                <View style={styles.grillLine} />
                <View style={styles.grillLine} />
              </View>

              {/* Headlight */}
              <View style={styles.headlight} />

              {/* Body / chassis */}
              <View style={styles.chassis} />

              {/* Back big wheel */}
              <View style={styles.backWheelPos}>
                <SpinningWheel size={38} />
              </View>

              {/* Front small wheel */}
              <View style={styles.frontWheelPos}>
                <SpinningWheel size={24} delay={100} />
              </View>

              {/* Fender over back wheel */}
              <View style={styles.fender} />
            </View>
          </Animated.View>
        </Animated.View>

        {/* Ground line */}
        <View style={styles.ground} />
      </View>

      {/* Loading text with bouncing dots */}
      <View style={styles.textRow}>
        <Text style={styles.loadingText}>{message}</Text>
        <BounceDot delay={0} />
        <BounceDot delay={150} />
        <BounceDot delay={300} />
      </View>
    </View>
  );

  return fullScreen ? (
    <Animated.View entering={FadeIn.duration(300)} style={styles.fullScreen}>
      {content}
    </Animated.View>
  ) : content;
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: FIELD_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  scene: {
    width: '100%',
    height: 120,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  ground: {
    height: 12,
    backgroundColor: GROUND_GREEN,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    opacity: 0.18,
  },
  cropRow: {
    position: 'absolute',
    bottom: 12,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    zIndex: -1,
  },

  // ── Tractor parts ──────────────────────────────────────────────────────────
  tractorWrap: {
    width: 110,
    height: 75,
    position: 'relative',
  },
  chimney: {
    position: 'absolute',
    width: 6,
    height: 18,
    backgroundColor: CHIMNEY_DARK,
    top: 2,
    left: 68,
    borderRadius: 2,
  },
  smokeContainer: {
    position: 'absolute',
    top: -2,
    left: 68,
    width: 14,
    height: 30,
  },
  cabin: {
    position: 'absolute',
    width: 32,
    height: 30,
    backgroundColor: TRACTOR_RED,
    top: 10,
    left: 24,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: TRACTOR_BODY,
  },
  window: {
    width: 20,
    height: 16,
    backgroundColor: WINDOW_BLUE,
    borderRadius: 3,
    marginTop: 4,
    marginLeft: 4,
    borderWidth: 1,
    borderColor: '#4FC3F7',
  },
  windowFrame: {
    position: 'absolute',
    width: 1.5,
    height: 16,
    backgroundColor: TRACTOR_BODY,
    top: 4,
    left: 14,
  },
  hood: {
    position: 'absolute',
    width: 40,
    height: 18,
    backgroundColor: TRACTOR_RED,
    top: 22,
    left: 56,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 3,
    borderWidth: 1,
    borderColor: TRACTOR_BODY,
  },
  grillArea: {
    position: 'absolute',
    top: 26,
    left: 88,
    gap: 3,
  },
  grillLine: {
    width: 6,
    height: 2,
    backgroundColor: '#B71C1C',
    borderRadius: 1,
  },
  headlight: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#FFD54F',
    top: 28,
    left: 95,
    borderWidth: 0.5,
    borderColor: '#FFC107',
  },
  chassis: {
    position: 'absolute',
    width: 78,
    height: 10,
    backgroundColor: TRACTOR_BODY,
    top: 40,
    left: 18,
    borderRadius: 2,
  },
  backWheelPos: {
    position: 'absolute',
    bottom: 0,
    left: 8,
  },
  frontWheelPos: {
    position: 'absolute',
    bottom: 0,
    left: 80,
  },
  fender: {
    position: 'absolute',
    width: 42,
    height: 8,
    backgroundColor: TRACTOR_RED,
    top: 34,
    left: 6,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 4,
    opacity: 0.9,
  },

  // ── Text ───────────────────────────────────────────────────────────────────
  textRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 2,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
    marginRight: 4,
    letterSpacing: 0.3,
  },
});
