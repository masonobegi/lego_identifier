import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { getRebrickableKey, setRebrickableKey, clearApiKey } from '../services/apiKeys';
import { searchSets } from '../services/rebrickable';
import { clearCollection as clearCollectionData } from '../services/collection';
import { colors, spacing, radius } from '../constants/theme';

export default function SettingsScreen({ navigation }) {
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getRebrickableKey().then((k) => {
      setSavedKey(k);
      setKey(k);
    });
  }, []);

  async function handleSave() {
    if (!key.trim()) {
      Alert.alert('Empty key', 'Enter a Rebrickable API key first.');
      return;
    }
    setTesting(true);
    try {
      await setRebrickableKey(key.trim());
      await searchSets('Technic');
      setSavedKey(key.trim());
      Alert.alert('Saved!', 'API key verified and saved.');
    } catch (e) {
      await setRebrickableKey(savedKey); // revert
      Alert.alert(
        'Key not working',
        e?.response?.status === 401
          ? 'That key was rejected by Rebrickable. Check you copied the full key.'
          : 'Could not connect. Check your internet and try again.'
      );
    } finally {
      setTesting(false);
    }
  }

  async function handleClearKey() {
    Alert.alert('Clear API Key', 'This will remove your Rebrickable API key. Most features will stop working.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          await clearApiKey();
          setKey('');
          setSavedKey('');
        },
      },
    ]);
  }

  async function handleClearCollection() {
    Alert.alert(
      'Clear Collection',
      'This will permanently delete all your scanned parts and tracked sets. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All', style: 'destructive',
          onPress: async () => {
            await clearCollectionData();
            Alert.alert('Done', 'Your collection has been cleared.');
          },
        },
      ]
    );
  }

  const keyChanged = key.trim() !== savedKey;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>Rebrickable API Key</Text>
        <View style={styles.card}>
          <Text style={styles.cardDesc}>
            Required for set search, part lookup, and collection tracking.{' '}
            <Text style={styles.link} onPress={() => Linking.openURL('https://rebrickable.com/users/login/')}>
              Get a free key →
            </Text>
          </Text>
          <TextInput
            style={styles.keyInput}
            value={key}
            onChangeText={setKey}
            placeholder="Paste your API key here"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.keyActions}>
            <TouchableOpacity
              style={[styles.saveBtn, !keyChanged && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!keyChanged || testing}
            >
              {testing ? <ActivityIndicator color="#fff" size="small" /> : (
                <Text style={styles.saveBtnText}>{keyChanged ? 'Test & Save' : 'Saved ✓'}</Text>
              )}
            </TouchableOpacity>
            {savedKey ? (
              <TouchableOpacity style={styles.clearKeyBtn} onPress={handleClearKey}>
                <Text style={styles.clearKeyBtnText}>Clear Key</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {savedKey ? (
            <Text style={styles.keyStatus}>✓ Key saved · {savedKey.slice(0, 8)}...</Text>
          ) : (
            <Text style={[styles.keyStatus, { color: colors.error }]}>⚠ No key set — limited functionality</Text>
          )}
        </View>

        <Text style={styles.sectionLabel}>Data</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.dangerBtn} onPress={handleClearCollection}>
            <Text style={styles.dangerBtnText}>Clear All Collection Data</Text>
          </TouchableOpacity>
          <Text style={styles.dangerDesc}>
            Permanently deletes all scanned parts, counts, and tracked sets from this device.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.card}>
          <Text style={styles.aboutRow}>Part identification: <Text style={styles.aboutVal}>Brickognize (free, no key needed)</Text></Text>
          <Text style={styles.aboutRow}>Set & part data: <Text style={styles.aboutVal}>Rebrickable API v3</Text></Text>
          <Text style={styles.aboutRow}>Storage: <Text style={styles.aboutVal}>Local device only</Text></Text>
          <Text style={styles.aboutRow}>Version: <Text style={styles.aboutVal}>1.0.0</Text></Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  cardDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  link: { color: colors.primary, fontWeight: '600' },
  keyInput: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, fontSize: 13, color: colors.text,
    fontFamily: 'monospace', marginBottom: spacing.sm,
  },
  keyActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  saveBtn: {
    flex: 1, backgroundColor: colors.primary, paddingVertical: spacing.sm,
    borderRadius: radius.md, alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: colors.success },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  clearKeyBtn: {
    borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.md,
    paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center',
  },
  clearKeyBtnText: { color: colors.error, fontWeight: '600', fontSize: 13 },
  keyStatus: { fontSize: 12, color: colors.success, fontWeight: '600' },
  dangerBtn: {
    borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm,
  },
  dangerBtnText: { color: colors.error, fontWeight: '700', fontSize: 14 },
  dangerDesc: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
  aboutRow: { fontSize: 13, color: colors.textSecondary, lineHeight: 24 },
  aboutVal: { color: colors.text, fontWeight: '600' },
});
