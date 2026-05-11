import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './src/screens/HomeScreen';
import SetCheckerScreen from './src/screens/SetCheckerScreen';
import PartFinderScreen from './src/screens/PartFinderScreen';
import CameraScreen from './src/screens/CameraScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import { colors } from './src/constants/theme';

const Stack = createStackNavigator();

export default function App() {
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
        <Stack.Screen
          name="SetChecker"
          component={SetCheckerScreen}
          options={{ title: 'Set Checker' }}
        />
        <Stack.Screen
          name="PartFinder"
          component={PartFinderScreen}
          options={{ title: 'Part Finder' }}
        />
        <Stack.Screen
          name="Camera"
          component={CameraScreen}
          options={{ title: 'Scan', headerShown: false }}
        />
        <Stack.Screen
          name="Results"
          component={ResultsScreen}
          options={{ title: 'Results' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
