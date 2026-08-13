/**
 * OnboardingNavigator — 2-screen profile setup after OTP.
 * Screen 1: Language selection
 * Screen 2: Farm profile (photo, name, location, farm, crops)
 */
import React from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import OnboardingLanguageScreen from '../screens/Onboarding/OnboardingLanguageScreen';
import OnboardingProfileScreen from '../screens/Onboarding/OnboardingProfileScreen';

const Stack = createStackNavigator();

class ErrorCatcher extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#FFF' }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#F44336', marginBottom: 10 }}>Onboarding Error</Text>
          <Text style={{ fontSize: 13, color: '#333', textAlign: 'center' }}>{this.state.error.message}</Text>
          <Text style={{ fontSize: 11, color: '#999', marginTop: 10, textAlign: 'center' }}>{this.state.error.stack?.split('\n').slice(0, 3).join('\n')}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function OnboardingNavigator() {
  return (
    <ErrorCatcher>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false, gestureEnabled: false }}>
          <Stack.Screen name="OnboardingLanguage" component={OnboardingLanguageScreen} />
          <Stack.Screen name="OnboardingProfile" component={OnboardingProfileScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorCatcher>
  );
}
