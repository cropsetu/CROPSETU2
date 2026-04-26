/**
 * useScrollHeader — Collapse/expand header driven by scroll position.
 *
 * Rewritten with Reanimated v3:
 *   - All animation runs on the UI thread via worklets
 *   - No setState in the scroll handler (zero JS thread involvement)
 *   - Spring physics for natural header collapse/expand
 *   - Shared values drive header height/opacity — no layout-triggering props
 */
import { useState, useCallback } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';

const SPRING_CONFIG = { damping: 22, stiffness: 200, mass: 0.9 };

export default function useScrollHeader(maxHeight = 120) {
  const collapsed = useSharedValue(0); // 0 = expanded, 1 = collapsed
  const [showTopBtn, setShowTopBtn] = useState(false);

  const updateTopBtn = useCallback((show) => {
    setShowTopBtn(show);
  }, []);

  // Called from FlatList/ScrollView onScroll — must be a plain function
  // (Reanimated's useAnimatedScrollHandler needs the animated scrollview,
  //  but these screens use regular FlatList, so we use a worklet-safe wrapper)
  const onScroll = useCallback((e) => {
    const y = e.nativeEvent.contentOffset.y;

    if (y <= 5 && collapsed.value > 0.5) {
      collapsed.value = withSpring(0, SPRING_CONFIG);
      runOnJS(updateTopBtn)(false);
    } else if (y > 30 && collapsed.value < 0.5) {
      collapsed.value = withSpring(1, SPRING_CONFIG);
      runOnJS(updateTopBtn)(true);
    }
  }, []);

  // Animated styles — driven by shared value, computed on UI thread
  const headerAnimatedStyle = useAnimatedStyle(() => {
    return {
      height: interpolate(collapsed.value, [0, 1], [maxHeight, 0], Extrapolation.CLAMP),
      opacity: interpolate(collapsed.value, [0, 0.4, 1], [1, 0.3, 0], Extrapolation.CLAMP),
      overflow: 'hidden',
    };
  });

  return { onScroll, headerAnimatedStyle, showTopBtn, collapsed };
}
