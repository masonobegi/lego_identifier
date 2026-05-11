import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { colors, spacing, radius, shadows, typography } from '../constants/theme';

export default function PartFinderScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>🔍</Text>
        <Text style={styles.title}>Part Finder</Text>
        <Text style={styles.desc}>
          Photograph a single LEGO piece and we'll tell you every set it appears in.
        </Text>

        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>Tips for best results:</Text>
          <Text style={styles.tip}>• Place the piece on a plain white or grey background</Text>
          <Text style={styles.tip}>• Use good lighting — natural light works great</Text>
          <Text style={styles.tip}>• Fill the frame with the piece</Text>
          <Text style={styles.tip}>• Keep the piece right-side up if possible</Text>
        </View>

        <TouchableOpacity
          style={styles.btn}
          onPress={() => navigation.navigate('Camera', { mode: 'partFinder' })}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>Take Photo</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  icon: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  desc: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  tipBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    width: '100%',
    marginBottom: spacing.xl,
    borderLeftWidth: 4,
    borderLeftColor: colors.secondary,
  },
  tipTitle: {
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  tip: {
    color: colors.textSecondary,
    lineHeight: 24,
    fontSize: 14,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl * 2,
    borderRadius: radius.full,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 17,
  },
});
