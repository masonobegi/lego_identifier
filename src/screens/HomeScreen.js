import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadows, typography, gradients } from '../constants/theme';

const MODES = [
  {
    name: 'SetChecker',
    icon: 'layers-outline',
    iconColor: colors.primary,
    iconBg: colors.errorLight,
    title: 'Set Checker',
    desc: 'Pick a set, scan your pieces, see what matches.',
    accent: colors.primary,
  },
  {
    name: 'PartFinder',
    icon: 'search-outline',
    iconColor: '#7C3AED',
    iconBg: '#EDE9FE',
    title: 'Part Finder',
    desc: 'Photograph any piece to find every set it appears in.',
    accent: '#7C3AED',
  },
  {
    name: 'MultiScan',
    icon: 'scan-outline',
    iconColor: colors.secondary,
    iconBg: colors.warningLight,
    title: 'Multi-Part Scanner',
    desc: 'Grid split or sequential — scan a pile and find the best matching sets.',
    accent: colors.secondary,
    badge: 'DEV',
  },
];

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <LinearGradient colors={gradients.primary} style={styles.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View style={styles.heroTop}>
            <TouchableOpacity style={styles.heroIconBtn} onPress={() => navigation.navigate('BarcodeScanner')}>
              <Ionicons name="barcode-outline" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={styles.heroBrand}>
              <Text style={styles.heroTitle}>Brick ID</Text>
            </View>
            <TouchableOpacity style={styles.heroIconBtn} onPress={() => navigation.navigate('Collection')}>
              <Ionicons name="layers" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.heroSubtitle}>Identify · Track · Build</Text>

          {/* Quick actions */}
          <View style={styles.quickRow}>
            <QuickBtn icon="barcode-outline" label="Scan Box" onPress={() => navigation.navigate('BarcodeScanner')} />
            <QuickBtn icon="bookmark-outline" label="Track Set" onPress={() => navigation.navigate('TrackSet')} />
            <QuickBtn icon="time-outline" label="History" onPress={() => navigation.navigate('History')} />
            <QuickBtn icon="settings-outline" label="Settings" onPress={() => navigation.navigate('Settings')} />
          </View>
        </LinearGradient>

        {/* Mode cards */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scan Modes</Text>
          {MODES.map((mode) => (
            <TouchableOpacity
              key={mode.name}
              style={styles.modeCard}
              onPress={() => navigation.navigate(mode.name)}
              activeOpacity={0.75}
            >
              <View style={[styles.modeIconWrap, { backgroundColor: mode.iconBg }]}>
                <Ionicons name={mode.icon} size={26} color={mode.iconColor} />
              </View>
              <View style={styles.modeText}>
                <View style={styles.modeTitleRow}>
                  <Text style={styles.modeTitle}>{mode.title}</Text>
                  {mode.badge && <View style={styles.devBadge}><Text style={styles.devBadgeText}>{mode.badge}</Text></View>}
                </View>
                <Text style={styles.modeDesc}>{mode.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.footer}>Powered by Brickognize + Rebrickable</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickBtn({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.quickBtn} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.quickBtnIcon}>
        <Ionicons name={icon} size={18} color="#fff" />
      </View>
      <Text style={styles.quickBtnLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: spacing.xxl },

  hero: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  heroBrand: { alignItems: 'center' },
  heroTitle: { ...typography.display, color: '#fff', letterSpacing: -1.5 },
  heroSubtitle: { ...typography.caption, color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginBottom: spacing.lg },
  heroIconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },

  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quickBtn: { flex: 1, alignItems: 'center', gap: spacing.xs },
  quickBtnIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  quickBtnLabel: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },

  section: { padding: spacing.lg, gap: spacing.sm },
  sectionTitle: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },

  modeCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  modeIconWrap: {
    width: 52, height: 52, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  modeText: { flex: 1 },
  modeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 3 },
  modeTitle: { ...typography.h3 },
  modeDesc: { ...typography.bodySmall, color: colors.textSecondary },
  devBadge: {
    backgroundColor: colors.warningLight, borderRadius: radius.xs,
    paddingHorizontal: spacing.xs, paddingVertical: 2,
  },
  devBadgeText: { fontSize: 9, fontWeight: '900', color: colors.secondaryDark, letterSpacing: 0.8 },

  footer: { ...typography.caption, color: colors.textTertiary, textAlign: 'center', paddingBottom: spacing.md },
});
