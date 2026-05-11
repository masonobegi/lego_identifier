import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Linking, ActivityIndicator, Alert,
} from 'react-native';
import { setRebrickableKey, markOnboardingComplete } from '../services/apiKeys';
import { searchSets } from '../services/rebrickable';
import { colors, spacing, radius } from '../constants/theme';

export default function OnboardingScreen({ onComplete }) {
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [step, setStep] = useState(1); // 1 = welcome, 2 = api key, 3 = done

  async function handleTestAndSave() {
    if (!key.trim()) {
      Alert.alert('Enter your key', 'Paste your Rebrickable API key first.');
      return;
    }
    setTesting(true);
    try {
      // Temporarily save key so rebrickable.js picks it up for the test
      await setRebrickableKey(key.trim());
      await searchSets('Technic'); // test call
      setStep(3);
    } catch (e) {
      await setRebrickableKey(''); // revert on failure
      Alert.alert(
        'Key not working',
        e?.response?.status === 401
          ? 'That key was rejected. Double-check you copied the full key from Rebrickable.'
          : 'Could not connect. Check your internet and try again.'
      );
    } finally {
      setTesting(false);
    }
  }

  async function handleSkip() {
    await markOnboardingComplete();
    onComplete();
  }

  async function handleFinish() {
    await markOnboardingComplete();
    onComplete();
  }

  if (step === 1) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.logo}>🧱</Text>
          <Text style={styles.title}>Welcome to Brick ID</Text>
          <Text style={styles.subtitle}>
            Identify LEGO parts with your camera, track your collection, and find out which sets you can build.
          </Text>

          <View style={styles.featureList}>
            {[
              ['📷', 'Scan parts', 'Point your camera at any LEGO piece to identify it'],
              ['📦', 'Track your collection', 'Build an inventory of every piece you own'],
              ['🎯', 'Set progress', 'See how close you are to completing your sets'],
              ['🔬', 'Multi-scan', 'Photograph a pile of pieces and find matching sets'],
            ].map(([icon, title, desc]) => (
              <View key={title} style={styles.feature}>
                <Text style={styles.featureIcon}>{icon}</Text>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{title}</Text>
                  <Text style={styles.featureDesc}>{desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(2)}>
            <Text style={styles.primaryBtnText}>Get Started →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip setup (limited features)</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === 2) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.stepLabel}>Step 1 of 1</Text>
          <Text style={styles.title}>Rebrickable API Key</Text>
          <Text style={styles.subtitle}>
            Brick ID uses Rebrickable's free API to look up set data. You need a free API key to use most features.
          </Text>

          <View style={styles.instructionBox}>
            <Text style={styles.instructionTitle}>How to get your free key:</Text>
            <Text style={styles.instruction}>1. Go to rebrickable.com and create a free account</Text>
            <Text style={styles.instruction}>2. Go to Settings → API</Text>
            <Text style={styles.instruction}>3. Copy your API key and paste it below</Text>
          </View>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => Linking.openURL('https://rebrickable.com/users/login/')}
          >
            <Text style={styles.linkBtnText}>Open Rebrickable →</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.keyInput}
            placeholder="Paste your API key here"
            placeholderTextColor={colors.textSecondary}
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />

          <TouchableOpacity
            style={[styles.primaryBtn, (!key.trim() || testing) && styles.primaryBtnDisabled]}
            onPress={handleTestAndSave}
            disabled={!key.trim() || testing}
          >
            {testing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Test & Save Key</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip for now</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Step 3: success
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.successBox}>
        <Text style={styles.successIcon}>✅</Text>
        <Text style={styles.successTitle}>You're all set!</Text>
        <Text style={styles.successDesc}>
          Your Rebrickable API key is saved. All features are unlocked.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleFinish}>
          <Text style={styles.primaryBtnText}>Start Using Brick ID</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xl * 2 },
  logo: { fontSize: 64, textAlign: 'center', marginBottom: spacing.md },
  title: { fontSize: 28, fontWeight: '900', color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: spacing.xl },
  stepLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', marginBottom: spacing.sm },
  featureList: { gap: spacing.md, marginBottom: spacing.xl },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md },
  featureIcon: { fontSize: 28 },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  featureDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  instructionBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.primary },
  instructionTitle: { fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  instruction: { color: colors.textSecondary, lineHeight: 24, fontSize: 14 },
  linkBtn: { backgroundColor: '#EEF2FF', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.lg },
  linkBtnText: { color: '#3B5BDB', fontWeight: '700', fontSize: 14 },
  keyInput: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, fontSize: 14,
    color: colors.text, marginBottom: spacing.lg, fontFamily: 'monospace',
  },
  primaryBtn: { backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: radius.full, alignItems: 'center', marginBottom: spacing.sm },
  primaryBtnDisabled: { backgroundColor: '#ccc' },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  skipBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  skipBtnText: { color: colors.textSecondary, fontSize: 13 },
  successBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  successIcon: { fontSize: 64 },
  successTitle: { fontSize: 26, fontWeight: '900', color: colors.text },
  successDesc: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 24 },
});
