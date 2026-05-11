import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Linking, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { setRebrickableKey, markOnboardingComplete } from '../services/apiKeys';
import { searchSets } from '../services/rebrickable';
import { colors, spacing, radius, shadows, typography, gradients } from '../constants/theme';

const FEATURES = [
  { icon: 'camera-outline', color: colors.primary, bg: colors.errorLight, title: 'Scan Parts', desc: 'Point your camera at any piece to identify it instantly' },
  { icon: 'layers-outline', color: '#7C3AED', bg: '#EDE9FE', title: 'Track Collection', desc: 'Build an inventory of every piece you own' },
  { icon: 'trophy-outline', color: colors.success, bg: colors.successLight, title: 'Set Progress', desc: 'See exactly how close you are to completing your sets' },
  { icon: 'construct-outline', color: colors.secondary, bg: colors.warningLight, title: 'Find Builds', desc: 'Discover which sets you can already build from your parts' },
];

export default function OnboardingScreen({ onComplete }) {
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [step, setStep] = useState(1);

  async function handleTestAndSave() {
    if (!key.trim()) { Alert.alert('Enter your key', 'Paste your Rebrickable API key first.'); return; }
    setTesting(true);
    try {
      await setRebrickableKey(key.trim());
      await searchSets('Technic');
      setStep(3);
    } catch (e) {
      await setRebrickableKey('');
      Alert.alert('Key not working', e?.response?.status === 401
        ? 'That key was rejected. Double-check you copied it correctly.'
        : 'Could not connect. Check your internet and try again.');
    } finally { setTesting(false); }
  }

  async function finish() { await markOnboardingComplete(); onComplete(); }

  if (step === 1) {
    return (
      <SafeAreaView style={styles.container}>
        <LinearGradient colors={gradients.primary} style={styles.heroGrad}>
          <Text style={styles.heroEmoji}>🧱</Text>
          <Text style={styles.heroTitle}>Brick ID</Text>
          <Text style={styles.heroSub}>Your LEGO part identifier</Text>
        </LinearGradient>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.bodyTitle}>Everything you need for your collection</Text>
          <View style={styles.featureGrid}>
            {FEATURES.map((f) => (
              <View key={f.title} style={styles.featureCard}>
                <View style={[styles.featureIconWrap, { backgroundColor: f.bg }]}>
                  <Ionicons name={f.icon} size={22} color={f.color} />
                </View>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(2)}>
            <Text style={styles.primaryBtnText}>Get Started</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipLink} onPress={finish}>
            <Text style={styles.skipLinkText}>Skip setup</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === 2) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.stepHeader}>
            <View style={styles.stepIconWrap}>
              <Ionicons name="key-outline" size={28} color={colors.primary} />
            </View>
            <Text style={styles.stepTitle}>Rebrickable API Key</Text>
            <Text style={styles.stepDesc}>
              Brick ID uses Rebrickable's free database for set data. It only takes 30 seconds to get a key.
            </Text>
          </View>

          <View style={styles.instructionCard}>
            {['Go to rebrickable.com and create a free account', 'Open Settings → API', 'Copy your API key and paste it below'].map((step, i) => (
              <View key={i} style={styles.instructionRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <Text style={styles.instructionText}>{step}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.openLinkBtn} onPress={() => Linking.openURL('https://rebrickable.com/users/login/')}>
            <Ionicons name="open-outline" size={16} color={colors.primary} />
            <Text style={styles.openLinkBtnText}>Open Rebrickable</Text>
          </TouchableOpacity>

          <View style={styles.inputWrap}>
            <Ionicons name="key-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.keyInput}
              placeholder="Paste your API key here"
              placeholderTextColor={colors.textTertiary}
              value={key}
              onChangeText={setKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, (!key.trim() || testing) && styles.primaryBtnDisabled]}
            onPress={handleTestAndSave}
            disabled={!key.trim() || testing}
          >
            {testing ? <ActivityIndicator color="#fff" /> : (
              <><Text style={styles.primaryBtnText}>Test & Save Key</Text><Ionicons name="checkmark-circle-outline" size={18} color="#fff" /></>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipLink} onPress={finish}>
            <Text style={styles.skipLinkText}>Skip for now</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient colors={gradients.success} style={styles.successGrad}>
        <Ionicons name="checkmark-circle" size={72} color="#fff" />
        <Text style={styles.successTitle}>You're all set!</Text>
        <Text style={styles.successDesc}>API key verified and saved. All features are unlocked.</Text>
      </LinearGradient>
      <View style={styles.body}>
        <TouchableOpacity style={styles.primaryBtn} onPress={finish}>
          <Text style={styles.primaryBtnText}>Start Using Brick ID</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heroGrad: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  heroEmoji: { fontSize: 56, marginBottom: spacing.sm },
  heroTitle: { ...typography.display, color: '#fff', marginBottom: spacing.xs },
  heroSub: { ...typography.body, color: 'rgba(255,255,255,0.75)' },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  bodyTitle: { ...typography.h2, textAlign: 'center', marginBottom: spacing.lg, color: colors.text },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  featureCard: {
    width: '47%', backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md, ...shadows.sm,
  },
  featureIconWrap: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  featureTitle: { ...typography.h3, marginBottom: 4 },
  featureDesc: { ...typography.bodySmall, color: colors.textSecondary },
  stepHeader: { alignItems: 'center', marginBottom: spacing.lg },
  stepIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.errorLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  stepTitle: { ...typography.h1, marginBottom: spacing.sm },
  stepDesc: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  instructionCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.md, ...shadows.sm },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  stepNumText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  instructionText: { flex: 1, ...typography.body, color: colors.text },
  openLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', marginBottom: spacing.lg },
  openLinkBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.lg,
    ...shadows.sm,
  },
  inputIcon: { marginRight: spacing.sm },
  keyInput: { flex: 1, paddingVertical: spacing.md, fontSize: 14, color: colors.text },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: radius.full, marginBottom: spacing.sm, ...shadows.colored,
  },
  primaryBtnDisabled: { backgroundColor: colors.border, ...shadows.sm },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  skipLink: { alignItems: 'center', paddingVertical: spacing.sm },
  skipLinkText: { color: colors.textSecondary, fontSize: 13 },
  successGrad: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  successTitle: { ...typography.h1, color: '#fff' },
  successDesc: { ...typography.body, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
});
