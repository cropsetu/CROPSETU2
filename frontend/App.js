import 'react-native-gesture-handler';
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
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
import AppNavigator from './src/navigation/AppNavigator';
import OnboardingNavigator from './src/navigation/OnboardingNavigator';
import { LanguageProvider } from './src/context/LanguageContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { FarmProvider } from './src/context/FarmContext';
import { MultiFarmProvider } from './src/context/MultiFarmContext';
import { LocationProvider } from './src/context/LocationContext';
import LocationSync from './src/context/LocationSync';
import LoginScreen from './src/screens/Auth/LoginScreen';
import RootErrorBoundary from './src/components/RootErrorBoundary';
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
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

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
            <FarmProvider>
              <MultiFarmProvider>
                <LocationProvider>
                  <LocationSync />
                  <StatusBar style="light" />
                  <RootNavigator />
                </LocationProvider>
              </MultiFarmProvider>
            </FarmProvider>
          </AuthProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
