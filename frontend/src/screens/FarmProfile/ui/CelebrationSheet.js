/**
 * CelebrationSheet — compact bottom sheet shown after a successful activity log.
 *
 * Minimalist light theme: white sheet, soft shadow, small illustration,
 * optional streak badge, single CTA.
 */

import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Animated, Dimensions } from 'react-native';
import Svg, { Circle, Path, Ellipse, G } from 'react-native-svg';
import { COSMIC, CR, CS, CT } from '../theme/cosmicTheme';
import GlowButton from './GlowButton';
import StreakBadge from './StreakBadge';
import { Haptics } from '../../../utils/haptics';

const { height: H } = Dimensions.get('window');

export default function CelebrationSheet({
  visible,
  title,
  subtitle,
  streakDays,
  onClose,
  autoHideMs = 3000,
  actionLabel,
  onAction,
}) {
  const slide  = useRef(new Animated.Value(1)).current;
  const fade   = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    if (!visible) return;
    Haptics.success?.();
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, speed: 16, bounciness: 4, useNativeDriver: true }),
      Animated.spring(bounce, { toValue: 1, speed: 12, bounciness: 8, useNativeDriver: true }),
    ]).start();
    if (autoHideMs > 0) {
      const t = setTimeout(() => onClose && onClose(), autoHideMs);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!visible) return null;

  const close = () => {
    Animated.parallel([
      Animated.timing(fade,  { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start(() => onClose && onClose());
  };

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, H * 0.5] });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handle} />

          <Animated.View style={[styles.illoWrap, { transform: [{ scale: bounce }] }]}>
            <FarmerIllo size={72} />
          </Animated.View>

          <Text style={styles.title} numberOfLines={2}>{title || 'Logged!'}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={3}>{subtitle}</Text>}

          {typeof streakDays === 'number' && streakDays > 0 && (
            <View style={styles.streakRow}>
              <StreakBadge days={streakDays} compact />
            </View>
          )}

          {actionLabel ? (
            <GlowButton label={actionLabel} variant="primary" full style={{ marginTop: 14 }} onPress={() => { onAction && onAction(); close(); }} />
          ) : (
            <GlowButton label="Done" variant="glass" full style={{ marginTop: 14 }} onPress={close} />
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function FarmerIllo({ size = 72 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <G>
        <Ellipse cx="100" cy="178" rx="88" ry="8" fill="rgba(230,81,0,0.14)" />
        <Path d="M20 168 Q100 152 180 168 L180 178 L20 178 Z" fill="#6D4C41" />
        <Path d="M100 110 L100 160" stroke="#176B43" strokeWidth="5" strokeLinecap="round" />
        <Path d="M100 120 Q82 110 78 96 Q92 98 100 120 Z" fill="#3DAA74" />
        <Path d="M100 130 Q118 120 124 105 Q110 108 100 130 Z" fill="#176B43" />
        <Circle cx="148" cy="56" r="16" fill="#F57F17" />
        <Circle cx="148" cy="56" r="10" fill="#FFE082" />
        <Circle cx="60" cy="96" r="11" fill="#FDD4A5" />
        <Path d="M44 90 Q60 78 76 90 Q70 86 60 86 Q50 86 44 90 Z" fill="#6D4C41" />
        <Path d="M60 107 L60 146" stroke="#176B43" strokeWidth="6" strokeLinecap="round" />
        <Path d="M60 146 L52 166" stroke="#2F2318" strokeWidth="5" strokeLinecap="round" />
        <Path d="M60 146 L70 166" stroke="#2F2318" strokeWidth="5" strokeLinecap="round" />
      </G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: COSMIC.OVERLAY,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COSMIC.SURFACE,
    borderTopLeftRadius: CR.xxl,
    borderTopRightRadius: CR.xxl,
    paddingHorizontal: CS.lg,
    paddingTop: 8,
    paddingBottom: CS.xl,
    borderTopWidth: 1,
    borderColor: COSMIC.BORDER,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: COSMIC.BORDER_HI,
    marginBottom: 10,
  },
  illoWrap: {
    alignSelf: 'center',
    marginBottom: 6,
  },
  title: {
    ...CT.styles.h3,
    fontSize: 18,
    textAlign: 'center',
  },
  subtitle: {
    ...CT.styles.bodySM,
    color: COSMIC.TEXT_2,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 8,
  },
  streakRow: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: COSMIC.SURFACE_HI,
    borderRadius: CR.md,
    borderWidth: 1,
    borderColor: COSMIC.BORDER,
  },
});
