/**
 * Global navigation ref — lets non-screen code (e.g. the in-app chat banner,
 * push-notification tap handlers) navigate and read the current route without a
 * `navigation` prop. Attached to the NavigationContainer in AppNavigator.
 */
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) navigationRef.navigate(name, params);
}

// Innermost active route ({ name, params }) across nested navigators, or null.
export function getActiveRoute() {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute() : null;
}
