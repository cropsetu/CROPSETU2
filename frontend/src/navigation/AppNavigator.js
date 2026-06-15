import { Platform, View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated, AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useRef, useEffect, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import linking from './linking';
import { navigationRef } from './navigationRef';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { COLORS, TYPE, RADIUS, SHADOWS } from '../constants/colors';
import { Haptics } from '../utils/haptics';
import { SoundEffects } from '../utils/sounds';
import { CardStyleInterpolators } from '@react-navigation/stack';

const ACTIVE_COLOR   = COLORS.primary;
const INACTIVE_COLOR = COLORS.mutedSage;

const { width: W, height: H } = Dimensions.get('window');

// Scale helper — base design at 390px wide (iPhone 14)
const scale  = (v) => Math.round(v * (W / 390));
// Clamp between min and max
const clamp  = (v, min, max) => Math.min(Math.max(v, min), max);

const ICON_SIZE  = clamp(scale(25), 22, 28);
const LABEL_SIZE = clamp(scale(11), 10, 12);
const BAR_H      = Platform.OS === 'ios'
  ? clamp(scale(90), 82, 104)
  : clamp(scale(74), 66, 86);
const PB         = Platform.OS === 'ios' ? clamp(scale(22), 18, 30) : clamp(scale(8), 6, 12);
const PT         = clamp(scale(10), 8, 14);

// ── Tab bar ───────────────────────────────────────────────────────────────────
function TabItem({ route, options, focused, onPress }) {
  const sc = useRef(new Animated.Value(1)).current;
  const pillAnim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const dotAnim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const { count: cartCount } = useCart();
  const badgeCount = route.name === 'AgriStore' ? cartCount : 0;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(pillAnim, { toValue: focused ? 1 : 0, useNativeDriver: true, tension: 180, friction: 12 }),
      Animated.spring(dotAnim, { toValue: focused ? 1 : 0, useNativeDriver: true, tension: 200, friction: 14 }),
    ]).start();
  }, [focused]);

  const handlePress = () => {
    Haptics.navigation();
    SoundEffects.tap();
    Animated.sequence([
      Animated.spring(sc, { toValue: 0.82, useNativeDriver: true, tension: 260, friction: 8 }),
      Animated.spring(sc, { toValue: 1,    useNativeDriver: true, tension: 160, friction: 6 }),
    ]).start();
    onPress();
  };

  const iconMap = {
    AgriStore:   focused ? 'storefront'      : 'storefront-outline',
    AIAssistant: focused ? 'hardware-chip'   : 'hardware-chip-outline',
    AnimalTrade: focused ? 'paw'             : 'paw-outline',
    Rent:        focused ? 'construct'       : 'construct-outline',
    MyFarm:      focused ? 'leaf'             : 'leaf-outline',
    Account:     focused ? 'person-circle'   : 'person-circle-outline',
  };

  const pillStyle = {
    opacity: pillAnim,
    transform: [{ scale: pillAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
  };

  const dotStyle = {
    opacity: dotAnim,
    transform: [{ scaleX: dotAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) }],
  };

  return (
    <TouchableOpacity
      style={TB.tab}
      activeOpacity={1}
      onPress={handlePress}
    >
      <Animated.View style={[TB.tabInner, { transform: [{ scale: sc }] }]}>
        <Animated.View style={[TB.activePill, pillStyle]} />
        <View>
          <Ionicons
            name={iconMap[route.name] || 'ellipse'}
            size={ICON_SIZE}
            color={focused ? ACTIVE_COLOR : INACTIVE_COLOR}
          />
          {badgeCount > 0 && (
            <View style={TB.badge}>
              <Text style={TB.badgeTxt} numberOfLines={1}>
                {badgeCount > 99 ? '99+' : badgeCount}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={[TB.label, { color: focused ? ACTIVE_COLOR : INACTIVE_COLOR, fontSize: LABEL_SIZE }]}
          numberOfLines={1}
        >
          {options.tabBarLabel ?? route.name}
        </Text>
        <Animated.View style={[TB.activeDot, dotStyle]} />
      </Animated.View>
    </TouchableOpacity>
  );
}

function ImmersiveTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const onPress = (route, isFocused) => {
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
  };

  // On Android with gesture nav the bottom inset is 0; with 3-button nav it may
  // also be 0. Either way we add a minimum 8px so the bar never sits flush on
  // the very bottom edge of the screen.
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 8 : PB);

  return (
    <View style={[TB.bar, { paddingBottom: bottomPad, paddingTop: PT }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        return (
          <TabItem
            key={route.key}
            route={route}
            options={options}
            focused={focused}
            onPress={() => onPress(route, focused)}
          />
        );
      })}
    </View>
  );
}

const TB = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderTopWidth: 1,
    borderTopColor: COLORS.greenPaleBorder,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: clamp(scale(4), 3, 6),
    position: 'relative',
    paddingHorizontal: clamp(scale(6), 4, 10),
    paddingVertical: clamp(scale(4), 3, 7),
  },
  activePill: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: ACTIVE_COLOR + '14',
    borderRadius: 18,
  },
  label: {
    fontWeight: TYPE.weight.bold,
    textAlign: 'center',
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: ACTIVE_COLOR,
    marginTop: 2,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.98)',
  },
  badgeTxt: {
    color: '#fff',
    fontSize: 9.5,
    fontWeight: '900',
    lineHeight: 11,
  },
});

// ── Screen imports ────────────────────────────────────────────────────────────

// Agri Store
import AgriStoreHome        from '../screens/AgriStore/AgriStoreHome';
import ProductDetail        from '../screens/AgriStore/ProductDetail';
import CartScreen           from '../screens/AgriStore/CartScreen';
import CheckoutScreen       from '../screens/AgriStore/CheckoutScreen';
import OrderConfirmedScreen from '../screens/AgriStore/OrderConfirmedScreen';

// AI Assistant
import AIAssistantHome      from '../screens/AI/AIAssistantHome';
import AIChatScreen         from '../screens/AI/AIChatScreen';
import CropScanScreen       from '../screens/AI/CropScanScreen';
import DiagnosisResultScreen from '../screens/AI/DiagnosisResultScreen';
import ScanHistoryScreen    from '../screens/AI/ScanHistoryScreen';
import VoiceHistoryScreen   from '../screens/AI/VoiceHistoryScreen';
import PastReportScreen     from '../screens/AI/PastReportScreen';
import MarketScreen         from '../screens/AI/MarketScreen';
import SchemeScreen         from '../screens/AI/SchemeScreen';
import DailyPlannerScreen   from '../screens/AI/DailyPlannerScreen';
// New AI services
import MSPTrackerScreen      from '../screens/AI/MSPTrackerScreen';
import SoilHubScreen         from '../screens/AI/SoilHubScreen';
import SoilFormScreen        from '../screens/AI/SoilFormScreen';
import SoilReportScreen      from '../screens/AI/SoilReportScreen';
import SoilScanScreen        from '../screens/AI/SoilScanScreen';
import SoilGuideScreen       from '../screens/AI/SoilGuideScreen';
import FarmCalendarScreen    from '../screens/AI/FarmCalendarScreen';
import IrrigationScreen      from '../screens/AI/IrrigationScreen';
import InputCalculatorScreen from '../screens/AI/InputCalculatorScreen';
import VoiceChatScreen      from '../screens/AI/VoiceChatScreen';
import AICreditsScreen      from '../screens/AI/AICreditsScreen';

// Animal Trade
import AnimalTradeHome  from '../screens/AnimalTrade/AnimalTradeHome';
import AnimalDetail     from '../screens/AnimalTrade/AnimalDetail';
import AddAnimalListing from '../screens/AnimalTrade/AddAnimalListing';
import MyAnimalChatsScreen from '../screens/AnimalTrade/MyAnimalChatsScreen';
import ChatScreen       from '../screens/AnimalTrade/ChatScreen';

// Rent
import RentHome           from '../screens/Rent/RentHome';
import MachineryDetail    from '../screens/Rent/MachineryDetail';
import LabourDetail       from '../screens/Rent/LabourDetail';
import AddMachineryScreen from '../screens/Rent/AddMachineryScreen';
import AddWorkerScreen    from '../screens/Rent/AddWorkerScreen';
import RentBookingsScreen from '../screens/Rent/RentBookingsScreen';

// Weather
import WeatherHome      from '../screens/Weather/WeatherHome';
import CropCalendar     from '../screens/Weather/CropCalendar';
import CropDetail       from '../screens/Weather/CropDetail';
import StateCropsScreen from '../screens/Weather/StateCropsScreen';

// Profile
import ProfileScreen           from '../screens/Profile/ProfileScreen';
import MyRentListingsScreen    from '../screens/Rent/MyRentListingsScreen';
import MyOrdersScreen          from '../screens/Profile/MyOrdersScreen';
import SavedPostsScreen        from '../screens/Profile/SavedPostsScreen';
import MyAnimalListingsScreen  from '../screens/Profile/MyAnimalListingsScreen';

// Farm Profile Module
import MyFarmHomeScreen         from '../screens/FarmProfile/MyFarmHomeScreen';
import FarmListScreen           from '../screens/FarmProfile/FarmListScreen';
import FarmDetailScreen         from '../screens/FarmProfile/FarmDetailScreen';
import FarmAddEditScreen        from '../screens/FarmProfile/FarmAddEditScreen';
import CropCycleCreateScreen    from '../screens/FarmProfile/CropCycleCreateScreen';
import CropCycleDetailScreen    from '../screens/FarmProfile/CropCycleDetailScreen';
import ActivityTypePickerScreen from '../screens/FarmProfile/ActivityTypePickerScreen';
import IrrigationLogScreen      from '../screens/FarmProfile/logging/IrrigationLogScreen';
import LandPrepLogScreen        from '../screens/FarmProfile/logging/LandPrepLogScreen';
import SowingLogScreen          from '../screens/FarmProfile/logging/SowingLogScreen';
import ScoutLogScreen           from '../screens/FarmProfile/logging/ScoutLogScreen';
import WeedingLogScreen         from '../screens/FarmProfile/logging/WeedingLogScreen';
import PruningLogScreen         from '../screens/FarmProfile/logging/PruningLogScreen';
import ExpenseLogScreen         from '../screens/FarmProfile/logging/ExpenseLogScreen';
import IncomeLogScreen          from '../screens/FarmProfile/logging/IncomeLogScreen';

// Seller Portal (integrated)
import SellerDashboard      from '../screens/Seller/DashboardScreen';
import SellerMyProducts     from '../screens/Seller/MyProductsScreen';
import SellerAddProduct     from '../screens/Seller/AddProductScreen';
import SellerOrders         from '../screens/Seller/OrdersScreen';
import SellerProfile        from '../screens/Seller/SellerProfileScreen';
import SellerBusiness       from '../screens/Seller/BusinessProfileScreen';
import ReceivedReports      from '../screens/Seller/ReceivedReportsScreen';
import ReceivedReportDetail from '../screens/Seller/ReceivedReportDetailScreen';

// ── Navigators ────────────────────────────────────────────────────────────────
const Tab           = createBottomTabNavigator();
const AgriStack     = createStackNavigator();
const AIStack       = createStackNavigator();
const AnimalStack   = createStackNavigator();
const RentStack     = createStackNavigator();
const MyFarmStack   = createStackNavigator();
const ProfileStack  = createStackNavigator();
const SellerStack   = createStackNavigator();

const defaultScreenOptions = {
  headerStyle: { backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTintColor: COLORS.textDark,
  headerTitleStyle: { fontWeight: TYPE.weight.bold, fontSize: 17, color: COLORS.textDark },
  headerBackTitleVisible: false,
  cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
};

const aiScreenOptions = {
  headerStyle: { backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTintColor: COLORS.primary,
  headerTitleStyle: { fontWeight: TYPE.weight.bold, fontSize: 17, color: COLORS.textDark },
  headerBackTitleVisible: false,
  cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
};

function AgriStoreNavigator() {
  return (
    <AgriStack.Navigator screenOptions={defaultScreenOptions}>
      <AgriStack.Screen name="AgriStoreHome"  component={AgriStoreHome}        options={{ headerShown: false }} />
      <AgriStack.Screen name="ProductDetail"  component={ProductDetail}        options={{ headerShown: false }} />
      <AgriStack.Screen name="Cart"           component={CartScreen}           options={{ headerShown: false }} />
      <AgriStack.Screen name="Checkout"       component={CheckoutScreen}       options={{ headerShown: false }} />
      <AgriStack.Screen name="OrderConfirmed" component={OrderConfirmedScreen} options={{ title: 'Order Confirmed', headerShown: false }} />
    </AgriStack.Navigator>
  );
}

function AINavigator() {
  const { t } = useLanguage();
  return (
    <AIStack.Navigator screenOptions={aiScreenOptions}>
      <AIStack.Screen name="AIAssistantHome"   component={AIAssistantHome}        options={{ headerShown: false }} />
      <AIStack.Screen name="AIChat"            component={AIChatScreen}           options={{ headerShown: false }} />
      <AIStack.Screen name="CropScan"          component={CropScanScreen}         options={{ headerShown: false }} />
      <AIStack.Screen name="DiagnosisResult"   component={DiagnosisResultScreen}  options={{ headerShown: false }} />
      <AIStack.Screen name="ScanHistory"       component={ScanHistoryScreen}      options={{ headerShown: false }} />
      <AIStack.Screen name="VoiceHistory"      component={VoiceHistoryScreen}     options={{ headerShown: false }} />
      <AIStack.Screen name="PastReport"        component={PastReportScreen}       options={{ headerShown: false }} />
      <AIStack.Screen name="Market"            component={MarketScreen}           options={{ headerShown: false }} />
      <AIStack.Screen name="Scheme"            component={SchemeScreen}           options={{ headerShown: false }} />
      <AIStack.Screen name="DailyPlanner"      component={DailyPlannerScreen}     options={{ headerShown: false }} />
      {/* New AI services */}
      <AIStack.Screen name="MSPTracker"        component={MSPTrackerScreen}       options={{ headerShown: false }} />
      {/* Soil Hub — cosmic redesign. 'SoilHealth' kept as the entry alias so the
          AI home tile still works; sub-screens are the form/report/scan/guide. */}
      <AIStack.Screen name="SoilHealth"        component={SoilHubScreen}          options={{ headerShown: false }} />
      <AIStack.Screen name="SoilHub"           component={SoilHubScreen}          options={{ headerShown: false }} />
      <AIStack.Screen name="SoilForm"          component={SoilFormScreen}         options={{ headerShown: false }} />
      <AIStack.Screen name="SoilReport"        component={SoilReportScreen}       options={{ headerShown: false }} />
      <AIStack.Screen name="SoilScan"          component={SoilScanScreen}         options={{ headerShown: false }} />
      <AIStack.Screen name="SoilGuide"         component={SoilGuideScreen}        options={{ headerShown: false }} />
      <AIStack.Screen name="FarmCalendar"      component={FarmCalendarScreen}     options={{ headerShown: false }} />
      <AIStack.Screen name="Irrigation"        component={IrrigationScreen}       options={{ headerShown: false }} />
      <AIStack.Screen name="InputCalculator"   component={InputCalculatorScreen}  options={{ headerShown: false }} />
      <AIStack.Screen name="VoiceChat"        component={VoiceChatScreen}        options={{ headerShown: false }} />
      <AIStack.Screen name="AICredits"        component={AICreditsScreen}        options={{ headerShown: false }} />
      {/* Farm Profile — accessible from AI tab (cosmic screens draw own header) */}
      <AIStack.Screen name="FarmList"               component={FarmListScreen}         options={{ headerShown: false }} />
      <AIStack.Screen name="FarmDetail"             component={FarmDetailScreen}       options={{ headerShown: false }} />
      <AIStack.Screen name="FarmAddEdit"            component={FarmAddEditScreen}      options={{ headerShown: false }} />
      <AIStack.Screen name="CropCycleCreate"        component={CropCycleCreateScreen}  options={{ headerShown: false }} />
      <AIStack.Screen name="CropCycleDetail"        component={CropCycleDetailScreen}  options={{ headerShown: false }} />
      <AIStack.Screen name="ActivityTypePicker"     component={ActivityTypePickerScreen} options={{ headerShown: false }} />
      <AIStack.Screen name="ActivityIrrigationLog"  component={IrrigationLogScreen}    options={{ headerShown: false }} />
      <AIStack.Screen name="ActivityLandPrepLog"    component={LandPrepLogScreen}      options={{ headerShown: false }} />
      <AIStack.Screen name="ActivitySowingLog"      component={SowingLogScreen}        options={{ headerShown: false }} />
      <AIStack.Screen name="ActivityScoutLog"       component={ScoutLogScreen}         options={{ headerShown: false }} />
      <AIStack.Screen name="ActivityWeedingLog"     component={WeedingLogScreen}       options={{ headerShown: false }} />
      <AIStack.Screen name="ActivityPruningLog"     component={PruningLogScreen}       options={{ headerShown: false }} />
      <AIStack.Screen name="ActivityExpenseLog"     component={ExpenseLogScreen}       options={{ headerShown: false }} />
      <AIStack.Screen name="ActivityIncomeLog"      component={IncomeLogScreen}        options={{ headerShown: false }} />
      {/* Weather screens — accessible from AI tab */}
      <AIStack.Screen name="Weather"           component={WeatherHome}            options={{ headerShown: false }} />
      <AIStack.Screen name="CropCalendar"      component={CropCalendar}           options={{ title: t('cropCalendar.bannerTitle') }} />
      <AIStack.Screen name="CropDetail"        component={CropDetail}             options={({ route }) => ({ title: route.params?.cropName || t('nav.cropDetails') })} />
      <AIStack.Screen name="StateCrops"        component={StateCropsScreen}       options={{ headerShown: false }} />
    </AIStack.Navigator>
  );
}

function AnimalTradeNavigator() {
  const { t } = useLanguage();
  return (
    <AnimalStack.Navigator screenOptions={defaultScreenOptions}>
      <AnimalStack.Screen name="AnimalTradeHome"  component={AnimalTradeHome}  options={{ headerShown: false }} />
      <AnimalStack.Screen name="AnimalDetail"     component={AnimalDetail}     options={{ title: t('animalDetail.animalDetails') }} />
      <AnimalStack.Screen name="AddAnimalListing" component={AddAnimalListing} options={{ title: t('sellYourAnimal') }} />
      <AnimalStack.Screen name="MyAnimalChats"    component={MyAnimalChatsScreen} options={{ headerShown: false }} />
      <AnimalStack.Screen name="Chat"             component={ChatScreen}       options={{ headerShown: false }} />
    </AnimalStack.Navigator>
  );
}

function RentNavigator() {
  return (
    <RentStack.Navigator screenOptions={defaultScreenOptions}>
      <RentStack.Screen name="RentHome"        component={RentHome}           options={{ headerShown: false }} />
      <RentStack.Screen name="MachineryDetail" component={MachineryDetail}    options={{ headerShown: false }} />
      <RentStack.Screen name="LabourDetail"    component={LabourDetail}       options={{ headerShown: false }} />
      <RentStack.Screen name="AddMachinery"    component={AddMachineryScreen} options={{ headerShown: false }} />
      <RentStack.Screen name="AddWorker"       component={AddWorkerScreen}    options={{ headerShown: false }} />
      <RentStack.Screen name="RentBookings"    component={RentBookingsScreen} options={{ headerShown: false }} />
    </RentStack.Navigator>
  );
}

function MyFarmNavigator() {
  // All MyFarm v2 screens render their own cosmic header, so the stack header
  // is hidden everywhere in this stack (no light-chrome bar above dark canvas).
  return (
    <MyFarmStack.Navigator screenOptions={{ ...defaultScreenOptions, headerShown: false }}>
      <MyFarmStack.Screen name="MyFarmHome"             component={MyFarmHomeScreen} />
      <MyFarmStack.Screen name="FarmList"               component={FarmListScreen} />
      <MyFarmStack.Screen name="FarmDetail"             component={FarmDetailScreen} />
      <MyFarmStack.Screen name="FarmAddEdit"            component={FarmAddEditScreen} />
      <MyFarmStack.Screen name="CropCycleCreate"        component={CropCycleCreateScreen} />
      <MyFarmStack.Screen name="CropCycleDetail"        component={CropCycleDetailScreen} />
      <MyFarmStack.Screen name="ActivityTypePicker"     component={ActivityTypePickerScreen} />
      <MyFarmStack.Screen name="ActivityIrrigationLog"  component={IrrigationLogScreen} />
      <MyFarmStack.Screen name="ActivityLandPrepLog"    component={LandPrepLogScreen} />
      <MyFarmStack.Screen name="ActivitySowingLog"      component={SowingLogScreen} />
      <MyFarmStack.Screen name="ActivityScoutLog"       component={ScoutLogScreen} />
      <MyFarmStack.Screen name="ActivityWeedingLog"     component={WeedingLogScreen} />
      <MyFarmStack.Screen name="ActivityPruningLog"     component={PruningLogScreen} />
      <MyFarmStack.Screen name="ActivityExpenseLog"     component={ExpenseLogScreen} />
      <MyFarmStack.Screen name="ActivityIncomeLog"      component={IncomeLogScreen} />
    </MyFarmStack.Navigator>
  );
}

function SellerNavigator() {
  const { t } = useLanguage();
  return (
    <SellerStack.Navigator screenOptions={{
      headerStyle: { backgroundColor: COLORS.cta, borderBottomWidth: 0 },
      headerTintColor: COLORS.textWhite,
      headerTitleStyle: { fontWeight: TYPE.weight.bold, fontSize: 17 },
      headerBackTitleVisible: false,
      cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
    }}>
      <SellerStack.Screen name="SellerDashboard"    component={SellerDashboard}  options={{ headerShown: false }} />
      <SellerStack.Screen name="SellerMyProducts"   component={SellerMyProducts} options={{ title: t('dash.myProducts') }} />
      <SellerStack.Screen name="AddProduct"         component={SellerAddProduct} options={{ title: t('nav.listProduct') }} />
      <SellerStack.Screen name="SellerOrders"       component={SellerOrders}     options={{ title: t('dash.orders') }} />
      <SellerStack.Screen name="SellerProfile"      component={SellerProfile}    options={{ headerShown: false }} />
      <SellerStack.Screen name="BusinessProfile"    component={SellerBusiness}   options={{ title: t('sellerProfile.bizProfileKyc') }} />
      <SellerStack.Screen name="ReceivedReports"        component={ReceivedReports}       options={{ headerShown: false }} />
      <SellerStack.Screen name="ReceivedReportDetail"   component={ReceivedReportDetail}  options={{ headerShown: false }} />
    </SellerStack.Navigator>
  );
}

function ProfileNavigator() {
  const { t } = useLanguage();
  return (
    <ProfileStack.Navigator screenOptions={defaultScreenOptions}>
      <ProfileStack.Screen name="ProfileHome"         component={ProfileScreen}           options={{ headerShown: false }} />
      <ProfileStack.Screen name="MyRentListings"      component={MyRentListingsScreen}    options={{ headerShown: false }} />
      <ProfileStack.Screen name="SellerPortal"        component={SellerNavigator}         options={{ headerShown: false }} />
      <ProfileStack.Screen name="MyOrders"            component={MyOrdersScreen}          options={{ headerShown: false }} />
      <ProfileStack.Screen name="SavedPosts"          component={SavedPostsScreen}        options={{ headerShown: false }} />
      <ProfileStack.Screen name="MyAnimalListings"    component={MyAnimalListingsScreen}  options={{ headerShown: false }} />
      {/* Farm Profile Module — cosmic screens draw own header */}
      <ProfileStack.Screen name="FarmList"                component={FarmListScreen}          options={{ headerShown: false }} />
      <ProfileStack.Screen name="FarmDetail"              component={FarmDetailScreen}        options={{ headerShown: false }} />
      <ProfileStack.Screen name="FarmAddEdit"             component={FarmAddEditScreen}       options={{ headerShown: false }} />
      <ProfileStack.Screen name="CropCycleCreate"         component={CropCycleCreateScreen}   options={{ headerShown: false }} />
      <ProfileStack.Screen name="CropCycleDetail"         component={CropCycleDetailScreen}   options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivityTypePicker"      component={ActivityTypePickerScreen} options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivityIrrigationLog"   component={IrrigationLogScreen}     options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivityLandPrepLog"     component={LandPrepLogScreen}       options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivitySowingLog"       component={SowingLogScreen}         options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivityScoutLog"        component={ScoutLogScreen}          options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivityWeedingLog"      component={WeedingLogScreen}        options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivityPruningLog"      component={PruningLogScreen}        options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivityExpenseLog"      component={ExpenseLogScreen}        options={{ headerShown: false }} />
      <ProfileStack.Screen name="ActivityIncomeLog"       component={IncomeLogScreen}         options={{ headerShown: false }} />
    </ProfileStack.Navigator>
  );
}

// ── Root navigator ────────────────────────────────────────────────────────────
export default function AppNavigator() {
  const { t } = useLanguage();
  const { markActivity } = useAuth();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') SoundEffects.cleanup();
    });
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer ref={navigationRef} linking={linking} onStateChange={() => markActivity()}>
      <Tab.Navigator
        tabBar={(props) => <ImmersiveTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen
          name="AgriStore"
          component={AgriStoreNavigator}
          options={{ tabBarLabel: t('tabShop') }}
        />
        <Tab.Screen
          name="AIAssistant"
          component={AINavigator}
          options={{ tabBarLabel: t('tabAI') }}
        />
        <Tab.Screen
          name="AnimalTrade"
          component={AnimalTradeNavigator}
          options={{ tabBarLabel: t('tabAnimals') }}
        />
        <Tab.Screen
          name="Rent"
          component={RentNavigator}
          options={{ tabBarLabel: t('tabRent') }}
        />
        <Tab.Screen
          name="MyFarm"
          component={MyFarmNavigator}
          options={{ tabBarLabel: t('myFarm.tabLabel') }}
        />
        <Tab.Screen
          name="Account"
          component={ProfileNavigator}
          options={{ tabBarLabel: t('tabAccount') }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
