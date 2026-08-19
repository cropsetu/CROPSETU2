/**
 * ImmersiveKit — shared 3D animation components for CropSetu
 * Bright vivid 3D design language used across all screens.
 */
import { useRef, useEffect } from 'react';
import { COLORS } from '@cropsetu/shared/constants/colors';
import { Animated } from 'react-native';

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
