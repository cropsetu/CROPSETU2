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
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';

import linking from './linking';
import { navigationRef } from './navigationRef';
import { useAuth } from '@cropsetu/shared/context/AuthContext';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
import { COLORS, TYPE } from '@cropsetu/shared/constants/colors';
import { SoundEffects } from '@cropsetu/shared/utils/sounds';
import { isSellerAccount } from '@cropsetu/shared/utils/roles';

import SellerDashboard      from '../screens/DashboardScreen';
import SellerMyProducts     from '../screens/MyProductsScreen';
import SellerAddProduct     from '../screens/AddProductScreen';
import SellerOrders         from '../screens/OrdersScreen';
import SellerProfile        from '../screens/SellerProfileScreen';
import SellerBusiness       from '../screens/BusinessProfileScreen';
import ReceivedReports      from '../screens/ReceivedReportsScreen';
import ReceivedReportDetail from '../screens/ReceivedReportDetailScreen';

const Stack = createStackNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: COLORS.cta, borderBottomWidth: 0 },
  headerTintColor: COLORS.textWhite,
  headerTitleStyle: { fontWeight: TYPE.weight.bold, fontSize: 17 },
  headerBackTitleVisible: false,
  cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
};

export default function SellerNavigator() {
  const { t } = useLanguage();
  const { user, markActivity } = useAuth();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') SoundEffects.cleanup();
    });
    return () => sub.remove();
  }, []);

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
