import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
} from 'react-native';
import { colors, spacing, radius } from '../constants/theme';

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Brick ID</Text>
        <Text style={styles.subtitle}>LEGO Part Identifier</Text>
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
          <Text style={styles.modeTitle}>Part Finder</Text>
          <Text style={styles.modeDesc}>
            Photograph a piece and discover every set it appears in.
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
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
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
  modeIcon: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  modeTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: spacing.xs,
  },
  modeDesc: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 22,
  },
  hint: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 12,
    paddingBottom: spacing.lg,
  },
});
