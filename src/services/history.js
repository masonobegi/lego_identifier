import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'brick_id_scan_history';
const MAX_ENTRIES = 20;

export async function getHistory() {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function addHistoryEntry(entry) {
  const history = await getHistory();
  const newEntry = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    ...entry,
  };
  const updated = [newEntry, ...history].slice(0, MAX_ENTRIES);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

export async function clearHistory() {
  await AsyncStorage.removeItem(HISTORY_KEY);
}
