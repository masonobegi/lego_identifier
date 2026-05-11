import AsyncStorage from '@react-native-async-storage/async-storage';

const REBRICKABLE_KEY = 'rebrickable_api_key';
const ONBOARDING_KEY = 'onboarding_complete';

export async function getRebrickableKey() {
  // Runtime key (entered by user) takes priority over build-time env
  const stored = await AsyncStorage.getItem(REBRICKABLE_KEY);
  if (stored) return stored;
  return process.env.EXPO_PUBLIC_REBRICKABLE_KEY || '';
}

export async function setRebrickableKey(key) {
  await AsyncStorage.setItem(REBRICKABLE_KEY, key.trim());
}

export async function isOnboardingComplete() {
  const val = await AsyncStorage.getItem(ONBOARDING_KEY);
  return val === 'true';
}

export async function markOnboardingComplete() {
  await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
}

export async function clearApiKey() {
  await AsyncStorage.removeItem(REBRICKABLE_KEY);
}
