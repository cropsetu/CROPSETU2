import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

import SellerNavigator from './src/navigation/SellerNavigator';
import { LanguageProvider } from '@cropsetu/shared/context/LanguageContext';
import { AuthProvider, useAuth } from '@cropsetu/shared/context/AuthContext';
import LoginScreen from '@cropsetu/shared/screens/LoginScreen';
import RootErrorBoundary from '@cropsetu/shared/components/RootErrorBoundary';
import { COLORS } from '@cropsetu/shared/constants/colors';

function RootNavigator() {
  const { isLoggedIn, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  // Same OTP login as the buyer app — one account works in both. Sellers who
  // haven't finished KYC are routed to BusinessProfile by SellerNavigator.
  if (!isLoggedIn) return <LoginScreen />;

  return <SellerNavigator />;
}

export default function App() {
  // Web only: RN-Web defaults to `html/body { height:100%; overflow:hidden }`,
  // which kills page scroll and collapses screens whose layout depends on
  // `flex:1` propagating from a non-existent definite parent height (the result
  // is a white screen). Restore native document scroll once at app start.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const targets = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean);
    targets.forEach((el) => {
      el.style.overflow = 'auto';
      el.style.height = 'auto';
      el.style.minHeight = '100%';
    });
  }, []);

  const [fontsLoaded] = useFonts({
    // Auth screen (khetTheme) typography — the seller screens themselves use
    // system fonts, so only these two families are bundled.
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.innerHTML = `
      html, body { height: auto !important; min-height: 100%; overflow-y: auto !important; }
      #root { height: auto !important; min-height: 100vh; overflow: visible !important; display: block !important; }
      #root > div { height: auto !important; min-height: 100vh; overflow: visible !important; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <LanguageProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </AuthProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
