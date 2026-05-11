import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';

import HomeScreen from './src/screens/HomeScreen';
import SetCheckerScreen from './src/screens/SetCheckerScreen';
import PartFinderScreen from './src/screens/PartFinderScreen';
import MultiScanScreen from './src/screens/MultiScanScreen';
import MultiResultsScreen from './src/screens/MultiResultsScreen';
import SequentialScanScreen from './src/screens/SequentialScanScreen';
import CameraScreen from './src/screens/CameraScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import CollectionScreen from './src/screens/CollectionScreen';
import SetProgressScreen from './src/screens/SetProgressScreen';
import TrackSetScreen from './src/screens/TrackSetScreen';
import BarcodeScannerScreen from './src/screens/BarcodeScannerScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { isOnboardingComplete } from './src/services/apiKeys';
import { colors } from './src/constants/theme';

const Stack = createStackNavigator();

const lightHeader = {
  headerStyle: { backgroundColor: colors.surface, shadowColor: 'transparent', elevation: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTintColor: colors.primary,
  headerTitleStyle: { fontWeight: '800', color: colors.text, fontSize: 17 },
  headerBackTitle: '',
};

const darkHeader = {
  headerStyle: { backgroundColor: '#111', shadowColor: 'transparent', elevation: 0, borderBottomWidth: 1, borderBottomColor: '#2C2C2E' },
  headerTintColor: colors.secondary,
  headerTitleStyle: { fontWeight: '800', color: '#fff', fontSize: 17 },
  headerBackTitle: '',
};

export default function App() {
  const [onboarded, setOnboarded] = useState(null);
  useEffect(() => { isOnboardingComplete().then(setOnboarded); }, []);

  if (onboarded === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!onboarded) return <OnboardingScreen onComplete={() => setOnboarded(true)} />;

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={lightHeader}>
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="SetChecker" component={SetCheckerScreen} options={{ title: 'Set Checker' }} />
        <Stack.Screen name="PartFinder" component={PartFinderScreen} options={{ title: 'Part Finder' }} />
        <Stack.Screen name="Camera" component={CameraScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Results" component={ResultsScreen} options={{ title: 'Results' }} />
        <Stack.Screen name="MultiScan" component={MultiScanScreen} options={{ ...darkHeader, title: 'Multi-Part Scanner' }} />
        <Stack.Screen name="MultiResults" component={MultiResultsScreen} options={{ ...darkHeader, title: 'Scan Results' }} />
        <Stack.Screen name="SequentialScan" component={SequentialScanScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Collection" component={CollectionScreen} options={{ title: 'My Collection' }} />
        <Stack.Screen name="SetProgress" component={SetProgressScreen} options={{ title: 'Set Progress' }} />
        <Stack.Screen name="TrackSet" component={TrackSetScreen} options={{ title: 'Track a Set' }} />
        <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreen} options={{ ...darkHeader, title: 'Scan Barcode' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
