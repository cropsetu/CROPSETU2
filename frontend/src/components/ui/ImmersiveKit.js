/**
 * ImmersiveKit — shared 3D animation components for CropSetu
 * Bright vivid 3D design language used across all screens.
 */
import { useRef, useEffect } from 'react';
import { COLORS } from '../../constants/colors';
import {
  View, StyleSheet, Animated, PanResponder, Dimensions,
} from 'react-native';

const { height: H } = Dimensions.get('window');

// ── Design tokens ─────────────────────────────────────────────────────────────
export const D = {
  bg:       COLORS.background,
  surface:  COLORS.white,
  border:   'rgba(0,0,0,0.06)',
  text:     COLORS.charcoal,
  textDim:  COLORS.grayMid,
  textFaint:COLORS.grayMedium,

  // per-tab accents
  green:   COLORS.primary,
  greenLight: COLORS.mintGreen,
  amber:   COLORS.tangerine,
  cyan:    COLORS.sellerConfirmed,
  blue:    COLORS.royalBlue,
  indigo:  COLORS.indigoMid,
  purple:  COLORS.purpleDark,
  gold:    COLORS.yellowDark2,
  red:     COLORS.error,
};

// ── FloatingParticle ──────────────────────────────────────────────────────────
export function FloatingParticle({ children, particleStyle, delay = 0, duration = 3000 }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -22] });
  const opacity    = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.15, 0.55, 0.15] });
  const scale      = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.85, 1.08, 0.85] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.particleBase, particleStyle, { opacity, transform: [{ translateY }, { scale }] }]}
    >
      {children}
    </Animated.View>
  );
}

// ── TiltCard ──────────────────────────────────────────────────────────────────
export function TiltCard({ children, style }) {
  const tilt  = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        Animated.spring(scale, { toValue: 1.03, useNativeDriver: true, tension: 130, friction: 8 }).start();
      },
      onPanResponderMove: (_, gs) => {
        tilt.setValue({
          x: Math.max(-12, Math.min(12, gs.dx / 6)),
          y: Math.max(-12, Math.min(12, gs.dy / 6)),
        });
      },
      onPanResponderRelease: () => {
        Animated.parallel([
          Animated.spring(tilt,  { toValue: { x: 0, y: 0 }, useNativeDriver: true, tension: 100, friction: 7 }),
          Animated.spring(scale, { toValue: 1,              useNativeDriver: true, tension: 130, friction: 8 }),
        ]).start();
      },
    })
  ).current;

  const rotateX = tilt.y.interpolate({ inputRange: [-12, 12], outputRange: ['8deg', '-8deg'] });
  const rotateY = tilt.x.interpolate({ inputRange: [-12, 12], outputRange: ['-8deg', '8deg'] });

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]} {...panResponder.panHandlers}>
      <Animated.View style={{ transform: [{ perspective: 650 }, { rotateX }, { rotateY }] }}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

// ── PulseGlow ─────────────────────────────────────────────────────────────────
export function PulseGlow({ children, style, minScale = 1, maxScale = 1.12, duration = 1800 }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: maxScale, duration, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: minScale, duration, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={[style, { transform: [{ scale: pulse }] }]}>
      {children}
    </Animated.View>
  );
}

// ── EntrySlide ────────────────────────────────────────────────────────────────
export function EntrySlide({ children, style, delay = 0, fromX = 0, fromY = 30 }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: 480, delay, useNativeDriver: true,
    }).start();
  }, []);

  const opacity    = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] });

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateX }, { translateY }] }]}>
      {children}
    </Animated.View>
  );
}

// ── GlassCard ─────────────────────────────────────────────────────────────────
export function GlassCard({ children, style }) {
  return (
    <View style={[styles.glassCard, style]}>
      {children}
    </View>
  );
}

// ── AnimatedHeader ────────────────────────────────────────────────────────────
// Wraps the hero header block — applies scroll-driven scale+rotateX+opacity
export function AnimatedHeader({ scrollY, height = H * 0.28, colors, children, style }) {
  const heroScale   = scrollY.interpolate({ inputRange: [0, 200], outputRange: [1, 0.88],    extrapolate: 'clamp' });
  const heroRotateX = scrollY.interpolate({ inputRange: [0, 200], outputRange: ['0deg', '5deg'], extrapolate: 'clamp' });
  const heroOpacity = scrollY.interpolate({ inputRange: [0, 160], outputRange: [1, 0.5],    extrapolate: 'clamp' });

  return (
    <Animated.View
      style={[
        { height, overflow: 'hidden' },
        style,
        {
          transform: [
            { perspective: 1200 },
            { scale: heroScale },
            { rotateX: heroRotateX },
          ],
          opacity: heroOpacity,
        },
      ]}
    >
      <View style={[{ flex: 1 }, colors ? { backgroundColor: colors[0] } : { backgroundColor: D.bg }]}>
        {children}
      </View>
    </Animated.View>
  );
}

// ── EntryScale ────────────────────────────────────────────────────────────────
// Used for FlatList items — staggered scale+fade entrance
export function EntryScale({ children, style, delay = 0 }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: 500, delay, useNativeDriver: true,
    }).start();
  }, []);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const scale   = anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  return (
    <Animated.View style={[style, { opacity, transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  particleBase: { position: 'absolute' },
  glassCard: {
    backgroundColor: D.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: D.border,
    overflow: 'hidden',
  },
});
