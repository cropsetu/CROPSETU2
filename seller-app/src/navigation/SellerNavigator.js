/**
 * Root navigator for the seller app.
 *
 * This is the whole app: one stack, no tabs. It is the same stack the buyer app
 * used to nest under Account → SellerPortal, promoted to the root — so every
 * `navigation.navigate('SellerOrders')` etc. inside the screens still resolves.
 *
 * Entry routing depends on the account:
 *   - already a seller  → SellerDashboard
 *   - not a seller yet  → BusinessProfile (KYC setup); saving it flips the
 *     backend role to SELLER, after which the dashboard becomes reachable.
 *
 * Header styling comes from the theme rather than being hand-set here. It is
 * deliberately the SAME chrome the custom `AppHeader` renders — parchment
 * ground, warm hairline, Fraunces title — so a screen using the stack header
 * and a screen using its own are indistinguishable at the top of the page.
 * That equivalence is the whole reason both are allowed to exist.
 *
 * Gesture/animation behaviour honours the OS "Reduce Motion" setting — the fade
 * interpolator was previously unconditional.
 */
import { useEffect, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators, TransitionPresets } from '@react-navigation/stack';

import linking from './linking';
import { navigationRef } from './navigationRef';
import { useAuth } from '@krushisarva/shared/context/AuthContext';
import { useLanguage } from '@krushisarva/shared/context/LanguageContext';
import { SoundEffects } from '@krushisarva/shared/utils/sounds';
import { isSellerAccount } from '@krushisarva/shared/utils/roles';

import { C, SP, T } from '../theme';
import { useReducedMotion } from '../hooks/useMotion';

import SellerDashboard      from '../screens/DashboardScreen';
import SellerMyProducts     from '../screens/MyProductsScreen';
import SellerAddProduct     from '../screens/AddProductScreen';
import SellerCatalogSearch  from '../screens/CatalogSearchScreen';
import SellerOrders         from '../screens/OrdersScreen';
import SellerProfile        from '../screens/SellerProfileScreen';
import SellerBusiness       from '../screens/BusinessProfileScreen';
import ReceivedReports      from '../screens/ReceivedReportsScreen';
import ReceivedReportDetail from '../screens/ReceivedReportDetailScreen';

const Stack = createStackNavigator();

export default function SellerNavigator() {
  const { t } = useLanguage();
  const { user, markActivity } = useAuth();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') SoundEffects.cleanup();
    });
    return () => sub.remove();
  }, []);

  const screenOptions = useMemo(() => ({
    headerStyle: {
      backgroundColor: C.bg,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
      // The platform header shadow reads as a smudge over parchment; the
      // hairline above does the separation instead.
      elevation: 0,
      shadowOpacity: 0,
    },
    headerTintColor: C.brandInk,
    headerTitleStyle: { ...T.subhead, color: C.text },
    headerTitleAlign: 'center',
    headerBackTitleVisible: false,
    // Larger back-button hit area than the platform default.
    headerLeftContainerStyle: { paddingLeft: SP.sm },
    headerRightContainerStyle: { paddingRight: SP.sm },
    cardStyle: { backgroundColor: C.bg },
    // Reduce Motion: cross-fade with no travel. Otherwise the platform's own
    // push transition, which feels native and is interruptible.
    ...(reducedMotion
      ? {
          cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
          transitionSpec: {
            open: { animation: 'timing', config: { duration: 160 } },
            close: { animation: 'timing', config: { duration: 140 } },
          },
          gestureEnabled: false,
        }
      : {
          ...TransitionPresets.SlideFromRightIOS,
          gestureEnabled: Platform.OS !== 'web',
        }),
  }), [reducedMotion]);

  // Accounts that haven't completed KYC land on BusinessProfile instead of a
  // dashboard whose every request would 403. Read once, at mount: saving that
  // form flips the backend role to SELLER and the screen itself replaces the
  // route with SellerDashboard, so there is no need to remount the stack here.
  const initialRouteName = isSellerAccount(user) ? 'SellerDashboard' : 'BusinessProfile';

  return (
    <NavigationContainer ref={navigationRef} linking={linking} onStateChange={() => markActivity()}>
      <Stack.Navigator initialRouteName={initialRouteName} screenOptions={screenOptions}>
        <Stack.Screen name="SellerDashboard"      component={SellerDashboard}      options={{ headerShown: false }} />
        <Stack.Screen name="SellerMyProducts"     component={SellerMyProducts}     options={{ title: t('dash.myProducts') }} />
        {/* Search-first: every "add a product" entry point lands HERE, not on the
            form. Going straight to the form is what produced a separate catalog
            row per seller. */}
        <Stack.Screen name="CatalogSearch"        component={SellerCatalogSearch}  options={{ headerShown: false }} />
        <Stack.Screen name="AddProduct"           component={SellerAddProduct}     options={{ title: t('nav.listProduct') }} />
        <Stack.Screen name="SellerOrders"         component={SellerOrders}         options={{ title: t('dash.orders') }} />
        <Stack.Screen name="SellerProfile"        component={SellerProfile}        options={{ headerShown: false }} />
        <Stack.Screen name="BusinessProfile"      component={SellerBusiness}       options={{ title: t('sellerProfile.bizProfileKyc') }} />
        <Stack.Screen name="ReceivedReports"      component={ReceivedReports}      options={{ headerShown: false }} />
        <Stack.Screen name="ReceivedReportDetail" component={ReceivedReportDetail} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
