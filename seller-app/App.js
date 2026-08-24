import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_900Black,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

import SellerNavigator from './src/navigation/SellerNavigator';
import { C } from './src/theme';
import { LanguageProvider } from '@krushisarva/shared/context/LanguageContext';
import { AuthProvider, useAuth } from '@krushisarva/shared/context/AuthContext';
import LoginScreen from '@krushisarva/shared/screens/LoginScreen';
import RootErrorBoundary from '@krushisarva/shared/components/RootErrorBoundary';

import BootScreen from './src/components/BootScreen';
import { FeedbackProvider } from './src/components/ui';
import { NetworkProvider } from './src/hooks/useNetwork';

function RootNavigator() {
  const { isLoggedIn, loading } = useAuth();

  // Restoring the session. A branded boot screen instead of a bare spinner —
  // this is the first thing a seller sees on every cold start.
  if (loading) return <BootScreen label="Signing you in…" />;

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
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;

    const targets = [document.documentElement, document.body, document.getElementById('root')].filter(Boolean);
    targets.forEach((el) => {
      el.style.overflow = 'auto';
      el.style.height = 'auto';
      el.style.minHeight = '100%';
    });

    const style = document.createElement('style');
    style.innerHTML = `
      html, body { height: auto !important; min-height: 100%; overflow-y: auto !important; }
      #root { height: auto !important; min-height: 100vh; overflow: visible !important; display: block !important; }
      #root > div { height: auto !important; min-height: 100vh; overflow: visible !important; }
      /* The page itself is parchment, so an un-rendered area under the app
         reads as paper rather than as a white seam. */
      html, body { background-color: ${C.bg}; }
      /* Keyboard focus must stay visible — several controls set outline:none to
         hide the browser's default ring over our own focus styling. */
      :focus-visible { outline: 2px solid ${C.brand}; outline-offset: 3px; border-radius: 4px; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // Both families, every weight the type scale names. `src/theme` pins an
  // exact `fontFamily` on every step (Android ignores fontWeight for custom
  // fonts), so a weight missing here silently degrades that step to the
  // system font rather than erroring — hence loading the full set.
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Fraunces_900Black,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // A font CDN failure used to hang the app on the splash spinner forever.
  // System fonts are an acceptable fallback; a blank screen is not.
  if (!fontsLoaded && !fontError) return <BootScreen />;

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <NetworkProvider>
          <LanguageProvider>
            <AuthProvider>
              {/* FeedbackProvider sits inside the safe-area + language providers
                  (its toasts need both) but outside the navigator, so a confirm
                  dialog survives the screen that opened it being popped. */}
              <FeedbackProvider>
                {/* Every screen's chrome is parchment now — the saturated
                    ember is reserved for the earnings panel and the primary
                    action — so the status bar icons must be dark throughout. */}
                <StatusBar style="dark" />
                <RootNavigator />
              </FeedbackProvider>
            </AuthProvider>
          </LanguageProvider>
        </NetworkProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}
