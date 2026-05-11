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

export default function App() {
  const [onboarded, setOnboarded] = useState(null); // null = checking

  useEffect(() => {
    isOnboardingComplete().then((done) => setOnboarded(done));
  }, []);

  if (onboarded === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!onboarded) {
    return (
      <OnboardingScreen onComplete={() => setOnboarded(true)} />
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '800' },
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Brick ID', headerShown: false }}
        />
        <Stack.Screen name="SetChecker" component={SetCheckerScreen} options={{ title: 'Set Checker' }} />
        <Stack.Screen name="PartFinder" component={PartFinderScreen} options={{ title: 'Part Finder' }} />
        <Stack.Screen name="Camera" component={CameraScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Results" component={ResultsScreen} options={{ title: 'Results' }} />
        <Stack.Screen
          name="MultiScan"
          component={MultiScanScreen}
          options={{ title: 'Multi-Part Scanner', headerStyle: { backgroundColor: '#1a1a1a' } }}
        />
        <Stack.Screen
          name="MultiResults"
          component={MultiResultsScreen}
          options={{ title: 'Scan Results', headerStyle: { backgroundColor: '#1a1a1a' } }}
        />
        <Stack.Screen
          name="SequentialScan"
          component={SequentialScanScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen name="Collection" component={CollectionScreen} options={{ title: 'My Collection' }} />
        <Stack.Screen name="SetProgress" component={SetProgressScreen} options={{ title: 'Set Progress' }} />
        <Stack.Screen name="TrackSet" component={TrackSetScreen} options={{ title: 'Track a Set' }} />
        <Stack.Screen
          name="BarcodeScanner"
          component={BarcodeScannerScreen}
          options={{ title: 'Scan Barcode', headerStyle: { backgroundColor: '#111' } }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
