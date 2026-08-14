/**
 * Placeholder cards shown while the first page of animals loads.
 *
 * A spinner on a blank screen gives no sense of what is coming or how long it
 * will take; a skeleton in the shape of the real grid makes the wait read as
 * "loading" rather than "empty", and the screen does not jump when the data
 * lands because the layout is already the right size.
 *
 * The shimmer runs on the UI thread via Reanimated, so it keeps moving even
 * while JS is busy parsing the response — which is exactly the moment a
 * JS-driven animation would freeze and make the app look hung.
 */
import { memo, useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing,
} from 'react-native-reanimated';
import { COLORS, SHADOWS } from '@cropsetu/shared/constants/colors';

const { width: W } = Dimensions.get('window');
const CARD_W = (W - 14 * 2 - 10) / 2;

function Shimmer({ style }) {
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.85, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.45, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[S.block, style, animated]} />;
}

function SkeletonCard() {
  return (
    <View style={S.card} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Shimmer style={S.photo} />
      <View style={S.body}>
        <Shimmer style={S.lineTitle} />
        <Shimmer style={S.linePrice} />
        <Shimmer style={S.lineMeta} />
        <Shimmer style={S.button} />
      </View>
    </View>
  );
}

/** @param {{rows?: number}} props — how many 2-card rows to draw. */
function AnimalCardSkeleton({ rows = 4 }) {
  return (
    <View
      accessibilityLabel="Loading animals"
      accessibilityRole="progressbar"
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={S.row}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ))}
    </View>
  );
}

const S = StyleSheet.create({
  row:   { flexDirection: 'row', gap: 10, marginBottom: 10 },
  card:  { width: CARD_W, backgroundColor: COLORS.surface, borderRadius: 20, overflow: 'hidden', ...SHADOWS.small },
  block: { backgroundColor: COLORS.divider, borderRadius: 6 },
  photo: { width: '100%', height: CARD_W * 0.85, borderRadius: 0 },
  body:  { padding: 10, gap: 7 },
  lineTitle: { height: 12, width: '85%' },
  linePrice: { height: 14, width: '55%' },
  lineMeta:  { height: 10, width: '70%' },
  button:    { height: 30, width: '100%', borderRadius: 12, marginTop: 3 },
});

export default memo(AnimalCardSkeleton);
