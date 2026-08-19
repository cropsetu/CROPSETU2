// webScrollFix — make RN-web ScrollViews actually scroll.
//
// Why this exists
// ---------------
// On native, ScrollView is a UIScrollView / RecyclerView and scrolling works
// regardless of parent layout. On react-native-web it becomes a <div> with
// overflow:auto, which only scrolls when its height is BOUNDED.
//
// Inside a Stack.Navigator, each screen renders into an inner Card whose web
// height is not reliably set, so a screen-level flex:1 chain doesn't always
// resolve to a concrete height. Worse, CSS flex children default to
// min-height:auto — they refuse to shrink below their content, so even with
// overflow:auto set, scrolling never triggers.
//
// Two pieces are needed:
//   1. The screen container must be locked to viewport height on web.
//   2. Every intermediate flex parent AND the ScrollView must declare
//      min-height:0 so they can actually shrink and let overflow scroll.
//
// This helper covers one screen pattern:
//
//   ScrollView + ABSOLUTELY-positioned bottom bar (overlay)
//      e.g. OnboardingLanguageScreen, OnboardingProfileScreen
//
//        <View style={[sty.container, webScreenContainer]}>
//          <ScrollView style={useAbsoluteBarScrollStyle()}>
//            ...content + spacer to clear the absolute bar...
//          </ScrollView>
//          <View style={sty.bottomBarAbsolute}>...</View>
//        </View>
//
// Native: all helpers are no-ops or pure flex sugar — never breaks native.
import { Platform, useWindowDimensions } from 'react-native';

/**
 * Web-only container styles. On web they lock the screen to viewport height
 * and clip overflow so the inner ScrollView is the only scroll surface.
 * Spread onto the screen's outermost View style. No-op on native.
 */
export const webScreenContainer =
  Platform.OS === 'web' ? { height: '100vh', overflow: 'hidden' } : null;

/**
 * Style for ScrollView's `style` prop on screens with an ABSOLUTELY-positioned
 * bottom bar (Pattern A). Pins the ScrollView's outer div to the viewport
 * height on web — most aggressive constraint, guarantees wheel/touch scroll.
 *
 * IMPORTANT: contentContainerStyle on these screens must NOT include
 * `flexGrow: 1` (it makes content fill the parent → no overflow → no scroll).
 * Do include a bottom spacer (~vs(180)) so the last item isn't tucked under
 * the floating bar.
 */
export function useAbsoluteBarScrollStyle() {
  const { height: winHeight } = useWindowDimensions();
  if (Platform.OS !== 'web') return { flex: 1, minHeight: 0 };
  return { flex: 1, minHeight: 0, height: winHeight, maxHeight: winHeight };
}
