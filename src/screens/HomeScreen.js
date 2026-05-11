import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { colors, spacing, radius } from '../constants/theme';

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ width: 44 }} />
          <View style={styles.headerCenter}>
            <Text style={styles.title}>Brick ID</Text>
            <Text style={styles.subtitle}>LEGO Part Identifier</Text>
          </View>
          <TouchableOpacity style={styles.collectionBtn} onPress={() => navigation.navigate('Collection')}>
            <Text style={styles.collectionBtnIcon}>📦</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.modeContainer}>
        <TouchableOpacity
          style={[styles.modeCard, styles.modeCardRed]}
          onPress={() => navigation.navigate('SetChecker')}
          activeOpacity={0.85}
        >
          <Text style={styles.modeIcon}>🧱</Text>
          <Text style={styles.modeTitle}>Set Checker</Text>
          <Text style={styles.modeDesc}>
            Choose a LEGO set, photograph your pieces, and see which ones match.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeCard, styles.modeCardYellow]}
          onPress={() => navigation.navigate('PartFinder')}
          activeOpacity={0.85}
        >
          <Text style={styles.modeIcon}>🔍</Text>
          <Text style={[styles.modeTitle, { color: '#111' }]}>Part Finder</Text>
          <Text style={[styles.modeDesc, { color: 'rgba(0,0,0,0.65)' }]}>
            Photograph a piece and discover every set it appears in.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeCard, styles.modeCardDark]}
          onPress={() => navigation.navigate('MultiScan')}
          activeOpacity={0.85}
        >
          <View style={styles.devRow}>
            <Text style={styles.modeIcon}>🔬</Text>
            <View style={styles.devBadge}>
              <Text style={styles.devBadgeText}>DEV</Text>
            </View>
          </View>
          <Text style={styles.modeTitle}>Multi-Part Scanner</Text>
          <Text style={styles.modeDesc}>
            Photograph a pile of pieces. Grid-splits the image and ranks the best matching sets.
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>Powered by Brickognize + Rebrickable</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCenter: {
    alignItems: 'center',
  },
  collectionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  collectionBtnIcon: {
    fontSize: 22,
  },
  title: {
    fontSize: 42,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },
  modeContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    justifyContent: 'center',
  },
  modeCard: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  modeCardRed: {
    backgroundColor: colors.primary,
  },
  modeCardYellow: {
    backgroundColor: colors.secondary,
  },
  modeCardDark: {
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: colors.secondary,
  },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  modeIcon: {
    fontSize: 40,
  },
  devBadge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  devBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#111',
    letterSpacing: 1,
  },
  modeTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: spacing.xs,
  },
  modeDesc: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 22,
  },
  hint: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 12,
    paddingBottom: spacing.lg,
  },
});
