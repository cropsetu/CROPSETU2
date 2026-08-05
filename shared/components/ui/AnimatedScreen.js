/**
 * AnimatedScreen — lightweight content-ready fade.
 *
 * The navigator (native-stack) already handles the spatial transition
 * (push from right on iOS, slide_from_right on Android). This wrapper
 * only fades the screen's CONTENT in once it mounts, so the user sees
 * the navigation animation first, then the content appears smoothly
 * instead of popping in fully formed.
 *
 * NO translateY / SlideInDown — that fights the navigator's own motion
 * and creates the "weird bottom-to-up" double-animation.
 */
import { StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { isReducedMotion } from './motion';

export default function AnimatedScreen({
  children,
  style,
  delay = 0,
}) {
  const entering = isReducedMotion()
    ? FadeIn.duration(150).delay(delay)
    : FadeIn.duration(220).delay(delay);

  return (
    <Animated.View entering={entering} style={[styles.root, style]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
