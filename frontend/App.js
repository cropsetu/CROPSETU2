import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import {
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
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingNavigator from './src/navigation/OnboardingNavigator';
import { LanguageProvider } from './src/context/LanguageContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { FarmProvider } from './src/context/FarmContext';
import { MultiFarmProvider } from './src/context/MultiFarmContext';
import { LocationProvider } from './src/context/LocationContext';
import LocationSync from './src/context/LocationSync';
import { CartProvider } from './src/context/CartContext';
import { KrushiAssistantProvider } from './src/context/KrushiAssistantContext';
import LoginScreen from './src/screens/Auth/LoginScreen';
import RootErrorBoundary from './src/components/RootErrorBoundary';
import InAppChatBanner from './src/components/InAppChatBanner';
import { COLORS } from './src/constants/colors';

function RootNavigator() {
  const { isLoggedIn, loading, user } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!isLoggedIn) return <LoginScreen />;

  // Show onboarding profile setup for NEW users who haven't completed profile
  const needsOnboarding = user?.onboardingStep === 'BASIC' && !user?.totalFarms;
  if (needsOnboarding) return (
    <>
      <StatusBar style="dark" />
      <OnboardingNavigator />
    </>
  );

  return <AppNavigator />;
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
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    // CropSetu auth screens
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
            <CartProvider>
              <FarmProvider>
                <MultiFarmProvider>
                  <LocationProvider>
                    <KrushiAssistantProvider>
                      <LocationSync />
                      <StatusBar style="light" />
                      <RootNavigator />
                      {/* WhatsApp-style in-app heads-up for new chat messages. */}
                      <InAppChatBanner />
                    </KrushiAssistantProvider>
                  </LocationProvider>
                </MultiFarmProvider>
              </FarmProvider>
            </CartProvider>
          </AuthProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
