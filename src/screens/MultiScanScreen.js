import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { colors, spacing, radius } from '../constants/theme';

const GRID_OPTIONS = [
  { label: '2 × 2', rows: 2, cols: 2, cells: 4, desc: 'Fast · best for 2-4 pieces' },
  { label: '2 × 3', rows: 2, cols: 3, cells: 6, desc: 'Balanced · best for 4-6 pieces' },
  { label: '3 × 3', rows: 3, cols: 3, cells: 9, desc: 'Thorough · best for 6-9 pieces' },
];

export default function MultiScanScreen({ navigation }) {
  const [selected, setSelected] = useState(1); // default 2x3

  const grid = GRID_OPTIONS[selected];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.devBadge}>DEV MODE</Text>
          <Text style={styles.title}>Multi-Part Scanner</Text>
          <Text style={styles.desc}>
            Photograph a pile of pieces. The photo is split into a grid and each cell is
            identified separately. Matching sets are ranked by how many of your pieces they contain.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Grid Size</Text>
        <View style={styles.gridOptions}>
          {GRID_OPTIONS.map((opt, i) => (
            <TouchableOpacity
              key={opt.label}
              style={[styles.optionCard, selected === i && styles.optionCardSelected]}
              onPress={() => setSelected(i)}
              activeOpacity={0.8}
            >
              <GridPreview rows={opt.rows} cols={opt.cols} selected={selected === i} />
              <Text style={[styles.optionLabel, selected === i && styles.optionLabelSelected]}>
                {opt.label}
              </Text>
              <Text style={[styles.optionDesc, selected === i && styles.optionDescSelected]}>
                {opt.desc}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>How it works</Text>
          <Text style={styles.warning}>• Each grid cell is sent to Brickognize individually</Text>
          <Text style={styles.warning}>• All {grid.cells} requests run in parallel (~4-6s total)</Text>
          <Text style={styles.warning}>• Pieces that straddle cell boundaries may not identify correctly</Text>
          <Text style={styles.warning}>• Works best when pieces are spread out, not stacked</Text>
        </View>

        <TouchableOpacity
          style={styles.btn}
          onPress={() => navigation.navigate('Camera', {
            mode: 'multiScan',
            gridRows: grid.rows,
            gridCols: grid.cols,
          })}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>Take Photo  ({grid.label} grid)</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function GridPreview({ rows, cols, selected }) {
  const cells = Array.from({ length: rows * cols });
  return (
    <View style={[styles.gridPreview, { aspectRatio: cols / rows }]}>
      {cells.map((_, i) => (
        <View
          key={i}
          style={[
            styles.gridCell,
            { width: `${100 / cols}%`, height: `${100 / rows}%` },
            selected && styles.gridCellSelected,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  devBadge: {
    backgroundColor: '#222',
    color: colors.secondary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  desc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  gridOptions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  optionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#fff5f5',
  },
  optionLabel: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.text,
    marginTop: spacing.xs,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  optionDesc: {
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  optionDescSelected: {
    color: colors.primaryDark,
  },
  gridPreview: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  gridCell: {
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  gridCellSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(227,0,11,0.08)',
  },
  warningBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderLeftWidth: 4,
    borderLeftColor: colors.secondary,
  },
  warningTitle: {
    color: colors.secondary,
    fontWeight: '700',
    marginBottom: spacing.sm,
    fontSize: 13,
  },
  warning: {
    color: '#ccc',
    fontSize: 13,
    lineHeight: 22,
  },
  btn: {
    backgroundColor: '#222',
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.secondary,
  },
  btnText: {
    color: colors.secondary,
    fontWeight: '800',
    fontSize: 16,
  },
});
